---
title: JavaScript 语言特性
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
  - templates/coding/javascript/spec.md
---
# JavaScript 语言特性（templates/coding/javascript/features.md）

> JavaScript 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 JavaScript 独有或版本特定的特性。

## 1. 版本基线

- ES2022+（Node.js 20+ / Bun 1.x / Deno 1.x）
- 工具链：Node.js + npm/pnpm/bun + esbuild/webpack

## 2. 核心特性

### 顶级 await

ES2022；ESM 模块顶层可直接 `await`

### `#private` 字段

ES2022；`#x` 真私有，运行时不可访问

### `Object.hasOwn()`

ES2022；替代 `Object.prototype.hasOwnProperty.call`

### `Array.prototype.at()`

ES2022；`arr.at(-1)` 取末尾，替代 `arr[arr.length-1]`

### Error cause

ES2022；`new Error("msg", { cause: originalError })` 保留原始堆栈

## 3. 模块与可见性

JavaScript 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

JavaScript 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 JavaScript 关键词时自动关联工具链。
