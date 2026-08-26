# DeepSeek Harness Desktop

DeepSeek Harness 的桌面端外壳（Electron）。**不重写任何功能**：原生窗口内直接加载现有的
`dsh web` GUI（与浏览器访问 `http://127.0.0.1:3080` 是同一个应用），因此网页端的
全部功能——对话、工具、动态插件、审批、后台任务、子代理、目标、设置等——完全等价，一个不少。

## 原理

```
Electron 主进程                    dsh web（Node 宿主进程）
├─ 定位 CLI（DSH_CLI / npx 缓存）  ├─ Cordis 插件组合、服务、沙箱/审批栈
├─ 已在运行？→ 挂接；否则后台启动  ├─ 模型路由、子代理、后台任务、持久化
├─ 原生窗口 ←——加载同一 URL——→     └─ 提供 Web GUI
└─ 退出时仅清理自己启动的服务器     （浏览器端同时仍可访问同一地址）
```

- 启动逻辑（CLI 定位、隐藏启动、等待就绪、日志落盘）与 `DSH Launcher\Launch-DeepSeekHarness.ps1`
  保持一致，只是从 PowerShell 移到了 Electron 主进程。
- 单实例锁：重复双击只会聚焦已有窗口，不会重复启动服务器。
- 退出行为：窗口全部关闭即退出应用；**仅当服务器是本应用启动的**才会在退出时结束它，
  若服务器事先已在运行则保持不变（浏览器里的网页端不受影响）。

## 使用

```powershell
npm install          # 首次
npm start            # 启动桌面端
npm run smoke        # 冒烟测试：加载 GUI 并校验后自动退出（0=成功）
npm run pack         # 打包独立安装版（NSIS + 便携版，输出到 dist\）
```

环境变量（可选）：

- `DSH_WEB_URL` — 目标地址，默认 `http://127.0.0.1:3080`
- `DSH_CLI` — 指向 `@deepseek-ai/dsh` 的 `lib/bin.js`，默认自动从 npx 缓存定位
- `DSH_HOME` — DSH 数据目录，默认 `%USERPROFILE%\.dsh`

## 日志

日志统一写入用户数据目录（打包后 `__dirname` 在只读的 app.asar 内，不可写）：

- `%APPDATA%\DeepSeek Harness\logs\app.log` — 外壳自身日志
- `%APPDATA%\DeepSeek Harness\logs\server.out.log` / `server.err.log` — dsh web 服务器输出

## 打包（electron-builder）

- `npm run pack` 生成两个产物到 `dist\`：
  - `DeepSeek Harness Setup 0.1.0.exe` — NSIS 安装版（向导式安装、可选安装目录、自动建桌面快捷方式）
  - `DeepSeekHarness-Portable.exe` — 便携版（免安装，直接双击运行）
- 国内网络下打包需镜像环境变量（见下）；若已有缓存可省略。
- 产物未做代码签名，Windows SmartScreen 首次运行可能提示"未知发布者"，选择"仍要运行"即可。

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run pack
```

## 与网页端的行为差异

| 项目 | 网页端 | 桌面端 |
|---|---|---|
| GUI 本体 | 浏览器标签页 | 原生窗口（同一应用） |
| 外部链接/弹窗 | 新标签页 | 系统默认浏览器 |
| 文件下载 | 浏览器下载 | 询问保存位置 |
| 服务器生命周期 | 由 launcher 管理 | 由应用管理（自启自清） |
| 其余功能 | — | 完全一致 |

> 说明：桌面端不是独立实现，而是 GUI 的宿主容器；任何网页端新增功能会自动出现在桌面端，
> 无需同步移植。
