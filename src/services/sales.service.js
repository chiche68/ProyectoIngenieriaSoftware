const crypto = require('crypto');
const db = require('../config/database');
const DEFAULT_POINTS_PER_AMOUNT = 10;
const DEFAULT_POINTS_AWARDED = 1;
const INVENTORY_PRODUCTS_API_URL = process.env.INVENTORY_PRODUCTS_API_URL || 'https://inventarioapi-the3.onrender.com/api/Productos';

function buildCouponCode() {
    const timestampPart = Date.now().toString(36).toUpperCase();
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `CUP-${timestampPart}-${randomPart}`.slice(0, 40);
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

async function hasColumn(tableName, columnName, executor = db) {
    const sql = `
        SELECT 1
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
        LIMIT 1
    `;

    const [rows] = await executor.execute(sql, [tableName, columnName]);
    return rows.length > 0;
}

async function hasIndex(tableName, indexName, executor = db) {
    const sql = `
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND INDEX_NAME = ?
        LIMIT 1
    `;

    const [rows] = await executor.execute(sql, [tableName, indexName]);
    return rows.length > 0;
}

function normalizeInventoryProduct(product) {
    const id = Number(product?.id ?? 0);
    const codigo = String(product?.codigo ?? '').trim();
    const nombre = String(product?.nombre ?? '').trim();
    const descripcion = String(product?.descripcion ?? '').trim();
    const categoria = String(product?.categoria ?? '').trim();
    const bodegaNombre = String(product?.bodegaNombre ?? '').trim();
    const precioVenta = Number(product?.precioVenta ?? 0);
    const stockActual = Number(product?.stockActual ?? product?.tockActual ?? 0);
    const stockMinimo = Number(product?.stockMinimo ?? 0);
    const estado = product?.estado !== false && product?.estado !== 0 && String(product?.estado || '').toLowerCase() !== 'false';

    return {
        id: Number.isFinite(id) ? id : 0,
        codigo,
        nombre,
        descripcion,
        categoria,
        bodegaNombre,
        precioVenta: Number.isFinite(precioVenta) ? Number(precioVenta.toFixed(2)) : 0,
        stockActual: Number.isFinite(stockActual) ? stockActual : 0,
        stockMinimo: Number.isFinite(stockMinimo) ? stockMinimo : 0,
        estado,
        stockBajo: Boolean(product?.stockBajo),
        nivelInventario: String(product?.nivelInventario ?? '').trim(),
        raw: product
    };
}

async function fetchInventoryProducts() {
    const response = await fetch(INVENTORY_PRODUCTS_API_URL, {
        headers: {
            Accept: 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`No se pudo obtener el catálogo de productos (${response.status})`);
    }

    const payload = await response.json();
    const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];

    return items
        .map(normalizeInventoryProduct)
        .filter((product) => product.id > 0 && (product.codigo || product.nombre));
}

function normalizeSaleDate(value) {
    const rawValue = String(value || '').trim();
    if (!rawValue) {
        return null;
    }

    const dateMatch = rawValue.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateMatch) {
        const [, yearText, monthText, dayText] = dateMatch;
        const year = Number(yearText);
        const month = Number(monthText);
        const day = Number(dayText);
        const parsed = new Date(year, month - 1, day, 0, 0, 0, 0);

        if (
            Number.isNaN(parsed.getTime()) ||
            parsed.getFullYear() !== year ||
            parsed.getMonth() !== month - 1 ||
            parsed.getDate() !== day
        ) {
            return null;
        }

        return `${yearText}-${monthText}-${dayText} 00:00:00`;
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hours = String(parsed.getHours()).padStart(2, '0');
    const minutes = String(parsed.getMinutes()).padStart(2, '0');
    const seconds = String(parsed.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

async function ensureSalesRewardColumns(executor = db) {
    if (!(await hasColumn('ventas', 'total_normal', executor))) {
        await executor.query(`ALTER TABLE ventas ADD COLUMN total_normal DECIMAL(10,2) NOT NULL DEFAULT 0`);
    }

    if (!(await hasColumn('ventas', 'descuento_aplicado', executor))) {
        await executor.query(`ALTER TABLE ventas ADD COLUMN descuento_aplicado DECIMAL(10,2) NOT NULL DEFAULT 0`);
    }

    if (!(await hasColumn('ventas', 'premio_id', executor))) {
        await executor.query(`ALTER TABLE ventas ADD COLUMN premio_id INT NULL`);
    }

    if (!(await hasColumn('ventas', 'codigo_cupon', executor))) {
        await executor.query(`ALTER TABLE ventas ADD COLUMN codigo_cupon VARCHAR(40) NULL`);
    }

    if (!(await hasIndex('ventas', 'idx_ventas_premio_id', executor))) {
        await executor.query(`ALTER TABLE ventas ADD INDEX idx_ventas_premio_id (premio_id)`);
    }
}

async function ensureSaleItemsTable(executor = db) {
    await executor.query(`
        CREATE TABLE IF NOT EXISTS venta_detalle (
            id INT AUTO_INCREMENT PRIMARY KEY,
            venta_id INT NOT NULL,
            producto_id INT NOT NULL,
            codigo_producto VARCHAR(100) NOT NULL,
            nombre_producto VARCHAR(255) NOT NULL,
            cantidad INT NOT NULL,
            precio_unitario DECIMAL(10,2) NOT NULL,
            subtotal DECIMAL(10,2) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            KEY idx_venta_detalle_venta_id (venta_id),
            KEY idx_venta_detalle_producto_id (producto_id),
            KEY idx_venta_detalle_codigo_producto (codigo_producto),
            CONSTRAINT fk_venta_detalle_venta
                FOREIGN KEY (venta_id) REFERENCES ventas(id)
                ON UPDATE RESTRICT
                ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
}

exports.getClients = async () => {
    await ensureLoyaltyInfrastructure();
    const hasClientesTable = await hasTable('clientes');

    if (hasClientesTable) {
        const columns = await getTableColumns('clientes');

        const idColumn = columns.find((column) => ['cliente_id', 'id_cliente', 'id'].includes(column));
        const codigoColumn = columns.find((column) => ['codigo_cliente', 'codigo', 'cod_cliente'].includes(column));
        const activeColumn = columns.find((column) => ['activo', 'active', 'estado'].includes(column));
        const activeFilter = activeColumn ? `AND \`${activeColumn}\` <> 0` : '';

        if (codigoColumn) {
            const sql = `
                SELECT
                    *,
                    \`${codigoColumn}\` AS codigo_cliente
                FROM clientes
                WHERE \`${codigoColumn}\` IS NOT NULL
                  AND \`${codigoColumn}\` <> ''
                  ${activeFilter}
                ORDER BY \`${codigoColumn}\` ASC
            `;

            const [rowsFromClientes] = await db.execute(sql);
            if (rowsFromClientes.length > 0) {
                return rowsFromClientes;
            }
        }

        if (idColumn) {
            const sql = `
                SELECT
                    *,
                    CAST(\`${idColumn}\` AS CHAR) AS codigo_cliente,
                    \`${idColumn}\` AS cliente_id
                FROM clientes
                WHERE \`${idColumn}\` IS NOT NULL
                  ${activeFilter}
                ORDER BY \`${idColumn}\` ASC
            `;

            const [rowsFromClientes] = await db.execute(sql);
            if (rowsFromClientes.length > 0) {
                return rowsFromClientes;
            }
        }
    }

    const hasCodigoCliente = await hasColumn('ventas', 'codigo_cliente');
    const hasClienteId = await hasColumn('ventas', 'cliente_id');

    const sql = hasCodigoCliente
        ? `
            SELECT DISTINCT
                codigo_cliente
            FROM ventas
            WHERE codigo_cliente IS NOT NULL
              AND codigo_cliente <> ''
            ORDER BY codigo_cliente ASC
        `
        : hasClienteId
            ? `
                SELECT DISTINCT
                    CAST(cliente_id AS CHAR) AS codigo_cliente,
                    cliente_id
                FROM ventas
                WHERE cliente_id IS NOT NULL
                ORDER BY cliente_id ASC
            `
            : `SELECT '' AS codigo_cliente WHERE 1 = 0`;

    const [rows] = await db.execute(sql);
    // Ensure vendors with zero sales are included: merge with full vendor list
    let allVendors = [];
    try {
        const vendorsList = await exports.getVendedores();
        allVendors = (vendorsList || []).map((v) => String(v.vendedor || '').trim()).filter(Boolean);
    } catch (err) {
        allVendors = [];
    }

    const salesMap = new Map((rows || []).map((r) => [String(r.vendedor), r]));

    const merged = (allVendors.length > 0 ? allVendors : Array.from(new Set((rows || []).map(r => String(r.vendedor))))).map((vendorName) => {
        const r = salesMap.get(vendorName) || {};
        return {
            vendedor: vendorName,
            total_ventas: Number(r.total_ventas || 0),
            cantidad_ventas: Number(r.cantidad_ventas || 0),
            promedio_venta: r.promedio_venta === null || r.promedio_venta === undefined ? null : Number(r.promedio_venta)
        };
    });

    // If no explicit vendor list, also include any vendors found in rows
    if (merged.length === 0 && rows && rows.length > 0) {
        merged.push(...rows.map((r) => ({
            vendedor: r.vendedor,
            total_ventas: Number(r.total_ventas || 0),
            cantidad_ventas: Number(r.cantidad_ventas || 0),
            promedio_venta: r.promedio_venta === null || r.promedio_venta === undefined ? null : Number(r.promedio_venta)
        })));
    }

    // Sort by total desc
    merged.sort((a, b) => Number(b.total_ventas || 0) - Number(a.total_ventas || 0));

    return merged;
};

function findColumn(columns, candidates) {
    return columns.find((column) => candidates.includes(column));
}

function buildClientCodeCandidate() {
    const timestampPart = Date.now().toString(36).toUpperCase();
    const randomPart = Math.floor(Math.random() * 1679616)
        .toString(36)
        .toUpperCase()
        .padStart(4, '0');

    return `CLI-${timestampPart}-${randomPart}`;
}

async function generateUniqueClientCode(codeColumn, maxAttempts = 12) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const candidate = buildClientCodeCandidate();
        const sql = `
            SELECT 1
            FROM clientes
            WHERE \`${codeColumn}\` = ?
            LIMIT 1
        `;

        const [rows] = await db.execute(sql, [candidate]);
        if (rows.length === 0) {
            return candidate;
        }
    }

    throw new Error('No se pudo generar un código de cliente único');
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

async function ensureClientLoyaltyColumn(executor = db) {
    const clientesTableExists = await hasTable('clientes', executor);
    if (!clientesTableExists) {
        return;
    }

    const hasPointsColumn = await hasColumn('clientes', 'puntos_acumulados', executor);
    if (!hasPointsColumn) {
        await executor.query(`
            ALTER TABLE clientes
            ADD COLUMN puntos_acumulados INT NOT NULL DEFAULT 0
        `);
    }
}

async function ensureClientActiveColumn(executor = db) {
    const clientesTableExists = await hasTable('clientes', executor);
    if (!clientesTableExists) {
        return;
    }

    const hasActiveColumn = await hasColumn('clientes', 'activo', executor);
    if (!hasActiveColumn) {
        await executor.query(`
            ALTER TABLE clientes
            ADD COLUMN activo TINYINT(1) NOT NULL DEFAULT 1
        `);
    }
}

async function ensureLoyaltyConfigTable(executor = db) {
    await executor.query(`
        CREATE TABLE IF NOT EXISTS configuracion_fidelizacion (
            id INT NOT NULL PRIMARY KEY,
            monto_por_punto DECIMAL(10,2) NOT NULL DEFAULT 10.00,
            puntos_por_bloque INT NOT NULL DEFAULT 1,
            fecha_actualizacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
    `);

    await executor.query(`
        INSERT INTO configuracion_fidelizacion (id, monto_por_punto, puntos_por_bloque)
        VALUES (1, ${DEFAULT_POINTS_PER_AMOUNT.toFixed(2)}, ${DEFAULT_POINTS_AWARDED})
        ON DUPLICATE KEY UPDATE id = id
    `);
}

async function ensurePointsLogTable(executor = db) {
    await executor.query(`
        CREATE TABLE IF NOT EXISTS puntos_cliente_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            cliente_id INT NULL,
            codigo_cliente VARCHAR(100) NOT NULL,
            factura_id INT NOT NULL,
            puntos_obtenidos INT NOT NULL,
            total_compra DECIMAL(10,2) NOT NULL,
            monto_por_punto DECIMAL(10,2) NOT NULL,
            puntos_por_bloque INT NOT NULL,
            tipo_evento VARCHAR(60) NOT NULL DEFAULT 'PUNTOS_OBTENIDOS',
            fecha_registro DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_puntos_cliente_id (cliente_id),
            INDEX idx_puntos_codigo_cliente (codigo_cliente),
            INDEX idx_puntos_factura_id (factura_id)
        )
    `);
}

async function ensureLoyaltyInfrastructure(executor = db) {
    await ensureClientLoyaltyColumn(executor);
    await ensureClientActiveColumn(executor);
    await ensureLoyaltyConfigTable(executor);
    await ensurePointsLogTable(executor);
}

function normalizeLoyaltyConfig(row) {
    return {
        monto_por_punto: Number(row?.monto_por_punto || DEFAULT_POINTS_PER_AMOUNT),
        puntos_por_bloque: Number(row?.puntos_por_bloque || DEFAULT_POINTS_AWARDED),
        fecha_actualizacion: row?.fecha_actualizacion || null
    };
}

async function getLoyaltyConfigRecord(executor = db) {
    await ensureLoyaltyInfrastructure(executor);

    const [rows] = await executor.execute(`
        SELECT monto_por_punto, puntos_por_bloque, fecha_actualizacion
        FROM configuracion_fidelizacion
        WHERE id = 1
        LIMIT 1
    `);

    return normalizeLoyaltyConfig(rows[0] || {});
}

function calculateEarnedPoints(total, config) {
    const purchaseTotal = Number(total || 0);
    const amountPerPoint = Number(config?.monto_por_punto || 0);
    const awardedPerBlock = Number(config?.puntos_por_bloque || 0);

    if (!Number.isFinite(purchaseTotal) || purchaseTotal <= 0) {
        return 0;
    }

    if (!Number.isFinite(amountPerPoint) || amountPerPoint <= 0) {
        return 0;
    }

    if (!Number.isFinite(awardedPerBlock) || awardedPerBlock <= 0) {
        return 0;
    }

    return Math.floor(purchaseTotal / amountPerPoint) * awardedPerBlock;
}

async function resolveClientForSale(data, executor = db) {
    const columns = await getTableColumns('clientes', executor);
    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);

    if (!idColumn && !codeColumn) {
        throw new Error('No se encontró columna de identificación en clientes');
    }

    const clienteId = data.cliente_id === undefined || data.cliente_id === null || data.cliente_id === ''
        ? NaN
        : Number(data.cliente_id);
    const codigoCliente = String(data.codigo_cliente || '').trim();

    let filter;
    if (Number.isInteger(clienteId) && clienteId > 0 && idColumn) {
        filter = {
            whereSql: `\`${idColumn}\` = ?`,
            whereParams: [clienteId]
        };
    } else if (codigoCliente) {
        filter = buildClientReferenceFilter(codigoCliente, idColumn, codeColumn);
    } else {
        throw new Error('Debe enviar una referencia válida del cliente');
    }

    const selectColumns = [];
    if (idColumn) selectColumns.push(`\`${idColumn}\` AS cliente_id`);
    if (codeColumn) selectColumns.push(`\`${codeColumn}\` AS codigo_cliente`);
    selectColumns.push('COALESCE(puntos_acumulados, 0) AS puntos_acumulados');

    const [rows] = await executor.execute(
        `
            SELECT ${selectColumns.join(', ')}
            FROM clientes
            WHERE ${filter.whereSql}
            LIMIT 1
        `,
        filter.whereParams
    );

    if (rows.length === 0) {
        throw new Error('Cliente no encontrado');
    }

    return {
        clienteId: rows[0].cliente_id ?? null,
        codigoCliente: rows[0].codigo_cliente ?? codigoCliente,
        puntosAcumulados: Number(rows[0].puntos_acumulados || 0),
        idColumn,
        codeColumn
    };
}

async function getClientPointsHistory(detail, executor = db) {
    await ensureLoyaltyInfrastructure(executor);

    const clientId = detail?.cliente_id ?? detail?.id ?? null;
    const codigoCliente = String(detail?.codigo_cliente ?? detail?.codigo ?? detail?.cod_cliente ?? '').trim();

    let whereSql = '';
    let params = [];

    if (Number.isInteger(Number(clientId)) && Number(clientId) > 0) {
        whereSql = 'cliente_id = ?';
        params = [Number(clientId)];
    } else if (codigoCliente) {
        whereSql = 'codigo_cliente = ?';
        params = [codigoCliente];
    } else {
        return [];
    }

    const [rows] = await executor.execute(
        `
            SELECT
                id,
                tipo_evento,
                factura_id,
                puntos_obtenidos,
                total_compra,
                monto_por_punto,
                puntos_por_bloque,
                fecha_registro
            FROM puntos_cliente_log
            WHERE ${whereSql}
            ORDER BY fecha_registro DESC
            LIMIT 20
        `,
        params
    );

    return rows;
}

exports.searchClients = async (rawQuery, limit = 20) => {
    await ensureLoyaltyInfrastructure();
    const query = String(rawQuery || '').trim();
    if (!query) {
        return [];
    }

    const maxLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
    const columns = await getTableColumns('clientes');

    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);
    const nameColumn = findColumn(columns, ['nombre', 'nombres', 'nombre_cliente', 'razon_social']);
    const emailColumn = findColumn(columns, ['correo', 'email', 'mail', 'correo_electronico']);
    const phoneColumn = findColumn(columns, ['numero', 'telefono', 'celular', 'telefono_movil', 'telefono1']);
    const addressColumn = findColumn(columns, ['direccion', 'domicilio', 'direccion_fiscal']);
    const nitColumn = findColumn(columns, ['nit', 'nit_cliente', 'ruc', 'tax_id']);
    const pointsColumn = findColumn(columns, ['puntos_acumulados']);
    const activeColumn = findColumn(columns, ['activo', 'active', 'estado']);

    const whereClauses = [];
    const params = [];

    if (nameColumn) {
        whereClauses.push(`\`${nameColumn}\` LIKE ?`);
        params.push(`%${query}%`);
    }

    if (emailColumn) {
        whereClauses.push(`\`${emailColumn}\` LIKE ?`);
        params.push(`%${query}%`);
    }

    if (phoneColumn) {
        whereClauses.push(`CAST(\`${phoneColumn}\` AS CHAR) LIKE ?`);
        params.push(`%${query}%`);
    }

    if (nitColumn) {
        whereClauses.push(`CAST(\`${nitColumn}\` AS CHAR) LIKE ?`);
        params.push(`%${query}%`);
    }

    if (whereClauses.length === 0) {
        return [];
    }

    const selectColumns = [];
    if (idColumn) selectColumns.push(`\`${idColumn}\` AS cliente_id`);
    if (codeColumn) selectColumns.push(`\`${codeColumn}\` AS codigo_cliente`);
    if (nameColumn) selectColumns.push(`\`${nameColumn}\` AS nombre`);
    if (emailColumn) selectColumns.push(`\`${emailColumn}\` AS correo`);
    if (phoneColumn) selectColumns.push(`\`${phoneColumn}\` AS numero`);
    if (addressColumn) selectColumns.push(`\`${addressColumn}\` AS direccion`);
    if (nitColumn) selectColumns.push(`\`${nitColumn}\` AS nit`);
    if (pointsColumn) selectColumns.push(`\`${pointsColumn}\` AS puntos_acumulados`);

    if (selectColumns.length === 0) {
        return [];
    }

    let orderBy = '1 ASC';
    if (nameColumn) {
        orderBy = 'nombre ASC';
    } else if (codeColumn) {
        orderBy = 'codigo_cliente ASC';
    }

    const sql = `
        SELECT
            ${selectColumns.join(',\n            ')}
        FROM clientes
        WHERE (${whereClauses.join(' OR ')})
          ${activeColumn ? `AND \`${activeColumn}\` <> 0` : ''}
        ORDER BY ${orderBy}
        LIMIT ${maxLimit}
    `;

    const [rows] = await db.query(sql, params);
    return rows;
};

exports.getClientDetail = async (clientRef) => {
    const ref = String(clientRef || '').trim();
    if (!ref) {
        throw new Error('Referencia de cliente inválida');
    }

    await ensureLoyaltyInfrastructure();

    const hasClientesTable = await hasTable('clientes');
    if (hasClientesTable) {
        const columns = await getTableColumns('clientes');
        const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
        const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);
        const nameColumn = findColumn(columns, ['nombre', 'nombres', 'nombre_cliente', 'razon_social']);
        const emailColumn = findColumn(columns, ['correo', 'email', 'mail', 'correo_electronico']);
        const phoneColumn = findColumn(columns, ['numero', 'telefono', 'celular', 'telefono_movil', 'telefono1']);
        const addressColumn = findColumn(columns, ['direccion', 'domicilio', 'direccion_fiscal']);
        const nitColumn = findColumn(columns, ['nit', 'nit_cliente', 'ruc', 'tax_id']);
        const pointsColumn = findColumn(columns, ['puntos_acumulados']);
        const activeColumn = findColumn(columns, ['activo', 'active', 'estado']);

        const whereParts = [];
        const params = [];

        if (idColumn && /^\d+$/.test(ref)) {
            whereParts.push(`\`${idColumn}\` = ?`);
            params.push(Number(ref));
        }

        if (codeColumn) {
            whereParts.push(`\`${codeColumn}\` = ?`);
            params.push(ref);
        }

        if (whereParts.length === 0) {
            throw new Error('Cliente no encontrado');
        }

        const selectColumns = [];
        if (idColumn) selectColumns.push(`\`${idColumn}\` AS cliente_id`);
        if (codeColumn) selectColumns.push(`\`${codeColumn}\` AS codigo_cliente`);
        if (nameColumn) selectColumns.push(`\`${nameColumn}\` AS nombre`);
        if (emailColumn) selectColumns.push(`\`${emailColumn}\` AS correo`);
        if (phoneColumn) selectColumns.push(`\`${phoneColumn}\` AS numero`);
        if (addressColumn) selectColumns.push(`\`${addressColumn}\` AS direccion`);
        if (nitColumn) selectColumns.push(`\`${nitColumn}\` AS nit`);
        if (pointsColumn) selectColumns.push(`\`${pointsColumn}\` AS puntos_acumulados`);

        const [rows] = await db.execute(
            `
                SELECT ${selectColumns.join(', ')}
                FROM clientes
                WHERE (${whereParts.join(' OR ')})
                  ${activeColumn ? `AND \`${activeColumn}\` <> 0` : ''}
                LIMIT 1
            `,
            params
        );

        if (rows.length > 0) {
            return rows[0];
        }
    }

    const clients = await exports.getClients();
    const normalizedRef = ref.toLowerCase();
    const match = (clients || []).find((client) => {
        const clientId = String(client?.cliente_id ?? '').trim();
        const code = String(client?.codigo_cliente ?? '').trim();
        return clientId === ref || code.toLowerCase() === normalizedRef;
    });

    if (!match) {
        throw new Error('Cliente no encontrado');
    }

    return match;
};

function normalizeSaleLineItems(items) {
    if (!Array.isArray(items)) {
        return [];
    }

    return items
        .map((item) => {
            const quantity = Number(item?.cantidad ?? item?.quantity ?? 0);
            const productId = Number(item?.producto_id ?? item?.product_id ?? item?.id ?? 0);
            const codigo = String(item?.codigo_producto ?? item?.codigo ?? '').trim();
            const nombre = String(item?.nombre_producto ?? item?.nombre ?? '').trim();
            const price = Number(item?.precio_unitario ?? item?.unit_price ?? item?.precioVenta ?? 0);

            return {
                productId: Number.isFinite(productId) ? productId : 0,
                codigo,
                nombre,
                quantity: Number.isFinite(quantity) ? Math.trunc(quantity) : 0,
                unitPrice: Number.isFinite(price) ? Number(price.toFixed(2)) : 0
            };
        })
        .filter((item) => item.productId > 0 || item.codigo || item.nombre)
        .filter((item) => item.quantity > 0);
}

exports.create = async (data) => {
    if (!data.vendedor || !data.vendedor.trim()) {
        throw new Error('El vendedor es obligatorio');
    }

    const rawSaleItems = Array.isArray(data.items) && data.items.length > 0
        ? data.items
        : Array.isArray(data.productos)
            ? data.productos
            : [];
    const saleItemsInput = normalizeSaleLineItems(rawSaleItems);
    const hasSaleItems = saleItemsInput.length > 0;
    const initialTotal = Number(data.total);
    if (!hasSaleItems && (!Number.isFinite(initialTotal) || initialTotal <= 0)) {
        throw new Error('El total debe ser mayor que 0');
    }

    const estado = data.estado && data.estado.trim()
        ? data.estado.trim().toUpperCase()
        : 'CONFIRMADA';
    const saleDate = data.fecha || data.sale_date || data.fecha_venta
        ? normalizeSaleDate(data.fecha || data.sale_date || data.fecha_venta)
        : null;
    const rewardId = data.reward_id ? Number(data.reward_id) : null;
    const hasCodigoCliente = await hasColumn('ventas', 'codigo_cliente');
    const hasClienteId = await hasColumn('ventas', 'cliente_id');

    if (hasCodigoCliente && (!data.codigo_cliente || !String(data.codigo_cliente).trim())) {
        throw new Error('El codigo_cliente es obligatorio');
    }

    if ((data.fecha || data.sale_date || data.fecha_venta) && !saleDate) {
        throw new Error('La fecha de venta no es válida');
    }

    await ensureLoyaltyInfrastructure();
    await ensureSalesRewardColumns();
    if (hasSaleItems) {
        await ensureSaleItemsTable();
    }

    const loyaltyConfig = await getLoyaltyConfigRecord();
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const resolvedClient = await resolveClientForSale(data, connection);
        const codigoCliente = resolvedClient.codigoCliente ? String(resolvedClient.codigoCliente).trim() : '';

        let saleItems = [];
        let saleBaseTotal = hasSaleItems ? 0 : initialTotal;

        if (hasSaleItems) {
            const inventoryProducts = await fetchInventoryProducts();
            const productById = new Map(inventoryProducts.map((product) => [Number(product.id), product]));
            const productByCode = new Map(inventoryProducts.map((product) => [String(product.codigo || '').trim(), product]));

            saleItems = saleItemsInput.map((item) => {
                const product = item.productId > 0
                    ? productById.get(item.productId)
                    : null;
                const matchedProduct = product || (item.codigo ? productByCode.get(item.codigo) : null) || (item.nombre ? inventoryProducts.find((catalogItem) => String(catalogItem.nombre || '').trim().toLowerCase() === item.nombre.toLowerCase()) : null);

                if (!matchedProduct) {
                    throw new Error(`No se encontró el producto ${item.codigo || item.nombre || item.productId}`);
                }

                if (!matchedProduct.estado) {
                    throw new Error(`El producto ${matchedProduct.nombre || matchedProduct.codigo} no está activo`);
                }

                if (Number.isFinite(matchedProduct.stockActual) && item.quantity > matchedProduct.stockActual) {
                    throw new Error(`Stock insuficiente para ${matchedProduct.nombre || matchedProduct.codigo}`);
                }

                const unitPrice = Number(matchedProduct.precioVenta || item.unitPrice || 0);
                const subtotal = Number((unitPrice * item.quantity).toFixed(2));
                saleBaseTotal += subtotal;

                return {
                    productId: matchedProduct.id,
                    codigo: matchedProduct.codigo,
                    nombre: matchedProduct.nombre,
                    quantity: item.quantity,
                    unitPrice,
                    subtotal
                };
            });

            if (saleItems.length === 0) {
                throw new Error('Debes ingresar al menos un producto para la venta');
            }

            saleBaseTotal = Number(saleBaseTotal.toFixed(2));
        }

        let rewardRecord = null;
        let discountAmount = 0;
        let couponCode = null;
        let rewardCost = 0;
        let rewardInvoice = null;

        if (Number.isInteger(rewardId) && rewardId > 0) {
            const [rewardRows] = await connection.execute(
                `
                    SELECT id, nombre, descripcion, costo_puntos, activo, tipo_descuento, valor_descuento
                    FROM premios
                    WHERE id = ?
                    LIMIT 1
                `,
                [rewardId]
            );

            if (rewardRows.length === 0) {
                throw new Error('Premio seleccionado no encontrado');
            }

            rewardRecord = rewardRows[0];
            if (Number(rewardRecord.activo) !== 1) {
                throw new Error('El premio seleccionado no está disponible');
            }

            rewardCost = Number(rewardRecord.costo_puntos || 0);
            if (!Number.isFinite(rewardCost) || rewardCost <= 0) {
                throw new Error('El premio seleccionado no tiene un costo válido');
            }

            if (resolvedClient.puntosAcumulados < rewardCost) {
                throw new Error('Saldo insuficiente para canjear este premio');
            }

            const totalValue = Number(saleBaseTotal);
            let discountValue = Number(rewardRecord.valor_descuento || 0);
            if (rewardRecord.tipo_descuento === 'PORCENTAJE') {
                if (discountValue > 0 && discountValue <= 1) {
                    // Si se guardó como fracción (0.05), normalizamos a porcentaje real (5)
                    discountValue = discountValue * 100;
                }
                discountAmount = Number(((totalValue * discountValue) / 100).toFixed(2));
            } else {
                discountAmount = Number(discountValue.toFixed(2));
            }

            if (!Number.isFinite(discountAmount) || discountAmount < 0) {
                discountAmount = 0;
            }

            if (discountAmount > totalValue) {
                discountAmount = totalValue;
            }

            couponCode = buildCouponCode();
            rewardInvoice = {
                rewardId: rewardRecord.id,
                rewardLabel: String(rewardRecord.nombre || '').trim(),
                couponCode
            };
        }

        const totalNormal = Number(saleBaseTotal.toFixed(2));
        const finalTotal = Number(Math.max(0, totalNormal - discountAmount).toFixed(2));

        const insertColumns = [];
        const insertValues = [];
        const params = [];

        if (hasClienteId) {
            if (!Number.isInteger(Number(resolvedClient.clienteId)) || Number(resolvedClient.clienteId) <= 0) {
                throw new Error('El cliente_id es obligatorio y debe ser válido');
            }

            insertColumns.push('cliente_id');
            insertValues.push('?');
            params.push(Number(resolvedClient.clienteId));
        }

        if (hasCodigoCliente) {
            insertColumns.push('codigo_cliente');
            insertValues.push('?');
            params.push(codigoCliente);
        }

        insertColumns.push('fecha', 'total', 'estado', 'vendedor', 'total_normal', 'descuento_aplicado');
        if (saleDate) {
            insertValues.push('?', '?', '?', '?', '?', '?');
            params.push(saleDate, finalTotal, estado, data.vendedor.trim(), totalNormal, discountAmount);
        } else {
            insertValues.push('NOW()', '?', '?', '?', '?', '?');
            params.push(finalTotal, estado, data.vendedor.trim(), totalNormal, discountAmount);
        }

        if (rewardRecord) {
            insertColumns.push('premio_id', 'codigo_cupon');
            insertValues.push('?', '?');
            params.push(rewardRecord.id, couponCode);
        }

        const sql = `
            INSERT INTO ventas (${insertColumns.join(', ')})
            VALUES (${insertValues.join(', ')})
        `;

        const [result] = await connection.execute(sql, params);

        if (hasSaleItems) {
            for (const item of saleItems) {
                await connection.execute(
                    `
                        INSERT INTO venta_detalle (
                            venta_id,
                            producto_id,
                            codigo_producto,
                            nombre_producto,
                            cantidad,
                            precio_unitario,
                            subtotal
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        result.insertId,
                        item.productId,
                        item.codigo,
                        item.nombre,
                        item.quantity,
                        item.unitPrice,
                        item.subtotal
                    ]
                );
            }
        }

        if (rewardRecord) {
            await connection.execute(
                `
                    INSERT INTO canjes_premios (
                        cliente_id,
                        codigo_cliente,
                        premio_id,
                        factura_id,
                        puntos_canjeados,
                        codigo_cupon,
                        estado,
                        created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 'GENERADO', NOW())
                `,
                [
                    resolvedClient.clienteId ?? null,
                    codigoCliente,
                    rewardRecord.id,
                    result.insertId,
                    rewardCost,
                    couponCode
                ]
            );
        }

        const puntosObtenidos = estado.toUpperCase() === 'CONFIRMADA'
            ? calculateEarnedPoints(finalTotal, loyaltyConfig)
            : 0;

        let puntosActuales = Number(resolvedClient.puntosAcumulados || 0);
        if (rewardRecord) {
            puntosActuales -= rewardCost;
        }

        if (estado.toUpperCase() === 'CONFIRMADA') {
            if (puntosObtenidos > 0) {
                puntosActuales += puntosObtenidos;
            }

            await connection.execute(
                `
                    INSERT INTO puntos_cliente_log (
                        cliente_id,
                        codigo_cliente,
                        factura_id,
                        puntos_obtenidos,
                        total_compra,
                        monto_por_punto,
                        puntos_por_bloque,
                        tipo_evento,
                        fecha_registro
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'PUNTOS_OBTENIDOS', NOW())
                `,
                [
                    resolvedClient.clienteId ?? null,
                    codigoCliente,
                    result.insertId,
                    puntosObtenidos,
                    finalTotal,
                    loyaltyConfig.monto_por_punto,
                    loyaltyConfig.puntos_por_bloque
                ]
            );
        }

        await connection.execute(
            `
                UPDATE clientes
                SET puntos_acumulados = ?
                WHERE ${
                    resolvedClient.clienteId && resolvedClient.idColumn
                        ? `\`${resolvedClient.idColumn}\` = ?`
                        : `\`${resolvedClient.codeColumn}\` = ?`
                }
                LIMIT 1
            `,
            resolvedClient.clienteId && resolvedClient.idColumn
                ? [puntosActuales, Number(resolvedClient.clienteId)]
                : [puntosActuales, codigoCliente]
        );

        await connection.commit();

        return {
            message: 'Venta creada correctamente',
            id: result.insertId,
            total_normal: totalNormal,
            descuento_aplicado: discountAmount,
            total: finalTotal,
            items: saleItems,
            reward: rewardInvoice,
            loyalty: {
                puntos_obtenidos: puntosObtenidos,
                puntos_acumulados: puntosActuales,
                factura_id: result.insertId,
                monto_por_punto: loyaltyConfig.monto_por_punto,
                puntos_por_bloque: loyaltyConfig.puntos_por_bloque
            }
        };
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};


exports.getInventoryProducts = async (query = '') => {
    const products = await fetchInventoryProducts();
    const term = String(query || '').trim().toLowerCase();

    if (!term) {
        return products;
    }

    return products.filter((product) => {
        const fields = [
            product.codigo,
            product.nombre,
            product.descripcion,
            product.categoria,
            product.bodegaNombre
        ];

        return fields.some((field) => String(field || '').toLowerCase().includes(term));
    });
};

exports.getVendedores = async () => {
    const hasVendedor = await hasColumn('ventas', 'vendedor');
    
    if (!hasVendedor) {
        return [];
    }

    const sql = `
        SELECT DISTINCT vendedor
        FROM ventas
        WHERE vendedor IS NOT NULL
          AND vendedor <> ''
        ORDER BY vendedor ASC
    `;

    const [saleRows] = await db.execute(sql);

    const vendors = new Set((saleRows || []).map((row) => String(row.vendedor || '').trim()).filter(Boolean));

    const hasOpp = await hasTable('oportunidades_negocio');
    if (hasOpp) {
        const [oppRows] = await db.execute(
            `
                SELECT DISTINCT vendedor
                FROM oportunidades_negocio
                WHERE vendedor IS NOT NULL
                  AND vendedor <> ''
                ORDER BY vendedor ASC
            `
        );

        (oppRows || []).forEach((row) => {
            const name = String(row.vendedor || '').trim();
            if (name) vendors.add(name);
        });
    }

    // If the `usuarios` table exists, restrict the vendor list to users with rol='vendedor'.
    const hasUsuarios = await hasTable('usuarios');
    if (hasUsuarios) {
        const [userRows] = await db.execute(`SELECT nombre, correo, rol FROM usuarios WHERE rol = 'vendedor' AND activo = 1`);
        const allowed = new Set((userRows || []).flatMap((u) => [String(u.nombre || '').trim(), String(u.correo || '').trim()]).filter(Boolean));

        // Intersect vendors with allowed set
        const filtered = Array.from(vendors).filter((v) => allowed.has(v));

        return filtered
            .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
            .map((v) => ({ vendedor: v }));
    }

    return Array.from(vendors)
        .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
        .map((v) => ({ vendedor: v }));
};

exports.getReport = async (period, codigoCliente, vendedor) => {
    // Si no se especifica período, devolver todas las ventas individuales
    if (!period) {
        let sql = `
            SELECT
                id,
                fecha,
                total,
                estado,
                vendedor,
                codigo_cliente,
                cliente_id,
                fecha AS created_at
            FROM ventas
            WHERE estado = 'CONFIRMADA'
        `;

        const params = [];

        if (codigoCliente) {
            const hasCodigoCliente = await hasColumn('ventas', 'codigo_cliente');
            const hasClienteId = await hasColumn('ventas', 'cliente_id');

            if (hasCodigoCliente) {
                sql += " AND codigo_cliente = ?";
                params.push(codigoCliente);
            } else if (hasClienteId) {
                sql += " AND CAST(cliente_id AS CHAR) = ?";
                params.push(codigoCliente);
            } else {
                throw new Error('No existe columna para filtrar cliente en tabla ventas');
            }
        }

        if (vendedor) {
            sql += " AND vendedor = ?";
            params.push(vendedor);
        }

        sql += " ORDER BY fecha DESC";

        const [rows] = await db.execute(sql, params);
        return rows;
    }

    // Código existente para reportes agrupados por período
    let groupBy;

    switch (period) {
        case 'day':
        case 'daily':
            groupBy = "DATE(fecha)";
            break;
        case 'week':
        case 'weekly':
            groupBy = "YEARWEEK(fecha, 1)";
            break;
        case 'month':
        case 'monthly':
            groupBy = "DATE_FORMAT(fecha, '%Y-%m')";
            break;
        case 'year':
        case 'yearly':
            groupBy = "YEAR(fecha)";
            break;
        default:
            throw new Error("Periodo inválido. Use daily, weekly, monthly, yearly o deje vacío para todas las ventas individuales");
    }

    let sql = `
        SELECT ${groupBy} as periodo,
               SUM(total) as total_ventas,
               COUNT(*) as cantidad_ventas
        FROM ventas
        WHERE estado = 'CONFIRMADA'
    `;

    const params = [];

    if (codigoCliente) {
        const hasCodigoCliente = await hasColumn('ventas', 'codigo_cliente');
        const hasClienteId = await hasColumn('ventas', 'cliente_id');

        if (hasCodigoCliente) {
            sql += " AND codigo_cliente = ?";
            params.push(codigoCliente);
        } else if (hasClienteId) {
            sql += " AND CAST(cliente_id AS CHAR) = ?";
            params.push(codigoCliente);
        } else {
            throw new Error('No existe columna para filtrar cliente en tabla ventas');
        }
        }

    if (vendedor) {
        sql += " AND vendedor = ?";
        params.push(vendedor);
    }

    sql += `
        GROUP BY periodo
        ORDER BY periodo ASC
    `;

    const [rows] = await db.execute(sql, params);
    return rows;
};

exports.getVendedoresRendimiento = async (period) => {
    let groupBy;
    let dateFilter = '';

    switch (period) {
        case 'day':
            dateFilter = "AND DATE(fecha) = CURDATE()";
            groupBy = "DATE(fecha)";
            break;
        case 'week':
            dateFilter = "AND YEARWEEK(fecha, 1) = YEARWEEK(CURDATE(), 1)";
            groupBy = "YEARWEEK(fecha, 1)";
            break;
        case 'month':
            dateFilter = "AND DATE_FORMAT(fecha, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
            groupBy = "DATE_FORMAT(fecha, '%Y-%m')";
            break;
        case 'year':
            dateFilter = "AND DATE_FORMAT(fecha, '%Y') = DATE_FORMAT(CURDATE(), '%Y')";
            groupBy = "DATE_FORMAT(fecha, '%Y')";
            break;
        default:
            groupBy = "DATE_FORMAT(fecha, '%Y-%m')";
            dateFilter = "AND DATE_FORMAT(fecha, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')";
    }

    const sql = `
        SELECT 
            vendedor,
            SUM(total) as total_ventas,
            COUNT(*) as cantidad_ventas,
            AVG(total) as promedio_venta
        FROM ventas
                WHERE UPPER(TRIM(estado)) = 'CONFIRMADA'
          AND vendedor IS NOT NULL
          AND vendedor <> ''
          ${dateFilter}
        GROUP BY vendedor
        ORDER BY total_ventas DESC
    `;

    const [rows] = await db.execute(sql);
    return rows;
};

function isValidMonth(value) {
    return /^\d{4}-\d{2}$/.test(String(value || '').trim());
}

function formatMysqlDateUtc(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function addUtcMonths(date, months) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0));
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
}

function addLocalMonths(date, months) {
    const d = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
    d.setMonth(d.getMonth() + months);
    return d;
}

function getUtcMonthStart(month) {
    const [year, mon] = String(month).split('-').map((part) => Number(part));
    return new Date(Date.UTC(year, mon - 1, 1, 0, 0, 0));
}

function getCurrentMonthStringUtc() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const mon = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `${year}-${mon}`;
}

// Local-time helpers: use server local timezone to compute month boundaries
function formatMysqlDateLocal(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getLocalMonthStart(month) {
    const [year, mon] = String(month).split('-').map((part) => Number(part));
    return new Date(year, mon - 1, 1, 0, 0, 0);
}

function getCurrentMonthStringLocal() {
    const now = new Date();
    const year = now.getFullYear();
    const mon = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${mon}`;
}

