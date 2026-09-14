---
title: C 语言特性
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
# C 语言特性（templates/coding/c/features.md）

> C 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 C 独有或版本特定的特性。

## 1. 版本基线

- C11/C17（gcc 11+ / clang 14+）
- 工具链：gcc/clang + make/CMake + pkg-config

## 2. 核心特性

### `_Generic` 泛型选择

C11 引入，编译期按类型选分支；用于实现类型安全的宏

### `_Static_assert`

编译期断言；常用于检查结构体大小、枚举值范围

### `<stdatomic.h>` 原子操作

C11 原子类型与内存序；替代 `__sync_*` 内建

### `<threads.h>` 线程

C11 标准线程；POSIX 替代方案，可移植但功能有限

### 指定初始化器

`.field = value` 形式；C99 起支持，避免字段顺序错误

## 3. 模块与可见性

C 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

C 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 C 关键词时自动关联工具链。
