---
title: Python 反模式与陷阱
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
  - templates/coding/python/spec.md
---

# Python 反模式与陷阱（templates/coding/python/anti-patterns.md）

> 本文收录 Python 项目中高频出现且代价昂贵的反模式，每条都给出 ❌ 反例、
> ✅ 正例与一句话原因。语言规范基线见 `templates/coding/python/spec.md`；
> 安全相关反模式见 `templates/coding/security.md`。
> 所有反例均来自真实 PR review，禁止以「我这次是特例」为由复现。

## 1. 默认参数与可变状态类反模式

### 1.1 可变默认参数

❌ 反例：

```python
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items  # 默认值在函数定义时共享，多次调用累积
```

✅ 正例：

```python
def add_item(item: str, items: list[str] | None = None) -> list[str]:
    if items is None:
        items = []
    items.append(item)
    return items
```

默认参数在函数定义时求值一次并被所有调用共享；可变默认参数会跨调用累积状态。

### 1.2 类属性做默认共享状态

❌ 反例：

```python
class Cache:
    store: dict[str, str] = {}  # 类属性，所有实例共享
```

✅ 正例：

```python
class Cache:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}  # 实例属性，每个实例独立
```

类属性的可变对象会被所有实例共享；可变状态必须放在 `__init__` 里成为实例属性。

## 2. 异常处理类反模式

### 2.1 裸 `except:` 与吞异常

❌ 反例：

```python
try:
    do_something()
except:
    pass  # 吞掉 KeyboardInterrupt / SystemExit，调试困难
```

✅ 正例：

```python
try:
    do_something()
except ValueError as e:
    logger.warning("invalid input: %s", e)
except Exception:
    logger.exception("unexpected failure")
    raise
```

裸 `except:` 会吞掉 `KeyboardInterrupt` / `SystemExit`，且 `pass` 让排障无从下手；
必须精确捕获异常类型并处理或重抛。

### 2.2 `raise X` 丢掉 `from e` 因果链

❌ 反例：

```python
try:
    fetch(url)
except ConnectionError as e:
    raise AppError("FETCH_FAILED", "fetch failed")  # 丢失原异常
```

✅ 正例：

```python
try:
    fetch(url)
except ConnectionError as e:
    raise AppError("FETCH_FAILED", "fetch failed", cause=e) from e
```

`raise X` 不带 `from e` 会丢掉原异常的栈与类型，排障时无法追溯到根因。

### 2.3 在 `finally` 里 `return`

❌ 反例：

```python
def f() -> int:
    try:
        return do_work()
    finally:
        return 0  # 覆盖 try 里的返回值与异常
```

✅ 正例：

```python
def f() -> int:
    result = do_work()
    cleanup()
    return result
```

`finally` 里的 `return` 会吞掉 `try` 块抛出的异常并覆盖返回值；
`finally` 仅用于资源释放，禁止包含控制流语句。

## 3. 类型与数据建模类反模式

### 3.1 裸 dict 承载领域模型

❌ 反例：

```python
def get_user(uid: str) -> dict:
    return {"id": uid, "name": "Alice", "age": 30}  # 字段拼写无保护
```

✅ 正例：

```python
@dataclass(frozen=True)
class User:
    id: str
    name: str
    age: int

def get_user(uid: str) -> User:
    return User(id=uid, name="Alice", age=30)
```

裸 dict 的字段名拼写错误在运行时才暴露；dataclass 让字段名在类型层可见，
重构与静态分析都能跟踪。

### 3.2 `type: ignore` 不写原因

❌ 反例：

```python
result = legacy_parse(input)  # type: ignore
```

✅ 正例：

```python
result = legacy_parse(input)  # type: ignore[no-untyped-def]
# legacy_parse 来自无类型库 v0.3，已计划在 #1234 替换为 typed 版本
```

`type: ignore` 不写原因会让后续维护者无法判断是误报还是真问题；
必须带具体错误码与注释说明追踪计划。

## 4. 并发与资源类反模式

### 4.1 `asyncio.run` 嵌套

❌ 反例：

```python
async def handler(request: Request) -> Response:
    result = asyncio.run(other_async())  # 嵌套事件循环，RuntimeError
```

✅ 正例：

```python
async def handler(request: Request) -> Response:
    result = await other_async()
    # 或：result = await asyncio.to_thread(sync_fn)
```

`asyncio.run` 会创建新事件循环，在已有事件循环内嵌套会抛 `RuntimeError`；
async 函数内必须用 `await`，桥接同步函数用 `asyncio.to_thread`。

### 4.2 手写 `__del__` 管理资源

❌ 反例：

```python
class Connection:
    def __del__(self) -> None:
        self.close()  # GC 时机不可控，CPython 引用计数可能延迟
```

✅ 正例：

```python
class Connection:
    def close(self) -> None: ...
    def __enter__(self) -> "Connection": return self
    def __exit__(self, *exc) -> None: self.close()
```

`__del__` 的调用时机由 GC 决定（CPython 引用计数 + 分代回收），不可控且可能延迟；
资源生命周期必须用 `with` / `__enter__` + `__exit__` 显式表达。

### 4.3 循环内重复编译正则

❌ 反例：

```python
for line in lines:
    m = re.match(r"\d+-\w+", line)  # 每次循环都重新编译正则
```

✅ 正例：

```python
PATTERN = re.compile(r"\d+-\w+")
for line in lines:
    m = PATTERN.match(line)
```

`re.match` 每次调用都会重新编译正则；模块级 `re.compile` 缓存编译结果，
循环热点路径必须做这步优化。

## 5. 工程化类反模式

### 5.1 全局可变单例承载业务状态

❌ 反例：

```python
_state: dict[str, Any] = {}  # 模块级全局，测试间相互污染

def set_user(uid: str) -> None:
    _state["user"] = uid
```

✅ 正例：

```python
class Context:
    def __init__(self) -> None:
        self.user: str | None = None

ctx = Context()  # 由调用方持有并注入
def set_user(ctx: Context, uid: str) -> None:
    ctx.user = uid
```

全局可变单例让测试无法并行且状态隐式依赖；必须用依赖注入显式传递 context。

### 5.2 字符串拼接 SQL

❌ 反例：

```python
cursor.execute(f"SELECT * FROM users WHERE id = '{uid}'")  # SQL 注入
```

✅ 正例：

```python
cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))
# 或用 SQLAlchemy Core / ORM 表达式
```

字符串拼接 SQL 是经典注入漏洞；参数化查询（`%s` 占位符）让数据库驱动做转义。
