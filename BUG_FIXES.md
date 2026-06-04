# Bug修复说明文档

## 概述

本文档记录了智慧港口集装箱堆场监控系统的三个核心Bug的修复过程，包括问题定位、根本原因分析和修复方案。

---

## 🐛 Bug 1: WebSocket消息乱序导致箱位状态更新错误

### 问题描述

当吊装作业频繁时，WebSocket消息可能乱序到达前端，导致箱位状态更新错误。例如：
- 实际操作顺序：放入集装箱A → 放入集装箱B → 移走集装箱A
- 消息到达顺序：移走集装箱A → 放入集装箱A → 放入集装箱B
- 结果：箱位状态计算错误，显示异常的层数和重量

### 问题定位过程

1. **现象观察**：在模拟高频吊装操作时，前端显示的箱位层数偶尔与实际不符
2. **日志分析**：查看前后端日志，发现消息发送顺序和接收顺序不一致
3. **原因确认**：WebSocket基于TCP，但网络延迟和消息处理时间差异可能导致乱序
4. **影响范围**：所有依赖实时消息的功能（箱位状态更新、统计数据、告警）

### 根本原因

1. 网络传输延迟差异导致消息到达顺序不可保证
2. 后端并发处理消息时，处理完成的顺序可能与接收顺序不同
3. 前端直接按接收顺序处理，未进行消息排序

### 修复方案

#### 后端改动（server/app.js）

1. **添加消息序列号生成器**（第24-34行）
   - 全局序列号（global）：确保所有消息都有唯一递增序号
   - 箱位级序列号（slot）：每个箱位独立维护消息序号

   ```javascript
   const messageSequence = {
       global: 0,
       slot: {}
   };

   function getNextSequence(slotId) {
       if (!messageSequence.slot[slotId]) {
           messageSequence.slot[slotId] = 0;
       }
       messageSequence.slot[slotId]++;
       messageSequence.global++;
       return {
           global: messageSequence.global,
           slot: messageSequence.slot[slotId]
       };
   }
   ```

2. **添加带序列号的广播函数**（第165-180行）
   - 在消息中附加全局序列号、箱位级序列号、时间戳
   - 使用统一的broadcastWithSequence替代原来的broadcast

3. **添加箱位级消息队列和锁机制**（第29-30行、第182-218行）
   - 按箱位隔离消息队列，避免不同箱位的操作互相阻塞
   - 使用锁机制确保同一箱位的消息串行处理
   - 按客户端序列号排序后处理

   ```javascript
   const sensorMessageQueue = new Map();
   const processingLocks = new Set();

   async function enqueueSensorMessage(data) {
       // 按箱位入队并排序
       // ...
   }

   async function processSensorQueue(slotId) {
       // 单箱位串行处理
       // ...
   }
   ```

#### 前端改动（public/js/app.js）

1. **添加消息队列管理属性**（第11-16行）
   - 全局消息队列（messageQueue）
   - 箱位级消息队列（slotMessageQueues）
   - 最后处理序列号跟踪

   ```javascript
   this.lastProcessedSequence = 0;
   this.messageQueue = [];
   this.isProcessingQueue = false;

   this.slotMessageQueues = new Map();
   this.slotLastSequence = new Map();
   ```

2. **添加消息入队和排序逻辑**（第147-233行）
   - 箱位状态更新（slot_updated）按箱位独立排队
   - 全局消息（统计、告警）按全局序列号排队
   - 检测到序列号不连续时暂存，等待前序消息到达

   ```javascript
   enqueueWebSocketMessage(message) {
       if (message.slotId && message.type === 'slot_updated') {
           this.enqueueSlotMessage(message);
           return;
       }
       // ... 全局消息处理
   }

   processSlotMessageQueue(slotId) {
       // 只处理序列号连续的消息
       while (queue.length > 0) {
           if (msgSeq === lastSeq + 1) {
               // 处理消息
           } else {
               break;
           }
       }
   }
   ```

3. **添加队列积压保护**（第222-227行）
   - 当队列积压超过100条时，自动跳转到最新消息
   - 避免内存泄漏和处理停滞

### 改动文件

- `server/app.js` - ~120行新增代码
- `server/alert-manager.js` - 修改告警检查回调方式
- `public/js/app.js` - ~120行新增代码

---

## 🐛 Bug 2: 集装箱查询全表扫描性能问题

### 问题描述

