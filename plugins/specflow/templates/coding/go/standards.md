---
title: Go 编码规范
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

# Go 编码规范（templates/coding/go/standards.md）

> 本文是 Go 在 specflow 体系下的「可执行编码规范」——命名、格式化、
> 文件与目录结构、import 顺序、错误传播、日志、测试约定。语言规范基线见
> `templates/coding/go/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 Effective Go。

## 1. 命名约定

### 1.1 标识符大小写规则

- 包名：短小、全小写、无下划线（`httputil` 而非 `http_util`）；禁止 `util` / `common` / `helpers`。
- 导出标识符：PascalCase；非导出：camelCase；缩写词全大写或全小写（`URL` / `url`，禁 `Url`）。
- 常量：可与变量同风格（`MaxRetry` 或 `maxRetry`）；不强制 UPPER_SNAKE（Go 惯例）。
- 布尔：`is/has/can/should` 前缀；但 getter 不加 `Get` 前缀（`user.Name()` 而非 `user.GetName()`）。

### 1.2 命名禁忌

- 禁止无信息命名：`data`、`info`、`temp`、`util`（除非在极局部作用域）。
- 禁止 `Interface` / `Impl` 后缀：接口名描述行为（`Reader` 而非 `ReaderInterface`），
  实现类不加 `Impl`（`UserService` 即可，不需要 `UserServiceImpl`）。
- 禁止在包名已表达的信息上重复：`config.Load()` 而非 `config.LoadConfig()`。
- 包名与导出标识符冲突禁止：`user.User` 应改为 `user.Account` 或换包名。

## 2. 格式化与文件结构

### 2.1 格式化基线

- `gofmt` 是唯一格式化标准（禁手调缩进 / 括号风格）；
  `goimports` 在 `gofmt` 基础上自动管理 import 顺序。
- 行宽软上限 100；超过的可读性下降，但 Go 社区不强求硬截断。
- import 分组：标准库 / 第三方 / 本地（同 module），组间空行；未使用 import 必须消除。

### 2.2 目录结构

```
cmd/
  api/main.go        # 薄入口，仅解析 flag 并调用 internal
  worker/main.go
internal/
  order/             # 领域分包
    service.go
    repository.go
    service_test.go
  payment/
pkg/                  # 仅放确需外部复用的库
  client/
go.mod
go.sum
```

约束：标准布局 `cmd/<app>/main.go` 薄入口 + `internal/` 私有实现 + `pkg/` 仅放确需外部复用的库；
禁止把业务逻辑写进 `cmd/`。
`internal/` 下按领域分包，禁止按技术分层分包（`internal/handlers` + `internal/models` 大杂烩）。

### 2.3 文件大小与拆分

- 一个文件一个主导出主体；文件超过 500 行考虑拆分；函数超过 50 行必须有拆分理由。
- `main.go` 只做参数解析与依赖装配，禁止含业务逻辑。
- 测试文件 `xxx_test.go` 与被测文件同目录；同包白盒测试 + 跨包黑盒测试（`xxx_test` 包名）分层。

## 3. import 与依赖

### 3.1 import 风格

```go
import (
    "context"
    "fmt"
    "time"

    "github.com/google/uuid"
    "go.uber.org/zap"

    "github.com/cikaros/sdk/internal/order"
)
```

- 分组排序：标准库 / 第三方 / 本地（同 module），组间空行；用 `goimports` 自动管理。
- 禁止相对路径 import（`./internal/...`）；必须用 module 路径。
- 循环依赖零容忍：Go 编译器强制检测，出现即重构（抽公共包或接口反转）。

### 3.2 依赖管理

- 依赖锁定 `go.sum` 必须提交；CI 用 `go mod verify` 校验。
- 升级策略：patch 走 `go get -u=patch` 自动合并；minor 走人工 PR；major 必须单独 PR + 回归测试。
- `go mod tidy` 提交前必须跑（幂等，清理未使用依赖）。
- 禁止 vendoring（`vendor/` 目录）除非部署环境无外网（如离线内网）。

## 4. 错误传播与日志

### 4.1 错误传播链

- 错误即值：调用点立即判断 `if err != nil`；禁止丢弃（`_ = f()`）除非注释说明为何安全。
- 包装用 `fmt.Errorf("...: %w", err)`（保留错误链，`errors.Is/As` 可判）；
  禁止 `err.Error()` 拼接丢失类型。
- 错误消息小写开头、不带标点（Go 惯例）；上下文由包装层补齐。
- 哨兵错误（`var ErrXxx = errors.New(...)`）仅用于边界 API；
  内部错误用自定义类型携带结构化字段。

### 4.2 日志约定

```go
import "log/slog"

