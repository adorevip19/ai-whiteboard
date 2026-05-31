---
name: illustrated-whiteboard-lecture
description: Generate illustrated AI Whiteboard MP4 lectures when the user asks for 插画讲解、带插图版、带插画版、illustrated whiteboard video, or wants a text/article/EPUB/book explanation video enriched with illustrations. Use local/user-provided/generated bitmap illustration files as teaching assets, insert them into the ai-whiteboard JSON script with npm run illustrate:script, render MP4 locally, QA frames, and save the result to the requested folder. Do not require or call any image-generation API key; only use existing images, user-supplied illustrations, or local/Codex-generated assets when available.
---

# Illustrated Whiteboard Lecture

Use this skill when the user asks to generate a **带插图/带插画** whiteboard explanation MP4. It builds on the local `ai-whiteboard` app, but adds a deterministic illustration insertion step.

## Core Principle

Do not use paid image APIs or require image API keys. Illustrations must come from one of these sources:

- User-provided image files.
- Existing local image files.
- Simple local generated diagrams/assets created with repo/local scripts.
- Codex Image Tool only if the user explicitly wants AI-generated illustrations and the tool is available.

The app itself should not call OpenAI image generation APIs.

## Required Repo

Work from:

```bash
/Users/tianyufeng/Desktop/ai-whiteboard
```

Check:

```bash
npm run check
lsof -nP -iTCP:5001 -sTCP:LISTEN || PORT=5001 npm run dev
```

## Workflow

1. Create a job directory, for example `/tmp/ai-whiteboard-illustrated-YYYYMMDD-HHMMSS`.
2. Extract or prepare the source content:
   - EPUB/text/book/article: extract the text and make a normal whiteboard script first.
   - If a prior non-illustrated script exists and matches the same content, reuse it when appropriate.
3. Prepare illustration assets:
   - If the user attached illustrations, copy them into `job/assets/`.
   - If no illustrations were attached but the user requested an illustrated version, create simple local teaching PNGs when feasible. Prefer clean diagrams without embedded text.
   - Create `illustrations.json` when you need titles, captions, keywords, or explicit page IDs.
4. Apply illustrations:

```bash
npm run illustrate:script -- \
  --script /tmp/job/script.json \
  --assets /tmp/job/illustrations.json \
  --out /tmp/job/script_illustrated.json
```

or directly:

```bash
npm run illustrate:script -- \
  --script /tmp/job/script.json \
  --image /tmp/job/assets/illustration_1.png \
  --image /tmp/job/assets/illustration_2.jpg \
  --out /tmp/job/script_illustrated.json
```

For precise placement:

```bash
npm run illustrate:script -- \
  --script /tmp/job/script.json \
  --asset "/tmp/job/assets/concrete_section.png|混凝土内部结构|骨料像骨架，水泥浆像胶水。|骨料,水泥浆,内部|p2" \
  --out /tmp/job/script_illustrated.json
```

`--asset` format:

```text
path|title|caption|keyword1,keyword2|pageId
```

Only `path` is required. If `pageId` is omitted, the enhancer matches by title/caption/keywords and page content.

5. Validate the enhanced script:

```bash
npx tsx -e "import fs from 'node:fs'; import { validateScript } from './client/src/whiteboard/commandTypes'; const s=JSON.parse(fs.readFileSync('/tmp/job/script_illustrated.json','utf8')); const v=validateScript(s); if(!v.ok) throw new Error(v.error); console.log('ok', v.script.pages?.length, v.script.commands.length)"
```

6. Render:

```bash
node skills/whiteboard-lecture-video/scripts/render_whiteboard_mp4.mjs \
  --script /tmp/job/script_illustrated.json \
  --out /tmp/job/lesson_illustrated.mp4 \
  --tts true \
  --base-url http://127.0.0.1:5001
```

For longer scripts, split by `switch_page`, render each page/segment separately, then concatenate with ffmpeg and re-encode:

```bash
ffmpeg -y -f concat -safe 0 -i /tmp/job/concat.txt \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k /tmp/job/final.mp4
```

7. QA with `ffprobe` and frame extraction:

```bash
ffprobe -v error -show_entries format=duration,size -show_streams -of json /tmp/job/final.mp4
ffmpeg -y -ss 00:00:08 -i /tmp/job/final.mp4 -frames:v 1 -update 1 /tmp/job/frames/early.png
```

Inspect early, middle, illustration-specific, and final frames. Check:

- Illustrations appear and are not blank.
- Captions and titles are not clipped.
- Images do not cover important whiteboard text.
- Final summary/answer fully appears.
- Audio and video streams exist.

8. Copy outputs to the requested folder. Use names that clearly include `带插图版` or `带插画版`.

## Placement Guidance

- Prefer independent illustration pages before the matching content page. This is stable and avoids overcrowding.
- Use 3-8 illustrations for a 5-10 minute lecture.
- Do not insert decorative images. Each illustration should support a concrete object, structure, process, scenario, or comparison.
- For math, only use illustrations when the explanation has a real-world scenario or visual structure. Pure symbolic derivation usually does not need an illustration.
- Keep image text minimal or absent; write labels/captions through whiteboard commands.

## Final Response

Include:

- Final MP4 path.
- Script/manifest paths if saved.
- Duration and QA summary.
- State whether illustrations came from user assets, local generated diagrams, or Codex Image Tool.
