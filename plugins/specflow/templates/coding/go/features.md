---
title: Go 语言特性
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

# Go 语言特性（templates/coding/go/features.md）

> 本文是 Go 在 specflow 体系下的「特性清单」，列出团队约定的现代语法、
> 类型系统能力、并发模型、错误处理范式与模块系统。语言规范基线见
> `templates/coding/go/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。读到这份文档即应能在不查外部资料的前提下，
> 写出符合本仓库约定的 Go 代码。

## 1. 现代语法演进

### 1.1 版本与语法坐标

- 目标 Go ≥ 1.21（`slices` / `maps` 标准库泛型函数、`min` / `max` 内建、
  `loop var per-iteration` 语义已稳定）；CI 矩阵必须覆盖最低支持版本。
- `gofmt` 是唯一格式化标准（禁手调缩进 / 括号风格）；行宽软上限 100。
- 工具链固定：`go.mod` 的 `go` 指令声明最低版本，`toolchain` 指令可选锁定更高版本。
- 未使用 import 与变量必须消除（编译期强制）；未使用函数仅 lint 警告。

### 1.2 标准库泛型函数（1.21+）

```go
import "slices"

nums := []int{3, 1, 4, 1, 5}
slices.Sort(nums)
if i, ok := slices.BinarySearch(nums, 4); ok {
    fmt.Println("found at", i)
}
// slices.Clone / slices.Reverse / slices.Contains / maps.Clone 等
```

约束：优先复用 `slices` / `maps` 标准库泛型函数，禁止手写等价工具函数。
泛型函数必须有表驱动测试覆盖至少两种实例化。

### 1.3 loop var per-iteration（1.22+）

```go
// 1.22+ 每次迭代新建循环变量，无需手动捕获
fns := []func(){}
for _, i := range nums {
    fns = append(fns, func() { fmt.Println(i) })
}
// 旧版本（≤1.21）需：i := i 然后再用
```

新项目锁 1.22+ 后，禁止「防御性 `i := i`」复现（让代码读起来像有 bug）。
跨版本库代码必须在 `go.mod` 声明兼容版本并加 lint 检测。

## 2. 类型系统与接口

### 2.1 接口设计原则

- 接口在使用方定义且保持 1-3 方法小接口（`io.Reader` 风格）；
  禁止提前抽象大接口（YAGNI）。
- 隐式实现：消费方定义接口，生产方不感知；禁止「为可测试性」给每个 struct 配接口。
- 零值可用：`sync.Mutex`、`bytes.Buffer` 等零值即就绪的设计优先；
  构造函数 `NewXxx()` 仅用于需要参数化或锁住不变量的场景。

### 2.2 泛型（1.18+）

```go
type Number interface {
    ~int | ~int64 | ~float64
}

func Sum[T Number](xs []T) T {
    var s T
    for _, x := range xs {
        s += x
    }
    return s
}
```

约束：类型参数仅用于真正的通用容器 / 算法；接口能满足就不引入泛型。
约束用 `comparable` / 自定义 constraint 接口；禁止 `any` 约束 + 函数体内类型断言
（等于绕过类型系统）。

### 2.3 类型别名与嵌入

```go
type ID = string       // 类型别名：完全等价，无新方法
type UserID string     // 命名类型：可挂方法，类型安全
```

类型别名（`=`）用于跨包重命名兼容；命名类型（不带 `=`）用于区分语义相近的底层类型
（如 `UserID` 与 `OrderID` 都是 `string` 但不互转）。
禁止用类型别名让外部包的私有类型穿透可见性边界。

## 3. 并发模型

### 3.1 goroutine 与所有权

```go
func worker(ctx context.Context, jobs <-chan Job) error {
    for {
        select {
        case <-ctx.Done():
            return ctx.Err()
        case job, ok := <-jobs:
            if !ok {
                return nil
            }
            if err := process(job); err != nil {
                return fmt.Errorf("process %d: %w", job.ID, err)
            }
        }
    }
}
```

约束：goroutine 必须有明确的所有权与退出路径（context 取消 / channel 关闭 / WaitGroup）；
禁止「发射后不管」的裸 `go func()`。
每个并发块必须考虑超时与取消（`context.WithTimeout`）。

### 3.2 channel vs 共享内存

- 共享可变状态优先 `channel` 传递所有权（"Do not communicate by sharing memory"）。
- 确需共享时用 `sync.Mutex` / `sync.RWMutex` 保护并注释不变量。
- 禁止 `context.Background()` 出现在请求路径（只允许 main / tests）。
- `errgroup.WithContext` 是组合多 goroutine + 错误聚合的标准模式：

```go
g, ctx := errgroup.WithContext(ctx)
for _, u := range users {
    u := u
    g.Go(func() error { return fetch(ctx, u) })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("fetch batch: %w", err)
}
```

### 3.3 context 传递

```go
func FetchUser(ctx context.Context, id string) (User, error) {
    ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
    defer cancel()
    // ...
}
```

context 必须作为第一参数传递；禁止存进结构体字段。
`context.TODO()` 仅用于迁移过渡，必须在 PR 描述说明替换计划。

## 4. 错误处理范式

### 4.1 错误即值

```go
if err := doSomething(); err != nil {
    return fmt.Errorf("doSomething: %w", err)
}
```

约束：调用点立即判断 `if err != nil`；禁止丢弃（`_ = f()`）除非注释说明为何安全。
错误消息小写开头、不带标点（Go 惯例）；上下文由包装层补齐。

### 4.2 错误包装与拆包

```go
var ErrNotFound = errors.New("not found")

if errors.Is(err, ErrNotFound) {
    // 哨兵错误匹配（穿透包装层）
}

var pathErr *fs.PathError
if errors.As(err, &pathErr) {
    log.Println("path:", pathErr.Path)
}
```

- 包装用 `fmt.Errorf("...: %w", err)`（保留错误链，`errors.Is/As` 可判）；
  禁止 `err.Error()` 拼接丢失类型。
- 哨兵错误（`var ErrXxx = errors.New(...)`）仅用于边界 API；
  内部错误用自定义类型携带结构化字段。

### 4.3 panic 与 recover

panic 仅限程序初始化不变量破坏（fail-fast），如配置加载失败、依赖注入缺失；
HTTP / RPC 处理器必须 `defer recover` 并转 5xx。
禁止 panic 跨包边界表达业务失败——业务失败必须用 `(T, error)` 表达。

## 5. 模块系统

### 5.1 go.mod 与版本

```go
module github.com/cikaros/sdk

go 1.21

require (
    github.com/google/uuid v1.6.0
    golang.org/x/sync v0.7.0
)
```

约束：模块定义唯一（`go.mod`）；跨模块引用走显式 `require` + 语义化版本。
依赖锁定 `go.sum` 必须提交；升级走 `go get -u=patch` 小步策略。

### 5.2 包布局

- 标准布局：`cmd/<app>/main.go` 薄入口 + `internal/` 私有实现 + `pkg/` 仅放确需外部复用的库。
- `internal/` 下按领域分包（`internal/order`、`internal/payment`），
  禁止按技术分层分包（`internal/handlers` + `internal/models` 大杂烩）。
- 包名短小、全小写、无下划线（`httputil` 而非 `http_util`）；
  禁止 `util` / `common` / `helpers` 这类无信息包名。

### 5.3 工具链

- `go vet` + `staticcheck` 进 CI；`golangci-lint` 聚合执行。
- 提交前 `gofmt -l .` 输出必须为空；`go mod tidy` 幂等。
- 依赖升级走 Dependabot / renovate 小步 PR；禁止一次性大版本跳跃。
