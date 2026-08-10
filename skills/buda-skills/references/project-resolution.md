# 项目解析（多客户）

客户信息**不在 Skill 里**，在仓库 `projects/registry.json`。新增 B 公司时只改 registry + 建 `projects/{目录名}/`，**不要改 SKILL.md**。

## 解析顺序

1. 用户给了完整路径 → 直接用 `--project projects/{目录名}`
2. 用户口述简称 / 公司名 → `geo-cli projects resolve "<query>"`
3. 用户只说「清洗 / GEO」没说哪家 → `geo-cli projects list`，展示后让用户选一句
4. resolve 返回多个候选 → 列出 `dir` + `app_id`，只问用户选哪一个

## registry 条目格式

```json
{
  "dir": "客户目录名（与 projects/ 下文件夹一致）",
  "app_id": "唯一 snake_case id",
  "aliases": ["口语简称", "常见口误"],
  "notes": "可选备注"
}
```

##  onboard 新客户（A 做完做 B）

1. 创建 `projects/{公司全称或约定目录名}/inputs/`，放入四件套（见 `clean-enterprise.md` 识别规则，**按文件名模式，不按公司名**）
2. 在 `registry.json` 的 `projects` 数组追加一条（`dir`、`app_id`、`aliases`）
3. 跑 `geo-cli inventory --project projects/{dir}` 确认 inputs 分类
4. 走标准 clean 流程

`app_id` 一经写入 knowledge/manifest 勿随意改；与 `company.*.json` 内 `app_id` 保持一致。

## CLI

```bash
geo-cli projects list
geo-cli projects resolve "华远"
geo-cli projects resolve "晶铭"
```

resolve 成功输出 JSON：`dir`、`app_id`、`path`、`match`。
