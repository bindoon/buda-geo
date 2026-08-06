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

#### 图片四分法

每张图片只能选择一种：

| action | 含义 | 结果 |
|---|---|---|
| `product` / `products[].source_paths` | 产品或型号图片 | 归到具体产品 |
| `company` | 工厂、设备、仓库、团队环境 | 归到 `_company`，不自动证明任何性能事实 |
| `evidence` | 营业执照、证书、平台申请等 | 归到 `_trust`，设置披露级别与精确支持字段 |
| `ignore` | 身份证、无关图、无法安全识别 | 不复制、不 OCR、不入事实 |

不透明文件名必须先看图再分类；包含身份证时只能 `ignore`。

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

所有语义填充都是候选；Skill 不得把自己的改写当来源。

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

#### 证据关联方法

`evidence.supports_fields` 必须窄关联：

- 营业执照可支持公司名称、注册地址等主体字段。
- 认证证书只支持证书中明确的主体、产品范围和有效期。
- 工厂照片可作为资产；不能自动支持产能、良品率、交付时效。
- 平台申请表不能支持其他平台账号，更不能支持产品性能。
- restricted/internal 证据不得用于公开文章。

### 4. Review：复跑与三层检查

```bash
geo-cli clean --project {PROJECT}
geo-cli validate --project {PROJECT}
geo-cli status --project {PROJECT}
```

逐组处理：

- structural：Schema 与 `app_id`。
- referential：source / subject / fact / evidence / asset 引用。
- semantic：哈希产品、重复主体、主产品空壳、画像错桶、冲突与孤立图片。
- security：密码、身份证、被隔离来源进入产物。

`block` 必须解决；`recommend` 可确认但必须向运营说明；`optional` 仅记录。无客服/询盘记录属于 `recommend`，不阻断。

### 5. Confirm：必须由人确认

按 `operator-report.md` 输出复核报告并停住。报告必须把企业名片、企业介绍五个分区、每个产品、每条证据、所有推断/规范化值、冲突和空缺逐项列出；不能只写“已拆分”“已生成 JSON”或“校验通过”。只有用户明确确认企业事实后运行：

```bash
geo-cli confirm-clean --project {PROJECT}
```

确认命令生成不可变快照并写入 `fact_snapshot_id`。重新清洗时：输入与事实不变则保持确认；有变化则回到 review，不覆盖旧快照。

## 禁止项

- 不在 `skus.ts` 或任何 CLI 文件里写客户名、客户目录、具体 SKU、客户专属分类或卖点。
- 不在 clean 阶段生成关键词、诊断题、场景词、受众画像、prompts、内容计划或配额；`company.profile.json` 的企业介绍视图属于事实清洗产物。
- 不复制或 OCR 法人身份证。
- 不让证据超范围支持事实。
