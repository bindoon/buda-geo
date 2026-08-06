# generate-articles — 生成文章草稿

> 状态：占位；正式实现应消费已确认 content plan，不直接读取 clean 阶段产物临时拼任务。

## 目标

根据已确认任务生成有事实依据、可审阅的草稿，不直接发布。

## 前置条件

- 已确认 content plan/task
- 任务绑定已确认 scenario/question 与 `fact_snapshot_id`
- 渠道为 `social | media | b2b | site`

## 计划流程

1. 读取任务、事实快照、允许公开的证据和本地配图。
2. 按渠道模板生成标题、正文、FAQ/CTA 等必要部分；一篇文章只选择当前主题需要的事实。
3. 禁止绝对化、疗效承诺和无来源宣传；联系方式只从经批准名片/转化字段读取。
4. 落盘正文与 meta，记录 task/scenario/question/fact/evidence refs，初始状态为 `draft`。
5. 更新生产计数并提交人工审稿，不声称已经发布。

建议路径：`articles/{channel}/{article_id}.md` 与同名 `.meta.json`。
