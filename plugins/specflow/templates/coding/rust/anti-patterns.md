---
title: Rust 反模式与易错点
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
# Rust 反模式与易错点（templates/coding/rust/anti-patterns.md）

> Rust 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```rust
`.unwrap()` in production
```

1.2 ✅ Good
```
panic on None/Err；用 `?` 或 `unwrap_or` / `unwrap_or_else`
```

### 2.1 ❌ Bad
```rust
`.clone()` 临时
```

2.2 ✅ Good
```
编译器要求时才 clone；优先用引用
```

### 3.1 ❌ Bad
```rust
`Box<dyn Trait>` 当泛型可用
```

3.2 ✅ Good
```
动态分发有性能开销；泛型静态分发
```

### 4.1 ❌ Bad
```rust
`unsafe` 无 safety 注释
```

4.2 ✅ Good
```
每个 unsafe 块需注释说明为何安全
```

## 2. 错误处理

### 1.1 ❌ Bad
```rust
`String` 当 `&str` 可用时
```

1.2 ✅ Good
```
`String` 拥有所有权有分配开销；函数参数优先 `&str`
```

### 2.1 ❌ Bad
```rust
`Vec<u8>` 当 `&[u8]` 可用时
```

2.2 ✅ Good
```
同上；借用优先
```

### 3.1 ❌ Bad
```rust
`Rc<RefCell<T>>` 循环引用
```

3.2 ✅ Good
```
内存泄漏；用 `Weak<T>` 打断循环
```

### 4.1 ❌ Bad
```rust
`tokio::main` 上的阻塞调用
```

4.2 ✅ Good
```
阻塞 runtime 线程；用 `tokio::task::spawn_blocking`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
