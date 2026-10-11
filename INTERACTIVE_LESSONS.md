# 必答互动英语课堂

公开源码不包含作者的课程包、录音或学生记录；新部署需导入自己的课程。配置入口见 [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md)。

入口 `/#/learn`，复用白板应用，原视频编辑与分享入口保持原路由。课程视频及互动音频在制作时生成，课堂实时 Gemini TTS 请求为零。

## 课程制作和导入

`shared/interactive.ts` 是版本化 `course.json` 的运行时校验标准。每课至少8题，四个维度各至少2题，每道题必须有目标、评分量规、提示/示范/反馈、练习方向和资产哈希。题目 source 来自实际渲染 trace，先切 MP4，再加入问题；不是按预计语速插暂停。

`npx tsx script/interactive/import-course.ts <课程包目录> [数据目录]` 先校验全部文件的大小、SHA256、文件名，再原子导入。相同版本不可覆盖。部署时 `course-bundles/` 是私有种子包；启动后校验并复制到持久化卷。不要把录音、数据库、访问口令或原始长音频放进此目录。添加课程后必须导出新版本。

`productionQa.status=draft` 的课程只能在家长解锁后预览（15分钟）；正式课程为 reviewed。不能仅因软件测试通过就改成 reviewed。Candy Quest 目前复用原视频，原 ate 示范清晰度问题仍待修订；新增 eat/ate 示范通过声学评估，但仍需儿童声音校准。

## 状态和评分

服务器只允许当前未完成题提交。锁定后续音视频；幂等 requestId 防止重复计费；一个课程记录同一时间只有一个评估请求。刷新、退出、断线不跳题。服务器重启后的处理中请求标记中断，不自动重发。

每题首个可靠评分占70%，最终订正占30%；达成目标单独控制解锁。低首答不会导致永远无法通过。无可靠转写/声学证据不打分；服务故障不计孩子作答次数。五次自动评估后必须家长复核实际作答；不是自动放行。家长须填写逐项量规、实际回答、依据和是否提供帮助。原评估保存在 reviews 审计中。课后练习只追加日志，不修改原分数。

四个维度各25%；全部题目完成才给总分。报告区分首答/订正、独立/有支持完成。一次错误标记待观察；至少两次同目标困难才列优先练习。练习推荐来自实际困难题的量规，不根据宽泛的人格或能力标签推断。

## 配置和数据

私有服务端 `.env`：`AZURE_SPEECH_KEY`、`AZURE_SPEECH_REGION`、`PERPLEXITY_API_KEY`；家庭访问另设 `INTERACTIVE_FAMILY_PASSWORD`、`INTERACTIVE_PARENT_PIN`、至少32字符的 `INTERACTIVE_SESSION_SECRET`。不要在公开文档或客户端内放这些值。

`INTERACTIVE_DATA_DIR` 内保存 interactive.db、courses、review-audio。Railway 挂载 `/app/interactive-data`，单副本SQLite，扩容前需改为共享数据库。成功普通录音不落盘；争议/服务失败的有效音频保存供家长复核，复核后删除，最长7天。答案文本和评分依据保留。家长应知晓音频会发往 Azure，需语义判断时转写文本会发往 Perplexity。

每日硬上限默认 Azure100次/1800秒、语义判断30次，每题最多5次自动评估；失败请求也计入提供方调用预算。可以通过 INTERACTIVE_AZURE_DAILY_CALLS / INTERACTIVE_SEMANTIC_DAILY_CALLS 下调。不是提供方承诺的账号额度。

## 评分证据及局限

朗读：Azure短语音REST，句子完整度+重点词分数，eat / ate 另核对重点元音。转写一致不等于发音正确；边界值进入不确定状态。表达：高置信转写先匹配确定答案，再按固定量规调用一次语义模型，模型不能直接设置最终分数。服务器按量规计算分数。没有可靠答案不得自动通过。

官方参考：https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-speech-to-text-short
https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment

## 验证

`npm run check`、`npx tsx --test server/interactive/*.test.ts`、`npm run build`。

`script/interactive/probe-*.ts` 和 `qa-real-course.ts` 是有硬预算/落盘账本的真实接口验证，仅人工明确启动；不得纳入日常CI或自动重试。产物在 output/interactive-qa。测试课程记录标识 is_test，不能冒充孩子成绩。

浏览器自动化验证桌面及窄屏布局、视频切换、答错后订正、继续下一题和报告/PDF。预录音频验证不等于麦克风/儿童实测；iPad Safari 麦克风、打断恢复及真实儿童误判率仍需实机验收。iOS原生版另属下一阶段，Xcode当前许可未确认，未构建或签发TestFlight。


作者的私有部署曾按使用要求设置 INTERACTIVE_PASSWORDLESS=true，课堂和家长区直接访问；公开仓库示例默认 false。必答顺序、作答证据、复核与评分规则仍由服务器执行。false 时恢复原有口令访问。


2026-10-01：仅保留一个教学方案，正式题目和提问音频全英文，帮助/示范/拆解/没听清提示为中英文穿插的 Gemini Sulafat 配音，提示文字与语音一致。1.1.0-preview 仅升级提示；自动迁移未完成的1.0.0记录，保留题目、量规、分数和位置，并记录 course_upgrades 审计。已完成记录保留原版本。每段视频自动有声播放，NotAllowedError 才显示开启声音提示。
