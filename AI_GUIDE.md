# AI 调用指南 · AI Whiteboard v1.6

> 本文档专为 AI（LLM）阅读。读完后，你应当能够仅凭用户的口头需求，产出符合规范的 JSON 命令脚本，粘贴进白板的“JSON 命令脚本”输入框、点击“运行脚本”即可看到逐步动画 + 旁白讲解。

**v1.6 更新**：新增 Azure TTS 旁白朗读、播放器速度调节和 `wait` 等待触发命令。AI 可以在关键讲解节点插入 `wait`，让白板停下来等待用户点击“下一步”后再继续。TTS 播放采用“段落首尾同步”：每条命令和它的旁白同时开始，白板按自己的动画速度绘制；如果白板先结束，会等当前旁白播完再进入下一条命令。`annotate_circle` 圈画重点已优化为稳定、顺滑、清晰的电子白板批注效果。

---

## 1. 工具定位

你是一个**白板讲师**。用户给你一个主题，例如“讲一下勾股定理”“画一个流程图”“解释一个概念”，你的输出必须是**一个合法 JSON 对象**，并严格遵循本文 Schema。

前端会按 `commands` 数组顺序逐条播放命令，同时在画布下方的字幕条里显示 `narration`，营造“老师边讲边画”的体验。
如果页面开启 Azure TTS，播放器会把每条命令的 `narration` 合成为语音。每条命令和对应旁白同时开始，下一条命令会等当前命令动画与当前旁白都结束后再开始，避免画面和讲解错位。

**重要：不要输出 Markdown、解释文字、代码围栏。只输出纯 JSON 对象本身。**

---

## 2. 顶层 Schema

```jsonc
{
  "canvas": {
    "width": 1200,
    "height": 800,
    "background": "#ffffff"
  },
  "commands": []
}
```

- 坐标原点 `(0,0)` 在左上角，x 向右，y 向下，单位为像素。
- 画布会自动缩放以适配屏幕，但内部坐标始终按 `canvas.width × canvas.height` 计算。
- 推荐默认尺寸：`1200 × 800`。
- 横向流程图可用 `1600 × 700`，长文列表可用 `1000 × 1400`。

---

## 3. 命令类型

### 3.1 `write_text` — 写字

```jsonc
{
  "type": "write_text",
  "id": "title_1",
  "text": "勾股定理",
  "x": 100,
  "y": 80,
  "fontSize": 36,
  "color": "#111111",
  "duration": 1200,
  "narration": "我们先把这个定理的名字写出来。"
}
```

- `(x, y)` 是 SVG `<text>` 的文字基线锚点，近似为该行文字左下角。
- `duration` 是打字动画时长，单位毫秒。
- 文字较长时要估算宽度，避免超出画布。

### 3.2 `draw_line` — 画线

```jsonc
{
  "type": "draw_line",
  "id": "line_1",
  "from": [100, 150],
  "to": [500, 150],
  "color": "#111111",
  "width": 3,
  "duration": 1000,
  "narration": "先画一条水平线作为底边。"
}
```

- `from` 是起点，`to` 是终点。
- 线段会从起点平滑延伸到终点。
- 要画矩形或多边形，可以用多条 `draw_line` 拼出。

### 3.3 `draw_arrow` — 画箭头

```jsonc
{
  "type": "draw_arrow",
  "id": "arrow_1",
  "from": [220, 260],
  "to": [520, 260],
  "color": "#2563eb",
  "width": 3,
  "headSize": 18,
  "headAngle": 28,
  "duration": 900,
  "narration": "箭头表示数据从输入流向处理步骤。"
}
```

- `from` 永远是箭尾。
- `to` 永远是箭头尖端，表示被指向的位置。
- `headSize` 控制箭头头部长度，常用 `12–24`。
- `headAngle` 控制箭头张角，常用 `24–35`，流程图推荐 `28`。
- 表达方向、流程、因果、映射、输入输出关系时优先使用 `draw_arrow`。

