const service = require('../services/opportunity.service');

exports.createOpportunity = async (req, res) => {
    try {
        const payload = { ...req.body };

        if (req.user?.rol === 'vendedor') {
            payload.vendedor = req.user.nombre || req.user.correo;
        }

        const result = await service.createOpportunity(payload);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getOpportunities = async (req, res) => {
    try {
        const { codigo_cliente } = req.query;
        const vendedor = req.user?.rol === 'vendedor'
            ? (req.user.nombre || req.user.correo)
            : '';
        const data = await service.getOpportunities(codigo_cliente, vendedor);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.updateOpportunityState = async (req, res) => {
    try {
        const result = await service.updateOpportunityState(req.params.id, req.body.estado);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
