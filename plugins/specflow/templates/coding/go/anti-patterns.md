---
title: Go 反模式与陷阱
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

# Go 反模式与陷阱（templates/coding/go/anti-patterns.md）

> 本文收录 Go 项目中高频出现且代价昂贵的反模式，每条都给出 ❌ 反例、
> ✅ 正例与一句话原因。语言规范基线见 `templates/coding/go/spec.md`；
> 安全相关反模式见 `templates/coding/security.md`。
> 所有反例均来自真实 PR review，禁止以「我这次是特例」为由复现。

## 1. 并发与资源类反模式

### 1.1 裸 `go func()` 无退出路径

❌ 反例：

```go
for _, job := range jobs {
    job := job
    go func() { process(job) }()  // 泄漏 goroutine，无超时无取消
}
```

✅ 正例：

```go
g, ctx := errgroup.WithContext(ctx)
for _, job := range jobs {
    job := job
    g.Go(func() error {
        ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
        defer cancel()
        return process(ctx, job)
    })
}
if err := g.Wait(); err != nil {
    return fmt.Errorf("batch: %w", err)
}
```

裸 `go func()` 没有退出路径，goroutine 永远不结束；必须用 context + WaitGroup / errgroup 控制生命周期。

### 1.2 `sync.Mutex` 拷贝

❌ 反例：

```go
type Cache struct {
    mu sync.Mutex
    data map[string]string
}

func (c Cache) Get(key string) string {  // 值接收者拷贝了 Mutex
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data[key]
}
```

✅ 正例：

```go
func (c *Cache) Get(key string) string {  // 指针接收者
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.data[key]
}
```

`sync.Mutex` 含不可拷贝字段，值接收者会拷贝锁导致两个独立锁状态；
含 Mutex 的类型方法必须用指针接收者（`go vet` 会检测）。

### 1.3 循环内 defer

❌ 反例：

```go
for _, f := range files {
    fh, err := os.Open(f)
    if err != nil { return err }
    defer fh.Close()  // 累积到函数结束才关闭，大量文件时 fd 泄漏
}
```

✅ 正例：

```go
for _, f := range files {
    if err := processFile(f); err != nil { return err }
}

func processFile(name string) error {
    fh, err := os.Open(name)
    if err != nil { return err }
    defer fh.Close()  // 离开函数即释放
    // ...
}
```

循环内 defer 直到外层函数返回才执行，循环次数多时资源堆积；
循环内的资源管理应抽成独立函数让 defer 立即生效。

## 2. 错误处理类反模式

### 2.1 `err.Error()` 拼接丢类型

❌ 反例：

```go
return fmt.Errorf("fetch user: %s", err)  // 丢失 errors.Is/As 能力
```

✅ 正例：

```go
return fmt.Errorf("fetch user: %w", err)  // %w 保留错误链
```

`%s` 只取错误字符串，下游无法用 `errors.Is/As` 判断类型；必须用 `%w` 保留错误链。

### 2.2 丢弃错误 `_ = f()`

❌ 反例：

```go
result, _ := json.Marshal(payload)  // 错误被丢，result 可能是 nil
w.Write(result)
```

✅ 正例：

```go
result, err := json.Marshal(payload)
if err != nil {
    return fmt.Errorf("marshal payload: %w", err)
}
w.Write(result)
```

丢弃错误会让后续代码在 `result` 是 nil / 零值时崩；
除非有注释说明为何安全（如 `defer file.Close()` 在已检查的错误路径上），否则必须判断。

### 2.3 `err != nil` 分支嵌套成功逻辑

❌ 反例：

```go
if err != nil {
    return err
} else {
    return process(result)  // 嵌套在 else 里
}
```

✅ 正例：

```go
if err != nil {
    return err
}
return process(result)  // early return 扁平化
```

`err != nil` 分支应 early return 让成功路径扁平化；
嵌套 `else` 在 Go 社区被视为可读性反模式（Effective Go 明确反对）。

## 3. 类型与接口类反模式

### 3.1 `map[string]interface{}` / `any` 承载领域模型

❌ 反例：

```go
func GetUser(id string) (map[string]interface{}, error) {
    return map[string]interface{}{"id": id, "name": "Alice"}, nil
}
```

✅ 正例：

```go
type User struct {
    ID   string
    Name string
}

func GetUser(id string) (User, error) {
    return User{ID: id, Name: "Alice"}, nil
}
```

`map[string]interface{}` 绕过类型系统，字段拼写错误在运行时才暴露；
领域模型必须用 struct 让编译器校验字段。

### 3.2 context 存进结构体字段

❌ 反例：

```go
type Service struct {
    ctx context.Context  // 存进字段，跨请求复用同一个 ctx
}
```

✅ 正例：

```go
type Service struct {}

func (s *Service) Do(ctx context.Context, input Input) error {
    // context 作为第一参数传递
}
```

context 存进结构体会跨请求复用，导致取消信号泄漏到无关请求；
必须作为方法第一参数显式传递（Go 团队明确反对 context 字段）。

## 4. 工程化类反模式

### 4.1 `init()` 里做重量级初始化

❌ 反例：

```go
func init() {
    db = mustConnect(os.Getenv("DB_DSN"))  // 网络调用在 init，启动确定性破坏
}
```

✅ 正例：

```go
func NewApp(cfg Config) (*App, error) {
    db, err := sql.Open("postgres", cfg.DSN)
    if err != nil { return nil, fmt.Errorf("connect db: %w", err) }
    return &App{db: db}, nil
}
```

`init()` 在 main 之前执行且无法返回错误，网络调用在 init 里破坏启动确定性与可测性；
重量级初始化应放到显式构造函数，错误用 `(T, error)` 表达。

### 4.2 时间比较用 `time.Now()` 直接相减的裸 int64

❌ 反例：

```go
if time.Now().UnixNano()-start > int64(5*time.Second) {  // 单位混乱
    return errors.New("timeout")
}
```

✅ 正例：

```go
if time.Since(start) > 5*time.Second {
    return errors.New("timeout")
}
// 或用 context.WithTimeout 让超时由 context 控制
```

裸 int64 比较单位混乱（ns / ms / s 易写错）；`time.Since` 返回 `time.Duration` 类型安全。
