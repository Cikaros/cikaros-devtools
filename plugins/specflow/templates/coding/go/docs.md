---
title: Go 文档规范
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
  - templates/coding/go/spec.md
---

# Go 文档规范（templates/coding/go/docs.md）

> 本文是 Go 项目的文档与注释规范，覆盖行内注释、godoc 函数文档、README 结构、
> godoc / pkg.go.dev 生成与 Changelog 约定。语言规范基线见
> `templates/coding/go/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 Effective Go 文档章节。

## 1. 行内注释与文件头

### 1.1 行内注释规则

- 注释解释「为什么」而非「做什么」：代码本身已表达做什么，注释补意图与约束。
- 一行注释紧贴被解释代码上方；超过 3 行的逻辑注释应抽成命名函数让代码自解释。
- 禁止保留被注释掉的死代码（git 历史已存）；review 时直接拒绝。
- TODO 必须带 issue 号：`// TODO(#1234): retry logic for 5xx`。
- 注释必须是完整句子，以被注释标识符开头（godoc 规范）：

```go
// FetchUser returns the user with the given ID, or nil if not found.
// It does not return an error for missing users; callers should check
// the returned pointer for nil.
func FetchUser(ctx context.Context, id string) (*User, error) { ... }
```

### 1.2 包级 doc comment

每个包用单独的 `doc.go` 文件或在 `package` 声明上方写包 doc comment：

```go
// Package order implements the order domain: placement, cancellation,
// and refund rules. All methods are pure functions; DB access is injected
// via the Repository interface.
//
// This package does not handle HTTP/RPC protocol concerns; see package api.
package order
```

约束：包 doc comment 描述「包做什么、不做什么、依赖什么」；
禁止复述包名与文件名（包名 `order` 不写「order package does order things」）。

## 2. godoc 函数文档

### 2.1 导出符号的 doc comment 模板

```go
// FetchUser returns the user with the given ID.
//
// It returns (nil, nil) when the user does not exist; callers must check
// the returned pointer. Errors are returned only for transport or
// authorization failures.
//
// The context must carry a trace ID; missing trace IDs are logged but
// do not fail the call.
//
// Example:
//
//	user, err := FetchUser(ctx, id)
//	if err != nil { return err }
//	if user == nil { return ErrUserNotFound }
func FetchUser(ctx context.Context, id string) (*User, error) {
    // ...
}
```

### 2.2 doc comment 强制规则

- 所有导出符号（函数、类型、变量、常量、方法）必须有 doc comment，且以标识符名开头。
- doc comment 必须描述「语义、约束、副作用、错误条件」；
  签名已表达的（参数类型、返回值类型）不重复。
- Example 必须可运行（用缩进代码块格式，godoc 渲染为代码）。
- Deprecated 标注：`// Deprecated: use FetchUserV2 since v2.0, which supports pagination.`。

### 2.3 类型与字段注释

```go
// Order represents an immutable order aggregate.
// The total is derived from Items; do not set Total directly.
type Order struct {
    // ID is the order's UUID v4 identifier.
    ID string

    // Items is the order line items; empty tuple means placeholder
    // before settlement.
    Items []OrderItem
}
```

导出类型的字段必须有 doc comment；非导出字段可省略但应在类型 doc comment 中说明。
字段 doc comment 以字段名开头（godoc 渲染为字段描述）。

## 3. README 结构

### 3.1 标准段落顺序

1. **标题 + 一句话定位**：包名 + 解决什么问题 + 不解决什么问题。
2. **安装**：`go get github.com/cikaros/sdk@latest`，含 Go 版本要求。
3. **快速开始**：可复制粘贴运行的最小示例（< 20 行）。
4. **核心概念**：必要的领域名词解释（与 spec.md 一致）。
5. **API**：链接到 pkg.go.dev，不在 README 重复罗列签名。
6. **配置**：环境变量、配置文件示例、命令行 flag 表格。
7. **测试与发布**：`go test ./...`、`go build`、版本与发布流程。
8. **变更记录**：链接到 `CHANGELOG.md`。
9. **许可证**：链接到 `LICENSE`。

### 3.2 README 写作约束

- 示例代码必须是可运行的完整片段，禁止省略 import 让用户猜。
- 中文项目用中文 README；面向开源的包同时维护英文 README（`README.en.md`）。
- 禁止在 README 出现内部链接、内部代号、未脱敏的配置值。
- 示例代码用 ```` ```go ```` 代码块且必须通过 `go vet` / `gofmt` 校验。

## 4. godoc / pkg.go.dev 配置

### 4.1 本地预览

```bash
# Go 1.19+ 推荐用新版 godoc
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -open .
# 浏览器打开 http://localhost:8080
```

约束：包注释、导出符号 doc comment 必须让 `pkgsite` 无 warning 渲染。
PR 改动公共 API 时本地跑 `pkgsite` 预览，确认渲染正确再提交。

### 4.2 发布到 pkg.go.dev

公开模块发布后 pkg.go.dev 自动抓取；首次发布需在站点触发索引（访问 URL 即触发）。

约束：
- 模块路径必须稳定（`github.com/cikaros/sdk` 而非个人 fork）；
- 主版本号 ≥ 2 时模块路径必须带 `/v2` 后缀（Go 模块规范强制）。
- `go.mod` 的 `module` 指令与发布路径必须一致，否则 pkg.go.dev 无法索引。

### 4.3 godoc 校验 CI

```bash
# 检查所有导出符号都有 doc comment
go run golang.org/x/tools/cmd/godoc@latest -analysis=type -http=:6060 &
# 或用 staticcheck 的 ST1000 / ST1020 / ST1021 规则
golangci-lint run --enable stylecheck
```

`ST1000`（包注释缺失）、`ST1020`（导出符号注释不以标识符开头）必须零容忍。

## 5. Changelog 约定

### 5.1 Keep a Changelog 格式

`CHANGELOG.md` 顶部为未发布版本 `[Unreleased]`，下方为已发布版本倒序排列：
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六个段落。

```markdown
## [Unreleased]

### Added
- `FetchUser(ctx, id, opts...)` 支持 context 超时 (#123)

### Fixed
- 修复 `ParseAmount` 在空字符串时 panic (#124)

## [1.2.0] - 2026-09-01

### Changed
- **BREAKING**: `FetchUser` 返回 `(*User, error)` 而非 `(User, error)`
```

### 5.2 与版本号的衔接

Go 模块遵循语义化版本（`v1.2.0`）；`BREAKING CHANGE` 必须触发主版本号提升，
且模块路径带 `/vN` 后缀。提交信息用 Conventional Commits（`feat:` / `fix:` 等），
合并到 main 时由 `release-please` 或 `goreleaser` 自动追加到 `CHANGELOG.md` 的 `[Unreleased]`。
发布流程：`git tag v1.2.0` → `git push origin v1.2.0` → goreleaser 自动构建并发布。
