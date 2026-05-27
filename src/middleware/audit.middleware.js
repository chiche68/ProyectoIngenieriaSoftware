const { recordAuditEvent } = require('../services/audit.service');

const AUDITED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const IGNORED_PATH_PREFIXES = ['/api/audit-logs'];
const SENSITIVE_KEYS = new Set(['password', 'password_hash', 'token', 'authorization']);

function sanitizeValue(value) {
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeValue(item));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((accumulator, [key, entryValue]) => {
            accumulator[key] = SENSITIVE_KEYS.has(String(key).toLowerCase()) ? '[REDACTED]' : sanitizeValue(entryValue);
            return accumulator;
        }, {});
    }

    return value;
}

function getAuditAction(method, routePath) {
    const cleanRoute = String(routePath || '').replace(/^\/api\//, '');
    const normalizedMethod = String(method || '').toUpperCase();

    if (normalizedMethod === 'GET') {
        return `CONSULTAR ${cleanRoute}`;
    }
    if (method === 'POST') {
        return `CREAR ${cleanRoute}`;
    }
    if (normalizedMethod === 'PUT' || normalizedMethod === 'PATCH') {
        return `ACTUALIZAR ${cleanRoute}`;
    }
    if (normalizedMethod === 'DELETE') {
        return `ELIMINAR ${cleanRoute}`;
    }
    return `${normalizedMethod} ${cleanRoute}`;
}

function shouldIgnoreRequest(req) {
    const pathname = String(req.originalUrl || req.path || '');
    return IGNORED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function auditRequests(req, res, next) {
    if (!AUDITED_METHODS.has(String(req.method || '').toUpperCase()) || shouldIgnoreRequest(req)) {
        return next();
    }

    const startedAt = Date.now();

    res.on('finish', () => {
        if (!req.user) {
            return;
        }

        const routePath = String(req.baseUrl || '').trim() + String(req.path || '').trim();
        const detalles = {
            params: sanitizeValue(req.params || {}),
            query: sanitizeValue(req.query || {}),
            body: sanitizeValue(req.body || {}),
            duration_ms: Date.now() - startedAt
        };

        recordAuditEvent({
            usuario_id: req.user.id,
            usuario_nombre: req.user.nombre,
            usuario_correo: req.user.correo,
            rol: req.user.rol,
            accion: getAuditAction(req.method, routePath),
            recurso: routePath || req.originalUrl || req.path,
            metodo: req.method,
            ruta: String(req.originalUrl || req.path || ''),
            estado_respuesta: res.statusCode,
            ip: req.ip,
            user_agent: req.get('user-agent') || '',
            detalles
        }).catch((error) => {
            console.error('Error registrando bitácora:', error.message);
        });
    });

    return next();
}

module.exports = auditRequests;