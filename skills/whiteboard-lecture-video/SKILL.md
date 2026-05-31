---
name: whiteboard-lecture-video
description: Create AI whiteboard lecture videos from one problem image, multiple problem images, or a text topic/teaching plan using the local ai-whiteboard app. Use when Codex needs to recognize uploaded exercise images, construct or repair whiteboard scripts, render MP4 files through /api/video/render, concatenate multiple lessons into one MP4 with intro/outro, inspect frames for layout/content quality, and report timing/output paths.
---

# Whiteboard Lecture Video

## Overview

Use this skill to turn educational material into MP4 whiteboard lecture videos with the local `ai-whiteboard` project. Support three entry modes:

- Single image problem: recognize the uploaded image, create a lecture script, render one MP4.
- Multiple image problems: create one MP4 per image, add intro/outro, concatenate into one long MP4.
- Text topic or teaching plan: follow the user's desired explanation method, create a script, render MP4.

Prefer deterministic scripts for simple primary-school arithmetic or when the user gave the teaching method. Use the app's AI endpoints when the user explicitly asks to test the app's AI recognition/generation path.

## Preconditions

Work from the repo root, usually `/Users/tianyufeng/Desktop/ai-whiteboard`.

Check local service:

```bash
lsof -nP -iTCP:5001 -sTCP:LISTEN || PORT=5001 npm run dev
```

Run checks before relying on changed code:

```bash
npm run check
```

## Core Workflow

1. Create a stable output directory under `/tmp`, for example `/tmp/ai-whiteboard-video-YYYYMMDD-HHMMSS`.
2. Copy uploaded images out of temporary Photos paths before processing.
   - If the user provides supplementary illustrations for a text/article/EPUB lecture, copy them too and treat them as optional teaching assets, not as problem images to recognize.
3. Decide the entry mode:
   - For single image: produce one script and one MP4.
   - For multiple images: produce `00_intro.mp4`, one numbered MP4 per image, `99_outro.mp4`, then concatenate.
   - For text topic: produce a script from the user's topic and preferred explanation.
   - For text/article/EPUB plus supplementary illustrations: produce the normal script first, then apply the illustration enhancement workflow below before rendering.
4. Build or obtain a valid ai-whiteboard JSON script.
5. If supplementary illustrations are provided, insert them with `npm run illustrate:script` and validate the enhanced script.
6. Render with `scripts/render_whiteboard_mp4.mjs`.
7. Extract frames with ffmpeg and inspect at least early/middle/final frames.
8. If content is wrong, labels are cut off, formulas are confusing, images are missing/cropped, or laser marks cover text, repair the script and rerender.
9. Copy the final MP4 to a user-friendly path, normally Desktop, and reveal it with `open -R`.

## Supplementary Illustration Workflow

Use this when the user provides pictures to enrich a lecture, for example "use these illustrations in the video" or "attach these images as 插图". This is different from an image problem:

- Do not run image recognition unless the picture is the source problem itself.
- Do not generate new images or require an image API key.
- Use user-provided images as teaching assets.
- Prefer placing illustrations as independent visual explanation pages before the matching content page. This is more stable than forcing images into crowded existing pages.
- Keep captions short. Do not rely on text inside the image; write important labels with whiteboard commands.

After producing the base script, run one of these:

```bash
npm run illustrate:script -- \
  --script /tmp/job/script.json \
  --image /tmp/job/assets/illustration_1.png \
  --image /tmp/job/assets/illustration_2.jpg \
  --out /tmp/job/script_illustrated.json
```

For better placement, include metadata:

```bash
npm run illustrate:script -- \
  --script /tmp/job/script.json \
  --asset "/tmp/job/assets/concrete_section.png|混凝土内部结构|骨料像骨架，水泥浆像胶水。|骨料,水泥浆,内部|p2" \
  --out /tmp/job/script_illustrated.json
```

The `--asset` format is:

```text
path|title|caption|keyword1,keyword2|pageId
```

Only `path` is required. When `pageId` is omitted, the enhancer matches by title/caption/keywords and page content. If the user supplied enough context in natural language, create a small `illustrations.json` manifest yourself and pass it with `--assets`.

## Script Guidance

Use original problem images when the task includes pictures:

- Add a `draw_image` command near the top of the first page.
- Keep the image large and readable.
- Do not reconstruct diagrams unless the user asks or the original image is unreadable.
- Add laser pointers or short labels around the image, not over critical text.

For primary-school topics:

- Prefer concrete place-value language over algebra unless the user asks for equations.
- Use short lines and large fonts.
- Split crowded reasoning into extra pages.
- If the user supplies a method, follow it instead of inventing a new method.

For batches:

- Make the intro state the theme and method.
- Make every item title start with `第N题`.
- Make the outro summarize the reusable method.
- Validate each individual MP4 before concatenating.

## Rendering

Use the bundled renderer:

```bash
node ~/.codex/skills/whiteboard-lecture-video/scripts/render_whiteboard_mp4.mjs \
  --script /tmp/job/script.json \
  --out /tmp/job/lesson.mp4 \
  --tts true \
  --pace fast \
  --aspect portrait \
  --board-theme light \
  --base-url http://127.0.0.1:5001
```

Use `--pace fast` for short-video rhythm. It maps to `1.25x` playback speed while keeping the same timing source for animation, subtitles, and narration so the generated text and voice stay aligned. Omit it for the standard `1.00x` version, or pass `--speed <number>` for an explicit override.
Use `--aspect portrait` or `--aspect 9:16` for the 720×1280 phone-short-video canvas. Omit it for the standard 1200×800 landscape canvas.

The script records wall-clock render time and writes the MP4. If rendering fails, read the JSON error; common causes are preflight failures, narration duration mismatch, or invalid command fields.
Use `--board-theme dark` when the user requests a black-background whiteboard. The video API will render a black canvas and adapt/invert script colors for black-background readability while leaving the default white-background path unchanged.

## Frame QA

Extract frames:

```bash
mkdir -p /tmp/job/frames
ffmpeg -y -i /tmp/job/lesson.mp4 -vf fps=0.25 /tmp/job/frames/frame_%02d.png
```

Inspect frames with `view_image` or screenshots. Check:

- Original images appear and are readable.
- Important final answers fully appear before the segment ends.
- No text overlap, clipped text, or formula source like `\sum` showing raw.
- Laser pointer does not obscure the answer or key diagram.
- The mathematical answer and method are correct.

If a late answer appears only at the very end, extract a near-end frame using:

```bash
ffmpeg -y -ss 31.5 -i lesson.mp4 -frames:v 1 near_end.png
```

## Concatenation

Create a concat list:

```text
file '/tmp/job/00_intro.mp4'
file '/tmp/job/01_q1.mp4'
file '/tmp/job/02_q2.mp4'
file '/tmp/job/99_outro.mp4'
```

Then concatenate:

```bash
ffmpeg -y -f concat -safe 0 -i /tmp/job/concat.txt -c copy /tmp/job/final.mp4 \
  || ffmpeg -y -f concat -safe 0 -i /tmp/job/concat.txt \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k /tmp/job/final.mp4
```

Run `ffprobe` on the final MP4 and inspect frames near segment boundaries.

## Reporting

In the final response, include:

- Final MP4 path.
- Individual MP4 paths for batches.
- Recognition/generation/render/concat timings when available.
- Any manual corrections made for content quality.
- Whether the workflow used app AI endpoints or Codex-authored scripts plus local rendering.

When the user asks to be notified, use macOS `say` after the final video is ready.
