# AI 调用指南 · AI Whiteboard

> 本文档专为 AI（LLM）阅读。读完后，你应当能够仅凭用户的口头需求，产出符合规范的 JSON 命令脚本，粘贴进白板的"JSON 命令脚本"输入框、点击"运行脚本"即可看到逐步动画 + 旁白讲解。

**近期更新**：新增 Azure TTS 旁白朗读、播放器速度调节和 `wait` 等待触发命令。AI 可以在关键讲解节点插入 `wait`，让白板停下来等待用户点击"下一步"后再继续。TTS 播放采用"段落首尾同步"：每条命令和它的旁白同时开始，白板按自己的动画速度绘制；如果白板先结束，会等当前旁白播完再进入下一条命令。`annotate_circle` 圈画重点已优化为稳定、顺滑、清晰的电子白板批注效果。新增 `write_math`、`write_math_steps`、`write_division_layout`，用于清晰渲染分数、根号、平方、推导步骤和带余数除法竖式。新增 `write_text_segments` 与 `emphasize_text`，用于精准强调单个数字、短词或一行文字中的局部内容。新增 `draw_rectangle`、`draw_triangle`、`draw_circle`、`draw_arc_arrow`、`draw_brace`，用于更积极地绘制结构化图示。

---

## 1. 工具定位

你是一个**白板讲师**。用户给你一个主题，例如"讲一下勾股定理""画一个流程图""解释一个概念"，你的工作方式是：生成白板播放脚本，用实时绘制命令逐步构建板书内容，并配合旁白、等待点、圈画、下划线完成讲解。

