import { useEffect, useRef, useState } from "react";
import { domainLabels, nextLessonIndex, type Domain } from "@shared/interactive";
import "./interactive-lesson.css";
async function api(url: string, body?: unknown, method = "POST") {
  const r = await fetch("/api/interactive" + url, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message || "请求暂时失败");
  return d;
}
const rounded = (n: number | null | undefined) =>
  n == null ? "—" : Math.round(n);
const assessmentLabels: Record<string, string> = {
  graded: "已评分",
  uncertain: "需要核对",
  unavailable: "服务暂不可用",
  processing: "评估中",
  interrupted: "评估中断",
  done: "已完成",
};
const answerText = (item: any, text: string | undefined) =>
  item.kind === "choice"
    ? item.choices?.find((c: any) => c.id === text)?.text || text
    : text;
export default function InteractiveLesson({
  courseId,
}: { courseId?: string } = {}) {
  const storageKey = courseId
    ? `interactive-run:${courseId}`
    : "interactive-run";
  const [activeIndex, setActiveIndex] = useState(0);
  const [auth, setAuth] = useState(false),
    [parent, setParent] = useState(false),
    [passwordless, setPasswordless] = useState(false),
    [password, setPassword] = useState(""),
    [pin, setPin] = useState(""),
    [courses, setCourses] = useState<any[]>([]),
    [runs, setRuns] = useState<any[]>([]),
    [run, setRun] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recording, setRecording] = useState(false),
    [phase, setPhase] = useState<"lecture" | "question" | "feedback">(
      "lecture",
    ),
    [clip, setClip] = useState(0),
    [choice, setChoice] = useState(""),
    [report, setReport] = useState<any>(null),
    [showParent, setShowParent] = useState(false),
    [usage, setUsage] = useState<any>(null),
    [seconds, setSeconds] = useState(0),
    [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const classroom = useRef<HTMLElement>(null);
  const fullscreenPending = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenHint, setFullscreenHint] = useState("");
  const enterFullscreen = async () => {
    const el = classroom.current;
    if (!el || document.fullscreenElement || fullscreenPending.current) return;
    try {
      if (!el.requestFullscreen) {
        setFullscreenHint("当前浏览器不支持整页全屏，课堂已铺满页面；可添加到主屏幕后打开。");
        return;
      }
      fullscreenPending.current = true;
      await el.requestFullscreen();
      setFullscreenHint("");
    } catch {
      if (!document.fullscreenElement) setFullscreenHint("点击“全屏课堂”开启，视频和答题会一直保持在同一个全屏课堂里。");
    } finally {
      fullscreenPending.current = false;
    }
  };
  useEffect(() => {
    const changed = () => { setFullscreen(!!document.fullscreenElement); if (document.fullscreenElement) setFullscreenHint(""); };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  const stepsPanel = useRef<HTMLElement>(null);
  useEffect(() => {
    const panel = stepsPanel.current;
    const active = panel?.querySelector<HTMLElement>(".active");
    if (!panel || !active) return;
    panel.scrollTop = Math.max(
      0,
      active.offsetTop - panel.offsetTop - panel.clientHeight / 2,
    );
    panel.scrollLeft = Math.max(
      0,
      active.offsetLeft - panel.offsetLeft - panel.clientWidth / 2,
    );
  }, [activeIndex, run?.id]);
  const video = useRef<HTMLVideoElement>(null),
    speaker = useRef<HTMLAudioElement>(null),
    recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    audioContext = useRef<AudioContext | null>(null),
    cancelRecording = useRef(false),
    recordTimer = useRef<ReturnType<typeof setInterval> | null>(null),
    requestId = useRef(""),
    saving = useRef(0),
    runRef = useRef<any>(null);
  runRef.current = run;
  const at = run ? activeIndex : -1;
  const item = at >= 0 ? run.items[at] : null;
  const progress = at >= 0 ? run.progress[at] : null;
  const media = (f: string) =>
    `/api/interactive/runs/${run.id}/media/${encodeURIComponent(f)}`;
  const loadList = async () => {
    const d = await api("/courses");
    setCourses(
      courseId ? d.courses.filter((c: any) => c.id === courseId) : d.courses,
    );
    setRuns(
      courseId ? d.runs.filter((r: any) => r.course_id === courseId) : d.runs,
    );
  };
  const openRun = async (id: string) => {
    const r = await api("/runs/" + id);
    void enterFullscreen();
    setRun(r);
    localStorage.setItem(storageKey, id);
    setReport(null);
    setChoice("");
    setClip(0);
    setPhase("lecture");
    const resume = r.items.findIndex((i: any) => i.id === r.position?.itemId);
    const n = !r.completed && resume >= 0 ? resume : r.progress.findIndex((p: any) => p.status !== "complete");
    setActiveIndex(n >= 0 ? n : r.items.length - 1);
    if (n >= 0) {
      const p = r.progress[n];
      if (p.status === "retry" || p.status === "review") setPhase("question");
      if (r.position?.itemId === r.items[n].id) setClip(r.position.clip || 0);
    } else setReport(await api(`/runs/${id}/report`));
  };
  useEffect(() => {
    api("/session")
      .then(async (s) => {
        setAuth(s.authenticated);
        setParent(s.parent);
        setPasswordless(!!s.passwordless);
        if (s.authenticated) {
          await loadList();
          const id = localStorage.getItem(storageKey);
          if (id) await openRun(id);
        }
      })
      .catch((e) => setError(e.message));
    return () => {
      cancelRecording.current = true;
      recorder.current?.state === "recording" && recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
      audioContext.current?.close();
      if (recordTimer.current) clearInterval(recordTimer.current);
    };
  }, []);
  useEffect(() => {
    const pause = () => {
      if (document.hidden) {
        video.current?.pause();
        speaker.current?.pause();
        if (recorder.current?.state === "recording") {
          cancelRecording.current = true;
          recorder.current.stop();
          setError("录音被中断，没有提交。回来后请重新回答。");
        }
      }
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, []);
  useEffect(() => {
    if (item && phase === "lecture" && !item.lecture?.length) {
      setPhase("question");
      void play(item.promptAudio);
    }
  }, [item?.id, phase]);
  const act = async (fn: () => Promise<any>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const message = e instanceof Error ? e.message : "操作暂时失败";
      setError(message);
      if (message.includes("家长") && message.includes("解锁")) {
        setParent(false);
        setShowParent(true);
      }
    } finally {
      setBusy(false);
    }
  };
  const play = async (file: string) => {
    video.current?.pause();
    if (speaker.current) {
      speaker.current.src = media(file);
      try {
        await speaker.current.play();
      } catch {
        setError("请点击“播放老师声音”继续。");
      }
    }
  };
  const submit = async (payload: unknown) => {
    if (!item) return;
    void enterFullscreen();
    const id = requestId.current || crypto.randomUUID();
    requestId.current = id;
    await act(async () => {
      speaker.current?.pause();
      const result = await api(`/runs/${run.id}/answers`, {
        itemId: item.id,
        requestId: id,
        ...(payload as any),
      });
      if (result.state === "processing") {
        setError("上一次回答仍在评估，请稍后刷新状态。");
        return;
      }
      requestId.current = "";
      setRun(result.run);
      const p = result.run.progress[at];
      setPhase("feedback");
      if (p.released && !result.run.completed) {
        setActiveIndex(nextLessonIndex(result.run.progress, at));
        setChoice("");
        setClip(0);
        setPhase("lecture");
      } else if (p.feedback) await play(p.feedback);
      if (result.run.completed) setReport(await api(`/runs/${run.id}/report`));
    });
  };
  const startRecording = async () => {
    if (busy || recording) return;
    void enterFullscreen();
    setError("");
    speaker.current?.pause();
    video.current?.pause();
    cancelRecording.current = false;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.current = s;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const rec = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      recorder.current = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const ctx = new AudioContext();
      audioContext.current = ctx;
      const source = ctx.createMediaStreamSource(s),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const data = new Float32Array(analyser.fftSize);
      const start = Date.now();
      let spoke = false,
        lastVoice = start;
      rec.onstop = async () => {
        setRecording(false);
        if (recordTimer.current) clearInterval(recordTimer.current);
        s.getTracks().forEach((t) => t.stop());
        await ctx.close().catch(() => {});
        if (cancelRecording.current) return;
        const blob = new Blob(chunks, { type: rec.mimeType });
        const b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        await submit({ audio: b64 });
      };
      rec.start();
      setRecording(true);
      setSeconds(0);
      recordTimer.current = setInterval(() => {
        analyser.getFloatTimeDomainData(data);
        const rms = Math.sqrt(
          data.reduce((s, x) => s + x * x, 0) / data.length,
        );
        if (rms > 0.012) {
          spoke = true;
          lastVoice = Date.now();
        }
        const elapsed = (Date.now() - start) / 1000;
        setSeconds(Math.floor(elapsed));
        if (elapsed >= 30 || (item.kind === "read" && spoke && Date.now() - lastVoice > 4000))
          if (rec.state === "recording") rec.stop();
      }, 100);
    } catch {
      setError("无法使用麦克风。请允许录音权限后重试；本题仍会保留。");
      stream.current?.getTracks().forEach((t) => t.stop());
    }
  };
  const startLecture = async (element: HTMLVideoElement) => {
    setAutoplayBlocked(false);
    void enterFullscreen();
    if (document.hidden) return;
    speaker.current?.pause();
    try {
      await element.play();
    } catch (e) {
      // A replaced clip may abort its pending play promise; only surface
      // a browser gesture requirement for the current video.
      if (
        video.current === element &&
        e instanceof DOMException &&
        e.name === "NotAllowedError"
      )
        setAutoplayBlocked(true);
    }
  };
  const navigateTo = (n: number) => {
    if (busy) return;
    void enterFullscreen();
    speaker.current?.pause();
    video.current?.pause();
    cancelRecording.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    requestId.current = "";
    setActiveIndex(n);
    setChoice("");
    setClip(0);
    setReport(null);
    setPhase("lecture");
    const position = { itemId: run.items[n].id, clip: 0, seconds: 0 };
    setRun({ ...run, position });
    void api(`/runs/${run.id}/position`, position, "PUT").catch(() => {});
  };
  const next = () => {
    void enterFullscreen();
    const n = nextLessonIndex(run.progress, at);
    if (n >= 0) navigateTo(n);
    else void fetchReport();
  };
  const fetchReport = () =>
    act(async () => {
      setReport(await api(`/runs/${run.id}/report`));
      if (parent) setUsage(await api("/parent/usage"));
    });
  return (
    <main ref={classroom} className="lesson-app">
      <audio ref={speaker} onEnded={() => {}} />
      <header className="lesson-header">
        <a
          href={courseId ? `#/learn/${courseId}` : "#/learn"}
          onClick={() => {
            video.current?.pause();
            speaker.current?.pause();
            cancelRecording.current = true;
            if (recorder.current?.state === "recording")
              recorder.current.stop();
            setRun(null);
            setReport(null);
            if (auth) loadList();
          }}
          className="lesson-brand"
        >
          <span>✦</span> 小小探险课堂
        </a>
        <div className="lesson-header-actions">
          {run && <button onClick={fetchReport}>学习报告</button>}
          <button onClick={() => fullscreen ? document.exitFullscreen() : enterFullscreen()}>
            {fullscreen ? "退出全屏" : "全屏课堂"}
          </button>
          <button onClick={() => setShowParent(!showParent)}>
            家长区 {parent ? "✓" : ""}
          </button>
        </div>
      </header>
      {fullscreenHint && <p className="lesson-subtle">{fullscreenHint}</p>}
      {!auth ? (
        <section className="lesson-login">
          <span className="lesson-kicker">WELCOME BACK</span>
          <h1>
            准备好开始
            <br />
            新的小探险了吗？
          </h1>
          <p>用家庭口令进入，一次学会一个小目标。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              act(async () => {
                await api("/login", { password });
                setAuth(true);
                setPassword("");
                await loadList();
              });
            }}
          >
            <input
              aria-label="家庭口令"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="家庭口令"
            />
            <button className="lesson-primary" disabled={busy}>
              进入课堂 →
            </button>
          </form>
        </section>
      ) : (
        <>
          {showParent && (
            <section className="lesson-parent">
              <h2>家长区</h2>
              {!parent ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    act(async () => {
                      await api("/parent/unlock", { pin });
                      setParent(true);
                      setPin("");
                      if (run) setReport(await api(`/runs/${run.id}/report`));
                      setUsage(await api("/parent/usage"));
                    });
                  }}
                >
                  <input
                    type="password"
                    aria-label="家长口令"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="家长口令"
                  />
                  <button>解锁复核与详细报告</button>
                </form>
              ) : (
                <>
                  <p>
                    {passwordless ? "已启用免口令访问。" : "已解锁15分钟。"}
                    复核必须基于孩子的真实作答，不能直接跳过题目。
                  </p>
                  {!passwordless && (
                    <button
                      onClick={() =>
                        act(async () => {
                          await api("/parent/lock", {});
                          setParent(false);
                          setReport(null);
                        })
                      }
                    >
                      锁定家长区
                    </button>
                  )}
                  {usage && (
                    <p>
                      课堂实时 Gemini 配音：0次。今日上限：Azure{" "}
                      {usage.limits.azureCallsPerDay}次，语义判断{" "}
                      {usage.limits.semanticCallsPerDay}次。
                    </p>
                  )}
                </>
              )}
            </section>
          )}
          {!run ? (
            <>
              <section className="lesson-welcome">
                <span className="lesson-kicker">LISTEN · THINK · SPEAK</span>
                <h1>
                  让每一次开口，
                  <br />
                  都有一点新收获。
                </h1>
                <p>看故事，认真想一想，再把你的答案说出来。</p>
              </section>
              <div className="lesson-course-grid">
                {courses.map((c) => (
                  <article className="lesson-course" key={c.id + c.version}>
                    <div className="lesson-course-art">
                      🍬 <span>THE CANDY QUEST</span>
                    </div>
                    <div>
                      <span className="lesson-kicker">
                        {c.items} 个学习小目标 · 英语
                      </span>
                      <h2>{c.title}</h2>
                      <p>{c.description}</p>
                      {c.qa.status !== "reviewed" && (
                        <p className="lesson-warning">
                          工程预览：发音与儿童评分仍需验收，仅家长可开启。
                        </p>
                      )}
                      <button
                        className="lesson-primary"
                        disabled={busy}
                        onClick={() => {
                          void enterFullscreen();
                          return act(async () => {
                            const r = await api("/runs", {
                              courseId: c.id,
                              version: c.version,
                            });
                            await openRun(r.id);
                          });
                        }}
                      >
                        开始新一课 →
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {runs.length > 0 && (
                <section className="lesson-history">
                  <h2>继续上次的学习</h2>
                  {runs.slice(0, 8).map((r) => (
                    <button key={r.id} onClick={() => { void enterFullscreen(); return act(() => openRun(r.id)); }}>
                      {r.is_test ? "工程测试 · " : ""}
                      {r.courseTitle || "The Candy Quest"} ·{" "}
                      {new Date(r.created).toLocaleString()} ·{" "}
                      {r.completed ? "查看已完成课程" : "继续未完成课程"} →
                    </button>
                  ))}
                </section>
              )}
            </>
          ) : (
            <>
              <section className="lesson-topline">
                <div>
                  <span className="lesson-kicker">HFF · UNIT 5</span>
                  <h1>{run.title}</h1>
                </div>
                <div className="lesson-progress-label">
                  已完成{" "}
                  {
                    run.progress.filter((p: any) => p.status === "complete")
                      .length
                  }{" "}
                  / {run.items.length}
                  <progress
                    value={
                      run.progress.filter((p: any) => p.status === "complete")
                        .length
                    }
                    max={run.items.length}
                  />
                </div>
              </section>
              {report ? (
                <Report
                  data={report}
                  parent={parent}
                  runId={run.id}
                  refresh={() =>
                    act(async () => {
                      await openRun(run.id);
                      setReport(await api(`/runs/${run.id}/report`));
                    })
                  }
                  close={() => setReport(null)}
                />
              ) : run.completed && !item ? (
                <section className="lesson-complete">
                  <span>✦</span>
                  <h2>今天的探险完成了！</h2>
                  <p>本课练习已结束，已掌握和待练习的内容都记在报告里。</p>
                  <button className="lesson-primary" onClick={fetchReport}>
                    看看我的学习报告 →
                  </button>
                </section>
              ) : (
                <div className="lesson-workspace">
                  <aside className="lesson-steps" ref={stepsPanel}>
                    {run.items.map((i: any, n: number) => (
                      <button key={i.id} disabled={busy} onClick={() => navigateTo(n)} aria-current={n === at ? "step" : undefined} className={n === at ? "active" : ""}>
                        <span>
                          {run.progress[n].released ? "↪" : run.progress[n].status === "complete" ? "✓" : n + 1}
                        </span>
                        <div>
                          {i.title}
                          <small>{domainLabels[i.domain as Domain]}</small>
                        </div>
                        <b>
                          {run.progress[n].released ? "待练习" : run.progress[n].status === "complete"
                            ? rounded(run.progress[n].combined)
                            : run.progress[n].status === "locked"
                              ? "锁定"
                              : ""}
                        </b>
                      </button>
                    ))}
                  </aside>
                  <section className="lesson-stage" key={item?.id}>
                    {item && (
                      <>
                        <div className="lesson-stage-head">
                          <span className="lesson-pill">
                            {domainLabels[item.domain as Domain]}
                          </span>
                          <span>
                            目标 {at + 1} / {run.items.length}
                          </span>
                        </div>
                        {phase === "lecture" && item.lecture.length > 0 ? (
                          <>
                            <video
                              ref={video}
                              key={item.lecture[clip]}
                              controls
                              autoPlay
                              controlsList="nofullscreen"
                              playsInline
                              preload="auto"
                              src={media(item.lecture[clip])}
                              onLoadedMetadata={(event) => {
                                if (
                                  video.current &&
                                  run.position?.itemId === item.id &&
                                  run.position.clip === clip
                                )
                                  video.current.currentTime = Math.min(
                                    run.position.seconds,
                                    video.current.duration || 0,
                                  );
                                void startLecture(event.currentTarget);
                              }}
                              onPlay={() => setAutoplayBlocked(false)}
                              onTimeUpdate={() => {
                                if (Date.now() - saving.current > 3000) {
                                  saving.current = Date.now();
                                  api(
                                    `/runs/${run.id}/position`,
                                    {
                                      itemId: item.id,
                                      clip,
                                      seconds: video.current?.currentTime || 0,
                                    },
                                    "PUT",
                                  ).catch(() => {});
                                }
                              }}
                              onEnded={() => {
                                if (clip + 1 < item.lecture.length)
                                  setClip(clip + 1);
                                else {
                                  setPhase("question");
                                  play(item.promptAudio);
                                }
                              }}
                            />
                            {autoplayBlocked && (
                              <button
                                className="lesson-primary"
                                onClick={() => {
                                  if (video.current)
                                    void startLecture(video.current);
                                }}
                              >
                                浏览器需要一次点击来开启声音
                              </button>
                            )}
                            <p className="lesson-subtle">
                              先听老师讲解。讲解结束后，轮到你来回答。
                            </p>
                          </>
                        ) : (
                          <>
                            <h2>{item.title}</h2>
                            <p className="lesson-question">{item.prompt}</p>
                            {item.image && (
                              <img
                                className="lesson-illustration"
                                alt="Story illustration"
                                src={media(item.image)}
                              />
                            )}{" "}
                            {item.images?.length > 0 && (
                              <div
                                className={
                                  item.images.length > 1
                                    ? "lesson-picture-grid"
                                    : ""
                                }
                              >
                                {item.images.map(
                                  (file: string, index: number) => (
                                    <img
                                      key={file}
                                      className="lesson-illustration"
                                      src={media(file)}
                                      alt={`Story picture ${index + 1}`}
                                    />
                                  ),
                                )}
                              </div>
                            )}
                            {item.displayText && (
                              <blockquote>{item.displayText}</blockquote>
                            )}
                            {phase === "feedback" && progress?.evaluation && (
                              <div
                                className={
                                  "lesson-feedback " +
                                  (progress.evaluation.goalMet ? "success" : "")
                                }
                              >
                                <h3>
                                  {progress.evaluation.goalMet
                                    ? "完成了这个小目标！"
                                    : progress.evaluation.outcome ===
                                        "unavailable"
                                      ? "服务暂不可用"
                                      : progress.evaluation.outcome ===
                                          "uncertain"
                                        ? "这次还需要听清楚"
                                        : "再练一次，你可以的"}
                                </h3>
                                <p>{progress.evaluation.reason}</p>
                                <div className="lesson-score-row">
                                  <span>
                                    首答 <b>{rounded(progress.first)}</b>
                                  </span>
                                  <span>
                                    订正 <b>{rounded(progress.final)}</b>
                                  </span>
                                  <span>
                                    本题得分 <b>{rounded(progress.combined)}</b>
                                  </span>
                                </div>
                                {progress.evaluation.transcript && (
                                  <p>
                                    {item.kind === "choice"
                                      ? "你的选择"
                                      : "听到的回答"}
                                    ：
                                    {answerText(
                                      item,
                                      progress.evaluation.transcript,
                                    )}
                                  </p>
                                )}
                              </div>
                            )}
                            {progress?.first !== null &&
                              progress?.status !== "complete" && (
                                <div className="lesson-hint">
                                  <strong>Try this</strong>
                                  <p>
                                    {progress.attempts <= 1
                                      ? item.hintText
                                      : progress.attempts === 2
                                        ? item.modelText
                                        : item.scaffoldText}
                                  </p>
                                </div>
                              )}
                            <div className="lesson-answer-area">
                              {progress?.status === "complete" ? (
                                <button
                                  className="lesson-primary"
                                  onClick={next}
                                >
                                  {nextLessonIndex(run.progress, at) < 0 ? "查看课程报告 →" : at === run.items.length - 1 ? "继续未完成的题目 →" : "继续下一段 →"}
                                </button>
                              ) : (
                                <>
                                  {item.kind === "choice" ? (
                                    <>
                                      <div className="lesson-options">
                                        {item.choices.map((c: any) => (
                                          <button
                                            disabled={busy}
                                            aria-pressed={choice === c.id}
                                            className={
                                              choice === c.id ? "selected" : ""
                                            }
                                            key={c.id}
                                            onClick={() => setChoice(c.id)}
                                          >
                                            <span>{c.id}</span>
                                            {c.text}
                                          </button>
                                        ))}
                                      </div>
                                      <button
                                        className="lesson-primary"
                                        disabled={!choice || busy}
                                        onClick={() => submit({ choice })}
                                      >
                                        {busy
                                          ? "老师正在看你的答案…"
                                          : "提交我的答案 →"}
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      className={
                                        "lesson-mic " +
                                        (recording ? "recording" : "")
                                      }
                                      disabled={busy}
                                      onClick={() =>
                                        recording
                                          ? recorder.current?.stop()
                                          : startRecording()
                                      }
                                    >
                                      {recording
                                        ? `■ 说完了 · ${seconds}s`
                                        : busy
                                          ? "正在认真听你的回答…"
                                          : "🎙 点击麦克风，开始回答"}
                                    </button>
                                  )}
                                  <p className="lesson-subtle">
                                    {recording
                                      ? (item.kind === "speak" ? "说完后点击“说完了”提交，最多录制30秒，思考停顿不会提前结束。" : "说完后可以点击停止，停顿4秒后自动提交，最多录制30秒。")
                                      : "这道题需要亲自完成。可以暂停休息，回来后继续。"}
                                  </p>
                                </>
                              )}
                              <button
                                className="lesson-secondary"
                                disabled={recording || busy}
                                onClick={() =>
                                  play(
                                    phase === "feedback" && progress?.feedback
                                      ? progress.feedback
                                      : item.promptAudio,
                                  )
                                }
                              >
                                ▶ 播放老师声音
                              </button>
                              <button
                                className="lesson-secondary"
                                disabled={recording || busy}
                                onClick={() => {
                                  speaker.current?.pause();
                                  video.current?.pause();
                                  setError(
                                    "课程已暂停，进度已保留。回来后继续完成当前题目。",
                                  );
                                }}
                              >
                                暂停休息
                              </button>
                              <button
                                className="lesson-secondary"
                                disabled={recording}
                                onClick={() => act(() => openRun(run.id))}
                              >
                                刷新保存状态
                              </button>
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && (
        <div className="lesson-error" role="alert">
          {error}
          <button aria-label="关闭提示" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <footer className="lesson-footer">
        一步一步学会 · 每一次认真尝试都有记录
      </footer>
    </main>
  );
}
function Report({
  data,
  parent,
  runId,
  refresh,
  close,
}: {
  data: any;
  parent: boolean;
  runId: string;
  refresh: () => void;
  close: () => void;
}) {
  const [editing, setEditing] = useState<any>(null),
    [transcript, setTranscript] = useState(""),
    [reason, setReason] = useState(""),
    [assistance, setAssistance] = useState(false),
    [observed, setObserved] = useState(false),
    [criteria, setCriteria] = useState<Record<string, boolean>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState("");
  const review = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/parent/review/${editing.attempt.id}`, {
        transcript,
        reason,
        assistance,
        observed,
        criteria: editing.item.rubric.map((r: any) => ({
          id: r.id,
          met: !!criteria[r.id],
        })),
      });
      setEditing(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="lesson-report">
      <div className="lesson-report-toolbar">
        <button onClick={close}>← 返回课堂</button>
        {parent && (
          <button
            onClick={() => {
              const details = Array.from(document.querySelectorAll("details"));
              const previous = details.map((d) => d.open);
              details.forEach((d) => (d.open = true));
              window.print();
              details.forEach((d, n) => (d.open = previous[n]));
            }}
          >
            打印 / 保存为 PDF
          </button>
        )}
      </div>
      <span className="lesson-kicker">LEARNING REPORT</span>
      {data.testOnly && (
        <p className="lesson-warning">
          工程测试样例：用于核验流程，不代表孩子的学习表现。
        </p>
      )}
      <h2>{data.complete ? "我的课堂收获" : "课堂进行中"}</h2>
      <p>{data.title}</p>
      <div className="lesson-total">
        {data.complete ? rounded(data.total) : "—"}
        <small>
          {data.complete ? "课程总分 / 100" : "全部必答题完成后生成总分"}
        </small>
      </div>
      <p>
        已完成 {data.completedItems} / {data.totalItems} 题 · 首答70% ＋ 订正30%
      </p>
      {data.unscoredItems?.length > 0 && <p className="lesson-hint">本课有 {data.unscoredItems.length} 题未能可靠评分，已允许继续，不算答错，也不虚构总分。可课后再练：{data.unscoredItems.map((x: any) => x.title).join("、")}。</p>}
      <div className="lesson-dimensions">
        {data.dimensions.map((d: any) => (
          <article key={d.id}>
            <h3>{d.label}</h3>
            <strong>{rounded(d.score)}</strong>
            <progress value={d.score || 0} max={100} />
            <p>
              首答 {rounded(d.first)} → 订正 {rounded(d.final)}
            </p>
            <small>{d.observations} 次观察 · 权重25%</small>
          </article>
        ))}
      </div>
      <h3>接下来值得练一练</h3>
      {data.findings.length ? (
        data.findings.map((f: any) => (
          <div className="lesson-finding" key={f.id}>
            <strong>{f.label}</strong>
            <span>{f.level}</span>
            <p>
              依据：{f.observations}道任务中，{f.difficulties}次首答未充分掌握，
              {f.assisted}次在支持后完成。
            </p>
          </div>
        ))
      ) : (
        <p>当前没有足够证据标记薄弱点，后续课程继续观察。</p>
      )}
      <h3>课后小练习</h3>
      {data.practice.map((p: any) => (
        <article className="lesson-practice" key={p.objectiveId}>
          <h4>{p.title}</h4>
          <ol>
            {p.steps.map((s: string, n: number) => (
              <li key={n}>{s}</li>
            ))}
          </ol>
          <p>
            <b>练到什么程度：</b>
            {p.success}
          </p>
          {parent && data.complete && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api(`/runs/${runId}/practice`, {
                    objectiveId: p.objectiveId,
                    note,
                  });
                  setNote("");
                  refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <input
                aria-label="课后练习观察"
                placeholder="家长记录本次练习表现（不改变原成绩）"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button disabled={!note.trim()}>保存练习记录</button>
            </form>
          )}
        </article>
      ))}
      {parent && (
        <>
          <h3>逐题记录与复核</h3>
          {data.items?.map((i: any) => (
            <details key={i.id} open={i.progress.status === "review"}>
              <summary>
                {i.title} · 首答 {rounded(i.progress.first)} / 本题得分{" "}
                {rounded(i.progress.combined)} ·{" "}
                {i.progress.status === "complete"
                  ? (i.progress.released ? (i.progress.releaseReason === "unscored" ? "三次未能可靠识别，已继续；未评分" : "三次未答对，已继续；待练习") : "目标已完成")
                  : i.progress.status === "locked"
                    ? "尚未开始"
                    : "待完成"}
              </summary>
              <p>{i.objective}</p>
              {i.attempts.map((a: any) => (
                <div className="lesson-attempt" key={a.id}>
                  <p>
                    {new Date(a.created).toLocaleString()} ·{" "}
                    {assessmentLabels[a.evaluation?.outcome || a.state] ||
                      "待核对"}{" "}
                    · {rounded(a.evaluation?.score)}分{" "}
                    {a.reviewed ? "· 家长已复核" : ""}
                  </p>
                  <p>
                    {answerText(i, a.evaluation?.transcript) ||
                      "无可靠回答记录"}{" "}
                    / {a.evaluation?.reason || "服务中断，未评分"}
                  </p>
                  {a.hasAudio && (
                    <audio
                      controls
                      src={`/api/interactive/parent/audio/${a.id}`}
                    />
                  )}
                  <button
                    onClick={() => {
                      setEditing({ item: i, attempt: a });
                      setTranscript(a.evaluation?.transcript || "");
                      setReason("");
                      setCriteria({});
                      setAssistance(false);
                      setObserved(false);
                    }}
                  >
                    复核这次真实作答
                  </button>
                </div>
              ))}
            </details>
          ))}
          {data.reviews?.length > 0 && (
            <>
              <h3>家长复核记录</h3>
              {data.reviews.map((r: any) => (
                <p key={r.id}>
                  {new Date(r.created).toLocaleString()} · {r.reason} ·
                  已保留原评估依据
                </p>
              ))}
            </>
          )}
          {data.practiceHistory?.length > 0 && (
            <>
              <h3>课后练习记录</h3>
              {data.practiceHistory.map((p: any) => (
                <p key={p.id}>
                  {new Date(p.created).toLocaleString()} · {p.note}
                </p>
              ))}
            </>
          )}
          {editing && (
            <div className="lesson-review-form">
              <h3>复核：{editing.item.title}</h3>
              <label>
                孩子实际说了什么
                <input
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>按标准逐项核对</legend>
                {editing.item.rubric.map((r: any) => (
                  <label key={r.id}>
                    <input
                      type="checkbox"
                      checked={!!criteria[r.id]}
                      onChange={(e) =>
                        setCriteria({ ...criteria, [r.id]: e.target.checked })
                      }
                    />
                    {r.label}（{r.weight}分{r.required ? "，关键要求" : ""}）
                  </label>
                ))}
              </fieldset>
              <label>
                <input
                  type="checkbox"
                  checked={assistance}
                  onChange={(e) => setAssistance(e.target.checked)}
                />
                这次作答经过家长帮助（仅核听评分不勾选）
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={observed}
                  onChange={(e) => setObserved(e.target.checked)}
                />
                我已经实际听到或观察到孩子完成作答
              </label>
              <label>
                评分依据
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                disabled={
                  busy ||
                  !observed ||
                  !transcript.trim() ||
                  reason.trim().length < 3
                }
                onClick={review}
              >
                保存有依据的复核结果
              </button>
              <button onClick={() => setEditing(null)}>取消</button>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <p className="lesson-report-note">{data.disclaimer}</p>
    </section>
  );
}
