# 紫驰「内容 Agent + GEO」详细解决方案

> 依据：[`紫驰-工具开发任务拆分与报价方案.md`](./紫驰-工具开发任务拆分与报价方案.md)、`projects/` 五家客户原始包扫描、[`平台摸底/`](./各GEO平台资料/平台摸底/)（大泽 / 摘星 / 掌心荟信后台）、艾瑞白皮书与方法论文
> 仓库约定：**可执行代码 → `packages/geo-cli`**；**Agent 流程与规则 → `skills/`**；**客户资料 → `projects/{项目名}/`**
> 执行策略：**分两部分推进**（Part A 本地闭环 → Part B 上云承接），中间用统一 Schema 与 `app_id` 衔接，避免推倒重来。
> 配图：**先本地 `assets/`**；发文若平台要求 CDN 再 OSS。法人身份证用于**五大自媒体企业实名认证**，不进知识库/文章正文；工具清洗阶段不解析入库。

---

## 0. 一句话目标

把对标平台的共性方法（信息收集表 → 知识库 → 诊断 → 场景 → 写文 → 三大权威信源投放）收成**紫驰自己的可复用本地流水线**：运营在 Cursor 里对一家客户跑通 `clean → diagnose → strategy → plan/write → publish`，结构化结果落盘；稳定后再同步 SaaS 给客户看。代码沉淀在 CLI，流程沉淀在 Skill，客户数据按项目隔离。

---

## 0.1 业务交付逻辑：实名信源 × AI 推广投放

> GEO 的本质不是「多发几篇文章」，而是让大模型在回答用户时，优先采信**可核验的权威信源**里的企业信息。乱发、低质站、未实名账号，很难形成稳定引用。

### 第一步 · 立信源身份（账号与主体）

- **法人身份证 + 营业执照**：主要用于开通/认证客户的**自媒体矩阵账号**（企业实名），不是写进 GEO 文章的素材。
- 五大自媒体（与信息收集表一致）：**百家号、搜狐号、今日头条、抖音图文、知乎**。
- 只有企业实名通过的账号，长期发真实企业信息，互联网沉淀才够「像可靠信源」，被 AI 稳定引用的概率才更高。
- 工具侧：收集表记录账号壳；密码进密管；身份证文件**不进** `knowledge/` / `assets/`，由运营在平台后台完成实名即可。

### 第二步 · AI 推广投放（选可靠信源，不乱投）

AI 向客户推荐品牌时，引用的是它抓到的外部信息。因此年约 **1500 篇**高质量企业信息/文章，应投在**三大类型权威信源**上（对应工具 `channel`：`social` / `media` / `b2b`），而不是任意站群：

| 类型 | channel | 做什么 | 为何算权威信源 | 内容与工具要点 |
|------|---------|--------|----------------|----------------|
| **1）企业自媒体号运营** | `social` | 百家号、搜狐、今日头条、抖音图文、知乎等矩阵，持续发布企业信息 | AI 认信源；企业实名账号 + 长期真实内容 → 引用权重更高 | 精品线：严审、绑知识库；依赖第一步实名 |
| **2）付费官媒软文** | `media` | 权威新闻网等付费投放 | 高权重媒体域，易被模型当「第三方报道」采信 | 文风适配大模型收录/EEAT；通常走媒体供稿或代理下单 API |
| **3）B2B 平台推广** | `b2b` | 高权重 B2B 站素材投喂与多平台分发 | 产业/采购场景下的可信商业信源，利于精准推荐 | 吃 SKU/工厂画像；可与 1688 等触点协同 |

```text
法人证/执照 ──实名──▶ 五大自媒体账号（social 信源）
                              │
资料包 ──clean──▶ 企业事实层 ──人工复核/确认──▶ diagnose ──▶ 场景/关键词 ──▶ write
                      │                                                   │
                      ├── source index / facts                            ├── social
                      └── baseinfo / profile / products                   ├── media
                                                                          └── b2b
```

合同量级默认可对齐：**约 1500 篇/年** 覆盖上述三类（自媒体 / 官媒 / B2B 的篇数配比与紫驰合同约定，记入 `manifest.quota.targets`）；另约 **500 问诊断** 作可见度验收。自有 GEO 官网（`site`）为 Part B 增强信源，不替代上述三类投放。

---

## 1. 仓库落位（最终形态）