集装箱查询在500个箱位（约500-1000个集装箱）中全表扫描，查询耗时超过1秒，用户体验差。

### 问题定位过程

1. **现象观察**：输入箱号搜索时，界面卡顿明显，响应时间长
2. **性能测试**：使用EXPLAIN分析SQL查询执行计划
3. **发现问题**：
   - `container_no` 字段只有主键约束，无专门索引
   - 模糊查询（ILIKE）无法使用普通B树索引
   - 全表扫描（Seq Scan）耗时随数据量增长线性增加

4. **影响范围**：集装箱搜索功能，高并发时可能影响整个数据库性能

### 根本原因

1. 缺少 `container_no` 字段的普通索引
2. 模糊查询（`ILIKE '%xxx%'`）无法使用B树索引
3. 没有应用层缓存，相同查询重复访问数据库

### 修复方案

#### 数据库改动（database/init.sql）

1. **启用pg_trgm扩展**（第9-10行）
   - PostgreSQL的三元组（trigram）索引扩展
   - 支持模糊查询的高效索引

   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

2. **添加双重索引**（第78-79行）
   - B树索引：用于精确匹配和前缀查询
   - GIN索引：基于pg_trgm，用于模糊查询

   ```sql
   CREATE INDEX idx_containers_container_no ON containers(container_no);
   CREATE INDEX idx_containers_container_no_gin ON containers USING gin (container_no gin_trgm_ops);
   ```

#### 后端改动（server/app.js）

1. **添加缓存机制**（第32-34行）
   - LRU缓存（使用Map实现）
   - 30秒TTL（Time-To-Live）
   - 最大缓存100条记录

   ```javascript
   const searchCache = new Map();
   const SEARCH_CACHE_TTL = 30000;
   const SEARCH_CACHE_MAX_SIZE = 100;
   ```

2. **缓存管理函数**（第90-116行）
   - `getSearchCache(key)` - 获取缓存，自动过期清理
   - `setSearchCache(key, data)` - 设置缓存，LRU淘汰
   - `clearSearchCache()` - 数据变更时清除缓存

3. **查询接口改造**（第118-147行）
   - 优先读取缓存
   - 缓存未命中时查询数据库
   - 查询结果写入缓存

4. **数据变更时清除缓存**（第308行）
   - 在handleSensorDataInternal中，集装箱状态变化后清除缓存
   - 确保缓存数据与数据库一致

### 性能提升预期

| 场景 | 优化前 | 优化后 | 提升 |
|------|--------|--------|------|
| 首次查询 | ~1200ms | ~50ms | 24倍 |
| 缓存命中 | ~1200ms | ~1ms | 1200倍 |
| 模糊查询 | ~1500ms | ~80ms | 18倍 |

### 改动文件

- `database/init.sql` - 3行新增（扩展+2个索引）
- `server/app.js` - ~50行新增代码（缓存逻辑）

---

## 🐛 Bug 3: 超重告警未考虑多层堆叠的实际载荷

### 问题描述

超重告警只按箱位总重量判定，未考虑多层堆叠时下层集装箱承受的实际压力。实际上，底层集装箱需要承受上方所有集装箱的重量之和。

### 问题定位过程

1. **现象观察**：一个箱位堆叠6个各重10吨的集装箱，总重量60吨（未超地面承重180吨），但底层集装箱实际承受50吨（上方5个箱），远超集装箱额定载荷30.48吨
2. **代码审查**：检查 `check_over_weight_alert` 触发器函数
3. **发现问题**：只比较 `total_weight` 和 `weight_limit`（地面承重），未考虑单个集装箱的承载能力
4. **业务风险**：可能导致集装箱损坏或安全事故

### 根本原因

1. **混淆承重概念**：
   - 地面承重（ground capacity）：箱位地面能承受的总重量
   - 集装箱载重（container capacity）：单个集装箱能承受的上方载荷

2. **缺少分层计算**：没有为每个集装箱计算其承受的上层累计重量

### 修复方案

#### 数据库改动（database/init.sql）

1. **添加部分唯一索引**（第67-69行）
   - 避免同一箱位/集装箱的重复告警
   - 支持ON CONFLICT DO NOTHING

   ```sql
   CREATE UNIQUE INDEX idx_active_slot_alert ON alerts (slot_id, alert_type) WHERE is_active = true;
   CREATE UNIQUE INDEX idx_active_container_alert ON alerts (container_no, alert_type) WHERE is_active = true;
   ```

