const crypto = require('crypto');
const db = require('../config/database');

function normalizeClientRef(value) {
    return String(value || '').trim();
}

async function hasTable(tableName, executor = db) {
    const sql = `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        LIMIT 1
    `;

    const [rows] = await executor.execute(sql, [tableName]);
    return rows.length > 0;
}

async function getTableColumns(tableName, executor = db) {
    const sql = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `;

    const [rows] = await executor.execute(sql, [tableName]);
    return rows.map((row) => row.COLUMN_NAME);
}

function findColumn(columns, candidates) {
    return columns.find((column) => candidates.includes(column));
}

function buildClientReferenceFilter(ref, idColumn, codeColumn) {
    if (!idColumn && !codeColumn) {
        throw new Error('No se encontró columna de identificación en clientes');
    }

    let whereSql = '';
    const whereParams = [];

    if (idColumn && /^\d+$/.test(ref)) {
        whereSql += `\`${idColumn}\` = ?`;
        whereParams.push(Number(ref));

        if (codeColumn) {
            whereSql += ` OR \`${codeColumn}\` = ?`;
            whereParams.push(ref);
        }
    } else if (codeColumn) {
        whereSql += `\`${codeColumn}\` = ?`;
        whereParams.push(ref);
    } else {
        throw new Error('Referencia inválida para identificar cliente');
    }

    return { whereSql, whereParams };
}

async function ensureRewardsTables(executor = db) {
    const clientesExists = await hasTable('clientes', executor);
    if (!clientesExists) {
        throw new Error('La tabla clientes no existe. Inicializa el módulo de ventas primero.');
    }

    await executor.query(`
        CREATE TABLE IF NOT EXISTS premios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(150) NOT NULL,
            descripcion TEXT NULL,
            costo_puntos INT NOT NULL,
            activo TINYINT(1) NOT NULL DEFAULT 1,
            tipo_descuento ENUM('MONTO', 'PORCENTAJE') NOT NULL DEFAULT 'MONTO',
            valor_descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_premios_activo (activo),
            INDEX idx_premios_costo (costo_puntos)
        )
    `);

    await executor.query(`
        CREATE TABLE IF NOT EXISTS canjes_premios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            cliente_id INT NULL,
            codigo_cliente VARCHAR(100) NULL,
            premio_id INT NOT NULL,
            factura_id INT NULL,
            puntos_canjeados INT NOT NULL,
            codigo_cupon VARCHAR(40) NOT NULL,
            estado VARCHAR(30) NOT NULL DEFAULT 'GENERADO',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_canjes_codigo_cupon (codigo_cupon),
            INDEX idx_canjes_cliente_id (cliente_id),
            INDEX idx_canjes_codigo_cliente (codigo_cliente),
            INDEX idx_canjes_premio_id (premio_id),
            INDEX idx_canjes_factura_id (factura_id),
            CONSTRAINT fk_canjes_premio
                FOREIGN KEY (premio_id) REFERENCES premios(id)
                ON UPDATE RESTRICT
                ON DELETE RESTRICT
        )
    `);
}