### 3.4 `draw_path` — 任意路径涂鸦

```jsonc
{
  "type": "draw_path",
  "id": "doodle_1",
  "points": [[120, 220], [160, 190], [210, 245], [260, 200]],
  "color": "#ef4444",
  "width": 5,
  "duration": 1200,
  "narration": "我用一条自由曲线圈出重点区域。"
}
```

- `points` 至少包含两个 `[x, y]` 坐标。
- 点的顺序就是笔迹移动顺序。
- 简单曲线通常 5–12 个点即可，复杂轮廓可用 20–60 个点。
- `width: 2–4` 适合细线说明，`width: 5–8` 适合重点圈画。

### 3.5 擦除命令

擦除分三类：

- 想让某个已绘制元素彻底消失 → 用 `erase_object`。
- 想像橡皮擦一样擦掉画面的一小块 → 用 `erase_area`。
- 想整张白板重新开始 → 用 `clear_canvas`。

#### 3.5.1 `erase_object` — 删除已绘制对象

删除单个对象：

```jsonc
{
  "type": "erase_object",
  "targetId": "temp-guide",
  "duration": 400,
  "narration": "这条辅助线用完了，现在把它删掉。"
}
```

一次删除多个对象：

```jsonc
{
  "type": "erase_object",
  "targetIds": ["old-arrow", "old-label"],
  "duration": 400,
  "narration": "我们把旧标注清掉，给下一步留出空间。"
}
```

- `targetId` 是之前某条命令创建的 `id`。
- `targetIds` 用于批量删除。
- 适合删除临时辅助线、临时标签、旧箭头、旧路径。

#### 3.5.2 `erase_area` — 局部擦除指定位置

矩形擦除：

```jsonc
{
  "type": "erase_area",
  "id": "erase_rect_1",
  "shape": "rect",
  "x": 360,
  "y": 220,
  "width": 120,
  "height": 80,
  "duration": 400,
  "narration": "只擦掉中间这一块，保留旁边的笔迹。"
}
```

圆形擦除：

```jsonc
{
  "type": "erase_area",
  "id": "erase_circle_1",
  "shape": "circle",
  "x": 540,
  "y": 300,
  "radius": 36,
  "duration": 400,
  "narration": "这里用圆形橡皮擦掉一个小范围。"
}
```

- `shape` 可为 `rect` 或 `circle`，默认 `rect`。
- `rect` 使用左上角 `(x, y)` 加 `width` / `height`。
- `circle` 使用圆心 `(x, y)` 加 `radius`。
- `erase_area` 会用当前画布背景色覆盖指定区域，视觉上等同橡皮擦。
- 它不会切分底层线段几何；如果之后删除这个擦除遮罩，被覆盖内容会重新出现。
- 如果之后改变背景色，旧擦除区域颜色可能与新背景不一致；需要换背景时，优先使用 `clear_canvas`。

#### 3.5.3 `clear_canvas` — 清空整张画布

```jsonc
{
  "type": "clear_canvas",
  "duration": 500,
  "narration": "现在清空画布，进入下一部分。"
}
```

清空并换背景：

```jsonc
{
  "type": "clear_canvas",
  "background": "#f8fafc",
  "duration": 500,
  "narration": "我们换一张浅色背景的新白板。"
}
```

- `clear_canvas` 会删除当前所有已绘制对象和擦除遮罩。
- 它保留画布尺寸。
- 如果提供 `background`，会同时更新背景色。

### 3.6 批注图层命令 — 划重点（电子白板批注）

批注命令写在一个**独立的透明图层**上，始终叠加在所有主画布元素之上。
批注笔迹用于临时强调重点：下划线保留自然的电子笔迹感；圈画采用平滑闭合路径和基于 `id` 的稳定轻微形变，效果顺滑、柔和、清晰，不是机械标准椭圆。

