# 知鱼 · 官网技术审计报告

> 本报告只描述本次对自有官网的客观采样，不替代 AI 平台 probe 诊断，也不设综合分。

- 报告时间：2026-09-07T01:49:20Z
- 事实快照：`fact_snapshot_7c19e04928e8cc09`
- 审计编号：`site_audit_a448e10561410e40`
- 目标网址：https://www.zhiyu.hk/
- 最终首页：https://www.zhiyu.hk/
- 状态：confirmed
- 综合分：未设置。红牌只作为缺口，不当总分。

## 数据质量

- 采集是否可靠：是
- 采样页：11（成功 11）
- 警告：发现的可采样 URL 不足：计划 12 页，实际 11 页
- 警告：浏览器渲染未执行；CSR 仅按原始 HTML 启发式判断，不把未检测写成通过。
- 警告：已检查 llms.txt，只记录有无，不计入红牌或优先整改。

## 红牌事实

本次采样未触发红牌。

## 检查清单

| 维度 | 检查项 | 状态 | 观察 |
|---|---|---|---|
| access | HTTPS 可达 | pass | 首页最终地址 https://www.zhiyu.hk/ |
| access | robots 未全站禁止 | pass | 未发现对 * 的整站禁止 |
| access | 主流 AI 爬虫可读取首页 | pass | 采样 UA 均拿到可读首页 |
| access | sitemap 或足够首页链接 | warn | sitemap=无，首页站内链接 11 条 |
| render | 原始 HTML 不是空壳 | undetected | 本地一期不做 Playwright 渲染；仅在原始 HTML 上做 CSR 启发式 |
| structure | Organization 结构化数据 | pass | 采样的 11 个页面中 11 页含 Organization |
| structure | FAQPage（可选） | pass | 采样的 11 个页面中 3 页含 FAQPage |
| content | 采样页有 H1 | warn | 采样的 11 个页面中 10 页缺 H1 |
| content | 采样页正文可答 | pass | 正文中位数 1128 字 |
| entity | 品牌出现在 title/H1 | pass | 采样 title/H1 出现「知鱼」 |
| access | llms.txt（只检查，不计分） | undetected | 存在 https://www.zhiyu.hk/llms.txt |

## AI 爬虫实测

| Bot | 页面 | 状态码 | 可见字数 | 是否被拦 |
|---|---|---:|---:|---|
| GPTBot | 首页 | 200 | 1751 | 否 |
| GPTBot | 内页 | 200 | 1751 | 否 |
| ChatGPT-User | 首页 | 200 | 1751 | 否 |
| ChatGPT-User | 内页 | 200 | 1751 | 否 |
| OAI-SearchBot | 首页 | 200 | 1751 | 否 |
| OAI-SearchBot | 内页 | 200 | 1751 | 否 |
| ClaudeBot | 首页 | 200 | 1751 | 否 |
| ClaudeBot | 内页 | 200 | 1751 | 否 |
| Claude-SearchBot | 首页 | 200 | 1751 | 否 |
| Claude-SearchBot | 内页 | 200 | 1751 | 否 |
| PerplexityBot | 首页 | 200 | 1751 | 否 |
| PerplexityBot | 内页 | 200 | 1751 | 否 |
| Bytespider | 首页 | 200 | 1751 | 否 |
| Bytespider | 内页 | 200 | 1751 | 否 |
| Google-Extended | 首页 | 200 | 1751 | 否 |
| Google-Extended | 内页 | 200 | 1751 | 否 |

## 结构化数据与内容

- 采样的 11 个页面中见到的 Schema 类型：Answer、Blog、BlogPosting、BreadcrumbList、CollectionPage、DefinedTerm、DefinedTermSet、FAQPage、ImageObject、ItemList、ListItem、Organization、Person、Question、UseAction、WebApplication、WebPage、WebSite
- Organization 页：11
- FAQPage 页：3
- 缺 H1 页：10
- 正文中位数：1128 字

## 结构化缺口

### LOW · site_render

未做浏览器渲染检测，不能证明页面渲染后一定可被爬虫看到。

建议调查：若官网是 SPA/模板站，应用无 JS 抓取核对正文；不要把未检测写成已通过。

### MEDIUM · site_content

采样的 11 个页面中有 10 页缺少 H1。

建议调查：给采样页补唯一、可读的 H1，避免标题重复。

## 需人工核验

- 页脚公司全称与工商主体是否一致
- 各页 NAP 是否一致
- 外部平台实体资料是否一致
- 资质和案例是否可核验

## 限制

- 结论只覆盖本次采样的 11 个页面，不能写成全站结论。
- 未采到的数据写「未检测」，不得用行业均值补齐。
- 本报告不替代种子题 + 多平台 probe 的可见度诊断。
- 浏览器渲染未执行；CSR 红牌仅在原始 HTML 启发式成立时触发。
- llms.txt 只检查，不计分，不列为优先投入。
- 首页正文可采样，内容与结构化结论可以使用。
