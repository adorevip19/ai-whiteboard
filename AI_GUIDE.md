# AI 调用指南 · AI Whiteboard

> 本文档专为 AI（LLM）阅读。读完后，你应当能够仅凭用户的口头需求，产出符合规范的 JSON 命令脚本，粘贴进白板的"JSON 命令脚本"输入框、点击"运行脚本"即可看到逐步动画 + 旁白讲解。

**近期更新**：新增 Azure TTS 旁白朗读、播放器速度调节和播放器暂停/继续功能。AI 生成新脚本时不要再插入 `wait` 等待点；学生需要思考时可以随时手动暂停。TTS 播放采用"段落首尾同步"：每条命令和它的旁白同时开始，白板按自己的动画速度绘制；如果白板先结束，会等当前旁白播完再进入下一条命令。`annotate_circle` 圈画重点已优化为稳定、顺滑、清晰的电子白板批注效果。新增 `write_math`、`write_math_steps`、`write_division_layout`，用于清晰渲染分数、根号、平方、推导步骤和带余数除法竖式。数学推导预检会检查空等号和不完整推导，公式不能写成 `M - 2 =` 或 `M = 30 + 2 =` 这种半截板书，必须把结果补完整。新增 `write_text_segments` 与 `emphasize_text`，用于精准强调单个数字、短词或一行文字中的局部内容。新增 `draw_rectangle`、`draw_triangle`、`draw_circle`、`draw_arc_arrow`、`draw_brace`，用于更积极地绘制结构化图示。新增 `move_object`，可让已绘制对象实时平移动画；新增 `draw_coordinate_system`、`draw_function`、`plot_point`、`draw_coordinate_segment`，用于初中函数图像、坐标几何和数形结合讲解。新增几何专用命令 `draw_point`、`draw_segment`、`draw_ray`、`draw_angle`、`mark_equal_segments`、`mark_parallel`、`mark_perpendicular`、`highlight_polygon`，用于稳定讲解几何证明、辅助线、角标、等长、平行、垂直和全等区域。新增 `construct_geometry`，以 JSXGraph 辅助的几何构造层计算垂足、交点、外接圆并自动展开成白板绘图命令。新增 `laser_pointer`，用于每一步讲解时像老师上课一样临时指示当前关注位置。

**AI 生成器更新**：应用主页现在支持让用户直接输入讲课需求，也支持上传题目图片。图片会先由后端视觉模型识别为题干、选项、图中文字和关键图形关系，再交给脚本生成器。后端调用 Perplexity Agent API，并通过 `openai/gpt-5.2` 生成白板脚本。生成后会先经过本地预检，再把预检报告交给 AI 自动修复，最多循环数轮，直到脚本可播放或只剩低风险建议。你作为脚本生成模型时，必须把输出控制为可解析 JSON，不要输出 Markdown 代码围栏；修复脚本时要优先解决预检报告里的错误、布局风险、激光笔缺失和小目标强调不准等问题。

**多页白板更新**：新增 `pages` 与 `switch_page`。不要把所有内容硬塞进一张白板。一页只讲一个小问题，讲完后切到下一页；需要回顾时可以切回旧页。多页模式优先用于完整题目讲解、步骤较多的推导、需要读题/找规律/计算/总结分开呈现的内容。

---

## 1. 工具定位

你是一个**白板讲师**。用户给你一个主题，例如"讲一下勾股定理""画一个流程图""解释一个概念"，你的工作方式是：生成白板播放脚本，用实时绘制命令逐步构建板书内容，并配合旁白、激光笔、圈画、下划线完成讲解。

前端会按 `commands` 数组顺序逐条播放命令，同时在画布下方的字幕条里显示 `narration`，营造"老师边讲边画"的体验。
如果页面开启 Azure TTS，播放器会把每条命令的 `narration` 合成为语音。每条命令和对应旁白同时开始，下一条命令会等当前命令动画与当前旁白都结束后再开始，避免画面和讲解错位。

重要：每一段 `narration` 都必须有对应的视觉指向。生成脚本时，凡是某条命令带有 `narration`，就要在该命令前后紧邻安排一个 `laser_pointer`，短暂指示这段旁白正在讲的文字、公式、图形、坐标点、推导行或答案区域。激光笔是临时效果，不会永久留在板书上；它的作用是让学生一听到旁白，就知道老师正在指哪里。

### 1.1 AI 生成、预检、修复闭环

当应用要求你生成或修复脚本时，你处在一个自动闭环中：

1. 用户输入自然语言讲课需求。
2. 你生成完整白板 JSON 脚本。
3. 应用进行本地预检，检查 JSON、schema、坐标、引用、激光笔、布局风险和教学表达问题。
4. 如果预检不通过，应用会把预检报告和当前脚本再次发给你。
5. 你必须根据报告修复完整脚本，而不是只解释问题。
6. 修复后应用会再次预检，直到可以播放或达到最大修复轮数。

因此你的输出必须稳定、可执行、便于机器解析：

- 只输出 JSON 对象。
- 顶层格式使用 `{ "explanation": "...", "script": { "canvas": {...}, "commands": [...] } }`。
- `explanation` 用中文简要说明讲解设计。
- `script` 必须是播放器可直接运行的白板脚本。
- 不要输出 Markdown 代码围栏。
- 不要输出注释。
- 不要把真实 API Key、隐私信息、部署说明写进脚本。
- 修复时保持原教学意图，优先解决预检报告中的 `error` 和 `warning`。

### 1.2 图片题识别输入

用户可能上传拍照、截图或扫描得到的题目图片。图片题不一定是几何题，也可能是纯文字题、选择题、函数图像题、物理实验题、统计图表题或“文字 + 图片说明”的综合题。

图片识别阶段的目标是把图片转成后续可讲解的题目文本：

