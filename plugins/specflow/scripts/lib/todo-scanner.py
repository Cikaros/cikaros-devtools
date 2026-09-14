#!/usr/bin/env python3
"""
todo-scanner.py — TODO/FIXME Marker Scanner for specflow

Per CONVERGENCE.md §7.13 (3-state lifecycle) and §4.3 (simplification).

Scans project source files for //TODO#NNN and //FIXME#NNN markers, parses
metadata (@user, #issue, [agent:xxx], [depends:...], [priority:...]), reads
.specflow/todo.version for ID assignment, and writes .specflow/todo-state.json
（v0.7.0 布局；旧项目 .codex-plugin/.codex 自动回退，见 sfpaths.py）。

3-state lifecycle (NO in_progress):
  created → resolved → deleted (or created → deleted on cancel)

CLI:
  python3 todo-scanner.py <project_root> [--format=json|md|summary] [--incremental]

Uses only Python 3.10+ standard library.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import tokenize as _tk
from datetime import datetime
from pathlib import Path
from typing import Any

# v0.6.0（A7）：事件总线（与 hooks/scripts/events.mjs 同一 events.jsonl）；
# v0.7.0：路径层 sfpaths（.specflow 新旧兼容，用户反馈第 1 项）
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import events as _events
except Exception:  # 同目录缺失时降级为无事件
    _events = None
try:
    import sfpaths as _sfpaths
except Exception:  # sfpaths 缺失时降级为直接拼 .specflow
    _sfpaths = None


def _cfg_path(root: Path, name: str) -> Path:
    return _sfpaths.config_path(root, name) if _sfpaths else root / '.specflow' / name


def _rt_path(root: Path, name: str) -> Path:
    return _sfpaths.runtime_path(root, name) if _sfpaths else root / '.specflow' / name

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

DEFAULT_SCAN_DIRS = ('src', 'tests', 'lib', 'scripts', 'spec', 'docs')
DEFAULT_EXCLUDE_DIRS = {
    '.git', 'node_modules', 'dist', 'build', 'target', '.venv',
    '__pycache__', '.specflow', '.codex', '.codex-plugin', '.cache', 'vendor',
}

# Language comment styles: extension -> list of comment prefixes
LANG_COMMENT_STYLES: dict[str, list[str]] = {
    '.ts': ['//', '/*'], '.tsx': ['//', '/*'],
    '.js': ['//', '/*'], '.jsx': ['//', '/*'], '.mjs': ['//', '/*'],
    '.java': ['//', '/*'], '.go': ['//', '/*'], '.rs': ['//', '/*'],
    '.c': ['//', '/*'], '.h': ['//', '/*'], '.cpp': ['//', '/*'],
    '.kt': ['//', '/*'], '.swift': ['//', '/*'],
    '.py': ['#', '"""'],
    '.sh': ['#'], '.bash': ['#'], '.rb': ['#'], '.pl': ['#'],
    '.html': ['<!--'], '.htm': ['<!--'], '.xml': ['<!--'],
    '.vue': ['<!--', '//'], '.md': ['<!--'],
}

# 允许块注释续行（"* TODO#001"）与 Markdown 列表（"* TODO#001"）被识别为注释行
# （v0.4.0 修复：v0.3.0 会漏扫这两类标记）。C 风格语言与标记类文件适用；
# .py/.sh 等的前缀不含该形态，表达式续行不会被误判。
STAR_CONTINUATION_EXTS = {
    ext for ext, prefs in LANG_COMMENT_STYLES.items() if '//' in prefs or '<!--' in prefs
}

