const db = require('../config/database');

let auditTableReady = null;

async function ensureAuditTable() {
    if (!auditTableReady) {
        auditTableReady = db.execute(`
            CREATE TABLE IF NOT EXISTS bitacoras_auditoria (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NULL,
                usuario_nombre VARCHAR(120) NULL,
                usuario_correo VARCHAR(190) NULL,
                rol VARCHAR(40) NULL,
                accion VARCHAR(190) NOT NULL,
                recurso VARCHAR(190) NOT NULL,
                metodo VARCHAR(10) NOT NULL,
                ruta VARCHAR(255) NOT NULL,
                estado_respuesta INT NOT NULL,
                ip VARCHAR(60) NULL,
                user_agent VARCHAR(255) NULL,
                detalles LONGTEXT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_bitacora_usuario_id (usuario_id),
                KEY idx_bitacora_rol (rol),
                KEY idx_bitacora_accion (accion),
                KEY idx_bitacora_metodo (metodo),
                KEY idx_bitacora_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        `);
    }

    await auditTableReady;
}

function normalizeLimit(value, fallback = 100) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric <= 0) {
        return fallback;
    }

    return Math.min(Math.max(numeric, 1), 500);
}

function serializeDetails(details) {
    if (details === null || details === undefined || details === '') {
        return null;
    }

    if (typeof details === 'string') {
        return details;
    }

    try {
        return JSON.stringify(details);
    } catch (error) {
        return String(details);
    }
}

function parseDetails(details) {
    if (!details) {
        return null;
    }

    if (typeof details !== 'string') {
        return details;
    }

    try {
        return JSON.parse(details);
    } catch (error) {
        return details;
    }
}

exports.recordAuditEvent = async (event) => {
    await ensureAuditTable();

    const sql = `
        INSERT INTO bitacoras_auditoria (
            usuario_id,
            usuario_nombre,
            usuario_correo,
            rol,
            accion,
            recurso,
            metodo,
            ruta,
            estado_respuesta,
            ip,
            user_agent,
            detalles,
            created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    await db.execute(sql, [
        Number.isInteger(Number(event?.usuario_id)) ? Number(event.usuario_id) : null,
        String(event?.usuario_nombre || '').trim() || null,
        String(event?.usuario_correo || '').trim() || null,
        String(event?.rol || '').trim() || null,
        String(event?.accion || 'SIN_ACCION').trim(),
        String(event?.recurso || '').trim() || '/',
        String(event?.metodo || '').trim().toUpperCase() || 'GET',
        String(event?.ruta || '').trim() || '/',
        Number.isInteger(Number(event?.estado_respuesta)) ? Number(event.estado_respuesta) : 200,
        String(event?.ip || '').trim() || null,
        String(event?.user_agent || '').trim() || null,
        serializeDetails(event?.detalles)
    ]);
};

exports.listAuditEvents = async ({ limit = 100 } = {}) => {
    await ensureAuditTable();

    const safeLimit = normalizeLimit(limit, 100);
    const [rows] = await db.execute(
        `
            SELECT
                id,
                usuario_id,
                usuario_nombre,
                usuario_correo,
                rol,
                accion,
                recurso,
                metodo,
                ruta,
                estado_respuesta,
                ip,
                user_agent,
                detalles,
                created_at
            FROM bitacoras_auditoria
            ORDER BY created_at DESC, id DESC
            LIMIT ${safeLimit}
        `
    );

    return rows.map((row) => ({
        ...row,
        detalles: parseDetails(row.detalles)
    }));
};

exports.ensureAuditTable = ensureAuditTable;