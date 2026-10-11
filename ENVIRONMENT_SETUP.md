# 环境配置与视频制作指南

本指南面向新电脑、服务器，以及要使用本项目制作视频的 AI 智能体。源码提供白板动画、配音调用和 MP4 导出能力；制作视频仍需把项目运行起来。最后核对日期：2026-10-12。

## 1. 先选择制作方式

| 制作方式 | 需要的密钥 | 适用场景 |
| --- | --- | --- |
| 智能体自行编写 JSON，导出无声 MP4 | 无 | 先验证环境，或制作纯白板动画 |
| 智能体自行编写 JSON，导出有声 MP4 | `GEMINI_API_KEY` | 推荐：智能体负责教学内容，项目负责动画和旁白 |
| 调用项目接口，从文字或题图生成脚本再导出 | `PERPLEXITY_API_KEY`；有声时另需 `GEMINI_API_KEY` | 使用应用内置的识图和脚本生成 |
| 互动英语课堂和语音评分 | 另需 Azure Speech 配置、课程包和访问口令 | 可选模块，普通视频制作不需要 |

拥有 ChatGPT、Gemini 或 Perplexity 的网页订阅，不代表此项目已获得 API 密钥、模型权限或调用额度。使用者配置自己的服务端密钥；公开仓库不附带作者账号的密钥和额度。

## 2. 安装基础环境

项目 `package.json` 声明 Node.js `24.12.0`、npm `11.6.2`。优先使用这些版本；切换 Node 版本后重新安装依赖，因为 SQLite 包包含原生模块。

还需要 Git、FFmpeg、Chrome/Chromium、中文字体和可写磁盘。渲染器需要真正启动浏览器子进程，并通过本机 HTTP 访问应用；仅能阅读网页、不能运行命令的智能体，需要连接一个已经运行的服务。

### macOS

安装 Node.js 后，安装其余工具：

```bash
brew install git ffmpeg
brew install --cask google-chrome
node --version
npm --version
ffmpeg -version
```

系统需有可用的中文字体。渲染器自动尝试 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`。

### Debian / Ubuntu 服务器

先安装项目声明的 Node.js/npm 版本，再安装系统依赖：

```bash
sudo apt-get update
sudo apt-get install -y git ffmpeg chromium fonts-noto-cjk python3 make g++
```

不同发行版的 Chromium 包和安装路径可能不同。若 `/usr/bin/chromium` 不存在，设置 `.env` 中的 `CHROME_EXECUTABLE_PATH` 为实际可执行文件路径。浏览器以 headless 方式启动，不要求桌面环境。Windows 用户建议先在 WSL2 的 Linux 环境中按上述流程配置；本次发布未进行 Windows 原生验证。

## 3. 克隆并安装项目

```bash
git clone https://github.com/adorevip19/ai-whiteboard.git
cd ai-whiteboard
npm ci
cp .env.example .env
```

`.env` 放在项目根目录，服务启动时会加载它。修改配置后重启服务。所有密钥只放服务端，不要写进前端、JSON 讲解脚本或 GitHub 提交。

## 4. 配置需要的能力

### 无声视频：无需 API 密钥

保持 `.env` 中密钥为空，导出时显式使用 `--tts false`。JSON 由调用智能体依据 [AI_GUIDE.md](./AI_GUIDE.md) 编写。

### 有声视频：Gemini 配音

按照 [Google 官方密钥指南](https://ai.google.dev/gemini-api/docs/api-key)，在 Google AI Studio 创建或管理项目密钥，确认项目的模型权限、地区、计费和配额。然后在 `.env` 中填写：

```dotenv
GEMINI_API_KEY=替换为你自己的密钥
GEMINI_TTS_VOICE=Sulafat
```

当前代码在 `server/geminiTts.ts` 使用 `gemini-3.8-flash-tts` 和 Interactions API，默认音色 `Sulafat`；模型名目前是代码常量，不能通过增加 `GEMINI_TTS_MODEL` 环境变量来切换。账号若无法访问这个模型，需要先解决模型权限，或由维护者修改并验证配音适配器。每个命令的 `narration` 是实际朗读内容。

可以先验证配音接口，再渲染长视频：

```bash
mkdir -p output
curl --fail-with-body http://127.0.0.1:5001/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"你好，这是白板视频配音测试。"}' \
  -o output/tts-test.wav
ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 output/tts-test.wav
```

此步骤在完成第 5 节启动服务后执行，会消耗配置账号的 API 额度。失败时检查终端中的 HTTP 状态和返回错误，不要把错误响应当成音频交付。

### 应用自动识题、生成脚本：Perplexity

按照 [Perplexity 官方快速入门](https://docs.perplexity.ai/docs/getting-started/quickstart) 获取 API 密钥，在 `.env` 填入 `PERPLEXITY_API_KEY`。模型配置示例已放在 `.env.example`：

```dotenv
PERPLEXITY_API_KEY=替换为你自己的密钥
PERPLEXITY_GENERATE_MODEL=openai/gpt-5.5
PERPLEXITY_REPAIR_MODEL=openai/gpt-5.2
PERPLEXITY_VISION_MODEL=openai/gpt-5.4
PERPLEXITY_MAX_REPAIR_ROUNDS=3
```

这些是项目配置值，使用者需确认自己的 API 账号支持对应模型。该路径通过 Perplexity 服务调用模型，不要求额外设置 `OPENAI_API_KEY`。如果由外部智能体直接编写 JSON，则可以完全不配置这一组变量。

### 浏览器路径与数据目录

按需设置 `.env`，路径含空格时加引号，例如 macOS：

```dotenv
CHROME_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

