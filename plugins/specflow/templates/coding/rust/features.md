---
title: Rust 语言特性
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
  - templates/coding/rust/spec.md
---
# Rust 语言特性（templates/coding/rust/features.md）

> Rust 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 Rust 独有或版本特定的特性。

## 1. 版本基线

- Rust 2021 edition（rustc 1.70+）
- 工具链：cargo + rustup + cargo-nextest + cargo-deny + cargo-audit

## 2. 核心特性

### 所有权与借用

编译期保证内存安全；`&T` 共享借用，`&mut T` 独占借用

### `Result` / `Option`

无异常；用 `?` 传播错误，`match` 或 `if let` 解构

### `Cow<T>` 写时克隆

可能借用可能拥有；避免无谓 clone

### `impl Trait` 返回类型

隐藏具体类型；动态分发用 `Box<dyn Trait>`

### `async` / `await`

零成本异步；基于 `Future` trait；运行时可选（tokio/async-std）

## 3. 模块与可见性

Rust 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

Rust 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 Rust 关键词时自动关联工具链。
