const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const { initializeDatabase } = require('./init-data');
const { getActiveAlerts, resolveAlert, startAlertChecker, getYardStatistics } = require('./alert-manager');
const yardLayout = require('../config/yard-layout.json');

const dataReceiver = require('./yard-data-receiver');
const stateManager = require('./yard-state-manager');
const pushService = require('./yard-push-service');
const CraneOperationSimulator = require('./crane-simulator');
const simulatorConfig = require('../config/simulator-config.json');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

dataReceiver.onDataProcessed(async (slotId) => {
    await stateManager.updateSlotStatus(slotId);
    await pushService.pushAllUpdates(slotId);
});

pushService.init(wss);

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/slots', async (req, res) => {
    try {
        const slots = await stateManager.getAllSlotsWithStatus();
        res.json(slots);
    } catch (error) {
        console.error('获取箱位数据失败:', error);
        res.status(500).json({ error: '获取箱位数据失败' });
    }
});

app.get('/api/slots/:id', async (req, res) => {
    try {
        const detail = await stateManager.getSlotDetail(req.params.id);
        if (!detail) {
            return res.status(404).json({ error: '箱位不存在' });
        }
        res.json(detail);
    } catch (error) {
        console.error('获取箱位详情失败:', error);
        res.status(500).json({ error: '获取箱位详情失败' });
    }
});

app.get('/api/containers/search', async (req, res) => {
    try {
        const results = await stateManager.searchContainers(req.query.containerNo);
        if (!req.query.containerNo) {
            return res.status(400).json({ error: '请输入箱号' });
        }
        res.json(results);
    } catch (error) {
        console.error('搜索集装箱失败:', error);
        res.status(500).json({ error: '搜索集装箱失败' });
    }
});

app.get('/api/statistics', async (req, res) => {
    try {
        const stats = await getYardStatistics();
        res.json(stats);
    } catch (error) {
        console.error('获取统计数据失败:', error);
        res.status(500).json({ error: '获取统计数据失败' });
    }
});

app.get('/api/alerts', async (req, res) => {
    try {
        const alerts = await getActiveAlerts();
        res.json(alerts);
    } catch (error) {
        console.error('获取告警数据失败:', error);
        res.status(500).json({ error: '获取告警数据失败' });
    }
});

app.post('/api/alerts/:id/resolve', async (req, res) => {
    try {
        await resolveAlert(req.params.id, req.body.resolvedBy || 'system');
        await pushService.pushAlertsUpdate();
        await pushService.pushStatisticsUpdate();
        res.json({ success: true });
    } catch (error) {
        console.error('解除告警失败:', error);
        res.status(500).json({ error: '解除告警失败' });
    }
});

app.get('/api/layout', (req, res) => {
    res.json(yardLayout);
});

wss.on('connection', (ws) => {
    console.log('WebSocket客户端已连接');

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            console.log('收到WebSocket消息:', data.type);

            switch (data.type) {
                case 'sensor_data':
                    dataReceiver.enqueue({
                        ...(data.payload || {}),
                        sequence: data.sequence || 0
                    });
                    ws.send(JSON.stringify({
                        type: 'sensor_response',
                        data: { success: true, queued: true }
                    }));
                    break;

                case 'get_all_slots':
                    ws.send(JSON.stringify({
                        type: 'all_slots',
                        data: await stateManager.getAllSlotsWithStatus()
                    }));
                    break;

                case 'get_statistics':
                    ws.send(JSON.stringify({
                        type: 'statistics',
                        data: await getYardStatistics()
                    }));
                    break;

                case 'get_alerts':
                    ws.send(JSON.stringify({
                        type: 'alerts',
                        data: await getActiveAlerts()
                    }));
                    break;

                default:
                    console.log('未知消息类型:', data.type);
            }
        } catch (error) {
            console.error('处理WebSocket消息失败:', error);
        }
    });

    ws.on('close', () => console.log('WebSocket客户端已断开'));
    ws.on('error', (error) => console.error('WebSocket错误:', error));
});

async function startServer() {
    await initializeDatabase();

    startAlertChecker(30000, async () => {
        await pushService.pushAlertsUpdate();
        await pushService.pushStatisticsUpdate();
    });

    if (simulatorConfig.simulator.enabled) {
        const simulator = new CraneOperationSimulator(simulatorConfig.simulator);
        simulator.start().catch(console.error);
    }

    server.listen(PORT, () => {
        console.log(`服务器运行在 http://localhost:${PORT}`);
        console.log(`WebSocket服务运行在 ws://localhost:${PORT}`);
    });
}

startServer();
