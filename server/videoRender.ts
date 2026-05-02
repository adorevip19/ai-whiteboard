import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";

type CdpMessage = {
  id?: number;
  method?: string;
  params?: any;
  result?: any;
  error?: { message?: string; data?: string };
  sessionId?: string;
};

class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ws.on("message", (data) => {
      const message = JSON.parse(String(data)) as CdpMessage;
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || message.error.data || "CDP 调用失败"));
      } else {
        pending.resolve(message.result);
      }
    });
  }

  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = this.nextId++;
    const payload: CdpMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const promise = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  close() {
    this.ws.close();
  }
}

function getChromeExecutable() {
  return (
    process.env.CHROME_EXECUTABLE_PATH ||
    process.env.GOOGLE_CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  );
}

async function waitForDevtoolsUrl(chrome: ChildProcessWithoutNullStreams) {
  return new Promise<string>((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => {
      reject(new Error(`Chrome 启动超时：${stderr || "没有 DevTools 输出"}`));
    }, 15000);

    chrome.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    chrome.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome 过早退出：${code ?? "unknown"} ${stderr}`));
    });
  });
}

async function waitForPageFunction(cdp: CdpClient, sessionId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    const result = await cdp.send(
      "Runtime.evaluate",
      {
        expression: "Boolean(window.aiWhiteboardRecordScript)",
        returnByValue: true,
      },
      sessionId,
    );
    if (result?.result?.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("白板渲染页面未准备好。");
}

export async function renderScriptToWebmInHeadlessBrowser(params: {
  baseUrl: string;
  scriptText: string;
  uploadUrl: string;
  ttsEnabled: boolean;
  playbackSpeed: number;
}) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-whiteboard-chrome-"));
  const chrome = spawn(getChromeExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ]);

  let cdp: CdpClient | null = null;
  try {
    const wsUrl = await waitForDevtoolsUrl(chrome);
    cdp = new CdpClient(wsUrl);
    await cdp.open();
    const { targetId } = await cdp.send("Target.createTarget", {
      url: `${params.baseUrl}/#/`,
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await cdp.send("Runtime.enable", {}, sessionId);
    await waitForPageFunction(cdp, sessionId);
    const expression = `window.aiWhiteboardRecordScript(${JSON.stringify({
      scriptText: params.scriptText,
      uploadUrl: params.uploadUrl,
      ttsEnabled: params.ttsEnabled,
      playbackSpeed: params.playbackSpeed,
    })})`;
    const result = await cdp.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    );
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "白板录制脚本执行失败。");
    }
    return result?.result?.value;
  } finally {
    cdp?.close();
    chrome.kill("SIGTERM");
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