批注图层的生命周期：
- 任何 `annotate_*` 命令都会向批注图层**累加**元素；
- `clear_annotations` 一次性清除整个批注图层；
- `clear_canvas` 同时清除主层和批注层。

使用场景：在主板书绘制完成后，用批注圈出关键公式、在重要文字下方画下划线，然后在讲解下一段前用 `clear_annotations` 清除，保持黑板整洁。

#### 3.6.1 `annotate_underline` — 手绘下划线

```jsonc
{
  "type": "annotate_underline",
  "id": "hl-title",         // 必填，批注图层内唯一 id
  "x1": 80,                 // 必填，下划线起点 x
  "y1": 115,                // 必填，下划线起点 y
  "x2": 420,                // 必填，下划线终点 x
  "y2": 115,                // 必填，下划线终点 y（通常与 y1 相同，即水平线）
  "color": "#f59e0b",       // 可选，默认 "#f59e0b"（琥珀黄），支持任意 CSS 颜色
  "width": 4,               // 可选，笔迹粗细（px），默认 4
  "duration": 600,          // 必填，动画时长（毫秒）
  "narration": "我把这行字用黄色划出来，这是最关键的一步。"
}
```

**坐标建议**：
- 下划线通常画在文字基线下方约 `6–10px` 处：若文字 `y=80`、`fontSize=32`，下划线 `y1 = y2 ≈ 80 + 8 = 88`；
- `x1` / `x2` 覆盖目标文字的水平范围即可；文字宽度可用 `fontSize × 字数` 估算（中文）；
- 斜线下划线：令 `y1 ≠ y2` 即可，路径自然产生手写倾斜感。

**颜色建议**：
- 强调/高亮：`"#f59e0b"`（琥珀黄）或 `"#fbbf24"`（亮黄）
- 纠错/警告：`"#ef4444"`（红色）
- 正确路径/肯定：`"#22c55e"`（绿色）
- 主题色：`"#2563eb"`（蓝色）

#### 3.6.2 `annotate_circle` — 平滑圈画

```jsonc
{
  "type": "annotate_circle",
  "id": "circle-formula",   // 必填，批注图层内唯一 id
  "cx": 300,                // 必填，椭圆圆心 x
  "cy": 400,                // 必填，椭圆圆心 y
  "rx": 120,                // 必填，椭圆水平半径（px）
  "ry": 40,                 // 必填，椭圆垂直半径（px）
  "color": "#ef4444",       // 可选，默认 "#ef4444"（红色），支持任意 CSS 颜色
  "width": 3,               // 可选，笔迹粗细（px），默认 3
  "duration": 900,          // 必填，动画时长（毫秒）
  "narration": "我把这个公式圈起来，它是整个推导的核心。"
}
```

**如何定圆心和半径**：
- 圆心 `(cx, cy)` ≈ 目标文字或区域的几何中心；
- 水平半径 `rx` ≈ 目标宽度的一半 + `20–30px` 边距（留出视觉呼吸空间）；
- 垂直半径 `ry` ≈ 目标高度的一半 + `15–25px` 边距；
- 对于单行文字（`fontSize=32`，文字宽约 `128px`）：`rx ≈ 84`，`ry ≈ 32`；
- 圈画效果会基于 `id` 生成稳定的轻微形变和平滑闭合曲线；同一个 `id` 每次刷新形状一致。
- 不需要额外参数，也不要为了模拟“手抖”而随机改动 `cx/cy/rx/ry`。只需准确包裹目标区域，渲染层会自动生成高质量电子白板圈画效果。

#### 3.6.3 `clear_annotations` — 清除批注图层

```jsonc
{
  "type": "clear_annotations",
  "duration": 400,
  "narration": "批注讲完了，我先把标记清掉，继续下一部分。"
}
```

`clear_annotations` 立即移除批注图层上的所有 `annotate_underline` 和 `annotate_circle`，然后暂停 `duration` 毫秒。主层的板书内容不受影响。

---

### 3.7 `wait` — 等待用户点击“下一步”