exports.getSalesKpis = async ({ month, vendedor } = {}) => {
    const targetMonth = isValidMonth(month) ? String(month).trim() : getCurrentMonthStringLocal();
    const vendorFilter = String(vendedor || '').trim();

    const monthStart = getLocalMonthStart(targetMonth);
    const nextMonthStart = addLocalMonths(monthStart, 1);
    const prevMonthStart = addLocalMonths(monthStart, -1);

    const monthStartSql = formatMysqlDateLocal(monthStart);
    const nextMonthStartSql = formatMysqlDateLocal(nextMonthStart);
    const prevMonthStartSql = formatMysqlDateLocal(prevMonthStart);

    const prevMonthString = `${prevMonthStart.getFullYear()}-${String(prevMonthStart.getMonth() + 1).padStart(2, '0')}`;

    const selectParams = [
        monthStartSql,
        nextMonthStartSql,
        monthStartSql,
        nextMonthStartSql,
        monthStartSql,
        nextMonthStartSql,
        prevMonthStartSql,
        monthStartSql,
        prevMonthStartSql,
        monthStartSql,
        prevMonthStartSql,
        monthStartSql
    ];

    let vendorWhere = '';
    const whereParams = [prevMonthStartSql, nextMonthStartSql];
    if (vendorFilter) {
        vendorWhere = 'AND vendedor = ?';
        whereParams.push(vendorFilter);
    }

    // Ventas confirmadas para el mes objetivo y el mes anterior (comparativa).
    const [salesRows] = await db.execute(
        `
            SELECT
                vendedor,
                SUM(CASE WHEN fecha >= ? AND fecha < ? THEN total ELSE 0 END) AS total_ventas_mes,
                COUNT(CASE WHEN fecha >= ? AND fecha < ? THEN 1 END) AS cantidad_ventas_mes,
                AVG(CASE WHEN fecha >= ? AND fecha < ? THEN total END) AS promedio_cierre_mes,
                SUM(CASE WHEN fecha >= ? AND fecha < ? THEN total ELSE 0 END) AS total_ventas_mes_anterior,
                COUNT(CASE WHEN fecha >= ? AND fecha < ? THEN 1 END) AS cantidad_ventas_mes_anterior,
                AVG(CASE WHEN fecha >= ? AND fecha < ? THEN total END) AS promedio_cierre_mes_anterior
            FROM ventas
            WHERE estado = 'CONFIRMADA'
              AND vendedor IS NOT NULL
              AND vendedor <> ''
              AND fecha >= ?
              AND fecha < ?
              ${vendorWhere}
            GROUP BY vendedor
            ORDER BY total_ventas_mes DESC, vendedor ASC
        `,
        [...selectParams, ...whereParams]
    );

    // Conversión: oportunidades GANADAS / total oportunidades creadas en el mes.
    const hasOppTable = await hasTable('oportunidades_negocio');
    let oppMap = new Map();

    if (hasOppTable) {
        const oppParams = [
            monthStartSql,
            nextMonthStartSql,
            monthStartSql,
            nextMonthStartSql,
            prevMonthStartSql,
            monthStartSql,
            prevMonthStartSql,
            monthStartSql,
            prevMonthStartSql,
            nextMonthStartSql
        ];

        let oppVendorWhere = '';
        if (vendorFilter) {
            oppVendorWhere = 'AND vendedor = ?';
            oppParams.push(vendorFilter);
        }

        const [oppRows] = await db.execute(
            `
                SELECT
                    vendedor,
                    SUM(CASE WHEN fecha_creacion >= ? AND fecha_creacion < ? THEN 1 ELSE 0 END) AS oportunidades_mes,
                    SUM(CASE WHEN fecha_creacion >= ? AND fecha_creacion < ? AND UPPER(estado) = 'GANADA' THEN 1 ELSE 0 END) AS oportunidades_ganadas_mes,
                    SUM(CASE WHEN fecha_creacion >= ? AND fecha_creacion < ? THEN 1 ELSE 0 END) AS oportunidades_mes_anterior,
                    SUM(CASE WHEN fecha_creacion >= ? AND fecha_creacion < ? AND UPPER(estado) = 'GANADA' THEN 1 ELSE 0 END) AS oportunidades_ganadas_mes_anterior
                FROM oportunidades_negocio
                WHERE vendedor IS NOT NULL
                  AND vendedor <> ''
                  AND fecha_creacion >= ?
                  AND fecha_creacion < ?
                  ${oppVendorWhere}
                GROUP BY vendedor
            `,
            oppParams
        );

        oppMap = new Map(
            (oppRows || []).map((row) => [
                String(row.vendedor),
                {
                    oportunidades_mes: Number(row.oportunidades_mes || 0),
                    oportunidades_ganadas_mes: Number(row.oportunidades_ganadas_mes || 0),
                    oportunidades_mes_anterior: Number(row.oportunidades_mes_anterior || 0),
                    oportunidades_ganadas_mes_anterior: Number(row.oportunidades_ganadas_mes_anterior || 0)
                }
            ])
        );
    }

    const salesMap = new Map(
        (salesRows || []).map((row) => [String(row.vendedor), row])
    );

    const vendorNames = new Set([...
        Array.from(salesMap.keys()),
        ...Array.from(oppMap.keys())
    ].filter(Boolean));

    const items = Array.from(vendorNames).map((vendorName) => {
        const saleRow = salesMap.get(vendorName) || {};
        const totalActual = Number(saleRow.total_ventas_mes || 0);
        const totalAnterior = Number(saleRow.total_ventas_mes_anterior || 0);
        const pct = totalAnterior > 0
            ? ((totalActual - totalAnterior) / totalAnterior) * 100
            : null;

        const opp = oppMap.get(vendorName) || {
            oportunidades_mes: 0,
            oportunidades_ganadas_mes: 0,
            oportunidades_mes_anterior: 0,
            oportunidades_ganadas_mes_anterior: 0
        };

        const tasaConversion = opp.oportunidades_mes > 0
            ? opp.oportunidades_ganadas_mes / opp.oportunidades_mes
            : null;

        return {
            vendedor: vendorName,
            ventas: {
                total_mes: totalActual,
                cantidad_mes: Number(saleRow.cantidad_ventas_mes || 0),
                promedio_cierre_mes: saleRow.promedio_cierre_mes === null || saleRow.promedio_cierre_mes === undefined
                    ? null
                    : Number(saleRow.promedio_cierre_mes),
                total_mes_anterior: totalAnterior,
                cantidad_mes_anterior: Number(saleRow.cantidad_ventas_mes_anterior || 0),
                promedio_cierre_mes_anterior: saleRow.promedio_cierre_mes_anterior === null || saleRow.promedio_cierre_mes_anterior === undefined
                    ? null
                    : Number(saleRow.promedio_cierre_mes_anterior),
                variacion_pct_total: pct
            },
            conversion: {
                oportunidades_mes: opp.oportunidades_mes,
                ganadas_mes: opp.oportunidades_ganadas_mes,
                tasa_mes: tasaConversion
            }
        };
    });

    items.sort((a, b) => {
        const diff = Number(b?.ventas?.total_mes || 0) - Number(a?.ventas?.total_mes || 0);
        if (diff !== 0) return diff;
        return String(a?.vendedor || '').localeCompare(String(b?.vendedor || ''), 'es', { sensitivity: 'base' });
    });

    return {
        month: targetMonth,
        previous_month: prevMonthString,
        scope: vendorFilter ? 'vendedor' : 'equipo',
        vendedor: vendorFilter || null,
        items
    };
};

