-- 智慧港口集装箱堆场监控系统 数据库初始化脚本

-- 创建数据库
CREATE DATABASE port_yard_monitor;

-- 连接到数据库
\c port_yard_monitor;

-- 启用pg_trgm扩展用于模糊查询索引
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 箱位表
CREATE TABLE slots (
    id VARCHAR(20) PRIMARY KEY,
    row_num INTEGER NOT NULL,
    col_num INTEGER NOT NULL,
    zone VARCHAR(50) NOT NULL,
    max_layers INTEGER DEFAULT 6,
    weight_limit NUMERIC(10,2) DEFAULT 180.00,
    x_pos INTEGER NOT NULL,
    y_pos INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 集装箱表
CREATE TABLE containers (
    id SERIAL PRIMARY KEY,
    container_no VARCHAR(50) UNIQUE NOT NULL,
    container_type VARCHAR(20) NOT NULL,
    weight NUMERIC(10,2) NOT NULL,
    is_dangerous BOOLEAN DEFAULT FALSE,
    dangerous_type VARCHAR(100),
    slot_id VARCHAR(20) REFERENCES slots(id),
    layer_num INTEGER NOT NULL,
    stored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'stored'
);

-- 箱位状态表（实时状态）
CREATE TABLE slot_status (
    slot_id VARCHAR(20) PRIMARY KEY REFERENCES slots(id),
    current_layers INTEGER DEFAULT 0,
    total_weight NUMERIC(10,2) DEFAULT 0,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rfid_status VARCHAR(20) DEFAULT 'normal',
    laser_status VARCHAR(20) DEFAULT 'normal'
);

-- 告警表
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    alert_type VARCHAR(50) NOT NULL,
    alert_level VARCHAR(20) DEFAULT 'warning',
    slot_id VARCHAR(20) REFERENCES slots(id),
    container_no VARCHAR(50),
    message TEXT NOT NULL,
    value NUMERIC(10,2),
    threshold NUMERIC(10,2),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP,
    resolved_by VARCHAR(50)
);

-- 创建部分唯一索引用于避免重复告警
CREATE UNIQUE INDEX idx_active_slot_alert ON alerts (slot_id, alert_type) WHERE is_active = true;
CREATE UNIQUE INDEX idx_active_container_alert ON alerts (container_no, alert_type) WHERE is_active = true;

-- 操作日志表
CREATE TABLE operation_logs (
    id SERIAL PRIMARY KEY,
    operation_type VARCHAR(50) NOT NULL,
    slot_id VARCHAR(20) REFERENCES slots(id),
    container_no VARCHAR(50),
    details TEXT,
    operator VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 索引
CREATE INDEX idx_containers_slot_id ON containers(slot_id);
CREATE INDEX idx_containers_status ON containers(status);
CREATE INDEX idx_containers_container_no ON containers(container_no);
CREATE INDEX idx_containers_container_no_gin ON containers USING gin (container_no gin_trgm_ops);
CREATE INDEX idx_alerts_slot_id ON alerts(slot_id);
CREATE INDEX idx_alerts_is_active ON alerts(is_active);
CREATE INDEX idx_slot_status_slot_id ON slot_status(slot_id);

-- 插入500个箱位数据（通过应用程序初始化，此处为示例）
-- 箱位布局：25行 x 20列 = 500个箱位，分为5个区域
-- A区: 行1-5, B区: 行6-10, C区: 行11-15, D区: 行16-20, E区: 行21-25

-- 创建更新时间戳函数
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_updated = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 为slot_status表创建触发器
CREATE TRIGGER update_slot_status_modtime
BEFORE UPDATE ON slot_status
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 检查超高告警函数
CREATE OR REPLACE FUNCTION check_over_height_alert()
RETURNS TRIGGER AS $$
DECLARE
    max_layers_val INTEGER;
BEGIN
    SELECT max_layers INTO max_layers_val FROM slots WHERE id = NEW.slot_id;
    IF NEW.current_layers > max_layers_val THEN
        INSERT INTO alerts (alert_type, alert_level, slot_id, message, value, threshold)
        VALUES ('over_height', 'danger', NEW.slot_id, 
                '箱位堆叠超过最大层数限制', NEW.current_layers, max_layers_val)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 检查地面超重告警函数（箱位总重量）
CREATE OR REPLACE FUNCTION check_over_weight_alert()
RETURNS TRIGGER AS $$
DECLARE
    weight_limit_val NUMERIC;
BEGIN
    SELECT weight_limit INTO weight_limit_val FROM slots WHERE id = NEW.slot_id;
    IF NEW.total_weight > weight_limit_val THEN
        INSERT INTO alerts (alert_type, alert_level, slot_id, message, value, threshold)
        VALUES ('over_weight', 'danger', NEW.slot_id, 
                '箱位总重量超过地面承载极限', NEW.total_weight, weight_limit_val)
        ON CONFLICT ON CONSTRAINT idx_active_slot_alert DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 检查集装箱超载告警函数（考虑上层重量的累积载荷）
CREATE OR REPLACE FUNCTION check_container_overload_alert()
RETURNS TRIGGER AS $$
DECLARE
    container_row RECORD;
    upper_weight NUMERIC;
    container_capacity NUMERIC := 30.48;
    actual_load NUMERIC;
BEGIN
    FOR container_row IN 
        SELECT c.id, c.container_no, c.slot_id, c.layer_num, c.weight
        FROM containers c
        WHERE c.slot_id = NEW.slot_id AND c.status = 'stored'
        ORDER BY c.layer_num ASC
    LOOP
        SELECT COALESCE(SUM(weight), 0) INTO upper_weight
        FROM containers 
        WHERE slot_id = NEW.slot_id 
          AND status = 'stored' 
          AND layer_num > container_row.layer_num;
        
        actual_load := upper_weight;
        
        IF actual_load > container_capacity THEN
            INSERT INTO alerts (alert_type, alert_level, slot_id, container_no, message, value, threshold, is_active)
            VALUES ('container_overload', 'warning', container_row.slot_id, container_row.container_no,
                    '集装箱承载超载，上层累计重量超过限制', actual_load, container_capacity, true)
            ON CONFLICT ON CONSTRAINT idx_active_container_alert DO NOTHING;
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
CREATE TRIGGER trigger_check_over_height
AFTER UPDATE OF current_layers ON slot_status
FOR EACH ROW EXECUTE FUNCTION check_over_height_alert();

CREATE TRIGGER trigger_check_over_weight
AFTER UPDATE OF total_weight ON slot_status
FOR EACH ROW EXECUTE FUNCTION check_over_weight_alert();

CREATE TRIGGER trigger_check_container_overload
AFTER UPDATE OF total_weight ON slot_status
FOR EACH ROW EXECUTE FUNCTION check_container_overload_alert();