MARKER_RE = re.compile(
    # 匹配文档承诺的标记格式 //TODO#NNN / #TODO#NNN / # TODO#NNN / * TODO#NNN：
    # TODO/FIXME 之前允许行首、空白或注释字符（/ # *），否则 "x = 1  //TODO#001" 这类
    # 无空格写法会被漏扫（v0.3.0 修复）
    r'(?:^|[\s/#*])(?P<type>TODO|FIXME)#(?P<id>\d{1,6})(?P<ctx>.*)$'
)
RE_USER = re.compile(r'@([A-Za-z0-9_\-.]+)')
RE_ISSUE = re.compile(r'#(\d+)(?!\w)')
RE_BRACKET_META = re.compile(r'\[[^\]]*\]')  # v0.3.2（P1-1）：先剥离元数据再匹配 issue
RE_AGENT = re.compile(r'\[agent:([A-Za-z0-9_\-.]+)\]')
RE_DEPENDS = re.compile(
    r'\[depends:((?:TODO|FIXME)#\d+(?:\s*,\s*(?:TODO|FIXME)#\d+)*)\]'
)
RE_PRIORITY = re.compile(r'\[priority:(high|medium|low)\]', re.IGNORECASE)
RE_AFFECTS = re.compile(r'\[affects:([^\]]+)\]')

# v0.7.0：路径改经 sfpaths 解析（.specflow 单目录；旧项目回退 .codex-plugin/.codex）
# ——todo.version 属配置（config_path）；state/resolved/cache 属运行时（runtime_path）
TODO_VERSION_NAME = 'todo.version'      # 配置：ID 分配计数器
TODO_STATE_NAME = 'todo-state.json'     # 运行时：扫描状态
TODO_RESOLVED_NAME = 'todo-resolved.json'  # v0.4.0（B1）：resolved 信号（由 workflow advance 写入）
TODO_CACHE_NAME = 'todo-cache.json'     # v0.6.0（A6）：mtime 增量扫描缓存

# v0.6.0（A6）：扫描器逻辑版本——标记解析规则变更时递增，用于缓存失效
SCANNER_VERSION = 2

PRIORITY_ORDER = {'high': 0, 'medium': 1, 'low': 2}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


# ─────────────────────────────────────────────
# Marker parsing
# ─────────────────────────────────────────────

def parse_marker_context(ctx: str) -> dict[str, Any]:
    """Parse metadata from the trailing context after TODO#NNN."""
    text = ctx.strip()
    if text.startswith(':'):
        text = text[1:].strip()

    # Description = everything before first [
    bracket_idx = text.find('[')
    desc_end = bracket_idx if bracket_idx != -1 else len(text)
    description = text[:desc_end].strip().rstrip('-').strip()

    # v0.3.2（P1-1）：先剥离 [xxx] 元数据块再匹配 issue ——
    # 否则 [depends:TODO#003] 里的 #003 会被误报为 issue_ref
    meta_free_ctx = RE_BRACKET_META.sub(' ', ctx)

    m_user = RE_USER.search(ctx)
    m_issue = RE_ISSUE.search(meta_free_ctx)
    m_agent = RE_AGENT.search(ctx)
    m_depends = RE_DEPENDS.search(ctx)
    m_priority = RE_PRIORITY.search(ctx)
    m_affects = RE_AFFECTS.search(ctx)

    depends_on: list[str] = []
    if m_depends:
        depends_on = [d.strip() for d in re.split(r'\s*,\s*', m_depends.group(1)) if d.strip()]

    return {
        'user': m_user.group(1) if m_user else None,
        'issue_ref': f"#{m_issue.group(1)}" if m_issue else None,
        'agent': m_agent.group(1) if m_agent else None,
        'priority': m_priority.group(1).lower() if m_priority else 'medium',
        'depends_on': depends_on,
        'affects': m_affects.group(1) if m_affects else None,
        'description': description or None,
        'context': ctx.strip(),
    }


