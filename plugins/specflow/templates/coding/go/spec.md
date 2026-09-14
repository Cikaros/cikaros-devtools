---
title: Go 语言规范
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-02T00:00:00+08:00
author: specflow
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
---

# Go 语言规范（templates/coding/go/spec.md）

> 按需加载层：session-start 检测到主语言为 Go 时注入摘要。
> 与语言无关的通用基线见 `spec/coding-standards.md`；安全补充见 `templates/coding/security.md`。

## 1. 语法

### 1.1 版本与语法基线

- 目标 Go ≥ 1.21（可用 `slices`/`maps` 标准库泛型函数、`min/max` 内建、
  loop var per-iteration 语义）；CI 矩阵必须覆盖最低支持版本。
- `gofmt` 是唯一格式化标准（禁手调缩进/括号风格）；行宽软上限 100。
- import 分组（标准库 / 第三方 / 本地）组间空行；未使用 import 与变量
  必须消除（编译期强制）。

### 1.2 类型与接口

- 显式错误签名 `func (...) (T, error)`；禁止 panic 跨包边界表达业务失败。
- 接口在使用方定义且保持 1-3 方法小接口（io.Reader 风格）；
  禁止提前抽象大接口（YAGNI）。
- 结构体字段导出/非导出语义清晰；零值可用（`sync.Mutex`、`bytes.Buffer`
  等零值即就绪的设计优先）。

### 1.3 命名

- 包名短小、全小写、无下划线（`httputil` 而非 `http_util`）；
  禁止 `util`/`common`/`helpers` 这类无信息包名。
- 导出标识符 PascalCase + 注释以标识符名开头（godoc 规范）；
  非导出 camelCase；缩写词全大写或全小写（`URL`/`url`，禁 `Url`）。
- Getter 不加 `Get` 前缀（`user.Name()` 而非 `user.GetName()`）。

## 2. 高级特性

### 2.1 泛型

- 类型参数仅用于真正的通用容器/算法；接口能满足就不引入泛型。
- 约束用 `comparable` / 自定义 constraint 接口；禁止 `any` 约束 +
  函数体内类型断言（等于绕过类型系统）。
- 泛型函数必须有表驱动测试覆盖至少两种实例化。

### 2.2 并发

- goroutine 必须有明确的所有权与退出路径（context 取消 / channel 关闭 /
  WaitGroup）；禁止「发射后不管」的裸 `go func()`。
- 共享可变状态优先 `channel` 传递所有权（"Do not communicate by sharing
  memory"）；确需共享时用 `sync.Mutex` 保护并注明不变量。
- 每个并发块必须考虑超时与取消（`context.WithTimeout`）；
  禁止 `context.Background()` 出现在请求路径（只允许 main/tests）。

### 2.3 错误处理

- 错误即值：调用点立即判断 `if err != nil`；禁止丢弃（`_ = f()`）
  除非注释说明为何安全。
- 包装用 `fmt.Errorf("...: %w", err)`（保留错误链，`errors.Is/As` 可判）；
  禁止 `err.Error()` 拼接丢失类型。
- 哨兵错误（`var ErrXxx = errors.New(...)`）仅用于边界 API；
  内部错误用自定义类型携带结构化字段。

### 2.4 资源与 defer

- 资源（文件/连接/锁）获取后立即 `defer` 关闭，defer 紧跟获取语句。
- 循环内资源必须显式关闭（defer 到函数退出会堆积到结束才释放）。
- `defer` 在 return 值求值之后执行——禁止依赖 defer 修改命名返回值的
  隐晦写法（必须加注释说明意图）。

## 3. 编码规范

### 3.1 工程结构

- 标准布局：`cmd/<app>/main.go` 薄入口 + `internal/` 私有实现 +
  `pkg/` 仅放确需外部复用的库；禁止把业务逻辑写进 `cmd/`。
- `internal/` 下按领域分包（`internal/order`、`internal/payment`），
  禁止按技术分层分包（`internal/handlers` + `internal/models` 大杂烩）。
- 模块定义唯一（`go.mod`）；跨模块引用走显式 require + 语义化版本。

### 3.2 错误与日志

- 日志用结构化库（slog）；禁止 `fmt.Println` 进入生产路径。
- 错误消息小写开头、不带标点（Go 惯例）；上下文由包装层补齐。
- panic 仅限程序初始化不变量破坏（fail-fast）；HTTP/RPC 处理器必须
  recover 并转 5xx。

### 3.3 测试

- 同包白盒测试（`xxx_test.go`）+ 跨包黑盒测试（`xxx_test` 包名）分层。
- 表驱动测试优先（`tests := []struct{name, in, want}`）；
  覆盖错误分支而不只是 happy path。
- 并发正确性用 `-race` 跑 CI；集成测试构建 tag 隔离（`//go:build integration`）。

### 3.4 工具链

- `go vet` + `staticcheck` 进 CI；`golangci-lint` 聚合执行。
- 依赖锁定 `go.sum` 必须提交；升级走 `go get -u=patch` 小步策略。
- 提交前 `gofmt -l .` 输出必须为空；`go mod tidy` 幂等。

## 4. 反模式（禁止）

- ❌ 裸 `go func()` 无退出路径（goroutine 泄漏）。
- ❌ `sync.Mutex` 拷贝（值接收者携带锁结构体）。
- ❌ 在 init() 里做重量级初始化 / 网络调用（破坏可测性与启动确定性）。
- ❌ 字符串拼接 SQL / `fmt.Sprintf` 拼 URL 查询参数（注入风险）。
- ❌ 用 map[string]interface{} / any 承载领域模型（绕过类型系统）。
- ❌ 时间比较用 `time.Now()` 直接相减的裸 int64（用 `time.Duration`）。
- ❌ `err != nil` 分支里再嵌套成功逻辑（early return 扁平化）。
- ❌ context 存进结构体字段（必须作为第一参数传递）。
