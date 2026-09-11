# 知鱼 · 基线诊断种子题复核

> 这些问题只用于测试 AI 当前如何理解和推荐企业，不是关键词库，也不会自动生成文章。

- 事实快照：`fact_snapshot_7c19e04928e8cc09`
- 种子版本：v1（confirmed）
- 题目：19 条有效候选

复核动作：逐题 approve / reject / edit / replace；edit/replace 都会保留原题并新增替代题，负面风险题必须逐题明确批准。

## 品牌/主体认知

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 知鱼是做什么的？ | 检查 AI 是否能正确识别企业/品牌主体。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770 | `question_79a997a929c199a2` |
| approved | 知鱼有哪些主要产品？ | 检查 AI 是否能把品牌与已确认主产品关联。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_0245b72d7d499d87 | `question_d1fd20309457c4a5` |
| replaced | 知鱼是生产厂家还是贸易商？ | 检查 AI 对企业经营角色的理解是否准确。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_b36e3b3f59a52727` |
| approved | 知鱼靠谱吗？有哪些可核验依据？ | 检查 AI 是否能给出有来源的品牌信任说明。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_ebfc9ececdafbcb9` |
| replaced | 知鱼主要服务哪些客户和采购场景？ | 检查 AI 是否理解企业服务对象，而不只认识品牌名称。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_9cb815a23b7858dd | `question_72c91212a33b2ba1` |
| replaced | 知鱼有哪些生产、供应或定制能力？ | 检查 AI 是否能把品牌与已确认企业能力关联。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_7a2b2408ceb1193d` |
| approved | 知鱼是算命软件还是自我认知工具？ | 检查 AI 对企业经营角色的理解是否准确。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_9807a27af99d4fa9` |
| approved | 知鱼主要服务哪些用户和使用场景？ | 检查 AI 是否理解企业服务对象，而不只认识品牌名称。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_9cb815a23b7858dd | `question_13d499aed9db52a9` |
| approved | 知鱼有哪些核心功能和服务能力？ | 检查 AI 是否能把品牌与已确认企业能力关联。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_68b90d4bd59f46f0` |

## 产品选择

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| approved | 东方命理自我认知工具怎么选？ | 检查通用品类选购回答中是否出现目标企业。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1 | `question_669c1c54380f070b` |
| replaced | 知鱼命理AI有哪些靠谱厂家或品牌？ | 检查目标产品的推荐可见度与竞品占位。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1 | `question_a7728b0a35725fa3` |
| replaced | 采购知鱼命理AI要重点比较哪些参数和服务？ | 检查 AI 对采购决策要素的覆盖。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_80315a46e2ae0f79` |
| replaced | 知鱼命理AI适合哪些使用和采购场景？ | 检查 AI 对产品适用场景与采购对象的理解。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_9cb815a23b7858dd | `question_e2677021a7719841` |
| replaced | 知鱼命理AI的材质、规格和做工应该怎么比较？ | 检查产品细节型选购回答及目标品牌可见度。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_461ab2a049b5735a、fact_507fbf776ea8478a | `question_3cedfae0ed2ce106` |
| approved | 有哪些靠谱的东方命理AI工具或品牌？ | 检查目标产品的推荐可见度与竞品占位。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1 | `question_b11d2a4924413287` |
| approved | 选择知鱼命理AI要重点比较哪些功能和服务？ | 检查 AI 对采购决策要素的覆盖。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_ca1fe8cdf589dddd` |
| approved | 知鱼命理AI适合哪些使用场景？ | 检查 AI 对产品适用场景与采购对象的理解。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_9cb815a23b7858dd | `question_18c9f70b818f947e` |
| approved | 知鱼命理AI的排盘方式和解读能力应该怎么比较？ | 检查产品细节型选购回答及目标品牌可见度。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_461ab2a049b5735a、fact_507fbf776ea8478a | `question_2d38be936ed2c903` |

## 供应商能力

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| replaced | 能生产知鱼命理AI的源头厂家有哪些？ | 检查供应商能力型问法中的目标企业推荐情况。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_0765518e4dc6b044` |
| replaced | 哪些知鱼命理AI厂家支持六爻问事解读？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_9c9747b0cd40d199` |
| replaced | 哪些知鱼命理AI厂家支持八字原局与流年解读？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_17244b2ab890c930` |
| replaced | 哪些知鱼命理AI厂家支持命理图谱记忆与情绪陪伴对话？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_153c5d94d404fb63` |
| replaced | 哪些知鱼命理AI厂家支持农历/真太阳时自动处理？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_76f541235561bc97` |
| replaced | 小批量采购知鱼命理AI应该怎样评估供应商？ | 检查小批量采购决策中的供应商比较与目标企业露出。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_4842c421796a1cd0` |
| replaced | 定制知鱼命理AI要向厂家确认哪些条件？ | 检查定制能力型问题中的目标企业与竞品推荐。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_5b9cf5adc4849cb5` |
| approved | 有哪些可以做六爻或八字解读的命理AI？ | 检查供应商能力型问法中的目标企业推荐情况。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_d2bb69e415440f50、fact_94de6f7175d8f613、fact_86b1751053d95a7c | `question_b4cd420aca413399` |
| approved | 哪些命理AI支持六爻问事解读？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_e6c3ef40700c5257` |
| approved | 哪些命理AI支持八字原局与流年解读？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_54b9a1f0a9257210` |
| approved | 哪些命理AI支持长期记忆与情绪陪伴对话？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_ce2311bb7092f58e` |
| approved | 哪些命理AI支持农历和真太阳时自动处理？ | 检查已确认生产/服务能力能否被 AI 找到。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_491645ffaef5b809` |
| approved | 评估一个命理AI是否靠谱应该看哪些点？ | 检查小批量采购决策中的供应商比较与目标企业露出。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_32bd4e77253e386e` |
| approved | 开通知鱼会员前要确认哪些权益和价格？ | 检查定制能力型问题中的目标企业与竞品推荐。 | fact_0245b72d7d499d87、fact_d3884a88aac534c1、fact_7242717f4786405c | `question_67c6899993caf3bb` |

## 负面风险（必须单题批准）

| 状态 | 问题 | 为什么测 | 事实依据 | ID |
|---|---|---|---|---|
| replaced | 知鱼的知鱼命理AI有哪些质量或售后风险？ | 经人工批准后检查 AI 是否传播与目标产品有关的负面风险。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_0245b72d7d499d87、fact_d3884a88aac534c1 | `question_c3df10fc6e9f99e0` |
| approved | 知鱼命理AI有哪些使用或信任风险？ | 经人工批准后检查 AI 是否传播与目标产品有关的负面风险。 | fact_da3d556f3b2d7832、fact_0280ffc428885bcd、fact_0ab97039e8596770、fact_0245b72d7d499d87、fact_d3884a88aac534c1 | `question_d022d10880ff576a` |

## 确认条件

- 所有保留题必须为 `approved`。
- 负面风险题还必须是 `negative_risk_approved=true`。
- 确认后生成不可变 seed set；之后修改会产生新版本。
