const service = require('../services/auth.service');
const { recordAuditEvent } = require('../services/audit.service');

exports.login = async (req, res) => {
    try {
        const correo = String(req.body?.correo || '').trim();
        const password = String(req.body?.password || '');

        if (!correo || !password) {
            return res.status(400).json({
                error: 'Correo y contraseña son obligatorios'
            });
        }

        const result = await service.validateCredentials(correo, password);

        if (!result.ok) {
            return res.status(401).json({
                error: 'Credenciales inválidas'
            });
        }

        recordAuditEvent({
            usuario_id: result.user?.id,
            usuario_nombre: result.user?.nombre,
            usuario_correo: result.user?.correo,
            rol: result.user?.rol,
            categoria: 'LOGIN',
            accion: 'INICIO DE SESIÓN',
            recurso: 'auth/login',
            metodo: 'POST',
            ruta: '/api/auth/login',
            estado_respuesta: 200,
            ip: req.ip,
            user_agent: req.get('user-agent') || '',
            detalles: {
                correo: result.user?.correo,
                elapsed_ms: result.elapsed_ms
            }
        }).catch((auditError) => {
            console.error('Error registrando login en bitácora:', auditError.message);
        });

        return res.json({
            token: result.token,
            user: result.user,
            elapsed_ms: result.elapsed_ms
        });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

exports.me = (req, res) => {
    return res.json({ user: req.user });
};