- 尽量完整提取题干、选项、图中文字、坐标、角标、单位、表格内容、图例和已知条件。
- 对图形题要用自然语言补充图中关系，例如“点 D 在圆上”“AB 与 CD 相交于 E”“图像经过 (0,1) 和 (2,5)”。
- 不要在 OCR 阶段直接解题，也不要编造看不清的内容。看不清时标为 `[看不清]`。
- 脚本生成阶段看到“从题目图片中识别出的内容”时，应先把题目重述清楚，再分阶段讲解。
- 对几何图片题，若只识别到主点和几何关系，优先用 `construct_geometry` 重构图形，不要手算垂足、交点、外接圆等坐标。
- 对物理、化学、生物、地理等带图题，不能只讲 OCR 出来的文字。必须把图示部分提取成可讲解内容，并在白板上重构关键结构，例如实验装置、受力/运动方向、光路、电路、液面高度、滑轮/杠杆、统计图表等。
- 生成讲解脚本时，开头必须先“读题”：展示题目文字并用旁白读出题干。读题后必须“分析题干”：拆出已知条件、图中信息、要求什么、需要用哪个概念或规律。
- 如果暂时无法贴原图，优先用白板结构化命令重构图示；重构图示不要求像素级还原，但必须保留解题所需的对象、标签、方向、数值和关系。

---

## 2. 顶层 Schema

```jsonc
{
  "canvas": {
    "width": 1200,
    "height": 800,
    "background": "#ffffff"
  },
  "pages": [
    { "id": "intro", "title": "读题" },
    { "id": "reasoning", "title": "找规律" },
    { "id": "answer", "title": "总结" }
  ],
  "commands": []
}
```

- 坐标原点 `(0,0)` 在左上角，x 向右，y 向下，单位为像素。
- 画布会自动缩放以适配屏幕，但内部坐标始终按 `canvas.width × canvas.height` 计算。
- 推荐默认尺寸：`1200 × 800`。
- 横向流程图可用 `1600 × 700`，长文列表可用 `1000 × 1400`。
- `pages` 可选。没有 `pages` 时兼容旧脚本，默认只有一页。
- 完整讲题建议使用 `pages`：第一页读题，第二页分析，第三页计算，第四页总结。

---

## 3. 命令类型

### 3.0 `switch_page` — 切换白板页

```jsonc
{
  "type": "switch_page",
  "id": "to_reasoning",
  "pageId": "reasoning",
  "title": "第二页：找规律",
  "duration": 500,
  "narration": "题目读懂了，我们翻到第二页，专门找循环规律。"
}
```

- `pageId` 必须引用顶层 `pages` 中的某一页；如果没有定义 `pages`，也可以临时创建该页，但推荐显式写 `pages`。
- 切换页时，当前页的板书会被保存；以后再 `switch_page` 回来，可以看到这页之前写过的内容。
- 新页默认是空白白板，适合继续讲下一个小问题。
- `switch_page` 适合放在讲解阶段之间：读题 → 分析 → 计算 → 总结。
- 不要在一页里堆太多对象。普通 `1200×800` 白板一页建议只放 `6–12` 个主要对象；超过 `14` 个主要对象时，通常应该换页。
- 一页只讲一个小问题：例如“读题抓关键词”是一页，“找周期”是一页，“用余数定位答案”是一页。
- 需要回顾时，可以切回旧页，例如回到 `intro` 页重新看题目关键词。

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

#### 3.2.3 数学推导完整性规则

数学讲解必须让学生在板书上看到完整逻辑链，不能只在旁白或答案框里补脑内步骤。

- 任何公式行都不能以等号结尾。禁止写 `M - 2 =`、`M = 30 + 2 =`、`44 \\div 6 =` 这种空等号。
- 如果最终答案是 `32`，推导链也必须显式算到 `32`。例如先写 `M - 2 = 30`，再写 `M = 30 + 2 = 32`。
- 每一次等式变形都要左右相等，不能为了省空间省掉关键右侧结果。
- 文字题推荐顺序：题意关系 → 列式 → 代入/计算 → 最终答案。每一步都要在白板上留下清楚痕迹。
- 如果某一步需要学生思考，用旁白提示“可以先暂停想一想”，但不要生成 `wait`；思考结束后仍要把完整等式补出来。
- 预检或优化时，如果发现公式以等号结尾、推导只写到一半、答案只出现在答案框里，应优先修复这些逻辑问题。

#### 3.2.4 `write_division_layout` — 带余数除法竖式

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

#### 3.2.5 公式批注

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

当你要表达结构、分类、边界、集合、几何对象、步骤区域、循环关系、归纳关系时，可以使用基础图形命令。不要只写一堆文字，也不要再用多条 `draw_line` 拼矩形或三角形。

但图形必须服务于讲解，不要为了"看起来丰富"而堆图形。白板空间有限，能直接写清楚的内容就直接写字；只有当框、圈、箭头、括号确实能表达结构、分组、流程、范围或几何关系时才画。

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

谨慎使用：
- 不要给每一行文字都画矩形框。矩形框只用于真正需要"容器、分区、结论卡、题目区域、流程节点"的地方。
- 如果只是想让一行文字更醒目，优先使用更大字号、加粗、颜色、下划线或着重号，而不是外面套框。
- 一张 `1200×800` 的普通讲解白板，通常 `0–2` 个矩形框就够了；超过 `3` 个时要重新判断是否必要。
- 预检或优化脚本时，如果发现多个无意义矩形框只是包住普通文字，应直接删除这些框，保留文字本身。

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
- 大括号会用规整的排版字形渲染，适合正式教学板书；不要用多条线或自由路径手工拼大括号。
- `depth` 控制大括号占用的侧向空间。普通三行文字建议 `28–40`，太大会挤压文字，太小会显得局促。

方向规则：
- `orientation: "right"`：竖向大括号向右展开，像 `{`。
- `orientation: "left"`：竖向大括号向左展开，像 `}`。
- `orientation: "down"`：横向大括号向下展开，用于括住上方一段内容。
- `orientation: "up"`：横向大括号向上展开，用于括住下方一段内容。

### 3.5.2 `move_object` — 移动已绘制对象，制造演示动画

当讲解需要表现“点移动、图形平移、对象归位、把条件移到结论旁边、拖动一块内容进行比较”时，使用 `move_object`。它会对已有对象做实时平移动画，不会破坏对象本身。

相对移动：

```jsonc
{
  "type": "move_object",
  "id": "move_point_right",
  "targetId": "point_a",
  "by": { "dx": 180, "dy": 0 },
  "duration": 800,
  "easing": "easeInOut",
  "narration": "我们把这个点向右移动，观察横坐标如何变化。"
}
```

移动到指定位置：

