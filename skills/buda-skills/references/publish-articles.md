# publish-articles — 授权发布与回执

> 状态：本地发布闭环已实现。`manual` 可记录人工/付费投放；`adapter` 只有统一契约预留，未实现或未审核具体适配器时不得声称已自动发布。

## 目标

只把当前正文哈希仍有效的 `approved` 文章送入已评级目标，通过 dry-run、显式授权、幂等 attempt 与不可变 receipt 区分“批准、已提交、已发布”。

## 前置条件

- `manifest.gates.content_plan.status = confirmed`
- 文章最新五项 assessment 全部通过，状态为 `approved`，且批准绑定当前正文 SHA-256
- 项目存在 `publish/destinations.json`；目标启用、已评级，channel 只能是 `social | media | b2b | site`
- 密码、Token 只来自环境变量、根 `.env` 或项目 `.secrets.env`

首次配置：

```bash
mkdir -p {PROJECT}/publish
cp config/publishing-destinations.example.json {PROJECT}/publish/destinations.json
```

把 `app_id` 改为项目 `manifest.json` 中的值，只保留真实、已评级的目标。`manual` 目标的 `adapter` 必须为 `null`；`adapter` 目标只能写适配器名和环境变量名，不能写凭证值。

## 1. Prepare：生成 dry-run

```bash
geo-cli publish prepare --project {PROJECT}
# 或只选部分已配置目标
geo-cli publish prepare --project {PROJECT} --destinations destination_social_x,destination_b2b_y
```

打开 `publish/plan-review.md`，逐项核对：

- Article ID、标题、正文路径和完整 SHA-256
- destination、channel、权威等级与执行模式
- `article_id + body_sha256 + destination_id` 生成的幂等键
- 目标账号、费用、时间和人工操作人

prepare 不执行外部写入。若正文被修改或批准失效，必须先 `article revise` 并重新审稿。

## 2. Authorize：显式授权

```bash
geo-cli publish authorize \
  --project {PROJECT} \
  --plan {PLAN_ID} \
  --confirm {PLAN_ID} \
  --by "操作人" \
  --reason "已核对正文、目标、费用与账号权限"
```

`--confirm` 必须准确回显 plan ID。授权记录不可变；未授权计划不能写 attempt 或 receipt。Skill 不得替用户推断授权。

## 3. Record：记录真实结果

人工/付费投放完成后立即记录，不得预写 published：

```bash
geo-cli publish record --project {PROJECT} --plan {PLAN_ID} --item {ITEM_ID} \
  --status submitted --by "操作人" --external-id "平台任务号"

geo-cli publish record --project {PROJECT} --plan {PLAN_ID} --item {ITEM_ID} \
  --status published --by "操作人" --external-url "https://example.com/article" \
  --external-id "平台文章号" --evidence "publish/evidence/screenshot.png"

geo-cli publish record --project {PROJECT} --plan {PLAN_ID} --item {ITEM_ID} \
  --status failed --by "操作人" --error-code "platform_rejected" \
  --error-message "平台审核未通过"
```

- `published` 必须提供外部 URL。
- `failed` 必须提供错误信息，可继续追加重试 attempt。
- `published | skipped` 是终态，同一幂等键不得再次记录。
- 证据只能是项目内相对路径或公开 URL；不要复制身份证、证照、密码或 Token。

## 4. Status / Validate

```bash
geo-cli publish status --project {PROJECT} --plan {PLAN_ID}
geo-cli publish validate --project {PROJECT}
```

`publish/status.md` 只把存在 published receipt 的项计为已发布。validate 反查 destination、授权、当前 approved 正文哈希、幂等键、attempt/receipt、终态和证据路径。

## Adapter 边界

当前仓库只提供 `adapter` 数据契约和 `.env.example` 变量预留，不调用未知发布 API。接入具体平台时必须单独实现、测试并审核：认证方式、请求体、限流、费用、平台审核状态、幂等头、重试和回执映射；外部写入仍必须消费上述显式授权。
