---
title: Python 语言规范
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

# Python 语言规范（templates/coding/python/spec.md）

> 按需加载层：session-start 检测到主语言为 Python 时注入摘要。
> 与语言无关的通用基线见 `spec/coding-standards.md`；安全补充见 `templates/coding/security.md`。

## 1. 语法

### 1.1 版本与语法基线

- 目标 Python ≥ 3.10（可用 `X | Y` 联合类型、match-case、`Self` 类型）；
  库代码如需兼容 3.9 必须显式声明并在 CI 矩阵中覆盖。
- 缩进 4 空格；行宽上限 100（black/PEP8 的 88 与 100 之间二选一并全仓库统一）。
- import 分组排序（标准库 / 第三方 / 本地），组间空行；禁止 `import *`；
  禁止函数体内的模块级副作用 import。

### 1.2 类型注解

- 公共函数 / 类的参数与返回值必须注解（PEP 484）；内部函数鼓励注解。
- 用现代写法：`list[str]` / `dict[str, int]` / `X | None`，不再写
  `typing.List/Optional`。
- 渐进式类型检查（mypy/pyright）默认 `--strict` 起步，逐文件放宽要有注释理由。
- `Any` 仅出现在第三方无类型边界；业务代码用 `object` + `isinstance` 收窄。

### 1.3 命名

- 模块 / 函数 / 变量 snake_case；类 PascalCase；常量 UPPER_SNAKE_CASE；
  受保护的内部成员单下划线前缀。
- 禁止双下划线名称改写（name mangling），除非确有子类冲突场景。
- 布尔用 `is/has/can/should` 前缀；返回元组的函数 > 2 元素必须改 `NamedTuple`/`dataclass`。

## 2. 高级特性

### 2.1 数据建模

- 结构化数据优先 `@dataclass(frozen=True, slots=True)`（不可变 + 省内存）；
  需要校验用 pydantic（仅边界层）。
- `TypedDict` 用于 JSON 形状描述；禁止用裸 dict 承载领域模型。
- `Enum` 承载封闭集合；开放集合用 `Literal[...]`。

### 2.2 迭代器 / 生成器

- 流式处理用生成器（`yield`）；生成器函数必须用 `Iterator[T]` 注解返回。
- 禁止在生成器里做隐式资源生命周期管理（应用 contextmanager 显式表达）。
- 大数据集处理禁止 `list()` 全量物化（内存峰值风险）。

### 2.3 异步

- IO 密集用 `asyncio` + `async/await`；禁止混用线程池与 asyncio 事件循环
  （`asyncio.to_thread` 是唯一桥接方式）。
- 异步函数一律 `async def` + `await`，禁止手动 `loop.run_until_complete` 嵌套。
- 每个公共 async API 必须支持超时（`asyncio.timeout` / `wait_for`）。

### 2.4 上下文管理器与异常组

- 资源（文件 / 连接 / 锁）一律 `with`；禁止裸 open/close 配对。
- 多错误聚合用 `except*`（ExceptionGroup，3.11+）或显式 `raise ... from e` 保留因果链。
- 禁止 `except:` 裸捕获与 `except BaseException`（吞掉 KeyboardInterrupt/SystemExit）。

## 3. 编码规范

### 3.1 工程结构

- 包结构 `src layout`（`src/<pkg>/`）；禁止扁平单文件大模块（> 500 行拆分）。
- `__init__.py` 只做显式 re-export（`__all__`）；禁止隐式导入副作用。
- 可执行入口唯一：`<pkg>/__main__.py` 或 `cli.py`；其余模块禁止 `if __name__ == '__main__'`。

### 3.2 错误处理

- 业务异常继承自项目基类异常（带 `code`）；禁止抛裸字符串 / `RuntimeError` 表达业务语义。
- 捕获必须精确到异常类型；`except Exception` 仅允许出现在最外层边界并必须记日志。
- 错误消息禁止包含敏感信息（token / 内部路径 / 用户 PII）。

### 3.3 测试

- pytest + fixtures；测试文件 `test_*.py` 与被测模块同包。
- 临时环境用 `tmp_path` / `monkeypatch` fixture；禁止测试间共享可变全局状态。
- 参数化测试（`@pytest.mark.parametrize`）覆盖边界值；禁止「golden path only」。

### 3.4 工具链

- 格式化 black / ruff-format；lint ruff；类型 mypy 或 pyright——三者必须进 CI。
- 依赖锁定（uv / pip-tools）；禁止 requirements.txt 里使用无版本约束的裸依赖。
- 打包配置用 `pyproject.toml`（PEP 621）；不再维护 `setup.py`。

## 4. 反模式（禁止）

- ❌ 可变默认参数（`def f(items=[])`——经典陷阱，用 `None` + 函数体内构造）。
- ❌ 裸 `except:` / 吞异常不记日志 / `raise X` 丢掉 `from e` 因果链。
- ❌ 字符串拼接 SQL / `eval` / `exec` / `pickle.loads` 处理外部输入（注入与反序列化风险）。
- ❌ 全局可变单例承载业务状态（测试不可并行；用依赖注入传 context）。
- ❌ 在 `finally` 里 `return`（覆盖异常）。
- ❌ 手写 `__del__` 管理资源（时机不可控；用 `with`/`close()`）。
- ❌ 循环内重复编译正则（模块级 `re.compile`）。
- ❌ 用 `type: ignore` 而不写原因注释（必须有 `# type: ignore[具体错误码]`）。
