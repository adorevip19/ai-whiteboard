// Subtitle bar that displays the narration for the current command.
// The full narration string is fed in as `text`; this component animates it
// with a typewriter effect, similar to a teacher speaking while drawing.
import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

interface Props {
  /** Full narration text for the current step. null/empty hides the bar. */
  text: string | null;
  /**
   * Approximate characters-per-second for the typewriter. The narration's
   * total reveal time = textLength / charsPerSecond. Default tuned to feel
   * like natural lecture speech (≈ 8 chars/sec for Chinese, slightly faster
   * for Latin scripts).
   */
  charsPerSecond?: number;
}

export function NarrationBar({ text, charsPerSecond = 9 }: Props) {
  const [visible, setVisible] = useState("");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Reset & cancel any in-flight animation when the narration changes.
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    if (!text) {
      setVisible("");
      return;
    }

    // Use Array.from to handle multi-byte characters (CJK, emoji).
    const chars = Array.from(text);
    const total = chars.length;
    if (total === 0) {
      setVisible("");
      return;
    }

    const duration = (total / Math.max(charsPerSecond, 1)) * 1000;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / Math.max(duration, 1), 1);
      const visibleCount = Math.max(1, Math.ceil(t * total));
      setVisible(chars.slice(0, visibleCount).join(""));
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [text, charsPerSecond]);

  if (!text) {
    return (
      <div
        className="flex min-h-[64px] items-center gap-3 border-t bg-muted/30 px-6 py-3"
        data-testid="narration-bar-empty"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground/60">
          <Mic className="h-4 w-4" />
        </div>
        <span className="text-sm italic text-muted-foreground/60">
          旁白区域 · 运行脚本后老师会开始讲解
        </span>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-[64px] items-start gap-3 border-t bg-foreground/[0.04] px-6 py-3"
      data-testid="narration-bar"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Mic className="h-4 w-4" />
      </div>
      <p
        className="text-[15px] leading-relaxed text-foreground"
        data-testid="text-narration"
      >
        {visible}
        <span
          className="ml-0.5 inline-block h-[1em] w-[2px] -translate-y-[2px] animate-pulse bg-primary align-middle"
          aria-hidden
        />
      </p>
    </div>
  );
}
