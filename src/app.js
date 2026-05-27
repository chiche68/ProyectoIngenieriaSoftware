const express = require('express');
const cors = require('cors');
const { initializeAuth } = require('./services/auth.service');
const { authenticate, authorizeRoles } = require('./middleware/auth.middleware');
const auditRequests = require('./middleware/audit.middleware');

const app = express();

const allowedOrigins = new Set([
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'https://proyectoingenieriasoftwarefrontend-production.up.railway.app',
  'https://proyectoingenieriasoftwarefrontend-production-6a84.up.railway.app'
]);

if (process.env.FRONTEND_URL) {
  allowedOrigins.add(process.env.FRONTEND_URL);
}

function isAllowedRailwayFrontend(origin) {
  return /^https:\/\/proyectoingenieriasoftwarefrontend-[a-z0-9-]+\.up\.railway\.app$/i.test(origin);
}

initializeAuth().catch((error) => {
  console.error('Error inicializando autenticación:', error.message);
  console.error('Stack trace:', error.stack);
  // No salir del proceso, continuar con la inicialización
});

app.use(cors({
  // Refleja el origen de la petición y permite credenciales (cookies/headers).
  // Atención: esto permite cualquier origen y puede ser un riesgo de seguridad.
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());
app.use(auditRequests);

// Middleware de logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.headers.origin || 'unknown'}`);
  next();
});

app.get('/health', async (req, res) => {
  try {
    const db = require('./config/database');
    // Verificar conexión a la base de datos
    await db.execute('SELECT 1');
    res.status(200).json({
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Database health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      database: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime()
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    endpoints: [
      '/api/auth/login',
      '/api/audit-logs',
      '/api/tickets',
      '/api/interactions',
      '/api/sales',
      '/api/sales/loyalty/config',
      '/api/sales/clients/search',
      '/api/sales/clients/:clientRef',
      '/api/sales/kpis',
      '/api/opportunities',
      '/api/rewards'
    ]
  });
});

app.get('/test', (req, res) => {
  res.json({
    message: 'API test endpoint working',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Rutas
const authRoutes = require('./routes/auth.routes');
app.use('/api/auth', authRoutes);

const auditRoutes = require('./routes/audit.routes');
app.use('/api/audit-logs', authenticate, authorizeRoles('it'), auditRoutes);

const usersRoutes = require('./routes/users.routes');
app.use('/api/users', authenticate, authorizeRoles('it'), usersRoutes);

const ticketRoutes = require('./routes/ticket.routes');
app.use('/api/tickets', authenticate, authorizeRoles('gerente', 'vendedor'), ticketRoutes);

const interactionRoutes = require('./routes/interaction.routes');
app.use('/api/interactions', authenticate, authorizeRoles('gerente', 'vendedor'), interactionRoutes);

const salesRoutes = require('./routes/sales.routes');
app.use('/api/sales', authenticate, salesRoutes);

const opportunityRoutes = require('./routes/opportunity.routes');
app.use('/api/opportunities', authenticate, authorizeRoles('gerente', 'vendedor'), opportunityRoutes);

const rewardsRoutes = require('./routes/rewards.routes');
app.use('/api/rewards', authenticate, authorizeRoles('gerente', 'vendedor'), rewardsRoutes);

module.exports = app;
