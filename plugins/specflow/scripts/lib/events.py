#!/usr/bin/env python3
"""
events.py — specflow 扩展触发点事件总线（v0.6.0 / A7，HOOKS §2.3）

落地 HOOKS §2.3 的扩展触发点事件化：marker_resolved / all_markers_resolved /
batch_resolved / stage_enter / stage_exit / session_start / session_end /
git_pre_commit / git_post_checkout / git_post_merge / test_run / doc_version_bumped
统一追加写入 <project>/.specflow/events.jsonl（每行一个 JSON 事件，滚动上限 500 行）。
（v0.7.0 布局；旧项目 .codex/ 自动回退，见 sfpaths.py）

消费方：
  - todo-scanner.py（标记 3 态迁移 → marker/batch/all_resolved）
  - workflow-state.py（advance/goto/skip → stage_enter/stage_exit）
  - doc-version.py（bump → doc_version_bumped）
  - sf.sh events（人类可读查看器）
  - session-start.mjs 等 JS 侧走 hooks/scripts/events.mjs（同一文件同一格式）

事件格式（单行 JSON）：
  {"ts": "2026-09-02T08:00:00+08:00", "type": "marker_resolved", "payload": {...}}

设计约束：零依赖（stdlib）；写失败静默降级（事件总线故障不阻塞主流程）；
跨语言常量（EVENTS_PATH / 上限）与 hooks/scripts/events.mjs 保持一致。

CLI：
  python3 events.py <project_root> [limit]   # 查看最近 N 条（默认 20）
  python3 events.py <project_root> --json    # 原始 JSONL
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# v0.7.0：路径层 sfpaths（.specflow 新旧兼容，用户反馈第 1 项）
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import sfpaths as _sfpaths
except Exception:
    _sfpaths = None

EVENTS_NAME = 'events.jsonl'
EVENTS_MAX_LINES = 500      # 滚动上限（超过时截断保留最近 400）
EVENTS_KEEP_LINES = 400

# 已登记的事件类型（防止拼错；未知类型仍允许写入但 read 时标 warning）
KNOWN_EVENT_TYPES = {
    'marker_resolved', 'all_markers_resolved', 'batch_resolved',
    'stage_enter', 'stage_exit', 'session_start', 'session_end',
    'git_pre_commit', 'git_post_checkout', 'git_post_merge',
    'test_run', 'doc_version_bumped',
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='milliseconds')


def events_path(project_root: Path) -> Path:
    # v0.7.0：路径经 sfpaths 解析（新 .specflow/ / 旧 .codex/ 回退）
    if _sfpaths is not None:
        return _sfpaths.runtime_path(project_root, EVENTS_NAME)
    return Path(project_root) / '.specflow' / EVENTS_NAME


def append_event(project_root: Path, event_type: str,
                 payload: dict[str, Any] | None = None) -> bool:
    """追加一条事件。返回是否写入成功（失败静默——总线故障不阻塞主流程）。"""
    try:
        path = events_path(project_root)
        path.parent.mkdir(parents=True, exist_ok=True)
        event = {'ts': now_iso(), 'type': event_type, 'payload': payload or {}}
        with path.open('a', encoding='utf-8') as fh:
            fh.write(json.dumps(event, ensure_ascii=False) + '\n')
        _roll_if_needed(path)
        return True
    except Exception:
        return False


def _roll_if_needed(path: Path) -> None:
    try:
        n = 0
        with path.open('r', encoding='utf-8') as fh:
            for _ in fh:
                n += 1
        if n <= EVENTS_MAX_LINES:
            return
        with path.open('r', encoding='utf-8') as fh:
            lines = fh.readlines()
        with path.open('w', encoding='utf-8') as fh:
            fh.writelines(lines[-EVENTS_KEEP_LINES:])
    except Exception:
        pass


def read_events(project_root: Path, limit: int = 20) -> list[dict[str, Any]]:
    """读取最近 limit 条事件（旧的在前，新的在后；损坏行跳过并计 warning）。"""
    path = events_path(project_root)
    if not path.is_file():
        return []
    try:
        lines = path.read_text(encoding='utf-8').splitlines()
    except Exception:
        return []
    events: list[dict[str, Any]] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
            if isinstance(ev, dict) and ev.get('type'):
                events.append(ev)
        except Exception:
            continue
    return events[-limit:] if limit > 0 else events


def fmt_event(ev: dict[str, Any]) -> str:
    etype = ev.get('type', '?')
    ts = str(ev.get('ts', '?'))[:19].replace('T', ' ')
    payload = ev.get('payload') or {}
    unknown = '' if etype in KNOWN_EVENT_TYPES else '  [warn] 未知事件类型'
    if etype == 'marker_resolved':
        detail = f"{payload.get('marker', '?')}  reason={payload.get('reason', '-')}  via={payload.get('via', '-')}"
    elif etype == 'batch_resolved':
        ids = payload.get('ids') or []
        detail = f"{payload.get('count', len(ids))} 个: {', '.join(ids[:8])}{' …' if len(ids) > 8 else ''}"
    elif etype == 'all_markers_resolved':
        detail = f"全部 {payload.get('total_markers', '?')} 个标记已 resolved"
    elif etype == 'stage_enter':
        detail = f"agent={payload.get('agent', '?')}  stage={payload.get('stage', '?')}  from={payload.get('from', '-')}"
    elif etype == 'stage_exit':
        detail = (f"agent={payload.get('agent', '?')}  stage={payload.get('stage', '?')}  "
                  f"outputs={payload.get('outputs_check', '-')}  resolved={payload.get('markers_resolved', 0)}")
    elif etype in ('git_pre_commit', 'git_post_checkout', 'git_post_merge'):
        detail = f"result={payload.get('result', '-')}  {payload.get('detail', '')}".rstrip()
    elif etype == 'test_run':
        detail = (f"exit={payload.get('exit_code', '?')}  {payload.get('duration_ms', '?')}ms  "
                  f"cmd={payload.get('command', '-')}")
    elif etype == 'doc_version_bumped':
        files = payload.get('files') or []
        detail = f"{payload.get('bump', '?')}  {', '.join(str(f) for f in files[:5])}"
    elif etype in ('session_start', 'session_end'):
        detail = f"session={payload.get('session_id', '-')}  {payload.get('detail', '')}".rstrip()
    else:
        detail = json.dumps(payload, ensure_ascii=False)[:120]
    return f"[{ts}] {etype:<22} {detail}{unknown}"


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    root = Path(sys.argv[1]).resolve()
    as_json = '--json' in sys.argv
    limit = 20
    for a in sys.argv[2:]:
        if a.isdigit():
            limit = int(a)
    if not root.is_dir():
        print(f"error: project root not found: {root}", file=sys.stderr)
        return 1
    events = read_events(root, limit=0 if as_json else limit)
    if as_json:
        for ev in events:
            print(json.dumps(ev, ensure_ascii=False))
    else:
        if not events:
            print(f"（无事件——{events_path(root)} 不存在或为空）")
        for ev in events:
            print(fmt_event(ev))
    return 0


if __name__ == '__main__':
    sys.exit(main())
