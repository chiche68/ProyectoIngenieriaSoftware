const express = require('express');
const cors = require('cors');
const { initializeAuth } = require('./services/auth.service');
const { authenticate, authorizeRoles } = require('./middleware/auth.middleware');

const app = express();

initializeAuth().catch((error) => {
  console.error('Error inicializando autenticación:', error.message);
  console.error('Stack trace:', error.stack);
  // No salir del proceso, continuar con la inicialización
});

app.use(cors({
  origin: [
    'http://127.0.0.1:5500',  // Frontend local
    'http://localhost:5500',   // Frontend local alternativo
    'https://proyectoingenieriasoftware-production.up.railway.app', // Railway correcto
    '*' // Permitir cualquier origen en desarrollo
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));
app.use(express.json());

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
