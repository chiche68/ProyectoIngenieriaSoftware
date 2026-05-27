const service = require('../services/audit.service');

exports.getAuditLogs = async (req, res) => {
    try {
        const limit = req.query?.limit;
        const data = await service.listAuditEvents({ limit });
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};