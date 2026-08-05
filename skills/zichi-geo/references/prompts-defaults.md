# 默认 prompts / generation_plan

## prompts（`company.prompts.json`）

clean 写入两套默认模板（`source: default_template`）：

1. `eeat_intro_advantage_faq` — 介绍 + 优势 + 推荐理由 + FAQ  
2. `eeat_industry_advantage_qa` — 产业要点 + 介绍 + 优势 + QA  

有客服/询盘记录后：

- 从高频异议生成 `company.faq.json` items，`status: from_chat`
- 按真问题增补 `generation_plan.tasks`（绑定 `keyword_group_id`）
- 可将 prompts `source` 改为 `default_template+chat`

## generation_plan

- clean 可按 search 主词生成若干 draft tasks（`use_knowledge: true`，`produced_count: 0`）
- 也可 `tasks: []`，由运营后再开 write
- 年配额目标写在 `manifest.quota.targets`，计数由后续 write/publish 更新
