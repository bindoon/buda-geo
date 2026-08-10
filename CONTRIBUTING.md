# Contributing to Buda GEO

感谢你帮助完善 Buda GEO。这个项目处理企业资料、生成内容和外部发布，因此可追溯性与安全边界优先于“自动化更多”。

## 开发环境

```bash
git clone https://github.com/bindoon/buda-geo.git
cd buda-geo
npm --prefix packages/geo-cli ci
npm --prefix packages/geo-cli test
```

## 提交要求

1. 不提交真实密码、Token、身份证、证照、客户私有资料或平台登录态。
2. 不修改 `projects/*/inputs/` 原件；测试使用临时 fixture 或脱敏样例。
3. 新增阶段能力时必须保留人工闸门、版本/哈希引用和失败状态。
4. 新增发布 adapter 时必须定义认证、限流、费用、幂等、审核状态、错误映射和回执证据；未经显式授权不得外部写入。
5. 更新 CLI 行为时同步 `packages/geo-cli/README.md`、根 README 和 `skills/buda-skills` 对应 reference。
6. Pull Request 前运行完整测试。

## Pull Request 建议

- 说明业务问题、设计边界和不做什么。
- 列出新增/修改的 Schema 与兼容性影响。
- 提供测试，以及可复核的成功和失败路径。
- 避免把竞品专用术语、导出格式或客户数据写入运行时契约。
