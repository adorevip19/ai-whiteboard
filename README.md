# AI Whiteboard · JSON 命令式白板

一个专门给 AI 调用的命令式白板工具。AI 通过生成 JSON 命令控制白板写字与画线，所有内容以"逐步出现"的动画过程呈现。

## 功能（v1 MVP）

- **set_canvas** — 定义画布大小与背景色
- **write_text** — 在指定坐标写字（打字机效果，按字符逐个出现）
- **draw_line** — 从 `from` 坐标平滑延伸到 `to` 坐标
- 顺序执行 commands 数组，实时显示当前步骤
- JSON 格式错误、未知命令、缺字段都有明确提示

详细的 AI 调用规范见 [AI_GUIDE.md](./AI_GUIDE.md)。

## 技术栈

- React 18 + TypeScript
- Vite 构建
- SVG 渲染（声明式动画 + 元素身份保留）
- Tailwind CSS + shadcn/ui

## 本地开发

```bash
npm install
npm run dev          # 开发服务器（含 Express 后端，本 MVP 暂未使用）
npm run build:client # 仅构建前端到 dist/public
```

## 在 Railway 部署

仓库已包含 `railway.json`、`nixpacks.toml`、`Caddyfile`。在 Railway 上：

1. **New Project → Deploy from GitHub repo**，选择本仓库
2. Railway 自动识别 Nixpacks 配置：安装 Node 20 + Caddy → `npm ci` → `npm run build:client` → 启动 Caddy
3. 部署完成后在 **Settings → Networking → Generate Domain** 获取公开 URL

不需要任何环境变量。`$PORT` 由 Railway 自动注入，Caddyfile 已配置读取。

## 项目结构

```
client/src/
├── App.tsx                            # 路由入口
├── pages/whiteboard.tsx               # 主界面（编辑器 + 画布 + 步骤指示）
└── whiteboard/
    ├── commandTypes.ts                # JSON Schema 类型与校验
    ├── sampleScript.ts                # 内置示例脚本
    ├── WhiteboardCanvas.tsx           # SVG 渲染（自动按比例缩放）
    └── ScriptRunner.ts                # 逐步动画执行器（requestAnimationFrame）
```