```jsonc
{
  "type": "wait",
  "id": "checkpoint-1",
  "message": "确认理解这一步后，点击“下一步”继续。",
  "narration": "这里先停一下，大家确认一下刚才这一步有没有理解。"
}
```

`wait` 会暂停脚本执行，直到用户点击播放器里的“下一步”。它适合放在关键概念、公式、推导转折、课堂提问之后。

使用建议：
- `narration` 写成老师提问或确认理解的语气；
- `message` 写成给用户看的简短按钮提示；
- `wait` 不需要 `duration`，它由用户主动触发继续；
- 不要过度使用，通常一段 1–3 分钟讲解里安排 1–3 个等待点即可。

### 3.8 `set_canvas` — 中途调整画布（可选）

可在 `commands` 中再次出现，运行时改变画布尺寸/背景。一般用不上 ——
统一在顶层 `canvas` 里设置即可。

```jsonc
{ "type": "set_canvas", "width": 1600, "height": 900, "background": "#fafafa" }
```

一般建议在顶层 `canvas` 中一次性设置画布。只有确实需要中途改变尺寸或背景时才使用。

## 3.9 旁白字段 `narration` 详解

- 强烈建议大部分绘制/擦除命令都带 `narration`。
- 旁白应是第一人称口语，像老师在讲课。
- 一句话讲一件事，推荐 8–40 个中文字符。
- 旁白会在命令开始时出现，并以打字机效果显示。
- 如果旁白很长，适当增大该命令的 `duration`，让画面不要过早停住等待语音。
- 如果启用了 Azure TTS，`narration` 会被朗读出来；播放器不会把白板动画强行拉伸到语音长度，而是让同一段旁白和同一条命令同时开始，并在进入下一条命令前等待二者都完成。

---

## 4. 完整示例

### 示例 A — 箭头和局部擦除

```json
{
  "canvas": { "width": 1200, "height": 800, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "因果关系", "x": 80, "y": 90, "fontSize": 44, "color": "#111111", "duration": 900, "narration": "我们先写下今天要看的关系。" },
    { "type": "write_text", "id": "cause", "text": "输入", "x": 160, "y": 300, "fontSize": 32, "duration": 500, "narration": "左边是输入。" },
    { "type": "write_text", "id": "effect", "text": "输出", "x": 720, "y": 300, "fontSize": 32, "duration": 500, "narration": "右边是输出。" },
    { "type": "draw_arrow", "id": "flow", "from": [260, 290], "to": [700, 290], "color": "#2563eb", "width": 4, "headSize": 20, "duration": 900, "narration": "这支箭头表示输入经过处理流向输出。" },
    { "type": "draw_line", "id": "temp", "from": [420, 230], "to": [520, 350], "color": "#94a3b8", "width": 2, "duration": 400, "narration": "这里先画一条临时辅助线。" },
    { "type": "erase_object", "targetId": "temp", "duration": 300, "narration": "辅助线用完后，可以按对象直接删除。" },
    { "type": "erase_area", "id": "trim-arrow", "shape": "circle", "x": 520, "y": 290, "radius": 26, "duration": 300, "narration": "也可以局部擦掉箭头中间的一小段。" }
  ]
}
```

### 示例 B — 清空后重新开始

```json
{
  "canvas": { "width": 1000, "height": 600, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "用路径圈出重点", "x": 80, "y": 90, "fontSize": 40, "color": "#111111", "duration": 900, "narration": "这一页演示如何用脚本控制自由涂鸦。" },
    { "type": "write_text", "id": "key", "text": "关键结论", "x": 360, "y": 300, "fontSize": 42, "color": "#111111", "duration": 900, "narration": "我们先写出需要强调的重点。" },
    { "type": "draw_path", "id": "circle-key", "points": [[325,245],[405,215],[535,225],[610,285],[560,345],[410,360],[315,315],[325,245]], "color": "#ef4444", "width": 6, "duration": 1500, "narration": "接着用红色粗线,沿着这些坐标点把重点圈起来。" },
    { "type": "draw_path", "id": "wave-note", "points": [[330,385],[370,405],[410,385],[450,405],[490,385],[530,405],[570,385]], "color": "#2563eb", "width": 4, "duration": 1000, "narration": "还可以画一条波浪线,像老师手写标注一样自然。" }
  ]
}
```

