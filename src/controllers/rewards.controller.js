const service = require('../services/rewards.service');

exports.getRewards = async (req, res) => {
    try {
        const data = await service.getRewards();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getAllRewards = async (req, res) => {
    try {
        const data = await service.getAllRewards();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.createReward = async (req, res) => {
    try {
        const result = await service.createReward(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.updateReward = async (req, res) => {
    try {
        const rewardId = req.params?.id;
        const result = await service.updateReward({ id: rewardId, ...req.body });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteReward = async (req, res) => {
    try {
        const rewardId = req.params?.id;
        const result = await service.deleteReward({ id: rewardId });
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.redeemReward = async (req, res) => {
    try {
        const result = await service.redeemReward(req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
