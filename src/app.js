const express = require('express');
const cors = require('cors');
const { initializeAuth } = require('./services/auth.service');
const { authenticate, authorizeRoles } = require('./middleware/auth.middleware');

const app = express();

initializeAuth().catch((error) => {
  console.error('Error inicializando autenticación:', error.message);
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Ruta de verificación
app.get('/', (req, res) => {
  res.json({ 
    message: 'API ERP Ventas funcionando correctamente',
    endpoints: [
      '/api/auth/login',
      '/api/users',
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
app.use('/api/sales', authenticate, authorizeRoles('gerente', 'vendedor'), salesRoutes);

const opportunityRoutes = require('./routes/opportunity.routes');
app.use('/api/opportunities', authenticate, authorizeRoles('gerente', 'vendedor'), opportunityRoutes);

const rewardsRoutes = require('./routes/rewards.routes');
app.use('/api/rewards', authenticate, authorizeRoles('gerente', 'vendedor'), rewardsRoutes);

module.exports = app;
