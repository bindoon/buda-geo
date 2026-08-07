# geo-cli

Node.js CLI：GEO 项目企业事实清洗、基线诊断、客户问题与购买场景及校验（Part A）。可发布至 npm。

## 安装

**仓库内开发：**

```bash
cd packages/geo-cli
npm install
npm run build
npm link   # 可选：全局 geo-cli
```

**发布后：**

```bash
npm install -g geo-cli
```

## 用法

从仓库根目录：

```bash
geo-cli projects list
geo-cli projects resolve "晶铭"
geo-cli inventory --project projects/晶铭服饰
geo-cli clean --project projects/晶铭服饰
geo-cli validate --project projects/晶铭服饰
geo-cli review-clean --project projects/晶铭服饰
geo-cli confirm-clean --project projects/晶铭服饰
geo-cli diagnose seed-draft --project projects/晶铭服饰 --size 25
geo-cli diagnose validate --project projects/晶铭服饰
geo-cli strategy import-legacy --project projects/晶铭服饰 --input projects/晶铭服饰/inputs/晶铭服饰关键词.xlsx
geo-cli strategy generate --project projects/晶铭服饰
geo-cli strategy validate --project projects/晶铭服饰
```

客户映射在 `projects/registry.json`（非 Skill 正文）。`resolve` 输出 `path` 后用于 `--project`。

开发未 link 时：

```bash
cd packages/geo-cli && npm run dev -- projects resolve "晶铭"
```

## 命令

| 命令 | 作用 |
|------|------|
| `projects list` | 列出 `registry.json` 中所有客户 |
| `projects resolve <query>` | 简称/公司名/app_id → `path` |
| `inventory` | 分类并逐文件哈希 `inputs/`（法人身份证 → ignored） |
| `parse-form` | 信息收集表 → `company.baseinfo.json` |
| `parse-keywords` | 独立解析原始词表的兼容命令；不属于 clean 流程 |
| `clean` | 生成来源索引、精简事实底账、baseinfo/profile/skus 与 manifest；不生成下游 GEO 策略 |
| `validate` | 分别输出结构、引用、语义与安全检查；`--no-strict` 忽略 block missing |
| `review-clean` | 生成项目根 `clean-review.md`，按必须修正、重点待确认、冲突、建议和业务内容组织 |
| `confirm-clean` | 无 block 且人工复核后生成不可变事实快照；不记录确认人 |
| `diagnose seed-draft` | 从当前已确认事实快照生成 20–30 条诊断种子题与业务复核清单 |
| `diagnose seed-review` | 逐题 approve / reject / replace；负面题必须单独批准 |
| `diagnose seed-confirm` / `seed-revise` | 冻结不可变版本 / 从已用版本创建新草稿 |
| `diagnose run-create` | 绑定事实快照、seed set 和目标平台，创建运行 |
| `diagnose probe-ingest` | 受控人工录入逐题结果，冻结原始回答；禁止携带密钥 |
| `diagnose analysis-revise` | 追加解析修订，保留原始回答不变 |
| `diagnose report` | 生成可复算指标、缺口和 JSON/Markdown/HTML 报告 |
| `diagnose confirm` | 人工确认报告；有失败时须重试或明确接受限制 |
| `diagnose validate` | 校验诊断 Schema、引用、证据文件和 manifest gate |
| `diagnose import-legacy` | 将旧问题/网页摸底降级迁移为未确认候选 |
| `strategy import-legacy` | 审计旧关键词 JSON/XLSX，保留原分组与来源，但只作为未确认候选 |
| `strategy generate` | 从已确认事实与诊断缺口生成场景草稿和业务可读复核清单 |
| `strategy review` / `approve-ready` | 逐场景批准、编辑、拒绝、延期，或批量批准无 high gap 的就绪项 |
| `strategy gap-review` | 接受、延期或解决证据缺口并记录原因 |
| `strategy merge-review` | 人工批准或拒绝场景/问题语义合并建议 |
| `strategy priority-override` | 记录操作者和原因后覆盖场景优先级 |
| `strategy confirm` / `revise` | 冻结不可变场景库版本 / 基于确认版本创建修订草稿 |
| `strategy validate` | 校验场景 Schema、事实证据引用和 manifest gate |
| `status` | 打印 manifest |

## 目录结构

```
packages/geo-cli/
  package.json      # bin: geo-cli → dist/cli.js
  schemas/          # JSON Schema（随包发布）
  src/
    cli.ts
    lib/
  dist/             # npm run build
```

不修改 `inputs/`。CLI 不含客户名或具体 SKU；产品归桶、事实来源、冲突选择、明显错填字段的规范值和人工语义问题由 Skill/运营写入项目级 `knowledge/clean.overrides.json`，CLI 再确定性执行。规范值作为待确认的 `operator` 事实保留，原始候选不会被删除。图片不进入 Facts：原图在 source index，可用配图关系在 SKU images，OSS 在 publish 阶段再处理。

`clean` 的边界是“可追溯的企业事实”。关键词、需求场景、受众画像、FAQ、prompts、诊断题和 generation plan 必须在企业事实确认后的对应阶段生成；旧文件可迁移保留，但 clean 不创建或刷新。

`diagnose` 的边界是“测当前 AI 可见度”。种子题不是关键词库，诊断缺口不是写作任务。首期用受控人工录入，API/浏览器适配器以后复用同一结果契约；成功回答必须有原始快照，provider failure 不进入品牌未提及分母。

没有 API 时可将计划组合录入为 `unavailable`，报告会显示中文状态和具体错误原因。只有用户明确接受限制后才能用 `diagnose confirm --accept-limitations` 确认闸门；这种确认只允许流程继续，不代表已取得真实可见度结论。后续真实探测应创建新的 run，避免占位记录污染正式指标。

`strategy` 的边界是“把客户问题组织成平台无关的购买场景”。场景不是文章模板；一项场景可以关联多条代表问题、未来 FAQ 和选题。旧 brand/search/qa/intent 分组仅保留来源审计，不是紫驰的正式模型。精确重复自动合并，语义近似只提建议；high evidence gap 和合并建议必须人工处置，确认版本后才开放内容规划。

## 测试

```bash
cd packages/geo-cli
npm test
```

测试覆盖稳定 ID、Schema/引用校验、敏感信息排除、语义 blocker、冲突解决、确认门和幂等 re-clean。

## 发布 npm（维护者）

```bash
npm run build
npm publish --access public   # 若包名未被占用
```
