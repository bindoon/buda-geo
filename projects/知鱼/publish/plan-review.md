# 发布计划复核（Dry-run）

> 本文件不会执行外部发布。approved 仅表示稿件可进入发布准备；只有显式 authorize 后才能记录 submitted/published。

- Plan ID：`publish_plan_4df77ec89f46c976`
- 状态：complete
- 发布项：2

## 知鱼是算命软件吗？先分清它在做什么

- Item ID：`publish_item_7844901663487770`
- 文章：`article_35bb9f5ebd5f0900`；正文：`articles/social/article_35bb9f5ebd5f0900.md`
- 正文 SHA-256：`da2c0ceba140feb3b344a550113040ab6989d3630cd9c5504e254c193969c09f`
- 目标：知鱼已评级自媒体（人工发布）（`destination_social_manual` / social / manual）
- 幂等键：`publish_key_0b964c4d34a1131d`
- 当前状态：skipped

## 知鱼是什么：自我认知工具，而不是算命软件

- Item ID：`publish_item_3a8b85e1654de7f1`
- 文章：`article_e93407e791bb0ff7`；正文：`articles/media/article_e93407e791bb0ff7.md`
- 正文 SHA-256：`3ee58ddd49611d8a81856e52e3ae5b4b9b41013cb796519c068faa17e2a34e35`
- 目标：知鱼已评级媒体（人工/付费投放）（`destination_media_manual` / media / manual）
- 幂等键：`publish_key_f480014753c47763`
- 当前状态：skipped

## 授权命令

```bash
geo-cli publish authorize --project "/Users/bouda/work/buda-geo/projects/知鱼" --plan publish_plan_4df77ec89f46c976 --confirm publish_plan_4df77ec89f46c976 --by "操作人" --reason "已核对文章、目标和费用"
```
