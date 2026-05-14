const express = require('express');
const router = express.Router();
const controller = require('../controllers/rewards.controller');
const { authorizeRoles } = require('../middleware/auth.middleware');

router.get('/all', authorizeRoles('gerente'), controller.getAllRewards);
router.get('/', authorizeRoles('gerente', 'vendedor'), controller.getRewards);
router.post('/', authorizeRoles('gerente'), controller.createReward);
router.put('/:id', authorizeRoles('gerente'), controller.updateReward);
router.delete('/:id', authorizeRoles('gerente'), controller.deleteReward);
router.post('/redeem', authorizeRoles('gerente', 'vendedor'), controller.redeemReward);

module.exports = router;
