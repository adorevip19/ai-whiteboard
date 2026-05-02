# AI Whiteboard 项目上下文

最后更新：2026-05-02

这个文件用于承接当前这轮长对话里的项目状态。以后换新对话时，先让 AI 阅读本文件和 `AI_GUIDE.md`，就能快速接上。

## 项目位置

- 主项目目录：`/Users/tianyufeng/Desktop/ai-whiteboard`
- 曾经创建过的副本：`/Users/tianyufeng/Desktop/ai-whiteboard-local`
- 当前建议继续使用主项目目录，不再以副本为主。
- GitHub 仓库：`https://github.com/adorevip19/ai-whiteboard.git`
- 本地预览地址通常是：`http://localhost:5001/#/`

## 项目目标

AI Whiteboard 是一个 JSON 命令式白板播放器。目标是让 AI 在讲解知识时，不只是输出文字，而是可以通过脚本控制白板写字、画图、标注、擦除、移动对象、播放语音，并用激光笔指示当前讲解位置。

当前产品路线以“实时脚本绘制白板”为主。之前尝试过“预生成板书图片 + 遮罩逐步揭示”，但实际效果不理想，尤其是 AI 生成图片中的细节和后续圈画定位不稳定，所以后续不再默认使用这条路线。

## 本地运行

常用命令：

```bash
npm install
PORT=5001 npm run dev
npm run check
npm run build
npm run start
```

说明：

- `npm run dev` 会启动开发服务。
- 如 5001 端口被占用，可以换端口，例如 `PORT=5002 npm run dev`。
- `npm run check` 用 TypeScript 检查。
- `npm run build` 用于生产构建。
- 构建时曾出现 PostCSS `from` 选项相关 warning，但构建可成功。
- 引入 `jsxgraph` 后，生产构建还会出现 JSXGraph 内部 JessieCode `eval` 的 Vite/Rollup 警告。这是依赖包内部提示，当前不影响构建和白板运行。

## Railway 部署

项目根目录已有 `railway.json`：

- buildCommand：`npm run build`
- startCommand：`npm run start`

Railway 上如果要启用 Azure TTS，需要在 Railway 环境变量中配置：

- `AZURE_SPEECH_KEY`
- `AZURE_SPEECH_REGION`
- `AZURE_SPEECH_VOICE`，当前推荐 `zh-CN-XiaochenNeural`

Railway 上如果要启用 AI 脚本生成和修复，还需要配置：

- `PERPLEXITY_API_KEY`
- `PERPLEXITY_GENERATE_MODEL=openai/gpt-5.5`
- `PERPLEXITY_REPAIR_MODEL=openai/gpt-5.2`
- `PERPLEXITY_VISION_MODEL=openai/gpt-5.4`
- `PERPLEXITY_MAX_REPAIR_ROUNDS=3`
- `CHROME_EXECUTABLE_PATH`，服务端 MP4 API 使用 headless Chrome 时可选配置

本地 `.env` 文件已经被 `.gitignore` 忽略，不应该提交到 GitHub。文档里也不要记录真实密钥。

## 关键文件

- `AI_GUIDE.md`：写给 AI 的脚本生成指南。以后每次新增功能都要同步更新这里。
- `VIDEO_API.md`：写给 AI/外部系统的视频生成 API 调用说明。以后视频 API 的路径、字段、返回格式、默认值或依赖变化都要同步更新这里。
- `client/src/whiteboard/commandTypes.ts`：白板命令和渲染对象类型定义。
- `client/src/whiteboard/ScriptRunner.ts`：脚本执行、动画、TTS 对齐、对象状态更新的核心逻辑。
- `client/src/whiteboard/WhiteboardCanvas.tsx`：SVG 白板渲染层。
- `client/src/whiteboard/sampleScript.ts`：左侧输入框默认示例脚本。
- `client/src/whiteboard/geometryEngine.ts`：JSXGraph 辅助几何构造层，负责把几何关系展开成白板绘图命令。
- `client/src/pages/whiteboard.tsx`：白板页面和控制面板。
- `server/routes.ts`：后端接口，包括 Azure TTS。
- `server/aiScript.ts`：AI 脚本生成、预检、自动修复逻辑。

## 当前已实现能力

### 1. Azure TTS

