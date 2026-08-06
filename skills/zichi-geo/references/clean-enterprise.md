# clean-enterprise — 企业资料清洗

配合 `schema-knowledge.md` 与 `geo-cli clean`。

## 步骤

1. **确认项目路径** `projects/{名}/`，`app_id`（见 CLI 内置映射或 `--app-id`）。
2. **inventory**：看四件套是否齐全；记录 `ignored` 法人证。
3. **执行** `geo-cli clean --project ...`（解析收集表、词表、知识库 docx、归图、默认 E/F/plan、写 missing）。
4. **validate**：必须无 schema/`app_id`/缺图错误；strict 下无 `block`。
5. **向运营汇报**：严格按 `operator-report.md` 模板（非技术读者）。内部读 manifest/knowledge 填数字，对外翻译术语，禁止堆 JSON 与英文字段名。
6. **停闸门**：无必补项时询问是否确认「资料整理完成」；确认后将 `manifest.gates.clean.status` 设为 `confirmed` 并填 `at`/`by`。

## 识别规则（禁止按客户名写死）

| 检测 | kind |
|------|------|
| 文件名含「信息收集表」xlsx | info_form |
| 含「知识库」docx | knowledge_docx |
| 含「关键词」或「问题库」xlsx | keywords |
| `指令/*.docx` | instruction_docx |
| 身份证/法人证 | legal_id → ignored |
| 客服/询盘/聊天 | chat_logs |
| 图片树 | → assets + skus |

## 装填顺序

A **baseinfo（名片）** → B **profile（介绍文案，四段拆开）** → C skus/assets → D keywords → E faq（有客服则 Skill 提炼，勿长期空壳）→ F prompts → generation_plan → manifest。

**baseinfo ≠ profile**：详见 `baseinfo-vs-profile.md`。电话/链接只进 A；介绍/优势/背书进 B。CLI 粗拆后 Skill 必须精修。

## 缺省文案（chat_logs）

> 未提供客服/询盘记录；不阻断清洗。若补充，可优化 FAQ(E) 与 prompts/generation_plan(F) 的真问题覆盖。请放到 `inputs/chat/` 后重跑 clean。
