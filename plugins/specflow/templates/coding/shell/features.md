---
title: Shell（POSIX sh + Bash） 语言特性
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-03T00:00:00+08:00
author: Cikaros
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
  - templates/coding/shell/spec.md
---
# Shell（POSIX sh + Bash） 语言特性（templates/coding/shell/features.md）

> Shell（POSIX sh + Bash） 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 Shell（POSIX sh + Bash） 独有或版本特定的特性。

## 1. 版本基线

- POSIX sh / Bash 5.x（macOS 自带 3.2 需 brew install bash）
- 工具链：shellcheck + shfmt + bats（测试）

## 2. 核心特性

### `set -euo pipefail`

错误即退（e）/ 未定义变量即错（u）/ 管道失败传递（pipefail）

### `[[ ]]` vs `[ ]`

`[[ ]]` 是 Bash 扩展，支持 `=~` 正则、`&&`/`||` 内置；`[ ]` 是 POSIX

### `trap` 信号处理

`trap cleanup EXIT INT TERM` 退出前清理

### `local` 变量

函数内 `local x=1` 防止污染全局

### 数组 `${arr[@]}`

Bash 数组用 `"${arr[@]}"` 展开（带引号防分词）

## 3. 模块与可见性

Shell（POSIX sh + Bash） 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

Shell（POSIX sh + Bash） 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 Shell（POSIX sh + Bash） 关键词时自动关联工具链。
