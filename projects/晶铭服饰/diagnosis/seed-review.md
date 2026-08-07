# 晶铭服饰 · 基线诊断种子题复核

> 这些问题只用于测试 AI 当前如何理解和推荐企业，不是关键词库，也不会自动生成文章。

- 事实快照：`fact_snapshot_58e05074d59340bd`
- 种子版本：v1（confirmed）
- 题目：21 条有效候选

复核动作：逐题 approve / reject / edit / replace；edit/replace 都会保留原题并新增替代题，负面风险题必须逐题明确批准。

## 品牌/主体认知

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 晶铭服饰是做什么的？ | 检查 AI 是否能正确识别企业/品牌主体。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7 | `question_1513b35c0c658e85` |
| approved | 晶铭服饰有哪些主要产品？ | 检查 AI 是否能把品牌与已确认主产品关联。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_8671c5bfb63fb61d | `question_3bba87308a3e3e0d` |
| approved | 晶铭服饰是生产厂家还是贸易商？ | 检查 AI 对企业经营角色的理解是否准确。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_5d421c9f6e2a7fd5、fact_d8fb8318a6fabd89、fact_16500517b491d4dc | `question_0f63f297ef0c4f0a` |
| approved | 晶铭服饰靠谱吗？有哪些可核验依据？ | 检查 AI 是否能给出有来源的品牌信任说明。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_5d421c9f6e2a7fd5、fact_d8fb8318a6fabd89、fact_16500517b491d4dc | `question_df72878521bd3cc2` |
| approved | 晶铭服饰主要服务哪些客户和采购场景？ | 检查 AI 是否理解企业服务对象，而不只认识品牌名称。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_9ca1ceb88252b2d4 | `question_7c82056b195f1ae0` |
| approved | 晶铭服饰有哪些生产、供应或定制能力？ | 检查 AI 是否能把品牌与已确认企业能力关联。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_5d421c9f6e2a7fd5、fact_d8fb8318a6fabd89、fact_16500517b491d4dc | `question_50ec79dbe1db79d7` |

## 产品选择

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 儿童舞蹈服饰怎么选？ | 检查通用品类选购回答中是否出现目标企业。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7 | `question_f2a880f8f6fd4423` |
| approved | 儿童芭蕾tutu裙有哪些靠谱厂家或品牌？ | 检查目标产品的推荐可见度与竞品占位。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7 | `question_64e9f2099339da47` |
| approved | 采购儿童芭蕾tutu裙要重点比较哪些参数和服务？ | 检查 AI 对采购决策要素的覆盖。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_5885dd35c8d3af0f` |
| approved | 儿童芭蕾tutu裙适合哪些使用和采购场景？ | 检查 AI 对产品适用场景与采购对象的理解。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_9ca1ceb88252b2d4 | `question_656bb101cc765335` |
| approved | 儿童芭蕾tutu裙的材质、规格和做工应该怎么比较？ | 检查产品细节型选购回答及目标品牌可见度。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_1277a7ca911a72df、fact_609e6e5cbb03db6f | `question_fdbabec14f516441` |
| approved | B 端采购适合选什么样的儿童芭蕾tutu裙？ | 检查有企业事实线索支持的使用人群/场景问法。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_5d421c9f6e2a7fd5 | `question_e6f45401b7653bd0` |

## 供应商能力

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 能生产儿童芭蕾tutu裙的源头厂家有哪些？ | 检查供应商能力型问法中的目标企业推荐情况。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_5d421c9f6e2a7fd5、fact_d8fb8318a6fabd89、fact_16500517b491d4dc | `question_8886f4792bc9c253` |
| approved | 哪些儿童芭蕾tutu裙厂家支持生产供应？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_cf47e1e9613a8af0` |
| approved | 哪些儿童芭蕾tutu裙厂家支持一件起混批与小批量试单？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_3dfaf731f205e2b0` |
| approved | 哪些儿童芭蕾tutu裙厂家支持机构 LOGO、配色、裙摆层数和成人加大码定制？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_18ff3c23f3c7c957` |
| approved | 小批量采购儿童芭蕾tutu裙应该怎样评估供应商？ | 检查小批量采购决策中的供应商比较与目标企业露出。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_07e93d43574de9b6` |
| approved | 定制儿童芭蕾tutu裙要向厂家确认哪些条件？ | 检查定制能力型问题中的目标企业与竞品推荐。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_c8d5cc0c8dda17b0 | `question_eddea7f8c6e411f3` |

## 地区/采购

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 山东菏泽曹县儿童芭蕾tutu裙供应商有哪些？ | 检查有事实支持的区域采购可见度。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_f74062502b5e9cc5 | `question_89f80a3478d79d74` |
| approved | 山东菏泽曹县采购儿童芭蕾tutu裙怎么筛选源头厂家？ | 检查区域与供应能力组合问法。 | fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7、fact_f74062502b5e9cc5、fact_5d421c9f6e2a7fd5、fact_d8fb8318a6fabd89、fact_16500517b491d4dc | `question_f89b215e75d8cd20` |

## 负面风险（必须单题批准）

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 晶铭服饰的儿童芭蕾tutu裙有哪些质量或售后风险？ | 经人工批准后检查 AI 是否传播与目标产品有关的负面风险。 | fact_44f9ff6c4fad64a9、fact_389c30b0c87f0141、fact_5f89ef81b622ade7、fact_8671c5bfb63fb61d、fact_71ca91fe0f9a05d7 | `question_6d69f40a224404e1` |

## 确认条件

- 所有保留题必须为 `approved`。
- 负面风险题还必须是 `negative_risk_approved=true`。
- 确认后生成不可变 seed set；之后修改会产生新版本。
