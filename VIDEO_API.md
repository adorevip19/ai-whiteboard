# AI Whiteboard 视频生成 API 调用说明

最后更新：2026-05-02

本文档给 AI 或外部服务阅读，用来调用 AI Whiteboard 的白板讲解视频生成接口。以后只要视频生成 API 的路径、请求字段、返回格式、依赖条件或行为发生变化，必须同步更新本文档。

## 接口概览

```http
POST /api/video/render
```

当前生产服务地址（Railway，已验证）：

```text
https://ai-whiteboard-production-94ad.up.railway.app
```

完整生产接口：

```http
POST https://ai-whiteboard-production-94ad.up.railway.app/api/video/render
```

调用方应优先把服务地址配置成变量，例如：

```env
AI_WHITEBOARD_VIDEO_API_BASE_URL=https://ai-whiteboard-production-94ad.up.railway.app
```

本地开发地址仅用于开发机调试，不应给线上 AI 或外部服务默认使用：

```text
http://localhost:5001
```

如果 Railway 重新生成域名、切换自定义域名，或更换主服务地址，必须同步更新本节和后文所有示例。

作用：把题目、讲解需求或现成白板脚本转换成一个带画面、白板动画和可选旁白声音的 MP4 视频。

本接口是同步接口：请求会一直等待视频生成完成，然后直接返回 MP4 二进制。前端页面在 AI 讲解脚本生成成功后，会主动调用本接口进行后台预渲染；预渲染完成后，用户点击“下载 MP4”只下载已经生成好的文件，不会再次触发渲染。

返回：

```http
Content-Type: video/mp4
Content-Disposition: attachment; filename="whiteboard-lecture.mp4"
```

调用方应把响应体当作二进制 MP4 文件保存或转发。

## 两种输入方式

### 1. 文字加图片输入

适合用户直接提问、上传题图、截图或拍照题目。服务端会先识别图片，再生成白板脚本，最后渲染成 MP4。

```json
{
  "text": "请讲解这道题，先读题，再分析题干。",
  "imageDataUrl": "data:image/png;base64,...",
  "mode": "detailed",
  "ttsEnabled": true,
  "playbackSpeed": 1
}
```

字段说明：

- `text`：可选。用户的文字问题、讲解要求或补充说明。
- `imageDataUrl`：可选。题目图片，格式为 `data:image/png;base64,...`、`data:image/jpeg;base64,...`、`data:image/webp;base64,...` 或 `data:image/gif;base64,...`。
- `mode`：可选，`"detailed"` 或 `"concise"`，默认 `"detailed"`。
- `ttsEnabled`：可选，默认 `true`。设为 `true` 时会生成有声视频，要求后端已配置 Azure TTS。
- `playbackSpeed`：可选，范围 `0.5` 到 `2`，默认 `1`。

要求：

- `text` 和 `imageDataUrl` 至少提供一个。
- 图片大小当前按 data URL 长度限制，约等价于 10MB 以内原图。
- 如果图片包含图示、实验装置、函数图、几何图、表格或统计图，服务会尽量提取图示信息，并要求生成脚本重构关键图示。

### 2. 现成脚本输入

适合调用方已经有 AI Whiteboard JSON 脚本，只需要把脚本渲染成 MP4。

```json
{
  "script": {
    "canvas": {
      "width": 1200,
      "height": 800,
      "background": "#ffffff"
    },
    "commands": [
      {
        "type": "write_text",
        "id": "title",
        "text": "示例讲解",
        "x": 80,
        "y": 100,
        "fontSize": 36,
        "duration": 800,
        "narration": "我们来看这道题的关键。"
      }
    ]
  },
  "ttsEnabled": true,
  "playbackSpeed": 1
}
```

也可以传字符串形式：

```json
{
  "scriptText": "{\"canvas\":{\"width\":1200,\"height\":800,\"background\":\"#ffffff\"},\"commands\":[]}",
  "ttsEnabled": false
}
```

