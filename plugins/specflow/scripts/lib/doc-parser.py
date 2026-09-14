#!/usr/bin/env python3
"""
doc-parser.py — Markdown Config Parser for specflow

Per PARSER.md spec. Parses Markdown config files into structured data so
hook-orchestrator / doc-injector / config-reader can load selected sections.

Features:
  - 5 checkbox forms: en key+value / cn+value / en key / cn / no-match→skip
  - Single-select: - ( ) / - (x)  (multi-select warns)
  - Variables: {{namespace.field}} with 8 namespaces (env/git/os/lang/project/user/now/today)
  - Default values: {{var|default:"fallback"}}
  - Conditional loading: {{lang.primary == "typescript"}}
  - Frontmatter (YAML between ---) — minimal YAML subset parser (no PyYAML dep)
  - JSON blocks: ` ```codex:json ` — deep merged
  - Section tree with IDs: 1, 1.1, 1.1.2 (max depth 4)
  - loaded_section_ids / skipped_section_ids
  - variables_resolved / variables_unresolved
  - warnings / errors
  - @ref:path reference syntax (recorded, not auto-loaded)
  - Custom mapping: <!-- codex:map 中文 → english.key -->
  - CAPABILITY_MAP (22+ Chinese→English mappings)
  - TITLE_STAGE_MAP (7 Chinese stage→English)

CLI:
  python3 doc-parser.py <file> [--format=json|md|summary] [--stage=<>] [--key=<>]
                              [--section=<id>] [--vars-file=<path>] [--resolve-vars=true|false]

Uses only Python 3.10+ standard library. Never crashes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# ─────────────────────────────────────────────
# Mapping tables
# ─────────────────────────────────────────────

CAPABILITY_MAP: dict[str, str] = {
    '格式化输出': 'formatted_output',
    'PRD 模板': 'formatted_output',
    '启用 PRD 模板': 'formatted_output',
    '验收标准': 'acceptance_criteria_required',
    'ADR': 'adr_required',
    'ADR 必需': 'adr_required',
    '模块图': 'module_diagram_required',
    '模块拆分图': 'module_diagram_required',
    '严格类型': 'strict_types',
    '自动提交': 'auto_commit',
    '签名提交': 'commit_signed',
    '提交规范': 'commit_convention',
    '安全扫描': 'security_scan',
    '隐私扫描': 'privacy_scan',
    '复杂度阈值': 'complexity_threshold',
    '覆盖率门槛': 'coverage_gate',
    '行覆盖率': 'coverage_line_min',
    '分支覆盖率': 'coverage_branch_min',
    'E2E': 'e2e',
    'E2E 测试': 'e2e',
    '突变测试': 'mutation',
    '输出脱敏': 'on_output',
    '双轨指令': 'dual_track',
    'MCP 翻译': 'use_mcp_adapter',
    'MCP 适配': 'use_mcp_adapter',
    '启用评审': 'enabled',
    '启用': 'enabled',
}

TITLE_STAGE_MAP: dict[str, str] = {
    '需求分析': 'req', '需求阶段': 'req',
    '架构设计': 'arch', '架构阶段': 'arch',
    '编码实现': 'coding', '编码阶段': 'coding',
    '代码评审': 'review', '评审阶段': 'review',
    '测试验证': 'test', '测试阶段': 'test',
    '隐私过滤': 'sanitize', '隐私': 'sanitize',
    'Shell 适配': 'shell', 'Shell': 'shell',
}

MAX_DEPTH = 4

# ─────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────

RE_HEADING = re.compile(r'^(#{1,6})\s+(.+?)\s*$')
RE_FM_DELIM = re.compile(r'^---\s*$')
RE_JSON_FENCE = re.compile(r'^```codex:json\s*$')
RE_CODE_FENCE = re.compile(r'^```')
RE_CUSTOM_MAP = re.compile(r'<!--\s*codex:map\s+(.+?)\s*→\s*([^\s]+)\s*-->')
RE_VAR = re.compile(r'\{\{([^{}]+)\}\}')
RE_CONDITIONAL = re.compile(r'\{\{([a-zA-Z_][\w.]*)\s*==\s*"([^"]*)"\}\}')
RE_AT_REF = re.compile(r'@ref:([^\s]+)')

# Checkbox forms (priority order matters!)
RE_CB_EN_KV = re.compile(r'^\s*-\s+\[(x|X|\s)\]\s+([a-zA-Z_][\w.]*)\s*[:：]\s*(.+)$')
RE_CB_CN_KV = re.compile(r'^\s*-\s+\[(x|X|\s)\]\s+(.+?)\s*[:：]\s*(.+)$')
RE_CB_EN_K = re.compile(r'^\s*-\s+\[(x|X|\s)\]\s+([a-zA-Z_][\w.]*)$')
RE_CB_CN_K = re.compile(r'^\s*-\s+\[(x|X|\s)\]\s+(.+)$')
RE_RADIO = re.compile(r'^\s*-\s+\((x|X|\s)\)\s+(.+)$')


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


# ─────────────────────────────────────────────
# v0.6.0（A6）：frontmatter schema 校验（PARSER §6.2）
# ─────────────────────────────────────────────

FM_TYPE_ENUM = {'requirement', 'design', 'adr', 'changelog', 'card', 'guide', 'config'}
FM_SEMANTIC_ENUM = {'spec', 'rule', 'context', 'template', 'runtime'}
FM_STAGE_ENUM = {'req', 'arch', 'coding', 'review', 'testing'}
FM_LANG_ENUM = {'typescript', 'python', 'go', 'java'}
FM_STATUS_ENUM = {'draft', 'active', 'deprecated', 'superseded'}
# 版本型文档（PARSER §6.2）：version / last_modified 必填
FM_VERSIONED_TYPES = {'requirement', 'design', 'adr', 'changelog', 'card'}

RE_SEMVER = re.compile(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$')
RE_ISO8601 = re.compile(
    r'^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?'
    r'(?:Z|[+-]\d{2}:?\d{2})?)?$'
)


def validate_frontmatter(fm: dict[str, Any]) -> list[str]:
    """按 PARSER §6.2 校验 frontmatter，返回问题清单（空 = 通过）。

    级别策略（PARSER §10 错误分级）：默认 warning（不阻塞解析，兼容存量文档），
    CLI --strict-schema 时升级为 error（退出码 2）。仅当文档带 frontmatter 时校验。
    """
    issues: list[str] = []
    if not fm:
        return issues

    def _req(key: str, kind: str) -> None:
        val = fm.get(key)
        if val is None or (isinstance(val, str) and not val.strip()):
            issues.append(f"frontmatter: missing required field '{key}' ({kind})")

    _req('title', 'string')
    _req('author', 'string')
    _req('status', 'enum')
    _req('type', 'enum')

    t = fm.get('type')
    if isinstance(t, str) and t not in FM_TYPE_ENUM:
        issues.append(
            f"frontmatter: invalid type '{t}' (expected one of "
            f"{sorted(FM_TYPE_ENUM)})")

    for key, enum in (('semantic', FM_SEMANTIC_ENUM), ('stage', FM_STAGE_ENUM),
                      ('lang', FM_LANG_ENUM), ('status', FM_STATUS_ENUM)):
        val = fm.get(key)
        if isinstance(val, str) and val not in enum:
            issues.append(
                f"frontmatter: invalid {key} '{val}' (expected one of {sorted(enum)})")

    if t in FM_VERSIONED_TYPES:
        v = fm.get('version')
        if v is None:
            issues.append(f"frontmatter: version required for type '{t}' (SemVer)")
        elif not isinstance(v, str) or not RE_SEMVER.match(v.strip()):
            issues.append(f"frontmatter: invalid version '{v}' (SemVer expected)")
        lm = fm.get('last_modified')
        if lm is None:
            issues.append(f"frontmatter: last_modified required for type '{t}' (ISO 8601)")
        elif not isinstance(lm, str) or not RE_ISO8601.match(lm.strip()):
            issues.append(f"frontmatter: invalid last_modified '{lm}' (ISO 8601 expected)")

    if fm.get('status') == 'superseded' and not fm.get('superseded_by'):
        issues.append("frontmatter: superseded_by required when status is 'superseded'")

    return issues


# ─────────────────────────────────────────────
# Minimal YAML parser (frontmatter subset)
# ─────────────────────────────────────────────

def parse_yaml_frontmatter(text: str) -> dict[str, Any]:
    """Parse a minimal YAML subset for frontmatter.

    Supports:
      - key: value
      - key: "quoted value"
      - key:  # nested dict or list follows
        child_key: value
        - list_item
      - key: number / true / false / null
      - Inline list: key: [a, b, c]
    """
    lines = text.splitlines()
    return _yaml_block(lines, 0, indent=0)[0]


def _yaml_block(lines: list[str], start: int, indent: int) -> tuple[dict[str, Any], int]:
    """Parse a YAML block at `indent`. Returns (parsed_dict, next_index)."""
    result: dict[str, Any] = {}
    i = start
    while i < len(lines):
        line = lines[i]
        if not line.strip() or line.strip().startswith('#'):
            i += 1
            continue
        cur_indent = len(line) - len(line.lstrip())
        if cur_indent < indent:
            break
        if cur_indent > indent:
            i += 1
            continue
        stripped = line.lstrip()
        if stripped.startswith('- '):
            break  # caller consumes lists
        m = re.match(r'^([A-Za-z_][\w-]*)\s*:\s*(.*)$', stripped)
        if not m:
            i += 1
            continue
        key, val = m.group(1), m.group(2).strip()

        if val == '' or val == '|':
            # Look ahead for nested dict or list
            child_indent: int | None = None
            nested: dict[str, Any] | None = None
            block_list: list[Any] = []
            j = i + 1
            while j < len(lines):
                inner = lines[j]
                if not inner.strip():
                    j += 1
                    continue
                inner_indent = len(inner) - len(inner.lstrip())
                if inner_indent <= indent:
                    break
                if child_indent is None:
                    child_indent = inner_indent
                if inner_indent != child_indent:
                    break
                inner_stripped = inner.lstrip()
                if inner_stripped.startswith('- '):
                    block_list.append(_yaml_scalar(inner_stripped[2:].strip()))
                    j += 1
                else:
                    # Nested dict — recurse once
                    nested, j = _yaml_block(lines, j, child_indent)
                    break
            if nested is not None:
                result[key] = nested
            elif block_list:
                result[key] = block_list
            else:
                result[key] = None
            i = j if (nested is not None or block_list) else i + 1
            continue

        # Inline list: [a, b, c]
        if val.startswith('[') and val.endswith(']'):
            inner = val[1:-1].strip()
            result[key] = [_yaml_scalar(s.strip()) for s in inner.split(',')] if inner else []
            i += 1
            continue
        result[key] = _yaml_scalar(val)
        i += 1
    return result, i


def _yaml_scalar(val: str) -> Any:
    """Convert a YAML scalar string to Python value."""
    if val.startswith('"') and val.endswith('"'):
        return val[1:-1]
    if val.startswith("'") and val.endswith("'"):
        return val[1:-1]
    low = val.lower()
    if low in ('true', 'yes'):
        return True
    if low in ('false', 'no'):
        return False
    if low in ('null', '~', 'none'):
        return None
    # Numeric?
    try:
        return int(val)
    except ValueError:
        pass
    try:
        return float(val)
    except ValueError:
        pass
    return val


# ─────────────────────────────────────────────
# Variable resolution
# ─────────────────────────────────────────────

def load_vars_yaml(path: Path) -> dict[str, Any]:
    """Load vars.yaml (same YAML subset as frontmatter)."""
    if not path.is_file():
        return {}
    try:
        return parse_yaml_frontmatter(path.read_text(encoding='utf-8'))
    except Exception:
        return {}


def build_variables(project_root: Path, vars_file: Path | None = None) -> dict[str, Any]:
    """Build variable resolution context.

    合并优先级（低 → 高）：
      os.environ（env 命名空间基座）
        < Layer 3: env-scanner（<运行时目录>/env-scan.json 的 variables）
        < Layer 2: 全局 vars.yaml（~/.specflow/vars.yaml，legacy 回退 ~/.codex-plugin/）
        < Layer 1: 项目 vars.yaml（<项目配置目录>/vars.yaml，最高）
      now/today 恒为实时值。

    v0.3.2 修复（P0-2）：os.environ 先注入为 env 基座，vars.yaml 的 env.* 后合并
    覆盖——此前 os.environ 在末尾无条件 update，导致 PARSER §5.5 的官方用例
    （用 vars.yaml 覆盖同名环境变量）永远失效。

    v0.7.0：路径改经 sfpaths 解析（项目 .specflow/ 新旧兼容 + 全局 ~/.specflow/）。
    """
    try:
        import sfpaths as _sfpaths
        _rt = lambda root, name: _sfpaths.runtime_path(root, name)   # noqa: E731
        _cfg = lambda root, name: _sfpaths.config_path(root, name)   # noqa: E731
        _global = lambda name: (_sfpaths.global_config_path(name)
                                if _sfpaths.global_config_exists(name)
                                else _sfpaths.global_config_path_legacy(name))  # noqa: E731
    except Exception:
        _rt = lambda root, name: root / '.specflow' / name           # noqa: E731
        _cfg = lambda root, name: root / '.specflow' / name          # noqa: E731
        _global = lambda name: Path(os.path.expanduser('~')) / '.specflow' / name  # noqa: E731

    # Base: os.environ as env namespace floor（可被上方各层覆盖）
    variables: dict[str, Any] = {'env': dict(os.environ)}

    # Layer 3: env-scanner（运行时 env-scan.json，路径经 sfpaths）
    env_scan_path = _rt(project_root, 'env-scan.json')
    if env_scan_path.is_file():
        try:
            scan = json.loads(env_scan_path.read_text(encoding='utf-8'))
            for ns, fields in (scan.get('variables', {}) or {}).items():
                if isinstance(fields, dict):
                    variables.setdefault(ns, {}).update(fields)
        except Exception:
            pass

    # Layer 2: global vars.yaml（v0.7.0：~/.specflow/vars.yaml，legacy 回退 ~/.codex-plugin/）
    global_vars = load_vars_yaml(_global('vars.yaml'))
    for ns, fields in (global_vars or {}).items():
        if isinstance(fields, dict):
            variables.setdefault(ns, {}).update(fields)

    # Layer 1: project vars.yaml (highest；路径经 sfpaths)
    if vars_file:
        project_vars = load_vars_yaml(vars_file)
    else:
        project_vars = load_vars_yaml(_cfg(project_root, 'vars.yaml'))
    for ns, fields in (project_vars or {}).items():
        if isinstance(fields, dict):
            variables.setdefault(ns, {}).update(fields)

    # Always-live namespaces
    variables['now'] = now_iso()
    variables['today'] = datetime.now().strftime('%Y-%m-%d')
    return variables


def resolve_variable(expr: str, variables: dict[str, Any]) -> tuple[str, bool, str | None]:
    """Resolve a single {{expr}} to (value, resolved, default_used).

    expr may be:
      namespace.field
      namespace.field|default:"fallback"
    """
    parts = expr.split('|', 1)
    var_name = parts[0].strip()
    default_part = parts[1].strip() if len(parts) == 2 else ''

    # Resolve namespace.field
    if '.' in var_name:
        ns, field = var_name.split('.', 1)
        ns_dict = variables.get(ns)
        if isinstance(ns_dict, dict) and field in ns_dict:
            val = ns_dict[field]
            if val is not None and val != '':
                return str(val), True, None
        elif ns == 'now' and not field:
            return variables.get('now', ''), True, None
    else:
        # No namespace — could be {{now}} or {{today}}
        if var_name == 'now':
            return variables.get('now', ''), True, None
        if var_name == 'today':
            return variables.get('today', ''), True, None

    # Use default if provided
    if default_part:
        m = re.match(r'default:\s*"([^"]*)"', default_part)
        if m:
            return m.group(1), True, 'default'
        m = re.match(r"default:\s*'([^']*)'", default_part)
        if m:
            return m.group(1), True, 'default'

    # Unresolved
    return '', False, None


def replace_variables(text: str, variables: dict[str, Any],
                      resolved: dict[str, str],
                      unresolved: list[str]) -> str:
    """Replace {{var}} in text, recording resolved/unresolved."""
    def _sub(match: re.Match[str]) -> str:
        expr = match.group(1).strip()
        # Skip {{TODO:xxx}} — leave as-is
        if expr.startswith('TODO:'):
            return match.group(0)
        val, ok, _src = resolve_variable(expr, variables)
        var_name = expr.split('|')[0].strip()
        if ok:
            resolved[var_name] = val
        else:
            if var_name not in unresolved:
                unresolved.append(var_name)
        return val

    return RE_VAR.sub(_sub, text)


def eval_condition(expr: str, variables: dict[str, Any]) -> bool:
    """Evaluate {{var == "value"}} conditional. Returns True if matches."""
    m = RE_CONDITIONAL.match('{{' + expr + '}}')
    if not m:
        # No condition — always include
        return True
    var_name = m.group(1)
    expected = m.group(2)
    val, ok, _ = resolve_variable(var_name, variables)
    return ok and val == expected


# ─────────────────────────────────────────────
# JSON block deep merge
# ─────────────────────────────────────────────

def deep_merge(target: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    """Recursively merge source into target."""
    for k, v in source.items():
        if k in target and isinstance(target[k], dict) and isinstance(v, dict):
            deep_merge(target[k], v)
        else:
            target[k] = v
    return target


def _flatten_config(obj: dict[str, Any], prefix: str = '') -> dict[str, Any]:
    """Flatten nested config into dotted keys (v0.3.2 / P0-1).

    {'coding': {'strict_types': True}} → {'coding.strict_types': True}
    空字典保留为叶子节点，避免键丢失。
    """
    out: dict[str, Any] = {}
    for k, v in (obj or {}).items():
        key = f"{prefix}{k}"
        if isinstance(v, dict) and v:
            out.update(_flatten_config(v, f"{key}."))
        else:
            out[key] = v
    return out


def _coerce_value(raw: str) -> Any:
    """Coerce a checkbox value string to int/bool/float/str."""
    s = raw.strip()
    if s.lower() == 'true':
        return True
    if s.lower() == 'false':
        return False
    if s.lower() in ('null', 'none'):
        return None
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        pass
    # Strip surrounding quotes
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1]
    return s


# ─────────────────────────────────────────────
# Parser
# ─────────────────────────────────────────────

class Parser:
    def __init__(self, file_path: Path, variables: dict[str, Any] | None = None,
                 resolve_vars: bool = True):
        self.file_path = file_path
        self.variables = variables or {}
        self.resolve_vars = resolve_vars
        self.warnings: list[str] = []
        self.errors: list[str] = []
        self.frontmatter: dict[str, Any] = {}
        self.sections: list[dict[str, Any]] = []
        self.loaded_section_ids: list[str] = []
        self.skipped_section_ids: list[str] = []
        self.config: dict[str, Any] = {}
        self.variables_resolved: dict[str, str] = {}
        self.variables_unresolved: list[str] = []
        self.custom_map: dict[str, str] = {}
        self.refs: list[str] = []

    def _warn(self, msg: str) -> None:
        self.warnings.append(msg)

    def _err(self, msg: str) -> None:
        self.errors.append(msg)

    def parse(self) -> dict[str, Any]:
        try:
            content = self.file_path.read_text(encoding='utf-8')
        except FileNotFoundError:
            self._err(f"file not found: {self.file_path}")
            return self._output()
        except Exception as exc:
            self._err(f"read failed: {exc}")
            return self._output()

        lines = content.splitlines()
        self._scan_custom_map(lines)
        self._parse_frontmatter(lines)
        # v0.6.0（A6）：frontmatter schema 校验（PARSER §6.2）——
        # 默认 warning；--strict-schema 时由 CLI 升级为 error（退出码 2）
        for issue in validate_frontmatter(self.frontmatter):
            self._warn(issue)
        self._parse_body(lines)

        return self._output()

    def _scan_custom_map(self, lines: list[str]) -> None:
        for ln, line in enumerate(lines, start=1):
            m = RE_CUSTOM_MAP.search(line)
            if m:
                cn, en = m.group(1).strip(), m.group(2).strip()
                self.custom_map[cn] = en

    def _parse_frontmatter(self, lines: list[str]) -> None:
        if not lines or not RE_FM_DELIM.match(lines[0]):
            return
        # Find closing ---
        end_idx = None
        for i in range(1, len(lines)):
            if RE_FM_DELIM.match(lines[i]):
                end_idx = i
                break
        if end_idx is None:
            self._err("frontmatter delimiter not closed")
            return
        try:
            self.frontmatter = parse_yaml_frontmatter('\n'.join(lines[1:end_idx]))
        except Exception as exc:
            self._err(f"frontmatter parse failed: {exc}")
            self.frontmatter = {}
        # Capture @ref: in frontmatter refs
        refs = self.frontmatter.get('refs') or []
        for r in refs:
            if isinstance(r, str):
                self.refs.append(r)

    def _parse_body(self, lines: list[str]) -> None:
        # Skip frontmatter
        body_start = 0
        if lines and RE_FM_DELIM.match(lines[0]):
            for i in range(1, len(lines)):
                if RE_FM_DELIM.match(lines[i]):
                    body_start = i + 1
                    break

        # First pass: identify sections (headings) — assign IDs
        section_starts: list[tuple[int, int, str, str]] = []
        for idx in range(body_start, len(lines)):
            m = RE_HEADING.match(lines[idx])
            if m:
                level = len(m.group(1))
                title = m.group(2).strip()
                stage = self._infer_stage(title)
                section_starts.append((idx, level, title, stage))

        # Build section tree with IDs (1, 1.1, 1.1.2)
        counters = [0] * 7
        for i, (idx, level, title, stage) in enumerate(section_starts):
            if level > MAX_DEPTH:
                self._err(f"heading level {level} exceeds max depth {MAX_DEPTH} "
                          f"at line {idx + 1}: '{title}'")
            counters[level - 1] += 1
            for j in range(level, len(counters)):
                counters[j] = 0
            sid = '.'.join(str(counters[k]) for k in range(level))
            end_line = (section_starts[i + 1][0] if i + 1 < len(section_starts)
                        else len(lines))
            self.sections.append({
                'id': sid, 'title': title, 'level': level, 'stage': stage,
                'selected': False, 'required': True, 'select_type': None,
                'children': [], 'parent': None, 'body': None,
                'start_line': idx + 1, 'end_line': end_line,
                'variables_used': [], 'outputs': [],
            })

        # Build parent/children relationships
        for i, sec in enumerate(self.sections):
            for j in range(i - 1, -1, -1):
                if self.sections[j]['level'] < sec['level']:
                    sec['parent'] = self.sections[j]['id']
                    self.sections[j]['children'].append(sec['id'])
                    break

        # Second pass: parse each section's content for checkboxes, radios, JSON blocks
        for i, sec in enumerate(self.sections):
            body_lines: list[str] = []
            in_json_block = False
            json_buf: list[str] = []
            stage_for_keys = sec['stage'] or self._inherit_stage(i)

            for ln_idx in range(sec['start_line'], sec['end_line']):
                line = lines[ln_idx] if ln_idx < len(lines) else ''
                # JSON block handling
                if RE_JSON_FENCE.match(line):
                    in_json_block = True
                    continue
                if in_json_block and RE_CODE_FENCE.match(line):
                    in_json_block = False
                    try:
                        block = json.loads('\n'.join(json_buf))
                        if isinstance(block, dict):
                            for k, v in block.items():
                                self._set_dotted(self.config, k, v)
                            self._mark_section_loaded(sec)
                        else:
                            self._warn(f"line {ln_idx + 1}: codex:json block is not an object, skipped")
                    except json.JSONDecodeError as exc:
                        self._warn(f"line {ln_idx + 1}: JSON block parse failed: {exc.msg}")
                    json_buf = []
                    continue
                if in_json_block:
                    json_buf.append(line)
                    continue
                # Checkbox / radio parsing
                if self._parse_checkbox_line(line, line.strip(), sec,
                                              stage_for_keys, body_lines, ln_idx):
                    continue
                # Skip custom-map comments in body
                if RE_CUSTOM_MAP.search(line):
                    continue
                body_lines.append(line)

            body_text = '\n'.join(body_lines).strip()
            # Capture @ref: references
            for m in RE_AT_REF.finditer(body_text):
                if m.group(1) not in self.refs:
                    self.refs.append(m.group(1))
            # Conditional loading: if condition fails, skip section
            should_load = True
            for var_name, expected in RE_CONDITIONAL.findall(body_text):
                val, ok, _ = resolve_variable(var_name, self.variables)
                if not (ok and val == expected):
                    should_load = False
                    self._warn(f"section {sec['id']} skipped due to unmet "
                               f"condition {var_name} == \"{expected}\" "
                               f"(actual: {val!r})")
                    break
            if not should_load:
                sec['selected'] = False
                sec['required'] = False
                if sec['id'] in self.loaded_section_ids:
                    self.loaded_section_ids.remove(sec['id'])
                if sec['id'] not in self.skipped_section_ids:
                    self.skipped_section_ids.append(sec['id'])
                continue

            if self.resolve_vars and body_text:
                used = [m.group(1).split('|')[0].strip()
                        for m in RE_VAR.finditer(body_text)
                        if not m.group(1).strip().startswith('TODO:')]
                sec['variables_used'] = sorted(set(used))
                body_text = replace_variables(
                    body_text, self.variables,
                    self.variables_resolved, self.variables_unresolved,
                )

            sec['body'] = body_text if body_text else None
            # Final loaded/skipped classification
            if sec['selected'] or sec['required']:
                if sec['id'] not in self.loaded_section_ids:
                    self.loaded_section_ids.append(sec['id'])
            elif sec['id'] not in self.skipped_section_ids:
                self.skipped_section_ids.append(sec['id'])

    def _parse_checkbox_line(self, line: str, stripped: str, sec: dict[str, Any],
                             stage: str | None, body_lines: list[str],
                             ln_idx: int) -> bool:
        """Try matching one of the 5 checkbox forms or the radio form."""
        is_checked = lambda m: m.group(1).lower() in ('x', 'X') if m else False
        # Form 1: English key + value
        if m := RE_CB_EN_KV.match(line):
            if is_checked(m):
                self._count_checked(sec)
            self._set_config(m.group(2), _coerce_value(m.group(3)), sec)
            return True
        # Form 2: Chinese + value
        if m := RE_CB_CN_KV.match(line):
            if is_checked(m):
                self._count_checked(sec)
            cn, val = m.group(2), m.group(3)
            en = self._lookup_capability(cn)
            if en:
                self._set_config(self._qualify(stage, en), _coerce_value(val), sec)
            else:
                self._warn(f"line {ln_idx + 1}: no capability map for '{cn}', skipped")
            return True
        # Form 3: English key only
        if m := RE_CB_EN_K.match(line):
            if is_checked(m):
                self._count_checked(sec)
            self._set_config(m.group(2), is_checked(m), sec)
            return True
        # Form 4: Chinese only
        if m := RE_CB_CN_K.match(line):
            cn = m.group(2)
            en = self._lookup_capability(cn)
            if en:
                if is_checked(m):
                    self._count_checked(sec)
                self._set_config(self._qualify(stage, en), is_checked(m), sec)
            # else: Form 5 — silently ignore
            return True
        # Radio: - ( ) / - (x)
        if m := RE_RADIO.match(line):
            checked, label = m.group(1), m.group(2)
            if sec.get('select_type') != 'multi':
                sec['select_type'] = 'single'
            if checked.lower() in ('x', 'X'):
                sec['selected'] = True
                cnt = sec.setdefault('_radio_selected_count', 0) + 1
                sec['_radio_selected_count'] = cnt
                # v0.3.2（P1-3）：同级多个 (x) 取第一个并 warning（此前取最后一个，与规范相悖）
                if cnt == 1 and stage and f"{stage}.selected" not in self.config:
                    self.config[f"{stage}.selected"] = label
                if cnt > 1:
                    self._warn(f"section {sec['id']}: multiple (x) selected — using first one only")
                self._mark_section_loaded(sec)
            elif (sec['id'] not in self.skipped_section_ids
                  and not sec.get('selected') and sec['id'] not in self.loaded_section_ids):
                self.skipped_section_ids.append(sec['id'])
            return True
        return False

    @staticmethod
    def _qualify(stage: str | None, key: str) -> str:
        return f"{stage}.{key}" if stage else key

    def _set_config(self, key: str, value: Any, sec: dict[str, Any]) -> None:
        self._set_dotted(self.config, key, value)
        self._mark_section_loaded(sec)

    def _count_checked(self, sec: dict[str, Any]) -> None:
        """v0.3.2（P1-5）：统计勾选框选中数，同节 ≥2 个选中 → select_type = multi。"""
        cnt = sec.get('_cb_checked_count', 0) + 1
        sec['_cb_checked_count'] = cnt
        if cnt >= 2:
            sec['select_type'] = 'multi'

    @staticmethod
    def _set_dotted(target: dict[str, Any], key: str, value: Any) -> None:
        """Set a dotted key (e.g. 'review.threshold') in target dict, deep-merging."""
        parts = key.split('.')
        if len(parts) == 1:
            target[parts[0]] = value
            return
        cur = target
        for p in parts[:-1]:
            if p not in cur or not isinstance(cur[p], dict):
                cur[p] = {}
            cur = cur[p]
        if isinstance(value, dict) and isinstance(cur.get(parts[-1]), dict):
            deep_merge(cur[parts[-1]], value)
        else:
            cur[parts[-1]] = value

    def _mark_section_loaded(self, sec: dict[str, Any]) -> None:
        sec['selected'] = True
        sec['required'] = False  # explicit checkbox means optional
        if sec['id'] not in self.loaded_section_ids:
            self.loaded_section_ids.append(sec['id'])
        if sec['id'] in self.skipped_section_ids:
            self.skipped_section_ids.remove(sec['id'])

    def _lookup_capability(self, cn: str) -> str | None:
        """Look up Chinese description → English key. Checks custom_map first."""
        return self.custom_map.get(cn) or CAPABILITY_MAP.get(cn)

    def _infer_stage(self, title: str) -> str | None:
        """Infer stage from heading title (Chinese or English)."""
        for cn, stage in TITLE_STAGE_MAP.items():
            if cn in title:
                return stage
        low = title.lower()
        for stage in ('req', 'arch', 'coding', 'review', 'test', 'sanitize', 'shell'):
            if stage in low:
                return 'test' if stage in ('test', 'testing') else stage
        return None

    def _inherit_stage(self, idx: int) -> str | None:
        """Inherit stage from nearest ancestor section."""
        target_level = self.sections[idx]['level']
        for j in range(idx - 1, -1, -1):
            if self.sections[j]['level'] < target_level and self.sections[j]['stage']:
                return self.sections[j]['stage']
        # Fall back to frontmatter stage
        return self.frontmatter.get('stage')

    def _output(self) -> dict[str, Any]:
        # Clean transient fields
        for sec in self.sections:
            sec.pop('_radio_selected_count', None)
            sec.pop('_cb_checked_count', None)
        return {
            'file': str(self.file_path),
            'parsed_at': now_iso(),
            'frontmatter': self.frontmatter,
            'sections': self.sections,
            'loaded_section_ids': self.loaded_section_ids,
            'skipped_section_ids': self.skipped_section_ids,
            'config': self.config,
            # v0.3.2（P0-1）：config 嵌套结构 + 扁平 dotted-key 视图（供 MCP / 脚本按扁平 key 查询）
            'config_flat': _flatten_config(self.config),
            'variables_resolved': self.variables_resolved,
            'variables_unresolved': self.variables_unresolved,
            'warnings': self.warnings,
            'errors': self.errors,
            'refs': self.refs,
            # v0.6.0（A6）：schema 校验结果单独成字段（与 warnings 同步，便于工具消费）
            'schema_issues': validate_frontmatter(self.frontmatter),
        }


# ─────────────────────────────────────────────
# Output formatters
# ─────────────────────────────────────────────

def fmt_summary(result: dict[str, Any]) -> str:
    return (
        f"file: {result.get('file', '-')} | "
        f"sections: {len(result.get('sections', []))} | "
        f"loaded: {len(result.get('loaded_section_ids', []))} | "
        f"skipped: {len(result.get('skipped_section_ids', []))} | "
        f"vars: {len(result.get('variables_resolved', {}))}/"
        f"{len(result.get('variables_unresolved', []))} | "
        f"warnings: {len(result.get('warnings', []))}"
    )


def fmt_md(result: dict[str, Any]) -> str:
    lines = [
        f"# 解析摘要：{result.get('file', '-')}",
        f"",
        f"- 总章节：{len(result.get('sections', []))}",
        f"- 已加载：{len(result.get('loaded_section_ids', []))}",
        f"- 已跳过：{len(result.get('skipped_section_ids', []))}",
        f"- 变量已解析：{len(result.get('variables_resolved', {}))}",
        f"- 变量未解析：{len(result.get('variables_unresolved', []))}",
        f"- 警告：{len(result.get('warnings', []))}",
        f"",
        f"## 已加载章节",
        f"",
        f"| ID | 标题 | 层级 | Stage |",
        f"|----|------|------|-------|",
    ]
    loaded = set(result.get('loaded_section_ids', []))
    for sec in result.get('sections', []):
        if sec['id'] in loaded:
            lines.append(
                f"| {sec['id']} | {sec['title']} | {sec['level']} | {sec.get('stage') or '-'} |"
            )
    if result.get('variables_unresolved'):
        lines.append(f"")
        lines.append(f"## 未解析变量")
        for v in result['variables_unresolved']:
            lines.append(f"- `{v}`")
    if result.get('warnings'):
        lines.append(f"")
        lines.append(f"## 警告")
        for w in result['warnings']:
            lines.append(f"- {w}")
    if result.get('errors'):
        lines.append(f"")
        lines.append(f"## 错误")
        for e in result['errors']:
            lines.append(f"- {e}")
    return '\n'.join(lines) + '\n'


# ─────────────────────────────────────────────
# v0.6.0（A6）：YAML / TOML 导出（零依赖手写导出器，CONVERGENCE §7.7）
# ─────────────────────────────────────────────

def _yaml_str(val: Any) -> str:
    """标量 → YAML 字面量。字符串统一用双引号（JSON 字符串是合法 YAML 流字符串）。"""
    if val is None:
        return 'null'
    if val is True:
        return 'true'
    if val is False:
        return 'false'
    if isinstance(val, (int, float)):
        return str(val)
    return json.dumps(str(val), ensure_ascii=False)


def _yaml_emit(obj: Any, indent: int = 0) -> list[str]:
    """dict/list 递归导出为块式 YAML（兼容解析结果中的嵌套结构）。"""
    pad = '  ' * indent
    out: list[str] = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            key = k if re.match(r'^[A-Za-z0-9_.\-]+$', str(k)) else json.dumps(str(k), ensure_ascii=False)
            if isinstance(v, dict) and v:
                out.append(f"{pad}{key}:")
                out.extend(_yaml_emit(v, indent + 1))
            elif isinstance(v, list) and v:
                out.append(f"{pad}{key}:")
                out.extend(_yaml_emit(v, indent + 1))
            else:
                if isinstance(v, list):
                    out.append(f"{pad}{key}: []")
                elif isinstance(v, dict):
                    out.append(f"{pad}{key}: {{}}")
                else:
                    out.append(f"{pad}{key}: {_yaml_str(v)}")
    elif isinstance(obj, list):
        for item in obj:
            if isinstance(item, (dict, list)) and item:
                # 子结构在 indent+1 层展开；首行的缩进替换为 "- "（块式列表项）
                sub = _yaml_emit(item, indent + 1)
                out.append(f"{pad}- {sub[0].lstrip()}")
                out.extend(sub[1:])
            else:
                out.append(f"{pad}- {_yaml_str(item)}")
    return out


def fmt_yaml(result: dict[str, Any]) -> str:
    lines = _yaml_emit(result)
    return '\n'.join(lines) + '\n'


def _toml_str(val: Any) -> str:
    return json.dumps(str(val), ensure_ascii=False)


def _toml_key(k: str) -> str:
    return k if re.match(r'^[A-Za-z0-9_\-]+$', str(k)) else json.dumps(str(k), ensure_ascii=False)


def _toml_scalar(val: Any) -> str | None:
    """标量 → TOML 字面量；None 无法在 TOML 表达 → 返回 None（导出时跳过该键）。"""
    if val is None:
        return None
    if val is True:
        return 'true'
    if val is False:
        return 'false'
    if isinstance(val, (int, float)):
        return str(val)
    if isinstance(val, str):
        return _toml_str(val)
    return None


def _toml_split(obj: dict[str, Any]) -> tuple[list[tuple[str, Any]], list[dict[str, Any]],
                                              list[list[Any]]]:
    """把 dict 顶层拆为标量键 / 子表 / 表数组三类。"""
    scalars: list[tuple[str, Any]] = []
    tables: list[dict[str, Any]] = []
    arrays: list[list[Any]] = []
    for k, v in obj.items():
        if isinstance(v, dict) and v:
            tables.append({k: v})
        elif isinstance(v, list) and v and all(isinstance(i, dict) and i for i in v):
            arrays.append([{k: i} for i in v])
        else:
            scalars.append((k, v))
    return scalars, tables, arrays


def _toml_emit(obj: dict[str, Any], path: list[str], out: list[str]) -> None:
    scalars, tables, arrays = _toml_split(obj)
    for k, v in scalars:
        if isinstance(v, list):
            items = [_toml_scalar(i) for i in v]
            if any(i is None for i in items):
                continue  # 含 null 的列表无法在 TOML 忠实表达 → 跳过
            out.append(f"{_toml_key(k)} = [{', '.join(items)}]")
        else:
            lit = _toml_scalar(v)
            if lit is not None:
                out.append(f"{_toml_key(k)} = {lit}")
    for tbl in tables:
        (k, v), = tbl.items()
        out.append('')
        out.append(f"[{'.'.join(_toml_key(p) for p in path + [k])}]")
        _toml_emit(v, path + [k], out)
    for arr in arrays:
        kv, = arr[0].items()
        k = kv[0]
        for item in arr:
            (ik, iv), = item.items()
            out.append('')
            out.append(f"[[{'.'.join(_toml_key(p) for p in path + [ik])}]]")
            _toml_emit(iv, path + [ik], out)


def fmt_toml(result: dict[str, Any]) -> str:
    out: list[str] = ['# doc-parser TOML export (v0.6.0 / A6)',
                      '# 注：null 值与含 null 的列表无法在 TOML 表达，导出时跳过']
    _toml_emit(result, [], out)
    return '\n'.join(out) + '\n'


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description='Markdown config parser per PARSER.md spec',
    )
    parser.add_argument('file', help='Markdown file to parse')
    parser.add_argument('--format', choices=['json', 'md', 'summary', 'yaml', 'toml'],
                        default='json', help='Output format')
    parser.add_argument('--stage', default=None,
                        help='Filter: only sections of this stage')
    parser.add_argument('--section', default=None,
                        help='Filter: only return this section id')
    parser.add_argument('--key', default=None,
                        help='Query: return only this config key value')
    parser.add_argument('--vars-file', default=None,
                        help='Custom vars.yaml path')
    parser.add_argument('--resolve-vars', default='true',
                        choices=['true', 'false'],
                        help='Whether to resolve variables (default: true)')
    parser.add_argument('--strict-schema', action='store_true',
                        help='（v0.6.0 / A6）frontmatter schema 问题升级为 error（退出码 2）')
    parser.add_argument('--no-cache', action='store_true',
                        help='（v0.6.0 / A6）绕过 mtime 解析缓存，强制重新解析')
    args = parser.parse_args()

    file_path = Path(args.file).resolve()
    if not file_path.is_file():
        print(f"error: file not found: {file_path}", file=sys.stderr)
        return 1

    # Determine project root: parent of file or look up for .specflow / .codex-plugin
    project_root = file_path.parent
    for ancestor in [file_path.parent, *file_path.parent.parents]:
        if ((ancestor / '.specflow').is_dir()
                or (ancestor / '.codex-plugin').is_dir()
                or (ancestor / '.git').is_dir()):
            project_root = ancestor
            break

    variables = build_variables(
        project_root,
        vars_file=Path(args.vars_file).resolve() if args.vars_file else None,
    )

    # v0.6.0（A6）：mtime 解析缓存 —— 输入（文件指纹 + vars 指纹 + 解析开关）不变时
    # 直接复用上次完整解析结果（缓存位于 <运行时目录>/parse-cache.json，路径经 sfpaths）
    # v0.7.1 修正缓存指纹盲区（三处，均为「声明=事实」修复）：
    #   ① build_variables 自动加载的变量源（env-scan.json / 全局 vars.yaml / 项目
    #      vars.yaml）不进指纹 —— 这些文件变更而主文档不变时，缓存返回过期变量结果；
    #   ② now/today 契约上「恒为实时值」，但结果被缓存后时间戳冻结在首次解析时刻
    #      —— 使用 {{now}}/{{today}} 的文档直接旁路缓存；
    #   ③ {{env.X}} 引用的环境变量不进指纹 —— 只把文档实际引用的 env 键值纳入
    #      指纹（全量 environ 会因 PWD/TERM 等噪音键击穿命中率）。
    try:
        import sfpaths as _sfpaths
        cache_path = _sfpaths.runtime_path(project_root, 'parse-cache.json')
    except Exception:
        cache_path = project_root / '.specflow' / 'parse-cache.json'

    try:
        _raw_text = file_path.read_text(encoding='utf-8', errors='ignore')
    except Exception:
        _raw_text = ''
    _uses_live_time = re.search(r'\{\{\s*(now|today)\b', _raw_text) is not None
    _env_keys_used = sorted(set(re.findall(r'\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)', _raw_text)))

    def _fingerprint(p: Path):
        try:
            st = p.stat()
            return [st.st_mtime_ns, st.st_size]
        except Exception:
            return None

    # v0.7.1 ①：build_variables 自动加载的变量源路径（与其内部回退同语义）
    def _auto_var_source_paths():
        try:
            import sfpaths as _sp
            proj = _sp.config_path(project_root, 'vars.yaml')
            glob_ = (_sp.global_config_path('vars.yaml')
                     if _sp.global_config_path('vars.yaml').is_file()
                     else _sp.global_config_path_legacy('vars.yaml'))
            env_scan = _sp.runtime_path(project_root, 'env-scan.json')
            return proj, glob_, env_scan
        except Exception:
            return (project_root / '.specflow' / 'vars.yaml',
                    Path(os.path.expanduser('~')) / '.specflow' / 'vars.yaml',
                    project_root / '.specflow' / 'env-scan.json')

    _proj_vars_p, _glob_vars_p, _env_scan_p = _auto_var_source_paths()

    cache_key = None
    cached_result: dict[str, Any] | None = None
    if not args.no_cache and not _uses_live_time:
        try:
            fp = file_path.stat()
            vars_fp = None
            if args.vars_file:
                vf = Path(args.vars_file).resolve()
                vars_fp = [vf.stat().st_mtime_ns, vf.stat().st_size] if vf.is_file() else None
            # v0.7.1 ①：自动加载的变量源进指纹（--vars_file 显式给定时刻项目
            # vars.yaml 不参与合并，无需指纹）
            auto_vars_fp = None if args.vars_file else _fingerprint(_proj_vars_p)
            cache_key = {
                'file': str(file_path),
                'mtime': fp.st_mtime_ns, 'size': fp.st_size,
                'vars_mtime': vars_fp[0] if vars_fp else None,
                'vars_size': vars_fp[1] if vars_fp else None,
                'resolve_vars': args.resolve_vars,
                'auto_vars_fp': auto_vars_fp,                     # 项目 vars.yaml（自动）
                'glob_vars_fp': _fingerprint(_glob_vars_p),       # 全局 vars.yaml
                'env_scan_fp': _fingerprint(_env_scan_p),         # env-scan.json（Layer 3）
                'env_refs': {k: os.environ.get(k) for k in _env_keys_used},  # v0.7.1 ③
            }
            if cache_path.is_file():
                cache_data = json.loads(cache_path.read_text(encoding='utf-8'))
                entry = cache_data.get(cache_key['file']) if isinstance(cache_data, dict) else None
                if isinstance(entry, dict) and entry.get('key') == cache_key \
                        and isinstance(entry.get('result'), dict):
                    cached_result = entry['result']
        except Exception:
            cached_result = None

    if cached_result is not None:
        result = dict(cached_result)
        result['cached'] = True
    else:
        try:
            parser_obj = Parser(
                file_path, variables=variables,
                resolve_vars=(args.resolve_vars == 'true'),
            )
            result = parser_obj.parse()
        except Exception as exc:
            # Never crash
            print(f"error: parse failed: {exc}", file=sys.stderr)
            return 2
        # 写回缓存（含错误的结果也缓存——输入不变则输出不变，可确定性重放；
        # v0.7.1 ②：使用 {{now}}/{{today}} 的结果不落缓存，保证恒实时值）
        if cache_key is not None and not _uses_live_time:
            try:
                cache_data = {}
                if cache_path.is_file():
                    cache_data = json.loads(cache_path.read_text(encoding='utf-8'))
                    if not isinstance(cache_data, dict):
                        cache_data = {}
                cache_data[cache_key['file']] = {'key': cache_key, 'result': result}
                cache_path.parent.mkdir(parents=True, exist_ok=True)
                cache_path.write_text(
                    json.dumps(cache_data, indent=2, ensure_ascii=False),
                    encoding='utf-8')
            except Exception:
                pass  # 缓存不可用仅损失性能

    # v0.6.0（A6）：--strict-schema → schema 问题升级为 error（退出码 2）
    if args.strict_schema:
        schema_issues = result.get('schema_issues') or []
        if schema_issues:
            result.setdefault('errors', []).extend(schema_issues)
            for issue in schema_issues:
                if issue not in (result.get('warnings') or []):
                    result.setdefault('warnings', []).append(issue)

    # Apply filters
    if args.stage:
        result['sections'] = [s for s in result['sections']
                              if s.get('stage') == args.stage]
    if args.section:
        result['sections'] = [s for s in result['sections']
                              if s['id'] == args.section]

    if args.key:
        # Return just the key's value
        parts = args.key.split('.')
        cur: Any = result.get('config', {})
        for p in parts:
            if isinstance(cur, dict) and p in cur:
                cur = cur[p]
            else:
                cur = None
                break
        print(json.dumps({'key': args.key, 'value': cur}, indent=2, ensure_ascii=False))
        return 0

    if args.format == 'json':
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif args.format == 'md':
        print(fmt_md(result))
    elif args.format == 'yaml':
        print(fmt_yaml(result))
    elif args.format == 'toml':
        print(fmt_toml(result))
    else:
        print(fmt_summary(result))

    return 0 if not result.get('errors') else 2


if __name__ == '__main__':
    sys.exit(main())
