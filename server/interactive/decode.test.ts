import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAudio } from "./assess";
test("reject non-audio and playlist inputs before invoking any service", async () => {
  await assert.rejects(
    decodeAudio(
      Buffer.from("#EXTM3U\nhttps://example.com/private").toString("base64"),
    ),
    /浏览器录制/,
  );
  await assert.rejects(decodeAudio("!".repeat(9 * 1024 * 1024)), /过大/);
});