```jsonc
{
  "type": "move_object",
  "id": "move_box_to_answer",
  "targetId": "condition_box",
  "to": { "x": 760, "y": 160 },
  "anchor": "top_left",
  "duration": 900,
  "easing": "easeOut",
  "narration": "现在把已知条件移到结论旁边，方便对照。"
}
```

字段说明：
- `targetId`：要移动的已绘制对象 id。
- `by`：相对移动，`dx` 向右为正，`dy` 向下为正。适合“向右平移 3 格”“整体下移一点”。
- `to`：移动到画布绝对坐标。默认让目标对象的左上角移动到 `(x,y)`。
- `anchor`：`"top_left"` 或 `"center"`。若要把一个点、圆、图标的中心放到指定位置，用 `"center"`。
- `easing`：`"linear"`、`"easeInOut"`、`"easeOut"`，默认 `"easeInOut"`。
- 若移动的是 `draw_coordinate_system` 坐标系，依附于该坐标系的函数图像、坐标点和坐标线段会一起移动。

使用场景：
- 数轴上点的移动：加减法、相反数、距离；
- 几何图形平移：说明平移前后形状和大小不变；
- 函数图像讲解：把坐标系整体挪到旁边，给推导文字腾空间；
- 物理运动演示：物体从 A 点移动到 B 点；
- 比较关系：把两个对象移动到同一水平线或同一位置附近进行对照。

注意：
- `move_object` 只做平移，不旋转、不缩放。
- 不要用它替代正常绘制顺序；只有“移动过程本身有教学意义”时才使用。
- 移动后再使用 `annotate_object`，批注会按移动后的对象位置计算。

### 3.5.3 坐标系与函数图像命令 — 初中数学重点能力

讲一次函数、二次函数、反比例函数、坐标几何、数形结合时，优先使用坐标系命令，而不是手工用多条线拼坐标轴。

#### `draw_coordinate_system` — 绘制坐标系

```jsonc
{
  "type": "draw_coordinate_system",
  "id": "coord_1",
  "x": 120,
  "y": 130,
  "width": 620,
  "height": 420,
  "xMin": -6,
  "xMax": 6,
  "yMin": -4,
  "yMax": 8,
  "grid": true,
  "xTickStep": 1,
  "yTickStep": 1,
  "showLabels": true,
  "axisColor": "#111111",
  "gridColor": "#e5e7eb",
  "fontSize": 14,
  "duration": 700,
  "narration": "先建立一个坐标系，横轴和纵轴的范围都确定好。"
}
```

- `x/y/width/height` 是画布坐标，决定坐标系在白板上的位置和大小。
- `xMin/xMax/yMin/yMax` 是数学坐标范围。
- `xTickStep/yTickStep` 可选；不写时播放器自动选择合适刻度。
- `grid: true` 适合函数图像讲解；如果画面太密，可以设为 `false`。

#### `draw_function` — 在坐标系中画函数图像

```jsonc
{
  "type": "draw_function",
  "id": "line_y_2x_1",
  "coordinateSystemId": "coord_1",
  "expression": "2*x + 1",
  "color": "#2563eb",
  "width": 4,
  "duration": 900,
  "narration": "接着画出一次函数 y 等于二 x 加一。"
}
```

表达式规则：
- 自变量必须写成 `x`。
- 乘法必须显式写 `*`，例如 `2*x + 1`，不要写 `2x + 1`。
- 幂运算用 `^`，例如 `x^2 - 2*x + 1`。
- 支持括号和常见函数：`sqrt(x)`、`abs(x)`、`sin(x)`、`cos(x)`、`tan(x)`、`ln(x)`、`log(x)`、`exp(x)`。
- 常数支持 `pi` 和 `e`。
- 常见初中表达：`2*x + 1`、`-0.5*x + 3`、`x^2 - 4`、`1/x`。
- 不要把任意 JavaScript 写进 `expression`，这里只是数学表达式。

#### `plot_point` — 标出坐标点

```jsonc
{
  "type": "plot_point",
  "id": "point_intercept",
  "coordinateSystemId": "coord_1",
  "x": 0,
  "y": 1,
  "label": "(0,1)",
  "color": "#ef4444",
  "radius": 5,
  "duration": 400,
  "narration": "这个点是函数图像和 y 轴的交点。"
}
```

- `x/y` 是数学坐标，不是画布像素坐标。
- `label` 可选，适合标交点、顶点、截距、特殊点。

#### `draw_coordinate_segment` — 在坐标系中画线段/辅助线

```jsonc
{
  "type": "draw_coordinate_segment",
  "id": "slope_run",
  "coordinateSystemId": "coord_1",
  "from": [0, 1],
  "to": [2, 1],
  "color": "#f59e0b",
  "width": 3,
  "duration": 500,
  "narration": "横向走两格，这是斜率里的分母。"
}
```

- `from/to` 都是数学坐标。
- 用于画斜率三角形、投影线、两点连线、辅助线。

函数图像使用建议：
- 讲一次函数：先画坐标系，再画函数图像，接着标出截距和一两个点，最后用 `draw_coordinate_segment` 表示“横向变化/纵向变化”。
- 讲二次函数：画 `x^2` 或 `a*x^2 + b*x + c`，用 `plot_point` 标顶点、交点，再用 `annotate_object` 或 `emphasize_text` 强调关键结论。
- 讲反比例函数：用 `1/x` 这类表达式，坐标范围不要包含过密刻度；必要时分左右两支分别设置 `xMin/xMax`。
- 讲坐标几何：用 `plot_point` 标点，用 `draw_coordinate_segment` 连线，比手工估算像素位置更准确。
- 当图像需要移动演示时，可以对整个坐标系使用 `move_object`，函数、点和坐标线段会跟着一起移动。
- 如果要强调坐标系里的某个数学点，先用 `plot_point` 和 `draw_coordinate_segment` 准确标出数学坐标；不要只用画布像素坐标的箭头或圈画去“猜”它的位置。
- `draw_arc_arrow` 使用的是画布像素坐标，不是数学坐标。若箭头要指向坐标系里的点，必须先换算到画布坐标，或让箭头只承担“从已标出的点指向结论”的辅助说明，避免箭头落在错误刻度附近。

### 3.5.4 几何专用命令 — 几何证明、辅助线与条件标记

