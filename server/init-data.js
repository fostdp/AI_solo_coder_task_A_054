const db = require('./db');
const { generateSlots, generateMockContainers } = require('./slot-generator');

async function initializeDatabase() {
    try {
        console.log('开始初始化数据库...');

        const slotCountResult = await db.query('SELECT COUNT(*) FROM slots');
        const slotCount = parseInt(slotCountResult.rows[0].count);

        if (slotCount === 0) {
            console.log('正在生成500个箱位数据...');
            const slots = generateSlots();
            
            for (const slot of slots) {
                await db.query(
                    `INSERT INTO slots (id, row_num, col_num, zone, max_layers, weight_limit, x_pos, y_pos, width, height)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [slot.id, slot.row_num, slot.col_num, slot.zone, slot.max_layers, 
                     slot.weight_limit, slot.x_pos, slot.y_pos, slot.width, slot.height]
                );

                await db.query(
                    `INSERT INTO slot_status (slot_id, current_layers, total_weight)
                     VALUES ($1, 0, 0)`,
                    [slot.id]
                );
            }

            console.log('箱位数据初始化完成，共生成', slots.length, '个箱位');

            console.log('正在生成模拟集装箱数据...');
            const containers = generateMockContainers(slots);
            
            for (const container of containers) {
                try {
                    await db.query(
                        `INSERT INTO containers (container_no, container_type, weight, is_dangerous, 
                         dangerous_type, slot_id, layer_num, stored_at, status)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                        [container.container_no, container.container_type, container.weight,
                         container.is_dangerous, container.dangerous_type, container.slot_id,
                         container.layer_num, container.stored_at, container.status]
                    );
                } catch (e) {
                    if (e.code !== '23505') {
                        console.error('插入集装箱数据错误:', e.message);
                    }
                }
            }

            console.log('集装箱数据初始化完成，共生成', containers.length, '个集装箱');
            await updateSlotStatus();
            console.log('箱位状态更新完成');
        } else {
            console.log('数据库已初始化，箱位数:', slotCount);
        }

        console.log('数据库初始化完成');
    } catch (error) {
        console.error('数据库初始化失败:', error);
    }
}

async function updateSlotStatus() {
    const slots = await db.query('SELECT id FROM slots');
    
    for (const slot of slots.rows) {
        const result = await db.query(
            `SELECT COUNT(*) as layers, COALESCE(SUM(weight), 0) as total_weight
             FROM containers 
             WHERE slot_id = $1 AND status = 'stored'`,
            [slot.id]
        );

        const { layers, total_weight } = result.rows[0];
        
        await db.query(
            `UPDATE slot_status 
             SET current_layers = $1, total_weight = $2, last_updated = CURRENT_TIMESTAMP
             WHERE slot_id = $3`,
            [parseInt(layers), parseFloat(total_weight), slot.id]
        );
    }
}

module.exports = { initializeDatabase, updateSlotStatus };
