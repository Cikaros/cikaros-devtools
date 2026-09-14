---
title: C# 反模式与易错点
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
  - templates/coding/csharp/spec.md
---
# C# 反模式与易错点（templates/coding/csharp/anti-patterns.md）

> C# 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```csharp
`async void Foo()`
```

1.2 ✅ Good
```
异常无法捕获、调用方无法 await；用 `async Task` 或 `async Task<T>`
```

### 2.1 ❌ Bad
```csharp
`task.Result` / `task.Wait()`
```

2.2 ✅ Good
```
死锁风险（同步上下文）；用 `await task`
```

### 3.1 ❌ Bad
```csharp
`foreach (var x in query)` 多次
```

3.2 ✅ Good
```
LINQ 延迟执行；用 `.ToList()` 缓存
```

### 4.1 ❌ Bad
```csharp
`Nullable<int> x = null;`
```

4.2 ✅ Good
```
用 `int? x = null;` 简写
```

## 2. 错误处理

### 1.1 ❌ Bad
```csharp
`struct` 含可变字段 + 装箱
```

1.2 ✅ Good
```
值类型装箱后修改不影响原值；struct 应不可变或用 class
```

### 2.1 ❌ Bad
```csharp
`GC.Collect()` 手动调用
```

2.2 ✅ Good
```
几乎总是错误；GC 自调度；仅排障时用并附注释
```

### 3.1 ❌ Bad
```csharp
`catch (Exception e) { throw; }` 无逻辑
```

3.2 ✅ Good
```
多余的 catch；删掉让异常自然冒泡
```

### 4.1 ❌ Bad
```csharp
`new List<int>()` 后立即 `Add` 多次
```

4.2 ✅ Good
```
用 collection initializer: `new List<int> { 1, 2, 3 }`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