讲初中几何证明时，优先使用几何专用命令，而不是用普通线段、圈画、箭头去“猜”点位。几何图形必须稳定、准确、可复用：先画点和线段，再加辅助线、角标、等长/平行/垂直标记，最后高亮参与证明的三角形或四边形。

几何讲解推荐分页：

- 第 1 页：读题 + 画基础图形；
- 第 2 页：标已知条件，例如等长、平行、垂直、角相等；
- 第 3 页：添加辅助线；
- 第 4 页：证明步骤，一步只强调一个逻辑关系；
- 第 5 页：总结证明链。

#### `draw_point` — 画几何点和点名

```jsonc
{
  "type": "draw_point",
  "id": "pt_A",
  "x": 360,
  "y": 160,
  "label": "A",
  "labelPosition": "top",
  "color": "#111111",
  "radius": 4,
  "fontSize": 20,
  "duration": 250,
  "narration": "先标出顶点 A。"
}
```

- 用于几何图形中的 A、B、C、D 等点。
- `x/y` 是画布坐标。
- `labelPosition` 可选 `top/right/bottom/left`，要避开线段和角标。
- 点名不要压在线上，标签和图形至少留 `8–12px` 空隙。

#### `draw_segment` — 画几何线段

```jsonc
{
  "type": "draw_segment",
  "id": "seg_AB",
  "from": [360, 160],
  "to": [210, 430],
  "label": "AB",
  "color": "#111111",
  "width": 3,
  "duration": 600,
  "narration": "连接 A 和 B，得到线段 AB。"
}
```

- 用于三角形边、辅助线、连接线。
- `from/to` 是线段端点。
- 若只是几何图形的边，优先用 `draw_segment`，不要用 `draw_line`。
- `label` 可选；边名通常不用每条都写，避免画面拥挤。

#### `draw_ray` — 画射线

```jsonc
{
  "type": "draw_ray",
  "id": "ray_BA",
  "from": [210, 430],
  "through": [360, 160],
  "length": 360,
  "color": "#64748b",
  "width": 2,
  "duration": 500,
  "narration": "从 B 出发经过 A 画一条射线。"
}
```

- `from` 是射线端点，`through` 是射线经过的方向点。
- `length` 可选；不写时自动延长一段。
- 用于角的边、延长线、外角证明。

#### `draw_angle` — 画角弧和角名

```jsonc
{
  "type": "draw_angle",
  "id": "angle_BAD",
  "vertex": [360, 160],
  "from": [210, 430],
  "to": [510, 430],
  "radius": 42,
  "label": "∠A",
  "color": "#2563eb",
  "width": 3,
  "duration": 500,
  "narration": "这个角就是顶角 A。"
}
```

- `vertex` 是角的顶点。
- `from/to` 是角两条边上的点，不是角弧端点。
- `radius` 控制角弧大小；角弧不要盖住点名。
- 讲角平分线、相等角、内错角、同位角时用它。

#### `mark_equal_segments` — 标等长线段

```jsonc
{
  "type": "mark_equal_segments",
  "id": "mark_AB_AC",
  "segments": [
    { "from": [360, 160], "to": [210, 430] },
    { "from": [360, 160], "to": [510, 430] }
  ],
  "tickCount": 1,
  "color": "#ef4444",
  "width": 2,
  "duration": 450,
  "narration": "这两个小刻痕表示 AB 和 AC 相等。"
}
```

- 用于表示 `AB = AC`、`BD = DC` 等等长条件。
- 同一组相等线段使用相同 `tickCount`。
- 第二组不同的等长关系可用 `tickCount: 2`。
- 等长标记比圈画精准，几何题中不要用圈画代替等长标记。

#### `mark_parallel` — 标平行线

```jsonc
{
  "type": "mark_parallel",
  "id": "mark_AB_CD",
  "segments": [
    { "from": [180, 260], "to": [420, 260] },
    { "from": [220, 430], "to": [520, 430] }
  ],
  "markCount": 1,
  "color": "#7c3aed",
  "width": 2,
  "duration": 450,
  "narration": "这两个斜短线表示 AB 平行于 CD。"
}
```

- 用于 `AB ∥ CD`、梯形、平行四边形、内错角/同位角证明。
- 同一组平行线使用相同 `markCount`。
- 不要只写文字“AB ∥ CD”而不在图上标出来；图文要对应。

#### `mark_perpendicular` — 标垂直直角

```jsonc
{
  "type": "mark_perpendicular",
  "id": "right_D",
  "vertex": [360, 430],
  "point1": [360, 160],
  "point2": [210, 430],
  "size": 20,
  "color": "#2563eb",
  "width": 2,
  "duration": 400,
  "narration": "这个小方角表示 AD 垂直 BC。"
}
```

- `vertex` 是直角顶点。
- `point1/point2` 分别在两条垂直线的方向上。
- 作高、作垂线、证明直角三角形时必须使用。

#### `highlight_polygon` — 高亮几何区域

```jsonc
{
  "type": "highlight_polygon",
  "id": "highlight_ABD",
  "points": [[360, 160], [210, 430], [360, 430]],
  "fill": "#bfdbfe",
  "fillOpacity": 0.28,
  "color": "#2563eb",
  "strokeWidth": 2,
  "duration": 500,
  "narration": "先看左边这个三角形 ABD。"
}
```

- 用于高亮参与证明的三角形、四边形、相似图形、全等图形。
- 高亮要淡，不要盖住点名、线段和标记。
- 证明全等时，可以先高亮一个三角形，再高亮另一个三角形，让学生看到比较对象。

几何证明生成策略：

- 先用 `draw_point` 明确点，再用 `draw_segment` 连接边。
- 已知条件必须落在图上：等长用 `mark_equal_segments`，平行用 `mark_parallel`，垂直用 `mark_perpendicular`，角关系用 `draw_angle`。
- 添加辅助线时，用醒目的颜色画 `draw_segment`，旁白说明“为什么要作这条线”。
- 证明全等、相似、面积关系时，用 `highlight_polygon` 高亮当前比较区域。
- 激光笔要沿着线段或角弧移动：讲 `AB = AC` 时，激光笔先扫 AB，再扫 AC。
- 右侧证明文字要和左侧图形同步，不要一次性写完整证明。
- 不要用 `annotate_circle` 圈住小角、小点或短线段；几何条件应使用专用标记。

