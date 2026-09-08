# 架构说明

## 运行上下文

- `background/service-worker.js`：接口调度、持久化、追更计划和上下文协调。
- `offscreen/offscreen.js`：真正的 `<audio>` 播放器、Media Session、下载流写入和离线文件读取。
- `ui/app.js`：侧边栏与完整播放器共用的界面控制器。
- `services/bilibili.js`：哔哩哔哩接口唯一入口，负责规范化返回数据。
- `services/file-store.js`：目录句柄和本地缓存索引。

## 数据位置

- `chrome.storage.local`：关注的 UP 主、列表缓存、播放器状态、设置、追更订阅。
- IndexedDB：用户授权的目录句柄及本地文件索引，不保存音频正文。
- 用户目录：真实音频文件。

## 消息流

```text
UI ──请求──> Service Worker ──播放/缓存命令──> Offscreen Document
UI <─状态── Service Worker <────播放/缓存事件──── Offscreen Document
```

## 后续 MP3 阶段

MP3 编码器必须作为扩展自身资源打包，不能从 CDN 动态加载。建议在 Worker 中运行 WASM 编码，避免阻塞播放和界面线程；完成前设置页不会允许选择 MP3。
