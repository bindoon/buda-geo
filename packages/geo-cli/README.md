# geo-cli

Node.js CLI：GEO 项目知识库清洗与校验（Part A / clean）。可发布至 npm。

## 安装

**仓库内开发：**

```bash
cd packages/geo-cli
npm install
npm run build
npm link   # 可选：全局 geo-cli
```

**发布后：**

```bash
npm install -g geo-cli
```

## 用法

从仓库根目录：

```bash
geo-cli projects list
geo-cli projects resolve "华远"
geo-cli inventory --project projects/南通市海门华远工具厂
geo-cli clean --project projects/南通市海门华远工具厂
geo-cli validate --project projects/南通市海门华远工具厂
geo-cli review-clean --project projects/南通市海门华远工具厂
geo-cli confirm-clean --project projects/南通市海门华远工具厂
```

客户映射在 `projects/registry.json`（非 Skill 正文）。`resolve` 输出 `path` 后用于 `--project`。

开发未 link 时：

```bash
cd packages/geo-cli && npm run dev -- projects resolve "华远"
```

## 命令

| 命令 | 作用 |
|------|------|
| `projects list` | 列出 `registry.json` 中所有客户 |
| `projects resolve <query>` | 简称/公司名/app_id → `path` |
| `inventory` | 分类并逐文件哈希 `inputs/`（法人身份证 → ignored） |
| `parse-form` | 信息收集表 → `company.baseinfo.json` |
| `parse-keywords` | 独立解析原始词表的兼容命令；不属于 clean 流程 |
| `clean` | 生成来源索引、精简事实底账、baseinfo/profile/skus 与 manifest；不生成下游 GEO 策略 |
| `validate` | 分别输出结构、引用、语义与安全检查；`--no-strict` 忽略 block missing |
| `review-clean` | 生成项目根 `clean-review.md`，按必须修正、重点待确认、冲突、建议和业务内容组织 |
| `confirm-clean` | 无 block 且人工复核后生成不可变事实快照；不记录确认人 |
| `status` | 打印 manifest |

## 目录结构

```
packages/geo-cli/
  package.json      # bin: geo-cli → dist/cli.js
  schemas/          # JSON Schema（随包发布）
  src/
    cli.ts
    lib/
  dist/             # npm run build
```

不修改 `inputs/`。CLI 不含客户名或具体 SKU；产品归桶、事实来源、冲突选择、明显错填字段的规范值和人工语义问题由 Skill/运营写入项目级 `knowledge/clean.overrides.json`，CLI 再确定性执行。规范值作为待确认的 `operator` 事实保留，原始候选不会被删除。图片不进入 Facts：原图在 source index，可用配图关系在 SKU images，OSS 在 publish 阶段再处理。

`clean` 的边界是“可追溯的企业事实”。关键词、需求场景、受众画像、FAQ、prompts、诊断题和 generation plan 必须在企业事实确认后的对应阶段生成；旧文件可迁移保留，但 clean 不创建或刷新。

## 测试

```bash
cd packages/geo-cli
npm test
```

测试覆盖稳定 ID、Schema/引用校验、敏感信息排除、语义 blocker、冲突解决、确认门和幂等 re-clean。

## 发布 npm（维护者）

```bash
npm run build
npm publish --access public   # 若包名未被占用
```
