#!/usr/bin/env python3
"""
sfpaths.py — specflow 项目级目录解析（v0.7.0，用户反馈第 1 项）

背景：项目既然叫 specflow，项目初始化生成的目录不应再叫 .codex-plugin/.codex。
v0.7.0 起统一为单一项目级目录 <root>/.specflow/（配置 + 运行时同目录）：
    .specflow/config.md / config.default.md / vars.yaml / todo.version
    .specflow/agents/ / languages/          （配置）
    .specflow/workflow-state/ / events.jsonl / todo-state.json / ...（运行时）

兼容策略（旧项目不升级也照常工作）：
  - <root>/.specflow 存在        → 新布局
  - 否则存在旧布局痕迹           → 旧布局：配置读 .codex-plugin/，运行时读写 .codex/
    （.codex-plugin/ 目录存在，或 .codex/ 内含 specflow 已知运行时文件）
  - 否则                          → 新布局（默认 .specflow/）
  旧项目升级：重新运行 sf.sh init 会把旧目录自动迁移进 .specflow/
  （init --no-migrate 可跳过；--refresh 不做迁移，尊重「不动结构」契约）。

注意：
  - <root>/.codex-plugin/plugin.json 是 Codex 官方**插件清单**格式（插件树自身），
    与项目级目录无关，不受本模块影响。
  - <root>/.codexignore 是 PreToolUse 拦截黑名单文件名（v0.3.0 起既有约定，
    兼容已初始化项目，不改名）。
  - 全局目录：classic 安装的默认配置 ~/.codex-plugin/config.md → v0.7.0 起改读
    ~/.specflow/config.md（legacy 回退读旧位置）；vars.yaml 同理。

用法（同目录脚本，sys.path[0] 即本目录）：
    import sfpaths
    sfpaths.config_path(root, 'config.md')      # 配置文件
    sfpaths.runtime_path(root, 'todo-state.json')  # 运行时文件
    sfpaths.state_dir(root)                     # workflow-state 目录
    sfpaths.global_config_path('config.md')     # 全局 ~/.specflow/...（带 legacy 回退）
"""

from __future__ import annotations

import os
from pathlib import Path

SF_DIR = '.specflow'
LEGACY_CONFIG_DIR = '.codex-plugin'
LEGACY_RUNTIME_DIR = '.codex'
LEGACY_GLOBAL_DIR = '.codex-plugin'   # 全局旧目录（classic 安装曾用）
GLOBAL_DIR = '.specflow'              # 全局新目录（~/.specflow/）

# specflow 已知的运行时文件/子目录（用于判断 .codex/ 是否「属于我们」，
# 避免误把其他工具的项目级 .codex/ 当成旧布局）
# ⚠ 与 hooks/scripts/lib/common.mjs、mcp/lib/sf-paths.js 的 RUNTIME_MARKERS
# 保持一致（v0.7.1 曾发现三处清单漂移：JS 两侧缺 7 个运行时文件，极端场景
# 下 hooks 与 Python 扫描器会判定出不同布局、读写分裂到两个目录）
RUNTIME_MARKERS = (
    '.initialized', 'hooks-state.json', 'todo-state.json', 'todo-resolved.json',
    'todo-cache.json', 'events.jsonl', 'hook-audit.json', 'env-scan.json',
    'parsed-config.json', 'parse-cache.json', 'project-snapshot.json',
    'todo-list.md', 'test-executor.json', 'test-report.json', 'precommit-report.json',
    'privacy-audit.json', 'last-redaction.json', 'loaded-sections.json',
    'prompt-trace.json', 'session-end.json', 'output-check.json',
    'workflow-state',
)


def _is_our_runtime_dir(root: Path) -> bool:
    d = root / LEGACY_RUNTIME_DIR
    if not d.is_dir():
        return False
    return any((d / m).exists() for m in RUNTIME_MARKERS)


def layout(root: Path | str) -> str:
    """返回 'new'（.specflow 单目录）或 'legacy'（.codex-plugin + .codex）。"""
    root = Path(root)
    if (root / SF_DIR).is_dir():
        return 'new'
    if (root / LEGACY_CONFIG_DIR).is_dir() or _is_our_runtime_dir(root):
        return 'legacy'
    return 'new'


def sf_dir(root: Path | str) -> Path:
    """specflow 项目目录（新布局的单一目录）。"""
    return Path(root) / SF_DIR


def config_path(root: Path | str, name: str) -> Path:
    """项目级**配置**文件路径（config.md / vars.yaml / todo.version / agents/、languages/ 子内容）。

    legacy 布局回退 .codex-plugin/<name>；否则 .specflow/<name>。
    """
    root = Path(root)
    if layout(root) == 'legacy':
        return root / LEGACY_CONFIG_DIR / name
    return root / SF_DIR / name


def runtime_path(root: Path | str, name: str) -> Path:
    """项目级**运行时**状态文件路径（todo-state.json / events.jsonl / workflow-state/ ...）。

    legacy 布局回退 .codex/<name>；否则 .specflow/<name>。
    """
    root = Path(root)
    if layout(root) == 'legacy':
        return root / LEGACY_RUNTIME_DIR / name
    return root / SF_DIR / name


def state_dir(root: Path | str) -> Path:
    """workflow-state 目录。"""
    return runtime_path(root, 'workflow-state')


def agents_dir(root: Path | str) -> Path:
    return state_dir(root) / 'agents'


def config_exists(root: Path | str, name: str) -> bool:
    return config_path(root, name).is_file()


def is_initialized(root: Path | str) -> bool:
    """初始化标记（新 .specflow/.initialized 或旧 .codex/.initialized）。"""
    root = Path(root)
    return (root / SF_DIR / '.initialized').exists() \
        or (root / LEGACY_RUNTIME_DIR / '.initialized').exists()


def runtime_dir_name(root: Path | str) -> str:
    """运行时目录名（用于面向用户的提示文本，避免 legacy 项目被误导）。"""
    return LEGACY_RUNTIME_DIR if layout(root) == 'legacy' else SF_DIR


# ─────────────────────────────────────────────
# 全局目录（~/.specflow/，legacy 回退 ~/.codex-plugin/）
# ─────────────────────────────────────────────

def _home() -> Path:
    return Path(os.path.expanduser('~'))


def global_config_path(name: str) -> Path:
    """全局配置文件路径：~/.specflow/<name>。

    读场景应配合 global_config_path_legacy() 做回退；
    写场景（安装器生成默认 config.md）直接用本函数。
    """
    return _home() / GLOBAL_DIR / name


def global_config_path_legacy(name: str) -> Path:
    """全局配置 legacy 路径：~/.codex-plugin/<name>（v0.6.0 及之前的 classic 安装）。"""
    return _home() / LEGACY_GLOBAL_DIR / name


def global_config_exists(name: str) -> bool:
    return global_config_path(name).is_file() or global_config_path_legacy(name).is_file()
