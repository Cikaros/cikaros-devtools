---
title: Python 文档规范
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

# Python 文档规范（templates/coding/python/docs.md）

> 本文是 Python 项目的文档与注释规范，覆盖行内注释、docstring、README 结构、
> Sphinx 生成配置与 Changelog 约定。语言规范基线见
> `templates/coding/python/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 PEP 257 / Sphinx 文档。

## 1. 行内注释与文件头

### 1.1 行内注释规则

- 注释解释「为什么」而非「做什么」：代码本身已表达做什么，注释补意图与约束。
- 一行注释紧贴被解释代码上方或行尾；超过 3 行的逻辑注释应抽成命名函数让代码自解释。
- 禁止保留被注释掉的死代码（git 历史已存）；review 时直接拒绝。
- TODO 必须带 issue 号：`# TODO(#1234): retry logic for 5xx`。
- 注释与代码同语言：项目主体是中文则注释中文，避免中英混杂。

```python
# 因为 httpx 2.0 默认开启 HTTP/2，老网关不支持，这里强制 HTTP/1.1
client = httpx.Client(http2=False)
```

### 1.2 模块级 docstring

每个模块顶部用三引号 docstring 描述模块职责、关键不变量、与外部系统的边界：

```python
"""订单领域服务。

包含下单、取消、退款的业务规则。所有方法均为纯函数，DB 操作由 infra 层注入。
不处理 HTTP / RPC 协议层逻辑（见 api 包）。
"""
```

约束：模块 docstring 描述「模块做什么、不做什么、依赖什么」，禁止复述类名与函数名。

## 2. docstring 函数文档

### 2.1 公共 API 的 docstring 模板

采用 Google 风格（Sphinx napoleon 原生支持）：

```python
def get_user(user_id: str, *, signal: asyncio.Event | None = None) -> User | None:
    """根据 ID 获取用户；找不到时返回 None 而非抛错。

    Args:
        user_id: 用户唯一标识（UUID v4）。
        signal: 可选取消信号；超时由调用方控制。

    Returns:
        用户对象；不存在时为 None。

    Raises:
        AppError: code='UNAUTHORIZED' 当调用方无权访问该用户。
        asyncio.CancelledError: 当 signal 被触发时。

    Example:
        >>> user = await get_user("uid", signal=signal)
        >>> if user is None: return None
    """
```

### 2.2 docstring 强制规则

- 公共导出函数（非内部辅助）必须有 docstring，覆盖 `Args` / `Returns` / `Raises`（如适用）。
- `Example` 必须可执行（被 doctest 覆盖，CI 跑 `pytest --doctest-modules`）。
- 类型注解已表达的信息（如 `user_id: str`）不重复在 docstring 中描述；
  docstring 描述「语义、约束、副作用」等运行时不可见信息。
- `Deprecated` 标注：`"""Deprecated: use :func:`get_user_v2` since v2.0."""`。

### 2.3 类与属性的 docstring

```python
@dataclass(frozen=True)
class Order:
    """订单聚合根。

    不可变值对象；总价由 items 推导，不直接修改。
    """

    id: str
    """订单唯一标识（UUID v4）。"""

    items: tuple[OrderItem, ...]
    """订单条目；空元组表示尚未结算的占位订单。"""
```

公共类的属性必须有 docstring；私有属性（`_` 前缀）可省略但应在类 docstring 中说明。

## 3. README 结构

### 3.1 标准段落顺序

1. **标题 + 一句话定位**：包名 + 解决什么问题 + 不解决什么问题。
2. **安装**：`pip install cikaros-sdk` / `uv add cikaros-sdk`，含 Python 版本要求。
3. **快速开始**：可复制粘贴运行的最小示例（< 20 行）。
4. **核心概念**：必要的领域名词解释（与 spec.md 一致）。
5. **API**：链接到 Sphinx 生成的站点，不在 README 重复罗列签名。
6. **配置**：环境变量、配置文件示例、命令行参数表格。
7. **测试与发布**：`pytest`、`uv build`、版本与发布流程。
8. **变更记录**：链接到 `CHANGELOG.md`。
9. **许可证**：链接到 `LICENSE`。

### 3.2 README 写作约束

- 示例代码必须是可运行的完整片段，禁止省略 import 让用户猜。
- 中文项目用中文 README；面向 PyPI 发布的包同时维护英文 README（`README.en.md`）。
- 禁止在 README 出现内部链接、内部代号、未脱敏的配置值。
- 示例代码用 `python` 代码块且必须通过 doctest 校验。

## 4. Sphinx 配置

### 4.1 最小配置

`docs/conf.py` 放在 `docs/` 目录：

```python
"""Sphinx 配置。"""
project = "cikaros-sdk"
release = "1.2.0"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",       # Google/NumPy 风格 docstring
    "sphinx.ext.doctest",        # 校验 docstring 中的 example
    "sphinx.ext.intersphinx",    # 跨包链接到 Python 标准库文档
]

napoleon_google_docstring = True
autodoc_typehints = "description"  # 类型注解放到描述里而非签名
autodoc_default_options = {"members": True, "undoc-members": False}
intersphinx_mapping = {"python": ("https://docs.python.org/3", None)}
```

约束：`autodoc_typehints = "description"` 让类型在描述中可见（避免长签名难读）；
`undoc-members = False` 不渲染无 docstring 的成员（强制写文档）。

### 4.2 生成与发布

```bash
pip install sphinx sphinx-rtd-theme
cd docs && sphinx-build -b html . _build/html
# 或用 tox: tox -e docs
```

CI 流水线在 `main` 分支合并后自动跑 Sphinx 并发布到文档站点；
PR 改动公共 API 必须在描述里附预览链接。doctest 失败即 CI 失败。

## 5. Changelog 约定

### 5.1 Keep a Changelog 格式

`CHANGELOG.md` 顶部为未发布版本 `[Unreleased]`，下方为已发布版本倒序排列：
`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` 六个段落。

```markdown
## [Unreleased]

### Added
- `get_user(user_id, signal=)` 支持 asyncio.Event 取消 (#123)

### Fixed
- 修复 `parse_config` 在空对象时抛错的问题 (#124)

## [1.2.0] - 2026-09-01

### Changed
- **BREAKING**: `fetch_user` 返回 `User | None` 而非 `User | Undefined`
```

### 5.2 与 Conventional Commits 的衔接

提交信息用 Conventional Commits（`feat:` / `fix:` / `docs:` / `refactor:` / `chore:`），
合并到 main 时由 `commitizen` 或 `release-please` 自动追加到 `CHANGELOG.md` 的 `[Unreleased]`。
`BREAKING CHANGE:` footer 触发主版本号提升，必须附迁移指南链接。
版本号遵循 PEP 440 语义化版本（`1.2.0` 而非 `1.2`）。