```
geo/
├── packages/geo-cli/          # 可执行工具（诊断探测、发布 API、校验、批量脚本）
├── skills/
│   └── zichi-geo/             # Agent 入口：路由 + references
├── projects/                  # 按客户/项目隔离（唯一工作区）
│   └── {项目名}/
│       ├── inputs/            # 原始文件（只读约定，不改客户原件）
│       ├── knowledge/         # 清洗后的来源索引、企业事实与业务视图
│       ├── assets/            # 规范化配图（从 inputs 归类拷贝/软链）
│       ├── diagnosis/         # 诊断结果与快照
│       ├── articles/          # 生成稿件 + 队列
│       ├── publish/           # 发布回执
│       └── manifest.json      # 进度、闸门确认、时间戳
├── docs/                      # 方案、竞品、方法论（本文件在此）
└── README.md                  # 文档索引
```

| 层 | 路径 | 职责 | 谁调用 |
|----|------|------|--------|
| Skill | `skills/zichi-geo/` | 触发词、路由、人工闸门、写什么文件 | Cursor Agent |
| CLI | `packages/geo-cli` | 确定性 inventory / 表解析 / clean / validate / confirm-clean | Skill 明确写命令行；人也可直接跑 |
| 项目数据 | `projects/{名}/` | 单客户全生命周期文件 | 两边共用，以 `app_id` 标识 |

**原则**：Skill 不做 HTTP 细节；发布/诊断密钥不进 JSON；`inputs/` 保持原样，清洗产物只写 `knowledge/`、`assets/` 等下游目录。

**最终运行交付边界**：对外实际运行只依赖 `packages/geo-cli`、`skills/zichi-geo` 和 `projects/{项目名}/` 目录契约。`docs/`、`openspec/`、竞品研究资料与演示账号属于研发仓库，不是客户运行时依赖，也不应出现在最终用户的流程或界面中。

---

## 2. 项目扫描结论（通用部分）

已扫描 5 个项目：`南通市海门华远工具厂`、`晶铭服饰`、`朗威晶电`、`河北仁丹药业有限公司`、`蠡县晨源针织有限公司`。

### 2.1 每家几乎都有的「四件套」

| 通用输入 | 出现情况 | 清洗映射（模块） |
|----------|----------|------------------|
| **GEO 信息收集表 `.xlsx`** | 5/5（表名略异，Sheet 均为「公司信息」） | A 基础信息 + A5 媒体账号 |
| **企业知识库 `.docx`** | 5/5（已有大泽/运营侧成稿） | B 画像（介绍/产品/优势/背书） |
| **关键词 / 问题库 `.xlsx`** | 4/5（仁丹缺独立词表，词在知识库正文里） | clean 只索引原件；确认企业事实后，作为诊断/场景词阶段的候选输入 |
| **证照与人像图** | 5/5（身份证、营业执照散落或独立文件夹） | 全部只保留在原始 `inputs/`；工具清洗不复制、不 OCR、不进知识库/文章。身份证与营业执照可由运营在线下企业实名流程中使用 |

### 2.2 高频但形态不统一的输入

| 输入 | 典型形态 | 清洗策略 |
|------|----------|----------|
| **产品图** | 按品类文件夹（华远剪类 / 仁丹产品名 / 朗威「音乐U盘」等）；1688 风格「主图-N / 详情-N」；SKU 前缀命名 | → C：`assets/images/{sku_or_name}/` + `company.skus.json` |
| **公司/工厂图** | `公司图片/`、散落 jpg、信任背书文件夹 | → B3 信任背书 + C 企业图桶 |
| **指令 / 单品文案** | `指令/*.docx`（晶铭 tutu 裙、朗威音乐 U 盘） | → 写入对应 SKU 卖点或精品文提示，不覆盖主知识库 |
| **打包 zip** | 晶铭「信息.zip」与已解压目录并存 | clean 优先读已解压；zip 仅作备份 |

### 2.3 知识库 docx 的稳定章节（可当 B 模块模板）

五家文稿结构高度同构，clean 应用同一解析骨架：

1. 联系方式 / 1688 / 地址 / 优化关键词（页眉区）
2. **一、公司介绍**
3. **二、产品服务 / 核心产品**
4. **三、产品优势 / 核心优势**
5. **四、信任背书**（部分合并在介绍里）
6. （可选）FAQ / 售后 / 定制说明

### 2.4 原始关键词表的稳定列（供下游场景阶段使用）

| 列 | 含义 | 映射 |
|----|------|------|
| 关键词 | 品类/主搜词 | `search` 主词 |
| 拓展词 | 同品类变体 | `search` 蒸馏/拓展 |
| 问题 | 用户问 AI 的完整问句 | `qa`（含厂家/推荐/靠谱/定制等意图） |

地区向问题（「江苏南通…」「广东深圳…」「河北保定…」）进 **意图/地区定向**，不默认写进全国主词。

> 这些列描述的是客户交来的原始词表，不等于 clean 的输出。clean 的职责止于建立可信企业事实；诊断完成后，再结合事实、诊断缺口和用户意图生成紫驰自己的需求场景/关键词。大泽、摘星、掌心/荟信只用于对标方法，不是导出或数据提交目标。