exports.getLoyaltyConfig = async () => {
    const config = await getLoyaltyConfigRecord();
    return {
        ...config,
        descripcion: `${config.puntos_por_bloque} punto(s) por cada Q${config.monto_por_punto}`
    };
};

exports.updateLoyaltyConfig = async (data) => {
    const montoPorPunto = Number(data.monto_por_punto);
    const puntosPorBloque = Number(data.puntos_por_bloque);

    if (!Number.isFinite(montoPorPunto) || montoPorPunto <= 0) {
        throw new Error('El monto por punto debe ser mayor que 0');
    }

    if (!Number.isInteger(puntosPorBloque) || puntosPorBloque <= 0) {
        throw new Error('Los puntos por bloque deben ser un entero mayor que 0');
    }

    await ensureLoyaltyInfrastructure();
    await db.execute(
        `
            UPDATE configuracion_fidelizacion
            SET monto_por_punto = ?, puntos_por_bloque = ?
            WHERE id = 1
        `,
        [montoPorPunto, puntosPorBloque]
    );

    return {
        message: 'Configuración de fidelización actualizada correctamente',
        ...(await exports.getLoyaltyConfig())
    };
};

exports.createClient = async (data) => {
    await ensureLoyaltyInfrastructure();

    const columns = await getTableColumns('clientes');
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);
    const nameColumn = findColumn(columns, ['nombre', 'nombres', 'nombre_cliente', 'razon_social']);
    const emailColumn = findColumn(columns, ['correo', 'email', 'mail', 'correo_electronico']);
    const phoneColumn = findColumn(columns, ['numero', 'telefono', 'celular', 'telefono_movil', 'telefono1']);
    const addressColumn = findColumn(columns, ['direccion', 'domicilio', 'direccion_fiscal']);
    const nitColumn = findColumn(columns, ['nit', 'nit_cliente', 'ruc', 'tax_id']);
    const activeColumn = findColumn(columns, ['activo', 'active', 'estado']);

    const nombre = String(data?.nombre || '').trim();
    const correo = String(data?.correo || '').trim();
    const numero = String(data?.numero || '').trim();
    const direccion = String(data?.direccion || '').trim();
    const nit = String(data?.nit || '').trim();

    if (!nombre && !correo && !numero && !direccion && !nit) {
        throw new Error('Ingresa al menos nombre, correo, número, dirección o NIT');
    }

    const insertColumns = [];
    const placeholders = [];
    const params = [];

    let codigoCliente = String(data?.codigo_cliente || data?.codigo || '').trim();
    if (codeColumn) {
        codigoCliente = codigoCliente || await generateUniqueClientCode(codeColumn);
        insertColumns.push(`\`${codeColumn}\``);
        placeholders.push('?');
        params.push(codigoCliente);
    }

    if (nameColumn) {
        insertColumns.push(`\`${nameColumn}\``);
        placeholders.push('?');
        params.push(nombre || null);
    }

    if (emailColumn) {
        insertColumns.push(`\`${emailColumn}\``);
        placeholders.push('?');
        params.push(correo || null);
    }

    if (phoneColumn) {
        insertColumns.push(`\`${phoneColumn}\``);
        placeholders.push('?');
        params.push(numero || null);
    }

    if (addressColumn) {
        insertColumns.push(`\`${addressColumn}\``);
        placeholders.push('?');
        params.push(direccion || null);
    }

    if (nitColumn) {
        insertColumns.push(`\`${nitColumn}\``);
        placeholders.push('?');
        params.push(nit || null);
    }

    if (activeColumn) {
        insertColumns.push(`\`${activeColumn}\``);
        placeholders.push('?');
        params.push(1);
    }

    if (insertColumns.length === 0) {
        throw new Error('No hay columnas válidas para crear el cliente');
    }

    const [result] = await db.execute(
        `
            INSERT INTO clientes (${insertColumns.join(', ')})
            VALUES (${placeholders.join(', ')})
        `,
        params
    );

    return {
        message: 'Cliente registrado correctamente',
        cliente_id: result.insertId || null,
        codigo_cliente: codigoCliente || null
    };
};

