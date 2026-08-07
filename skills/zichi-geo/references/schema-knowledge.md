# 企业事实 Schema

单项目根：`projects/{项目名}/`。所有 JSON 的 `app_id` 必须一致。机器约束以 `packages/geo-cli/schemas/` 为准。

## 权威层与业务视图

```text
knowledge/
  source-index.json          # 原始文件索引与哈希
  company.facts.json         # 主体、事实、冲突
  clean.overrides.json       # Skill/运营的项目级语义决策
  company.baseinfo.json      # 名片视图
  company.profile.json       # 介绍文案视图
  company.skus.json          # 产品视图
  snapshots/{id}.json        # 人工确认后生成的不可变事实快照
assets/images/{_company|产品名}/
manifest.json
```

source / facts 是事实权威层；baseinfo / profile / skus 是便于人和下游使用的投影视图。keywords、FAQ、prompts、generation_plan 等旧文件不是 clean 的输出或确认依据。

## `source-index.json`

每个 input 记录：`source_id`、`path`、`kind`、`hash`、`size`、`parse_status`、`ignored`、`ignored_reason`。稳定 ID 按相对路径生成；`inputs_hash` 只由输入路径与内容哈希决定。

身份证、营业执照、商标证及注册/申请材料必须 `ignored`，只保留在原始 `inputs/`。不透明命名图片默认 ignored，只有项目 override 明确归为产品或企业素材后才可派生。

## `company.facts.json`

### subject

`subject_id`、`type`、`name`、`parent_subject_id`、`source_refs`、`review_status`。

主体类型包括 company、brand、product、product_family、capability、service、asset。

### fact

| 字段 | 含义 |
|---|---|
| `fact_id` | 由主体、字段和值生成的稳定 ID |
| `subject_id` / `field` / `value` | 谁的什么事实及其值 |
| `source_refs` | 支持该候选的原始来源 |
| `derivation` | `extracted` / `inferred` / `operator` / `legacy` |
| `confidence` | 0–1，仅辅助复核 |
| `review_status` | `candidate` / `confirmed` / `rejected` / `needs_clarification` |
| `disclosure_level` | `public` / `restricted` / `internal` |

同字段多来源不同值进入 `conflicts[]`，保留所有候选，不静默覆盖。

## 三个业务视图

### baseinfo：名片

公司名、简称、联系人、电话、地址、官网/店铺、媒体账号、转化联系方式。密码字段禁止；联系方式不要再写入 profile。

### profile：介绍文案

`intro`、`products_services`、`advantages`、`trust`、`pain_points[]`、`source`、`fact_refs`。必须按语义拆桶；关键词行、联系电话和网址不是介绍正文。

### skus：产品

每个产品至少包含：`sku_id`、人类可读 `name`、`category`、`is_main`、`attributes`、`capabilities`、`selling_points`、`source_refs`、`fact_refs`、本地 `images[].path`。

主产品只有图片而无分类和实质字段时必须 block。

## `clean.overrides.json`

`assets[]` 记录单图的 product/company/ignore 决策；`products[]` 记录产品归并、主产品、分类、属性、能力、卖点与来源图片。它是 Skill 的项目级语义输出，不得复制到通用 CLI 代码。

## `manifest.json` 与确认快照

- `gates.clean.status`: `review_required` 或 `confirmed`。
- `clean_pipeline`: `inputs_hash`、`facts_hash`、是否发生变化、上一个快照。
- `review_ready`: 无 block，可以提交人审。
- `clean_ready`: 已由人确认且存在 `fact_snapshot_id`。
- `missing[]`: `block` / `recommend` / `optional`。

无客服记录为 recommend。只有 `confirm-clean` 可生成 snapshot 并将 clean 置为 confirmed。