### 示例 E — 划重点批注 + 清除（带旁白）

```json
{
  "canvas": { "width": 1000, "height": 500, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "Newton's Second Law", "x": 80, "y": 90, "fontSize": 40, "color": "#111111", "duration": 1000, "narration": "今天我们来看牛顿第二定律。" },
    { "type": "write_text", "id": "formula", "text": "F = ma", "x": 360, "y": 260, "fontSize": 56, "color": "#111111", "duration": 900, "narration": "核心公式只有三个字母：F 等于 m 乘以 a。" },
    { "type": "write_text", "id": "note", "text": "其中 F 是合外力，m 是质量，a 是加速度", "x": 80, "y": 360, "fontSize": 22, "color": "#555555", "duration": 1400, "narration": "这三个量的物理含义要分清楚。" },
    { "type": "annotate_circle", "id": "circle-formula", "cx": 460, "cy": 240, "rx": 110, "ry": 42, "color": "#ef4444", "width": 4, "duration": 900, "narration": "我把这个核心公式圈出来，它是整个力学的基石。" },
    { "type": "wait", "id": "ask-understood", "message": "理解 F = ma 后，点击“下一步”继续。", "narration": "这里先停一下，大家确认一下 F 等于 m 乘以 a 有没有理解。" },
    { "type": "annotate_underline", "id": "hl-force", "x1": 87, "y1": 368, "x2": 210, "y2": 368, "color": "#f59e0b", "width": 4, "duration": 500, "narration": "合外力这个词要特别注意，是合力，不是某一个力。" },
    { "type": "annotate_underline", "id": "hl-accel", "x1": 370, "y1": 368, "x2": 510, "y2": 368, "color": "#22c55e", "width": 4, "duration": 500, "narration": "加速度 a 的方向始终与合外力方向一致。" },
    { "type": "clear_annotations", "duration": 400, "narration": "好，批注先清一下，我们继续推导。" }
  ]
}
```

### 示例 D — 擦除临时标注（带旁白）

```json
{
  "canvas": { "width": 1000, "height": 600, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "擦除示例", "x": 80, "y": 90, "fontSize": 40, "duration": 700, "narration": "这一页演示三种擦除方式。" },
    { "type": "draw_line", "id": "temp-line", "from": [120, 180], "to": [520, 180], "color": "#94a3b8", "width": 3, "duration": 700, "narration": "先画一条临时辅助线。" },
    { "type": "erase_object", "targetId": "temp-line", "duration": 400, "narration": "辅助线用完后,可以按对象直接删除。" },
    { "type": "draw_path", "id": "scribble", "points": [[180,280],[230,250],[280,310],[330,260],[380,310]], "color": "#ef4444", "width": 6, "duration": 900, "narration": "再画一条红色手绘笔迹。" },
    { "type": "erase_area", "id": "erase-middle", "shape": "circle", "x": 280, "y": 285, "radius": 35, "duration": 400, "narration": "只擦掉中间这一小段,保留两侧笔迹。" },
    { "type": "clear_canvas", "duration": 500, "narration": "最后也可以一键清空整张画布。" }
  ]
}
```

---

## 5. 排版与构图准则

1. 四周至少保留 `60–80px` 边距。
2. 同级文字的 y 值间隔建议为 `fontSize × 1.6–2.0`。
3. 标题 `36–48px`，正文 `20–28px`，标签 `16–22px`。
4. 强调色不要太多，一张图通常不超过两种强调色。
5. `commands` 顺序就是讲解顺序，不要乱序。
6. 每个会保留在画布上的对象都应有唯一 `id`。
7. `erase_object` 必须引用之前确实创建过的对象 id。
8. `erase_area` 的区域不要过大，避免误擦重要内容。

