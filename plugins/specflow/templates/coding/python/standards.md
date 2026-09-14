---
title: Python 编码规范
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

# Python 编码规范（templates/coding/python/standards.md）

> 本文是 Python 在 specflow 体系下的「可执行编码规范」——命名、格式化、
> 文件与目录结构、import 顺序、错误传播、日志、测试约定。语言规范基线见
> `templates/coding/python/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 PEP 8 / black 文档。

## 1. 命名约定

### 1.1 标识符大小写规则

- 模块、函数、变量、方法：snake_case；如 `user_service`、`fetch_user`、`is_active`。
- 类：PascalCase；如 `UserService`、`OrderStatus`。
- 常量（模块级不变值）：UPPER_SNAKE_CASE；如 `MAX_RETRY = 3`。
- 受保护的内部成员单下划线前缀：`_internal_helper`。
- 布尔与方法：`is/has/can/should` 前缀；`is_valid`、`has_permission`。

### 1.2 命名禁忌

- 禁止双下划线名称改写（name mangling），除非确有子类冲突场景；
  需要私有用单下划线，需要避免子类覆盖用 `__` 前缀并在文档说明。
- 禁止单字母命名（循环索引 `i/j/k` 与数学公式变量 `x/y/z` 例外）。
- 禁止否定式布尔命名：用 `is_valid` 而非 `is_not_invalid`（双重否定）。
- 缩写词统一全小写：`user_id`、`parse_url`；禁止 `userId` / `parseURL`。

## 2. 格式化与文件结构

### 2.1 格式化基线

- 格式化工具 black 或 ruff-format；lint 用 ruff；类型检查 mypy 或 pyright——三者必须进 CI。
- 行宽 100（与 black 默认 88 二选一并全仓库统一）；
  ruff 配置 `line-length = 100`，black 配置 `--line-length 100`。
- import 排序用 ruff 的 `I` 规则：标准库 → 第三方 → 本地，组间空行。
- 字符串统一双引号（ruff `Q002` 默认）或单引号（与项目历史一致即可），禁止混用。

### 2.2 目录结构（src layout）

```
src/
  cikaros_sdk/
    __init__.py        # 仅 re-export，__all__ 显式声明
    api/               # HTTP / RPC 适配层
    services/          # 用例编排
    domain/            # 领域模型与纯函数规则
    infra/             # DB / 外部 SDK 适配
    cli.py             # 可执行入口（唯一）
    __main__.py        # python -m cikaros_sdk 入口
tests/                 # 与 src 同级，黑盒测试
```

约束：包结构 src layout（`src/<pkg>/`）；禁止扁平单文件大模块（> 500 行拆分）。
`__init__.py` 只做显式 re-export（`__all__`）；禁止隐式导入副作用。

### 2.3 文件大小与拆分

- 一个模块一个主导出主体；文件超过 500 行考虑拆分；函数超过 40 行必须有拆分理由。
- `__init__.py` 仅 re-export，禁止含业务逻辑、禁止读环境变量。
- 测试文件 `test_*.py` 与被测模块同包；`tests/` 目录与 `src/` 同级。

## 3. import 与依赖

### 3.1 import 风格

```python
# 分组排序：标准库 / 第三方 / 本地，组间空行
import asyncio
from pathlib import Path

import httpx
from pydantic import BaseModel

from cikaros_sdk.domain import User
```

- 禁止 `import *`（污染命名空间，静态分析无法跟踪）。
- 禁止函数体内的模块级副作用 import（仅允许在测试 fixture 或懒加载场景，且注释说明）。
- 循环依赖零容忍：用 `pip-audit` 检测不到循环，但运行时 `ImportError` 即信号，必须重构。

### 3.2 依赖管理

- 依赖锁定用 `uv lock` 或 `pip-tools`；禁止 `requirements.txt` 里使用无版本约束的裸依赖。
- 运行时依赖上界明确（`httpx>=0.27,<1`）；开发依赖可宽松（`pytest>=8`）。
- 升级策略：patch 走 renovate 自动合并；minor 走人工 PR；major 必须单独 PR + 回归测试。
- `pyproject.toml` 是唯一打包配置入口；不再维护 `setup.py` / `setup.cfg`。

## 4. 错误传播与日志

### 4.1 错误传播链

- 业务异常继承自项目基类异常（带 `code`），禁止抛裸字符串 / `RuntimeError` 表达业务语义。
- 捕获必须精确到异常类型；`except Exception` 仅允许出现在最外层边界并必须记日志。
- `raise X from e` 保留因果链；禁止 `raise X` 丢掉原异常上下文。
- 错误消息禁止包含敏感信息（token / 内部路径 / 用户 PII），与 `templates/coding/security.md` 一致。

### 4.2 日志约定

```python
import logging
logger = logging.getLogger(__name__)

logger.info("user fetched", extra={"trace_id": tid, "user_id": uid})
logger.error("place order failed", exc_info=True, extra={"trace_id": tid})
```

- 用标准库 `logging` 或 `structlog`；禁止 `print` 进生产路径。
- 日志字段用 `extra` 传结构化字段，traceId 由请求中间件注入全链路透传。
- 禁止日志输出敏感字段（token、密码、完整身份证号）；超过 4 位的敏感字段做掩码。
- 日志级别：`error`（需人工介入）、`warning`（可恢复但需关注）、`info`（业务事件）、`debug`（仅本地）。

### 4.3 错误与日志的边界

```python
try:
    order_service.place(input)
except ValidationError as e:
    logger.warning("validation failed: %s", e.code, extra={"trace_id": tid})
    raise ApiError(400, e.code) from e
except Exception:
    logger.exception("place order failed", extra={"trace_id": tid})
    raise ApiError(500, "INTERNAL") from None
```

边界层（HTTP handler / CLI 入口）统一 catch + 转换为协议错误响应，
`from e` 保留链路、`from None` 在彻底转换时切断链路（避免敏感信息泄漏）。

## 5. 测试约定

### 5.1 测试组织

- 框架 pytest + fixtures；测试文件 `test_*.py` 与被测模块同包。
- 命名：`class TestUserService:` + `def test_returns_user_when_id_exists():`，
  行为描述而非方法名罗列。
- 一个测试只断言一件事；`assert` 数量 ≤ 5，超过的拆成多个测试函数。

### 5.2 fixtures 与夹具

- 临时环境用 `tmp_path` / `monkeypatch` fixture；禁止测试间共享可变全局状态。
- 夹具（fixture）按作用域声明：`scope="session"` 仅用于只读资源（DB schema）；
  `scope="function"` 默认值适用于可变状态。
- mock 只 mock 边界（网络 / 时钟 / 随机 / DB），不 mock 被测内部函数；
  mock 时间用 `freezegun` 而非手动改 `time.time`。

### 5.3 参数化与覆盖率

```python
@pytest.mark.parametrize("input,expected", [
    ("", None),
    ("abc", "abc"),
    ("  spaced  ", "spaced"),
])
def test_strips_whitespace(input: str, expected: str | None) -> None:
    assert strip(input) == expected
```

参数化测试（`@pytest.mark.parametrize`）覆盖边界值；禁止「golden path only」。
覆盖率门禁（`pytest-cov`）核心模块行覆盖 ≥ 80%；新代码不允许负增长。
类型检查（mypy/pyright）必须进 CI 且 `--strict` 通过。
