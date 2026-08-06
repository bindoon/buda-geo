# diagnose-baseline — GEO 基线诊断

> 状态：OpenSpec 已规划，尚未实现完整 CLI。不得把网页摸底或旧问题库冒充正式诊断。

## 目标

回答“当前各 AI 平台怎样理解、提及、推荐这家公司”，形成场景策略的诊断缺口，而不是直接生成正式关键词库。

## 前置条件

- `manifest.gates.clean.status = confirmed`
- 存在不可变 `fact_snapshot_id`
- 未确认事实、旧 `company.keywords.json` 和文章计划不得作为正式诊断输入

## 计划输入与输出

| 输入 | 输出 |
|---|---|
| 已确认企业事实快照 | 小规模、可复核的 baseline seed set |
| 已确认种子题 | 多平台 probe run 与原始回答快照 |
| probe 结果 | 透明指标、客户可读报告、结构化 diagnosis gaps |

## 计划流程

1. 从品牌、主产品、能力、受众线索和地区事实生成约 20–30 条诊断种子题。
2. 人工复核题目；种子题只用于测现状，不自动进入正式场景库。
3. 通过 API、浏览器辅助或受控人工录入执行多平台探测，逐题保留平台、模型、时间和原始回答。
4. 分开统计有效覆盖、品牌提及、主动推荐、排名、负面风险、竞品和引用来源。
5. 生成 Markdown/HTML 报告与 `diagnosis gaps`，复核后确认 diagnosis gate。

## 闸门

未确认 seed set 不执行正式 probe；未确认 diagnosis report 不进入场景库。Provider 失败必须记为失败，不能算成“未提及”。

规格来源：`openspec/changes/add-baseline-geo-diagnosis/`。
