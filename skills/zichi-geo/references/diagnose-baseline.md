# diagnose-baseline — GEO 基线诊断

> 状态：首期本地闭环已实现。当前提供受控人工录入适配器；API/浏览器适配器可后接同一 Probe 契约。不得把网页摸底或旧问题库冒充正式诊断。

## 目标

回答“当前各 AI 平台怎样理解、提及、推荐这家公司”，形成场景策略的诊断缺口，而不是直接生成正式关键词库。

## 前置条件

- `manifest.gates.clean.status = confirmed`
- 存在不可变 `fact_snapshot_id`
- 未确认事实、旧 `company.keywords.json` 和文章计划不得作为正式诊断输入

## 输入与输出

| 输入 | 输出 |
|---|---|
| 已确认企业事实快照 | 小规模、可复核的 baseline seed set |
| 已确认种子题 | 多平台 probe run 与原始回答快照 |
| probe 结果 | 透明指标、客户可读报告、结构化 diagnosis gaps |

## 操作流程

### 1. 检查清洗闸门

先读取 `manifest.json`。只有 `gates.clean.status=confirmed` 且指向当前 v2 `fact_snapshot_id` 才能继续。不要替用户自动运行 `confirm-clean`。

### 2. 生成并复核小样本种子题

```bash
geo-cli diagnose seed-draft --project {PROJECT} --size 25
```

打开项目 `diagnosis/seed-review.md`，用普通业务语言向用户列出五类题目及其事实依据：品牌认知、产品选择、供应商能力、地区/采购、负面风险。

- 逐题 `approve`、`reject`、`edit` 或 `replace`；edit/replace 都创建替代题并保留原题，替换时必须保留事实依据。
- 可用 `seed-approve-non-risk` 批准全部非负面题。
- 负面风险题必须逐题明确批准，不得批量放行。
- 不要因为要凑到 25 条而脱离事实编题。

```bash
geo-cli diagnose seed-review --project {PROJECT} --question {ID} --action approve
geo-cli diagnose seed-review --project {PROJECT} --question {ID} --action reject
geo-cli diagnose seed-review --project {PROJECT} --question {ID} --action replace --text "新问题"
geo-cli diagnose seed-confirm --project {PROJECT}
```

种子题只用于测当前 AI 认知，不是关键词库、正式需求场景、Prompt 或文章计划。已用版本需要修改时，运行 `seed-revise --seed-set {ID}` 创建新版本，不覆盖历史版本。

### 3. 建立运行并录入探测证据

```bash
geo-cli diagnose run-create --project {PROJECT} --seed-set {SEED_SET_ID} --platforms "平台A,平台B"
geo-cli diagnose probe-ingest --project {PROJECT} --run {RUN_ID} --input {MANUAL_JSON}
```

首期使用受控人工录入：在目标 AI 平台逐题提交**精确问题**，把平台、provider、模型、时间、状态和原始回答写进录入 JSON。CLI 会把原始回答单独冻结在 `diagnosis/runs/{run_id}/raw/`。

录入项最小示例：

```json
{
  "question_id": "question_...",
  "platform": "某AI平台",
  "provider": "controlled_manual",
  "model": "实际显示的模型名",
  "status": "success",
  "answer": "完整原始回答",
  "analysis": {
    "competitors": ["回答中实际出现的竞品"]
  }
}
```

失败使用 `failed|timeout|unavailable` 并填写 `error`；绝不能填成 success + 未提及。密码、Token、API key 不得出现在录入文件。

如果 API 尚未接入，可以为计划组合写入 `unavailable` 占位并生成限制版报告，但必须向用户明确说明：这只表示“当前无法探测”，不是品牌未提及，也不是提及率 0。后续取得真实 API 或人工回答时新建 run，不在占位 run 上混入正式结果。

### 4. 生成并解释报告

```bash
geo-cli diagnose report --project {PROJECT} --run {RUN_ID}
geo-cli diagnose validate --project {PROJECT}
```

向用户展示生成的 Markdown/HTML 报告，至少解释：

- 计划探测数、实际记录数、有效数、失败数；
- 品牌提及与主动推荐是两个指标；
- Top-N 只以能观察到排名的回答为分母；
- 负面风险只以已批准负面题为分母；
- provider 失败不进入“未提及”分母；
- 引用未观察到不等于平台没有使用来源。

首期不计算不透明综合分。所有 rate 均显示 `numerator/denominator`。

### 5. 人工确认诊断

用户复核逐题证据、缺口和限制后才运行：

```bash
geo-cli diagnose confirm --project {PROJECT} --report {REPORT_ID}
```

若仍有失败项，应先重试；用户明确接受限制时才加 `--accept-limitations`。确认后 `diagnosis/gaps/{report_id}.json` 才能被阶段 3 消费。

确认全为 `unavailable` 的限制版报告，只是为了在已知信息不足时继续流程；下游只能消费“探测覆盖不足”这一缺口，不能据此生成品牌表现结论。

## 人工汇报重点

不要只报“命中率”。按顺序汇报：本次测了什么 → 哪些回答有效 → 各平台是否提及/推荐 → 竞品与引用 → 负面风险 → 失败与限制 → 哪些缺口值得阶段 3 继续研究。

## 闸门

未确认 seed set 不执行正式 probe；未确认 diagnosis report 不进入场景库。Provider 失败必须记为失败，不能算成“未提及”。

诊断报告只能产生诊断缺口，不能直接产生写作任务。任何客户的旧关键词、旧写作计划或零散网页摸底都不是正式诊断，不计入新报告指标。
