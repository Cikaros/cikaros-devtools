---
title: Python 语言特性
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

# Python 语言特性（templates/coding/python/features.md）

> 本文是 Python 在 specflow 体系下的「特性清单」，列出团队约定的现代语法、
> 类型系统能力、数据建模原语、并发模型与错误处理范式。语言规范基线见
> `templates/coding/python/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。读到这份文档即应能在不查外部资料的前提下，
> 写出符合本仓库约定的 Python 代码。

## 1. 现代语法演进

### 1.1 版本与语法坐标

- 目标 Python ≥ 3.10（PEP 604 联合 `X | Y`、`match-case`、`Self` 类型可用）；
  库代码如需兼容 3.9 必须显式声明并在 CI 矩阵中覆盖。
- 缩进 4 空格；行宽上限 100（与 black 默认 88 二选一并全仓库统一）。
- 文件编码 UTF-8；新增文件不带 `# -*- coding: utf-8 -*-`（Python 3 默认）。
- `__future__` 导入仅用于灰度新语法（如 3.11 用 `from __future__ import annotations` 推迟注解求值）。

### 1.2 PEP 604 与现代类型写法

```python
# 现代联合类型，不再用 typing.Optional/Union
def find(id: str) -> User | None: ...

# 字面量类型与递归类型
from typing import Literal, Self
Mode = Literal["strict", "loose"]

class Builder:
    def with_id(self, id: str) -> Self:
        self.id = id
        return self  # Self 让子类链式调用返回子类类型
```

### 1.3 match-case 模式匹配

```python
def handle(event: Event) -> Response:
    match event:
        case {"type": "user.created", "user_id": uid}:
            return welcome_user(uid)
        case UserUpdated(user_id=uid, fields=fields):
            return apply_update(uid, fields)
        case _:
            raise ValueError(f"unknown event: {event!r}")
```

约束：超过 3 个 `if/elif` 分支的「类型标签 + 分发」必须改 `match-case`；
默认分支必须显式抛错而非静默 `pass`（穷尽检查的等价物）。

## 2. 类型系统能力

### 2.1 类型注解与渐进式检查

- 公共函数 / 类的参数与返回值必须注解（PEP 484）；内部函数鼓励注解。
- 用现代写法：`list[str]` / `dict[str, int]` / `X | None`，不再写 `typing.List/Optional`。
- 渐进式类型检查（mypy/pyright）默认 `--strict` 起步，逐文件放宽要有注释理由。
- `Any` 仅出现在第三方无类型边界；业务代码用 `object` + `isinstance` 收窄。

### 2.2 ParamSpec 与 TypeVarTuple

```python
from typing import ParamSpec, TypeVar, Callable

P = ParamSpec("P")
R = TypeVar("R")

def logged(fn: Callable[P, R]) -> Callable[P, R]:
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        log.info(f"call {fn.__name__}")
        return fn(*args, **kwargs)
    return wrapper
```

`ParamSpec` 让装饰器透传被装饰函数的精确签名；
旧写法 `*args, **kwargs` 全部标 `Any` 是丢失类型信息。

### 2.3 TypedDict 与字面量

```python
from typing import TypedDict, Literal

class UserPayload(TypedDict):
    id: str
    role: Literal["admin", "member"]
    active: bool
```

`TypedDict` 描述 JSON 形状，禁止用裸 dict 承载领域模型。
开放集合用 `Literal[...]`，封闭集合用 `Enum`。

## 3. 数据建模

### 3.1 dataclass 优先

```python
from dataclasses import dataclass

@dataclass(frozen=True, slots=True)
class Order:
    id: str
    items: tuple[OrderItem, ...]  # 不可变：用 tuple 而非 list
    total: Decimal

    def __post_init__(self) -> None:
        if self.total < 0:
            raise ValueError("total must be non-negative")
```

约束：领域模型用 `@dataclass(frozen=True, slots=True)`（不可变 + 省内存 + 防字段拼写）；
需要校验的边界模型用 pydantic（仅边界层，业务层不依赖 pydantic）。

### 3.2 Enum 与 Literal 的边界

- `Enum` 承载封闭集合（领域状态机：`OrderStatus`）；
  开放集合（配置项、扩展点）用 `Literal[...]`。
- 禁止 `Enum` 的字符串值混用大小写（破坏 `OrderStatus(value)` 反查）。
- `IntEnum` 仅用于与 C / 位运算交互的场景，其余用 `Enum`。

### 3.3 NamedTuple 与返回结构

返回元组超过 2 元素必须改 `NamedTuple` 或 `dataclass`；
解构时只取部分字段用 `_` 占位避免误读。

```python
class ParseResult(NamedTuple):
    value: int
    consumed: int
    trailing: str | None
```

## 4. 并发与异步

### 4.1 asyncio 模型

```python
async def fetch_users(ids: list[str]) -> list[User]:
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(fetch_user(i)) for i in ids]
    # TaskGroup（3.11+）任一失败即取消其余，避免 errback 链遗漏
    return [t.result() for t in tasks]
```

约束：IO 密集用 `asyncio` + `async/await`；禁止混用线程池与 asyncio 事件循环
（`asyncio.to_thread` 是唯一桥接方式）。
每个公共 async API 必须支持超时（`asyncio.timeout` / `wait_for`）。

### 4.2 上下文管理器

```python
from contextlib import contextmanager

@contextmanager
def transaction(conn: Connection) -> Iterator[Connection]:
    conn.begin()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
```

资源（文件 / 连接 / 锁）一律 `with`；禁止裸 open/close 配对。
自定义资源管理器用 `@contextmanager` 装饰器或实现 `__enter__` / `__exit__`。

### 4.3 多错误聚合

```python
try:
    await ingest_batch(batch)
except* ValidationError as eg:
    for e in eg.exceptions:
        log.warning("validation failed: %s", e)
```

多错误聚合用 `except*`（ExceptionGroup，3.11+）或显式 `raise X from e` 保留因果链。
禁止 `except:` 裸捕获与 `except BaseException`（吞掉 KeyboardInterrupt / SystemExit）。

## 5. 错误处理与打包

### 5.1 业务异常基类

```python
class AppError(Exception):
    code: str
    def __init__(self, code: str, message: str, *, cause: Exception | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.__cause__ = cause

class ValidationError(AppError): ...
```

业务异常继承自项目基类异常（带 `code`）；禁止抛裸字符串 / `RuntimeError` 表达业务语义。
错误消息禁止包含敏感信息（token / 内部路径 / 用户 PII）。

### 5.2 打包模型（pyproject.toml）

```toml
[project]
name = "cikaros-sdk"
version = "1.2.0"
requires-python = ">=3.10"
dependencies = ["httpx>=0.27,<1", "pydantic>=2.5,<3"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

打包配置统一 `pyproject.toml`（PEP 621）；不再维护 `setup.py`。
依赖锁定用 `uv lock` 或 `pip-tools`；禁止 requirements.txt 里使用无版本约束的裸依赖。
