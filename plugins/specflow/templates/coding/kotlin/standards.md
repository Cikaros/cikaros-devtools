---
title: Kotlin 编码规范
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
# Kotlin 编码规范（templates/coding/kotlin/standards.md）

> Kotlin 专属编码规范——通用的 SOLID/DRY/KISS 见 `spec/coding-standards.md`，不在此重复。

## 1. 命名约定

Kotlin 社区惯例的命名风格（camelCase / snake_case / PascalCase / kebab-case）。

## 2. 格式化

Kotlin 推荐的格式化工具与配置（如 prettier / rustfmt / clang-format / gofmt / EditorConfig）。

## 3. 文件与目录结构

Kotlin 项目的标准目录布局（如 src/ / test/ / build/ / cmake/ / cargo workspace）。

## 4. 错误传播

Kotlin 的错误处理风格——异常 / Result / 多返回值 / panic / exit code。

## 5. 日志

Kotlin 的日志库与日志规范（结构化日志 / 日志级别 / 上下文字段）。

## 6. 测试约定

Kotlin 的测试框架与命名约定（unit / integration / snapshot / property-based）。

## 7. 包/依赖管理

Kotlin 的包管理器与锁文件约定（package.json / Cargo.toml / go.mod / pom.xml / build.gradle）。