slog.InfoContext(ctx, "user fetched",
    slog.String("trace_id", tid),
    slog.String("user_id", uid))
slog.ErrorContext(ctx, "place order failed", "err", err)
```

- 用结构化日志库 `log/slog`（标准库 1.21+）；禁止 `fmt.Println` 进生产路径。
- 日志字段固定 schema：traceId 由请求中间件注入全链路透传；
  字段名用 snake_case，与跨服务日志对齐。
- 禁止日志输出敏感字段（token、密码、完整身份证号）；超过 4 位的敏感字段做掩码。
- 日志级别：`Error`（需人工介入）、`Warn`（可恢复但需关注）、`Info`（业务事件）、`Debug`（仅本地）。

### 4.3 错误与日志的边界

```go
if err := orderService.Place(ctx, input); err != nil {
    slog.ErrorContext(ctx, "place order failed", "err", err, "trace_id", tid)
    if errors.Is(err, ErrInvalidInput) {
        return writeError(w, 400, "INVALID_INPUT")
    }
    return writeError(w, 500, "INTERNAL")
}
```

边界层（HTTP handler / RPC handler / CLI 入口）统一 catch + 转换为协议错误响应，
消息禁止泄漏堆栈、内部路径、用户 PII（与 `templates/coding/security.md` 一致）。
HTTP / RPC 处理器必须 `defer recover` 并转 5xx。

## 5. 测试约定

### 5.1 测试组织

- 同包白盒测试（`xxx_test.go`，包名与被测相同）+ 跨包黑盒测试（`xxx_test` 包名）分层。
- 表驱动测试优先：

```go
func TestParseAmount(t *testing.T) {
    tests := []struct {
        name  string
        input string
        want  Decimal
    }{
        {"positive", "100.50", Decimal{10050}},
        {"zero", "0", Decimal{}},
        {"negative", "-1.00", Decimal{-100}},
    }
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            got, err := ParseAmount(tt.input)
            if err != nil { t.Fatalf("err: %v", err) }
            if got != tt.want { t.Errorf("got %v want %v", got, tt.want) }
        })
    }
}
```

约束：覆盖错误分支而不只是 happy path；`t.Run` 子测试隔离失败定位。

### 5.2 mock 与夹具

- mock 只 mock 边界（网络 / 时钟 / 随机 / DB），不 mock 被测内部函数。
- 接口 + 依赖注入是 mock 的标准模式；禁止用 monkey patch（运行时反射替换）。
- 时间用注入的 `func() time.Time` 或 `clockwork.Clock` 而非直接 `time.Now`。
- 临时文件用 `t.TempDir()`；测试结束自动清理。

### 5.3 并发与覆盖率

- 并发正确性用 `-race` 跑 CI；`go test -race ./...` 必须无告警。
- 集成测试构建 tag 隔离（`//go:build integration`）；CI 单独 job 跑。
- 覆盖率门禁（`go test -cover`）核心模块行覆盖 ≥ 80%；新代码不允许负增长。
- 静态分析 `go vet` + `staticcheck` + `golangci-lint` 进 CI，警告零容忍。
