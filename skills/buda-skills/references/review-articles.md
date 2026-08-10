# review-articles — 人工审稿与批准

> 状态：已实现。批准只表示可进入发布准备，不表示已经发布。

## 目标

在发布前检查事实、合规、重复度、渠道适配和配图授权，并记录可追溯的修改与批准状态。

## 执行流程

1. 准备审稿包：

```bash
geo-cli article review-prepare --project {PROJECT}
```

读取 `articles/review/{article_id}.review.json`。它直接展示正文、实际使用事实、channel、claim boundaries、确定性风险和 revision。

2. Agent/人工逐项填写 assessment JSON，五项都必须有 `pass` 与人话 `note`：

- `factual_accuracy`：所有企业声明能否回溯到 used facts；
- `claim_boundaries`：是否遵守 research-only 和能力/数字边界；
- `channel_fit`：结构、语气和行动是否适合目标 channel；
- `compliance`：是否有绝对化、虚假评价、敏感行业、隐私或凭证问题；
- `originality`：是否与现有稿件重复、换标题灌水或跑题。

assessment 根节点还要包含当前 `article_id`、`body_sha256` 和总结。

3. 记录决定：

```bash
geo-cli article review-decide \
  --project {PROJECT} \
  --article {ARTICLE_ID} \
  --action approve \
  --assessment assessment.json \
  --reason "五项检查通过"
```

action 为 `request-changes | approve | reject | defer`。approve 要求五项全部通过、没有 block risk、正文哈希未变且理由非空。

4. 若需修改，先运行 `article revise`，再重新 `review-prepare`。旧 review history 保留，但当前状态回到 `pending_review`，旧哈希上的批准自动失效。

5. 校验与展示：

```bash
geo-cli article review-status --project {PROJECT}
geo-cli article review-validate --project {PROJECT}
```

向普通用户展示 `articles/review-report.md`，其中列出每篇五项结论、决定理由、状态和下一步。只有当前 hash 有效的 approved 稿件可由 `approvedArticleInput` 交给发布阶段。

未批准文章不得排队或发布。这里的“批准”是稿件状态，不复用企业事实确认人字段；审稿命令不改正文、不上传、不发布。