async function seedDefaultRewards(executor = db) {
    const shouldSeed = String(process.env.REWARDS_SEED_DEFAULT || 'true').toLowerCase() !== 'false';
    if (!shouldSeed) {
        return;
    }

    const defaultRewards = [
        {
            nombre: 'Descuento 3%',
            descripcion: 'Aplica 3% de descuento en la próxima venta.',
            costo_puntos: 50,
            tipo_descuento: 'PORCENTAJE',
            valor_descuento: 3.00
        },
        {
            nombre: 'Descuento 10%',
            descripcion: 'Aplica 10% de descuento en la próxima venta.',
            costo_puntos: 100,
            tipo_descuento: 'PORCENTAJE',
            valor_descuento: 10.00
        },
        {
            nombre: 'Descuento 25%',
            descripcion: 'Aplica 25% de descuento en la próxima venta.',
            costo_puntos: 250,
            tipo_descuento: 'PORCENTAJE',
            valor_descuento: 25.00
        },
        {
            nombre: 'Descuento 50%',
            descripcion: 'Aplica 50% de descuento en la próxima venta.',
            costo_puntos: 500,
            tipo_descuento: 'PORCENTAJE',
            valor_descuento: 50.00
        }
    ];

    const [countRows] = await executor.execute('SELECT COUNT(*) AS total FROM premios');
    const total = Number(countRows?.[0]?.total || 0);
    if (total === 0) {
        const values = defaultRewards
            .map(() => '(?, ?, ?, ?, ?, 1)')
            .join(',\n                ');

        const params = defaultRewards.flatMap((reward) => [
            reward.nombre,
            reward.descripcion,
            reward.costo_puntos,
            reward.tipo_descuento,
            reward.valor_descuento
        ]);

        await executor.query(
            `
                INSERT INTO premios (nombre, descripcion, costo_puntos, tipo_descuento, valor_descuento, activo)
                VALUES
                ${values}
            `,
            params
        );
        return;
    }

    for (const reward of defaultRewards) {
        const [rows] = await executor.execute(
            'SELECT id FROM premios WHERE nombre = ? LIMIT 1',
            [reward.nombre]
        );

        if (rows.length > 0) {
            await executor.execute(
                `
                    UPDATE premios
                    SET descripcion = ?, costo_puntos = ?, activo = 1, tipo_descuento = ?, valor_descuento = ?
                    WHERE id = ?
                `,
                [reward.descripcion, reward.costo_puntos, reward.tipo_descuento, reward.valor_descuento, rows[0].id]
            );
        } else {
            await executor.execute(
                `
                    INSERT INTO premios (nombre, descripcion, costo_puntos, tipo_descuento, valor_descuento, activo)
                    VALUES (?, ?, ?, ?, ?, 1)
                `,
                [reward.nombre, reward.descripcion, reward.costo_puntos, reward.tipo_descuento, reward.valor_descuento]
            );
        }
    }

    const rewardNames = defaultRewards.map((reward) => reward.nombre);
    await executor.execute(
        `
            UPDATE premios
            SET activo = 0
            WHERE nombre NOT IN (${rewardNames.map(() => '?').join(', ')})
        `,
        rewardNames
    );
}

async function cleanupDeprecatedRewards(executor = db) {
    const deprecatedNames = [
        'Envío gratis',
        'Envio gratis',
        'Productos de regalo',
        'Producto de regalo'
    ];

    const placeholders = deprecatedNames.map(() => '?').join(', ');

    await executor.execute(
        `
            DELETE p
            FROM premios p
            LEFT JOIN canjes_premios c ON c.premio_id = p.id
            WHERE p.nombre IN (${placeholders})
              AND c.id IS NULL
        `,
        deprecatedNames
    );

    await executor.execute(
        `
            UPDATE premios p
            JOIN canjes_premios c ON c.premio_id = p.id
            SET p.activo = 0
            WHERE p.nombre IN (${placeholders})
        `,
        deprecatedNames
    );
}

async function ensureRewardsInfrastructure(executor = db) {
    await ensureRewardsTables(executor);
    await ensureRewardColumns(executor);
    await cleanupDeprecatedRewards(executor);
    await seedDefaultRewards(executor);
}

async function ensureRewardColumns(executor = db) {
    await executor.query(`ALTER TABLE premios ADD COLUMN IF NOT EXISTS tipo_descuento ENUM('MONTO', 'PORCENTAJE') NOT NULL DEFAULT 'MONTO'`);
    await executor.query(`ALTER TABLE premios ADD COLUMN IF NOT EXISTS valor_descuento DECIMAL(10,2) NOT NULL DEFAULT 0`);
    await executor.query(`ALTER TABLE canjes_premios ADD COLUMN IF NOT EXISTS factura_id INT NULL`);
    await executor.query(`ALTER TABLE canjes_premios ADD INDEX IF NOT EXISTS idx_canjes_factura_id (factura_id)`);
}

function buildCouponCode() {
    const timestampPart = Date.now().toString(36).toUpperCase();
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `CUP-${timestampPart}-${randomPart}`.slice(0, 40);
}

async function resolveClientByRef(ref, executor = db, { lockForUpdate = false } = {}) {
    const columns = await getTableColumns('clientes', executor);
    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);

    const filter = buildClientReferenceFilter(ref, idColumn, codeColumn);

    const selectParts = [];
    if (idColumn) selectParts.push(`\`${idColumn}\` AS cliente_id`);
    if (codeColumn) selectParts.push(`\`${codeColumn}\` AS codigo_cliente`);
    selectParts.push('COALESCE(puntos_acumulados, 0) AS puntos_acumulados');

    const sql = `
        SELECT ${selectParts.join(', ')}
        FROM clientes
        WHERE ${filter.whereSql}
        LIMIT 1
        ${lockForUpdate ? 'FOR UPDATE' : ''}
    `;

    const [rows] = await executor.execute(sql, filter.whereParams);
    if (rows.length === 0) {
        throw new Error('Cliente no encontrado');
    }

    return {
        clienteId: rows[0].cliente_id ?? null,
        codigoCliente: rows[0].codigo_cliente ?? null,
        puntosAcumulados: Number(rows[0].puntos_acumulados || 0),
        idColumn,
        codeColumn,
        filter
    };
}

