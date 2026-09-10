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

播放器对用户可见的会话恢复、集合检查点、完成状态和 UI 语义统一遵循 [`PLAYBACK.md`](PLAYBACK.md)。

缓存目录、实体副本、索引、扫描恢复、播放命中和删除安全边界统一遵循 [`CACHE.md`](CACHE.md)。

## 消息流

```text
UI ──请求──> Service Worker ──播放/缓存命令──> Offscreen Document
UI <─状态── Service Worker <────播放/缓存事件──── Offscreen Document
```

## MP3 编码边界

MP3 编码器作为扩展自身资源打包，不从 CDN 动态加载。转码在 Offscreen Document 调度的 Worker 中执行，不上传音频；具体缓存与文件写入规则见 [`CACHE.md`](CACHE.md)。
