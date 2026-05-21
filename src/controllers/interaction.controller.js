const service = require('../services/interaction.service');

exports.createInteraction = async (req, res) => {
    try {
        const payload = {
            ...req.body,
            usuario: req.user?.nombre || req.user?.correo || req.body?.usuario
        };

        const result = await service.create(payload);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getByClient = async (req, res) => {
    const data = await service.getByClient(req.params.codigoCliente);
    res.json(data);
};

exports.getAll = async (req, res) => {
    const data = await service.getAll();
    res.json(data);
};

exports.deleteInteraction = async (req, res) => {
    try {
        const result = await service.delete(req.params.id);
        res.json(result);
    } catch (error) {
        const status = error.message === 'Interacción no encontrada' ? 404 : 400;
        res.status(status).json({ error: error.message });
    }
};
