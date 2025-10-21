## 手动测试计划

> 所有步骤默认在 `debug` 模式下进行，并确保 `study_room` 配置已加载（可在 `data/config.ini` 中覆盖窗口/阈值以加快验证）。

### 1. 基础弹幕指令
- 启动后端 `python main.py --debug` 并打开 `http://localhost:12450/custom_public/study-room/index.html?roomKeyValue=<房间ID>`.
- 调用 `POST /api/study_room/mock_message`，body：
  ```json
  {"user":"Alice","text":"/加入图书馆"}
  ```
  期望：Alice 入座并在系统消息与前端 toast 中看到确认；`joinPrompt.availableSeatCount` 递减。

### 2. 候补队列
- 连续发送 20 条 `/加入图书馆` 弹幕至各用户直至座位填满。
- 对新用户 `Bob` 再次发送 `/加入图书馆!!!`（带噪声标点）。
  期望：后端返回候补系统消息，响应中的 `waitlist` 列表包含 Bob，前端候补面板显示队列顺序。

### 3. 候补晋升
- 模拟现有座位用户发送 `/离开座位`。
- 期望：候补第一位自动入座，系统消息与 toast 显示晋升信息，`waitlist` 更新。

### 4. 活跃/离席策略
- 在 `config.ini` 中将 `activity_window_ms` 与 `inactivity_timeout_ms` 临时调为 `60000`（1 分钟），重载配置。
- 让某座位用户 1 分钟内不发送弹幕。
  期望：超过 1 分钟自动离席，`recentEvents` 注入 `auto_leave`，数据库 `study_room_sessions` 中更新 `last_status='away'`、`last_leave_reason`。

### 5. 数据持久化校验
- 使用 SQLite 浏览 `data/database.db`，查询 `study_room_sessions` 表，确认：
  - `room_key_type/room_key_value` 匹配当前房间；
  - `user_id` 为弹幕 UID（fallback 为昵称）；
  - `total_study_ms` 随 status 变化累积。

### 6. 前端展现
- 进入 overlay 页面，确认：
  - 顶部加入 banner 在有空位时显示，文案跟随配置更新；
  - 候补列表、系统消息、toast 与后端事件保持一致；
  - 调试面板示例命令根据配置更新 `/` 前缀与 join/leave 别名。

### 7. 回归验证
- 发送普通弹幕 `hello world`（非命令），确认系统消息仍记录原格式，且不会触发 seat 状态变化。
- 验证原有学习榜与座位状态刷新不受影响。

### 8. 断线重连保持座位
- 断开 blivechat 客户端（停止抓取或关闭页面），等待房间在后台清理完成后重新连接。
- 期望：在离线间隔短于自动离席阈值的情况下，重新连线后先前入座的观众仍显示占座；候补队列顺序保持不变。

