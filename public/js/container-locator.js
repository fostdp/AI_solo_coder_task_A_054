const ALERT_TYPE_MAP = {
    'over_height': '超高告警',
    'over_weight': '地面超重告警',
    'container_overload': '集装箱超载',
    'timeout': '超时告警'
};

class ContainerLocator {
    constructor() {
        this.searchResultSlotIds = [];
    }

    async search(containerNo) {
        if (!containerNo) {
            return { results: [], slotIds: [], error: '请输入箱号' };
        }

        try {
            const response = await fetch(`/api/containers/search?containerNo=${encodeURIComponent(containerNo)}`);
            const results = await response.json();

            if (!results.length) {
                this.searchResultSlotIds = [];
                return { results: [], slotIds: [], error: null };
            }

            this.searchResultSlotIds = [...new Set(results.map(r => r.slot_id))];
            return { results, slotIds: this.searchResultSlotIds, error: null };
        } catch (error) {
            console.error('搜索失败:', error);
            return { results: [], slotIds: [], error: '搜索失败' };
        }
    }

    async fetchSlotDetail(slotId) {
        try {
            const response = await fetch(`/api/slots/${slotId}`);
            return await response.json();
        } catch (error) {
            console.error('获取箱位详情失败:', error);
            return null;
        }
    }

    getAlertTypeName(alertType) {
        return ALERT_TYPE_MAP[alertType] || '告警';
    }

    clearSearch() {
        this.searchResultSlotIds = [];
    }
}

window.ContainerLocator = ContainerLocator;
window.ALERT_TYPE_MAP = ALERT_TYPE_MAP;
