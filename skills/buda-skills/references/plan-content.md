# plan-content — 内容策略与生产计划

> 状态：已实现。输入是已确认事实、诊断和场景库；输出是内容计划，不生成 FAQ 答案或文章正文。

## 这一步解决什么

把“客户会问什么”整理成一批可执行、可复核的写作任务。四类对象各司其职：

| 对象 | 普通理解 | 不是什么 |
|---|---|---|
| FAQ candidate | 准备回答的客户问题 + 回答目标 | 不是已写好的答案 |
| content topic | 一组问题共同服务的单一业务目标；用户主要复核它 | 不是要求一篇文章塞入场景全部字段 |
| prompt recipe | 写作时必须遵守的事实、结构和渠道约束 | 不是自由添加卖点的提示词 |
| production task | 哪个主题、投哪个 channel、写几条、用哪些事实 | 不是文章正文或发布任务 |

例如“儿童芭蕾 tutu 裙怎么选”和“适合哪些使用场景”可归入“产品选择与适用场景”主题，再分别生成 social、b2b 渠道任务。它们共享核心事实，但渠道写法不同。

## 硬前置与边界

- `manifest.gates.clean`、`diagnose`、`scenario` 必须全部 `confirmed`，且事实快照、诊断报告、场景库 ID/version 完全对应。
- 只允许 confirmed + public facts。restricted/internal、密码、Token、身份证等字段即使被误标 public 也必须排除。
- high evidence gap 默认阻断事实型任务；不得根据相近事实补造能力。
- channel 只能是 `social | media | b2b | site`，不出现任何竞品平台路由或导出格式。
- 本阶段只写 `strategy/`；不得修改 `inputs/`、`knowledge/`、confirmed scenario library，也不得创建 `articles/`。

## 执行顺序

### 1. 生成草稿

```bash
geo-cli plan generate --project {PROJECT} --quota 30
geo-cli plan validate --project {PROJECT}
```

生成：

- `strategy/content-plan-draft.json`：完整机器契约；
- `strategy/content-plan-review.md`：普通用户确认入口；
- `manifest.gates.content_plan.status = review_required`。

`--quota` 是本批上限，不是必须凑满的指标。独立且有事实支撑的任务不足时，计划量可以更少。

### 2. 向用户展示复核单

优先展示 `content-plan-review.md`，逐个 Topic 说明：

- 服务对象和单一目标；
- 准备回答的问题；
- 实际可使用的公开确认事实内容及 Fact ID；
- 禁止外推的声明；
- channel、内容形式、数量和渠道理由；
- 证据阻断项与语义合并建议。

不要要求普通用户先读 JSON，也不要只汇报“引用了几条 Fact”。

### 3. 批准、修改或延期

无阻断项的主题可批量批准：

```bash
geo-cli plan approve-ready --project {PROJECT}
```

单个 Topic：

```bash
geo-cli plan review --project {PROJECT} --topic {TOPIC_ID} --action approve --note "理由"
geo-cli plan review --project {PROJECT} --topic {TOPIC_ID} --action defer --note "理由"
geo-cli plan review --project {PROJECT} --topic {TOPIC_ID} --action reject --note "理由"
geo-cli plan review --project {PROJECT} --topic {TOPIC_ID} --action edit --input topic-patch.json --note "修改理由"
```

调整优先级或批次数量必须记录操作者与理由：

```bash
geo-cli plan priority-override --project {PROJECT} --topic {TOPIC_ID} --score 24 --actor operator --reason "首批重点"
geo-cli plan task-override --project {PROJECT} --task {TASK_ID} --batch 2 --quantity 2 --actor operator --reason "增加渠道变体"
```

### 4. 处理事实缺口和合并建议

阻断项可 `resolve | defer | accept | research-only`：

```bash
geo-cli plan gap-review --project {PROJECT} --blocker {BLOCKER_ID} --action research-only --reason "只写核验方法，不声明企业具备该能力"
```

`research-only` 只允许写“采购方应核验什么、如何判断”，Prompt 仍保留 forbidden claims。改完后还要批准对应 Topic。

语义近似项只生成建议，必须人工决定：

```bash
geo-cli plan merge-review --project {PROJECT} --suggestion {SUGGESTION_ID} --action approve --reason "同一问题，保留标准问法"
```

### 5. 确认版本

```bash
geo-cli plan confirm --project {PROJECT}
geo-cli plan validate --project {PROJECT}
```

确认要求：所有 Topic 已处置、所有 merge suggestion 已复核、没有 open blocker、每个 planned task 都有事实 allowlist、单一目标和 channel 理由。确认后生成：

- `strategy/content-plans/{content_plan_id}.json`：不可变 v1；
- `strategy/content-plan.md`：已确认业务报告；
- `manifest.gates.content_plan.status = confirmed`。

只有这个确认版本中的 `planned + ready/research_only + approved` 任务可交给文章生成阶段。

需要修改确认版本时，不覆盖历史文件：

```bash
geo-cli plan revise --project {PROJECT} --content-plan {CONTENT_PLAN_ID}
```

## 旧资产迁移

旧 FAQ、prompts、keywords、generation plan 只能做来源审计：

```bash
geo-cli plan import-legacy --project {PROJECT} --input {OLD_JSON}
```

结果写入 `strategy/legacy/content-audit.{json,md}`，不会直接变成正式计划。旧 brand/search/qa/intent 分桶和旧卖点不得绕过场景、事实核验与人工确认。

## 晶铭样板的已确认处理

- 上游场景库：`scenario_library_1a7ecebdcb0b2177` v1；
- 内容计划：`content_plan_3d816a873a076300` v1；
- 5 个场景、15 个 FAQ 归并为 12 个单一目标主题和 24 个渠道任务；
- “单件定制”保留 2 个 research-only 任务，只讨论需要向厂家确认的条件，不声明晶铭支持单件定制；
- 当前诊断没有有效回答，因此诊断表现分为 0，计划明确继承 API 不可用限制。
