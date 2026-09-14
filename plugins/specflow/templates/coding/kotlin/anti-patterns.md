---
title: Kotlin 反模式与易错点
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
# Kotlin 反模式与易错点（templates/coding/kotlin/anti-patterns.md）

> Kotlin 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```kotlin
`!!` 非空断言
```

1.2 ✅ Good
```
KotlinIC 代码异味；用 `?` / `?:` / smart cast
```

### 2.1 ❌ Bad
```kotlin
`GlobalScope.launch { }`
```

2.2 ✅ Good
```
无结构化并发；泄漏；用 `viewModelScope` / `lifecycleScope`
```

### 3.1 ❌ Bad
```kotlin
`is X` 后未用 smart cast
```

3.2 ✅ Good
```
`is` 检查后编译器自动 cast；不需显式 `as`
```

### 4.1 ❌ Bad
```kotlin
`data class` 含 `var` 字段
```

4.2 ✅ Good
```
值对象应不可变；用 `val` 或 `copy()` 修改
```

## 2. 错误处理

### 1.1 ❌ Bad
```kotlin
`companion object { var x = ... }` 全局状态
```

1.2 ✅ Good
```
测试困难；用依赖注入
```

### 2.1 ❌ Bad
```kotlin
`inline fun` 大函数
```

2.2 ✅ Good
```
inlining 大函数增加字节码；只 inline 接受函数类型参数的小函数
```

### 3.1 ❌ Bad
```kotlin
`internal` 模块跨 module 依赖
```

3.2 ✅ Good
```
`internal` 仅同 module 可见；跨 module 用 `public`
```

### 4.1 ❌ Bad
```kotlin
`runBlocking { }` in Android main
```

4.2 ✅ Good
```
阻塞 UI 线程；用 `lifecycleScope.launch`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
