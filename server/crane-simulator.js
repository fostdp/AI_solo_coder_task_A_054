const WebSocket = require('ws');

const DEFAULT_CONFIG = {
    wsUrl: 'ws://localhost:3000',
    frequency: {
        minInterval: 1000,
        maxInterval: 5000,
        operationProbability: 0.8
    },
    containerTypes: {
        '20GP': { weight: { min: 5, max: 25 }, probability: 0.45 },
        '40GP': { weight: { min: 10, max: 30 }, probability: 0.30 },
        '40HC': { weight: { min: 10, max: 30 }, probability: 0.20 },
        '20RF': { weight: { min: 5, max: 20 }, probability: 0.05 }
    },
    dangerousGoods: {
        probability: 0.1,
        types: ['易燃品', '腐蚀品', '氧化剂', '爆炸物']
    },
    unloading: {
        probability: 0.4,
        preferTopLayers: true
    },
    slotSelection: {
        preferZone: null,
        preferLowUtilization: true
    },
    logging: {
        enabled: true,
        level: 'info'
    }
};

class CraneOperationSimulator {
    constructor(config = {}) {
        this.config = this._mergeConfig(DEFAULT_CONFIG, config);
        this.ws = null;
        this.isRunning = false;
        this.currentTimeout = null;
        this.stats = {
            operations: 0,
            loads: 0,
            unloads: 0,
            errors: 0
        };
        this.sequence = 0;
    }

    _mergeConfig(defaults, overrides) {
        const merged = { ...defaults };
        for (const key in overrides) {
            if (typeof overrides[key] === 'object' && overrides[key] !== null && !Array.isArray(overrides[key])) {
                merged[key] = this._mergeConfig(defaults[key] || {}, overrides[key]);
            } else {
                merged[key] = overrides[key];
            }
        }
        return merged;
    }

    _selectContainerType() {
        const types = Object.keys(this.config.containerTypes);
        const random = Math.random();
        let cumulative = 0;

        for (const type of types) {
            cumulative += this.config.containerTypes[type].probability;
            if (random <= cumulative) {
                return type;
            }
        }
        return types[0];
    }

    _generateWeight(containerType) {
        const range = this.config.containerTypes[containerType].weight;
        return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
    }

    _generateContainerNo() {
        const prefixes = ['CN', 'COS', 'MAE', 'MSC', 'EMC', 'YML', 'HPL'];
        const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
        const numbers = Math.floor(Math.random() * 9000000 + 1000000).toString();
        return prefix + numbers;
    }

    _isDangerous() {
        return Math.random() < this.config.dangerousGoods.probability;
    }

    _selectDangerousType() {
        return this.config.dangerousGoods.types[
            Math.floor(Math.random() * this.config.dangerousGoods.types.length)
        ];
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.config.wsUrl);

            this.ws.on('open', () => {
                this._log('info', 'WebSocket连接成功');
                resolve();
            });

            this.ws.on('error', (error) => {
                this._log('error', 'WebSocket连接错误:', error.message);
                reject(error);
            });

            this.ws.on('close', () => {
                this._log('warn', 'WebSocket连接已关闭');
                if (this.isRunning) {
                    this._log('info', '5秒后尝试重连...');
                    setTimeout(() => this.connect().catch(console.error), 5000);
                }
            });

