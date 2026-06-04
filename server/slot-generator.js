const yardLayout = require('../config/yard-layout.json');

function generateSlots() {
    const slots = [];
    const { yardInfo, zones } = yardLayout;
    const { rows, cols, padding, slotWidth, slotHeight, slotGap, zoneGap } = yardInfo;

    for (let row = 1; row <= rows; row++) {
        let zone = null;
        for (const z of zones) {
            if (row >= z.startRow && row <= z.endRow) {
                zone = z;
                break;
            }
        }

        const zoneIndex = zones.indexOf(zone);
        const zoneOffset = zoneIndex * zoneGap;

        for (let col = 1; col <= cols; col++) {
            const slotId = `${zone.id}${String(row).padStart(2, '0')}${String(col).padStart(2, '0')}`;
            const x = padding + (col - 1) * (slotWidth + slotGap);
            const y = padding + (row - 1) * (slotHeight + slotGap) + zoneOffset;

            slots.push({
                id: slotId,
                row_num: row,
                col_num: col,
                zone: zone.id,
                max_layers: zone.maxLayers,
                weight_limit: zone.weightLimit,
                x_pos: x,
                y_pos: y,
                width: slotWidth,
                height: slotHeight
            });
        }
    }

    return slots;
}

function generateMockContainers(slots) {
    const containers = [];
    const containerTypes = ['20GP', '40GP', '40HC', '20RF', '40RF'];
    const dangerousTypes = ['易燃品', '爆炸品', '腐蚀品', '氧化剂', '放射性'];
    const usedSlots = new Set();
    const totalContainers = Math.floor(slots.length * 0.7);

    for (let i = 0; i < totalContainers; i++) {
        let slotIndex;
        do {
            slotIndex = Math.floor(Math.random() * slots.length);
        } while (usedSlots.has(slotIndex) && usedSlots.size < slots.length);
        
        if (usedSlots.size >= slots.length) break;
        usedSlots.add(slotIndex);

        const slot = slots[slotIndex];
        const layers = Math.floor(Math.random() * slot.max_layers) + 1;
        const isDangerous = Math.random() < 0.1;
        const hoursAgo = Math.floor(Math.random() * 48);
        const storedAt = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

        for (let layer = 1; layer <= layers; layer++) {
            const containerNo = `CN${Math.floor(Math.random() * 9000000 + 1000000)}`;
            const weight = Math.floor(Math.random() * 25 + 5);
            const type = containerTypes[Math.floor(Math.random() * containerTypes.length)];

            containers.push({
                container_no: containerNo,
                container_type: type,
                weight: weight,
                is_dangerous: isDangerous && layer === 1,
                dangerous_type: isDangerous && layer === 1 
                    ? dangerousTypes[Math.floor(Math.random() * dangerousTypes.length)] 
                    : null,
                slot_id: slot.id,
                layer_num: layer,
                stored_at: storedAt.toISOString(),
                status: 'stored'
            });
        }
    }

    return containers;
}

module.exports = { generateSlots, generateMockContainers };