字段说明：

- `script`：可选。白板脚本对象。
- `scriptText`：可选。白板脚本 JSON 字符串。
- `ttsEnabled`：可选，默认 `true`。如果脚本包含 `narration` 且希望输出有声视频，设为 `true`。
- `playbackSpeed`：可选，范围 `0.5` 到 `2`，默认 `1`。

要求：

- `script` 和 `scriptText` 二选一。
- 脚本必须符合 AI Whiteboard 播放器 schema。
- 导出时会跳过 `wait` 命令，避免视频生成卡在互动等待点。

## 前端预渲染行为

用户在网页中生成讲解时，前端会在脚本生成成功后立即开始后台预渲染 MP4：

- 讲解在前台正常播放，后台同时调用 `/api/video/render` 生成视频。
- “导出 MP4”按钮在后台渲染期间置灰，并显示估算进度。
- 后台渲染成功后，按钮变成“下载 MP4”。
- 点击“下载 MP4”只下载已缓存的视频 Blob，不会重新渲染。
- 如果脚本内容、`ttsEnabled` 或 `playbackSpeed` 变化，旧的预渲染视频会失效，需要重新生成讲解后再预渲染。

注意：这是网页客户端的体验优化，不改变 `/api/video/render` 的 HTTP 协议。外部 AI 或服务端调用该接口时，仍然是一次请求返回一个 MP4。

## TTS 中断重试

当 `ttsEnabled: true` 时，视频生成会先为脚本中的 `narration` 生成语音。为了应对 Azure TTS 限流或临时网络波动，生成单条旁白时带有自动重试机制：

- 重试对象：单条旁白语音，而不是整段视频。
- 默认最多尝试 6 次。
- 默认退避间隔约为 `1.2s -> 2.5s -> 5s -> 8s -> 12s`。
- 会自动重试的典型错误：`429` 限流、`408`/超时、`5xx`、网络中断、临时 fetch 失败。
- 如果某条旁白重试成功，服务会继续生成后续语音并继续渲染视频。
- 如果所有重试都失败，`/api/video/render` 才会返回错误。

调用方不需要额外传字段开启重试；这是有声视频生成的默认行为。

## 讲解模式

`mode` 只在文字/图片输入并需要服务端生成脚本时生效。

### `detailed`

详细讲解，默认模式。

适合用户第一次学习或需要完整讲解。生成策略：

- 先读题。
- 再分析题干、已知条件、图示信息和要求。
- 分步骤推导或解释。
- 最后总结答案和易错点。
- 带图题会重构关键图示。

### `concise`

简洁讲解。

适合用户已经读过题、思考过一段时间，只需要一个提示。生成策略：

- 不做完整铺开。
- 用一两句话点破最关键、最容易卡住的地方。
- 仍然必须配合白板动作，例如写关键关系、画关键图示局部、用激光笔指示卡点。
- 输出视频通常更短。

## 返回处理

成功时返回二进制 MP4。示例：

```bash
API_BASE_URL="https://ai-whiteboard-production-94ad.up.railway.app"

curl -X POST "$API_BASE_URL/api/video/render" \
  -H "Content-Type: application/json" \
  -d @payload.json \
  --output whiteboard-lecture.mp4
```

Node.js 示例：

```js
const apiBaseUrl =
  process.env.AI_WHITEBOARD_VIDEO_API_BASE_URL ??
  "https://ai-whiteboard-production-94ad.up.railway.app";

const response = await fetch(`${apiBaseUrl}/api/video/render`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    text: "请用简洁讲解说明为什么选 B。",
    imageDataUrl: "data:image/png;base64,...",
    mode: "concise",
    ttsEnabled: true
  })
});

if (!response.ok) {
  const error = await response.json().catch(() => null);
  throw new Error(error?.message ?? `视频生成失败：${response.status}`);
}

const mp4 = Buffer.from(await response.arrayBuffer());
await fs.promises.writeFile("whiteboard-lecture.mp4", mp4);
```

