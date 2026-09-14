---
title: Shell（POSIX sh + Bash） 反模式与易错点
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
  - templates/coding/shell/spec.md
---
# Shell（POSIX sh + Bash） 反模式与易错点（templates/coding/shell/anti-patterns.md）

> Shell（POSIX sh + Bash） 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```shell
`for x in $(ls)`
```

1.2 ✅ Good
```
文件名含空格/特殊字符出错；用 `for x in *.txt` 或 `find` + `-print0`
```

### 2.1 ❌ Bad
```shell
`$VAR` 不加引号
```

2.2 ✅ Good
```
分词 + 通配符展开；用 `"$VAR"`
```

### 3.1 ❌ Bad
```shell
`cd dir; do_stuff`
```

3.2 ✅ Good
```
cd 失败仍执行后续；用 `cd dir && do_stuff`
```

### 4.1 ❌ Bad
```shell
`function foo() { }`
```

4.2 ✅ Good
```
`function` 关键字非 POSIX；用 `foo() { }`
```

## 2. 错误处理

### 1.1 ❌ Bad
```shell
`echo -e "..."`
```

1.2 ✅ Good
```
`-e` 不跨平台（dash 不支持）；用 `printf "%s\n" "..."`
```

### 2.1 ❌ Bad
```shell
`eval "$var"`
```

2.2 ✅ Good
```
注入风险；用 `bash -c` 或参数化
```

### 3.1 ❌ Bad
```shell
`x=`cmd` ` 用反引号
```

3.2 ✅ Good
```
不可嵌套；用 `$(cmd)`
```

### 4.1 ❌ Bad
```shell
`#!/bin/sh` 但用 Bash 语法
```

4.2 ✅ Good
```
POSIX sh 不支持 `[[ ]]` / 数组 / `local`；改 `#!/usr/bin/env bash`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