exports.updateClient = async (clientRef, data) => {
    const ref = String(clientRef || '').trim();
    if (!ref) {
        throw new Error('Debe enviar una referencia de cliente');
    }

    const columns = await getTableColumns('clientes');

    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);
    const nameColumn = findColumn(columns, ['nombre', 'nombres', 'nombre_cliente', 'razon_social']);
    const emailColumn = findColumn(columns, ['correo', 'email', 'mail', 'correo_electronico']);
    const phoneColumn = findColumn(columns, ['numero', 'telefono', 'celular', 'telefono_movil', 'telefono1']);
    const addressColumn = findColumn(columns, ['direccion', 'domicilio', 'direccion_fiscal']);
    const nitColumn = findColumn(columns, ['nit', 'nit_cliente', 'ruc', 'tax_id']);

    const updates = [];
    const params = [];

    if (nameColumn && Object.prototype.hasOwnProperty.call(data, 'nombre')) {
        updates.push(`\`${nameColumn}\` = ?`);
        params.push(String(data.nombre || '').trim());
    }

    if (emailColumn && Object.prototype.hasOwnProperty.call(data, 'correo')) {
        updates.push(`\`${emailColumn}\` = ?`);
        params.push(String(data.correo || '').trim());
    }

    if (phoneColumn && Object.prototype.hasOwnProperty.call(data, 'numero')) {
        updates.push(`\`${phoneColumn}\` = ?`);
        params.push(String(data.numero || '').trim());
    }

    if (addressColumn && Object.prototype.hasOwnProperty.call(data, 'direccion')) {
        updates.push(`\`${addressColumn}\` = ?`);
        params.push(String(data.direccion || '').trim());
    }

    if (nitColumn && Object.prototype.hasOwnProperty.call(data, 'nit')) {
        updates.push(`\`${nitColumn}\` = ?`);
        params.push(String(data.nit || '').trim());
    }

    if (updates.length === 0) {
        throw new Error('No hay campos válidos para actualizar');
    }

    const filter = buildClientReferenceFilter(ref, idColumn, codeColumn);
    const sql = `
        UPDATE clientes
        SET ${updates.join(', ')}
        WHERE ${filter.whereSql}
        LIMIT 1
    `;

    const [result] = await db.execute(sql, [...params, ...filter.whereParams]);
    if (result.affectedRows === 0) {
        throw new Error('Cliente no encontrado');
    }

    return { message: 'Cliente actualizado correctamente' };
};

