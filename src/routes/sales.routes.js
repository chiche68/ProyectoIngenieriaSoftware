const express = require('express');
const router = express.Router();
const controller = require('../controllers/sales.controller');
const { authorizeRoles } = require('../middleware/auth.middleware');

router.get('/clients', authorizeRoles('gerente', 'vendedor'), controller.getSalesClients);
router.get('/products', authorizeRoles('gerente', 'vendedor'), controller.getInventoryProducts);
router.get('/clients/search', authorizeRoles('gerente'), controller.searchClients);
router.get('/clients/:clientRef', authorizeRoles('gerente', 'vendedor'), controller.getClientDetail);
router.post('/clients', authorizeRoles('gerente'), controller.createClient);
router.put('/clients/:clientRef', authorizeRoles('gerente'), controller.updateClient);
router.delete('/clients/:clientRef', authorizeRoles('gerente'), controller.deleteClient);
router.get('/loyalty/config', authorizeRoles('gerente'), controller.getLoyaltyConfig);
router.put('/loyalty/config', authorizeRoles('gerente'), controller.updateLoyaltyConfig);
router.get('/vendedores', authorizeRoles('gerente'), controller.getSalesVendedores);
router.get('/vendedores/rendimiento', authorizeRoles('gerente'), controller.getVendedoresRendimiento);
router.get('/kpis', authorizeRoles('gerente'), controller.getSalesKpis);
router.get('/report', authorizeRoles('gerente', 'vendedor', 'externo'), controller.getSalesReport);
router.get('/by-seller', authorizeRoles('gerente', 'vendedor'), controller.getSalesBySeller);
router.post('/', authorizeRoles('vendedor'), controller.createSale);

module.exports = router;
