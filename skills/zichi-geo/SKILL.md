---
name: zichi-geo
description: >
  紫驰 GEO 本地交付工作流：客户资料清洗为标准知识库 JSON、manifest 校验、后续诊断写文发布。
  只要用户提到 GEO、知识库、清洗、clean、validate、geo-cli、manifest、missing、信息收集表、
  关键词问题库、新客户 onboard、或口述任意客户/公司/项目名，都应使用本 skill。
  多客户环境下先解析项目（registry + geo-cli projects resolve），勿假设单一客户。
---

# zichi-geo

通用工作流 Skill：**不含任何客户名单**。客户映射在 `projects/registry.json`；解析方法见 `references/project-resolution.md`。

仓库根：`geo/`。客户数据：`projects/{目录名}/`。CLI：`packages/geo-cli`（`geo-cli`）。

## 第一步：锁定项目（每次任务必做）

| 用户给了什么 | 你怎么做 |
|--------------|----------|
| `projects/...` 路径 | 直接用该路径 |
| 公司名 / 简称 / app_id | `geo-cli projects resolve "<query>"` |
| 没说哪家 | `geo-cli projects list` → 请人话选一家 |

resolve 歧义时**只问一句**让用户选 `dir`，不要猜。

读 `AGENTS.md`（安全与目录约定）。clean 分支再读 `references/clean-enterprise.md`；**汇报前必读** `references/operator-report.md`。

## clean 分支（默认）

对解析出的 `{PROJECT}`（相对路径如 `projects/xxx`）：

```bash
geo-cli inventory --project {PROJECT}
geo-cli clean --project {PROJECT}
geo-cli validate --project {PROJECT}
geo-cli status --project {PROJECT}
```

### 向用户汇报（运营向，必遵 `operator-report.md`）

**读者可能完全不懂技术。** 按 `references/operator-report.md` 固定模板输出，要点：

1. **一句话结论**：能否进入「AI 诊断 / 写文」
2. **原件在哪**：`inputs/` 未改动，列表说明用户当初提供了什么
3. **成果在哪**：`knowledge/`（公司档案）、`assets/images/`（图片）、`manifest.json`（进度单，说「看本汇报即可」）
4. **整理出了什么**：公司名、联系人、产品数、图片数、搜索词/问题数（数字 + 举例，不用 A/B/C 字母除非括号解释）
5. **还缺什么**：用「建议补 / 必须补 / 可选」，**不写** `chat_logs`、`block` 等英文 code
6. **安全一句**：密码已剥离；身份证已跳过（如有）
7. **请您确认**：无必补项时问是否确认「资料整理完成」

技术字段（`app_id`、JSON 文件名、CLI 输出）仅放附录或对方明确要时再写。

无必补项 → 问是否确认；用户确认后更新 `manifest.gates.clean` 为 `confirmed` 并填 `at`/`by`。

未跑 validate 不声称完成。不改 `inputs/`。密码不进 knowledge JSON。

## CLI 调用

```bash
# 已 link
geo-cli projects resolve "用户说的名字"

# 仓库内（新环境）
node packages/geo-cli/dist/cli.js projects list
node packages/geo-cli/dist/cli.js clean --project projects/{dir}

# 未 build
cd packages/geo-cli && npm install && npm run build
```

## 意图路由

| 意图 | 分支 | 参考 |
|------|------|------|
| 清洗 / 知识库 / onboard | clean | `project-resolution.md` + `clean-enterprise.md` |
| 已有 JSON，要诊断 | diagnose | （后续） |
| 写文章 | write | （后续） |
| 发布 | publish | （后续） |
| 上云同步 | sync | Part B |

模糊时只问：「先清洗知识库，还是已有 JSON 直接诊断/写文？」

## 硬规则

- `inputs/` 只读；产物 → `knowledge/`、`assets/`、`manifest.json`
- 配图本地 `assets/`；CDN `url` 仅 publish 阶段
- 无客服记录 → `recommend` `chat_logs`，不阻断
- 识别 inputs 靠**文件名模式**（见 clean-enterprise），不靠客户名写死

## 延伸阅读

| 文件 | 何时读 |
|------|--------|
| `references/operator-report.md` | **clean 完成后对运营汇报（必读）** |
| `references/project-resolution.md` | 多客户解析、新客户 onboard |
| `references/clean-enterprise.md` | clean 细则 |
| `references/schema-knowledge.md` | A–F 字段 |
| `references/prompts-defaults.md` | E/F 默认模板 |
| `projects/registry.json` | 客户 dir / app_id / aliases（数据，非 Skill 正文） |
| `docs/紫驰-GEO工具详细解决方案.md` | 全链路 |