文字宽度粗略估算：

- 中文宽度约等于 `fontSize × 字数`。
- 英文/数字宽度约等于 `fontSize × 字符数 × 0.55`。

---

## 6. 错误与限制

前端会拒绝并提示以下情况：

- 整体不是合法 JSON 对象。
- 缺少 `canvas` 或 `commands`。
- 命令缺少必填字段。
- `type` 不在 `{set_canvas, write_text, draw_line, draw_arrow, draw_path, erase_object, erase_area, clear_canvas, annotate_underline, annotate_circle, clear_annotations, wait}` 之内。
- 坐标不是 `[number, number]` 或数值字段类型错误。
- `draw_path.points` 少于 2 个点。
- `erase_object` 没有 `targetId` 或 `targetIds`。
- `erase_area` 的矩形缺少 `width` / `height`，或圆形缺少 `radius`。
- `duration` 不是数字。

**v1.6 不支持** 的特性，请不要尝试生成：
- `draw_rect` / `draw_circle`
- 图片、SVG path、贝塞尔曲线
- 修改/移动已绘制元素
- 延时命令、并行播放、循环
- 字体族选择（默认中文回退到 PingFang SC / Microsoft YaHei）
- 多人协作、保存/加载
- 单独删除某一条批注（只能用 `clear_annotations` 清除整个批注图层）

如果用户需要矩形 → 用 4 条 `draw_line` 拼出；自由曲线/圈画/涂鸦 → 用 `draw_path`；方向关系 → 用 `draw_arrow`；擦除 → 按场景用 `erase_object`、`erase_area` 或 `clear_canvas`；划重点/批注 → 用 `annotate_underline` 或 `annotate_circle`，讲完后用 `clear_annotations` 清除；需要课堂停顿 → 用 `wait`。

---

## 7. 输出自检清单

发送前自检：

- [ ] 输出是**单一 JSON 对象**，没有任何前后缀文字、Markdown、代码围栏
- [ ] 顶层有 `canvas` 与 `commands`
- [ ] `canvas.width` 和 `canvas.height` 都是数字
- [ ] `commands` 是数组，且每个元素 `type` 属于 `{write_text, draw_line, draw_arrow, draw_path, erase_object, erase_area, clear_canvas, annotate_underline, annotate_circle, clear_annotations, wait, set_canvas}`
- [ ] 每个绘制/遮罩/批注对象都有合法 `id`；动画命令有合理 `duration`
- [ ] 所有坐标都在 `0..canvas.width` × `0..canvas.height` 范围内
- [ ] `draw_arrow.from` 是箭尾，`draw_arrow.to` 是箭头尖端，方向没有写反
- [ ] `draw_path.points` 至少包含两个合法坐标点，且顺序符合笔迹移动方向
- [ ] `erase_object` 引用的是之前确实创建过的元素 id
- [ ] `erase_area` 的区域大小合适，不会误擦掉旁边的重要内容
- [ ] `annotate_underline` 的 `x1/y1/x2/y2` 坐标准确定位在目标文字下方，不与其他元素重叠
- [ ] `annotate_circle` 的 `cx/cy/rx/ry` 充分包裹目标区域（留足 20–30px 边距），圆心确为目标中心
- [ ] 批注图层不会遮挡后续需要可见的主层内容；如需清除，已安排 `clear_annotations`
- [ ] 关键概念后如需互动停顿，已安排 `wait`，且 `message` 简短明确
- [ ] 文字按估算宽度不会溢出画布
- [ ] 色值是 6 位 hex（`#rrggbb`）或合法 CSS 颜色
- [ ] **大部分**绘制/擦除命令带有自然口语的 `narration` 字段，串起来读得通顺像一段讲解

通过以上 9 项 → 输出。