#### `construct_geometry` — JSXGraph 辅助几何构造层

当题图来自图片识别，或者你只知道“从 A 作 BC 的垂线、CF 与 AE 交于 H、A/B/C 三点确定外接圆”这类几何关系时，优先使用 `construct_geometry`。它不是直接渲染 JSXGraph 画板，而是用几何构造层先计算垂足、交点、外接圆等点位，再自动展开成白板现有命令。

```jsonc
{
  "type": "construct_geometry",
  "id": "geo_rebuild",
  "points": [
    { "id": "A", "x": 735, "y": 162, "label": "A", "labelPosition": "top" },
    { "id": "B", "x": 552, "y": 520, "label": "B", "labelPosition": "bottom" },
    { "id": "C", "x": 1036, "y": 520, "label": "C", "labelPosition": "bottom" }
  ],
  "constructions": [
    { "kind": "circumcircle", "id": "circle_ABC", "through": ["A", "B", "C"] },
    { "kind": "segment", "id": "AB", "from": "A", "to": "B" },
    { "kind": "segment", "id": "AC", "from": "A", "to": "C" },
    { "kind": "segment", "id": "BC", "from": "B", "to": "C" },
    {
      "kind": "perpendicular_projection",
      "id": "AE",
      "point": "A",
      "line": ["B", "C"],
      "footId": "E",
      "footLabel": "E",
      "footLabelPosition": "bottom",
      "drawSegment": true,
      "markRightAngle": true
    },
    {
      "kind": "intersection",
      "id": "H",
      "lines": [["A", "E"], ["C", "F"]],
      "label": "H"
    }
  ],
  "duration": 360,
  "narration": "构造层先计算垂足、交点和外接圆，再把结果画到白板上。"
}
```

支持的 `constructions.kind`：

- `circumcircle`：三点确定外接圆，字段 `through: ["A","B","C"]`。
- `segment`：连接两个已知点或已构造点，字段 `from/to`；可设 `dashed: true` 自动生成虚线。
- `perpendicular_projection`：从点向一条直线作垂线并得到垂足，字段 `point`、`line`、`footId`；可用 `footLabel` 和 `footLabelPosition` 控制垂足标签，避免标签被边线或辅助线压住。
- `intersection`：求两条直线交点，字段 `lines: [[p1,p2],[p3,p4]]`。
- `highlight_polygon`：按点 id 高亮多边形区域。

使用规则：

- 图片识别后的几何重构，优先用 `construct_geometry`，不要让模型手算垂足坐标和交点坐标。
- `points` 中只写图片中能可靠识别的大点位，例如 A/B/C/D/O；E/F/H 这类垂足和交点应交给构造层生成。
- 圆上点必须真的落在圆周附近；如果要标弧中点或下方点，不要随手把点放到圆内。必要时先让构造层画外接圆，再根据圆心和半径检查点位。
- 辅助线不要彼此完全重合。若虚线半径、连线和实线垂线视觉上很接近，应调整基础点位、降低虚线宽度/颜色，或改变绘制顺序，让学生能分辨每条线的意义。
- 垂足标签要主动避让线段。`E` 落在水平底边上常用 `footLabelPosition: "bottom"`；`F` 落在斜边上常用 `"left"` 或 `"top"`。
- `constructions` 必须按依赖顺序排列：先构造 E/F，再用 E/F 求 H；先有点，再连线或高亮。
- 如果需要教学动画更细，可以把 `construct_geometry` 用于第一版重构，再在后续命令中单独用 `laser_pointer`、`highlight_polygon`、`mark_equal_segments` 讲解。
- 如果构造失败，通常是点位近似共线、线条平行或依赖点还没生成；应修正点位或调整构造顺序。

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

#### 3.6.4 `laser_pointer` — 临时激光笔指示

`laser_pointer` 用于像老师上课拿激光笔一样，短暂指示当前要看的位置。它可以固定在一个点，也可以沿路径顺滑移动。优先使用移动式激光笔，让红点像真实鼠标/激光笔一样自然滑到目标位置；播放结束后自动消失，不会永久留在板书上。

```jsonc
{
  "type": "laser_pointer",
  "id": "laser-key-formula",
  "x": 160,
  "y": 180,
  "to": { "x": 360, "y": 180 },
  "style": "pulse",
  "color": "#ef4444",
  "radius": 10,
  "trail": true,
  "duration": 1000,
  "narration": "激光笔沿着这一行滑过去，注意看这个关键公式。"
}
```

字段说明：
- `x/y`：画布坐标，表示激光笔起点；如果没有 `to` 或 `path`，它就是固定指示点。
- `to`：可选，移动终点。适合从一个位置顺滑滑到另一个位置。
- `path`：可选，多点路径，例如 `"path": [[160,180],[240,176],[360,180]]`。适合沿公式、图形边缘、推导步骤或坐标辅助线移动。
- `style`：可选，支持 `"dot"`、`"pulse"`、`"ring"`、`"spotlight"`，默认 `"pulse"`。
- `color`：默认红色 `"#ef4444"`。
- `radius`：红点半径，默认 `10`。文字、数字旁边建议 `7–10`；图形或答案框附近建议 `10–14`。
- `trail`：可选，默认 `true`。移动时显示很短的柔和尾迹，模拟真实指示移动。
- `duration`：固定点通常 `500–900` 毫秒；移动式通常 `900–1600` 毫秒，保证滑动可看清。