- 后端提供 `/api/tts`。
- 使用 Azure Speech 服务生成中文语音。
- 当前推荐声音：`zh-CN-XiaochenNeural`。
- 播放前会预生成并缓存脚本中的旁白音频。
- 当前同步策略是：每条命令和对应旁白同时开始；如果白板动作先结束，就等待当前语音结束后再进入下一条命令。
- 语音速度由用户控制，白板不再强行逐帧拉长到和语音完全一致。

### 2. Wait 等待点

- 播放器仍兼容旧脚本中的 `wait` 命令。
- 新的 AI 脚本生成不再主动加入 `wait` 等待点，因为播放器已有暂停/继续功能，用户可以随时暂停思考。
- 后端会在 AI 返回脚本后过滤掉 `wait` 命令，避免新生成讲解被“下一步”打断。
- 用于课堂上“想一想”“明白了吗”这类互动停顿。

### 3. 数学公式渲染

已新增：

- `write_math`
- `write_math_steps`
- `write_division_layout`
- `annotate_object`
- `annotate_math_bbox`

目标是让公式不再只靠普通文本拼出来，而是用 KaTeX 渲染分数、根号、平方、上下标、等式推导等。公式对象可以被擦除，也可以整体批注。

### 4. 精准文本强调

为了解决小数字、小文字圈画不准的问题，新增并推荐：

- `write_text_segments`
- `emphasize_text`

`emphasize_text` 支持：

- `bold`
- `color`
- `font_size`
- `underline`
- `dot`

AI Guide 中应明确：小数字、短词、局部文字优先用文本强调，不要用大圈圈去圈。较大区域可以圈画，小目标应使用加粗、变色、放大、下划线或着重号。

### 5. 基础图形绘制

已新增：

- `draw_rectangle`
- `draw_triangle`
- `draw_circle`
- `draw_arc_arrow`
- `draw_brace`

使用场景：

- 矩形：框出题目、结论、重要模块。
- 三角形：几何、斜率、变化量示意。
- 圆圈：较大目标的强调。
- 弧形箭头：表示流程、转移、结果指向。
- 大括号：汇总多行条件、并列信息或推导步骤。

### 6. 大括号优化

用户指出原来的大括号太丑。现在 `draw_brace` 不再用手写路径拼接，而是渲染高质量排版括号字形：

- 类型中增加了 `brace_glyph` 渲染对象。
- 使用 Georgia / Times New Roman 一类 serif 字体。
- 通过字号、旋转和透明度动画控制方向和出现效果。
- JSON schema 保持兼容，脚本仍然使用 `draw_brace`。

### 7. 擦除和清理

已支持：

- `erase_object`：删除指定对象。
- `erase_area`：局部擦除。
- `clear_canvas`：清空整个背景和内容。
- `clear_annotations`：只清除批注层，不影响主要板书。

### 8. 移动对象

已支持：

- `move_object`

用于让已有对象在画布上移动，形成简单动画。坐标系相关对象也做了联动处理，例如函数图像、坐标点、坐标线段可以随坐标系一起移动。

### 9. 坐标系和函数图像

已支持：

- `draw_coordinate_system`
- `draw_function`
- `plot_point`
- `draw_coordinate_segment`

函数表达式支持：

- `x`
- 显式乘法 `*`
- 幂 `^`
- 括号
- `sqrt`
- `abs`
- `sin`
- `cos`
- `tan`
- `ln`
- `log`
- `exp`
- `pi`
- `e`

这让项目已经适合讲初中数学中的一次函数、二次函数、几何关系、坐标变化、斜率等内容。

### 10. 激光笔

已支持：

- `laser_pointer`

最初只是固定红点，后来用户指出真实课堂激光笔应该会移动。现在已经增强为移动激光笔：

- 支持固定 `x` / `y`。
- 支持 `to: { x, y }`。
- 支持 `path: [[x, y], ...]`。
- 支持 `trail`。
- 移动使用平滑插值和缓动，视觉上更像人在用鼠标或激光笔指示。
- 渲染层有红点、脉冲、光环、聚光等样式。

AI Guide 中应强调：每条有 `narration` 的讲解，都应配一个对应的激光笔指示。优先使用移动激光笔，让学生知道当前讲的是画面上的哪一块。

### 11. AI 脚本生成、预检、修复闭环

已新增一套“AI 讲课生成器”工作流：

