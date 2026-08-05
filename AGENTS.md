# AGENTS.md — 防错手册（非架构说明书）

主方案见 `docs/紫驰-GEO工具详细解决方案.md`。此处只写**读代码也容易做错**的约定。

## 目录与数据

- 客户工作区是 `projects/{项目名}/`，**不是** `clients/`。
- `projects/*/inputs/` **只读**：清洗产物写到 `knowledge/`、`assets/`、`manifest.json` 等，不要改原件。
- 发布通道只有三大权威信源 + 可选官网：`social` | `media` | `b2b` | `site`。不要为凑量往未评级站群发。

## 安全（必守）

- ❌ 不要把媒体账号**密码**、Token 写入任何 `knowledge/*.json`。
- ✅ 密码进 `projects/{名}/.secrets.env`（已被 gitignore）或环境变量。
- ❌ 法人身份证**不要**复制进 `assets/`、不要 OCR 进 JSON、不要写进文章。用途仅是五大自媒体企业实名（百家号/搜狐/头条/抖音图文/知乎）。
- ❌ 演示账号口令只在根 `README.md` 摸底备注；不要拷进客户知识库。

## 清洗 / Schema

- 允许字段缺失，但必须写入 `manifest.missing`，并带 `block` | `recommend` | `optional`。
- 无客服记录 → `recommend`（`chat_logs`），**不阻断** clean 确认。
- 配图先本地 `path`（`assets/images/...`）；`url`/OSS 仅在发文需要 CDN 时再做。
- `app_id` 必须在各 `company.*.json` 与 `manifest.json` 一致。

## Skill vs CLI

- 语义装填（docx 画像、SKU 归桶、人话缺失）走 **`skills/zichi-geo`**（`.cursor/skills/zichi-geo` 软链）。
- 表解析、inventory、validate 走 **`packages/geo-cli`**（Node.js，`geo-cli`）。
- **客户名单**在 `projects/registry.json`，用 `geo-cli projects list` / `resolve`；**不要**写进 Skill 正文。
- Skill 应调用 `geo-cli`，不要在对话里手搓校验规则。

## 进行中的 OpenSpec

- 当前 change：`openspec/changes/clean-projects-to-knowledge-schema/`（先华远深洗再复用）。





河北仁丹药业有限公司  才合作不久 没有啥询盘记录。 

南通市海门华远工具厂  也同样没有