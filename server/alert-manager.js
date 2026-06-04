const db = require('./db');
const yardLayout = require('../config/yard-layout.json');

const { thresholdHours } = yardLayout.alertRules.timeout;

async function checkTimeoutAlerts() {
    try {
        const result = await db.query(`
            SELECT c.id, c.container_no, c.slot_id, c.stored_at, c.dangerous_type,
                   s.zone
            FROM containers c
            JOIN slots s ON c.slot_id = s.id
            WHERE c.is_dangerous = true 
              AND c.status = 'stored'
              AND c.stored_at < NOW() - INTERVAL '${thresholdHours} hours'
              AND NOT EXISTS (
                  SELECT 1 FROM alerts a 
                  WHERE a.container_no = c.container_no 
                    AND a.alert_type = 'timeout'
                    AND a.is_active = true
              )
        `);

        for (const row of result.rows) {
            const hoursStored = Math.floor(
                (Date.now() - new Date(row.stored_at).getTime()) / (1000 * 60 * 60)
            );

            await db.query(`
                INSERT INTO alerts (alert_type, alert_level, slot_id, container_no, 
                                   message, value, threshold)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [
                'timeout',
                'warning',
                row.slot_id,
                row.container_no,
                `危险品箱[${row.container_no}](${row.dangerous_type})堆存已超过${thresholdHours}小时`,
                hoursStored,
                thresholdHours
            ]);

            console.log(`触发超时告警: 箱位 ${row.slot_id}, 箱号 ${row.container_no}`);
        }

        return result.rows.length;
    } catch (error) {
        console.error('检查超时告警失败:', error);
        return 0;
    }
}

async function getActiveAlerts() {
    const result = await db.query(`
        SELECT a.*, s.zone, s.row_num, s.col_num,
               c.container_no as cont_no, c.container_type, c.weight, c.is_dangerous
        FROM alerts a
        LEFT JOIN slots s ON a.slot_id = s.id
        LEFT JOIN containers c ON a.container_no = c.container_no AND c.status = 'stored'
        WHERE a.is_active = true
        ORDER BY a.created_at DESC
    `);
    return result.rows;
}

async function resolveAlert(alertId, resolvedBy) {
    await db.query(`
        UPDATE alerts 
        SET is_active = false, resolved_at = CURRENT_TIMESTAMP, resolved_by = $1
        WHERE id = $2
    `, [resolvedBy, alertId]);
}

function startAlertChecker(intervalMs = 60000, onNewAlerts) {
    setInterval(async () => {
        const newAlerts = await checkTimeoutAlerts();
        if (newAlerts > 0 && onNewAlerts) {
            onNewAlerts();
        }
    }, intervalMs);
}

async function getYardStatistics() {
    const zones = ['A', 'B', 'C', 'D', 'E'];
    const stats = {
        totalSlots: 500,
        totalContainers: 0,
        usedSlots: 0,
        zones: {},
        alerts: {
            total: 0,
            over_height: 0,
            over_weight: 0,
            timeout: 0
        }
    };

    for (const zone of zones) {
        const result = await db.query(`
            SELECT COUNT(*) as total_slots,
                   COALESCE(SUM(CASE WHEN ss.current_layers > 0 THEN 1 ELSE 0 END), 0) as used_slots,
                   COALESCE(SUM(ss.current_layers), 0) as total_containers,
                   COALESCE(SUM(ss.total_weight), 0) as total_weight
            FROM slots s
            LEFT JOIN slot_status ss ON s.id = ss.slot_id
            WHERE s.zone = $1
        `, [zone]);

        const row = result.rows[0];
        stats.zones[zone] = {
            name: `${zone}区`,
            totalSlots: parseInt(row.total_slots),
            usedSlots: parseInt(row.used_slots),
            totalContainers: parseInt(row.total_containers),
            totalWeight: parseFloat(row.total_weight),
            utilizationRate: row.total_slots > 0 
                ? Math.round((row.used_slots / row.total_slots) * 100) 
                : 0
        };

        stats.usedSlots += parseInt(row.used_slots);
        stats.totalContainers += parseInt(row.total_containers);
    }

    const alertResult = await db.query(`
        SELECT alert_type, COUNT(*) as count
        FROM alerts 
        WHERE is_active = true
        GROUP BY alert_type
    `);

    for (const row of alertResult.rows) {
        stats.alerts[row.alert_type] = parseInt(row.count);
        stats.alerts.total += parseInt(row.count);
    }

    stats.totalUtilizationRate = Math.round((stats.usedSlots / stats.totalSlots) * 100);

    return stats;
}

module.exports = {
    checkTimeoutAlerts,
    getActiveAlerts,
    resolveAlert,
    startAlertChecker,
    getYardStatistics
};
