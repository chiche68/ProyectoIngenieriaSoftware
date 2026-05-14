const service = require('../services/rewards.service');

exports.getRewards = async (req, res) => {
    try {
        const data = await service.getRewards();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.redeemReward = async (req, res) => {
    try {
        const result = await service.redeemReward({
            clientRef: req.body?.clientRef,
            rewardId: req.body?.rewardId
        });

        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