exports.deleteClient = async (clientRef) => {
    const ref = String(clientRef || '').trim();
    if (!ref) {
        throw new Error('Debe enviar una referencia de cliente');
    }

    const columns = await getTableColumns('clientes');
    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);
    let activeColumn = findColumn(columns, ['activo', 'active', 'estado']);

    if (!activeColumn) {
        await ensureClientActiveColumn();
        activeColumn = 'activo';
    }

    const filter = buildClientReferenceFilter(ref, idColumn, codeColumn);
    const sql = `
        UPDATE clientes
        SET \`${activeColumn}\` = 0
        WHERE ${filter.whereSql}
          AND \`${activeColumn}\` <> 0
        LIMIT 1
    `;

    const [result] = await db.execute(sql, filter.whereParams);
    if (result.affectedRows === 0) {
        throw new Error('Cliente no encontrado');
    }

    return { message: 'Cliente eliminado correctamente' };
};

// Función para obtener las ventas confirmadas de un vendedor específico, con límite opcional.

exports.getSalesBySeller = async (vendedor, limit = 100) => {
    if (!vendedor || !vendedor.trim()) {
        throw new Error('El vendedor es obligatorio');
    }

    const maxLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 1000) : 100;

    const sql = `
        SELECT
            id,
            fecha,
            total,
            estado,
            vendedor,
            codigo_cliente,
            cliente_id
        FROM ventas
        WHERE vendedor = ?
          AND estado = 'CONFIRMADA'
        ORDER BY fecha DESC
        LIMIT ${maxLimit}
    `;

    const [rows] = await db.execute(sql, [vendedor.trim()]);
    return rows;
};

