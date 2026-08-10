# build-demand-scenarios — 建立客户问题与购买场景库

> 状态：已实现。不得用旧 brand/search/qa/intent 四桶代替正式场景库。

## 目标

把“谁在什么情况下、需要解决什么、会怎样问、企业凭什么回答”整理成平台无关的业务场景。一个场景是可复用的策略对象，不是一篇文章模板。

## 前置条件

- 已确认 `fact_snapshot_id`
- 已确认 baseline diagnosis run/report
- 原始词表、询盘和运营输入只能作为可追溯候选来源

## 每个场景的业务字段

1. 场景名称
2. 目标客户
3. 客户需求
4. 关注条件或约束
5. 代表性 AI 问题（可多条）
6. 支持回答的已确认事实与原始来源，或明确的事实缺口
7. 可选的期望下一步行动

这些字段用于描述客户决策情境，不要求全部写进同一篇文章。

## 输入与边界

- 权威上游只有已确认的企业事实快照和已确认的诊断报告/缺口。
- 原始关键词表、客服/询盘原话、运营补充只能生成**待确认候选**，不能覆盖企业事实。
- 大泽、摘星、掌心/荟信仅用于研发时归纳方法；运行产物不包含竞品字段、路由或三平台导出。
- 诊断中 `unavailable`/失败的探测只说明覆盖不足，不得给场景增加“品牌未提及”等可见度分。
- 本阶段不生成文章、FAQ 成稿或发布任务。

## 执行流程

1. 检查上游 gate：`manifest.gates.clean` 与 `manifest.gates.diagnose` 必须为 `confirmed`。
2. 如有旧关键词表，先运行 `geo-cli strategy import-legacy`。结果写入 `strategy/legacy/`，只做来源审计和候选输入。
3. 运行 `geo-cli strategy generate`，生成 `strategy/scenario-draft.json` 与普通用户可读的 `strategy/scenario-review.md`。
4. 检查每个场景的客户、需求、代表问题、事实依据和下一步行动；逐项批准、编辑、拒绝或延期。
5. 精确重复问题自动合并；语义近似项只生成建议，由人工执行 `merge-review`。有业务意义的客户、地区、决策阶段和现货/定制差异不得误合并。
6. 对 high evidence gap 必须 `accept`、`defer` 或 `resolve` 并填写人话原因；禁止为了过 gate 补造事实。
7. 需要时由运营用 `priority-override` 调整优先级，并记录操作者和原因。
8. `strategy validate` 通过且所有就绪项完成复核后，才运行 `strategy confirm` 冻结版本。

常用命令：

```bash
geo-cli strategy import-legacy --project {PROJECT} --input {KEYWORDS_XLSX_OR_JSON}
geo-cli strategy generate --project {PROJECT}
geo-cli strategy approve-ready --project {PROJECT}
geo-cli strategy review --project {PROJECT} --scenario {ID} --action approve
geo-cli strategy merge-review --project {PROJECT} --suggestion {ID} --action approve --reason "重复问法，仅语序不同"
geo-cli strategy gap-review --project {PROJECT} --gap {ID} --action defer --reason "待企业确认真实能力"
geo-cli strategy validate --project {PROJECT}
geo-cli strategy confirm --project {PROJECT}
```

## 普通用户确认时怎么讲

不要让用户先读 JSON。先展示 `scenario-review.md`，按场景说明：

- 谁会问；
- 他要解决什么问题；
- 可能怎样问 AI；
- 企业有哪些已确认信息可以回答；
- 哪些地方仍缺证据；
- 希望客户下一步咨询、查看店铺或索取方案。

旧关键词有多少条、来自哪个旧分组，可以作为审计信息展示，但不要要求用户确认旧四桶就是布达场景库。

## 闸门

未确认场景库不得进入内容规划。高优先级事实缺口必须解决、延期或明确接受，所有语义合并建议必须复核；确认后将 `scenario_library_id` 与版本写入 `manifest.gates.scenario`。事实或诊断版本变化时应新建修订版，不覆盖历史确认版本。

规格来源：`openspec/changes/add-customer-question-scenarios/`。
