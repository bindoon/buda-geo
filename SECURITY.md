# Security Policy

## 报告安全问题

请不要在公开 Issue 中提交密钥、客户资料、身份证、证照、未公开文章或平台登录信息。优先使用 GitHub Security Advisory 私下报告，并提供最小复现、影响范围和建议修复方式。

## 凭证与客户数据

- 凭证只放环境变量、根 `.env` 或 `projects/{项目}/.secrets.env`。
- `knowledge/*.json`、诊断 probe、文章、发布计划和 receipt 中禁止保存密码或 Token。
- 法人身份证、营业执照、商标证、许可证与平台注册材料只保留在原始 `inputs/`，不得复制或 OCR 到结构化产物。
- 外部发布必须先 dry-run，再由操作者显式授权。

## 支持范围

安全修复优先落在当前 `main` 分支。发布 adapter 在正式接入具体平台前不视为受支持的自动外部写入能力。