def _inline_comment_index(line: str, prefixes: list[str]) -> int:
    """v0.3.2（P0-3）：返回行内首个位于字符串字面量之外的注释 token 下标，无则 -1。

    仅对非注释行（代码行）调用：'x = 1; //TODO#007' 的 //TODO 段才被扫描；
    字符串字面量里的 "TODO#007" / "//TODO#007" 不算注释上下文，不误报。
    引号感知：跳过 '...' / "..." / `...`（含 \\ 转义）。
    """
    tokens = [p for p in prefixes if p in ('//', '/*', '#', '<!--')]
    quote: str | None = None
    i, n = 0, len(line)
    while i < n:
        ch = line[i]
        if quote:
            if ch == '\\':
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in ('"', "'", '`'):
            quote = ch
            i += 1
            continue
        for t in tokens:
            if line.startswith(t, i):
                return i
        i += 1
    return -1


def scan_file_python(path: Path, lines: list[str]) -> list[dict[str, Any]] | None:
    """v0.6.0（A6）：Python 文件 AST 级扫描（stdlib tokenize）。

    标记仅出现在 COMMENT token 中：字符串字面量 / docstring 里的 TODO/FIXME#NNN
    一律不误报（CONVERGENCE §7.7「AST 解析」决策落地；引号感知启发式作为降级路径）。
    tokenize 失败（语法未完成 / 非 Python 文本）返回 None，由调用方降级。
    """
    text = '\n'.join(lines) + ('\n' if lines else '')
    try:
        toks = list(_tk.generate_tokens(io.StringIO(text).readline))
    except Exception:
        return None
    markers: list[dict[str, Any]] = []
    for tok in toks:
        if tok.type != _tk.COMMENT:
            continue
        m = MARKER_RE.search(tok.string)
        if not m:
            continue
        meta = parse_marker_context(m.group('ctx'))
        marker_type = m.group('type')
        numeric_id = int(m.group('id'))
        line_no = tok.start[0]
        raw = lines[line_no - 1].rstrip() if 0 < line_no <= len(lines) else tok.string
        markers.append({
            'id': f"{marker_type}#{numeric_id:03d}",
            'type': marker_type,
            'numeric_id': numeric_id,
            'file': str(path),
            'line': line_no,
            'raw': raw,
            **meta,
        })
    return markers


def scan_file(path: Path) -> list[dict[str, Any]]:
    """Scan a single file for TODO/FIXME markers."""
    try:
        lines = path.read_text(encoding='utf-8', errors='replace').splitlines()
    except Exception:
        return []
    ext = path.suffix.lower()
    prefixes = LANG_COMMENT_STYLES.get(ext)
    if not prefixes:
        return []

    # v0.6.0（A6）：.py 走 tokenize AST 级扫描；失败（未完成语法等）降级启发式
    if ext == '.py':
        ast_markers = scan_file_python(path, lines)
        if ast_markers is not None:
            return ast_markers

    markers: list[dict[str, Any]] = []
    in_py_block = False

    for line_no, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        if ext == '.py':
            triple_count = line.count('"""')
            if in_py_block:
                if triple_count % 2 == 1:
                    in_py_block = False
            elif triple_count % 2 == 1:
                in_py_block = True

        is_comment = any(stripped.startswith(p) for p in prefixes)
        if not is_comment and stripped.startswith('*') and ext in STAR_CONTINUATION_EXTS:
            is_comment = True
        if not is_comment and '<!--' in stripped:
            if re.search(r'<!--.+?-->', stripped):
                is_comment = True

        m = None
        if is_comment:
            # 整行注释：扫描全行（含 * TODO 续行 / <!-- --> 行）
            m = MARKER_RE.search(line)
        else:
            # v0.3.2（P0-3）：代码行只扫描行内注释 token 之后的部分；
            # 字符串字面量中的 TODO/FIXME#NNN 不误报
            pos = _inline_comment_index(line, prefixes)
            if pos >= 0:
                m = MARKER_RE.search(line[pos:])

        if m:
            meta = parse_marker_context(m.group('ctx'))
            marker_type = m.group('type')
            numeric_id = int(m.group('id'))
            markers.append({
                'id': f"{marker_type}#{numeric_id:03d}",
                'type': marker_type,
                'numeric_id': numeric_id,
                'file': str(path),
                'line': line_no,
                'raw': line.rstrip(),
                **meta,
            })
    return markers