## 错误返回

错误通常返回 JSON：

```json
{
  "message": "错误原因"
}
```

常见情况：

- `400`：缺少输入、脚本 JSON 无效、图片格式不支持。
- `413`：图片或视频中间文件过大。
- `499`：调用方取消请求。
- `500`：AI 生成失败、TTS 失败、headless Chrome 启动失败、ffmpeg 转码失败等。

如果错误来自 TTS 临时中断，接口通常已经在内部重试过；最终仍返回 `500` 时，表示对应旁白在多次重试后仍未成功，或遇到了不可重试错误，例如 Azure TTS 未配置、鉴权失败、请求格式错误等。

如果 `ttsEnabled: true`，但服务端没有配置 Azure TTS，生成有声视频会失败。调用方可以改传：

```json
{
  "ttsEnabled": false
}
```

生成无声 MP4。

## 服务端依赖

视频 API 依赖以下能力：

- Perplexity API：用于文字/图片输入时生成白板脚本。
- Azure TTS：用于有声视频。
- Chrome 或 Chromium：用于服务端 headless 渲染白板页面。
- ffmpeg：用于把录制得到的 WebM 转成 MP4。

相关环境变量：

```env
PERPLEXITY_API_KEY=
PERPLEXITY_GENERATE_MODEL=openai/gpt-5.5
PERPLEXITY_REPAIR_MODEL=openai/gpt-5.2
PERPLEXITY_VISION_MODEL=openai/gpt-5.4
PERPLEXITY_MAX_REPAIR_ROUNDS=3

AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoNeural

CHROME_EXECUTABLE_PATH=/path/to/chrome-or-chromium
```

服务端会依次尝试 `CHROME_EXECUTABLE_PATH`、`GOOGLE_CHROME_BIN` 以及常见 Linux/macOS 路径。本地 macOS 默认会尝试使用：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
```

生产环境必须确保 Chrome/Chromium 和 `ffmpeg` 可用。Railway 当前使用 Railpack 构建时，需要配置运行时 apt 包：

```env
RAILPACK_DEPLOY_APT_PACKAGES=chromium ffmpeg
CHROME_EXECUTABLE_PATH=/usr/bin/chromium
```

## 内部流程

`POST /api/video/render` 内部大致流程：

1. 如果请求提供 `script` 或 `scriptText`，直接校验并使用脚本。
2. 如果请求提供 `text` / `imageDataUrl`，先识别图片，再生成白板脚本。
3. 后端启动 headless Chrome，通过容器内 `127.0.0.1:$PORT` 打开当前 Web 应用，避免生产环境从公网地址回连自身。
4. 页面调用 `window.aiWhiteboardRecordScript` 重新播放脚本并录制 WebM。
5. 如果启用 TTS，页面会逐条生成旁白语音；遇到临时中断会按退避策略自动重试单条旁白。
6. 页面把 WebM 上传回内部接口 `/api/video/render-jobs/:id/webm`。
7. 后端用 `ffmpeg` 转成 MP4。
8. 后端把 MP4 作为响应体返回。

`/api/video/render-jobs/:id/webm` 是服务端和 headless 浏览器之间使用的内部上传接口，外部调用方不应直接调用。

`/api/video/convert-mp4` 是前端旧导出链路使用的 WebM 转 MP4 辅助接口；外部 AI 生成完整讲解视频时应调用 `/api/video/render`。

## 维护规则

- 只要 `/api/video/render` 的路径、请求字段、默认值、返回格式、错误语义、依赖环境变量发生变化，必须更新本文档。
- 如果 AI Whiteboard 脚本 schema 变化，应同步检查本文档里的脚本示例是否仍然有效。
- 如果新增贴原图、字幕样式、分辨率、视频码率、异步任务队列等能力，应在本文档增加字段说明和示例。
