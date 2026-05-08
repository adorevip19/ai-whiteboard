# 新电脑安装说明

这份说明用于在一台新电脑上快速恢复 `ai-whiteboard` 项目和配套 Codex Skill。

## 1. 安装基础环境

需要准备：

- Node.js `24.12.0` 左右版本
- npm `11.6.2` 左右版本
- Git
- ffmpeg
- Chrome 或 Chromium
- Codex 桌面/CLI，且支持本地 Skills

macOS 上可以用 Homebrew 安装常用依赖：

```bash
brew install ffmpeg
brew install --cask google-chrome
```

## 2. 拉取项目

```bash
git clone https://github.com/adorevip19/ai-whiteboard.git
cd ai-whiteboard
npm install
```

## 3. 配置环境变量

复制示例文件：

```bash
cp .env.example .env
```

然后把 `.env` 里的 API Key 补齐。真实密钥只放在 `.env` 里，不要提交到 GitHub。

## 4. 安装 Skill

运行：

```bash
npm run install:skills
```

脚本会把仓库里的 Skill 安装到：

```bash
~/.codex/skills/whiteboard-lecture-video
```

安装后，重新打开 Codex 或刷新会话，让 Codex 重新发现本地 Skill。

## 5. 启动本地服务

```bash
PORT=5001 npm run dev
```

浏览器打开：

```text
http://127.0.0.1:5001/#/
```

## 6. 验证 MP4 渲染链路

在另一个终端运行：

```bash
mkdir -p /tmp/whiteboard-skill-smoke
cat > /tmp/whiteboard-skill-smoke/smoke.json <<'JSON'
{"canvas":{"width":1200,"height":800,"background":"#ffffff"},"pages":[{"id":"main","title":"测试"}],"commands":[{"type":"switch_page","id":"p1","pageId":"main","duration":300},{"type":"write_text","id":"title","text":"Skill 渲染测试","x":120,"y":160,"fontSize":42,"color":"#111111","duration":1000,"narration":"这是一个白板视频渲染测试。"}]}
JSON

node ~/.codex/skills/whiteboard-lecture-video/scripts/render_whiteboard_mp4.mjs \
  --script /tmp/whiteboard-skill-smoke/smoke.json \
  --out /tmp/whiteboard-skill-smoke/smoke.mp4 \
  --tts false
```

如果输出里有 `"ok": true`，说明“脚本 -> MP4”链路可用。

## 7. 使用方式

之后可以在 Codex 里直接说：

```text
用 whiteboard-lecture-video 这个 skill，把这些题生成 MP4 合集。
```

支持三种常用输入：

- 上传一张题图，生成单个讲解 MP4。
- 上传多张题图，逐题生成 MP4 后拼成一个总 MP4。
- 给一个文字 topic 或讲解思路，按指定讲法生成讲解 MP4。

## 8. 常见问题

如果 Skill 渲染脚本报 `ECONNREFUSED 127.0.0.1:5001`，说明本地服务没有启动，先运行：

```bash
PORT=5001 npm run dev
```

如果云端部署需要 MP4 导出能力，Railway 配置需要安装：

```text
chromium
ffmpeg
fonts-noto-cjk
```

当前仓库的 `railpack.json` 已包含这些 apt 包。
