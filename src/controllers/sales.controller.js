const service = require('../services/sales.service');

exports.getSalesClients = async (req, res) => {
    try {
        const data = await service.getClients();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getSalesVendedores = async (req, res) => {
    try {
        const data = await service.getVendedores();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getSalesReport = async (req, res) => {
    try {
        const { period, codigo_cliente } = req.query;

        // Un vendedor solo puede consultar su propio reporte.
        const vendedor = req.user?.rol === 'vendedor'
            ? (req.user.nombre || req.user.correo)
            : req.query.vendedor;

        const data = await service.getReport(period, codigo_cliente, vendedor);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getVendedoresRendimiento = async (req, res) => {
    try {
        const { period } = req.query;
        const data = await service.getVendedoresRendimiento(period);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getSalesKpis = async (req, res) => {
    try {
        const { month, vendedor } = req.query;
        const data = await service.getSalesKpis({ month, vendedor });
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getSalesBySeller = async (req, res) => {
    try {
        const { vendedor } = req.query;
        const limit = req.query.limit ? parseInt(req.query.limit) : 100;

        // Un vendedor solo puede consultar sus propias ventas.
        const actualVendedor = req.user?.rol === 'vendedor'
            ? (req.user.nombre || req.user.correo)
            : vendedor;

        const data = await service.getSalesBySeller(actualVendedor, limit);
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.createSale = async (req, res) => {
    try {
        const payload = { ...req.body };

        if (req.user?.rol === 'vendedor') {
            payload.vendedor = req.user.nombre || req.user.correo;
        }

        const result = await service.create(payload);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getLoyaltyConfig = async (req, res) => {
    try {
        const data = await service.getLoyaltyConfig();
        res.json(data);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.updateLoyaltyConfig = async (req, res) => {
    try {
        const result = await service.updateLoyaltyConfig(req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.searchClients = async (req, res) => {
    try {
        const { q = '', limit = '20' } = req.query;
        const maxResults = Number.parseInt(limit, 10);
        const startedAt = Date.now();
        const data = await service.searchClients(q, Number.isInteger(maxResults) ? maxResults : 20);
        const elapsedMs = Date.now() - startedAt;

        res.json({
            elapsed_ms: elapsedMs,
            total: data.length,
            items: data
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.getClientDetail = async (req, res) => {
    try {
        const data = await service.getClientDetail(req.params.clientRef);
        res.json(data);
    } catch (error) {
        res.status(404).json({ error: error.message });
    }
};

exports.createClient = async (req, res) => {
    try {
        const result = await service.createClient(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.updateClient = async (req, res) => {
    try {
        const result = await service.updateClient(req.params.clientRef, req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

exports.deleteClient = async (req, res) => {
    try {
        const result = await service.deleteClient(req.params.clientRef);
        res.json(result);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};
