# baseinfo vs profile（名片 vs 介绍）

> clean 时**必须**分清这两份文件。混在一起会导致写文重复电话、画像不可复用。

## 一句话

| 文件 | 比喻 | 写文章怎么用 |
|------|------|--------------|
| `company.baseinfo.json` | **名片** | 文末留资、发往哪个账号、核对主体 |
| `company.profile.json` | **介绍文案** | 正文里讲故事、卖点、信任 |

## 放哪里

| 内容 | baseinfo | profile |
|------|:--------:|:-------:|
| 公司全称 / 简称 | ✓ | 介绍里可再提一次公司名，但**不要**当唯一信源 |
| 联系人、电话、地址 | ✓ | ✗ 禁止（CLI 会尽量剥离；Skill 发现泄漏要删） |
| 1688 / 官网 / CTA | ✓ `conversion` | ✗ |
| 自媒体账号 ID | ✓ | ✗ |
| 成立年份、厂房、人数、产能 | | ✓ `intro` |
| 卖什么、服务政策、工艺 | | ✓ `products_services` |
| 差异化卖点、供应链优势 | | ✓ `advantages` |
| 资质、口碑、案例 | | ✓ `trust` |
| 客户/行业痛点 | | ✓ `pain_points[]` |

## profile 四段（不要整篇塞进 intro）

1. **intro**：谁、在哪、做什么、多大体量（约 150–400 字为宜）
2. **products_services**：品类 + 服务（起批、定制、发货、售后）
3. **advantages**：相对同行的差异点（定型、安全、性价比、更新速度…）
4. **trust**：资质、合作客户规模、复购、验厂等可核验背书

`pain_points`：短句数组，来自 Word「用户痛点/行业痛点」；没有可留 `[]`。

## Skill 在 CLI 之后要做什么

CLI 按标题粗拆；Skill **语义精修**：

1. 若 `advantages` / `trust` 为空，而长文堆在 `products_services` → 按语义拆开写入对应字段
2. 若 profile 里仍有电话 / 链接 /「联系我们」→ 删掉（以 baseinfo 为准）
3. `company_short_name` 应是品牌简称（如「晶铭服饰」），不是一句广告语；广告语可进 `intro` 或 `advantages`
4. 汇报时对外说：「名片」和「公司介绍」已分开，不要只说 A/B

## 反例 / 正例

**反例**：`products_services` 末尾粘着「联系人：葛总 159…1688://…」；`advantages`、`trust` 为空。  
**正例**：联系方式只在 baseinfo；profile 四段各有实质内容，写文时可分别引用。
