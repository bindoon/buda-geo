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
geo-cli clean --project projects/南通市海门华远工具厂
geo-cli validate --project projects/南通市海门华远工具厂
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
| `inventory` | 分类 `inputs/`（法人身份证 → ignored） |
| `parse-form` | 信息收集表 → `company.baseinfo.json` |
| `parse-keywords` | 词表 → `company.keywords.json` |
| `clean` | 一键清洗：A–F + assets + manifest |
| `validate` | Schema / app_id / 本地图 path；`--no-strict` 忽略 block missing |
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

不修改 `inputs/`。配图复制到 `assets/images/`；OSS 在 publish 阶段再处理。

## 发布 npm（维护者）

```bash
npm run build
npm publish --access public   # 若包名未被占用
```
