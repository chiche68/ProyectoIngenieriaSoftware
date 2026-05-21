const db = require('../config/database');

exports.create = async (data) => {

    if (!data.resumen || data.resumen.length < 20) {
        throw new Error("Resumen mínimo 20 caracteres");
    }

    if (!data.codigo_cliente && !data.cliente_id) {
        throw new Error("Se requiere cliente_id o codigo_cliente");
    }

    let clienteId = data.cliente_id;

    // Si recibimos codigo_cliente, buscamos el cliente_id correspondiente
    if (!clienteId && data.codigo_cliente) {
        const [clients] = await db.execute(
            'SELECT id FROM clientes WHERE codigo_cliente = ?',
            [data.codigo_cliente]
        );

        if (clients.length === 0) {
            throw new Error(`Cliente con código ${data.codigo_cliente} no encontrado`);
        }

        clienteId = clients[0].id;
    }

    const sql = `
        INSERT INTO interacciones_cliente
        (cliente_id, tipo, fecha, resumen, usuario)
        VALUES (?, ?, NOW(), ?, ?)
    `;

    const params = [
        clienteId,
        data.tipo,
        data.resumen,
        data.usuario
    ];

    const [result] = await db.execute(sql, params);

    return { message: "Interacción guardada", id: result.insertId };
};

exports.getByClient = async (codigoCliente) => {
    // Buscar el cliente_id a partir del codigo_cliente
    const [clients] = await db.execute(
        'SELECT id FROM clientes WHERE codigo_cliente = ?',
        [codigoCliente]
    );

    if (clients.length === 0) {
        return [];
    }

    const clienteId = clients[0].id;

    const sql = `
        SELECT * FROM interacciones_cliente
        WHERE cliente_id = ?
        ORDER BY fecha DESC
    `;

    const [rows] = await db.execute(sql, [clienteId]);
    return rows;
};

exports.getAll = async () => {
    const sql = `SELECT * FROM interacciones_cliente ORDER BY fecha DESC`;
    const [rows] = await db.execute(sql);
    return rows;
};

exports.delete = async (interactionId) => {
    const id = Number(interactionId);
    if (!Number.isInteger(id) || id <= 0) {
        throw new Error('Id de interacción inválido');
    }

    const [result] = await db.execute(
        `
            DELETE FROM interacciones_cliente
            WHERE id = ?
            LIMIT 1
        `,
        [id]
    );

    if (result.affectedRows === 0) {
        throw new Error('Interacción no encontrada');
    }

    return { message: 'Interacción eliminada correctamente' };
};
