# YouTube 播放速度增强

![Userscript](https://img.shields.io/badge/userscript-Tampermonkey%20%2F%20Violentmonkey-00485b)
![Version](https://img.shields.io/badge/version-1.3.1-blue)
![YouTube](https://img.shields.io/badge/site-YouTube-red)
![License](https://img.shields.io/badge/license-MIT-green)

一个用于 YouTube 的 Tampermonkey / Violentmonkey 用户脚本。

推荐仓库名：`youtube-speed-booster`

## 功能

- 优先在 YouTube 原生播放器控制栏中新增倍速按钮。
- 如果 YouTube 当前页面结构不允许稳定注入原生按钮，则显示一个贴近 YouTube 速度面板风格的播放器内控制面板。
- 通过直接设置 `video.playbackRate`，绕过 YouTube UI 里常见的 2.0x 上限。
- 支持 `0.1x` 到 `16x`，滑杆快速调节 `0.25x` 到 `5x`，数字输入可设置完整范围。
- 只有一个默认倍速。用户通过脚本设置任意速度后，会立即应用到当前视频，并保存为所有后续视频的默认速度。
- YouTube 是 SPA，脚本会监听站内跳转、History API、播放器 DOM 变化，并在新打开视频时自动应用默认倍速。
- 面板可关闭。关闭只隐藏 UI，不影响新视频继续自动应用默认倍速。

## 安装

1. 浏览器安装 Tampermonkey、Violentmonkey 或兼容用户脚本管理器。
2. 新建脚本。
3. 粘贴 `youtube-speed-booster.user.js` 的内容并保存。
4. 打开或刷新 YouTube 视频页面。

## 使用

- 播放器右下角原生控制栏可能会出现一个倍速按钮，例如 `1.50x`。
- 如果没有出现原生按钮，会在播放器底部显示速度面板。
- 点击面板左上角返回按钮可关闭面板。
- 标题栏右侧会显示当前默认速度，例如 `Default 1.50x`。
- 拖动滑杆会立即改变当前视频倍速，并保存为默认倍速。
- 点击 `1.0`、`1.25`、`1.5`、`2.0`、`3.0` 会立即改变当前视频倍速，并保存为默认倍速。
- 数字输入框可以输入更高倍速，例如 `6`、`8`、`12`，最高 `16`。
- 如果关闭了面板，可从脚本管理器菜单里选择 `Show/hide speed panel` 重新显示。

## 设计说明

脚本只保留一个核心概念：默认倍速。

用户在脚本面板中设置的任何速度，都会同时应用到当前视频并保存为默认倍速。后续打开的新 YouTube 视频会自动使用这个速度。

## 兼容性

脚本主要适配：

- `https://www.youtube.com/watch?...`
- `https://www.youtube.com/shorts/...`
- `https://www.youtube.com/embed/...`
- `https://m.youtube.com/...`

YouTube 会频繁调整页面结构。如果原生控制栏注入失败，脚本会自动使用播放器内面板兜底。关闭面板不会关闭自动倍速功能。

## 开发检查

```bash
node --check youtube-speed-booster.user.js
```

## 版本记录

### 1.3.1

- 脚本名称改为中文：`YouTube 播放速度增强`。
- 作者改为 GitHub 用户名：`codertesla`。
- 增加脚本 favicon：YouTube 官方 favicon。
- README 增加 badge。

### 1.3.0

- 精简交互模型：设置任意速度即应用当前视频，并保存为所有后续视频默认速度。
- 移除 `Set as default`、默认速度行、自动应用复选框等冗余选项。
- 在面板标题栏显示当前默认速度。
- 油猴菜单精简为设置速度和显示/隐藏面板。

### 1.2.1

- 修复可能导致 YouTube 页面加载卡住的注入逻辑。
- 脚本启动时机从 `document-start` 改为 `document-idle`，避免阻塞 YouTube 初始化。
- 全页面 DOM 监听改为播放器相关节点的防抖扫描，避免 YouTube 加载期大量 DOM 变化反复执行重逻辑。
- History API hook 改为异步通知，不影响 YouTube 自身路由返回流程。

### 1.2.0

- 改进兜底控制面板 UI，更接近 YouTube 播放速度面板。
- 新增面板关闭按钮。
- 关闭面板后仍保留默认倍速自动应用。
- 常用倍速按钮改为 `1.0`、`1.25`、`1.5`、`2.0`、`3.0`。
- 继续保留原生控制栏注入尝试。

### 1.1.0

- 新增 YouTube 原生控制栏倍速按钮。
- 新增滑杆和数字输入。
- 移除容易混淆的 `Set` / `Save` 双按钮设计，改为即时调速 + `Set default`。
- 补充 README。

### 1.0.0

- 初始版本。
- 支持突破 2.0x 限制。
- 支持默认倍速和 YouTube SPA 新视频自动应用。