### 2.5 信息收集表字段（A 模块最小集）

所有收集表同模板，clean 必须抽出：

- 公司名称、简称、联系人、联系方式  
- 平台账号（五大自媒体矩阵）：**百家号 / 搜狐号 / 今日头条 / 抖音图文 / 知乎**  
- 官网或 1688 URL、公司地址  
- 附件清单提示：执照、法人身份证（**实名认证用**）、产品图  

> **安全**：账号密码只进本地密管 / env（如 `projects/{名}/.secrets.env`，gitignore），**禁止**写入 `company.*.json` 明文。法人身份证不入库。扫描中已见收集表含明文密码——落地时必须剥离。

### 2.6 各项目完整度速览（Part A 选标杆用）

| 项目 | 收集表 | 知识库 docx | 词表 | 产品图结构化 | 建议角色 |
|------|--------|-------------|------|--------------|----------|
| 华远工具厂 | ✓ | ✓ 质量好 | ✓ 问题库完整 | 品类文件夹较全 | 工具/工厂参考项目 |
| 朗威晶电 | ✓ | ✓ | ✓ | 按 SKU/品类分桶清晰 | **标杆 #2（电子件）** |
| 晶铭服饰 | ✓ | ✓ | ✓ | 单品图多 + 指令 docx | **标杆 #1（服饰定制）** |
| 仁丹药业 | ✓ | ✓ | 弱 | 产品/公司/背书分桶好 | **敏感行业**（写文风控） |
| 晨源针织 | ✓ | ✓ | ✓ | 证照与产品混目录 | 辅料/配件样例 |

---

## 3. 两部分执行总览

```
┌──────────────────────────────── Part A（Step 0）────────────────────────────────┐
│  Schema + Skill 路由 + geo-cli(validate/diagnose/publish)                        │
│  标杆客户：inputs → knowledge → diagnosis → articles → publish 回执               │
│  交付：本地可验收的端到端链路 + 1～2 家项目样例数据                                  │
└───────────────────────────────────────┬─────────────────────────────────────────┘
                                        │ 同一 Schema / app_id
                                        ▼
┌──────────────────────────────── Part B（Step 1–2）──────────────────────────────┐
│  sync 上云 + 客户查看门户 +（可选）GEO 官网 / 多渠道媒体 API 加深                     │
│  交付：客户可读的 SaaS 承接层；本地仍是生产主战场                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| | Part A | Part B |
|--|--------|--------|
| 对应报价 | Step 0（约 4–6 万） | Step 1+2（约 2–4 + 2–4 万）+ 年维 |
| 主战场 | 本机 / Cursor + `projects/` | 云端展示与存档 |
| 完成定义 | 一家标杆 `clean→…→publish` 全闸门通过，且具备**分平台诊断凭证 + 发布回执** | `app_id+token` 同步成功；客户能看库/文/周报 |
| 不做 | 双向同步、短视频主路径、数字员工/名片、爆文复刻 | 不在云端重做清洗与批量生成 |

对客叙事优先用 **§0.1 两大步 + 三大信源**；亦可借摘星五步映射目录：`clean≈建资产`，`diagnose≈盯缺口`，`write+publish≈布信源/发全域`，Part B 门户≈盯数据。

---

## 4. Part A — 本地闭环（详细）

### 4.1 交付清单

| # | 产物 | 位置 |
|---|------|------|
| A1 | 知识库 JSON Schema + 样例 | `skills/zichi-geo/references/schema-knowledge.md` + `projects/{标杆}/knowledge/` |
| A2 | Skill 入口与路由 | `skills/zichi-geo/SKILL.md` |
| A3 | 清洗 / 诊断 / 写文 / 发布 references | `skills/zichi-geo/references/*.md` |
| A4 | CLI：`validate` / `diagnose` / `publish` | `packages/geo-cli` |
| A5 | 标杆项目跑通包 | 晶铭服饰 |
| A6 | `manifest` 闸门与周报字段约定 | 各 `projects/*/manifest.json` |

### 4.2 单项目目录约定（从 inputs 抽出通用结构后）

```
projects/{项目名}/
  inputs/                      # 原样保留（只读）
  knowledge/
    source-index.json          # 每个 inputs 原件的类型、哈希、解析状态、忽略原因
    company.baseinfo.json      # 企业名片：地址、联系方式、店铺/账号；不放介绍文案
    company.profile.json       # 企业介绍：产品服务、优势、背书、痛点；不放联系方式
    company.skus.json          # 经 Skill 语义归桶后的产品/产品族；CLI 不写死客户 SKU
    company.facts.json         # 内部事实底账：业务主体、事实、来源、确认状态、冲突；不存图片索引
    clean.overrides.json       # 项目级 Skill 规则：资产归类、产品归桶、事实来源、语义问题、字段规范化
    snapshots/                 # 已确认事实快照；不可被 re-clean 覆盖
    # keywords / FAQ / prompts / generation_plan 属下游阶段，clean 不创建或刷新
  assets/images/
    _company/                  # 厂房/团队/门头
    {sku_or_category}/         # 主图/详情/场景
  diagnosis/
    seed-draft.json            # 当前待复核种子题草稿（只用于基线诊断）
    seed-review.md             # 普通用户可读的逐题复核清单
    seed-sets/{seed_set_id}.json # 已确认不可变种子题版本
    runs/{run_id}/
      run.json                 # 事实快照、种子版本、平台和运行状态
      raw/{probe_id}.md        # 精确问题与原始回答快照（不可变）
      probes/{probe_id}.json   # 状态、提及/推荐/排名/竞品/风险/引用
      analysis-revisions/      # 解析修订；不改原始回答
    reports/{report_id}.{json,md,html} # 机器可读 + 客户可读报告
    gaps/{report_id}.json      # 仅确认报告后供场景阶段读取
    legacy/                    # 旧问题和网页摸底；不计入正式指标
  strategy/
    legacy/keyword-audit.{json,md} # 旧关键词来源与重复审计；不是正式场景库
    scenario-draft.json        # 待复核场景、问题 facets、证据缺口、优先级与合并建议
    scenario-review.md         # 普通用户确认入口
    scenario-libraries/{id}.json # 已确认不可变场景库版本
  articles/
    social/                    # ① 自媒体矩阵（百家号/搜狐/头条/抖音图文/知乎）
    media/                     # ② 付费官媒软文（权威新闻网）
    b2b/                       # ③ 高权重 B2B 投喂
    queue.json                 # 队列；每篇带 status / channel / keyword_ids / platform
  publish/
    receipts.jsonl             # article_id + platform 幂等回执
  manifest.json                # gates + missing 分级 + 1500 篇三类信源进度
  clean-review.md              # 普通用户确认入口：必须修正/重点待确认/冲突/建议/业务内容