`DATABASE_DIR` 可指定 SQLite 等数据的持久化目录；未设置时使用 `RAILWAY_VOLUME_MOUNT_PATH` 或当前工作目录。目录必须可写。不要从另一台机器复制 `node_modules`，也不要把私有数据库上传到仓库。

## 5. 启动服务

开发模式，在项目根目录运行并保持终端开启：

```bash
PORT=5001 npm run dev
```

打开 `http://127.0.0.1:5001/#/`。可在另一个终端确认服务可达：

```bash
curl --fail http://127.0.0.1:5001/ -o /dev/null
```

生产模式先构建再启动：

```bash
npm run check
npm run build
PORT=5001 npm start
```

默认端口是 5000；本指南统一使用 5001。不要同时用同一端口启动两个实例。

## 6. 导出第一个 MP4（不需要密钥）

服务运行后，在另一个终端进入项目根目录执行：

```bash
node skills/whiteboard-lecture-video/scripts/render_whiteboard_mp4.mjs \
  --script examples/hello-whiteboard.json \
  --out output/hello-whiteboard.mp4 \
  --base-url http://127.0.0.1:5001 \
  --tts false

ffprobe -v error -show_entries format=duration,size \
  -of default=noprint_wrappers=1 output/hello-whiteboard.mp4
```

看到 `"ok": true` 后，确认 MP4 能播放、中文字可读且末尾完整。仅启动网页成功不代表视频导出依赖已齐全。

启用有声视频时，先填写 Gemini 密钥，再将 `--tts false` 改为 `--tts true`。可添加 `--aspect portrait` 生成竖屏，或添加 `--board-theme dark` 使用黑色白板。

不安装 Codex Skill 也可以直接运行上面的仓库内脚本。若使用 Codex，可选运行 `npm run install:skills`，将配套技能安装到 `${CODEX_HOME:-~/.codex}/skills`，然后刷新会话。安装脚本会替换同名已安装技能；有自定义修改时先备份。

## 7. 给其他智能体的使用入口

依次读取：

1. 本文：配置和运行环境。
2. [AI_GUIDE.md](./AI_GUIDE.md)：JSON 命令、坐标、分页、旁白和布局规范。
3. [VIDEO_API.md](./VIDEO_API.md)：`POST /api/video/render` 请求与 MP4 响应。
4. [whiteboard-lecture-video 技能](./skills/whiteboard-lecture-video/SKILL.md)：制作和画面检查流程。
5. [examples/hello-whiteboard.json](./examples/hello-whiteboard.json)：可运行的最小示例。

可以直接把下面的任务交给具有终端和文件权限的智能体：

> 克隆 https://github.com/adorevip19/ai-whiteboard 。先读 ENVIRONMENT_SETUP.md、AI_GUIDE.md 和 VIDEO_API.md。检查依赖，使用已由我配置的服务端密钥，按我提供的教学材料编写 JSON 脚本并导出 MP4。先跑无声示例验证渲染链路；正式视频按需求启用配音。检查开头、中间、结尾画面和音频，修正后交付 MP4 及脚本。不要输出或提交任何真实密钥。