- 前端主页左侧增加自然语言输入框，用户可以像聊天一样描述想讲的内容。
- 后端新增 Perplexity Agent API 调用，默认通过 `openai/gpt-5.2` 生成脚本。
- 生成后会进行本地确定性预检。
- 如果预检发现错误或风险，会把预检报告和当前脚本交给 AI 继续修复。
- 修复会循环数轮，默认最多 3 轮。
- 最终脚本会填回左侧 JSON 编辑器，可直接播放。

新增后端接口：

- `POST /api/ai-script/preflight`
- `POST /api/ai-script/generate`
- `POST /api/ai-script/recognize-image`
- `POST /api/ai-script/repair`

新增环境变量：

- `PERPLEXITY_API_KEY`
- `PERPLEXITY_GENERATE_MODEL`，默认建议 `openai/gpt-5.5`
- `PERPLEXITY_REPAIR_MODEL`，默认建议 `openai/gpt-5.2`
- `PERPLEXITY_VISION_MODEL`，默认建议 `openai/gpt-5.4`
- `PERPLEXITY_MAX_REPAIR_ROUNDS`，默认 `3`

注意：

- Perplexity API Key 只放后端 `.env` 或 Railway 环境变量，不能放前端。
- 图片题识别会把用户上传的图片以 data URL 形式发给后端，再由后端调用 Perplexity 视觉模型；前端不接触 API Key。
- 预检中的 `error` 表示脚本不可靠；`warning` 表示可播放但建议继续让 AI 优化。
- AI 输出格式要求是 `{ "explanation": "...", "script": { "canvas": {...}, "commands": [...] } }`。
- `AI_GUIDE.md` 已补充这套 AI 生成、预检、修复闭环规则。

### 11.1 图片题识别

已新增图片提交题目能力：

- 前端底部输入框左侧有图片上传按钮。
- 支持 PNG、JPEG、WEBP、GIF，前端限制 10MB 内。
- 后端 JSON body 限制提升到 15MB，用于接收 base64 data URL。
- 后端 `POST /api/ai-script/recognize-image` 调用 Perplexity 视觉模型，把题目图片识别为题干、选项、图中文字、坐标/角标/单位和关键图形关系。
- 图片识别结果会区分 `problemText` 和 `diagramDescription`：前者放题干文字，后者专门描述图示/图片/实验装置/函数图/几何图/统计图等内容。
- 识别结果不会直接开始生成讲解，而是先填回输入框，方便用户核对或补充后再点击发送。
- 生成/识别过程中复用取消按钮；取消会 abort 前端请求，并尽量中断后端外部 API 调用。
- 这个能力不只面向几何题，也面向文字题、函数图像题、物理实验题、统计图表题等“文字 + 图片”的题目。
- 对带图题，生成脚本提示已明确：讲解前必须先读题，再分析题干；如果有图示，必须在白板上重构关键图示，不能只讲 OCR 文字。

### 11.2 讲解模式

已新增两种 AI 讲解生成模式：

- `detailed` / 详细讲解：默认模式。保持完整课堂讲解，先读题，再分析题干与已知条件，然后逐步推导、总结答案。
- `concise` / 简洁讲解：面向已经读过题、思考过一段时间的用户。只给一两句话的小提示，点破最根本、最容易卡住的关键；仍然必须配合白板动作展示关键条件、关键关系或图示局部。

前端底部输入区上方有“详细讲解 / 简洁讲解”切换按钮。发送生成请求时会把 `mode` 一起传给后端 `/api/ai-script/generate`，后端根据模式追加不同生成约束。

### 11.3 MP4 视频导出

已新增“导出 MP4”功能：

- 顶部工具栏有“导出 MP4”按钮。
- AI 讲解脚本生成成功后，前端会立即在后台调用 `/api/video/render` 预渲染 MP4；用户前台看讲解时，后台同步生成视频。
- “导出 MP4”按钮在预渲染期间置灰并显示进度；预渲染完成后变成“下载 MP4”，点击时直接下载已生成的视频，不再重新渲染。
- 如果脚本内容、TTS 开关或播放速度变化，旧的预渲染视频会失效。
- 服务端渲染会启动 headless Chrome 打开本应用，复用 `window.aiWhiteboardRecordScript`：逐帧把白板 SVG 绘制到隐藏 canvas，并用 `MediaRecorder` 录成临时 WebM。
- 如果 Azure TTS 开启并能预生成语音，导出会通过 Web Audio 把旁白音频混进录制流；单条旁白生成遇到 429、网络中断、超时或 5xx 会自动退避重试，默认最多 6 次。
- `wait` 命令在导出时会被跳过，避免视频导出卡在互动暂停点。
- 后端新增 `POST /api/video/convert-mp4`，接收 WebM 后调用本机 `ffmpeg` 转成 MP4 返回下载。
- 本地已确认 `/opt/homebrew/bin/ffmpeg` 存在；Railway/生产环境若要启用 MP4 导出，需要镜像或环境里也安装 `ffmpeg`。
- 当前导出仍需要按视频时间线在后台录制，耗时接近脚本播放时长 + 转码时间；但用户点击下载时一般不需要再等待这一轮录制。

