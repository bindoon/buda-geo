# geo-cli

Buda GEO 的 Node.js CLI：企业事实清洗、可配置平台探测、客户问题与购买场景、内容规划、文章生成/审稿，以及显式授权的发布回执。

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
npm install -g @bindoon/geo-cli
geo-cli skills install
geo-cli skills status
```

`skills install` 默认从开源仓库 `bindoon/buda-geo` 获取最新兼容的 `buda-skills`，安装到 `~/.agents/skills/buda-skills`。GitHub 不可用且本机尚无有效安装时，才使用 npm 包内置快照。

## 用法

从仓库根目录：

```bash
geo-cli projects list
geo-cli projects resolve "晶铭"
geo-cli skills status
geo-cli inventory --project projects/晶铭服饰
geo-cli clean --project projects/晶铭服饰
geo-cli validate --project projects/晶铭服饰
geo-cli review-clean --project projects/晶铭服饰
geo-cli confirm-clean --project projects/晶铭服饰
geo-cli diagnose seed-draft --project projects/晶铭服饰 --size 25
geo-cli diagnose probe-run --project projects/晶铭服饰 --run RUN_ID
geo-cli diagnose validate --project projects/晶铭服饰
geo-cli strategy import-legacy --project projects/晶铭服饰 --input projects/晶铭服饰/inputs/晶铭服饰关键词.xlsx
geo-cli strategy generate --project projects/晶铭服饰
geo-cli strategy validate --project projects/晶铭服饰
geo-cli plan generate --project projects/晶铭服饰 --quota 30
geo-cli plan validate --project projects/晶铭服饰
geo-cli article prepare --project projects/晶铭服饰 --limit 3
geo-cli article prepare --project projects/晶铭服饰 --force
geo-cli article validate --project projects/晶铭服饰
geo-cli publish prepare --project projects/晶铭服饰
geo-cli publish validate --project projects/晶铭服饰
```

客户映射在 `projects/registry.json`（非 Skill 正文）。`resolve` 输出 `path` 后用于 `--project`。

开发未 link 时：

```bash
cd packages/geo-cli && npm run dev -- projects resolve "晶铭"
```

## 命令

| 命令 | 作用 |
|------|------|
| `skills install` | GitHub 优先安装 `buda-skills`；首次离线时使用 npm 内置快照 |
| `skills update` | 获取 GitHub 新版；失败时保留当前健康安装，不用旧快照降级 |
| `skills status` | 输出安装路径、来源、版本、CLI 兼容性和内容哈希健康状态 |
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
| `diagnose probe-run` | 按 `config/probe-platforms.json` 调用 OpenAI-compatible API，冻结逐题原始回答与失败证据 |
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
| `plan import-legacy` | 审计旧 FAQ/prompts/keywords/generation plan；只生成未确认候选与来源报告 |
| `plan generate` | 从 confirmed fact/diagnosis/scenario 生成 FAQ、Topic、Prompt、任务与普通用户复核单 |
| `plan review` / `approve-ready` | 按 Topic bundle 批准、编辑、拒绝、延期，或批量批准证据就绪主题 |
| `plan gap-review` | 解决、延期、接受阻断项，或批准为保留 forbidden claims 的 research-only 内容 |
| `plan merge-review` | 人工批准或拒绝 FAQ/Topic/任务语义合并建议 |
| `plan priority-override` / `task-override` | 带操作者和理由调整优先级、批次或数量；不得超过请求配额 |
| `plan confirm` / `revise` | 冻结不可变内容计划版本 / 基于确认版本创建修订草稿 |
| `plan validate` | 校验 Schema、上游版本、事实边界、引用、配额和 manifest gate |
| `article prepare` | 从 confirmed content plan 展开稳定 writing briefs（含 SKU 配图 allowlist）；支持 `--task` / `--limit` / `--force` |
| `article ingest` | 校验本地 Agent 生成的 Markdown、实际 Fact IDs、正文配图引用和 research-only 边界并存为 draft |
| `article revise` | 追加 v2+ 修订并保留正文哈希、原因和 lineage，不覆盖 v1 |
| `article status` | 显示 planned/prepared/drafted/missing，不把草稿冒充发布 |
| `article validate` | 校验 brief/meta Schema、计划引用、allowlist、正文路径和 SHA-256 |
| `article review-prepare` | 生成正文、事实、边界、风险和 revision 自足审稿包 |
| `article review-decide` | 记录五项 assessment 与 request-changes/approve/reject/defer；批准绑定正文哈希 |
| `article review-status` | 按审稿生命周期显示数量，不把 approved 说成 published |
| `article review-validate` | 校验 review history、当前正文哈希和 approved 硬条件 |
| `publish prepare` | 从当前有效 approved 正文与已评级 destination 生成 dry-run 和稳定幂等键 |
| `publish authorize` | 要求准确回显 plan ID、操作者和理由，生成不可变授权记录 |
| `publish record` | 追加 submitted/published/failed/skipped attempt 与 receipt；失败可重试，终态防重 |
| `publish status` | 输出计划和发布项状态，不把 approved/submitted 计为 published |
| `publish validate` | 反查目标、批准哈希、授权、幂等、attempt/receipt 与证据路径 |
| `status` | 打印 manifest |

## 目录结构

```
packages/geo-cli/
  package.json      # bin: geo-cli → dist/cli.js
  schemas/          # JSON Schema（随包发布）
  scripts/          # npm 打包时生成/清理 Skill 快照
  bundled-skills/   # prepack 临时产物，不提交 Git
  src/
    cli.ts
    lib/
  dist/             # npm run build