```

`clean.overrides.json` 的事实决议既可在多个原始候选中选择，也可修正明显填错字段的值（例如把写进“公司简称”的经营描述规范为简称）。规范值必须保留为 `operator` 候选，同时保留原始候选与已解决冲突记录；只有人工确认后才进入不可变快照，重复 clean 不得改变事实哈希。

`app_id` 建议：拼音/英文短码，如 `hy_tool_nt`、`lw_storage_sz`，写入每个 JSON 根字段与 `manifest.json`。

**稿件 `status`（学摘星状态机，契约先定）**：`draft` → `pending_review` → `approved` → `queued` → `published` | `failed`。自媒体（`social`）必须到 `approved` 才可 publish。

**发布 `channel`（三大权威信源 + 可选官网）**：`social` | `media` | `b2b` | `site`  
- Part A：三类投放均要能写回执；至少跑通 `social` 真发，`media`/`b2b` 可先半自动下单仍统一回执格式。  
- `site`（自有 GEO 官网）属 Part B 增强信源，不替代年 1500 篇的三类投放。

### 4.3 Skill 路由（Part A 必做）

| 输入/状态 | 分支 | 加载 | 产出 |
|-----------|------|------|------|
| 只有 `inputs/` 或说「清洗」 | `clean` | clean-enterprise + schema | 来源索引 + 企业事实 + 业务视图 + 缺失清单 |
| 企业事实已确认，「诊断」 | `diagnose` | `diagnose-baseline.md` | `diagnosis/*` |
| 诊断已确认，「整理关键词/场景」 | `scenarios` | `build-demand-scenarios.md` | `strategy/*` |
| 「选题 / FAQ / Prompt / 计划」 | `plan` | `plan-content.md` | 内容计划版本 |
| 「写文章 / 批量」 | `generate` | `generate-articles.md` | `articles/*` 草稿 |
| 「审稿 / 批准」 | `review` | `review-articles.md` | approved 稿件 |
| 「发布」 | `publish` | `publish-articles.md` | `publish/receipts*` |
| 「复测 / 优化下一轮」 | `measure` | `measure-and-iterate.md` | 新诊断缺口/迭代计划 |
| 「同步上云」 | `sync` | `sync-saas.md` | Part B 同步回执 |

闸门：clean / diagnose / scenario / write(自媒体) / publish 每步停等人工确认，写入 `manifest.gates`。clean 的确认只记录时间与 `fact_snapshot_id`，当前不维护“确认人”字段。

### 4.4 `clean`：从杂乱 inputs 到统一 JSON

**分工与识别器（按文件类型，不按客户名写死）**：

| 检测规则 | 动作 |
|----------|------|
| 文件名含 `信息收集表` 或 Sheet「公司信息」 | 解析 → baseinfo；账号密码 → secrets 提示 |
| 文件名含 `知识库` 的 docx | 按「一/二/三/四」章节 → profile |
| 文件名含 `关键词` / `问题库` | 只写入 source index，留给确认后的场景/关键词阶段使用 |
| 产品图、公司图、不透明图片 | CLI 只做 inventory；Skill 阅读语义后写项目级 `clean.overrides.json`，仅产品图和公司图由 CLI 确定性归档 |
| `指令/*.docx` | 挂到对应 SKU `copy_brief` |
| 营业执照、商标证、许可证图片、平台注册材料 | **只保留原件**：source index 标记 ignored；不复制、不 OCR、不生成事实或文章素材 |
| 法人身份证 | **只保留原件**：仅支撑运营在五大自媒体做企业实名；inventory 标 `ignored: legal_id`，不复制、不 OCR、不进知识 JSON/文章 |

**缺失分级**（允许缺，但必须提示）：

| 级别 | 含义 | 示例 |
|------|------|------|
| `block` | 未解决则不能 `gates.clean=confirmed` | 公司名、有效 1688/官网、企业介绍过短 |
| `recommend` | 可确认清洗，写入 `manifest.missing` | **客服/询盘记录**（后续可丰富客户问法）、信任背书图 |
| `optional` | 仅记录 | 视频素材 |

执行顺序固定为 `inventory → extract → normalize → review → confirm`。**验收**：`geo-cli validate --project ...` 通过；`geo-cli review-clean --project ...` 生成普通用户确认清单；无未解决 `block`；`recommend` 可保留并带人话 `message`；人工复核后运行 `confirm-clean` 生成不可变快照。输入或事实哈希变化时自动退回 `review_required`，不得覆盖旧快照。

### 4.5 `packages/geo-cli` 最小命令面（Part A）

```text
geo-cli inventory     --project <path>       # 全量原件分类、逐文件哈希、ignored reason
geo-cli clean         --project <path>       # 只生成企业事实层；不生成关键词、FAQ、prompt、写作计划
geo-cli validate      --project <path>       # structure / reference / semantic / security
geo-cli review-clean  --project <path>       # 生成普通用户可读的企业资料确认清单
geo-cli confirm-clean --project <path>       # 无 block 时生成 confirmed fact snapshot
geo-cli diagnose seed-draft --project <path> # 从已确认事实生成 20–30 条诊断小样本
geo-cli diagnose seed-review ...             # approve / reject / replace
geo-cli diagnose seed-confirm --project <path> # 冻结已复核 seed set
geo-cli diagnose run-create ...              # 绑定事实快照、seed 版本和平台
geo-cli diagnose probe-ingest ...            # 首期受控人工录入并冻结原始回答
geo-cli diagnose report ...                  # 透明指标 + JSON/Markdown/HTML
geo-cli diagnose confirm ...                 # 确认报告后才开放 diagnosis gaps
geo-cli diagnose validate --project <path>   # 校验 Schema、引用、证据和 gate
geo-cli strategy import-legacy ...           # 审计旧词表，只作为未确认候选
geo-cli strategy generate --project <path>   # 生成场景草稿 + 普通用户复核清单
geo-cli strategy review ...                  # 逐场景批准/编辑/拒绝/延期
geo-cli strategy gap-review ...              # 接受/延期/解决证据缺口
geo-cli strategy merge-review ...            # 人工决定语义近似项是否合并
geo-cli strategy confirm --project <path>    # 冻结场景库版本，开放内容规划
geo-cli strategy validate --project <path>   # 校验 Schema、事实引用和 gate
geo-cli status        --project <path>       # 查看 manifest 与 clean gate
```

实现要点：

- 诊断：首期已实现受控人工录入；后续 API / 浏览器辅助适配器复用同一 Probe 契约。每次成功探测保留精确问题、平台/模型/时间、原始回答路径与哈希；失败/超时/不可用不算品牌未提及。
- 指标：分开报告有效覆盖、品牌提及、主动推荐、Top-N、负面风险、竞品和引用来源，全部显示分子/分母；首期不设置不透明综合分。
- 报告：机器可读 JSON 与客户可读 Markdown/HTML 同源。种子题是诊断输入，不是正式关键词库；报告确认前，缺口不能进入场景阶段。
- 无 API 过渡：可以把题目×平台组合记录为 `unavailable` 并生成限制版报告；只有用户明确接受限制后才能确认闸门。此类报告只证明“当前无法探测”，不能解读为品牌提及率为 0；接入 API 或获得人工回答后必须新建真实运行。
- 场景：用“目标客户 + 客户需求 + 代表问题 + 已确认依据/缺口 + 可选下一步行动”描述购买情境。一个场景可关联多个问题、FAQ 和未来选题，**不是要求一篇文章包含全部字段**。
- 旧关键词：brand/search/qa/intent 等客户原分组只保留在 `strategy/legacy` 做来源审计；精确重复可自动合并，语义近似仅生成待审建议，不把竞品术语变成紫驰 Schema 或三平台导出。
- 优先级：业务价值、有效诊断缺口、证据就绪度、客户原话与运营判断分项记录。`unavailable` 探测不能贡献品牌未提及/推荐缺口分；人工覆盖必须记录操作者与原因。
- 场景闸门：未确认场景库不得进入 FAQ、选题或写作计划；high evidence gap 必须解决、延期或明确接受，禁止补造企业能力。
- 发布：封装聚合发文 API；无 API 平台半自动仍写同一 `receipts`（幂等键：`article_id + platform`）；若目标渠道强制 CDN，再在 publish 前上传 OSS 并回写 `url`。
- 密钥：仅环境变量 / `.secrets.env`（gitignore）；不进知识库。
- 诊断、场景/关键词、FAQ、prompt 与写作任务必须消费已确认的 `fact_snapshot_id`；它们由各自阶段生成，不能塞回 clean。
- 写作任务（学大泽）：下游 `generation_plan.tasks[]` 含 `keyword_group_id`、`limit`、`use_knowledge`（默认 true）、`produced_count`。

### 4.6 `write` / `publish`：三大权威信源 + 任务绑定

对齐 §0.1：年约 1500 篇高质量内容按信源类型分流，**禁止为凑量乱发低质站**。

| 信源类型 | channel | 目录 | 目标平台（示例） | 规则强度 | 配图 |
|----------|---------|------|------------------|----------|------|
| ① 企业自媒体矩阵 | `social` | `articles/social/` | 百家号、搜狐号、今日头条、抖音图文、知乎 | 严提示词 + **必人工审**；账号须企业实名 | 图文匹配 |
| ② 付费官媒软文 | `media` | `articles/media/` | 权威新闻网等（付费供稿） | 适配大模型收录/EEAT；可抽检 | SKU/企业实图优先 |
| ③ B2B 平台投喂 | `b2b` | `articles/b2b/` | 高权重 B2B / 行业站 | 吃工厂与 SKU 画像；API 未齐可半自动 | 同上 |

每篇生成必须绑定：`scenario/question IDs`、`fact_snapshot_id`、`task_id`、`channel`、初始 `status: draft`。禁止脱离已确认事实与场景空写。

**提示词**：`company.prompts.json` 按 **文类 × 结构模板** 存放（EEAT 多套：如「介绍+优势+推荐+FAQ」）；官媒稿另可加「产业格局+第三方表述」模板，避免软文口吻过硬广告。

**合规**：`generate-articles.md` 与 `review-articles.md` 分别约束草稿生成和人工批准；敏感行业必须检查疗效承诺、绝对化用语和证据范围。

**转化**：baseinfo 保留 1688/电话/询盘等 CTA，三类信源共用，避免每篇临时编联系方式。

**publish**：同一 `receipts` schema；`platform` 记具体站（如 `toutiao` / 某新闻域 / 某 B2B）；幂等键 `article_id + platform`。

### 4.7 Part A 推荐排期（开发顺序）

| 序 | 任务 | 完成定义 | 估时（量级） |
|----|------|----------|--------------|
| 1 | Schema + 晶铭服饰样例 JSON + `validate` | 样例过校验 | 2–3 天 |
| 2 | `SKILL.md` 路由 + `clean-enterprise.md` | 晶铭 inputs → knowledge 可确认 | 3–5 天 |
| 3 | `diagnose-baseline.md` + diagnose CLI | 小批量种子题、逐题证据与基线报告 | 2–4 天 |
| 4 | `build-demand-scenarios.md` + 竞品案例覆盖测试 | 紫驰场景库确认，且不依赖竞品格式 | 3–5 天 |
| 5 | 内容规划 + 生成 + 审稿 references | social/media/b2b 各出合规样稿 | 3–5 天 |
| 6 | `publish-articles.md` + publish CLI | 至少 1 个自媒体真发通；媒体/B2B 回执格式统一 | 2–4 天 |
| 7 | 多客户复跑（验证通用流程） | Part A 验收 | 2–3 天 |

---

## 5. Part B — 上云承接（详细）

> 启动条件：Part A 验收通过，且 Schema **冻结**（只允许加字段，不允许改语义）。

### 5.1 模块

| 模块 | 内容 | 对应报价 |
|------|------|----------|
| sync | 本地 `knowledge` / `diagnosis` / `articles` 元数据 / 发布回执 → 云；`app_id` + `token` | Step 1 |
| 客户门户 | 只读：知识库、发文记录、诊断周报/快照 | Step 1 |
| GEO 官网 | 用 A/B/C 生成轻量站点；二级域名 CNAME | Step 2 |
| 媒体 API 加深 | 多供应商、自动下单 | Step 2 可选 |

### 5.2 CLI 扩展（仍放 `packages/geo-cli`）

```text
geo-cli sync push --project <path> [--dry-run]
```

Skill 增加 `sync` 分支与 `references/sync-saas.md`。演进边界如下：

1. **阶段一：本地生产，SaaS 展示。** 本地是权威数据源，云端只读展示同步结果，不重算清洗、诊断、场景或内容。
2. **阶段二：云端协作增强。** 可增加复核、批注、任务查看等轻量能力，本地仍负责生产。
3. **阶段三：按能力选择性迁移。** 产品成熟后，再分别评估把清洗、诊断、场景或内容能力搬到 SaaS；每项迁移单独立项，不预先维护两套实现。

竞品平台只是研发对标资料，不参与这条同步链路。

### 5.3 同步节奏（待与紫驰确认后写死）

方案预留两种，Part B 开工前二选一：

- **定期批量**（推荐起步）：日终/周终 push  
- **实时**：publish / diagnose 成功后钩子 push  

---

## 6. 与报价模块对照

| 报价模块 | 本方案落点 | 阶段 |
|----------|------------|------|
| 1 企业事实 Schema | `schema-knowledge.md` + `knowledge/{source-index,facts,baseinfo,profile,skus}` | Part A |
| 2 清洗 Agent | Skill `clean` +（可选）CLI 辅助解析 | Part A |
| 3 诊断 | Skill `diagnose` + `geo-cli diagnose` | Part A |
| 4–5 写文 | Skill `write` + 规则；批量可后挂 CLI | Part A |
| 9 发布最小集 | `geo-cli publish` | Part A 必有 |
| 6–7 同步+门户 | `geo-cli sync` + 门户 | Part B |
| 8 官网 | 生成器 + 服务器 | Part B |

商业条款（开发费区间、15%–20% 分成、验收）仍以报价文档第 3 节为准；本文件只定**技术拆分与目录契约**。

---

## 7. 竞品 / 方法论对齐（来自平台摸底 + 材料）

| 来源 | 吸收进方案 | 明确不抄 / 后置 |
|------|------------|-----------------|
| **大泽** | 六步主路径；任务绑知识库；**媒体+自媒体+B2B** 多通道（对齐三大权威信源）；分模型收录+截图 | 爆文复刻；过细媒体投放 UI |
| **摘星** | 五步叙事；文章状态机；双配额与日更；EEAT 多套提示词；竞争力周报 | 短视频矩阵、名片/客服（Part B+） |
| **掌心/荟信** | 知识库分栏；场景词搜索/问答；备课(生成)/授课(多信源训练) | 数字员工/A2P/算力值引擎 |
| 艾瑞白皮书 | DSS/白帽、可见度与心智话术 | — |
| 厂方方法论文 | 证据库、微场景真问题 → D/E | — |

详见 [`平台摸底/三平台功能对比.md`](./各GEO平台资料/平台摸底/三平台功能对比.md)。

---

## 8. 验收标准（可写进合同附件）

### Part A

- [ ] 新客户按「四件套」放入 `inputs/` 后，`clean` 产出过 `validate` 的知识库，或仅剩已提示的 `recommend`/`optional` 缺失  
- [ ] 晶铭服饰真实 diagnose：客户可读报告 + 分平台明细 + 逐题原始回答凭证（当前仅完成豆包/DeepSeek 无 API 限制版闭环，不作为真实可见度验收）
- [ ] 写作均绑定词包且 `use_knowledge`；稿件带 `status`/`channel`；自媒体经 `approved` 后可发  
- [ ] 三大信源均有可验收样例（social 真发 ≥1 平台；media/b2b 至少统一回执或半自动闭环）  
- [ ] `manifest.quota` 可追踪年 1500 篇在三类 channel 的进度  
- [ ] 密钥与法人身份证未进入任何 `knowledge/*.json` / `assets`  

### Part B

- [ ] 同一 `app_id` 数据可在门户只读查看（库 / 三类信源发文 / 诊断周报）  
- [ ] 同步失败可重试、可观测  
- [ ] （若做官网）二级域名可访问；NAP/主体与 baseinfo 一致；作为**增强信源**，不替代 social/media/b2b 投放  

效率/成本基准（分成挂钩）另表锁定；量级默认：**约 500 诊断问 / 1500 文/年（覆盖自媒体 + 官媒 + B2B 三类权威信源）**。

---

## 9. 风险与明确不做（Part A）

| 项 | 处理 |
|----|------|
| 客户 inputs 命名混乱 | 类型识别器 + 缺失清单 |
| 敏感行业（药械等） | 统一禁写表 + 客户级弱化；仁丹作样例 |
| 为凑量乱发低质站 | 通道白名单 = 三大权威信源；禁止未评级站群 |
| 视频 / A2P / 数字员工 | 不做主路径；素材最多索引 |
| 法人身份证 | 只服务五大自媒体实名；不清洗入库、不进文 |
| 云端改库回写本地 | 不做 |
| 百科代运营 | 后置 |

---

## 10. 下一步（立即执行）

**Part A 启动包：**

1. 冻结目录：`packages/geo-cli`、`skills/zichi-geo`、`projects/*/knowledge|assets|...`  
2. 写 `schema-knowledge.md`，用**晶铭服饰**打出第一份合规 JSON
3. 实现 `geo-cli validate`  
4. 写 `SKILL.md` 路由 + `clean-enterprise.md`，对晶铭服饰跑通清洗闸门
5. 并行：向紫驰确认诊断 API / 发布 API 供应商（或半自动过渡方案）  
6. 晶铭服饰串跑后再选择不同类型项目验证「通用清洗」是否成立

**Part B：** Part A 验收签字后再开，避免 Schema 漂移。

---

## 附录 A · `manifest.json` 字段草案

```json
{
  "app_id": "hy_tool_nt",
  "project_name": "南通市海门华远工具厂",
  "clean_pipeline": {
    "stage": "confirmed",
    "inputs_hash": "<sha256>",
    "facts_hash": "<sha256>",
    "changed_since_confirmation": false,
    "previous_snapshot_id": "fact_snapshot_..."
  },
  "gates": {
    "clean": {
      "status": "pending|review_required|confirmed",
      "at": null,
      "fact_snapshot_id": null
    }
  },
  "missing": [
    {
      "code": "chat_logs",
      "severity": "recommend",
      "message": "未提供客服/询盘记录；不阻断企业事实确认，后续可用于丰富客户问法。"
    },
    {
      "code": "social_realname",
      "severity": "recommend",
      "message": "请确认五大自媒体（百家号/搜狐/头条/抖音图文/知乎）已完成企业实名；法人身份证仅用于平台认证，不入库。"
    }
  ],
  "review_ready": true,
  "clean_ready": false,
  "quota": {
    "articles_generated": 0,
    "articles_published": 0,
    "by_channel": { "social": 0, "media": 0, "b2b": 0 },
    "diagnose_questions": 0,
    "targets": {
      "articles_year": 1500,
      "diagnose_questions": 500,
      "channels": ["social", "media", "b2b"],
      "social_platforms": ["baijiahao", "sohu", "toutiao", "douyin_article", "zhihu"]
    }
  },
  "updated_at": null
}
```

## 附录 B · 与现有 `projects` 的迁移约定

- 不移动客户已有 `inputs/` 文件。  
- 不覆盖原件；由 clean 创建或更新来源索引、精简事实底账、业务视图和 `manifest.json`，下游目录按阶段建立。
- 旧的 `company.keywords.json`、FAQ、prompts、generation plan 可以暂存用于迁移对照，但 clean 不再创建或刷新。
- 根目录空的 `inputs/`（仓库级）可废弃或仅作临时投放区；正式流程以 `projects/{名}/inputs` 为准。

## 附录 C · `generation_plan` 任务与稿件元数据（契约预留）

```json
{
  "app_id": "hy_tool_nt",
  "tasks": [
    {
      "task_id": "t_social_jian_01",
      "keyword_group_id": "kg_园林电动剪刀",
      "channels": ["social"],
      "platforms": ["baijiahao", "toutiao", "zhihu"],
      "use_knowledge": true,
      "limit": 20,
      "produced_count": 0,
      "prompt_template_id": "eeat_intro_advantage_faq"
    },
    {
      "task_id": "t_media_jian_01",
      "keyword_group_id": "kg_园林电动剪刀",
      "channels": ["media"],
      "use_knowledge": true,
      "limit": 10,
      "produced_count": 0,
      "prompt_template_id": "eeat_industry_third_party"
    }
  ]
}
```

单篇 sidecar / queue 项最小字段：`article_id`、`task_id`、`channel`（`social|media|b2b`）、`platform`、`status`、`keyword_ids`、`paths.content`、`paths.images[]`。