exports.getRewards = async () => {
    await ensureRewardsInfrastructure();

    const [rows] = await db.execute(
        `
            SELECT id, nombre, descripcion, costo_puntos, tipo_descuento, valor_descuento
            FROM premios
            WHERE activo = 1
            ORDER BY costo_puntos ASC, nombre ASC
        `
    );

    return rows;
};

exports.getAllRewards = async () => {
    await ensureRewardsInfrastructure();

    const [rows] = await db.execute(
        `
            SELECT id, nombre, descripcion, costo_puntos, tipo_descuento, valor_descuento, activo
            FROM premios
            ORDER BY activo DESC, costo_puntos ASC, nombre ASC
        `
    );

    return rows;
};

exports.createReward = async ({ nombre, descripcion, costo_puntos, tipo_descuento = 'MONTO', valor_descuento = 0, activo = 1 }) => {
    await ensureRewardsInfrastructure();

    const name = String(nombre || '').trim();
    if (!name) {
        throw new Error('El nombre del premio es obligatorio');
    }

    const cost = Number(costo_puntos);
    if (!Number.isInteger(cost) || cost <= 0) {
        throw new Error('El costo en puntos debe ser un número entero mayor que 0');
    }

    const discountType = String(tipo_descuento || 'MONTO').toUpperCase();
    if (discountType !== 'MONTO' && discountType !== 'PORCENTAJE') {
        throw new Error('El tipo de descuento no es válido');
    }

    const discountValue = Number(valor_descuento);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new Error('El valor del descuento debe ser mayor que 0');
    }

    if (discountType === 'PORCENTAJE' && discountValue > 100) {
        throw new Error('El valor del descuento porcentual no puede ser mayor a 100');
    }

    const activeValue = Number(activo) === 1 ? 1 : 0;

    const [result] = await db.execute(
        `
            INSERT INTO premios (nombre, descripcion, costo_puntos, activo, tipo_descuento, valor_descuento)
            VALUES (?, ?, ?, ?, ?, ?)
        `,
        [name, String(descripcion || '').trim(), cost, activeValue, discountType, discountValue]
    );

    return {
        id: result.insertId,
        nombre: name,
        descripcion: String(descripcion || '').trim(),
        costo_puntos: cost,
        tipo_descuento: discountType,
        valor_descuento: discountValue,
        activo: activeValue
    };
};

exports.updateReward = async ({ id, nombre, descripcion, costo_puntos, tipo_descuento = 'MONTO', valor_descuento = 0, activo = 1 }) => {
    await ensureRewardsInfrastructure();

    const rewardId = Number(id);
    if (!Number.isInteger(rewardId) || rewardId <= 0) {
        throw new Error('El identificador del premio es inválido');
    }

    const name = String(nombre || '').trim();
    if (!name) {
        throw new Error('El nombre del premio es obligatorio');
    }

    const cost = Number(costo_puntos);
    if (!Number.isInteger(cost) || cost <= 0) {
        throw new Error('El costo en puntos debe ser un número entero mayor que 0');
    }

    const discountType = String(tipo_descuento || 'MONTO').toUpperCase();
    if (discountType !== 'MONTO' && discountType !== 'PORCENTAJE') {
        throw new Error('El tipo de descuento no es válido');
    }

    const discountValue = Number(valor_descuento);
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
        throw new Error('El valor del descuento debe ser mayor que 0');
    }

    if (discountType === 'PORCENTAJE' && discountValue > 100) {
        throw new Error('El valor del descuento porcentual no puede ser mayor a 100');
    }

    const activeValue = Number(activo) === 1 ? 1 : 0;

    const [existingRows] = await db.execute(
        'SELECT id FROM premios WHERE id = ? LIMIT 1',
        [rewardId]
    );

    if (existingRows.length === 0) {
        throw new Error('El premio no existe');
    }

    await db.execute(
        `
            UPDATE premios
            SET nombre = ?, descripcion = ?, costo_puntos = ?, activo = ?, tipo_descuento = ?, valor_descuento = ?
            WHERE id = ?
        `,
        [name, String(descripcion || '').trim(), cost, activeValue, discountType, discountValue, rewardId]
    );

    return {
        id: rewardId,
        nombre: name,
        descripcion: String(descripcion || '').trim(),
        costo_puntos: cost,
        tipo_descuento: discountType,
        valor_descuento: discountValue,
        activo: activeValue
    };
};