### 11.4 视频生成 API 服务

已新增面向 AI/外部系统调用的一站式视频生成接口：

- `POST /api/video/render`
- 详细调用说明见：`VIDEO_API.md`
- 返回：`Content-Type: video/mp4`
- 内部流程：
  1. 如果传入现成脚本，直接使用脚本。
  2. 如果传入文字/图片，先识别图片题，再生成白板脚本。
  3. 后端启动 headless Chrome 打开本应用。
  4. 前端页面通过 `window.aiWhiteboardRecordScript` 复用白板录制逻辑，把 WebM 上传回后端。
  5. 如果启用 TTS，单条旁白生成失败会自动重试；成功后继续录制，不会整段视频从头重来。
  6. 后端用 `ffmpeg` 转成 MP4 并返回。

请求格式示例一：现成脚本输入

```json
{
  "script": {
    "canvas": { "width": 1200, "height": 800, "background": "#ffffff" },
    "commands": []
  },
  "ttsEnabled": true,
  "playbackSpeed": 1
}
```

请求格式示例二：文字加图片输入

```json
{
  "text": "请讲解这道题，使用简洁讲解。",
  "imageDataUrl": "data:image/png;base64,...",
  "mode": "concise",
  "ttsEnabled": true,
  "playbackSpeed": 1
}
```

说明：

- `mode` 支持 `detailed` / `concise`，默认 `detailed`。
- `ttsEnabled` 默认 `true`。如果 Azure TTS 未配置，应传 `false`，否则生成有声视频会失败。
- 有声视频生成时，TTS 临时失败会自动重试：默认 6 次，间隔约 `1.2s -> 2.5s -> 5s -> 8s -> 12s`。所有重试都失败后才返回错误。
- 本地已测通“现成脚本输入 → headless Chrome 服务端录制 → ffmpeg 转 MP4”链路，返回为真正 `video/mp4`。
- 本地 Chrome 路径默认使用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；生产环境建议设置 `CHROME_EXECUTABLE_PATH`。
- Railway/生产环境需要同时具备 Chrome/Chromium 和 `ffmpeg`。

### 12. 多张白板模式

已新增多页白板能力：

- 顶层脚本可选 `pages`。
- 新增命令 `switch_page`。
- 播放中切页会保存当前页板书状态。
- 切回旧页时，可以看到之前写过的内容。
- 没有 `pages` 的旧脚本仍然按单页兼容运行。

示例：

```json
{
  "canvas": { "width": 1200, "height": 800, "background": "#ffffff" },
  "pages": [
    { "id": "intro", "title": "读题" },
    { "id": "reasoning", "title": "找规律" },
    { "id": "answer", "title": "总结" }
  ],
  "commands": [
    { "type": "write_text", "id": "title", "text": "第一页", "x": 80, "y": 80, "fontSize": 36, "duration": 500 },
    { "type": "switch_page", "id": "to_reasoning", "pageId": "reasoning", "title": "第二页：找规律", "duration": 500, "narration": "我们翻到第二页，专门找规律。" }
  ]
}
```

生成和预检规则已更新：

- 完整讲题优先使用多页白板。
- 一页只讲一个小问题。
- 如果单页主要对象超过 12–14 个，预检会要求拆页。
- 不要通过缩小字号、堆矩形框、堆箭头来把所有内容塞进一页。

### 13. 几何专用命令

为讲解初中几何证明、辅助线、角关系、全等/相似、圆相关问题，已新增一批几何结构化命令：

- `draw_point`：画几何点和点名。
- `draw_segment`：画线段。
- `draw_ray`：画射线。
- `draw_angle`：画角弧和角标。
- `mark_equal_segments`：标记等长线段。
- `mark_parallel`：标记平行线。
- `mark_perpendicular`：标记垂直/直角。
- `highlight_polygon`：高亮三角形、四边形等区域。

