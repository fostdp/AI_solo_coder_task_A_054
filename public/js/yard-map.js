class YardMap {
    constructor(canvasId, layout) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.layout = layout;
        this.slots = [];
        this.alerts = [];
        this.highlightedSlotId = null;
        this.searchResultSlotIds = [];
        this.zoom = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.isDragging = false;
        this.lastMouseX = 0;
        this.lastMouseY = 0;
        this.alertAnimationFrame = 0;
        this.alertSlotSet = new Set();
        this.slotGrid = null;

        this.initCanvas();
        this.bindEvents();
        this.startAlertAnimation();
    }

    initCanvas() {
        const { canvasWidth, canvasHeight } = this.layout.yardInfo;
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight + 80;
    }

    _buildSlotGrid() {
        this.slotGrid = new Map();
        for (const slot of this.slots) {
            this.slotGrid.set(slot.id, slot);
        }
        this.alertSlotSet = new Set();
        for (const alert of this.alerts) {
            if (alert.is_active && alert.slot_id) {
                this.alertSlotSet.add(alert.slot_id);
            }
        }
    }

    _getVisibleBounds() {
        const canvasRect = this.canvas.getBoundingClientRect();
        const viewLeft = -this.offsetX / this.zoom;
        const viewTop = -this.offsetY / this.zoom;
        const viewRight = viewLeft + canvasRect.width / this.zoom;
        const viewBottom = viewTop + canvasRect.height / this.zoom;
        return { left: viewLeft, top: viewTop, right: viewRight, bottom: viewBottom };
    }

    _getVisibleSlots() {
        const bounds = this._getVisibleBounds();
        const margin = 10;
        const visible = [];
        for (const slot of this.slots) {
            if (slot.x_pos + slot.width + margin >= bounds.left &&
                slot.x_pos - margin <= bounds.right &&
                slot.y_pos + slot.height + margin >= bounds.top &&
                slot.y_pos - margin <= bounds.bottom) {
                visible.push(slot);
            }
        }
        return visible;
    }

    setSlots(slots) {
        this.slots = slots;
        this._buildSlotGrid();
        this.draw();
    }

    updateSlot(slot) {
        const index = this.slots.findIndex(s => s.id === slot.id);
        if (index !== -1) {
            this.slots[index] = { ...this.slots[index], ...slot };
            this.slotGrid.set(slot.id, this.slots[index]);
            this.draw();
        }
    }

    setAlerts(alerts) {
        this.alerts = alerts;
        this._buildSlotGrid();
        this.draw();
    }

    highlightSearchResults(slotIds) {
        this.searchResultSlotIds = slotIds;
        this.draw();
    }

    clearSearchHighlight() {
        this.searchResultSlotIds = [];
        this.draw();
    }

    getSlotAtPosition(x, y) {
        const rect = this.canvas.getBoundingClientRect();
        const canvasX = (x - rect.left - this.offsetX) / this.zoom;
        const canvasY = (y - rect.top - this.offsetY) / this.zoom;

        const bounds = this._getVisibleBounds();
        for (const slot of this.slots) {
            if (slot.x_pos + slot.width < bounds.left || slot.x_pos > bounds.right ||
                slot.y_pos + slot.height < bounds.top || slot.y_pos > bounds.bottom) {
                continue;
            }
            if (canvasX >= slot.x_pos && canvasX <= slot.x_pos + slot.width &&
                canvasY >= slot.y_pos && canvasY <= slot.y_pos + slot.height) {
                return slot;
            }
        }
        return null;
    }

    getSlotColor(slot) {
        const layers = slot.current_layers || 0;
        const { colorRules } = this.layout;

        if (this.alertSlotSet.has(slot.id)) {
            const alert = this.alerts.find(a => a.slot_id === slot.id && a.is_active);
            if (alert) {
                return colorRules.alert[alert.alert_type] || colorRules.layers['5-6'];
            }
        }

        if (layers === 0) return colorRules.layers['0'];
        if (layers <= 2) return colorRules.layers['1-2'];
        if (layers <= 4) return colorRules.layers['3-4'];
        return colorRules.layers['5-6'];
    }

    draw() {
        const ctx = this.ctx;
        const { canvasWidth, canvasHeight, padding, rows, cols, slotWidth, slotGap } = this.layout.yardInfo;
        const { zones, colorRules } = this.layout;

        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.zoom, this.zoom);

        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        for (let i = 0; i <= cols; i++) {
            const x = padding + i * (slotWidth + slotGap) - slotGap / 2;
            ctx.beginPath();
            ctx.moveTo(x, padding - 30);
            ctx.lineTo(x, canvasHeight + 20);
            ctx.stroke();
        }

        zones.forEach((zone, zoneIndex) => {
            const zoneY = padding + (zone.startRow - 1) * (this.layout.yardInfo.slotHeight + slotGap)
                         + zoneIndex * this.layout.yardInfo.zoneGap - 25;

            ctx.fillStyle = '#6b7280';
            ctx.font = 'bold 14px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${zone.id}区`, padding - 30, zoneY + 40);

            const zoneBottomY = padding + zone.endRow * (this.layout.yardInfo.slotHeight + slotGap)
                               + zoneIndex * this.layout.yardInfo.zoneGap;

            ctx.strokeStyle = '#d1d5db';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(padding - 40, zoneBottomY + 5);
            ctx.lineTo(canvasWidth - padding + 40, zoneBottomY + 5);
            ctx.stroke();
            ctx.setLineDash([]);
        });

        ctx.fillStyle = '#6b7280';
        ctx.font = '12px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        for (let i = 1; i <= cols; i++) {
            const x = padding + (i - 1) * (slotWidth + slotGap) + slotWidth / 2;
            ctx.fillText(String(i), x, padding - 10);
        }

        for (let i = 1; i <= rows; i++) {
            const zone = zones.find(z => i >= z.startRow && i <= z.endRow);
            const zoneIndex = zones.indexOf(zone);
            const zoneOffset = zoneIndex * this.layout.yardInfo.zoneGap;
            const y = padding + (i - 1) * (this.layout.yardInfo.slotHeight + slotGap)
                     + zoneOffset + this.layout.yardInfo.slotHeight / 2 + 5;

            ctx.fillText(String(i), padding - 20, y);
        }

        this.alertAnimationFrame = (this.alertAnimationFrame + 1) % 120;

        const visibleSlots = this._getVisibleSlots();
        for (const slot of visibleSlots) {
            this.drawSlot(slot);
        }

        ctx.restore();
    }

    drawSlot(slot) {
        const ctx = this.ctx;
        const color = this.getSlotColor(slot);
        const isSearchResult = this.searchResultSlotIds.includes(slot.id);
        const hasAlert = this.alertSlotSet.has(slot.id);
        const isAlertVisible = hasAlert ? (this.alertAnimationFrame % 30 < 15) : true;

        ctx.save();

        if (hasAlert && !isAlertVisible) {
            ctx.globalAlpha = 0.4;
        }

        ctx.fillStyle = color.fill;
        ctx.strokeStyle = color.border;
        ctx.lineWidth = isSearchResult ? 3 : 1.5;

        if (isSearchResult) {
            ctx.shadowColor = '#2196f3';
            ctx.shadowBlur = 10 + Math.sin(this.alertAnimationFrame * 0.1) * 5;
        }

        ctx.beginPath();
        ctx.roundRect(slot.x_pos, slot.y_pos, slot.width, slot.height, 2);
        ctx.fill();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;

        if (slot.current_layers > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(slot.current_layers.toString(),
                        slot.x_pos + slot.width / 2,
                        slot.y_pos + slot.height / 2);
        }

        if (isSearchResult) {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(slot.x_pos - 3, slot.y_pos - 3, slot.width + 6, slot.height + 6);
            ctx.setLineDash([]);
        }

        ctx.restore();
    }

    bindEvents() {
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                this.offsetX += e.clientX - this.lastMouseX;
                this.offsetY += e.clientY - this.lastMouseY;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.draw();
            }

            const slot = this.getSlotAtPosition(e.clientX, e.clientY);
            if (slot) {
                this.showTooltip(e.clientX, e.clientY, slot);
            } else {
                this.hideTooltip();
            }
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (e.button === 0 && e.shiftKey) {
                this.isDragging = true;
                this.lastMouseX = e.clientX;
                this.lastMouseY = e.clientY;
                this.canvas.style.cursor = 'grabbing';
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.canvas.style.cursor = 'crosshair';
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isDragging = false;
            this.canvas.style.cursor = 'crosshair';
            this.hideTooltip();
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            this.zoom = Math.max(0.5, Math.min(3, this.zoom * delta));
            this.draw();
        });

        this.canvas.addEventListener('click', (e) => {
            if (!this.isDragging) {
                const slot = this.getSlotAtPosition(e.clientX, e.clientY);
                if (slot && this.onSlotClick) {
                    this.onSlotClick(slot);
                }
            }
        });
    }

    showTooltip(x, y, slot) {
        const tooltip = document.getElementById('tooltip');
        if (!tooltip) return;

        const layers = slot.current_layers || 0;
        const statusText = layers === 0 ? '空箱位' : `${layers}层`;
        const weightText = slot.total_weight ? `${slot.total_weight.toFixed(1)}吨` : '0吨';

        const alertInfo = this.alerts.find(a => a.slot_id === slot.id && a.is_active);
        let alertHtml = '';
        if (alertInfo) {
            const ALERT_TYPE_NAMES = {
                'over_height': '超高告警',
                'over_weight': '超重告警',
                'container_overload': '集装箱超载',
                'timeout': '超时告警'
            };
            alertHtml = `<div style="color: #ef4444; margin-top: 5px;">⚠️ ${ALERT_TYPE_NAMES[alertInfo.alert_type] || '告警'}</div>`;
        }

        tooltip.innerHTML = `
            <div class="tooltip-slot-id">${slot.id}</div>
            <div class="tooltip-info">
                <div>区域: ${slot.zone}区</div>
                <div>位置: 第${slot.row_num}行 第${slot.col_num}列</div>
                <div>状态: ${statusText}</div>
                <div>总重: ${weightText}</div>
                ${alertHtml}
            </div>
        `;

        tooltip.classList.add('active');
        tooltip.style.left = (x + 15) + 'px';
        tooltip.style.top = (y + 15) + 'px';
    }

    hideTooltip() {
        const tooltip = document.getElementById('tooltip');
        if (tooltip) {
            tooltip.classList.remove('active');
        }
    }

    zoomIn() {
        this.zoom = Math.min(3, this.zoom * 1.2);
        this.draw();
    }

    zoomOut() {
        this.zoom = Math.max(0.5, this.zoom * 0.8);
        this.draw();
    }

    resetZoom() {
        this.zoom = 1;
        this.offsetX = 0;
        this.offsetY = 0;
        this.draw();
    }

    startAlertAnimation() {
        let lastDrawTime = 0;
        const BLINK_INTERVAL = 500;

        const animate = (timestamp) => {
            if (this.alertSlotSet.size > 0 && timestamp - lastDrawTime >= BLINK_INTERVAL) {
                this.draw();
                lastDrawTime = timestamp;
            }
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    onSlotClick(callback) {
        this.onSlotClick = callback;
    }
}
