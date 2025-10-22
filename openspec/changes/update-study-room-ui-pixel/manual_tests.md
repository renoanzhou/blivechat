## 手动测试计划

> 构建模板：`cd frontend && npm run build:pixel-library`，脚本会把资源复制到 `data/custom_public/templates/pixel-library/`。

### 1. 模板加载
- 启动后端：`python main.py --debug`。
- 打开 `http://localhost:12450/custom_public/templates/pixel-library/index.html?roomKeyType=2&roomKeyValue=<房间ID>&showDebugMessages=true`。
- 期望：页面加载像素风背景，左侧显示主图书馆，右侧显示座位表与调试面板。

### 2. 调试面板模拟
- 在调试面板中输入昵称与 `/加入图书馆`，提交。
- 期望：座位表出现对应观众，生成加入提示 toast。
- 重复发送 `/离开座位`，确认座位释放并进入候补/离席记录。

### 3. 实时弹幕
- 在实际直播间发送满足命令的弹幕或通过 `POST /api/study_room/mock_message` 接口模拟。
- 期望：页面在收到弹幕后 1 秒内刷新，状态提示从“加载中”切换为“在线”。

### 4. 连接状态
- 暂停弹幕源或关闭后端接口。
- 期望：左侧覆盖层出现“连接中断”提示，右上状态点变灰。
- 恢复服务后提示消失，状态恢复为“在线”。

### 5. 背景与布局
- 在 URL 中追加 `&background=https://example.com/pixel-map.png`。
- 期望：左侧背景替换为指定图片并保持像素对齐；座位锚点仍可见。

### 6. 模板注册验证
- 确认 `data/custom_public/templates/pixel-library/template.json` 被 `GET /api/templates` 返回。
- 在主页面选择该模板，观察 iframe 是否加载并显示实时内容。

### 7. 资源完整性
- 检查 `data/custom_public/templates/pixel-library/js/` 和 `css/` 是否包含最新 hash 文件。
- 确认 `blcsdk.js` 位于模板根目录，`index.html` 引用相对路径 (`./js/...`, `./css/...`, `./blcsdk.js`)。