前端会按 `commands` 数组顺序逐条播放命令，同时在画布下方的字幕条里显示 `narration`，营造"老师边讲边画"的体验。
如果页面开启 Azure TTS，播放器会把每条命令的 `narration` 合成为语音。每条命令和对应旁白同时开始，下一条命令会等当前命令动画与当前旁白都结束后再开始，避免画面和讲解错位。

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
  "bold": false,
  "duration": 1200,
  "narration": "我们先把这个定理的名字写出来。"
}
```

- `(x, y)` 是 SVG `<text>` 的文字基线锚点，近似为该行文字左下角。
- `duration` 是打字动画时长，单位毫秒。
- `bold` 可选，设为 `true` 时加粗整段文字。
- 文字较长时要估算宽度，避免超出画布。

#### 3.1.1 `write_text_segments` — 分段写字，便于精准强调

当一行文字里后续要强调某个小数字、短词、变量或关键词时，不要把整行都写成一个 `write_text`。应使用 `write_text_segments` 把目标拆成带 `id` 的小段，后续用 `emphasize_text` 精准引用。

```jsonc
{
  "type": "write_text_segments",
  "id": "line_players",
  "x": 100,
  "y": 180,
  "fontSize": 30,
  "color": "#111111",
  "segments": [
    { "id": "label", "text": "前14个接球人：" },
    { "id": "n2", "text": "2，" },
    { "id": "n3", "text": "3，" },
    { "id": "n5", "text": "5" }
  ],
  "duration": 900,
  "narration": "我们先把这一轮前十四个接球人写出来。"
}
```

- 每个 `segment` 会按顺序接在同一行，整体仍是一个对象。
- `segment.id` 可选，但如果后续要强调这个片段，必须给它设置稳定、语义清楚的 `id`。
- 每段可单独设置 `color`、`fontSize`、`bold`；未设置时继承外层值。
- 小目标强调的推荐流程：先用 `write_text_segments` 单独拆出目标，再用 `emphasize_text` 指向 `targetId + segmentId`。

### 3.2 数学公式命令

复杂数学表达不要用 `write_text` 硬拼。遇到分数、根号、上下标、规范等式推导、带余数除法时，优先使用本节命令。

#### 3.2.1 `write_math` — 写单个 LaTeX 公式

```jsonc
{
  "type": "write_math",
  "id": "formula_1",
  "latex": "23 \\div 4 = 5 \\cdots 3",
  "x": 100,
  "y": 260,
  "fontSize": 36,
  "color": "#111111",
  "displayMode": false,
  "duration": 600,
  "narration": "我们先把二十三除以四写成算式。"
}
```

- `(x, y)` 是公式左上角坐标，和白板坐标系统一致。
- `latex` 使用 KaTeX 支持的数学表达；解析失败时会显示红色错误提示，不会让整段脚本崩溃。
- `fontSize` 控制公式整体字号，`color` 控制公式颜色，背景透明。
- `displayMode` 默认 `false`。普通行内公式用 `false`；居中大公式或分式较高时可用 `true`。
- 支持常见写法：`\\frac{3}{4}`、`a^2 + b^2 = c^2`、`\\sqrt{25}=5`、`23 \\div 4 = 5 \\cdots 3`。
- 公式旁边有中文时，优先用 `write_text` 写中文，再用 `write_math` 写公式，不要把大段中文塞进 KaTeX。

#### 3.2.2 `write_math_steps` — 逐行写公式推导

```jsonc
{
  "type": "write_math_steps",
  "id": "steps_1",
  "steps": [
    "23 \\div 4 = 5 \\cdots 3",
    "5 \\text{ 辆坐满，还剩 } 3 \\text{ 人}",
    "5 + 1 = 6"
  ],
  "x": 100,
  "y": 300,
  "fontSize": 34,
  "lineGap": 58,
  "color": "#111111",
  "duration": 1200,
  "narration": "我们把推理过程分成三行。"
}
```

- `steps` 每个字符串是一行 LaTeX，播放器会按顺序逐行显示。
- `lineGap` 控制行距，默认约为 `fontSize × 1.65`。
- 多行推导会作为一个整体对象保存，后续可用 `erase_object` 删除，也可用 `annotate_object` 整体圈出。
- 如果某行需要少量中文，可用 `\\text{...}`；长句解释仍建议拆成普通 `write_text`。

#### 3.2.3 `write_division_layout` — 带余数除法竖式

```jsonc
{
  "type": "write_division_layout",
  "id": "division_1",
  "dividend": 23,
  "divisor": 4,
  "quotient": 5,
  "remainder": 3,
  "x": 100,
  "y": 260,
  "fontSize": 34,
  "color": "#111111",
  "duration": 1000,
  "narration": "用竖式看，四乘五等于二十，还剩三。"
}
```

- 用于小学带余数除法讲解，渲染结构类似"商在上、除数在左、被除数在右、乘积和余数在下"。
- 动画顺序为：结构和商出现 → 乘积出现 → 横线出现 → 余数出现。
- 该对象可被 `erase_object` 删除，也可用 `annotate_object` 整体批注；若要圈出余数等局部，使用 `annotate_math_bbox` 手动给出局部框。

#### 3.2.4 公式批注

整体批注一个公式、推导组或竖式：

```jsonc
{
  "type": "annotate_object",
  "id": "circle_formula",
  "targetId": "formula_1",
  "style": "circle",
  "padding": 8,
  "color": "#ef4444",
  "duration": 500,
  "narration": "这个公式是关键。"
}
```

手动批注公式局部区域：

```jsonc
{
  "type": "annotate_math_bbox",
  "id": "circle_remainder",
  "targetId": "division_1",
  "bbox": { "x": 176, "y": 392, "width": 36, "height": 34 },
  "style": "circle",
  "padding": 6,
  "color": "#ef4444",
  "duration": 500,
  "narration": "重点看这个余数三。"
}
```

- `style` 可选 `"circle"` 或 `"underline"`，默认 `"circle"`。
- `annotate_object` 使用目标对象保存的整体 bounding box。
- `annotate_math_bbox` 的 `bbox` 使用画布绝对坐标，适合圈出公式中的某个数、余数、分子、分母等局部。

### 3.3 `draw_line` — 画线

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
- 直线、坐标轴、辅助线用 `draw_line`；矩形、三角形、圆等标准图形应使用专门命令。

### 3.4 `draw_arrow` — 画箭头

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

### 3.5 `draw_path` — 任意路径涂鸦

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

### 3.5.1 基础图形命令 — 更有表现力地组织板书

当你要表达结构、分类、边界、集合、几何对象、步骤区域、循环关系、归纳关系时，应积极使用基础图形命令。不要只写一堆文字，也不要再用多条 `draw_line` 拼矩形或三角形。

#### `draw_rectangle` — 矩形/框

```jsonc
{
  "type": "draw_rectangle",
  "id": "condition_box",
  "x": 80,
  "y": 150,
  "width": 360,
  "height": 150,
  "radius": 8,
  "color": "#2563eb",
  "strokeWidth": 3,
  "fill": "#dbeafe",
  "fillOpacity": 0.18,
  "duration": 700,
  "narration": "我把题目条件框起来，先把信息分成一块。"
}
```

使用场景：
- 框出题目条件、已知信息、结论、易错提醒；
- 做流程图节点、概念卡片、分类容器；
- 用淡色 `fill` 给区域分组，但不要让填充色压过文字。

#### `draw_triangle` — 三角形

```jsonc
{
  "type": "draw_triangle",
  "id": "right_triangle",
  "points": [[160, 430], [480, 430], [160, 210]],
  "color": "#111111",
  "strokeWidth": 3,
  "fill": "#f8fafc",
  "fillOpacity": 0.35,
  "duration": 800,
  "narration": "这里画出一个直角三角形，方便说明三条边的关系。"
}
```

使用场景：
- 几何题、勾股定理、相似三角形、角度关系；
- 表示稳定结构、三要素模型、三角关系；
- 三个点按画笔顺序给出，最后会自动闭合。

#### `draw_circle` — 圆圈/集合圈

```jsonc
{
  "type": "draw_circle",
  "id": "set_a",
  "cx": 320,
  "cy": 280,
  "radius": 110,
  "color": "#16a34a",
  "strokeWidth": 3,
  "fill": "#dcfce7",
  "fillOpacity": 0.2,
  "duration": 700,
  "narration": "这个圆表示第一类对象。"
}
```

使用场景：
- 集合关系、分类圈、圆形流程节点；
- 几何圆、半径、直径、圆心讲解；
- 注意：强调小数字不要用 `draw_circle` 或 `annotate_circle`，改用 `emphasize_text`。

#### `draw_arc_arrow` — 弧形箭头

```jsonc
{
  "type": "draw_arc_arrow",
  "id": "cycle_arrow",
  "cx": 520,
  "cy": 300,
  "radius": 120,
  "startAngle": 210,
  "endAngle": 30,
  "clockwise": true,
  "color": "#7c3aed",
  "width": 4,
  "headSize": 18,
  "duration": 900,
  "narration": "这条弧形箭头表示过程会回到下一轮。"
}
```

角度规则：
- 角度单位是度，`0` 指向右，`90` 指向下，`180` 指向左，`270` 指向上。
- `clockwise: true` 表示顺时针从 `startAngle` 走到 `endAngle`；`false` 表示逆时针。

使用场景：
- 循环、轮次、反馈、旋转、角度变化；
- 从一个条件绕到另一个结论，避免直箭头穿过文字；
- 讲“下一轮、返回、复盘、迭代”时优先考虑弧形箭头。

#### `draw_brace` — 大括号

```jsonc
{
  "type": "draw_brace",
  "id": "group_steps",
  "from": [760, 180],
  "to": [760, 360],
  "orientation": "left",
  "depth": 34,
  "color": "#ef4444",
  "width": 3,
  "duration": 700,
  "narration": "这三行合在一起，是同一组推理。"
}
```

使用场景：
- 把多行步骤归为一组；
- 标出“这几项合起来”“这两类共同组成整体”；
- 解释分组、归纳、条件集合、公式中的一段结构。

方向规则：
- `orientation: "right"`：竖向大括号向右展开，像 `{`。
- `orientation: "left"`：竖向大括号向左展开，像 `}`。
- `orientation: "down"`：横向大括号向下展开，用于括住上方一段内容。
- `orientation: "up"`：横向大括号向上展开，用于括住下方一段内容。

### 3.6 擦除命令

擦除分三类：

- 想让某个已绘制元素彻底消失 → 用 `erase_object`。
- 想像橡皮擦一样擦掉画面的一小块 → 用 `erase_area`。
- 想整张白板重新开始 → 用 `clear_canvas`。

#### 3.6.1 `erase_object` — 删除已绘制对象

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

#### 3.6.2 `erase_area` — 局部擦除指定位置

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

#### 3.6.3 `clear_canvas` — 清空整张画布

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

### 3.7 批注图层命令 — 划重点（电子白板批注）

批注命令写在一个**独立的透明图层**上，始终叠加在所有主画布元素之上。
批注笔迹用于临时强调重点：下划线保留自然的电子笔迹感；圈画采用平滑闭合路径和基于 `id` 的稳定轻微形变，效果顺滑、柔和、清晰，不是机械标准椭圆。

批注图层的生命周期：
- 任何 `annotate_*` 命令，以及 `emphasize_text` 的 `underline` / `dot` 样式，都会向批注图层**累加**元素；
- `clear_annotations` 一次性清除整个批注图层；
- `clear_canvas` 同时清除主层和批注层。

使用场景：在主板书绘制完成后，用批注圈出关键公式、在重要文字下方画下划线，然后在讲解下一段前用 `clear_annotations` 清除，保持黑板整洁。

#### 3.7.1 `annotate_underline` — 手绘下划线

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

#### 3.7.2 `emphasize_text` — 精准文字强调

`emphasize_text` 用于强调已经写出的文字对象，尤其适合单个数字、1–4 个字的短词、变量、公式旁边的小标签。它不依赖 AI 估算圆心和半径，因此比圈画更适合小目标。

```jsonc
{
  "type": "emphasize_text",
  "id": "emphasize_n5",
  "targetId": "line_players",
  "segmentId": "n5",
  "style": "dot",
  "color": "#2563eb",
  "width": 2,
  "duration": 300,
  "narration": "这个五是本轮要特别关注的数字。"
}
```

字段说明：
- `targetId`：目标文字对象 id，可以是 `write_text` 或 `write_text_segments`。
- `segmentId`：可选。若目标是 `write_text_segments`，推荐指定要强调的片段 id。
- `style` 支持 `"bold"`、`"color"`、`"font_size"`、`"underline"`、`"dot"`。
- `color` 控制变色、下划线或着重号颜色，默认蓝色。
- `fontSize` 只在 `style: "font_size"` 时使用。
- `width` 只在 `style: "underline"` 或 `style: "dot"` 时使用，小数字建议 `1.5–2.5`。
- `padding` 可选，用于让下划线或着重号稍微远离文字边界。

小目标强调规则：
- 强调单个数字、单个变量、1–4 个字的短词时，优先使用 `bold`、`color`、`font_size`、`underline` 或 `dot`，不要默认用 `annotate_circle`。
- 一行中有多个小目标时，先用 `write_text_segments` 拆成片段，再逐个 `emphasize_text`。
- `dot` 会在目标文字下方生成排版式着重号；小数字通常比圈画更准。
- `underline` 适合强调短词或一小段文字；小目标线宽建议 `2` 左右。
- `font_size` 会改变目标文字字号；用于强调某个结果数字时很自然，但要预留后续文字移动后的空间。

#### 3.7.3 `annotate_circle` — 平滑圈画

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
- 不需要额外参数，也不要为了模拟"手抖"而随机改动 `cx/cy/rx/ry`。只需准确包裹目标区域，渲染层会自动生成高质量电子白板圈画效果。
- `annotate_circle` 适合圈出较大的区域、整行结论、整段公式、图形或答案框。对于单个数字、很短的词、密集数字列表，不要用圈画，改用 `emphasize_text`。

#### 3.7.4 `clear_annotations` — 清除批注图层

```jsonc
{
  "type": "clear_annotations",
  "duration": 400,
  "narration": "批注讲完了，我先把标记清掉，继续下一部分。"
}
```

`clear_annotations` 立即移除批注图层上的所有下划线、圈画、着重号等批注元素，然后暂停 `duration` 毫秒。主层的板书内容不受影响。注意：`emphasize_text` 的 `bold`、`color`、`font_size` 会直接改变文字对象本身，不属于可清除批注；`underline` 和 `dot` 属于批注图层，可被清除。

---

### 3.8 `wait` — 等待用户点击"下一步"

```jsonc
{
  "type": "wait",
  "id": "checkpoint-1",
  "message": "确认理解这一步后，点击"下一步"继续。",
  "narration": "这里先停一下，大家确认一下刚才这一步有没有理解。"
}
```

`wait` 会暂停脚本执行，直到用户点击播放器里的"下一步"。它适合放在关键概念、公式、推导转折、课堂提问之后。

使用建议：
- `narration` 写成老师提问或确认理解的语气；
- `message` 写成给用户看的简短按钮提示；
- `wait` 不需要 `duration`，它由用户主动触发继续；
- 不要过度使用，通常一段 1–3 分钟讲解里安排 1–3 个等待点即可。

### 3.9 `set_canvas` — 中途调整画布（可选）

可在 `commands` 中再次出现，运行时改变画布尺寸/背景。一般用不上 ——
统一在顶层 `canvas` 里设置即可。

```jsonc
{ "type": "set_canvas", "width": 1600, "height": 900, "background": "#fafafa" }
```

一般建议在顶层 `canvas` 中一次性设置画布。只有确实需要中途改变尺寸或背景时才使用。

## 3.10 旁白字段 `narration` 详解

- 强烈建议大部分绘制/擦除命令都带 `narration`。
- 旁白应是第一人称口语，像老师在讲课。
- 一句话讲一件事，推荐 8–40 个中文字符。
- 旁白会在命令开始时出现，并以打字机效果显示。
- 如果旁白很长，适当增大该命令的 `duration`，让画面不要过早停住等待语音。
- 如果启用了 Azure TTS，`narration` 会被朗读出来；播放器不会把白板动画强行拉伸到语音长度，而是让同一段旁白和同一条命令同时开始，并在进入下一条命令前等待二者都完成。

---

## 4. 完整示例

### 示例 A — 带余数除法

```json
{
  "canvas": { "width": 1200, "height": 800, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "过山车排队问题", "x": 80, "y": 80, "fontSize": 42, "color": "#111111", "duration": 500, "narration": "我们来看这道排队问题。" },
    { "type": "write_math", "id": "formula_1", "latex": "23 \\div 4 = 5 \\cdots 3", "x": 100, "y": 180, "fontSize": 40, "color": "#111111", "duration": 600, "narration": "二十三除以四，等于五余三。" },
    { "type": "write_division_layout", "id": "division_1", "dividend": 23, "divisor": 4, "quotient": 5, "remainder": 3, "x": 100, "y": 260, "fontSize": 34, "color": "#111111", "duration": 1000, "narration": "用竖式看，四乘五等于二十，还剩三。" },
    { "type": "annotate_object", "id": "circle_division", "targetId": "division_1", "style": "circle", "padding": 10, "color": "#ef4444", "width": 3, "duration": 500, "narration": "这个竖式就是本题的计算过程。" },
    { "type": "write_math_steps", "id": "steps_1", "steps": ["23 \\div 4 = 5 \\cdots 3", "5 \\text{ 辆坐满，还剩 } 3 \\text{ 人}", "5 + 1 = 6"], "x": 520, "y": 280, "fontSize": 34, "lineGap": 58, "color": "#111111", "duration": 1200, "narration": "我们把推理过程分成三行。" }
  ]
}
```

### 示例 B — 勾股定理

```json
{
  "canvas": { "width": 1200, "height": 800, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "勾股定理", "x": 80, "y": 80, "fontSize": 44, "color": "#111111", "duration": 500, "narration": "今天我们学习勾股定理。" },
    { "type": "write_math", "id": "pythagorean", "latex": "a^2 + b^2 = c^2", "x": 100, "y": 160, "fontSize": 46, "color": "#111111", "duration": 600, "narration": "直角三角形三边满足这个关系。" },
    { "type": "write_math_steps", "id": "example_steps", "steps": ["3^2 + 4^2 = c^2", "9 + 16 = c^2", "25 = c^2", "c = \\sqrt{25} = 5"], "x": 100, "y": 260, "fontSize": 36, "lineGap": 56, "color": "#111111", "duration": 1600, "narration": "我们用三和四做例子，一步一步算出斜边。" },
    { "type": "annotate_object", "id": "circle_answer", "targetId": "example_steps", "style": "circle", "padding": 10, "color": "#ef4444", "duration": 600, "narration": "最后得到斜边等于五。" }
  ]
}
```

### 示例 C — 箭头和局部擦除

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

### 示例 D — 用图形组织概念关系

```json
{
  "canvas": { "width": 1200, "height": 760, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "循环学习模型", "x": 80, "y": 80, "fontSize": 42, "color": "#111111", "duration": 600, "narration": "我们用一个结构图来看学习循环。" },
    { "type": "draw_rectangle", "id": "input_box", "x": 100, "y": 170, "width": 230, "height": 110, "radius": 10, "color": "#2563eb", "strokeWidth": 3, "fill": "#dbeafe", "fillOpacity": 0.18, "duration": 600, "narration": "第一步是输入新知识。" },
    { "type": "write_text", "id": "input_text", "text": "输入", "x": 180, "y": 235, "fontSize": 32, "color": "#111111", "duration": 300, "narration": "这里写输入。" },
    { "type": "draw_triangle", "id": "practice_tri", "points": [[520,165],[660,285],[380,285]], "color": "#16a34a", "strokeWidth": 3, "fill": "#dcfce7", "fillOpacity": 0.18, "duration": 700, "narration": "第二步是练习，三角形表示三个练习要素。" },
    { "type": "write_text", "id": "practice_text", "text": "练习", "x": 485, "y": 250, "fontSize": 32, "color": "#111111", "duration": 300, "narration": "练习把知识变成能力。" },
    { "type": "draw_circle", "id": "review_circle", "cx": 900, "cy": 225, "radius": 75, "color": "#f59e0b", "strokeWidth": 3, "fill": "#fef3c7", "fillOpacity": 0.24, "duration": 600, "narration": "第三步是复盘，它像一个集合圈。" },
    { "type": "write_text", "id": "review_text", "text": "复盘", "x": 867, "y": 238, "fontSize": 30, "color": "#111111", "duration": 300, "narration": "复盘帮助我们发现问题。" },
    { "type": "draw_arrow", "id": "arrow_1", "from": [330,225], "to": [380,225], "color": "#475569", "width": 3, "duration": 350, "narration": "输入之后进入练习。" },
    { "type": "draw_arrow", "id": "arrow_2", "from": [660,225], "to": [825,225], "color": "#475569", "width": 3, "duration": 500, "narration": "练习之后进入复盘。" },
    { "type": "draw_arc_arrow", "id": "loop_back", "cx": 520, "cy": 380, "radius": 390, "startAngle": 350, "endAngle": 190, "clockwise": true, "color": "#7c3aed", "width": 4, "headSize": 18, "duration": 900, "narration": "复盘后会带着新问题回到下一轮输入。" },
    { "type": "draw_brace", "id": "brace_group", "from": [100, 350], "to": [900, 350], "orientation": "down", "depth": 36, "color": "#ef4444", "width": 3, "duration": 600, "narration": "这三步合起来，才形成一个完整循环。" }
  ]
}
```

### 示例 E — 清空后重新开始

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

### 示例 F — 划重点批注 + 清除（带旁白）

```json
{
  "canvas": { "width": 1000, "height": 500, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "Newton's Second Law", "x": 80, "y": 90, "fontSize": 40, "color": "#111111", "duration": 1000, "narration": "今天我们来看牛顿第二定律。" },
    { "type": "write_text", "id": "formula", "text": "F = ma", "x": 360, "y": 260, "fontSize": 56, "color": "#111111", "duration": 900, "narration": "核心公式只有三个字母：F 等于 m 乘以 a。" },
    { "type": "write_text", "id": "note", "text": "其中 F 是合外力，m 是质量，a 是加速度", "x": 80, "y": 360, "fontSize": 22, "color": "#555555", "duration": 1400, "narration": "这三个量的物理含义要分清楚。" },
    { "type": "annotate_circle", "id": "circle-formula", "cx": 460, "cy": 240, "rx": 110, "ry": 42, "color": "#ef4444", "width": 4, "duration": 900, "narration": "我把这个核心公式圈出来，它是整个力学的基石。" },
    { "type": "wait", "id": "ask-understood", "message": "理解 F = ma 后，点击"下一步"继续。", "narration": "这里先停一下，大家确认一下 F 等于 m 乘以 a 有没有理解。" },
    { "type": "annotate_underline", "id": "hl-force", "x1": 87, "y1": 368, "x2": 210, "y2": 368, "color": "#f59e0b", "width": 4, "duration": 500, "narration": "合外力这个词要特别注意，是合力，不是某一个力。" },
    { "type": "annotate_underline", "id": "hl-accel", "x1": 370, "y1": 368, "x2": 510, "y2": 368, "color": "#22c55e", "width": 4, "duration": 500, "narration": "加速度 a 的方向始终与合外力方向一致。" },
    { "type": "clear_annotations", "duration": 400, "narration": "好，批注先清一下，我们继续推导。" }
  ]
}
```

### 示例 G — 精准强调小数字

```json
{
  "canvas": { "width": 1200, "height": 600, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "第4轮接球分析", "x": 80, "y": 80, "fontSize": 40, "color": "#111111", "duration": 600, "narration": "我们来看第四轮里每个人接到球的次数。" },
    {
      "type": "write_text_segments",
      "id": "players",
      "x": 100,
      "y": 180,
      "fontSize": 30,
      "color": "#111111",
      "segments": [
        { "id": "label", "text": "前14个接球人：" },
        { "id": "n2", "text": "2，" },
        { "id": "n3", "text": "3，" },
        { "id": "n4", "text": "4，" },
        { "id": "n5", "text": "5，" },
        { "id": "n6", "text": "6" }
      ],
      "duration": 900,
      "narration": "这一行数字比较密，后面要强调的小数字先拆成片段。"
    },
    { "type": "emphasize_text", "id": "mark_n5_color", "targetId": "players", "segmentId": "n5", "style": "color", "color": "#2563eb", "duration": 250, "narration": "这里的五先变成蓝色。" },
    { "type": "emphasize_text", "id": "mark_n5_dot", "targetId": "players", "segmentId": "n5", "style": "dot", "color": "#2563eb", "width": 2, "duration": 300, "narration": "再用着重号标出它，比圈画小数字更准确。" },
    { "type": "emphasize_text", "id": "mark_label_underline", "targetId": "players", "segmentId": "label", "style": "underline", "color": "#f59e0b", "width": 2, "duration": 300, "narration": "标签这类短语可以用细下划线强调。" }
  ]
}
```

### 示例 H — 擦除临时标注（带旁白）

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

图形选择建议：

- 有“范围、模块、容器、条件块、结论块”时，用 `draw_rectangle`，不要只靠文字换行。
- 有“几何三角形、三要素、三方关系”时，用 `draw_triangle`。
- 有“集合、分类、圆心半径、循环节点”时，用 `draw_circle`。
- 有“方向、因果、输入输出、映射”时，用 `draw_arrow`；有“循环、返回、下一轮、反馈”时，用 `draw_arc_arrow`。
- 有“几行内容属于同一组、几个条件合起来、公式局部结构”时，用 `draw_brace`。
- 有“小数字、短词强调”时，用 `emphasize_text`；有“整块内容强调”时，再用 `annotate_circle` 或 `annotate_object`。
- 只要图形能让关系更清楚，就主动使用图形。优秀白板不是文字堆叠，而是“文字 + 结构图 + 箭头 + 局部强调”的组合。

文字宽度粗略估算：

- 中文宽度约等于 `fontSize × 字数`。
- 英文/数字宽度约等于 `fontSize × 字符数 × 0.55`。

---

## 6. 错误与限制

前端会拒绝并提示以下情况：

- 整体不是合法 JSON 对象。
- 缺少 `canvas` 或 `commands`。
- 命令缺少必填字段。
- `type` 不在 `{set_canvas, write_text, write_text_segments, write_math, write_math_steps, write_division_layout, draw_line, draw_arrow, draw_path, draw_rectangle, draw_triangle, draw_circle, draw_arc_arrow, draw_brace, erase_object, erase_area, clear_canvas, annotate_underline, annotate_circle, annotate_object, annotate_math_bbox, emphasize_text, clear_annotations, wait}` 之内。
- 坐标不是 `[number, number]` 或数值字段类型错误。
- `draw_path.points` 少于 2 个点。
- `erase_object` 没有 `targetId` 或 `targetIds`。
- `erase_area` 的矩形缺少 `width` / `height`，或圆形缺少 `radius`。
- `duration` 不是数字。

**不支持** 的特性，请不要尝试生成：
- 任意未定义图形命令，例如 `draw_rect`（矩形请用 `draw_rectangle`）
- 图片、任意 SVG path、贝塞尔曲线
- 任意移动已绘制元素（仅支持通过 `emphasize_text` 改变文字强调样式）
- 延时命令、并行播放、循环
- 字体族选择（默认中文回退到 PingFang SC / Microsoft YaHei）
- 多人协作、保存/加载
- 单独删除某一条批注（只能用 `clear_annotations` 清除整个批注图层）

矩形/框 → 用 `draw_rectangle`；三角形 → 用 `draw_triangle`；圆/集合圈 → 用 `draw_circle`；直线/坐标轴/辅助线 → 用 `draw_line`；自由曲线/涂鸦 → 用 `draw_path`；规范数学公式 → 用 `write_math` 或 `write_math_steps`；带余数除法竖式 → 用 `write_division_layout`；直线方向关系 → 用 `draw_arrow`；循环/返回/轮次关系 → 用 `draw_arc_arrow`；分组归纳 → 用 `draw_brace`；擦除 → 按场景用 `erase_object`、`erase_area` 或 `clear_canvas`；小数字/短词精准强调 → 用 `write_text_segments` + `emphasize_text`；大范围划重点/批注 → 用 `annotate_underline`、`annotate_circle`、`annotate_object` 或 `annotate_math_bbox`，讲完后用 `clear_annotations` 清除；需要课堂停顿 → 用 `wait`。

---

## 7. 输出自检清单

发送前自检：

- [ ] 输出是**单一 JSON 对象**，没有任何前后缀文字、Markdown、代码围栏
- [ ] 顶层有 `canvas` 与 `commands`
- [ ] `canvas.width` 和 `canvas.height` 都是数字
- [ ] `commands` 是数组，且每个元素 `type` 属于 `{write_text, write_text_segments, write_math, write_math_steps, write_division_layout, draw_line, draw_arrow, draw_path, draw_rectangle, draw_triangle, draw_circle, draw_arc_arrow, draw_brace, erase_object, erase_area, clear_canvas, annotate_underline, annotate_circle, annotate_object, annotate_math_bbox, emphasize_text, clear_annotations, wait, set_canvas}`
- [ ] 每个绘制/批注对象都有合法 `id`；动画命令有合理 `duration`
- [ ] 所有坐标都在 `0..canvas.width` × `0..canvas.height` 范围内
- [ ] `draw_arrow.from` 是箭尾，`draw_arrow.to` 是箭头尖端，方向没有写反
- [ ] 结构化内容已优先使用 `draw_rectangle`、`draw_triangle`、`draw_circle`、`draw_arc_arrow`、`draw_brace` 等图形，而不是堆文字或手工拼线
- [ ] `draw_arc_arrow` 的角度按 `0=右, 90=下, 180=左, 270=上` 理解，`clockwise` 没有写反
- [ ] `draw_path.points` 至少包含两个合法坐标点，且顺序符合笔迹移动方向
- [ ] `erase_object` 引用的是之前确实创建过的元素 id
- [ ] `erase_area` 的区域大小合适，不会误擦掉旁边的重要内容
- [ ] `annotate_underline` 的 `x1/y1/x2/y2` 坐标准确定位在目标文字下方，不与其他元素重叠
- [ ] 小数字、单个变量、短词已优先使用 `write_text_segments` + `emphasize_text`，没有用大圈硬套小目标
- [ ] `annotate_circle` 只用于较大区域、整行文字、整段公式或图形；若必须圈小目标，线宽已降到 `1.5–2.5` 且坐标经过仔细估算
- [ ] 复杂公式没有用普通文字硬拼；分数、根号、平方、推导步骤优先使用数学公式命令
- [ ] 公式局部批注的 `bbox` 使用画布绝对坐标，且确实覆盖目标局部
- [ ] 批注图层不会遮挡后续需要可见的主层内容；如需清除，已安排 `clear_annotations`
- [ ] 关键概念后如需互动停顿，已安排 `wait`，且 `message` 简短明确
- [ ] 文字按估算宽度不会溢出画布
- [ ] 色值是 6 位 hex（`#rrggbb`）或合法 CSS 颜色
- [ ] **大部分**绘制/擦除命令带有自然口语的 `narration` 字段，串起来读得通顺像一段讲解

通过以上各项 → 输出。