2. **新增集装箱超载检测函数**（第139-172行）
   - 遍历箱位内的每个集装箱
   - 计算每个集装箱上方的累计重量
   - 与额定载重（标准20尺柜约30.48吨）比较

   ```sql
   CREATE OR REPLACE FUNCTION check_container_overload_alert()
   RETURNS TRIGGER AS $$
   DECLARE
       container_row RECORD;
       upper_weight NUMERIC;
       container_capacity NUMERIC := 30.48;  -- 标准20尺柜额定载重
   BEGIN
       FOR container_row IN 
           SELECT c.id, c.container_no, c.slot_id, c.layer_num, c.weight
           FROM containers c
           WHERE c.slot_id = NEW.slot_id
           ORDER BY c.layer_num ASC
       LOOP
           -- 计算上方累计重量
           SELECT COALESCE(SUM(weight), 0) INTO upper_weight
           FROM containers 
           WHERE slot_id = NEW.slot_id AND layer_num > container_row.layer_num;

           IF upper_weight > container_capacity THEN
               -- 触发告警
               INSERT INTO alerts (...)
               VALUES ('container_overload', ...)
               ON CONFLICT DO NOTHING;
           END IF;
       END LOOP;
       RETURN NEW;
   END;
   $$ LANGUAGE plpgsql;
   ```

3. **添加触发器**（第183-185行）
   - 在箱位总重量更新时触发检测

   ```sql
   CREATE TRIGGER trigger_check_container_overload
   AFTER UPDATE OF total_weight ON slot_status
   FOR EACH ROW EXECUTE FUNCTION check_container_overload_alert();
   ```

#### 前端改动

1. **添加告警类型样式**（public/css/style.css，第313-316行）
   ```css
   .alert-item.container_overload {
       border-color: #ff9800;
       background: #fff3e0;
   }
   ```

2. **添加告警类型配置**（public/js/app.js，第513行）
   ```javascript
   'container_overload': { name: '集装箱超载', level: 'warning' }
   ```

3. **添加告警颜色配置**（config/yard-layout.json，第68行、第87-92行）
   ```json
   "container_overload": { "fill": "#ff9800", "border": "#ef6c00", "label": "箱超载" }
   ```

### 告警类型说明

修复后系统支持三种超重相关告警：

| 告警类型 | 检测对象 | 触发条件 | 级别 | 颜色 |
|---------|---------|---------|------|------|
| over_weight | 箱位地面 | 总重量 > 地面承重 | 危险 | 橙色 |
| container_overload | 单个集装箱 | 上层重量 > 箱额定载重 | 警告 | 深橙 |
| over_height | 箱位层数 | 层数 > 最大层数 | 危险 | 紫色 |

### 改动文件

- `database/init.sql` - ~50行新增/修改代码
- `public/css/style.css` - 4行新增
- `public/js/app.js` - 1行新增
- `config/yard-layout.json` - 7行新增

---

## 🔧 验证方法

### Bug 1 验证

1. 启动服务器，观察控制台日志
2. 查看WebSocket消息，确认每条消息带有 `sequence` 和 `slotSequence` 字段
3. 模拟高频操作，验证状态更新正确
4. 检查前端队列处理日志

### Bug 2 验证

1. 执行 `\di` 查看索引是否创建成功
2. 使用 `EXPLAIN ANALYZE` 验证查询使用索引
3. 连续搜索相同箱号，观察响应时间（应从第二次开始明显加快）
4. 修改集装箱状态后，验证缓存被清除

### Bug 3 验证

1. 在一个箱位放入多个重箱（每个15吨，放4个）
2. 观察是否触发 `container_overload` 告警（底层承受45吨，超过30.48吨）
3. 检查告警列表中显示的告警类型和详细信息
4. 查看地图上对应箱位的闪烁颜色（应为橙色）

---

## 📊 改动总结

| Bug | 新增代码 | 修改文件 | 复杂度 |
|-----|---------|---------|--------|
| 1. WebSocket消息乱序 | ~240行 | 后端+前端 | 高 |
| 2. 查询性能优化 | ~53行 | 数据库+后端 | 中 |
| 3. 超重告警计算 | ~61行 | 数据库+前端+配置 | 中 |

**总计新增/修改代码：约354行，涉及7个文件**
