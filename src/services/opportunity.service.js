const db = require('../config/database');

const OPPORTUNITY_STATES = ['ABIERTA', 'EN_PROCESO', 'NEGOCIACION', 'GANADA', 'PERDIDA'];

async function hasTable(tableName) {
    const sql = `
        SELECT 1
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
        LIMIT 1
    `;

    const [rows] = await db.execute(sql, [tableName]);
    return rows.length > 0;
}

async function getTableColumns(tableName) {
    const sql = `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
    `;

    const [rows] = await db.execute(sql, [tableName]);
    return rows.map((row) => row.COLUMN_NAME);
}

function findColumn(columns, candidates) {
    return columns.find((column) => candidates.includes(column));
}

async function ensureOpportunitiesTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS oportunidades_negocio (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre_oportunidad VARCHAR(255) NOT NULL,
            cliente_id INT NULL,
            codigo_cliente VARCHAR(100) NOT NULL,
            vendedor VARCHAR(120) NOT NULL,
            estado VARCHAR(40) NOT NULL DEFAULT 'ABIERTA',
            fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_oportunidad_cliente (codigo_cliente),
            INDEX idx_oportunidad_vendedor (vendedor),
            INDEX idx_oportunidad_fecha (fecha_creacion)
        )
    `;

    await db.execute(sql);
}

async function resolveClient(codigoCliente) {
    const ref = String(codigoCliente || '').trim();
    if (!ref) {
        throw new Error('Debe seleccionar un cliente');
    }

    const clientsTableExists = await hasTable('clientes');
    if (!clientsTableExists) {
        return {
            clienteId: null,
            codigoCliente: ref
        };
    }

    const columns = await getTableColumns('clientes');
    const idColumn = findColumn(columns, ['id', 'cliente_id', 'id_cliente']);
    const codeColumn = findColumn(columns, ['codigo_cliente', 'codigo', 'cod_cliente']);

    if (!codeColumn) {
        return {
            clienteId: null,
            codigoCliente: ref
        };
    }

    const selectId = idColumn ? `\`${idColumn}\` AS cliente_id,` : '';
    const sql = `
        SELECT ${selectId}
               \`${codeColumn}\` AS codigo_cliente
        FROM clientes
        WHERE \`${codeColumn}\` = ?
        LIMIT 1
    `;

    const [rows] = await db.execute(sql, [ref]);
    if (rows.length === 0) {
        throw new Error('El cliente seleccionado no existe');
    }

    return {
        clienteId: rows[0].cliente_id ?? null,
        codigoCliente: rows[0].codigo_cliente
    };
}

exports.createOpportunity = async (data) => {
    const nombreOportunidad = String(data.nombre_oportunidad || '').trim();
    const codigoCliente = String(data.codigo_cliente || '').trim();
    const vendedor = String(data.vendedor || '').trim();

    if (!nombreOportunidad) {
        throw new Error('El nombre de la oportunidad es obligatorio');
    }

    if (!codigoCliente) {
        throw new Error('Debe asociar la oportunidad a un cliente');
    }

    if (!vendedor) {
        throw new Error('Debe asignar un vendedor responsable');
    }

    await ensureOpportunitiesTable();

    const resolvedClient = await resolveClient(codigoCliente);

    const sql = `
        INSERT INTO oportunidades_negocio (
            nombre_oportunidad,
            cliente_id,
            codigo_cliente,
            vendedor,
            fecha_creacion,
            estado
        )
        VALUES (?, ?, ?, ?, NOW(), 'ABIERTA')
    `;

    const params = [
        nombreOportunidad,
        resolvedClient.clienteId,
        resolvedClient.codigoCliente,
        vendedor
    ];

    const [result] = await db.execute(sql, params);

    return {
        message: 'Oportunidad registrada correctamente',
        id: result.insertId
    };
};

exports.getOpportunities = async (codigoCliente = '', vendedor = '') => {
    await ensureOpportunitiesTable();

    const codigo = String(codigoCliente || '').trim();
    const vendedorFilter = String(vendedor || '').trim();

    const filters = [];
    const params = [];

    if (codigo) {
        filters.push('codigo_cliente = ?');
        params.push(codigo);
    }

    if (vendedorFilter) {
        filters.push('vendedor = ?');
        params.push(vendedorFilter);
    }

    const whereClause = filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : '';

    const sql = `
        SELECT
            id,
            nombre_oportunidad,
            cliente_id,
            codigo_cliente,
            vendedor,
            estado,
            fecha_creacion
        FROM oportunidades_negocio
        ${whereClause}
        ORDER BY fecha_creacion DESC
        LIMIT 100
    `;

    const [rows] = await db.execute(sql, params);
    return rows;
};

exports.updateOpportunityState = async (opportunityId, estado) => {
    await ensureOpportunitiesTable();

    const id = Number(opportunityId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Id de oportunidad inválido');
    }

    const nextState = String(estado || '').trim().toUpperCase();
    if (!OPPORTUNITY_STATES.includes(nextState)) {
        throw new Error(`Estado inválido. Estados permitidos: ${OPPORTUNITY_STATES.join(', ')}`);
    }

    const sql = `
        UPDATE oportunidades_negocio
        SET estado = ?
        WHERE id = ?
        LIMIT 1
    `;

    const [result] = await db.execute(sql, [nextState, id]);
    if (result.affectedRows === 0) {
        throw new Error('Oportunidad no encontrada');
    }

    return {
        message: 'Estado de oportunidad actualizado correctamente',
        id,
        estado: nextState
    };
};
