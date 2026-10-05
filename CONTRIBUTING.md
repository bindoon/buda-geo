# 参与贡献 Buda GEO

感谢你愿意一起完善这个开源项目。Buda GEO 处理企业资料、生成内容和外部发布，因此**可追溯性与安全边界**优先于「自动化更多」。

无论你是修文档、补测试、加探测平台配置，还是实现发布 adapter，都欢迎。不确定从哪下手时，可以开 Issue 描述场景，我们一起收窄范围。

## 开发环境

```bash
git clone https://github.com/bindoon/buda-geo.git
cd buda-geo
npm --prefix packages/geo-cli ci
npm --prefix packages/geo-cli test
```

可选：`npm --prefix packages/geo-cli run build && npm --prefix packages/geo-cli link`，然后用 `geo-cli` 在仓库根目录试跑。

仓库内样板项目是 `projects/知鱼`，适合查看产物形状；新增测试请用临时 fixture 或脱敏样例，不要依赖真实客户原件。

## 提交要求

1. 不提交真实密码、Token、身份证、证照、客户私有资料或平台登录态。
2. 不修改 `projects/*/inputs/` 原件；测试使用临时 fixture 或脱敏样例。
3. 新增阶段能力时必须保留人工闸门、版本/哈希引用和失败状态。
4. 新增发布 adapter 时必须定义认证、限流、费用、幂等、审核状态、错误映射和回执证据；未经显式授权不得外部写入。
5. 更新 CLI 行为时同步 `packages/geo-cli/README.md`、根 README 和 `skills/buda-skills` 对应 reference。
6. Pull Request 前运行完整测试：`npm --prefix packages/geo-cli test`。

## 欢迎的贡献类型

- **文档与 DX**：README、示例、错误提示、英文补充。
- **探测**：新的 OpenAI-compatible 平台配置示例与回归测试。
- **发布 adapter**：按统一回执契约接入具体渠道（需安全与幂等说明）。
- **校验与测试**：Schema、引用、失败分母、闸门、哈希审稿等边界用例。
- **周边能力**：诊断差异报告、站点审计等，需说明与现有闸门的关系。

## Pull Request 建议

- 用一两句话说明解决了什么问题，以及**刻意不做什么**。
- 列出新增/修改的 Schema 与兼容性影响。
- 提供测试，以及可复核的成功和失败路径。
- 避免把竞品专用术语、导出格式或客户数据写入运行时契约。
- 小步提交通常比大而全的重构更容易合并。

## 行为约定

默认假设贡献者善意。讨论时聚焦技术方案与安全边界；涉及客户数据或安全漏洞时，优先走 [SECURITY.md](./SECURITY.md)，不要贴到公开 Issue。
