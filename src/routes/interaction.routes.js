const express = require('express');
const router = express.Router();
const controller = require('../controllers/interaction.controller');
const { authorizeRoles } = require('../middleware/auth.middleware');

router.post('/', authorizeRoles('gerente', 'vendedor'), controller.createInteraction);
router.delete('/:id', authorizeRoles('gerente', 'vendedor'), controller.deleteInteraction);
router.get('/:codigoCliente', authorizeRoles('gerente', 'vendedor'), controller.getByClient);
router.get('/', authorizeRoles('gerente'), controller.getAll);


module.exports = router;
