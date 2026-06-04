const { getActiveAlerts, getYardStatistics } = require('./alert-manager');

class YardPushService {
    constructor() {
        this.wss = null;
        this.messageSequence = { global: 0, slot: {} };
    }

    init(wss) {
        this.wss = wss;
    }

    _getNextSequence(slotId) {
        if (!this.messageSequence.slot[slotId]) {
            this.messageSequence.slot[slotId] = 0;
        }
        this.messageSequence.slot[slotId]++;
        this.messageSequence.global++;
        return {
            global: this.messageSequence.global,
            slot: this.messageSequence.slot[slotId]
        };
    }

    broadcast(message, slotId) {
        if (!this.wss) return;

        const sequence = this._getNextSequence(slotId);
        const messageWithSeq = {
            ...message,
            sequence: sequence.global,
            slotSequence: sequence.slot,
            slotId: slotId,
            timestamp: Date.now()
        };
        const data = JSON.stringify(messageWithSeq);
        this.wss.clients.forEach(client => {
            if (client.readyState === 1) {
                client.send(data);
            }
        });
    }

    async pushSlotUpdate(slotId) {
        const stateManager = require('./yard-state-manager');
        const slotData = await stateManager.getSlotWithStatus(slotId);
        if (slotData) {
            this.broadcast({ type: 'slot_updated', data: slotData }, slotId);
        }
    }

    async pushAlertsUpdate() {
        const alerts = await getActiveAlerts();
        this.broadcast({ type: 'alerts_updated', data: alerts }, 'global');
    }

    async pushStatisticsUpdate() {
        const stats = await getYardStatistics();
        this.broadcast({ type: 'statistics_updated', data: stats }, 'global');
    }

    async pushAllUpdates(slotId) {
        await this.pushSlotUpdate(slotId);
        await this.pushAlertsUpdate();
        await this.pushStatisticsUpdate();
    }
}

module.exports = new YardPushService();