只具备远程 HTTP 调用能力的智能体，可连接由使用者部署的服务，按 `VIDEO_API.md` 调用接口并保存响应体。文档中的历史 Demo 地址不保证持续在线；把实际运行地址作为 `--base-url` 传入。

## 8. 可选：互动课堂

普通白板视频无需设置本节。若启用 `/#/learn`，参考 [INTERACTIVE_LESSONS.md](./INTERACTIVE_LESSONS.md)，另准备合法持有的课程包，以及 Azure Speech 的 `AZURE_SPEECH_KEY` 和 `AZURE_SPEECH_REGION`。账号创建步骤参考 [Microsoft 官方指南](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/get-started-speech-to-text)。

家庭访问配置包括 `INTERACTIVE_FAMILY_PASSWORD`、`INTERACTIVE_PARENT_PIN` 和至少 32 字符的 `INTERACTIVE_SESSION_SECRET`。可用 `openssl rand -hex 32` 生成自己的会话密钥。示例默认 `INTERACTIVE_PASSWORDLESS=false`。

本仓库发布完整课堂程序和导入工具，不附带作者的课程媒体、儿童录音、作答记录或私有数据库。空的课程列表是正常初始状态。用以下命令导入自己的课程包：

```bash
npx tsx script/interactive/import-course.ts /path/to/your-course
```

## 9. Railway 部署

仓库已包含 `railway.json` 和 `railpack.json`。创建 Node 服务并连接此仓库；构建运行 `npm run build`，启动运行 `npm start`，服务使用 Railway 注入的 `PORT`。运行镜像依赖包含 Chromium、FFmpeg 和中文字体。

在服务 Variables 中填入所需 API 配置，不能依赖本机 `.env`。需要保留分享/课堂数据时挂载持久化卷并配置数据路径；使用 SQLite 时采用单实例。部署后用部署域名跑一次本指南示例，验证服务内浏览器启动和 MP4 导出。

## 10. 常见问题

| 症状 | 处理 |
| --- | --- |
| `ECONNREFUSED` | 先启动服务，核对端口与 `--base-url`，确认服务进程未退出。 |
| `EADDRINUSE` | 换一个未占用端口，并同步修改调用地址。 |
| 找不到 Chrome/Chromium | 安装浏览器，把 `CHROME_EXECUTABLE_PATH` 设置为可执行文件而非目录。 |
| `spawn ffmpeg ENOENT` | 安装 FFmpeg，确认服务进程的 PATH 能找到它，再重启服务。 |
| 中文空白或方框 | 安装中文字体，例如 Linux 的 `fonts-noto-cjk`，然后重启服务重渲染。 |
| `better-sqlite3` / `NODE_MODULE_VERSION` 错误 | 切换到项目声明的 Node 版本，再运行 `npm ci`；必要时安装原生编译工具。 |
| Gemini 501 | 未配置 `GEMINI_API_KEY`；配置后重启，或用 `--tts false` 验证无声视频。 |
| Gemini 403 / 429 / 模型不可用 | 检查账号权限、地区、计费、配额及代码使用的模型；不要无限自动重试。 |
| Perplexity 生成失败 | 核对密钥和模型权限；可先由智能体直接编写 JSON，验证渲染部分。 |
| 课堂没有课程 | 先导入自己的课程包，仓库不会附带作者私有课程。 |
| 渲染请求超时 | 视频接口同步返回文件；调整调用方或反向代理超时，较长课程分段生成。 |

代码检查与离线测试（不调用真实计费接口）：

```bash
npm run check
node --import tsx --test server/geminiTts.test.ts server/interactive/*.test.ts
npm run build
```

`script/interactive/probe-*.ts` 和部分 `qa-*.ts` 是开发时的真实服务验证工具，依赖特定课程文件，可能产生 API 费用；不要当作通用安装步骤或自动 CI 运行。

## 11. 本次发布验证

2026-10-12 在 macOS、Node.js 24.12.0 的独立发布目录执行 `npm ci`，类型检查、24 项离线测试和生产构建均通过。以生产模式启动后，通过仓库内脚本和示例成功导出 1200×800、H.264、约 5.67 秒的无声 MP4，完整解码并检查了开头、中间和结尾画面。

本次发布检查未调用真实 Gemini、Perplexity 或 Azure 计费接口；上述离线测试不能证明新使用者的 API 账号权限和额度。Linux、Windows 及新部署的云端服务也需在各自环境按第 6 节再次验证。
