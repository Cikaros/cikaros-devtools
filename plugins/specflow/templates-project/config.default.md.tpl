---
title: "{{project.name}} 团队基线配置"
type: config
semantic: rule
version: 0.1.0
last_modified: "{{today}}T00:00:00+08:00"
author: "{{env.USERNAME}}"
status: draft
---

# {{project.name}} 团队基线（config.default.md）

> 用途（REQUIREMENTS §8）：团队级默认配置基线——`config.md` 未勾选的项按本文件
> 的默认值生效（config.md > config.default.md > 插件内置默认）。
> 由引导式初始化生成（v0.6.0 / A9），草稿状态；团队评审后改为 active。

## 工作流默认

- [x] 阶段推进前必须通过产出检查（advance 门禁）
- [x] testing 阶段离开前必须通过真实测试（B1，.specflow/test-executor.json）
- [ ] 严格模式（未完成 TODO 标记拒绝提交，SPECFLOW_PRECOMMIT_STRICT=1）

## 质量基线

- [x] pre-commit 高敏隐私检测（密钥/证件/银行卡）必须通过
- [x] lint 失败警告但不阻塞（阻塞需勾选严格模式）
- [ ] 提交信息遵循 Conventional Commits

## 文档版本

- [x] 阶段产出文档自动 minor bump（v0.6.0 / A8，advance 时触发）
- [ ] 产出文档必须带合规 frontmatter（--strict-schema 校验）

## 语言规范来源

- [x] 内置模板：templates/coding/{typescript,python,go,java}/spec.md
- [x] 项目自定义：.specflow/languages/<lang>.md（优先于内置）

## 脱敏规则

- [x] 规则单源 rules/sensitive-rules.json（12 条，high/low 分级，Luhn 卡号校验）
