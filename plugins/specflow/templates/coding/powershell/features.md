---
title: PowerShell 语言特性
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
# PowerShell 语言特性（templates/coding/powershell/features.md）

> PowerShell 的现代特性清单——模型可能不全知道的部分。
> 与语言无关的通用编程概念不在此列；本文件聚焦 PowerShell 独有或版本特定的特性。

## 1. 版本基线

- Windows PowerShell 5.1（Windows 自带）+ PowerShell 7.x（pwsh，跨平台）
- 工具链：pwsh + PSScriptAnalyzer + PlatyPS

## 2. 核心特性

### PS 5.1 vs 7.x 差异

7+: 三元运算符 `? :` / null 合并 `??` / 管道链 `&&`/`||` / `ConvertFrom-Json -AsHashtable` / `ForEach-Object -Parallel`

### `$PSNativeCommandArgumentPassing`

PS 7.3+；原生命令参数传递方式（兼容性切换）

### `$ErrorActionPreference`

全局错误处理策略；`Stop` / `Continue` / `SilentlyContinue`；脚本开头显式设置

### `cmdlet` 设计模式

Verb-Noun 命名；`Get-Verb` 查批准动词；参数 `[Parameter(Mandatory)]`

### `$PSCmdlet.ShouldProcess()`

`-WhatIf` / `-Confirm` 支持；支持 ShouldProcess 的 cmdlet 才有这两个参数

## 3. 模块与可见性

PowerShell 的模块/可见性规则——不同语言差异大，需按语言记忆。

## 4. 并发模型

PowerShell 的并发原语——不同语言模型差异显著（async/await / goroutine / actor / 显式锁）。

## 5. 工具链集成

参见 `toolchains.json`（仓库根）——hook 检测到 PowerShell 关键词时自动关联工具链。
