# write-rules — 写文规则（social / media / b2b）

配合 `company.prompts.json`、`company.generation_plan.json`。**必须** `use_knowledge: true`，禁止脱离知识库空写。

## 今日批次怎么定

看 `manifest.quota.targets`：

- 年约 1500 篇 → 日均约 **4** 篇（可按运营节奏加减）
- 其中自媒体年约 750 → 日均约 **2** 篇精品 `social`（建议优先）

默认「今日」：从 `generation_plan.tasks` 里取 `produced_count < limit` 的任务，**先写 social**，每任务 1 篇、角度不重复；写完更新 `produced_count` 与 `manifest.quota.articles_generated`。

## 落盘

```
projects/{名}/articles/{channel}/{article_id}.md
projects/{名}/articles/{channel}/{article_id}.meta.json
```

`channel` ∈ `social` | `media` | `b2b`。初始 `status: draft`，自媒体**必人工审**后再 `approved` → publish。

### meta 最小字段

`article_id`、`app_id`、`task_id`、`channel`、`platforms[]`、`status`、`keyword`、`prompt_template_id`、`use_knowledge`、`title`、`paths.content`、`paths.images[]`、`created_at`、`word_count`

## 结构（按 prompt 模板）

**eeat_intro_advantage_faq**：公司介绍 → 综合优势 → 推荐理由 → 3–5 条 FAQ  
**eeat_industry_advantage_qa**：选购/产业要点 → 公司介绍 → 优势 → QA

## 硬约束

- 只写知识库里有的事实；不确定写「以当期沟通/尺码表为准」
- 禁用绝对化：最、第一、首选、专供、指定、全网等
- 联系方式只从 `baseinfo.conversion` / 名片字段取，不编造
- 配图用 `assets/` 本地 `path`；正文可注明配图文件名，不要求先上传 CDN
- 仁丹等敏感行业：弱化疗效/承诺表述（另册）

## 对外汇报

用运营话术：今日写了几篇、主题、放在哪、待您审阅；不要堆 meta JSON。