            this.ws.on('message', (data) => {
                try {
                    const message = JSON.parse(data.toString());
                    if (message.type === 'sensor_response') {
                        this._log('debug', '收到传感器响应:', message.data);
                    }
                } catch (e) {
                    this._log('error', '解析消息失败:', e.message);
                }
            });
        });
    }

    async start() {
        if (this.isRunning) {
            this._log('warn', '模拟器已经在运行中');
            return;
        }

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            await this.connect();
        }

        this.isRunning = true;
        this._log('info', '吊装作业模拟器已启动');
        this._scheduleNextOperation();
    }

    stop() {
        this.isRunning = false;
        if (this.currentTimeout) {
            clearTimeout(this.currentTimeout);
            this.currentTimeout = null;
        }
        this._log('info', '模拟器已停止。统计:', this.stats);
        if (this.ws) {
            this.ws.close();
        }
    }

    _scheduleNextOperation() {
        if (!this.isRunning) return;

        const interval = Math.floor(
            Math.random() * (this.config.frequency.maxInterval - this.config.frequency.minInterval + 1)
            + this.config.frequency.minInterval
        );

        this.currentTimeout = setTimeout(async () => {
            try {
                await this._executeOperation();
            } catch (error) {
                this.stats.errors++;
                this._log('error', '操作执行失败:', error.message);
            }
            this._scheduleNextOperation();
        }, interval);
    }

    async _executeOperation() {
        if (Math.random() > this.config.frequency.operationProbability) {
            this._log('debug', '跳过本次操作周期');
            return;
        }

        const action = Math.random() > this.config.unloading.probability ? 'load' : 'unload';
        this.sequence++;

        if (action === 'load') {
            await this._executeLoad();
        } else {
            await this._executeUnload();
        }

        this.stats.operations++;
    }

    async _executeLoad() {
        const containerType = this._selectContainerType();
        const weight = this._generateWeight(containerType);
        const containerNo = this._generateContainerNo();
        const isDangerous = this._isDangerous();

        const operation = {
            type: 'sensor_data',
            sequence: this.sequence,
            payload: {
                slotId: this._generateRandomSlotId(),
                containerNo,
                action: 'load',
                containerInfo: {
                    type: containerType,
                    weight,
                    isDangerous,
                    dangerousType: isDangerous ? this._selectDangerousType() : null
                }
            }
        };

        this._sendOperation(operation);
        this.stats.loads++;
        this._log('info', `[装载] ${containerNo} (${containerType}, ${weight}吨) ${isDangerous ? '[危险品]' : ''}`);
    }

    async _executeUnload() {
        const containerNo = this._generateContainerNo();

        const operation = {
            type: 'sensor_data',
            sequence: this.sequence,
            payload: {
                slotId: this._generateRandomSlotId(),
                containerNo,
                action: 'unload'
            }
        };

        this._sendOperation(operation);
        this.stats.unloads++;
        this._log('info', `[卸载] ${containerNo}`);
    }

    _generateRandomSlotId() {
        const zones = ['A', 'B', 'C', 'D', 'E'];
        const zone = zones[Math.floor(Math.random() * zones.length)];
        const row = String(Math.floor(Math.random() * 5) + 1).padStart(2, '0');
        const col = String(Math.floor(Math.random() * 20) + 1).padStart(2, '0');
        return `${zone}${row}-${col}`;
    }

    _sendOperation(operation) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(operation));
        } else {
            this._log('warn', 'WebSocket未连接，无法发送操作');
        }
    }

    _log(level, ...args) {
        if (!this.config.logging.enabled) return;

        const levels = ['debug', 'info', 'warn', 'error'];
        const configLevel = levels.indexOf(this.config.logging.level);
        const messageLevel = levels.indexOf(level);

        if (messageLevel >= configLevel) {
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] [${level.toUpperCase()}]`, ...args);
        }
    }

    getStats() {
        return { ...this.stats };
    }
}

if (require.main === module) {
    const simulator = new CraneOperationSimulator({
        frequency: {
            minInterval: parseInt(process.env.SIM_MIN_INTERVAL || '1000'),
            maxInterval: parseInt(process.env.SIM_MAX_INTERVAL || '5000'),
            operationProbability: parseFloat(process.env.SIM_OP_PROB || '0.8')
        },
        wsUrl: process.env.SIM_WS_URL || 'ws://localhost:3000',
        logging: {
            enabled: true,
            level: process.env.SIM_LOG_LEVEL || 'info'
        }
    });

    simulator.start().catch(console.error);

    process.on('SIGINT', () => {
        console.log('\n收到停止信号...');
        simulator.stop();
        process.exit(0);
    });
}

module.exports = CraneOperationSimulator;