def _iter_source_files(root: Path, exclude: set[str], project_root: Path):
    if root.is_file():
        if root.suffix.lower() in LANG_COMMENT_STYLES:
            yield root
        return
    try:
        for entry in sorted(root.iterdir()):
            if entry.name in exclude or entry.name.startswith('.git'):
                continue
            if entry.is_dir():
                yield from _iter_source_files(entry, exclude, project_root)
            elif entry.is_file() and entry.suffix.lower() in LANG_COMMENT_STYLES:
                yield entry
    except (PermissionError, OSError):
        return


def load_scan_cache(project_root: Path) -> dict[str, Any]:
    """v0.6.0（A6）：读 mtime 增量缓存。结构 {"v":N,"files":{path:{mtime,size,markers}}}。"""
    path = _rt_path(project_root, TODO_CACHE_NAME)
    if not path.is_file():
        return {'v': SCANNER_VERSION, 'files': {}}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or data.get('v') != SCANNER_VERSION:
            return {'v': SCANNER_VERSION, 'files': {}}
        if not isinstance(data.get('files'), dict):
            return {'v': SCANNER_VERSION, 'files': {}}
        return data
    except Exception:
        return {'v': SCANNER_VERSION, 'files': {}}


def save_scan_cache(project_root: Path, cache: dict[str, Any]) -> None:
    path = _rt_path(project_root, TODO_CACHE_NAME)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(cache, indent=2, ensure_ascii=False), encoding='utf-8',
        )
    except Exception:
        pass  # 缓存不可写入仅损失性能，不影响正确性


def _file_fingerprint(path: Path) -> tuple[int, int] | None:
    try:
        st = path.stat()
        return st.st_mtime_ns, st.st_size
    except OSError:
        return None


def scan_project(project_root: Path, scan_dirs: list[str] | None = None,
                 exclude: set[str] | None = None,
                 use_cache: bool = True) -> list[dict[str, Any]]:
    project_root = project_root.resolve()
    scan_dirs = scan_dirs or list(DEFAULT_SCAN_DIRS)
    exclude = exclude or DEFAULT_EXCLUDE_DIRS

    # v0.6.0（A6）：mtime+size 指纹命中 → 直接复用上次该文件的原始扫描结果；
    # 仅缓存原始 markers（不含状态推断——状态随 todo-state/resolved 信号每次重算）
    cache = load_scan_cache(project_root) if use_cache else None
    cache_files: dict[str, Any] = {}
    cache_hits = 0

    all_markers: list[dict[str, Any]] = []
    seen_paths: set[Path] = set()
    candidate_roots: list[Path] = []
    for d in scan_dirs:
        path = project_root / d
        if path.is_dir():
            candidate_roots.append(path)
    candidate_roots.append(project_root)

    for root in candidate_roots:
        for path in _iter_source_files(root, exclude, project_root):
            if path in seen_paths:
                continue
            seen_paths.add(path)
            key = str(path)
            fp = _file_fingerprint(path)
            markers: list[dict[str, Any]] | None = None
            if cache is not None and fp is not None:
                entry = cache['files'].get(key)
                if (isinstance(entry, dict)
                        and entry.get('mtime') == fp[0]
                        and entry.get('size') == fp[1]
                        and isinstance(entry.get('markers'), list)):
                    markers = entry['markers']
                    cache_hits += 1
            if markers is None:
                markers = scan_file(path)
            if fp is not None:
                cache_files[key] = {
                    'mtime': fp[0], 'size': fp[1], 'markers': markers,
                }
            all_markers.extend(markers)

    if cache is not None:
        save_scan_cache(project_root, {'v': SCANNER_VERSION, 'files': cache_files})

    scan_project.last_cache_stats = {  # type: ignore[attr-defined]
        'files': len(cache_files), 'cache_hits': cache_hits,
    }
    return all_markers


# ─────────────────────────────────────────────
# Version tracking & lifecycle
# ─────────────────────────────────────────────