AI Guide 中已经要求：几何证明不要用普通圈画去猜点位，辅助线、角标、等长、平行、垂直和全等区域都要尽量用这些结构化几何命令表达。

### 14. JSXGraph 辅助几何构造层

用户提出：几何图片题如果靠 AI 手动估每个点坐标，很容易出现 F 点漏标、辅助线重合、圆上点不在圆上的问题。因此当前实现了 `construct_geometry`，把 JSXGraph 作为几何计算/构造辅助层，而不是替代白板渲染。

已安装依赖：

- `jsxgraph`

新增文件：

- `client/src/whiteboard/geometryEngine.ts`

新增命令：

- `construct_geometry`

基本思路：

1. AI 只给出图片中较可靠的大点位，例如 `A/B/C/D/O`。
2. 垂足、交点、外接圆等不要手算坐标，交给构造层计算。
3. 构造层把几何关系展开成已有白板命令，例如 `draw_circle`、`draw_segment`、`draw_point`、`mark_perpendicular`、`highlight_polygon`。
4. 白板仍然用 SVG 渲染，不直接嵌入 JSXGraph 画板。

当前支持的 `constructions.kind`：

- `circumcircle`：三点确定外接圆。
- `segment`：连接两个已知点或构造点，可设 `dashed: true` 自动生成虚线。
- `perpendicular_projection`：从点向直线作垂线，生成垂足；支持 `footLabel` 和 `footLabelPosition`，避免 F/E 标签被线条压住。
- `intersection`：求两条直线交点。
- `highlight_polygon`：按点 id 高亮多边形区域。

`geometryEngine.ts` 里还加了 `warmupJsxGraphGeometryEngine()`，在浏览器侧懒加载 JSXGraph。注意：JSXGraph 不能在 Node 服务端直接 import，因为它会访问 `window`，所以不要在 `server/*` 中直接引用 JSXGraph。

后端预检已经认识 `construct_geometry`：

- 检查基础点是否越界。
- 检查构造是否引用未定义点。
- 检查构造依赖顺序，例如先生成 `E/F`，再用 `E/F` 求 `H`。
- 如果基础点过多，会提醒 AI 不要手动猜太多构造点。

AI Guide 已补充规则：

- 图片识别后的复杂几何题，优先使用 `construct_geometry`。
- `points` 中只写可靠主点，垂足 `E/F`、交点 `H` 应由 constructions 生成。
- 圆上点必须真的落在圆周附近。
- 辅助线不要彼此完全重合；必要时调点位、降低虚线宽度/颜色或改变绘制顺序。
- 垂足标签要主动避让线段，例如 `E` 常用 `bottom`，`F` 常用 `left` 或 `top`。

## 当前默认示例脚本

默认示例在：

`client/src/whiteboard/sampleScript.ts`

主题是：

“JSXGraph 辅助：几何题图形重构”

当前示例用于重构用户提供的初中几何证明题图形，展示：

- `construct_geometry`。
- 三点确定外接圆。
- 自动构造垂足 `E/F`。
- 自动求交点 `H`。
- 连接 `AB/AC/BC/AD/HD`。
- 自动拆分虚线辅助线。
- 高亮 `△AHD`。
- 移动激光笔。

最近修过的示例问题：

- `F` 点没标出来：新增 `footLabelPosition`，示例中把 `F` 标签放到左侧。
- `FC` 和 `OC` 虚线视觉重合：调整 `O` 到外接圆圆心附近，并把 `OC/OD` 虚线改细、改浅。
- `D` 点没在圆上：把 `D` 调整到外接圆下弧附近。

注意：这个示例是“几何重构能力验证示例”，不是最终讲解脚本。以后如果要做完整几何证明讲解，应在此基础上拆成多页：读题与条件、重构图形、证明关键关系、结论总结。

## AI Guide 维护规则

这个项目中 `AI_GUIDE.md` 非常重要，它是给后续 AI 生成白板脚本看的。

规则：

