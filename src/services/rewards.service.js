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
            puntos_canjeados INT NOT NULL,
            codigo_cupon VARCHAR(40) NOT NULL,
            estado VARCHAR(30) NOT NULL DEFAULT 'GENERADO',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE KEY uq_canjes_codigo_cupon (codigo_cupon),
            INDEX idx_canjes_cliente_id (cliente_id),
            INDEX idx_canjes_codigo_cliente (codigo_cliente),
            INDEX idx_canjes_premio_id (premio_id),
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

    const [countRows] = await executor.execute('SELECT COUNT(*) AS total FROM premios');
    const total = Number(countRows?.[0]?.total || 0);
    if (total > 0) {
        return;
    }

    await executor.query(
        `
            INSERT INTO premios (nombre, descripcion, costo_puntos, activo)
            VALUES
                ('Descuento 10%', 'Cupón aplicable a la próxima compra.', 100, 1),
                ('Envío Gratis', 'Beneficio válido en tu siguiente despacho.', 75, 1),
                ('Producto de Regalo', 'Selecciona un artículo participante sin costo.', 250, 1)
        `
    );
}

async function ensureRewardsInfrastructure(executor = db) {
    await ensureRewardsTables(executor);
    await seedDefaultRewards(executor);
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
            SELECT id, nombre, descripcion, costo_puntos
            FROM premios
            WHERE activo = 1
            ORDER BY costo_puntos ASC, nombre ASC
        `
    );

    return rows;
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
