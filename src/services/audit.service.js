const db = require('../config/database');

let auditTableReady = null;

async function hasAuditColumn(columnName) {
    const [rows] = await db.execute(
        `
            SELECT 1
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'bitacoras_auditoria'
              AND COLUMN_NAME = ?
            LIMIT 1
        `,
        [columnName]
    );

    return rows.length > 0;
}

function normalizeCategory(value, fallback = 'GENERAL') {
    const text = String(value || '').trim();
    return (text || fallback).toUpperCase();
}

function inferCategoryFromRoute(route) {
    const routeText = String(route || '').toLowerCase();

    if (routeText.includes('/auth/login') || routeText.includes('auth/login')) {
        return 'LOGIN';
    }
    if (routeText.includes('/sales/clients') || routeText.includes('sales/clients')) {
        return 'CLIENTES';
    }
    if (routeText.includes('/sales')) {
        return 'VENTAS';
    }
    if (routeText.includes('/tickets')) {
        return 'TICKETS';
    }
    if (routeText.includes('/interactions')) {
        return 'INTERACCIONES';
    }
    if (routeText.includes('/opportunities')) {
        return 'OPORTUNIDADES';
    }
    if (routeText.includes('/rewards')) {
        return 'RECOMPENSAS';
    }
    if (routeText.includes('/users')) {
        return 'USUARIOS';
    }

    return 'GENERAL';
}

async function ensureAuditTable() {
    if (!auditTableReady) {
        auditTableReady = (async () => {
            await db.execute(`
            CREATE TABLE IF NOT EXISTS bitacoras_auditoria (
                id INT AUTO_INCREMENT PRIMARY KEY,
                usuario_id INT NULL,
                usuario_nombre VARCHAR(120) NULL,
                usuario_correo VARCHAR(190) NULL,
                rol VARCHAR(40) NULL,
                categoria VARCHAR(60) NOT NULL DEFAULT 'GENERAL',
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
                KEY idx_bitacora_categoria (categoria),
                KEY idx_bitacora_accion (accion),
                KEY idx_bitacora_metodo (metodo),
                KEY idx_bitacora_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
            `);

            if (!(await hasAuditColumn('categoria'))) {
                await db.execute(`
                    ALTER TABLE bitacoras_auditoria
                    ADD COLUMN categoria VARCHAR(60) NOT NULL DEFAULT 'GENERAL' AFTER rol,
                    ADD INDEX idx_bitacora_categoria (categoria)
                `);
            }
        })();
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
            categoria,
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    await db.execute(sql, [
        Number.isInteger(Number(event?.usuario_id)) ? Number(event.usuario_id) : null,
        String(event?.usuario_nombre || '').trim() || null,
        String(event?.usuario_correo || '').trim() || null,
        String(event?.rol || '').trim() || null,
        normalizeCategory(event?.categoria || inferCategoryFromRoute(event?.ruta || event?.recurso)),
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

exports.listAuditEvents = async ({ limit = 100, categoria = '' } = {}) => {
    await ensureAuditTable();

    const safeLimit = normalizeLimit(limit, 100);
    const safeCategory = normalizeCategory(categoria, '');
    const whereSql = safeCategory ? 'WHERE categoria = ?' : '';
    const params = safeCategory ? [safeCategory] : [];

    const [rows] = await db.execute(
        `
            SELECT
                id,
                usuario_id,
                usuario_nombre,
                usuario_correo,
                rol,
                categoria,
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
            ${whereSql}
            ORDER BY created_at DESC, id DESC
            LIMIT ${safeLimit}
        `,
        params
    );

    return rows.map((row) => ({
        ...row,
        categoria: row.categoria || inferCategoryFromRoute(row.ruta || row.recurso),
        detalles: parseDetails(row.detalles)
    }));
};

exports.ensureAuditTable = ensureAuditTable;
