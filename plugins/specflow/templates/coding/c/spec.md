---
title: C 语言规范
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
  - templates/coding/c/spec.md
---
# C 语言规范（templates/coding/c/spec.md）

> 按需加载层：session-start 检测到主语言为 C 时提示读取；
> 与语言无关的通用基线见 `spec/coding-standards.md`；安全补充见 `templates/coding/security.md`。
> v0.8.0 智能提示：本文件不主动注入；agent 在用户问到 C 具体问题时按需 Read。

## 1. 基线

- 语言版本：C11/C17（gcc 11+ / clang 14+）
- 工具链：gcc/clang + make/CMake + pkg-config
- 模板文件：本目录 `features.md` / `standards.md` / `anti-patterns.md` / `docs.md` 配套使用

## 2. 语法基线

参见 `features.md`（语言特性清单）；本节只列总览。

## 3. 类型系统

参见 `features.md`；C 的类型系统是该语言的核心特性之一。

## 4. 错误处理

参见 `anti-patterns.md`（反模式与易错点）；错误处理是 C 高频踩坑区。

## 5. 包管理

参见 `standards.md`（编码规范）的「包/依赖管理」节。

## 6. 工具链

参见 `toolchains.json`（仓库根）——语言与工具链配对配置；hook 检测到 C 项目时自动关联对应工具链的提示。