exports.getSaleDetail = async (saleId, currentUser = null) => {
    const id = Number(saleId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('El id de la venta no es válido');
    }

    const [salesRows] = await db.execute(
        `
            SELECT
                id,
                fecha,
                total,
                total_normal,
                descuento_aplicado,
                estado,
                vendedor,
                codigo_cliente,
                cliente_id,
                premio_id,
                codigo_cupon
            FROM ventas
            WHERE id = ?
            LIMIT 1
        `,
        [id]
    );

    if (salesRows.length === 0) {
        throw new Error('Venta no encontrada');
    }

    const sale = salesRows[0];
    if (currentUser?.rol === 'vendedor') {
        const currentVendor = String(currentUser.nombre || currentUser.correo || '').trim();
        const saleVendor = String(sale.vendedor || '').trim();
        if (!currentVendor || saleVendor !== currentVendor) {
            throw new Error('Venta no encontrada');
        }
    }

    let items = [];
    try {
        const [detailRows] = await db.execute(
            `
                SELECT
                    producto_id,
                    codigo_producto,
                    nombre_producto,
                    cantidad,
                    precio_unitario,
                    subtotal
                FROM venta_detalle
                WHERE venta_id = ?
                ORDER BY id ASC
            `,
            [id]
        );

        items = detailRows || [];
    } catch (error) {
        items = [];
    }

    return {
        ...sale,
        items
    };
};


