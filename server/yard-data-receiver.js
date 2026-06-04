const db = require('./db');

const sensorMessageQueue = new Map();
const processingLocks = new Set();

class YardDataReceiver {
    constructor() {
        this._onDataProcessed = null;
    }

    onDataProcessed(callback) {
        this._onDataProcessed = callback;
    }

    enqueue(data) {
        const { slotId, sequence: clientSeq } = data;
        const queue = sensorMessageQueue.get(slotId) || [];

        queue.push({
            ...data,
            receivedAt: Date.now(),
            clientSeq: clientSeq || 0
        });

        queue.sort((a, b) => a.clientSeq - b.clientSeq);
        sensorMessageQueue.set(slotId, queue);

        if (!processingLocks.has(slotId)) {
            this._processQueue(slotId);
        }
    }

    async _processQueue(slotId) {
        if (processingLocks.has(slotId)) return;
        processingLocks.add(slotId);

        try {
            const queue = sensorMessageQueue.get(slotId) || [];

            while (queue.length > 0) {
                const message = queue.shift();
                await this._persistSensorData(message);
            }

            sensorMessageQueue.delete(slotId);
        } catch (error) {
            console.error(`处理箱位 ${slotId} 消息队列失败:`, error);
        } finally {
            processingLocks.delete(slotId);
        }
    }

    async _persistSensorData(data) {
        const { slotId, containerNo, action, containerInfo } = data;

        try {
            if (action === 'load') {
                const maxLayerResult = await db.query(`
                    SELECT COALESCE(MAX(layer_num), 0) as max_layer 
                    FROM containers 
                    WHERE slot_id = $1 AND status = 'stored'
                `, [slotId]);

                const nextLayer = parseInt(maxLayerResult.rows[0].max_layer) + 1;

                await db.query(`
                    INSERT INTO containers (container_no, container_type, weight, is_dangerous,
                                           dangerous_type, slot_id, layer_num, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, 'stored')
                `, [
                    containerNo,
                    containerInfo.type,
                    containerInfo.weight,
                    containerInfo.isDangerous || false,
                    containerInfo.dangerousType || null,
                    slotId,
                    nextLayer
                ]);

                await db.query(`
                    INSERT INTO operation_logs (operation_type, slot_id, container_no, details)
                    VALUES ('load', $1, $2, $3)
                `, [slotId, containerNo, `吊装集装箱到第${nextLayer}层`]);

            } else if (action === 'unload') {
                await db.query(`
                    UPDATE containers 
                    SET status = 'removed', 
                        slot_id = NULL, 
                        layer_num = 0
                    WHERE container_no = $1 AND status = 'stored'
                `, [containerNo]);

                await db.query(`
                    INSERT INTO operation_logs (operation_type, slot_id, container_no, details)
                    VALUES ('unload', $1, $2, '移走集装箱')
                `, [slotId, containerNo]);
            }

            if (this._onDataProcessed) {
                await this._onDataProcessed(slotId);
            }

            return { success: true };
        } catch (error) {
            console.error('处理传感器数据失败:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = new YardDataReceiver();
