---
title: 插件 vs 项目边界分离
type: adr
status: active
decided_at: 2026-09-01
deciders: [specflow]
---

# ADR-001: 插件 vs 项目边界分离

## 背景

早期版本（v0.1~v0.2）把「插件实现」和「项目内容」都复制到目标项目目录：每项目
60+ 文件重复、升级需逐项目重跑、用户分不清哪些是插件的、配置边界漂移。

## 决策

**插件只装全局（现经 marketplace 分发），项目级只生成配置文件与目录骨架。**

| 内容 | 插件侧 | 项目侧 |
|------|--------|--------|
| mcp/ / scripts/ / prompts/ / hooks/ / spec/ / rules/ / templates | ✅ 实现与模板源 | ❌ |
| AGENTS.md | 插件使用说明 | 项目规则（init 生成，用户自由编辑） |
| 项目配置 / 运行时目录 | ❌ | ✅（`.specflow/`，见 ADR-007） |
| git hooks / .gitignore / docs/ | ❌ | ✅（init 安装/生成） |

init 生成：项目级 AGENTS.md、`.specflow/config.md`、docs/ 目录骨架、`.codexignore`、
git hooks 安装、.gitignore。

## 候选方案

| 方案 | 结论 |
|------|------|
| A. 项目级复制全部插件文件 | 拒绝（升级噩梦） |
| **B. 插件只装全局，项目级仅配置** | **采纳** |
| C. symlink 指向插件 | 拒绝（Windows/git 不友好） |
| D. 最小集复制 + 按需拉取 | 拒绝（实现复杂） |

## 影响

- 新增 `scripts/lib/init-project.py` + `scripts/{sh,ps}/init-project.{sh,ps1}`
  双轨入口 + 12 份项目模板（templates-project/）
- 用户流程：注册 marketplace / 启用插件（一次）→ 每项目 init 生成骨架
- 多项目共享插件源，升级一处生效
- 项目级与全局配置边界清晰；git hooks 只装进项目 `.git/hooks/`

## 回滚

恢复 `--target` 项目级复制模式并删除初始化器；成本中等，不影响已初始化项目。

## 关联

- 下游实现：`scripts/lib/init-project.py`、`templates-project/`
- 相关 ADR：ADR-002（init 生成的 config.md 亦用 Markdown 格式）、ADR-007
  （项目级目录统一 `.specflow/`）