使用规则：
- 每一段 `narration` 都必须能对应到一个明确的激光笔指示区域；不要让学生只听到旁白却不知道看哪里。
- 如果当前命令带有 `narration`，请在它前后紧邻插入一个 `laser_pointer`。通常推荐“先绘制对象，再用移动式激光笔指示它并讲解”；如果是预告下一步，也可以先让激光笔滑到目标区域，再绘制。
- `laser_pointer.narration` 可以承接讲解，也可以写成很短的定位语；重点是它的 `x/y/to/path/radius/style` 必须准确覆盖旁白里的对象。
- 默认不要只“点一下”。除非强调的是单个小数字、小点或按钮式目标，否则应使用 `to` 或 `path` 让激光笔顺滑移动。
- 小数字、短变量、坐标点：用 `dot` 或 `pulse`，半径 `7–10`。
- 大区域、答案框、图形局部：用 `pulse` 或 `spotlight`，半径 `10–14`，并用 `path` 沿区域边缘或重点方向移动。
- 不要把激光笔放在文字正中央挡住阅读，应放在目标附近或空白边缘处。
- 坐标系里的数学点先用 `plot_point` 准确标出，再让激光笔从坐标轴、辅助线或上一个关注点滑到该点附近。

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
- 如果文字放在 `draw_rectangle` 框内，框的宽度必须明显大于文字估算宽度，并给左右至少 `20–32` 像素内边距、上下至少 `16–24` 像素空间；下划线、着重号、批注不要贴到框边。
- 结论框、答案框尤其要留足空间：文字不要压到边框，答案文字距离框边至少 `24px`，字号越大边距越大。

默认强调策略：
- 普通重点：直接加粗、变色或增大字号。
- 小数字、变量、短词：用 `write_text_segments` + `emphasize_text`。
- 整行结论：可用下划线、颜色或稍大字号。
- 大范围区域：确实需要时才用 `annotate_object` 或 `annotate_circle`。
- 不要默认使用圈画。圈画是临时批注手段，不是每个重点的默认表达。

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
- 圈画要谨慎使用。只有当"把这一整块圈出来"能明显帮助学生理解时才使用。
- 不要连续多次圈画小目标；这会让画面凌乱，也容易出现定位偏差。
- 预检或优化脚本时，如果圈画只是套住一个小数字、短词或已经很明显的文字，应改成 `emphasize_text`，或者直接删除该圈画。

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

### 3.8 `wait` — 旧脚本兼容命令，不再建议生成

```jsonc
{
  "type": "wait",
  "id": "checkpoint-1",
  "message": "确认理解这一步后，点击"下一步"继续。",
  "narration": "这里先停一下，大家确认一下刚才这一步有没有理解。"
}
```

`wait` 会暂停脚本执行，直到用户点击播放器里的"下一步"。这是旧脚本兼容能力；AI 生成新脚本时不要使用它，因为播放器已有暂停/继续功能，用户可以随时手动暂停。

兼容说明：
- 旧脚本中出现 `wait` 时播放器仍能执行；
- 新生成脚本不要主动加入 `wait`；
- 需要留思考时间时，在 `narration` 中提示用户可暂停即可。

### 3.9 `set_canvas` — 中途调整画布（可选）

可在 `commands` 中再次出现，运行时改变画布尺寸/背景。一般用不上 ——
统一在顶层 `canvas` 里设置即可。

```jsonc
{ "type": "set_canvas", "width": 1600, "height": 900, "background": "#fafafa" }
```

一般建议在顶层 `canvas` 中一次性设置画布。只有确实需要中途改变尺寸或背景时才使用。

## 3.10 旁白字段 `narration` 详解

- 强烈建议大部分绘制/擦除命令都带 `narration`。
- 旁白应是第一人称口语，像一个亲和、有耐心、会打比方的老师在讲课。
- 不要写成机械说明书，不要像播报字段含义。要自然、接地气，有一点课堂感。
- 允许适度冗余和反复强调。学生理解需要过程，关键概念可以换一种说法再讲一遍。
- 在恰当的时候可以轻微幽默，但幽默要服务理解，不要喧宾夺主。
- 多用生活化类比和具体例子，例如“像排队数座位”“像一圈跑道又回到起点”“像菜单固定顺序轮流上菜”。
- 一句话讲一件事，推荐 10–60 个中文字符；复杂概念可以拆成多条旁白，不要硬塞进一句。
- 每一段旁白都要有对应的 `laser_pointer` 指示区域。写旁白时必须同时想清楚：学生此刻应该看画布上的哪个点、哪一行、哪个公式、哪个图形局部或哪块答案区域。
- 如果一句旁白同时提到多个位置，要拆成多条命令和多次激光笔指示；不要让一个激光笔承担两个相距很远的目标。
- `laser_pointer` 的 `duration` 应覆盖这段定位讲解。固定点通常 `500–900` 毫秒；移动式通常 `900–1600` 毫秒。涉及“从这里到那里”“沿着这行看”“顺着推导往下看”时，必须用 `to` 或 `path` 做顺滑移动。
- 旁白会在命令开始时出现，并以打字机效果显示。
- 如果旁白很长，适当增大该命令的 `duration`，让画面不要过早停住等待语音。
- 如果启用了 Azure TTS，`narration` 会被朗读出来；播放器不会把白板动画强行拉伸到语音长度，而是让同一段旁白和同一条命令同时开始，并在进入下一条命令前等待二者都完成。

旁白风格建议：
- 开场：先安抚学生，例如“别急，这题看着绕，其实我们只抓一个关键词：循环。”
- 关键步骤：可以重复，例如“注意，不是看44有多大，而是看它除以一轮以后余几。”
- 类比：循环题可以说“像转盘转了一圈又回到起点”；函数题可以说“x 往右走一步，y 跟着往上爬两格”。
- 幽默：可以轻一点，例如“余数这个小尾巴可不能丢，它往往就是答案的门牌号。”
- 结尾：要把答案和方法都收束清楚，例如“所以答案是菊花，更重要的是：以后看到循环，就先找一轮有几个。”
- 不要为了显得专业而说得冷冰冰；学生不是 JSON 解析器，学生需要慢慢听懂。

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

### 示例 E2 — 一次函数图像与移动演示

