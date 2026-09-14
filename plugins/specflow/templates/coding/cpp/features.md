---
title: C++ 语言特性
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
  - templates/coding/cpp/spec.md
---
# C++ 语言特性（templates/coding/cpp/features.md）

> C++ 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 C++ 独有或版本特定的特性。

## 1. 版本基线

- C++17/20（gcc 11+ / clang 14+ / MSVC 19.30+）
- 工具链：CMake 3.20+ + vcpkg/conan + clang-format

## 2. 核心特性

### 结构化绑定

C17 `auto [a, b] = pair;`；C20 可用于元组、结构体、数组

### `constexpr if`

C17 编译期分支；模板元编程替代 SFINAE

### Concepts

C20 `template<typename T> requires Integral<T>`；约束模板参数

### Ranges

C20 `views::filter | views::transform`；惰性求值链式

### `<=>` 飞船运算符

C20 三路比较；自动生成 `<`/`==`/`>` 等运算符

## 3. 模块与可见性

C++ 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

C++ 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 C++ 关键词时自动关联工具链。
