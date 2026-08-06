# 知识库 Schema（A–F）

> 单项目根：`projects/{项目名}/`。所有 JSON 根字段含 `app_id`。  
> 配图先本地 `path`；`url` 可选（publish/CDN 时再填）。法人身份证：**忽略，不入库**。

## 目录

```
knowledge/
  company.baseinfo.json
  company.profile.json
  company.skus.json
  company.keywords.json
  company.faq.json
  company.prompts.json
  company.generation_plan.json
assets/images/{_company|_trust|{sku_or_category}}/
manifest.json
```

机器校验：`packages/geo-cli/schemas/*.schema.json`（由 `geo-cli validate` 加载）

---

## A · `company.baseinfo.json`（名片）

硬数据：谁、怎么联系、发到哪。**不写长介绍。**

| 字段 | 必填 | 说明 |
|------|------|------|
| `app_id` | ✓ | 租户短码 |
| `company_name` | ✓ block | 全称 |
| `company_short_name` | | **品牌简称**（如「晶铭服饰」），不要填广告长句 |
| `contact_name` | | 联系人 |
| `contact_phone` | | 电话 |
| `address` | | 地址 |
| `website_or_shop_url` | ✓ block（与官网二选一有值即可） | 1688/官网 |
| `region` | | 推广地区备注 |
| `media_accounts[]` | | `{platform, account_id}` **无 password** |
| `conversion` | | CTA：`phone` / `shop_url` / `notes` |
| `credentials[]` | | `{type, path}`；**不含 legal_id** |

## B · `company.profile.json`（介绍文案）

叙事内容，供写文引用。**禁止**再堆电话/链接（见 `baseinfo-vs-profile.md`）。

| 字段 | 说明 |
|------|------|
| `intro` | 公司是谁、体量；建议 150–400 字（过短 → block） |
| `products_services` | 品类与服务政策（起批/定制/发货/售后） |
| `advantages` | 差异化优势（勿留空把全文塞进 intro） |
| `trust` | 资质、口碑、案例 |
| `pain_points[]` | 客户/行业痛点短句 |
| `source` | 如 `docx:…知识库.docx` |

缺失提示：`profile_sections_thin`（优势/背书空）、`profile_contact_leak`（画像里漏出联系方式）。

建议 `intro` 清洗后 ≥ 100 字，否则 `missing` severity=`block` code=`profile_intro_short`。

## C · `company.skus.json`

```json
{
  "app_id": "...",
  "items": [
    {
      "sku_id": "sku_水管剪",
      "name": "水管剪",
      "category": "园林工具",
      "selling_points": [],
      "copy_brief": null,
      "images": [{ "path": "assets/images/水管剪/01水管剪.jpg", "role": "main", "url": null }]
    }
  ]
}
```

validate：每个 `images[].path` 相对项目根必须存在；**不要求** `url`。

## D · `company.keywords.json`

```json
{
  "app_id": "...",
  "brand": { "terms": [], "questions": [] },
  "search": { "terms": [], "expanded": [], "questions": [] },
  "qa": { "questions": [] },
  "intent": { "questions": [] },
  "source": "xlsx:关键词问题库.xlsx"
}
```

地区向问法进 `intent`。条目可带 `source`。

## E · `company.faq.json`

```json
{ "app_id": "...", "items": [], "status": "draft_from_profile|empty|from_chat" }
```

无客服记录时可为 `items: []`，manifest `recommend` `chat_logs`。

## F · `company.prompts.json`

多套模板，非单条：

```json
{
  "app_id": "...",
  "templates": [
    {
      "id": "eeat_intro_advantage_faq",
      "content_types": ["推荐", "科普"],
      "structure": ["公司介绍", "综合优势", "推荐理由", "FAQ"],
      "body": "..."
    }
  ],
  "source": "default_template"
}
```

## `company.generation_plan.json`

```json
{
  "app_id": "...",
  "tasks": [
    {
      "task_id": "t_demo",
      "keyword_group_id": "kg_xxx",
      "channels": ["social", "media"],
      "use_knowledge": true,
      "limit": 20,
      "produced_count": 0,
      "prompt_template_id": "eeat_intro_advantage_faq"
    }
  ]
}
```

clean 允许 `tasks: []`。

## `manifest.json`

见主方案附录 A：`gates`、`missing[]`（`code`/`severity`/`message`）、`quota`。

### missing 分级

| severity | 含义 |
|----------|------|
| `block` | 不能 `gates.clean=confirmed` |
| `recommend` | 可确认，必须提示（如 `chat_logs`） |
| `optional` | 仅记录 |

### 法人身份证

inventory 标记 `ignored: legal_id`；不复制到 assets；不进 credentials。

## 预留（write/publish，本阶段只文档化）

- 稿件 `status`：`draft | pending_review | approved | queued | published | failed`
- `channel`：`social | media | b2b | site`
- 队列字段：`article_id`、`task_id`、`channel`、`status`、`keyword_ids`、`paths`
