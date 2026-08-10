# 摘星搜荐（摘星 GEO）后台摸底

> 抓取时间：2026-08-05  
> 站点：https://geo.zxaigc.com/  
> 演示凭证、个人账号和团队身份不纳入开源仓库；本文只保留产品方法与公开路由研究。

## 1. 产品叙事（五步方法论）

Dashboard 明确五段链路：

| 阶段 | 口号 | 菜单归属 |
|------|------|----------|
| 01 立身份 | 让 AI 认识你 | 实名认证、AI 智能体 |
| 02 建资产 | 让 AI 了解你 | 关键词、知识库、转化目标、图/视频素材 |
| 03 布信源 | 让 AI 相信你 | 账号授权、提示词、文章/视频创作与自动发布、城市分站 |
| 04 发全域 | 让 AI 推荐你 | 文章发布队列/记录、视频发布记录 |
| 05 盯数据 | 让 AI 提升你 | AI 搜索营销报表、竞争力分析报告 |

定位文案：**大模型搜索 + 平台 AI 搜索**。

## 2. 套餐与用量（摸底时点）

| 资源 | 剩余 / 总量 |
|------|-------------|
| 媒体发布（篇） | 740 / 5000 |
| 平台发布（篇） | 60 / 110 |
| 视频发布（条） | 86 / 100 |
| 自动发布日额度 | 今日剩余约 **200 篇** |
| 套餐名（API） | **摘星搜荐旗舰版**；另见「AI梦工厂专业版」「会销版-矩阵陪跑落地服务全案」 |

说明：页面存在「媒体发布」与「平台发布」双通道配额。

## 3. 功能地图与真实路由

前缀按方法论分区：

| 菜单 | URL |
|------|-----|
| 首页 | `/dashboard` |
| 实名认证 | `/lishenfen/realname-auth` |
| AI 智能体 | `/lishenfen/intelligent-agent` |
| 关键词营销定位 | `/jianzichan/keyword-train` |
| 企业知识库 | `/jianzichan/company-knowledge` |
| 转化目标 | `/jianzichan/convert-target` |
| 图片素材中心 | `/jianzichan/image-manage` |
| 视频脚本创作 | `/jianzichan/video-create-script` |
| 视频模板与素材 | `/jianzichan/video-publish/template-material` |
| 账号与授权 | `/buxinyuan/account-auth` |
| 提示词中心 | `/buxinyuan/prompt-word-center` |
| 文章批量创作 | `/buxinyuan/article-generate/batch` |
| 文章管理 | `/buxinyuan/article-generate/manage` |
| 文章自动发布 | `/buxinyuan/intelligent-publish` |
| 高权重城市分站 | `/buxinyuan/city-station` |
| 视频创作与发布 | `/buxinyuan/video-publish/cloud-clip` |
| 视频管理 | `/buxinyuan/video-publish/video-manage` |
| 文章发布队列 | `/faquanyu/model-feeding/task` |
| 文章发布记录 | `/faquanyu/model-feeding/record` |
| 视频发布记录 | `/faquanyu/video-publish/videoList` |
| AI搜索营销报表 | `/dingshuju/aiSearch` |
| AI搜索竞争力分析报告 | `/dingshuju/ai-analysis-report` |

JS 包内另有一套 `/creation-center/*` 路由；演示账号访问时报「未开通当前功能」，实际前台走 `/jianzichan`、`/buxinyuan` 等分区路径。

## 4. 关键模块细节

### 立身份

- **企业认证**：演示账号已完成企业认证；同时支持个人身份证认证。
- **AI 智能体官网**：可开通智能体官网 / 名片 / 客服。演示站示例：
  - 网站 ID 175，预览域 `*.aiwebagent.cn`
  - 强调 ICP、HTTPS、Schema.org、E-E-A-T 内容规范

### 建资产

- **关键词训练**：用户「常在 AI 里怎么问就填什么」；词组训练状态（成功/失败）、已生成文章数。示例词组：杯子、超声、保健品、激光、抗衰护肤品等（共约 44 组）。
- **企业知识库**：类型含普通知识、官网链接等；示例有完整「上海宇启 / 东鹏瓷砖」客户介绍长文。
- **转化目标**：最多 10 个；与公司/品牌名绑定；支持转化图片。
- **视频脚本**：22 组 / 344 条（上限 1000）；引用词组 + 时长区间。

### 布信源 / 创作发布

- **提示词中心**：系统提示词偏 EEAT 结构，如「特点分析+竞争力分析+注意事项+FAQ」「产业格局+公司介绍+核心优势+QA」。
- **文章管理状态机**：全部 3374 → 待确认 812 / 已确认 182 / 待发布 13 / 已发布 1858 / 发布失败 509 等。
- **自动发布**：任务含关键词组、单日篇数、执行间隔；日上限 200 篇。
- **账号授权媒体类型**：新闻媒体、自媒体矩阵、B2B 行业网站、独家权威媒体、省市级媒体、商业媒体。

### 发全域

- 发布任务类型：媒体发布 / 平台发布。
- 视频发布记录覆盖抖音 / 快手 / 哔哩哔哩。

### 盯数据

- **AI 搜索营销报表**：多模型收录量级（DeepSeek、豆包、元宝、文心、千问、纳米、Kimi、星火、百度 AI、抖音 AI、夸克等）；总收录量级达百万级展示（演示大盘数据）。
- **竞争力分析报告**：蒸馏词数、竞争力分析次数、品牌前五占比、平台对比维度（TOP1–5、正向舆情、信源站点数）；报告周一自动更新。

## 5. 后端 API 线索（同源）

公开可见接口前缀：`https://geo.zxaigc.com/api/v1/...`

| 类别 | 示例 |
|------|------|
| 账号/团队 | `/user/info`、`/team/detail`、`/team/package` |
| 套餐权益 | `/geo/feature/{id}/package`、`/team/package/benefit/info` |
| 关键词 | `/geo/ai/keywords` |
| 看板 | `/geo/dashboard/platform_stats`、`overview`、`stats` |
| 认证 | `/geo/certification/enterprise|personal/detail` |
| 竞争力 | `/geo/competitiveness/analysis_report_index` |
| 视频看板 | `/video/dashboard/*` |
| 自媒体 OAuth | `/geo/auth/bilibili`、`/geo/auth/kuaishou` |

GraphQL：`POST /api/v1/graphql/`。

## 6. 对布达方案的启示

- **方法论产品化**最完整：立身份→建资产→布信源→发全域→盯数据，可直接映射方案文档结构。
- **信源建设**（智能体官网 + Schema + EEAT 提示词）与「媒体/平台双发布」并重。
- **文章状态机 + 日发布配额**适合代理商规模化运营。
- 短视频（脚本→云剪→抖快 B 站）已成一等公民能力。
