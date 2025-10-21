## 手动测试计划

> 使用 `npm run build` 确保多入口构建成功，并将 dist 同步到后端 `WEB_ROOT`。

### 1. 基础渲染
- 构建前端：`cd frontend && npm run build`。
- 启动后端：`python main.py --debug`。
- 打开 `http://localhost:12450/custom_public/study-room/index.html?roomKeyValue=<房间ID>`。
- 期望：页面加载像素风背景，左侧为主图书馆，右侧显示座位表。

### 2. 座位表排序
- 模拟多名观众入座：使用 `POST /api/study_room/mock_message` 发送不同用户的入座命令。
- 期望：右侧座位板按学习时长降序排列，显示座位编号与学习时间。

### 3. 候补与提示
- 填满所有座位后继续加入新用户。
- 期望：左下角候补面板显示队列顺序；加入提示横幅显示剩余空位为 0。

### 4. 连接状态
- 暂停弹幕源或关闭后端，等待轮询失败。
- 期望：左侧主区域出现“连接中断”遮罩，右侧状态点变为灰色。

### 5. 背景切换
- 在 URL 中追加 `&background=https://example.com/pixel-map.png`。
- 期望：左侧背景替换为指定图片且保持像素对齐；座位格栅仍可见。

### 6. 主题逻辑重用
- 修改 URL `?theme=default`（后端暂不加载其它皮肤时保持像素风）。
- 期望：逻辑仍正常运行，无脚本错误。

### 7. 打包资产
- 检查 `dist/custom_public/study-room/index.html` 是否生成，引用的 JS/CSS 均存在。
- 确认 `frontend/public/custom_public/study-room/` 老资源已移除，避免重复部署。
