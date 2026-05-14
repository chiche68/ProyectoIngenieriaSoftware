const express = require('express');
const router = express.Router();
const controller = require('../controllers/rewards.controller');

router.get('/', controller.getRewards);
router.post('/redeem', controller.redeemReward);

module.exports = router;
