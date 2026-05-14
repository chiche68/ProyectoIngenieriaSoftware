const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { getJwtSecret } = require('../middleware/auth.middleware');

const USER_ROLES = ['gerente', 'vendedor', 'it', 'externo'];

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

async function ensureUsersTable() {
    const sql = `
        CREATE TABLE IF NOT EXISTS usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(120) NOT NULL,
            correo VARCHAR(190) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            rol ENUM('gerente', 'vendedor', 'it', 'externo') NOT NULL DEFAULT 'vendedor',
            activo TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_usuarios_correo (correo)
        )
    `;

    await db.execute(sql);

    // Mantiene compatibilidad si la tabla existia antes sin el rol IT o externo.
    await db.execute(`
        ALTER TABLE usuarios
        MODIFY COLUMN rol ENUM('gerente', 'vendedor', 'it', 'externo') NOT NULL DEFAULT 'vendedor'
    `);
}

async function createUserIfNotExists({ nombre, correo, password, rol }) {
    const safeEmail = normalizeEmail(correo);
    const safeRole = String(rol || '').trim().toLowerCase();

    if (!safeEmail || !password || !USER_ROLES.includes(safeRole)) {
        return;
    }

    const [rows] = await db.execute(
        'SELECT id FROM usuarios WHERE correo = ? LIMIT 1',
        [safeEmail]
    );

    if (rows.length > 0) {
        return;
    }

    const passwordHash = await bcrypt.hash(String(password), 12);
    await db.execute(
        'INSERT INTO usuarios (nombre, correo, password_hash, rol, activo) VALUES (?, ?, ?, ?, 1)',
        [String(nombre || safeEmail).trim(), safeEmail, passwordHash, safeRole]
    );
}

async function seedDefaultUsers() {
    const shouldSeed = String(process.env.AUTH_SEED_DEFAULT_USERS || 'true').toLowerCase() !== 'false';
    if (!shouldSeed) {
        return;
    }

    await createUserIfNotExists({
        nombre: process.env.SEED_IT_NAME || 'Administrador IT',
        correo: process.env.SEED_IT_EMAIL || 'it@erp.local',
        password: process.env.SEED_IT_PASSWORD || 'ItAdmin123!',
        rol: 'it'
    });

    await createUserIfNotExists({
        nombre: process.env.SEED_EXTERNO_NAME || 'Usuario Externo',
        correo: process.env.SEED_EXTERNO_EMAIL || 'externo@erp.local',
        password: process.env.SEED_EXTERNO_PASSWORD || 'Externo123!',
        rol: 'externo'
    });
}

function signToken(user) {
    const ttl = process.env.JWT_EXPIRES_IN || '8h';

    return jwt.sign(
        {
            sub: user.id,
            correo: user.correo,
            nombre: user.nombre,
            rol: user.rol
        },
        getJwtSecret(),
        { expiresIn: ttl }
    );
}

async function validateCredentials(correo, password) {
    const startedAt = Date.now();
    const normalizedEmail = normalizeEmail(correo);
    const plainPassword = String(password || '');

    if (!normalizedEmail || !plainPassword) {
        return {
            ok: false,
            elapsed_ms: Date.now() - startedAt
        };
    }

    const [rows] = await db.execute(
        `
            SELECT id, nombre, correo, password_hash, rol, activo
            FROM usuarios
            WHERE correo = ?
            LIMIT 1
        `,
        [normalizedEmail]
    );

    if (rows.length === 0) {
        return {
            ok: false,
            elapsed_ms: Date.now() - startedAt
        };
    }

    const userRow = rows[0];
    const isPasswordValid = await bcrypt.compare(plainPassword, userRow.password_hash);

    if (!isPasswordValid || Number(userRow.activo) !== 1) {
        return {
            ok: false,
            elapsed_ms: Date.now() - startedAt
        };
    }

    const user = {
        id: userRow.id,
        nombre: userRow.nombre,
        correo: userRow.correo,
        rol: userRow.rol
    };

    return {
        ok: true,
        token: signToken(user),
        user,
        elapsed_ms: Date.now() - startedAt
    };
}

async function initializeAuth() {
    await ensureUsersTable();
    await seedDefaultUsers();
}

module.exports = {
    initializeAuth,
    validateCredentials,
    ensureUsersTable,
    USER_ROLES
};
