const db = require('./db');

const searchCache = new Map();
const SEARCH_CACHE_TTL = 30000;
const SEARCH_CACHE_MAX_SIZE = 100;

class YardStateManager {
    constructor() {
        this._onSlotChanged = null;
    }

    onSlotChanged(callback) {
        this._onSlotChanged = callback;
    }

    async updateSlotStatus(changedSlotId) {
        const slotIds = changedSlotId ? [changedSlotId] : (await db.query('SELECT id FROM slots')).rows.map(r => r.id);

        for (const slotId of slotIds) {
            const result = await db.query(
                `SELECT COUNT(*) as layers, COALESCE(SUM(weight), 0) as total_weight
                 FROM containers 
                 WHERE slot_id = $1 AND status = 'stored'`,
                [slotId]
            );

            const { layers, total_weight } = result.rows[0];

            await db.query(
                `UPDATE slot_status 
                 SET current_layers = $1, total_weight = $2, last_updated = CURRENT_TIMESTAMP
                 WHERE slot_id = $3`,
                [parseInt(layers), parseFloat(total_weight), slotId]
            );
        }

        this._clearSearchCache();

        if (this._onSlotChanged) {
            await this._onSlotChanged(changedSlotId || null);
        }
    }

    async getSlotWithStatus(slotId) {
        const result = await db.query(`
            SELECT s.*, ss.current_layers, ss.total_weight, ss.last_updated,
                   ss.rfid_status, ss.laser_status
            FROM slots s
            LEFT JOIN slot_status ss ON s.id = ss.slot_id
            WHERE s.id = $1
        `, [slotId]);
        return result.rows[0] || null;
    }

    async getAllSlotsWithStatus() {
        const result = await db.query(`
            SELECT s.*, ss.current_layers, ss.total_weight, ss.last_updated,
                   ss.rfid_status, ss.laser_status
            FROM slots s
            LEFT JOIN slot_status ss ON s.id = ss.slot_id
            ORDER BY s.row_num, s.col_num
        `);
        return result.rows;
    }

    async getSlotDetail(slotId) {
        const slotResult = await db.query(`
            SELECT s.*, ss.current_layers, ss.total_weight, ss.last_updated
            FROM slots s
            LEFT JOIN slot_status ss ON s.id = ss.slot_id
            WHERE s.id = $1
        `, [slotId]);

        if (slotResult.rows.length === 0) return null;

        const containersResult = await db.query(`
            SELECT * FROM containers 
            WHERE slot_id = $1 AND status = 'stored'
            ORDER BY layer_num
        `, [slotId]);

        return {
            slot: slotResult.rows[0],
            containers: containersResult.rows
        };
    }

    async searchContainers(containerNo) {
        if (!containerNo) return [];

        const cacheKey = containerNo.toLowerCase().trim();
        const cachedResult = this._getSearchCache(cacheKey);
        if (cachedResult) return cachedResult;

        const result = await db.query(`
            SELECT c.*, s.row_num, s.col_num, s.zone, s.x_pos, s.y_pos,
                   s.width, s.height, ss.current_layers
            FROM containers c
            JOIN slots s ON c.slot_id = s.id
            JOIN slot_status ss ON s.id = ss.slot_id
            WHERE c.container_no ILIKE $1 AND c.status = 'stored'
            LIMIT 10
        `, [`%${containerNo}%`]);

        this._setSearchCache(cacheKey, result.rows);
        return result.rows;
    }

    _getSearchCache(key) {
        const cached = searchCache.get(key);
        if (!cached) return null;

        if (Date.now() - cached.timestamp > SEARCH_CACHE_TTL) {
            searchCache.delete(key);
            return null;
        }

        return cached.data;
    }

    _setSearchCache(key, data) {
        if (searchCache.size >= SEARCH_CACHE_MAX_SIZE) {
            const firstKey = searchCache.keys().next().value;
            searchCache.delete(firstKey);
        }

        searchCache.set(key, { data, timestamp: Date.now() });
    }

    _clearSearchCache() {
        searchCache.clear();
    }
}

module.exports = new YardStateManager();
