# AI Whiteboard · JSON 命令式白板

一个专门给 AI 调用的命令式白板工具。AI 通过生成 JSON 命令控制白板写字、画线、画箭头、自由路径涂鸦与擦除，所有内容以“逐步出现”的动画过程呈现。

## 功能（v1 MVP）

- **set_canvas** — 定义画布大小与背景色
- **write_text** — 在指定坐标写字（打字机效果，按字符逐个出现）
- **draw_line** — 从 `from` 坐标平滑延伸到 `to` 坐标
- **draw_arrow** — 从 `from` 箭尾指向 `to` 箭头尖端，可设置颜色、粗细、头部大小与张角
- **draw_path** — 用 `points` 坐标数组绘制任意路径涂鸦，可设置颜色与粗细
- **erase_object / erase_area / clear_canvas** — 删除对象、局部擦除或清空整张画布
- **annotate_underline / annotate_circle / clear_annotations** — 在独立批注图层划重点，并可一键清除
- **wait** — 在关键节点暂停，等待用户点击“下一步”后继续
- **Azure TTS** — 可用 Microsoft Azure Speech 朗读 `narration` 旁白，并按播放器速度同步
- 顺序执行 commands 数组，实时显示当前步骤
- JSON 格式错误、未知命令、缺字段都有明确提示

详细的 AI 调用规范见 [AI_GUIDE.md](./AI_GUIDE.md)。

## 技术栈

- React 18 + TypeScript
- Vite 构建
- Express 生产服务
- SVG 渲染（声明式动画 + 元素身份保留）
- Tailwind CSS + shadcn/ui

## 本地开发

```bash
npm install
npm run dev          # 开发服务器（Express + Vite）
npm run build        # 构建前端和生产服务端到 dist/
npm run start        # 启动生产服务，默认监听 5000 或 Railway 的 PORT
npm run build:client # 仅构建前端到 dist/public
```

## 在 Railway 部署

仓库已包含 `railway.json`，使用 Railway 的 **Railpack** 构建器部署为 Node/Express 服务。

Railway 会执行：

1. 安装 Node 依赖
2. 运行 `npm run build`
   - Vite 构建前端到 `dist/public`
   - esbuild 构建 Express 服务到 `dist/index.cjs`
3. 运行 `npm run start`
   - Express 读取 Railway 注入的 `$PORT`
   - 静态托管 `dist/public`
   - 未命中的前端路由回退到 `index.html`

部署步骤：

1. Railway → **New Project** → **Deploy from GitHub repo**
2. 选择本仓库
3. 等待 Build / Deploy 完成
4. 在 **Settings → Networking → Generate Domain** 生成公开 URL

不需要配置环境变量。项目根目录的 `railway.json` 会覆盖 Railway Dashboard 中的 Build Command / Start Command。

如需启用 Azure 语音合成，请在 Railway Variables 中设置：

```text
AZURE_SPEECH_KEY=你的 Azure Speech Key
AZURE_SPEECH_REGION=你的 Azure Speech Region
AZURE_SPEECH_VOICE=zh-CN-XiaoxiaoNeural
```

`AZURE_SPEECH_VOICE` 可选；不设置时默认使用 `zh-CN-XiaoxiaoNeural`。未配置 Key/Region 时，白板仍可正常播放，只是 Azure TTS 开关会提示未配置。

## 项目结构

```text
client/src/
├── App.tsx                            # 路由入口
├── pages/whiteboard.tsx               # 主界面（编辑器 + 画布 + 步骤指示）
└── whiteboard/
    ├── commandTypes.ts                # JSON Schema 类型与校验
    ├── sampleScript.ts                # 内置示例脚本
    ├── WhiteboardCanvas.tsx           # SVG 渲染（自动按比例缩放）
    └── ScriptRunner.ts                # 逐步动画执行器（requestAnimationFrame）

server/
├── index.ts                           # Express 入口
├── static.ts                          # 生产环境静态文件托管
└── routes.ts                          # API 路由占位

script/
└── build.ts                           # 前端 + 服务端生产构建
```
