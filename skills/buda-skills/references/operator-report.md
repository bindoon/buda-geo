# 企业资料确认清单（事实确认前必用）

`clean-review.md` 是普通用户的确认入口；`company.facts.json` 是内部底账。不要让用户阅读 JSON 才能知道清洗结果。

## 生成顺序

```bash
geo-cli clean --project {PROJECT}
geo-cli validate --project {PROJECT}
geo-cli review-clean --project {PROJECT}
```

然后完整读取项目根 `clean-review.md`，并结合原始资料做一次 Skill 语义复核。

## Skill 必须补充的判断

CLI 只能稳定检查结构、引用和已登记规则。Skill 还要检查：

- 企业介绍是否有重复、截断、残留标题、联系方式、孤立词或错桶。
- 成立年份、人数、设备、面积、产能、销量、复购率、认证等数字是否存在不同口径。
- 产品图片是否归并到正确产品/产品族，是否还需要按商业款型拆分。
- 产品类目、属性、能力和卖点是否确有文字来源，是否只是从图片或营销语猜测。
- 信任背书是否只是企业自述；注册材料不得自动补强背书。

发现问题后写入 `knowledge/clean.overrides.json.review_notes[]`：

```json
{
  "code": "profile_duplicate_fragments",
  "severity": "block",
  "message": "公司概况存在重复段落和残留标题，需要清理后再确认。"
}
```

重新运行 clean、validate 和 review-clean，让问题稳定出现在确认清单中；不要只在对话里临时提醒。

## 固定阅读顺序

向用户汇报时按 `clean-review.md` 顺序，不另造一套结构：

1. **您现在需要做什么**：当前能否确认。
2. **必须修正**：不解决就不能确认。
3. **重点待确认**：所有 inferred、operator、legacy 业务值。
4. **冲突及处理方案**：原值、候选值、理由和是否仍需确认。
5. **建议或可选补充**：明确不阻断。
6. **企业名片、企业介绍、产品库**：展示当前实际值，空值写“未提供”。
7. **原始资料、图片与安全处理**：只报业务结果和数量。
8. **确认结果**：告诉用户下一步。

## 确认规则

- 有 block：明确“暂不能确认”，先修正；不要请求用户回复确认。
- 无 block、尚未确认：请求用户核对本页全部业务值，重点核对归纳值和冲突方案。
- 用户明确回复“确认企业事实”后，才运行：

```bash
geo-cli confirm-clean --project {PROJECT}
```

- 已确认：报告快照 ID，并说明下一步才是基线诊断。
- 无客服/询盘记录属于 recommend，不阻断企业事实确认。

## 表达规则

- 使用“企业名片、公司概况、产品卖点”等业务名称，不堆技术字段。
- `extracted` 说“原件直接提取”；`inferred` 说“Skill 归纳，需确认”；`operator` 说“项目清洗判断，需确认”。
- 产品图片只汇报数量、产品归属和目录，不罗列图片 ID。
- 技术 ID、source ID、输入哈希和事实哈希只放技术附录。
- 不汇报 clean 阶段未生成的关键词、问题库、FAQ、Prompt、诊断题或文章计划。
