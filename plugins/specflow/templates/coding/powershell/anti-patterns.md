---
title: PowerShell 反模式与易错点
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
  - templates/coding/powershell/spec.md
---
# PowerShell 反模式与易错点（templates/coding/powershell/anti-patterns.md）

> PowerShell 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```powershell
`Write-Host "result"`
```

1.2 ✅ Good
```
不进管道；用 Write-Output 或直接输出字符串；Write-Host 仅用于用户交互
```

### 2.1 ❌ Bad
```powershell
`Invoke-Expression "..."`
```

2.2 ✅ Good
```
注入风险 + 性能差；用 `&` 调用或 `ScriptBlock`
```

### 3.1 ❌ Bad
```powershell
`Where-Object { $_.X -eq "Y" }` 可用 `?`
```

3.2 ✅ Good
```
PS 7+ 用 `Where-Object X -eq "Y"` 简化语法
```

### 4.1 ❌ Bad
```powershell
`$null -eq $x` 在 PS 5.1
```

4.2 ✅ Good
```
PS 5.1 把 `$null` 放左侧避免数组枚举；PS 7 行为一致但仍推荐 `$null -eq $x`
```

## 2. 错误处理

### 1.1 ❌ Bad
```powershell
`Get-Content big.log` 不带 `-Raw`
```

1.2 ✅ Good
```
逐行读慢；大文件用 `-Raw` 或 `[System.IO.File]::ReadAllText`
```

### 2.1 ❌ Bad
```powershell
`cmd /c "dir"` 简单操作
```

2.2 ✅ Good
```
PowerShell 原生 `Get-ChildItem` 更可移植
```

### 3.1 ❌ Bad
```powershell
`"path" + "\" + "file"`
```

3.2 ✅ Good
```
用 `Join-Path` 处理路径分隔符
```

### 4.1 ❌ Bad
```powershell
`$ErrorActionPreference = "Stop"` 无 try/finally
```

4.2 ✅ Good
```
中途异常不恢复；用 try/finally 或 scope-local `$ErrorActionPreference`
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
