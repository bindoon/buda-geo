# clean-enterprise — 企业事实清洗方法

目标不是“生成几个合法 JSON”，而是把原始资料整理成可追溯、可复核、可确认的企业事实。配合 `schema-knowledge.md` 与 `geo-cli`。

## 五阶段

### 1. Inventory：只盘点，不判断业务

```bash
geo-cli inventory --project {PROJECT}
```

- 为 `inputs/` 每个文件记录路径、哈希、类别和解析状态。
- 身份证与不透明命名图片默认隔离。
- 不修改 `inputs/`，不凭客户名推断产品。

### 2. Extract：确定性抽取

```bash
geo-cli clean --project {PROJECT}
```

CLI 解析信息表和知识库 Word，形成 source index、baseinfo/profile 初稿、产品图片候选、draft facts。首次输出出现语义 blocker 是正常的。

### 3. Normalize：Skill 做语义决策

读原始资料与候选产物，生成项目级 `knowledge/clean.overrides.json`。这份文件是“本项目的清洗决策”，不是通用代码。

#### 图片三分法

每张图片只能选择一种：

| action | 含义 | 结果 |
|---|---|---|
| `product` / `products[].source_paths` | 产品或型号图片 | 归到具体产品 |
| `company` | 工厂、设备、仓库、团队环境 | 归到 `_company`，不自动证明任何性能事实 |
| `ignore` | 身份证、营业执照、商标证、注册/申请材料、无关图、无法安全识别的文件 | 只保留原始 `inputs/`；不复制、不 OCR、不入事实 |

不透明文件名必须先看图再分类。身份证、营业执照、商标证和账号注册材料统一 `ignore`：它们可供线下注册流程使用，但不是企业知识库或文章素材。若其他证书中的公开结论确实要用于写作，应从正式文字来源单独采集为候选事实，而不是把证件图片复制进知识库。

#### 产品归并方法

1. 先按“同一商业产品”归并图片，不按文件数创建 SKU。
2. 型号、开口、颜色等若只是同一产品的变体，写入 `attributes`，不要拆成多个主体。
3. 只有来源明确支持时才合并；不确定时保留多个候选并报告冲突。
4. 写人能读懂的 `name`，禁止哈希、UUID、纯序号和原始文件夹名。
5. 标出 `is_main`。至少一个主产品；主产品必须有 `category`，且 `attributes`、`capabilities`、`selling_points` 至少一项有实质内容。
6. `source_paths` 与资产的 `source_path` 可写精确相对路径，也可用目录前缀 `某目录/**`；前缀规则只负责批量关联，产品语义仍由 Skill 判断。

#### 字段来源与表达

- `category`：对产品的通用品类归纳，不是文章关键词。
- `attributes`：规格、材质、尺寸、适配、质保等结构化事实。
- `capabilities`：企业能提供的生产、定制、贴牌、交付、服务能力。
- `selling_points`：原资料可核验的产品差异点；不要把“高端、领先、性价比高”等空泛营销语当事实。
- `reason`：说明为何做该归并/推断，供人工复核。
- `fact_source_paths`：列出支持上述产品结构化值的知识库 Word、信息表或其他文字原件；图片来源仍只写在 `source_paths` / `images[].source_ref`。

所有语义填充都是候选；Skill 不得把自己的改写当来源。

若语义检查发现重复段落、残片、相互矛盾的数字、无法安全确认的产品归并等问题，把它写入 `clean.overrides.json.review_notes[]`，包含稳定 `code`、`severity` 和人话 `message`。不要只在对话里提醒，否则下一次 clean 会丢失判断。

若 Word 的章节解析结果存在重复、错位或混入无法统一的宣传数字，可在项目级 `clean.overrides.json.profile` 写入精修后的 `intro / products_services / advantages / trust / pain_points`，同时填写原始 `source_path` 和处理理由。CLI 会把这些字段记录为待确认的 `operator` 事实；不能核实的说法应直接排除并写入 `review_notes`，不得替企业选择某个冲突数字。

#### 名片与企业介绍必须分开

