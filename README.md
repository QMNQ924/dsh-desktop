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

## 窗口特性

| 特性 | 实现 |
| --- | --- |
| 无边框窗口 | `titleBarStyle: 'hidden'`；页面顶部即是标题栏 |
| 窗口按钮 | `window-controls.js` 注入 macOS 风格"红绿灯"（关闭/最小化/最大化·还原），固定在左上角，悬停才显示图标；点击经 `preload.js` 暴露的 `window.dshWindow` → IPC 调主进程 |
| 拖动窗口 | 侧边栏品牌条（`logoRow`）与主区标题条（`titleRow`）可拖；条内 `button/a/input/textarea/[role=button]/[contenteditable]` 显式 `no-drag`。选择器用 `[class*=]` 而非构建期 hash 类名，应用重新构建后依然有效 |
| 窗口材质 | `backgroundMaterial: 'acrylic'`（Windows 11 22H2+）。**注意**：本机实测该材质未参与合成，窗口底是直通的桌面；界面观感由 DSH 自带的液态玻璃样式提供（见 `DSH Plugins\liquid-glass`） |
| token 校验 | 启动时从 `server.out.log` 里**从新到旧逐个校验** launch token，只采用服务真正接受的那个，避免窗口加载成 401；判定"服务在跑"时把 `401` 与 `200` 同等看待，避免误判而重复自启撞端口 |
| 其他 | 单实例锁（重复启动只聚焦已有窗口）；外部链接走系统浏览器；下载询问保存位置；仅当服务器由本应用启动时才在退出时结束它 |

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
  - `DeepSeek-Harness-Setup-<version>.exe` — NSIS 安装版（向导式安装、可选安装目录、自动建桌面快捷方式）
  - `DeepSeekHarness-Portable-<version>.exe` — 便携版（免安装，直接双击运行）
- 国内网络下打包需镜像环境变量（见下）；若已有缓存可省略。
- 产物未做代码签名，Windows SmartScreen 首次运行可能提示"未知发布者"，选择"仍要运行"即可。

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run pack
```

## 自动构建发布（GitHub Actions）

仓库已配置 `.github/workflows/release.yml`：

- **推送 `v*` 标签** → 自动在 GitHub 托管 Runner 上构建两个安装包并发布 Release（附件即安装包）；
- **手动触发**（仓库 Actions 页 → Run workflow）→ 只构建并上传运行产物，不发布 Release。

发新版流程（两条命令，CI 负责打包 + 发布 Release）：

```powershell
git tag v0.2.0
git push origin v0.2.0
```

> CI 内网络直连 GitHub/npm，无需镜像环境变量。

若 CI 不可用（网络受限），退回本地打包上传：

```powershell
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run pack
gh release create v0.2.0 "dist\DeepSeek-Harness-Setup-0.2.0.exe" "dist\DeepSeekHarness-Portable-0.2.0.exe" --title v0.2.0 --generate-notes
```

## 更新日志

- **v0.2.0** — 外壳补齐"已装环境"里已验证的运行逻辑：`401` 也视为服务在跑、启动时逐个校验 launch token（不再把窗口加载成 401）；品牌条/标题条拖拽区改用 `[class*=]` 选择器（应用换 hash 后仍可拖动，且条内控件保持可点击）。
- v0.1.1 — 顶部透明拖动条，无边框窗口可拖动。
- v0.1.0 — 首个版本：窄外壳 + 自定义窗口控制 + GitHub Actions 自动构建发布。

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
