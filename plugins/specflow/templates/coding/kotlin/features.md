---
title: Kotlin 语言特性
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
  - templates/coding/kotlin/spec.md
---
# Kotlin 语言特性（templates/coding/kotlin/features.md）

> Kotlin 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 Kotlin 独有或版本特定的特性。

## 1. 版本基线

- Kotlin 1.9+（JVM 17+ / Android API 21+ / KMP）
- 工具链：Gradle (Kotlin DSL) + kotlin-multiplatform + AGP

## 2. 核心特性

### 协程结构化并发

`suspend` 函数 + `CoroutineScope`；`coroutineScope { }` 等待子任务

### `data class`

自动生成 equals/hashCode/toString/copy；值对象首选

### `sealed class`/`sealed interface`

有限封闭层次；`when` 表达式穷举检查

### 扩展函数

`fun String.isEmail(): Boolean`；不修改原类，零开销

### `by lazy`

首次访问时初始化；线程安全（默认 `LazyThreadSafetyMode.SYNCHRONIZED`）

## 3. 模块与可见性

Kotlin 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

Kotlin 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 Kotlin 关键词时自动关联工具链。
