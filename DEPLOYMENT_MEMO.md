# 部署备忘录：修复中文白板视频方框字

记录时间：2026-05-03 20:19:49 CST

## 背景

线上 `POST /api/video/render` 生成中文白板视频时，请求 payload 中的中文字段可以正确解码，但 headless Chromium 渲染出的 MP4 里中文板书显示为一个个方框。判断原因是 Railway 生产容器缺少 CJK 中文字体，导致 SVG/Canvas 录制阶段字体 fallback 失败。

## 本次修改

1. 新增 `railpack.json`，让 Railway/Railpack 运行时镜像安装：
   - `chromium`
   - `ffmpeg`
   - `fonts-noto-cjk`
2. 新增 `client/src/whiteboard/fonts.ts`，统一白板文本字体栈：
   - `"Noto Sans CJK SC"`
   - `"Noto Sans SC"`
   - `"WenQuanYi Micro Hei"`
   - `"Microsoft YaHei"`
   - `"PingFang SC"`
   - `system-ui`
   - `sans-serif`
3. 更新 `client/src/whiteboard/WhiteboardCanvas.tsx`，让普通文字、分段文字、几何标签、坐标标签等 SVG 文本显式使用 CJK 字体 fallback。
4. 更新 `client/src/index.css`，应用全局 sans 字体和 `.whiteboard-math` 也加入 CJK fallback。
5. 同步更新 `README.md`、`VIDEO_API.md`、`PROJECT_CONTEXT.md` 中的 Railway 运行时依赖说明。

## 本地验证

已执行：

```text
npm run check
npm run build
```

结果：

- TypeScript 检查通过。
- 生产构建通过。
- 构建中仅出现既有警告：PostCSS `from` option、JSXGraph eval、chunk size warning；没有阻塞错误。

## 云端部署

部署方式：

```text
railway up --ci --message "Fix CJK font rendering for headless video export"
```

Railway 项目信息：

- Project: `authentic-youth`
- Environment: `production`
- Service: `ai-whiteboard`
- Build log: `https://railway.com/project/cd01bb17-012c-4e83-a44c-4de27d2fee9b/service/3d7fb017-d7a9-48c2-9448-b7be892ce2bc?id=b36f9587-e914-4cce-a159-d33c364171b1&`

关键部署日志确认：

```text
using build driver railpack-v0.23.0
install apt packages: chromium ffmpeg fonts-noto-cjk
Setting up fonts-noto-cjk (1:20220127+repack1-1) ...
Regenerating fonts cache...
Deploy complete
```

镜像摘要：

```text
containerimage.digest: sha256:68eca69c6795371efbac99bad9e53617deb5f0b127fdda2868bbf202ba343bcb
```

## 生产测试

测试接口：

```text
POST https://ai-whiteboard-production-94ad.up.railway.app/api/video/render
```

测试 payload 摘要：

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
        "text": "大数定律：随机中的稳定性",
        "x": 80,
        "y": 120,
        "fontSize": 48,
        "color": "#111111",
        "duration": 800
      },
      {
        "type": "write_text",
        "id": "body",
        "text": "如果字体正常，这一行不会显示成方框。",
        "x": 80,
        "y": 220,
        "fontSize": 34,
        "color": "#333333",
        "duration": 800
      }
    ]
  },
  "ttsEnabled": false
}
```

接口返回：

```text
HTTP 200
Content-Type: video/mp4
Size: 19401 bytes
```

视频探测：

```text
codec_name=h264
width=1200
height=800
duration=2.175824
```

抽帧文件：

```text
/tmp/ai-whiteboard-cjk-test-final.png
```

抽帧结论：

- 标题“大数定律：随机中的稳定性”正常显示。
- 第二行“如果字体正常，这一行不会显示成方框。”正常显示。
- 未发现中文乱码或 tofu 方框 glyph。

## 结论

本次部署后，Railway 生产环境已经具备 CJK 字体，白板渲染字体栈也显式指定中文 fallback。生产 `/api/video/render` 生成中文 MP4 的抽帧验证通过，中文板书不再显示为方框。