def read_todo_version(project_root: Path) -> dict[str, int]:
    path = _cfg_path(project_root, TODO_VERSION_NAME)
    result = {'TODO': 0, 'FIXME': 0}
    if not path.is_file():
        return result
    try:
        for line in path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if not line or line.startswith('#') or ':' not in line:
                continue
            key, val = line.split(':', 1)
            try:
                result[key.strip().upper()] = int(val.strip())
            except ValueError:
                continue
    except Exception:
        pass
    return result


def write_todo_version(project_root: Path, version: dict[str, int]) -> None:
    path = _cfg_path(project_root, TODO_VERSION_NAME)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(
            '\n'.join(f"{k}:{v:03d}" for k, v in sorted(version.items())) + '\n',
            encoding='utf-8',
        )
    except Exception:
        pass


def load_previous_state(project_root: Path) -> dict[str, Any]:
    path = _rt_path(project_root, TODO_STATE_NAME)
    if not path.is_file():
        return {'markers': {}}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return {'markers': {m['id']: m for m in data.get('markers', [])}}
    except Exception:
        return {'markers': {}}


def load_resolved_map(project_root: Path) -> dict[str, dict[str, Any]]:
    """v0.4.0（B1）：读取 todo-resolved.json（由 workflow-state advance 写入；路径经 sfpaths）。

    格式：{"TODO#003": {"reason": "stage:coding:outputs-verified",
                       "resolved_by": "agent:default", "at": "..."}}
    「产出存在 + 测试门禁通过（v0.6.0 起为真实执行器）→ resolved」的闭环信号源。
    """
    path = _rt_path(project_root, TODO_RESOLVED_NAME)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def infer_states(current: list[dict[str, Any]],
                 previous: dict[str, Any],
                 now: str,
                 resolved_map: dict[str, dict[str, Any]] | None = None,
                 project_root: Path | None = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Apply 3-state lifecycle (created/resolved/deleted, no in_progress).

    v0.4.0（B1）：注释仍在代码里 + id 出现在 todo-resolved.json → resolved；
    注释删除 → deleted（原有）；其余 → created / 继承旧状态。

    v0.6.0（A7）：返回 (merged, transitioned)——transitioned 为本次扫描中
    新迁入 resolved 态的标记（供 scan_project_state 发 marker_resolved /
    batch_resolved / all_markers_resolved 事件，HOOKS §2.3）。
    """
    prev_by_id = previous.get('markers', {})
    curr_by_id = {m['id']: m for m in current}
    resolved_map = resolved_map or {}
    transitioned: list[dict[str, Any]] = []

    result: list[dict[str, Any]] = []

    for m in current:
        prev = prev_by_id.get(m['id'])
        if prev:
            m['first_scanned_at'] = prev.get('first_scanned_at') or now
            m['resolved_at'] = prev.get('resolved_at')
            m['deleted_at'] = None
            prev_status = prev.get('status', 'created')
            # If previously resolved, keep resolved (until comment deleted)
            m['status'] = prev_status if prev_status != 'deleted' else 'created'
        else:
            m['first_scanned_at'] = now
            m['resolved_at'] = None
            m['deleted_at'] = None
            m['status'] = 'created'
        # v0.4.0（B1）：外部 resolved 信号 → resolved（注释仍在）
        entry = resolved_map.get(m['id'])
        if entry and m['status'] not in ('resolved', 'deleted'):
            was_status = m['status']
            m['status'] = 'resolved'
            m['resolved_at'] = entry.get('at') or now
            m['resolved_reason'] = entry.get('reason')
            m['resolved_by'] = entry.get('resolved_by')
            if was_status != 'resolved':
                transitioned.append(m)
        elif entry and m['status'] == 'resolved' and not m.get('resolved_reason'):
            m['resolved_reason'] = entry.get('reason')
            m['resolved_by'] = entry.get('resolved_by')
        result.append(m)

    # Markers that disappeared → deleted
    for prev_id, prev_m in prev_by_id.items():
        if prev_id in curr_by_id:
            continue
        deleted_m = dict(prev_m)
        deleted_m['deleted_at'] = now
        deleted_m['status'] = 'deleted'
        result.append(deleted_m)

    return result, transitioned


def check_start_gating(markers: list[dict[str, Any]], marker_id: str) -> dict[str, Any]:
    """v0.4.0（B1）：/todo start 前的 depends 门控。

    依赖标记未全部 resolved/completed → 拒绝，并给出未完成依赖清单。
    """
    target = next((m for m in markers if m['id'] == marker_id), None)
    if target is None:
        return {'marker': marker_id, 'allowed': False,
                'reason': 'marker not found', 'unresolved_deps': []}
    deps = target.get('depends_on') or []
    by_id = {m['id']: m for m in markers}
    unresolved = [d for d in deps
                  if d not in by_id or by_id[d].get('status') not in ('resolved',)]
    if unresolved:
        return {'marker': marker_id, 'allowed': False,
                'reason': 'unresolved dependencies', 'unresolved_deps': unresolved}
    return {'marker': marker_id, 'allowed': True,
            'reason': 'all dependencies resolved', 'unresolved_deps': []}


def detect_cycles(markers: list[dict[str, Any]]) -> list[str]:
    """Detect dependency cycles. Returns list of error messages."""
    graph: dict[str, list[str]] = {}
    ids = {m['id'] for m in markers}
    for m in markers:
        deps = m.get('depends_on') or []
        graph[m['id']] = [d for d in deps if d in ids]

    errors: list[str] = []
    color: dict[str, int] = {n: 0 for n in graph}  # 0=white, 1=gray, 2=black

    def visit(node: str, path: list[str]) -> bool:
        if color[node] == 1:
            errors.append(f"dependency cycle: {' → '.join(path + [node])}")
            return True
        if color[node] == 2:
            return False
        color[node] = 1
        for nb in graph.get(node, []):
            if visit(nb, path + [node]):
                return True
        color[node] = 2
        return False

    for n in graph:
        if color[n] == 0:
            visit(n, [])
    return errors


def check_single_file(markers: list[dict[str, Any]]) -> list[str]:
    warnings: list[str] = []
    by_id: dict[str, list[str]] = {}
    for m in markers:
        if m.get('file'):
            by_id.setdefault(m['id'], []).append(m['file'])
    for mid, files in by_id.items():
        if len(set(files)) > 1:
            warnings.append(
                f"{mid} appears in multiple files: {', '.join(sorted(set(files)))} "
                f"(single-file constraint violation)"
            )
    for m in markers:
        if m.get('affects'):
            warnings.append(
                f"{m['id']} in {Path(m['file']).name}:{m['line']} has [affects] "
                f"field (deprecated in v1.2.0 — single-file enforcement)"
            )
    return warnings


def sort_markers(markers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        markers,
        key=lambda m: (
            PRIORITY_ORDER.get(m.get('priority', 'medium'), 1),
            m.get('numeric_id', 0),
        ),
    )


def build_by_agent(markers: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_agent: dict[str, dict[str, Any]] = {}
    for m in markers:
        agent = m.get('agent') or 'default'
        bucket = by_agent.setdefault(agent, {
            'active': [], 'created_count': 0,
            'resolved_count': 0, 'deleted_count': 0,
        })
        status = m.get('status', 'created')
        if status == 'created':
            bucket['active'].append(m['id'])
            bucket['created_count'] += 1
        elif status == 'resolved':
            bucket['resolved_count'] += 1
        elif status == 'deleted':
            bucket['deleted_count'] += 1
    return by_agent


def build_summary(markers: list[dict[str, Any]]) -> dict[str, int]:
    counts = {'total': len(markers), 'created': 0, 'resolved': 0, 'deleted': 0}
    for m in markers:
        status = m.get('status', 'created')
        if status in counts:
            counts[status] += 1
    return counts


def write_state(project_root: Path, state: dict[str, Any]) -> Path:
    out_path = _rt_path(project_root, TODO_STATE_NAME)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(state, indent=2, ensure_ascii=False), encoding='utf-8',
    )
    return out_path


# ─────────────────────────────────────────────
# Output formatters
# ─────────────────────────────────────────────

def fmt_summary(state: dict[str, Any]) -> str:
    s = state['summary']
    return (
        f"markers: {s['total']} | created: {s['created']} | "
        f"resolved: {s['resolved']} | deleted: {s['deleted']} | "
        f"agents: {len(state.get('by_agent', {}))} | "
        f"warnings: {len(state.get('warnings', []))}"
    )


def fmt_md(state: dict[str, Any]) -> str:
    s = state['summary']
    lines = [
        f"# TODO/FIXME Scan: {state.get('project_root', '.')}",
        f"",
        f"- Scanned at: `{state.get('scanned_at')}`",
        f"- Total markers: **{s['total']}** "
        f"(created: {s['created']} / resolved: {s['resolved']} / deleted: {s['deleted']})",
        f"",
        f"## Markers (sorted by priority)",
        f"",
        f"| ID | Type | Priority | File:Line | Agent | Status | Depends |",
        f"|----|------|----------|-----------|-------|--------|---------|",
    ]
    for m in state.get('markers', []):
        loc = f"{Path(m['file']).name}:{m['line']}" if m.get('file') else '-'
        depends = ', '.join(m.get('depends_on') or []) or '-'
        lines.append(
            f"| `{m['id']}` | {m['type']} | {m.get('priority', '-')} | "
            f"`{loc}` | {m.get('agent') or '-'} | {m.get('status', '-')} | {depends} |"
        )
    if state.get('warnings'):
        lines.append(f"")
        lines.append(f"## Warnings")
        for w in state['warnings']:
            lines.append(f"- {w}")
    if state.get('errors'):
        lines.append(f"")
        lines.append(f"## Errors")
        for e in state['errors']:
            lines.append(f"- {e}")
    return '\n'.join(lines) + '\n'


# ─────────────────────────────────────────────
# Top-level scan
# ─────────────────────────────────────────────

def scan_project_state(
    project_root: Path,
    scan_dirs: list[str] | None = None,
    exclude: set[str] | None = None,
    incremental: bool = False,
    use_cache: bool = True,
) -> dict[str, Any]:
    project_root = project_root.resolve()
    now = now_iso()

    current_markers = scan_project(project_root, scan_dirs, exclude,
                                   use_cache=use_cache)
    version = read_todo_version(project_root)

    previous = {'markers': {}} if incremental else load_previous_state(project_root)
    resolved_map = load_resolved_map(project_root)
    merged, transitioned = infer_states(current_markers, previous, now,
                                        resolved_map=resolved_map,
                                        project_root=project_root)

    # v0.6.0（A7）：标记迁移事件（HOOKS §2.3 扩展触发点）——
    # marker_resolved（单个）/ batch_resolved（≥2 个）/ all_markers_resolved
    # （存在标记且全部 resolved）。事件总线写失败不影响扫描主流程。
    if _events is not None and transitioned:
        for m in transitioned:
            _events.append_event(project_root, 'marker_resolved', {
                'marker': m['id'],
                'reason': m.get('resolved_reason'),
                'resolved_by': m.get('resolved_by'),
                'file': (Path(m['file']).name if m.get('file') else None),
                'line': m.get('line'),
                'via': 'todo-scan',
            })
        if len(transitioned) >= 2:
            _events.append_event(project_root, 'batch_resolved', {
                'count': len(transitioned),
                'ids': [m['id'] for m in transitioned],
            })
        total_created = sum(1 for m in merged if m.get('status') == 'created')
        total_all = sum(1 for m in merged
                        if m.get('status') in ('created', 'resolved'))
        if total_all > 0 and total_created == 0:
            _events.append_event(project_root, 'all_markers_resolved', {
                'total_markers': total_all,
            })

    warnings = check_single_file(merged)
    errors = detect_cycles(merged)
    merged = sort_markers(merged)

    # Bump version counters for next ID assignment（v0.3.2 / P1-2：先 bump 后取 next_id）
    for m in current_markers:
        prefix = m['type']
        if m['numeric_id'] > version.get(prefix, 0):
            version[prefix] = m['numeric_id']
    write_todo_version(project_root, version)

    # next_id 在 bump 之后计算，供下一个新标记使用（此前恒滞后一拍）
    next_id = {'TODO': version.get('TODO', 0) + 1, 'FIXME': version.get('FIXME', 0) + 1}

    return {
        'scanned_at': now,
        'project_root': str(project_root),
        'next_id': next_id,
        'markers': merged,
        'by_agent': build_by_agent(merged),
        'summary': build_summary(merged),
        'warnings': warnings,
        'errors': errors,
        # v0.6.0（A6）：可观测性——扫描文件数与缓存命中数
        'cache': getattr(scan_project, 'last_cache_stats',
                         {'files': 0, 'cache_hits': 0}),
        # v0.6.0（A7）：本次扫描迁入 resolved 的标记（事件已在内部发出）
        'resolved_transitions': [m['id'] for m in transitioned],
    }


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description='TODO/FIXME marker scanner — produces .specflow/todo-state.json',
    )
    parser.add_argument('project_root', nargs='?', default='.',
                        help='Project root (default: current directory)')
    parser.add_argument('--format', choices=['json', 'md', 'summary'],
                        default='json', help='Output format')
    parser.add_argument('--incremental', action='store_true',
                        help='Skip loading previous state (treats all as newly created)')
    parser.add_argument('--paths', default=None,
                        help='Comma-separated scan directories')
    parser.add_argument('--exclude', default=None,
                        help='Comma-separated exclude names')
    parser.add_argument('--check-start', default=None, metavar='MARKER_ID',
                        help='（v0.4.0 / B1）depends 门控：检查标记是否可开工，'
                             '未完成依赖则退出码 3 并输出未完成清单')
    parser.add_argument('--no-cache', action='store_true',
                        help='（v0.6.0 / A6）绕过 mtime 增量缓存，强制全量重扫')
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    if not project_root.is_dir():
        print(f"error: project root does not exist: {project_root}", file=sys.stderr)
        return 1

    scan_dirs = args.paths.split(',') if args.paths else None
    exclude = set(args.exclude.split(',')) if args.exclude else None

    try:
        state = scan_project_state(
            project_root, scan_dirs=scan_dirs,
            exclude=exclude, incremental=args.incremental,
            use_cache=not args.no_cache,
        )
        write_state(project_root, state)
    except Exception as exc:
        # Never crash — return partial state
        print(f"error: scan failed: {exc}", file=sys.stderr)
        state = {
            'scanned_at': now_iso(),
            'project_root': str(project_root),
            'markers': [],
            'summary': {'total': 0, 'created': 0, 'resolved': 0, 'deleted': 0},
            'warnings': [],
            'errors': [f'scan failed: {exc}'],
            'by_agent': {},
            'next_id': {'TODO': 1, 'FIXME': 1},
        }
        try:
            write_state(project_root, state)
        except Exception:
            pass

    # v0.4.0（B1）：/todo start 前的 depends 门控（独立输出，退出码 3 = 被拒绝）
    if args.check_start:
        gate = check_start_gating(state.get('markers', []), args.check_start)
        print(json.dumps(gate, indent=2, ensure_ascii=False))
        return 0 if gate['allowed'] else 3

    if args.format == 'json':
        print(json.dumps(state, indent=2, ensure_ascii=False))
    elif args.format == 'md':
        print(fmt_md(state))
    else:
        print(fmt_summary(state))

    return 0 if not state.get('errors') else 2


if __name__ == '__main__':
    sys.exit(main())