```json
{
  "canvas": { "width": 1200, "height": 760, "background": "#ffffff" },
  "commands": [
    { "type": "write_text", "id": "title", "text": "一次函数 y = 2x + 1", "x": 80, "y": 80, "fontSize": 42, "color": "#111111", "duration": 600, "narration": "我们用图像来看一次函数。" },
    { "type": "draw_coordinate_system", "id": "coord", "x": 110, "y": 130, "width": 620, "height": 420, "xMin": -5, "xMax": 5, "yMin": -4, "yMax": 8, "grid": true, "xTickStep": 1, "yTickStep": 1, "duration": 700, "narration": "先画出坐标系。" },
    { "type": "draw_function", "id": "f", "coordinateSystemId": "coord", "expression": "2*x + 1", "color": "#2563eb", "width": 4, "duration": 900, "narration": "函数图像是一条向右上方倾斜的直线。" },
    { "type": "plot_point", "id": "p0", "coordinateSystemId": "coord", "x": 0, "y": 1, "label": "(0,1)", "color": "#ef4444", "duration": 400, "narration": "当 x 等于零时，y 等于一，所以它过这个点。" },
    { "type": "draw_coordinate_segment", "id": "run", "coordinateSystemId": "coord", "from": [0, 1], "to": [1, 1], "color": "#f59e0b", "width": 3, "duration": 400, "narration": "横向增加一格。" },
    { "type": "draw_coordinate_segment", "id": "rise", "coordinateSystemId": "coord", "from": [1, 1], "to": [1, 3], "color": "#f59e0b", "width": 3, "duration": 400, "narration": "纵向增加两格，这就是斜率二的含义。" },
    { "type": "move_object", "id": "move_coord", "targetId": "coord", "by": { "dx": 260, "dy": 0 }, "duration": 900, "easing": "easeInOut", "narration": "最后把图像整体移到右侧，给左边留出推导空间。" }
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

多页白板准则：

- 不要把完整讲解硬塞进一张白板。内容一多，学生会不知道该看哪里。
- 一页只讲一个小问题，讲完就用 `switch_page` 换页。
- 推荐分页：读题页、条件/规律页、计算推导页、答案总结页。
- 如果一页主要对象超过 `12` 个，就要考虑换页；超过 `14` 个通常必须换页。
- 如果为了塞进一页而缩小字号、画很多框、画很多箭头，说明应该分页。
- 每页保留一个视觉重点，不要同时讲两个新概念。
- 需要回顾时可以切回旧页，不要把旧内容复制到新页导致拥挤。
- 预检或优化时，如果发现一页过满，应拆成多页，而不是继续压缩字号或增加框线。

图形选择建议：

- 有“范围、模块、容器、条件块、结论块”且确实需要分区时，才用 `draw_rectangle`。普通文字、普通公式、普通提示不要默认套框。
- 有“几何三角形、三要素、三方关系”时，用 `draw_triangle`。
- 有“集合、分类、圆心半径、循环节点”时，用 `draw_circle`。
- 有“方向、因果、输入输出、映射”时，用 `draw_arrow`；有“循环、返回、下一轮、反馈”时，用 `draw_arc_arrow`。
- 有“几行内容属于同一组、几个条件合起来、公式局部结构”时，用 `draw_brace`。
- 有“函数图像、坐标轴、坐标点、斜率、截距、顶点、交点”时，用 `draw_coordinate_system` + `draw_function` + `plot_point`，不要手工估算像素拼图。
- 指向坐标系里具体数值时，优先用 `plot_point`、`draw_coordinate_segment`；箭头只能作为辅助连接，不要让箭头本身替代坐标定位。
- 有“运动、平移、拖动比较、点从 A 到 B”时，用 `move_object`，让变化过程本身被看见。
- 有“小数字、短词强调”时，用 `emphasize_text`；有“整块内容强调”且确实需要视觉边界时，再用 `annotate_circle` 或 `annotate_object`。
- 图形要少而准。优秀白板不是到处画框和圈，而是“清晰文字 + 必要图示 + 准确激光笔 + 少量局部强调”的组合。
- 初稿生成时先保持简洁：能直接写字讲清楚，就不要额外画框；需要表达结构、分组或流程时，再添加图形。
- 优化或预检时，如果发现矩形框、圈画、批注没有明确教学作用，或者挤占画布空间，应直接删掉或改成文字强调。
- 如果文字和矩形框距离太近，优先扩大框或把文字向内移动；如果这个框只是装饰，直接删除框。

文字宽度粗略估算：

- 中文宽度约等于 `fontSize × 字数`。
- 英文/数字宽度约等于 `fontSize × 字符数 × 0.55`。

---

## 6. 错误与限制

前端会拒绝并提示以下情况：

- 整体不是合法 JSON 对象。
- 缺少 `canvas` 或 `commands`。
- 命令缺少必填字段。
- `type` 不在 `{set_canvas, switch_page, write_text, write_text_segments, write_math, write_math_steps, write_division_layout, draw_line, draw_arrow, draw_path, draw_rectangle, draw_triangle, draw_circle, draw_arc_arrow, draw_brace, move_object, draw_coordinate_system, draw_function, plot_point, draw_coordinate_segment, draw_point, draw_segment, draw_ray, draw_angle, mark_equal_segments, mark_parallel, mark_perpendicular, highlight_polygon, construct_geometry, erase_object, erase_area, clear_canvas, laser_pointer, annotate_underline, annotate_circle, annotate_object, annotate_math_bbox, emphasize_text, clear_annotations, wait}` 之内。
- 坐标不是 `[number, number]` 或数值字段类型错误。
- `draw_path.points` 少于 2 个点。
- `erase_object` 没有 `targetId` 或 `targetIds`。
- `erase_area` 的矩形缺少 `width` / `height`，或圆形缺少 `radius`。
- `duration` 不是数字。

**不支持** 的特性，请不要尝试生成：
- 任意未定义图形命令，例如 `draw_rect`（矩形请用 `draw_rectangle`）
- 图片、任意 SVG path、贝塞尔曲线
- 旋转或缩放已绘制元素（当前 `move_object` 只支持平移）
- 延时命令、并行播放、循环
- 字体族选择（默认中文回退到 PingFang SC / Microsoft YaHei）
- 多人协作、保存/加载
- 单独删除某一条批注（只能用 `clear_annotations` 清除整个批注图层）

换页 → 用 `switch_page`；矩形/框 → 用 `draw_rectangle`；三角形 → 用 `draw_triangle`；圆/集合圈 → 用 `draw_circle`；直线/辅助线 → 用 `draw_line`；自由曲线/涂鸦 → 用 `draw_path`；规范数学公式 → 用 `write_math` 或 `write_math_steps`；带余数除法竖式 → 用 `write_division_layout`；直线方向关系 → 用 `draw_arrow`；循环/返回/轮次关系 → 用 `draw_arc_arrow`；分组归纳 → 用 `draw_brace`；已绘制对象平移动画 → 用 `move_object`；坐标轴和函数图像 → 用 `draw_coordinate_system`、`draw_function`、`plot_point`、`draw_coordinate_segment`；几何证明 → 用 `draw_point`、`draw_segment`、`draw_ray`、`draw_angle`、`mark_equal_segments`、`mark_parallel`、`mark_perpendicular`、`highlight_polygon`；图片题/复杂构造重建 → 用 `construct_geometry`；每步讲解定位 → 用 `laser_pointer`；擦除 → 按场景用 `erase_object`、`erase_area` 或 `clear_canvas`；小数字/短词精准强调 → 用 `write_text_segments` + `emphasize_text`；大范围划重点/批注 → 用 `annotate_underline`、`annotate_circle`、`annotate_object` 或 `annotate_math_bbox`，讲完后用 `clear_annotations` 清除；需要课堂停顿 → 用旁白提示用户手动暂停，不要生成 `wait`。

---

## 7. 输出自检清单

发送前自检：

- [ ] 输出是**单一 JSON 对象**，没有任何前后缀文字、Markdown、代码围栏
- [ ] 顶层有 `canvas` 与 `commands`
- [ ] `canvas.width` 和 `canvas.height` 都是数字
- [ ] `commands` 是数组，且每个元素 `type` 属于 `{write_text, write_text_segments, write_math, write_math_steps, write_division_layout, draw_line, draw_arrow, draw_path, draw_rectangle, draw_triangle, draw_circle, draw_arc_arrow, draw_brace, move_object, draw_coordinate_system, draw_function, plot_point, draw_coordinate_segment, draw_point, draw_segment, draw_ray, draw_angle, mark_equal_segments, mark_parallel, mark_perpendicular, highlight_polygon, construct_geometry, erase_object, erase_area, clear_canvas, laser_pointer, annotate_underline, annotate_circle, annotate_object, annotate_math_bbox, emphasize_text, clear_annotations, set_canvas, switch_page}`；`wait` 仅旧脚本兼容，新脚本不要生成
- [ ] 完整讲解已使用 `pages` 和 `switch_page` 分页；每一页只讲一个小问题，没有把读题、分析、计算、总结都挤在同一页
- [ ] 每页主要对象不超过 `12–14` 个；如果超过，已拆成下一页
- [ ] 每个绘制/批注对象都有合法 `id`；动画命令有合理 `duration`
- [ ] 所有坐标都在 `0..canvas.width` × `0..canvas.height` 范围内
- [ ] 每一段 `narration` 都有对应的 `laser_pointer` 指示区域，学生能立刻知道旁白说的是哪里
- [ ] 每个 `laser_pointer` 的 `x/y/to/path/radius/style` 与旁白目标一致，且没有遮挡文字主体
- [ ] 除单个小数字、坐标点等小目标外，激光笔优先使用 `to` 或 `path` 顺滑移动，不是简单点一下
- [ ] `draw_arrow.from` 是箭尾，`draw_arrow.to` 是箭头尖端，方向没有写反
- [ ] 图形使用是必要的：没有给普通文字、普通公式、普通提示默认套矩形框
- [ ] 矩形框数量克制；普通 `1200×800` 白板通常不超过 `0–2` 个，超过 `3` 个时每个框都有明确教学作用
- [ ] 结构化内容在必要时使用 `draw_rectangle`、`draw_triangle`、`draw_circle`、`draw_arc_arrow`、`draw_brace` 等图形，而不是堆文字或手工拼线
- [ ] `draw_arc_arrow` 的角度按 `0=右, 90=下, 180=左, 270=上` 理解，`clockwise` 没有写反
- [ ] `move_object` 的 `targetId` 引用已存在对象；用 `by` 表示相对移动，用 `to` 表示绝对目标位置
- [ ] 函数图像已先创建 `draw_coordinate_system`，`draw_function.expression` 使用显式乘号，例如 `2*x+1`
- [ ] 几何证明已优先使用几何专用命令：点用 `draw_point`，边和辅助线用 `draw_segment`/`draw_ray`，角用 `draw_angle`，等长/平行/垂直分别用 `mark_equal_segments`/`mark_parallel`/`mark_perpendicular`
- [ ] 需要比较全等、相似或面积关系时，已用 `highlight_polygon` 淡色高亮参与证明的图形区域；没有用圈画代替几何标记
- [ ] 图片题或复杂几何构造已优先使用 `construct_geometry` 计算垂足、交点、外接圆；没有手动猜 E/F/H 等构造点坐标
- [ ] `draw_path.points` 至少包含两个合法坐标点，且顺序符合笔迹移动方向
- [ ] `erase_object` 引用的是之前确实创建过的元素 id
- [ ] `erase_area` 的区域大小合适，不会误擦掉旁边的重要内容
- [ ] `annotate_underline` 的 `x1/y1/x2/y2` 坐标准确定位在目标文字下方，不与其他元素重叠
- [ ] 小数字、单个变量、短词已优先使用 `write_text_segments` + `emphasize_text`，没有用大圈硬套小目标
- [ ] `annotate_circle` 只用于较大区域、整行文字、整段公式或图形；没有把圈画当成默认重点样式
- [ ] 如果预检或优化发现无意义矩形框、重复圈画、套小目标的圈画，已删除或改成 `emphasize_text`
- [ ] 复杂公式没有用普通文字硬拼；分数、根号、平方、推导步骤优先使用数学公式命令
- [ ] 数学推导逻辑完整：没有任何公式行以等号结尾；最终答案已在推导链中显式算出来，而不是只写在答案框里
- [ ] 每一次等式变形左右相等；文字题已按“题意关系 → 列式 → 计算 → 答案”写清楚关键步骤
- [ ] 公式局部批注的 `bbox` 使用画布绝对坐标，且确实覆盖目标局部
- [ ] 批注图层不会遮挡后续需要可见的主层内容；如需清除，已安排 `clear_annotations`
- [ ] 没有主动生成 `wait` 等待点；需要学生思考时，旁白提示用户可手动暂停
- [ ] 文字按估算宽度不会溢出画布
- [ ] 色值是 6 位 hex（`#rrggbb`）或合法 CSS 颜色
- [ ] 讲解命令带有自然口语的 `narration` 字段，串起来读得通顺像一段讲解；没有任何“有旁白但无激光笔指示”的讲解段落

通过以上各项 → 输出。