`company.baseinfo.json` 是企业名片；`company.profile.json` 是企业介绍。两者混用会导致联系方式进入正文、介绍内容无法复用。

| 内容 | baseinfo（名片） | profile（企业介绍） |
|---|:---:|:---:|
| 公司全称、简称 | ✓ | 正文可提及，但不能作为唯一信源 |
| 联系人、电话、地址 | ✓ | ✗ |
| 官网、1688、CTA、媒体账号 | ✓ | ✗ |
| 企业概况、成立年份、规模 | | `intro` |
| 品类、服务、工艺、定制 | | `products_services` |
| 可核验差异点、供应链优势 | | `advantages` |
| 资质、案例、口碑、验厂 | | `trust` |
| 客户或行业痛点 | | `pain_points[]` |

精修时执行：

1. 删除 profile 中的电话、链接、账号和“联系我们”，以 baseinfo 为准。
2. 不把整篇 Word 塞进 `intro`；按 `intro / products_services / advantages / trust / pain_points` 语义拆分。
3. `company_short_name` 只放公司或品牌简称；广告语移入 `intro` 或 `advantages`。
4. 联系方式只能用于名片、转化出口或文末经批准 CTA，不能当企业介绍。
5. 汇报时使用“企业名片”和“企业介绍”，不要只说 A/B 或“画像”。

若原表把经营描述、广告语等明显错填到字段中，可在 `fact_resolutions` 写入规范值和理由。规范值会记为待确认的 `operator` 事实，原始值与已解决冲突仍保留；这不是确认，必须继续停在人工复核闸门。

`pain_points` 没有可靠来源时可保留 `[]`。profile 字段允许缺失，但错桶或联系方式泄漏必须修复。

#### 原始材料与事实边界

- 企业信息表、知识库 Word 等文字来源可形成候选事实，并通过 `source_refs` 追溯原件。
- 工厂照片可作为企业素材；不能自动支持产能、良品率、交付时效。
- 营业执照、商标证、许可证图片、平台申请表和身份证只登记在 `source-index.json`，不派生知识文件或素材副本。
- 原始文件的存在不等于其中可能相关的营销表述已被证实；需要公开使用的资质结论，应另行收集可公开的文字事实并人工确认。

### 4. Review：复跑与三层检查

```bash
geo-cli clean --project {PROJECT}
geo-cli validate --project {PROJECT}
geo-cli review-clean --project {PROJECT}
geo-cli status --project {PROJECT}
```

逐组处理：

- structural：Schema 与 `app_id`。
- referential：source / subject / fact / SKU image 引用。
- semantic：哈希产品、重复主体、主产品空壳、画像错桶、冲突与孤立图片。
- security：密码、身份证、被隔离来源进入产物。

`block` 必须解决；`recommend` 可确认但必须向运营说明；`optional` 仅记录。无客服/询盘记录属于 `recommend`，不阻断。

### 5. Confirm：必须由人确认

按 `operator-report.md` 检查生成的 `clean-review.md` 并停住。普通用户先看到必须修正、重点待确认、冲突与建议，然后再看企业名片、企业介绍五个分区和每个产品；不要要求用户阅读 `company.facts.json`。只有用户明确确认企业事实后运行：

```bash
geo-cli confirm-clean --project {PROJECT}
```

确认命令生成不可变快照并写入 `fact_snapshot_id`。重新清洗时：输入与事实不变则保持确认；有变化则回到 review，不覆盖旧快照。

## 禁止项

- 不在 `skus.ts` 或任何 CLI 文件里写客户名、客户目录、具体 SKU、客户专属分类或卖点。
- 不在 clean 阶段生成关键词、诊断题、场景词、受众画像、prompts、内容计划或配额；`company.profile.json` 的企业介绍视图属于事实清洗产物。
- 不复制或 OCR 法人身份证。
- 不把营业执照、商标证、许可证图片、平台申请表或身份证派生成知识事实与写作素材。
- 不为普通图片创建 fact subject 或 `path` fact；图片追溯走 source index，产品配图关系走 SKU images。
