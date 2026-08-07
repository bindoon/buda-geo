# generate-articles — 生成文章草稿

> 状态：已实现。CLI 管理确定性写作包、来源与安全校验；Skill/本地 Agent 负责语义写作。本阶段只生成 draft。

## 目标

根据已确认任务生成有事实依据、可审阅的草稿，不直接发布。

## 前置条件与硬边界

- 已确认 content plan/task
- 任务绑定已确认 scenario/question 与 `fact_snapshot_id`
- 渠道为 `social | media | b2b | site`
- 只允许任务 `allowed_fact_ids` 对应的 confirmed public facts；不要读取整个知识库自由发挥。
- 密码、Token、身份证、restricted/internal 资料不得进入写作包、正文或 meta。
- `research_only` 只能写核验方法和待确认条件，不能暗示企业具备缺口能力。
- 不调用竞品平台、不上传 OSS、不写 publish，不把 draft 说成 approved/published。

## 可执行流程

### 1. 准备稳定写作包

```bash
geo-cli article prepare --project {PROJECT}
geo-cli article status --project {PROJECT}
```

可用 `--task {TASK_ID}` 或 `--limit 3` 先做小样。每个 task 按 quantity 展开稳定 article slot，输出：

- `articles/work/{article_id}.brief.json`：自足的事实、配图 allowlist、问题、目标和约束；
- `articles/work/{article_id}.prompt.md`：给 Agent 的人类可读写作指令；
- `articles/draft-review.md`：planned/prepared/drafted/missing 清单。

重复 prepare 返回相同 article IDs，不复制任务，也不覆盖已有稿件。需要补配图或刷新写作包时用 `--force`（只重写 brief/prompt，不动已有 draft）。

配图来自 `company.skus.json`：与任务 `allowed_fact_ids` 有 `fact_refs` 交集的 SKU 图片进入 `allowed_images`（最多 6 张，本地 `assets/images/...` path）。图片不是 Fact，也不上传 OSS。

### 2. Agent 按 brief 写 Markdown

每次只加载目标 `.brief.json` 和 `.prompt.md`。写作时：

1. 先回答 brief 的核心问题，再展开选择/核验维度。
2. 只使用 `allowed_facts`，不要补充来源不明的规模、销量、交期、排名或能力。
3. 若 `allowed_images` 非空，正文必须插入 1–3 张图，且只用 brief 给出的 `markdown_path`；禁止外链或改文件名。
4. 按 channel 调整表达，但不通过换标题制造近义稿件。
5. 记录正文实际使用的 Fact IDs；未使用的事实不要虚报。
6. research-only 必须出现“是否、需要确认、核验、未确认、不能据此推断”等边界表达。

### 3. 通过 CLI ingest

```bash
geo-cli article ingest \
  --project {PROJECT} \
  --article {ARTICLE_ID} \
  --input /path/to/draft.md \
  --title "文章标题" \
  --used-facts fact_x,fact_y
```

可选 `--used-images assets/images/...`；默认从正文 Markdown 图片引用解析。成功后写入：

- `articles/{channel}/{article_id}.md`；
- `articles/{channel}/{article_id}.meta.json`。

meta 固定记录 content plan/task/topic/FAQ/scenario/question/fact snapshot、正文 SHA-256、字符数、实际事实、实际配图、风险和 `requires_human_review: true`。状态只能是 `draft`。

### 4. 修订而不是覆盖

```bash
geo-cli article revise --project {PROJECT} --article {ARTICLE_ID} --input revised.md --reason "修改理由"
```

修订写入 `articles/revisions/{article_id}/vN.md`，保留 v1 和 lineage。

### 5. 校验并汇报

```bash
geo-cli article validate --project {PROJECT}
geo-cli article status --project {PROJECT}
```

向用户展示 `articles/draft-review.md`：每篇标题、channel、正文路径、实际使用事实内容、字符数、模式、风险，以及尚未生成的 article slots。之后路由到 `review-articles.md`，不得直接发布。

## 晶铭样板

- confirmed content plan：`content_plan_3d816a873a076300`；
- 已准备 24/24 个 writing briefs；
- 首批生成 3 篇 draft：企业认知 media、产品选购 b2b、单件定制核验型 social；
- 单件定制稿明确区分混批、试单和定制，不声明晶铭支持单件定制；
- 其余 21 篇只显示为 missing，不冒充生成或发布。