exports.deleteReward = async ({ id }) => {
    await ensureRewardsInfrastructure();

    const rewardId = Number(id);
    if (!Number.isInteger(rewardId) || rewardId <= 0) {
        throw new Error('El identificador del premio es inválido');
    }

    const [existingRows] = await db.execute(
        'SELECT id FROM premios WHERE id = ? LIMIT 1',
        [rewardId]
    );

    if (existingRows.length === 0) {
        throw new Error('El premio no existe');
    }

    const [canjeRows] = await db.execute(
        'SELECT COUNT(*) AS total FROM canjes_premios WHERE premio_id = ?',
        [rewardId]
    );
    const totalCanjes = Number(canjeRows?.[0]?.total || 0);

    if (totalCanjes > 0) {
        await db.execute(
            'UPDATE premios SET activo = 0 WHERE id = ?',
            [rewardId]
        );

        return {
            message: 'El premio tiene canjes previos y se ha desactivado correctamente',
            id: rewardId
        };
    }

    await db.execute('DELETE FROM premios WHERE id = ?', [rewardId]);

    return { message: 'Premio eliminado correctamente', id: rewardId };
};

exports.redeemReward = async ({ clientRef, rewardId }) => {
    await ensureRewardsInfrastructure();

    const ref = normalizeClientRef(clientRef);
    const premioId = Number(rewardId);

    if (!ref) {
        throw new Error('Debe seleccionar un cliente');
    }

    if (!Number.isInteger(premioId) || premioId <= 0) {
        throw new Error('Debe seleccionar un premio válido');
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [rewardRows] = await connection.execute(
            'SELECT id, nombre, costo_puntos, activo FROM premios WHERE id = ? LIMIT 1',
            [premioId]
        );

        if (rewardRows.length === 0) {
            throw new Error('Premio no encontrado');
        }

        const reward = rewardRows[0];

        if (Number(reward.activo) !== 1) {
            throw new Error('El premio no está disponible');
        }

        const costo = Number(reward.costo_puntos || 0);
        if (!Number.isFinite(costo) || costo <= 0) {
            throw new Error('El premio no tiene un costo válido');
        }

        const client = await resolveClientByRef(ref, connection, { lockForUpdate: true });

        if (client.puntosAcumulados < costo) {
            throw new Error('Saldo insuficiente para canjear este premio');
        }

        const puntosRestantes = client.puntosAcumulados - costo;

        await connection.execute(
            `
                UPDATE clientes
                SET puntos_acumulados = ?
                WHERE ${client.filter.whereSql}
                LIMIT 1
            `,
            [puntosRestantes, ...client.filter.whereParams]
        );

        let couponCode = null;
        let canjeId = null;

        for (let attempt = 0; attempt < 6; attempt += 1) {
            couponCode = buildCouponCode();

            try {
                const [result] = await connection.execute(
                    `
                        INSERT INTO canjes_premios (
                            cliente_id,
                            codigo_cliente,
                            premio_id,
                            puntos_canjeados,
                            codigo_cupon,
                            estado,
                            created_at
                        )
                        VALUES (?, ?, ?, ?, ?, 'GENERADO', NOW())
                    `,
                    [
                        client.clienteId ?? null,
                        client.codigoCliente ?? ref,
                        premioId,
                        costo,
                        couponCode
                    ]
                );

                canjeId = result.insertId;
                break;
            } catch (error) {
                if (error && error.code === 'ER_DUP_ENTRY' && attempt < 5) {
                    continue;
                }
                throw error;
            }
        }

        if (!couponCode || !canjeId) {
            throw new Error('No se pudo generar el cupón, intenta nuevamente');
        }

        await connection.commit();

        return {
            message: 'Canje realizado correctamente',
            canje_id: canjeId,
            coupon_code: couponCode,
            puntos_restantes: puntosRestantes,
            premio: {
                id: reward.id,
                nombre: reward.nombre,
                costo_puntos: costo
            }
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};