```

不修改 `inputs/`。CLI 不含客户名或具体 SKU；产品归桶、事实来源、冲突选择、明显错填字段的规范值和人工语义问题由 Skill/运营写入项目级 `knowledge/clean.overrides.json`，CLI 再确定性执行。规范值作为待确认的 `operator` 事实保留，原始候选不会被删除。图片不进入 Facts：原图在 source index，可用配图关系在 SKU images，OSS 在 publish 阶段再处理。

`clean` 的边界是“可追溯的企业事实”。关键词、需求场景、受众画像、FAQ、prompts、诊断题和 generation plan 必须在企业事实确认后的对应阶段生成；旧文件可迁移保留，但 clean 不创建或刷新。

`diagnose` 的边界是“测当前 AI 可见度”。种子题不是关键词库，诊断缺口不是写作任务。可配置的 OpenAI-compatible API 与受控人工录入复用同一结果契约；成功回答必须有原始快照，provider failure 不进入品牌未提及分母。配置从根 `.env` 或项目 `.secrets.env` 读取，JSON 只保存环境变量名。

没有 API 时可将计划组合录入为 `unavailable`，报告会显示中文状态和具体错误原因。只有用户明确接受限制后才能用 `diagnose confirm --accept-limitations` 确认闸门；这种确认只允许流程继续，不代表已取得真实可见度结论。后续真实探测应创建新的 run，避免占位记录污染正式指标。

`strategy` 的边界是“把客户问题组织成平台无关的购买场景”。场景不是文章模板；一项场景可以关联多条代表问题、未来 FAQ 和选题。旧 brand/search/qa/intent 分组仅保留来源审计，不是布达的正式模型。精确重复自动合并，语义近似只提建议；high evidence gap 和合并建议必须人工处置，确认版本后才开放内容规划。

`plan` 的边界是“决定写什么、为什么写、依据什么、投向哪个 channel 和写几条”。FAQ candidate、content topic、prompt recipe、production task 是四类独立对象，业务复核单按 Topic bundle 展示，并直接列出可用事实内容。计划阶段不生成 FAQ 答案、标题成稿、文章、图片或发布队列。只有 confirmed plan 中已批准且 `ready | research_only` 的 planned tasks 可被下游读取。

`article` 的边界是“把确认任务变成可人工审阅的 Markdown 草稿”。CLI 不绑定模型提供商：`prepare` 生成最小事实写作包并附带本地 SKU 配图 allowlist，Skill/本地 Agent 写正文并嵌入 `assets/images/...` 相对路径，`ingest` 校验并保存 meta。每篇都保持 `draft + requires_human_review`；本阶段不批准、不发布、不上传 OSS。

审稿以五项独立检查为准，不使用黑盒总分。approve 必须满足事实准确、边界、channel、合规、原创性全部通过，且绑定当前正文 SHA-256；任何 revision 都会让旧批准失效。只有 `approvedArticleInput` 可被发布阶段读取。

`publish` 的边界是“把当前批准正文安全地送到已评级目标并留证”。prepare 只生成 dry-run；authorize 必须由操作者显式确认；record 追加不可变 attempt/receipt。当前开源版本支持 manual 记录并预留 adapter 契约，不调用未知平台 API。`article_id + body_sha256 + destination_id` 是幂等键，published/skipped 终态不可覆盖。

## Skill 安装与更新

CLI 只管理一个 Skill：`buda-skills`，真实目标固定为 `~/.agents/skills/buda-skills`。默认命令：

```bash
geo-cli skills install
geo-cli skills update
geo-cli skills status
```

安装和更新会在隔离的临时 HOME 中通过固定主版本的标准 Skills CLI 获取 `bindoon/buda-geo`，先校验 `SKILL.md`、`skill.manifest.json`、普通文件类型、内容大小与当前 CLI 兼容范围，再原子替换真实目录。远端工具不会直接写真实 `~/.agents`。

降级规则：

- GitHub 成功且候选兼容：启用远端版本，来源为 `github`。
- GitHub 失败或候选不兼容，但当前受管安装健康：保留当前版本，不降级。
- 没有健康安装：使用 npm 发布时内置的 `bundled` 快照。
- `--offline`：跳过 GitHub；健康安装保持不变，否则使用内置快照。
- 已有同名目录但不是 `geo-cli` 管理：默认拒绝覆盖；`--force` 会先改名备份，并在 JSON 结果中返回 `backup_path`。

每个受管安装包含 `.geo-cli-managed.json`，记录来源、Skill/CLI 版本、内容哈希和安装时间。Skill 自身的 `skill.manifest.json` 声明兼容范围；不要手工修改这些记录。GitHub 与 npm 都不可用时，现有健康安装仍可继续使用。

## 环境与平台配置

从仓库根运行：

```bash
cp .env.example .env
cp config/probe-platforms.example.json config/probe-platforms.json
```

`probe-run` 使用配置中的平台 `id`。每个平台只声明 `base_url_env`、`api_key_env`、`model_env`，实际值写入 `.env`。发布目标从 `config/publishing-destinations.example.json` 复制到项目 `publish/destinations.json`，并把 `app_id` 改为项目真实值。

## 测试

```bash
cd packages/geo-cli
npm test
```

测试覆盖稳定 ID、Schema/引用校验、敏感信息排除、语义 blocker、冲突解决、确认门、API 适配器、幂等 re-clean、发布授权与失败重试，以及 Skill 的远端/离线安装、兼容拒绝、完整性和冲突备份。

## 发布 npm（维护者）

```bash
npm test
npm pack --dry-run --json
npm publish
```

包名为 `@bindoon/geo-cli`，`publishConfig.access` 已固定为 `public`。`prepack` 从仓库根 `skills/buda-skills` 生成发布快照，`postpack` 清理临时目录；发布前应确认 tarball 含 `bundled-skills/buda-skills/SKILL.md`、兼容清单和 references。
