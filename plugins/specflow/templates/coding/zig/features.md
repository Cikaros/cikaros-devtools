---
title: Zig 语言特性
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
  - templates/coding/zig/spec.md
---
# Zig 语言特性（templates/coding/zig/features.md）

> Zig 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 Zig 独有或版本特定的特性。

## 1. 版本基线

- Zig 0.11+（注意：0.12 API 变动较大，需锁版本）
- 工具链：zig build + build.zig

## 2. 核心特性

### 显式分配器

每个分配 API 接收 Allocator 参数；不隐藏分配

### `comptime`

编译期求值；泛型、代码生成都用 comptime

### 错误集

`ErrorSet` 类型；`!T` 是 `T | ErrorSet` 联合；`try` / `catch` 处理

### 切片类型

`[]T`（切片）/ `[*]T`（多指针）/ `[*c]T`（C 指针）；区分明确

### `defer` / `errdefer`

作用域结束清理；errdefer 仅错误路径执行

## 3. 模块与可见性

Zig 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

Zig 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 Zig 关键词时自动关联工具链。
