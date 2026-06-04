class YardMonitorApp {
    constructor() {
        this.layout = null;
        this.yardMap = null;
        this.locator = new window.ContainerLocator();
        this.statistics = new window.YardStatistics();
        this.ws = null;
        this.slots = [];
        this.alerts = [];
        this.currentSlotDetail = null;

        this.lastProcessedSequence = 0;
        this.messageQueue = [];
        this.isProcessingQueue = false;

        this.slotMessageQueues = new Map();
        this.slotLastSequence = new Map();

        this.init();
    }

    async init() {
        await this.loadLayout();
        this.initYardMap();
        this.bindEvents();
        this.startTimeUpdate();
        this.connectWebSocket();
        await this.loadInitialData();
    }

    async loadLayout() {
        try {
            const response = await fetch('/api/layout');
            this.layout = await response.json();
        } catch (error) {
            console.error('加载布局配置失败:', error);
        }
    }

    initYardMap() {
        if (!this.layout) return;

        this.yardMap = new YardMap('yard-canvas', this.layout);
        this.yardMap.onSlotClick((slot) => {
            this.showSlotDetail(slot);
        });
    }

    bindEvents() {
        document.getElementById('search-btn').addEventListener('click', () => {
            this.searchContainer();
        });

        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchContainer();
            }
        });

        document.getElementById('zoom-in').addEventListener('click', () => {
            this.yardMap.zoomIn();
        });

        document.getElementById('zoom-out').addEventListener('click', () => {
            this.yardMap.zoomOut();
        });

        document.getElementById('zoom-reset').addEventListener('click', () => {
            this.yardMap.resetZoom();
        });

        document.getElementById('close-modal').addEventListener('click', () => {
            this.hideModal();
        });

        document.getElementById('slot-modal').addEventListener('click', (e) => {
            if (e.target.id === 'slot-modal') {
                this.hideModal();
            }
        });
    }

    startTimeUpdate() {
        const updateTime = () => {
            const now = new Date();
            const timeStr = now.toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            document.getElementById('current-time').textContent = timeStr;
        };
        updateTime();
        setInterval(updateTime, 1000);
    }

    connectWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;

        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            console.log('WebSocket已连接');
            this.updateConnectionStatus(true);
            this.ws.send(JSON.stringify({ type: 'get_all_slots' }));
            this.ws.send(JSON.stringify({ type: 'get_statistics' }));
            this.ws.send(JSON.stringify({ type: 'get_alerts' }));
        };

        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.enqueueWebSocketMessage(message);
            } catch (error) {
                console.error('解析WebSocket消息失败:', error);
            }
        };

        this.ws.onclose = () => {
            console.log('WebSocket已断开，3秒后重试...');
            this.updateConnectionStatus(false);
            setTimeout(() => this.connectWebSocket(), 3000);
        };

        this.ws.onerror = (error) => {
            console.error('WebSocket错误:', error);
            this.updateConnectionStatus(false);
        };
    }

    updateConnectionStatus(connected) {
        const dot = document.getElementById('connection-dot');
        const text = document.getElementById('connection-text');

        if (connected) {
            dot.className = 'status-dot connected';
            text.textContent = '已连接';
        } else {
            dot.className = 'status-dot disconnected';
            text.textContent = '连接断开';
        }
    }

    enqueueWebSocketMessage(message) {
        if (message.sequence === undefined) {
            this.handleWebSocketMessage(message);
            return;
        }

        if (message.slotId && message.type === 'slot_updated') {
            this.enqueueSlotMessage(message);
            return;
        }

        this.messageQueue.push(message);
        this.messageQueue.sort((a, b) => a.sequence - b.sequence);
        this.processMessageQueue();
    }

    enqueueSlotMessage(message) {
        const slotId = message.slotId;
        const slotSeq = message.slotSequence || 0;

        if (!this.slotMessageQueues.has(slotId)) {
            this.slotMessageQueues.set(slotId, []);
        }

        const queue = this.slotMessageQueues.get(slotId);
        queue.push(message);
        queue.sort((a, b) => (a.slotSequence || 0) - (b.slotSequence || 0));

        this.processSlotMessageQueue(slotId);
    }

    processSlotMessageQueue(slotId) {
        const queue = this.slotMessageQueues.get(slotId);
        if (!queue || queue.length === 0) return;

        const lastSeq = this.slotLastSequence.get(slotId) || 0;

        while (queue.length > 0) {
            const message = queue[0];
            const msgSeq = message.slotSequence || 0;

            if (msgSeq <= lastSeq) {
                queue.shift();
                continue;
            }

            if (msgSeq === lastSeq + 1) {
                queue.shift();
                this.slotLastSequence.set(slotId, msgSeq);
                this.handleWebSocketMessage(message);
            } else {
                break;
            }
        }
    }

    processMessageQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        try {
            while (this.messageQueue.length > 0) {
                const message = this.messageQueue[0];
                const msgSeq = message.sequence;

                if (msgSeq <= this.lastProcessedSequence) {
                    this.messageQueue.shift();
                    continue;
                }

                if (msgSeq === this.lastProcessedSequence + 1) {
                    this.messageQueue.shift();
                    this.lastProcessedSequence = msgSeq;
                    this.handleWebSocketMessage(message);
                } else if (msgSeq > this.lastProcessedSequence + 1) {
                    if (this.messageQueue.length > 100) {
                        this.lastProcessedSequence = msgSeq - 1;
                        console.warn('消息队列积压过多，跳转到最新消息');
                    } else {
                        break;
                    }
                }
            }
        } finally {
            this.isProcessingQueue = false;
        }
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'all_slots':
                this.slots = message.data;
                this.yardMap.setSlots(this.slots);
                break;

            case 'slot_updated':
                this.yardMap.updateSlot(message.data);
                const index = this.slots.findIndex(s => s.id === message.data.id);
                if (index !== -1) {
                    this.slots[index] = { ...this.slots[index], ...message.data };
                }
                if (this.currentSlotDetail && this.currentSlotDetail.id === message.data.id) {
                    this.showSlotDetail(message.data);
                }
                break;

            case 'statistics':
            case 'statistics_updated':
                this.statistics.update(message.data);
                this.statistics.render();
                break;

            case 'alerts':
            case 'alerts_updated':
                this.alerts = message.data;
                this.yardMap.setAlerts(this.alerts);
                this.updateAlertsList();
                break;

            case 'sensor_response':
                console.log('传感器响应:', message.data);
                break;

            default:
                console.log('未知消息类型:', message.type);
        }
    }

    async loadInitialData() {
        try {
            const [slotsResponse, statsResponse, alertsResponse] = await Promise.all([
                fetch('/api/slots'),
                fetch('/api/statistics'),
                fetch('/api/alerts')
            ]);

            this.slots = await slotsResponse.json();
            this.statistics.update(await statsResponse.json());
            this.alerts = await alertsResponse.json();

            if (this.yardMap) {
                this.yardMap.setSlots(this.slots);
                this.yardMap.setAlerts(this.alerts);
            }

            this.statistics.render();
            this.updateAlertsList();
        } catch (error) {
            console.error('加载初始数据失败:', error);
        }
    }

    async searchContainer() {
        const containerNo = document.getElementById('search-input').value.trim();
        const { results, slotIds, error } = await this.locator.search(containerNo);

        if (error) {
            alert(error);
            return;
        }

        if (!results.length) {
            alert('未找到该集装箱');
            this.yardMap.clearSearchHighlight();
            return;
        }

        this.yardMap.highlightSearchResults(slotIds);

        if (results.length === 1) {
            this.showContainerSearchResult(results[0]);
        } else {
            alert(`找到 ${results.length} 个集装箱，已在地图上高亮显示`);
        }
    }

    async showContainerSearchResult(container) {
        const data = await this.locator.fetchSlotDetail(container.slot_id);
        if (data) {
            this.showSlotDetailModal(data.slot, data.containers, container);
        }
    }

    async showSlotDetail(slot) {
        const data = await this.locator.fetchSlotDetail(slot.id);
        if (data) {
            this.showSlotDetailModal(data.slot, data.containers);
        }
    }

    showSlotDetailModal(slot, containers, highlightContainer = null) {
        this.currentSlotDetail = slot;
        document.getElementById('modal-title').textContent = `箱位详情 - ${slot.id}`;

        const layers = slot.current_layers || 0;
        const weight = slot.total_weight || 0;
        const isOverHeight = layers > slot.max_layers;
        const isOverWeight = weight > slot.weight_limit;

        const slotAlerts = this.alerts.filter(a => a.slot_id === slot.id && a.is_active);

        let alertHtml = '';
        if (slotAlerts.length > 0) {
            alertHtml = '<div class="slot-info-row"><span class="slot-info-label">告警信息</span><span class="slot-info-value danger">';
            slotAlerts.forEach(alert => {
                alertHtml += `<div>⚠️ ${window.ALERT_TYPE_MAP[alert.alert_type] || '告警'}: ${alert.message}</div>`;
            });
            alertHtml += '</span></div>';
        }

        let containersHtml = '';
        if (containers.length === 0) {
            containersHtml = '<p class="no-containers">此箱位暂无集装箱</p>';
        } else {
            containersHtml = '<div class="container-list">';
            for (let i = containers.length - 1; i >= 0; i--) {
                const container = containers[i];
                const isHighlight = highlightContainer && highlightContainer.id === container.id;
                const storageHours = Math.floor(
                    (Date.now() - new Date(container.stored_at).getTime()) / (1000 * 60 * 60)
                );
                const storageDays = Math.floor(storageHours / 24);
                const storageText = storageDays > 0
                    ? `${storageDays}天${storageHours % 24}小时`
                    : `${storageHours}小时`;

                const isTimeout = container.is_dangerous && storageHours > 24;

                containersHtml += `
                    <div class="container-item ${container.is_dangerous ? 'dangerous' : ''}"
                         ${isHighlight ? 'style="border-color: #2196f3; border-width: 2px;"' : ''}>
                        <div class="container-header">
                            <span class="container-no">${container.container_no}</span>
                            <span class="container-layer">第${container.layer_num}层</span>
                        </div>
                        <div class="container-details">
                            <div><span class="container-detail-label">箱型:</span></div>
                            <div><span class="container-detail-value">${container.container_type}</span></div>
                            <div><span class="container-detail-label">重量:</span></div>
                            <div><span class="container-detail-value">${container.weight} 吨</span></div>
                            <div><span class="container-detail-label">堆存时间:</span></div>
                            <div><span class="container-detail-value">${storageText}</span></div>
                            ${isTimeout ? `
                                <div><span class="container-detail-label">状态:</span></div>
                                <div><span class="container-detail-value" style="color: #ef4444;">⚠️ 超时告警</span></div>
                            ` : ''}
                        </div>
                        ${container.is_dangerous ? `
                            <span class="dangerous-badge">⚠️ ${container.dangerous_type || '危险品'}</span>
                        ` : ''}
                    </div>
                `;
            }
            containersHtml += '</div>';
        }

        document.getElementById('modal-content').innerHTML = `
            <div class="slot-info">
                <div class="slot-info-row">
                    <span class="slot-info-label">箱位编号</span>
                    <span class="slot-info-value">${slot.id}</span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">所属区域</span>
                    <span class="slot-info-value">${slot.zone}区</span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">位置</span>
                    <span class="slot-info-value">第${slot.row_num}行 第${slot.col_num}列</span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">当前层数</span>
                    <span class="slot-info-value ${isOverHeight ? 'danger' : ''}">
                        ${layers} 层 / 最大 ${slot.max_layers} 层
                    </span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">总重量</span>
                    <span class="slot-info-value ${isOverWeight ? 'danger' : ''}">
                        ${weight.toFixed(1)} 吨 / 最大 ${slot.weight_limit} 吨
                    </span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">集装箱数</span>
                    <span class="slot-info-value">${containers.length} 个</span>
                </div>
                <div class="slot-info-row">
                    <span class="slot-info-label">最后更新</span>
                    <span class="slot-info-value">${new Date(slot.last_updated).toLocaleString('zh-CN')}</span>
                </div>
                ${alertHtml}
            </div>

            <div class="containers-section">
                <h4>集装箱列表 (从上到下)</h4>
                ${containersHtml}
            </div>
        `;

        document.getElementById('slot-modal').classList.add('active');
    }

    hideModal() {
        document.getElementById('slot-modal').classList.remove('active');
        this.currentSlotDetail = null;
    }

    updateAlertsList() {
        const container = document.getElementById('alerts-list');
        document.getElementById('alert-count').textContent = this.alerts.length;

        if (this.alerts.length === 0) {
            container.innerHTML = '<p class="no-alerts">暂无告警</p>';
            return;
        }

        const alertLevelMap = {
            'over_height': { level: 'danger' },
            'over_weight': { level: 'danger' },
            'container_overload': { level: 'warning' },
            'timeout': { level: 'warning' }
        };

        let html = '';
        for (const alert of this.alerts) {
            const name = window.ALERT_TYPE_MAP[alert.alert_type] || '告警';
            const levelInfo = alertLevelMap[alert.alert_type] || { level: 'warning' };
            const timeAgo = this.getTimeAgo(new Date(alert.created_at));

            html += `
                <div class="alert-item ${alert.alert_type}" data-alert-id="${alert.id}" data-slot-id="${alert.slot_id}">
                    <div class="alert-header">
                        <span class="alert-type">${name}</span>
                        <span class="alert-time">${timeAgo}</span>
                    </div>
                    <div class="alert-message">${alert.message}</div>
                    <div class="alert-slot">箱位: ${alert.slot_id || 'N/A'}</div>
                    ${alert.container_no ? `<div class="alert-slot">箱号: ${alert.container_no}</div>` : ''}
                    <button class="alert-resolve-btn" onclick="app.resolveAlert(${alert.id}, event)">
                        解除告警
                    </button>
                </div>
            `;
        }

        container.innerHTML = html;

        container.querySelectorAll('.alert-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('alert-resolve-btn')) return;
                const slotId = item.dataset.slotId;
                if (slotId) {
                    const slot = this.slots.find(s => s.id === slotId);
                    if (slot) {
                        this.showSlotDetail(slot);
                    }
                }
            });
        });
    }

    async resolveAlert(alertId, event) {
        event.stopPropagation();
        if (!confirm('确定要解除此告警吗？')) return;

        try {
            const response = await fetch(`/api/alerts/${alertId}/resolve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ resolvedBy: 'operator' })
            });

            if (response.ok) {
                this.alerts = this.alerts.filter(a => a.id !== alertId);
                this.yardMap.setAlerts(this.alerts);
                this.updateAlertsList();

                this.statistics.decrementAlertCount();
                this.statistics.render();
            }
        } catch (error) {
            console.error('解除告警失败:', error);
            alert('解除告警失败');
        }
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);

        if (seconds < 60) return `${seconds}秒前`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
        return `${Math.floor(seconds / 86400)}天前`;
    }
}

const app = new YardMonitorApp();
