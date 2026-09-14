---
title: C 反模式与易错点
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
# C 反模式与易错点（templates/coding/c/anti-patterns.md）

> C 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```c
`int x = INT_MAX + 1;`
```

1.2 ✅ Good
```
用 `<stdint.h>` 的 `INT32_MAX` 并检查溢出；有符号溢出是 UB
```

### 2.1 ❌ Bad
```c
`char *p = malloc(strlen(s));`
```

2.2 ✅ Good
```
忘记 +1 给 `\0`；用 `strlen(s) + 1`
```

### 3.1 ❌ Bad
```c
`memcpy(dst, src, sizeof(src));`
```

3.2 ✅ Good
```
`sizeof` 数组退化为指针；用 `sizeof(src)` 仅在源是数组时正确
```

### 4.1 ❌ Bad
```c
`if (p = malloc(n))`
```

4.2 ✅ Good
```
`=` 而非 `==`；gcc `-Wparentheses` 警告但非错误
```

## 2. 错误处理

### 1.1 ❌ Bad
```c
`printf("%d", sizeof(long));`
```

1.2 ✅ Good
```
用 `%zu` 而非 `%d`；`sizeof` 返回 `size_t`
```

### 2.1 ❌ Bad
```c
`gets(buf)`
```

2.2 ✅ Good
```
C11 起完全移除；用 `fgets(buf, size, stdin)`
```

### 3.1 ❌ Bad
```c
`strncpy(dst, src, n)` 不写 `\0`
```

3.2 ✅ Good
```
strncpy 不保证终止；显式 `dst[n-1] = '\0';`
```

### 4.1 ❌ Bad
```c
`typedef struct { ... } *Ptr;`
```

4.2 ✅ Good
```
隐藏指针类型；显式 `typedef struct { ... } Name;` 后用 `Name *`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
