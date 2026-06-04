class YardStatistics {
    constructor() {
        this.data = null;
    }

    update(statsData) {
        this.data = statsData;
    }

    render() {
        if (!this.data) return;

        document.getElementById('total-slots').textContent = this.data.totalSlots;
        document.getElementById('used-slots').textContent = this.data.usedSlots;
        document.getElementById('total-containers').textContent = this.data.totalContainers;
        document.getElementById('utilization-rate').textContent = `${this.data.totalUtilizationRate}%`;

        const zoneContainer = document.getElementById('zone-stats-container');
        let zoneHtml = '';

        for (const [zoneId, zone] of Object.entries(this.data.zones)) {
            zoneHtml += `
                <div class="zone-stat-item">
                    <span class="zone-name">${zone.name}</span>
                    <div class="zone-bar">
                        <div class="zone-bar-fill ${zoneId}" style="width: ${zone.utilizationRate}%"></div>
                    </div>
                    <span class="zone-percent">${zone.utilizationRate}%</span>
                </div>
                <div class="zone-detail" style="margin-left: 45px; margin-bottom: 8px;">
                    ${zone.usedSlots}/${zone.totalSlots}箱位 | ${zone.totalContainers}箱 | ${zone.totalWeight.toFixed(0)}吨
                </div>
            `;
        }

        zoneContainer.innerHTML = zoneHtml;
    }

    decrementAlertCount() {
        if (this.data && this.data.alerts) {
            this.data.alerts.total--;
        }
    }
}