1. 每次新增命令或改动命令参数，都要同步更新 `AI_GUIDE.md`。
2. 每次改动视频生成 API 的路径、请求字段、返回格式、默认值、错误语义或服务端依赖，都要同步更新 `VIDEO_API.md`。
3. 新增功能时，不只写字段说明，还要写“什么时候该用、什么时候不该用”。
4. 对小目标强调，优先用 `emphasize_text`，不要随便圈画。
5. 每条旁白应有对应激光笔动作。
6. 激光笔应尽量用 `to` 或 `path` 表示移动，而不是只点一下。
7. 讲数学题时，优先使用公式、坐标系、函数图像、点、线段、矩形框、大括号等结构化表达。
8. 避免把太多内容塞进一个画布区域，脚本要分块讲解。
9. 当前不再默认推荐预生成板书图片加遮罩的方案。

## 当前 Git 状态提醒

最近的本地改动尚未确认提交。最后一次检查时存在这些改动：

- `.env.example`
- `AI_GUIDE.md`
- `client/src/pages/whiteboard.tsx`
- `client/src/whiteboard/ScriptRunner.ts`
- `client/src/whiteboard/WhiteboardCanvas.tsx`
- `client/src/whiteboard/commandTypes.ts`
- `client/src/whiteboard/sampleScript.ts`
- `package.json`
- `package-lock.json`
- `server/routes.ts`
- 未跟踪：`.claude/`
- 未跟踪：`PROJECT_CONTEXT.md`
- 未跟踪：`client/src/whiteboard/geometryEngine.ts`
- 未跟踪：`push.command`
- 未跟踪：`server/aiScript.ts`

提交前务必再次运行：

```bash
git status --short
npm run check
npm run build
```

不要提交 `.env`、真实密钥、无关缓存文件。

## 已验证状态

最近这些功能改动后曾执行过：

- `npm run check`：通过。
- `npm run build`：通过。
- 图片识别接口基础校验：空 `imageDataUrl` 与非图片 data URL 会返回 400。
- 浏览器本地预览：确认底部输入框左侧出现图片上传按钮，隐藏文件输入存在，控制台无错误。
- 示例脚本校验：通过。
- 浏览器本地预览：确认几何重构示例可运行，`F`、`D`、`O/OC` 等问题已改善。
- 本地服务曾启动在：`http://localhost:5001/#/`。

后续如果继续开发，仍应在当前代码状态下重新跑一遍验证。

## Codex 语音输入问题记录

用户还问过 Codex 应用自身为什么录音后无法转录。

已检查到：

- `/Applications/Codex.app` 存在。
- app 有麦克风权限说明。
- app 签名 entitlement 包含音频输入能力。
- 用户描述是“可以录音，但点击转录时提示无法转录音频”。

初步判断：

- 麦克风权限大概率不是根因。
- 更可能是转录上传、网络、代理、登录态、额度、服务端或 Codex 应用自身问题。
- 如需进一步排查，可以让 AI 查看 Codex 日志，但日志可能包含近期应用活动，应先征得用户明确同意。

## 后续可做功能

建议优先级：

1. 完善图片题识别后的自动核对/纠错交互，例如展示识别文本预览、允许用户标注“这块看错了”。
2. 增强几何图片题工作流：让多模态模型识别主点和几何关系后，更稳定生成 `construct_geometry` 脚本。
3. 增强几何构造层：增加圆心、弧中点、角平分线、中垂线、平行线、切线、圆弧、等腰/等边辅助构造。
4. 增加脚本布局预检：检测文本框、公式、图形、标签是否重叠，尤其是几何点名和辅助线重合。
5. 增强 AI Guide 的几何示例，给“圆内接三角形、垂足、辅助线、证明等腰/全等/相似”提供模板。
6. 增加更精细的激光笔轨迹命令，例如区域扫视、往返强调。
7. 增加坐标系自动换算辅助，让 AI 可以用数学坐标而不是手算像素坐标。
8. 整理一次提交并推送 GitHub，然后确认 Railway 是否自动部署成功。

## 新对话接续步骤

换新对话后建议这样开始：

1. 打开项目：`/Users/tianyufeng/Desktop/ai-whiteboard`
2. 阅读本文件：`PROJECT_CONTEXT.md`
3. 阅读：`AI_GUIDE.md`
4. 执行：`git status --short`
5. 执行：`npm run check`
6. 如需本地预览：`PORT=5001 npm run dev`
7. 打开：`http://localhost:5001/#/`

一句话总结：这是一个面向 AI 讲课的 JSON 白板播放器，当前重点是用实时脚本、数学公式、坐标图、图形、移动对象、TTS、暂停控制和移动激光笔，把讲解过程做得更像老师在白板上逐步讲清楚。
