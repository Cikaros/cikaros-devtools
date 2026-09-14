---
title: Zig 反模式与易错点
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
# Zig 反模式与易错点（templates/coding/zig/anti-patterns.md）

> Zig 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```zig
`var x = try allocator.alloc(u8, n);` 无 `defer`
```

1.2 ✅ Good
```
泄漏；用 `defer allocator.free(x);`
```

### 2.1 ❌ Bad
```zig
`@intCast(x)` 无范围检查
```

2.2 ✅ Good
```
截断 UB；用 `@intCast` 后检查或 `std.math.cast`
```

### 3.1 ❌ Bad
```zig
`catch unreachable` 在非 std 路径
```

3.2 ✅ Good
```
掩盖错误；显式处理或 `catch unreachable` 仅在证明不可能时
```

### 4.1 ❌ Bad
```zig
`orelse unreachable`
```

4.2 ✅ Good
```
同上；用 `orelse default_value` 或 `try`
```

## 2. 错误处理

### 1.1 ❌ Bad
```zig
`extern struct` 用于纯 Zig
```

1.2 ✅ Good
```
extern struct 是 ABI 兼容用；纯 Zig 用普通 struct
```

### 2.1 ❌ Bad
```zig
裸 `*T` 当 `[]T` 用
```

2.2 ✅ Good
```
`*T` 单指针；切片用 `[]T`（含长度）
```

### 3.1 ❌ Bad
```zig
`unreachable` 在 hot path
```

3.2 ✅ Good
```
panic 有开销；用 `assert` 仅 debug 模式
```

### 4.1 ❌ Bad
```zig
`std.debug.print` in release
```

4.2 ✅ Good
```
debug 模式才输出；release 用 `std.log`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
