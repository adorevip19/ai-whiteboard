import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Play, Square, Trash2, FileText, AlertCircle, CheckCircle2 } from "lucide-react";
import { WhiteboardCanvas } from "@/whiteboard/WhiteboardCanvas";
import { ScriptRunner } from "@/whiteboard/ScriptRunner";
import {
  validateScript,
  describeCommand,
  type CanvasConfig,
  type RenderedElement,
  type WhiteboardCommand,
} from "@/whiteboard/commandTypes";
import { sampleScriptString, sampleScript } from "@/whiteboard/sampleScript";

type RunStatus = "idle" | "running" | "done" | "error";

export default function WhiteboardPage() {
  const [scriptText, setScriptText] = useState<string>(sampleScriptString);
  const [canvas, setCanvas] = useState<CanvasConfig>(sampleScript.canvas);
  const [elements, setElements] = useState<RenderedElement[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepTotal, setStepTotal] = useState(0);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [activeCommands, setActiveCommands] = useState<WhiteboardCommand[]>([]);

  const runnerRef = useRef<ScriptRunner | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      runnerRef.current?.cancel();
    };
  }, []);

  const handleRun = () => {
    // Cancel any in-flight run.
    runnerRef.current?.cancel();
    runnerRef.current = null;

    setErrorMsg("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(scriptText);
    } catch (e) {
      setStatus("error");
      setErrorMsg(`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const result = validateScript(parsed);
    if (!result.ok) {
      setStatus("error");
      setErrorMsg(result.error);
      return;
    }

    // Reset state for a fresh run.
    setActiveCommands(result.script.commands);
    setCanvas(result.script.canvas);
    setElements([]);
    setStepIndex(0);
    setStepTotal(result.script.commands.length);
    setStatus("running");

    const runner = new ScriptRunner(result.script, {
      onCanvasChange: (c) => setCanvas(c),
      onElementsChange: (els) => setElements(els),
      onStepChange: (i, total) => {
        setStepIndex(i);
        setStepTotal(total);
      },
      onComplete: () => setStatus("done"),
      onError: (msg) => {
        setErrorMsg(msg);
        setStatus("error");
      },
    });
    runnerRef.current = runner;
    void runner.run();
  };

  const handleStop = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    setStatus("idle");
  };

  const handleClear = () => {
    runnerRef.current?.cancel();
    runnerRef.current = null;
    setElements([]);
    setStepIndex(0);
    setStepTotal(0);
    setStatus("idle");
    setErrorMsg("");
    setActiveCommands([]);
  };

  const handleLoadSample = () => {
    setScriptText(sampleScriptString);
    setErrorMsg("");
  };

  const stepLabel = useMemo(() => {
    if (status === "error") return "执行出错";
    if (status === "idle") return "等待运行";
    if (status === "done") return "执行完成";
    if (stepTotal === 0) return "等待运行";
    // While running, stepIndex points to the command currently executing.
    const currentNumber = Math.min(stepIndex + 1, stepTotal);
    return `正在执行第 ${currentNumber} / ${stepTotal} 步`;
  }, [status, stepIndex, stepTotal]);

  const currentCommand =
    status === "running" && activeCommands[stepIndex]
      ? activeCommands[stepIndex]
      : null;

  return (
    <div className="flex h-screen w-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-label="AI 白板">
              <path d="M4 4h16v12H4z" />
              <path d="M8 20h8" />
              <path d="M12 16v4" />
              <path d="M7 8l3 3 7-7" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">AI 白板</h1>
            <p className="text-xs text-muted-foreground">JSON 命令式白板 · MVP</p>
          </div>
        </div>
        <Badge variant="outline" data-testid="badge-status">
          {status === "running" && (
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
          )}
          {status === "done" && (
            <CheckCircle2 className="mr-1.5 h-3 w-3 text-emerald-500" />
          )}
          {status === "error" && (
            <AlertCircle className="mr-1.5 h-3 w-3 text-destructive" />
          )}
          {stepLabel}
        </Badge>
      </header>

      {/* Body: split panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: controls + JSON */}
        <aside className="flex w-[420px] flex-col border-r">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Button
              size="sm"
              onClick={handleRun}
              disabled={status === "running"}
              data-testid="button-run"
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              运行脚本
            </Button>
            {status === "running" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStop}
                data-testid="button-stop"
              >
                <Square className="mr-1.5 h-3.5 w-3.5" />
                停止
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={handleClear}
              data-testid="button-clear"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              清空画布
            </Button>
            <div className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              onClick={handleLoadSample}
              data-testid="button-load-sample"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              示例
            </Button>
          </div>

          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <label className="mb-2 text-xs font-medium text-muted-foreground">
              JSON 命令脚本
            </label>
            <Textarea
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
              spellCheck={false}
              className="flex-1 resize-none font-mono text-xs leading-relaxed"
              placeholder='{ "canvas": {...}, "commands": [...] }'
              data-testid="input-script"
            />

            {errorMsg ? (
              <Card className="mt-3 border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-start gap-2 text-xs text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div className="font-medium" data-testid="text-error">
                    {errorMsg}
                  </div>
                </div>
              </Card>
            ) : null}
          </div>
        </aside>

        {/* Right: whiteboard + step indicator */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex flex-1 overflow-hidden">
            <WhiteboardCanvas canvas={canvas} elements={elements} />
          </div>

          <Separator />
          <div className="flex items-center gap-3 px-6 py-3 text-xs">
            <span className="font-mono text-muted-foreground" data-testid="text-step-label">
              {stepLabel}
            </span>
            {currentCommand ? (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-foreground" data-testid="text-current-command">
                  {describeCommand(currentCommand)}
                </span>
              </>
            ) : null}
            {stepTotal > 0 ? (
              <div className="ml-auto h-1.5 w-48 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{
                    width: `${
                      status === "done"
                        ? 100
                        : Math.round(
                            (Math.min(stepIndex, stepTotal) / stepTotal) * 100,
                          )
                    }%`,
                  }}
                  data-testid="progress-bar"
                />
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
