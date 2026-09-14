#!/usr/bin/env python3
"""
workflow-state.py — Multi-Agent Workflow State Machine for specflow

Per WORKFLOW.md spec.

Multi-Agent parallel + Agent-internal linear state machine. All state
persists to .specflow/workflow-state/ for restart recovery
（v0.7.0 布局；旧项目 .codex/ 自动回退，见 sfpaths.py）。

States (per stage): pending / in_progress / completed / blocked / skipped

State files:
  .specflow/workflow-state/global.json           # global shared state
  .specflow/workflow-state/agents/<id>.json      # per-agent state + history

Commands:
  status [--agent <id>] [--json]
  advance --agent <id>
  goto --agent <id> --stage <stage>
  skip --agent <id> [--force]
  reset --agent <id> [--force]
  block --agent <id> --reason "<text>"
  create-agent --id <id> --name "<name>"
  delete-agent --id <id> --confirm
  list-agents [--json]
  history --agent <id> [--limit N]
  import-outputs [--agent <id>] [--file <parsed-config.json>]   # v0.4.0（B2）

Uses only Python 3.10+ standard library. File locking via fcntl on Unix.
Max 5 concurrent agents (env CODEX_MAX_AGENTS overrides；
CODEX_MAX_AGENTS_HARD=1 时超额硬拒绝，默认仅警告).

v0.4.0（B1）：advance 阶段完成（产出检查通过）时，会把绑定到该 agent 的
created 状态标记写入 .specflow/todo-resolved.json —— 「产出存在 + 测试门禁
通过（v0.6.0 起为真实执行器）→ resolved」闭环的信号源。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

try:
    import fcntl  # type: ignore[import-not-found]
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False

# v0.6.0（A7）：事件总线（stage_enter / stage_exit 等，同 events.jsonl）
# v0.7.0：路径层 sfpaths（.specflow 新旧兼容，用户反馈第 1 项）
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import events as _events
except Exception:
    _events = None
try:
    import sfpaths as _sfpaths
except Exception:
    _sfpaths = None


def _rt_path(root: Path, name: str) -> Path:
    return _sfpaths.runtime_path(root, name) if _sfpaths else root / '.specflow' / name


def _cfg_path(root: Path, name: str) -> Path:
    return _sfpaths.config_path(root, name) if _sfpaths else root / '.specflow' / name

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

DEFAULT_STAGES = ['req-analysis', 'arch-design', 'coding', 'review', 'testing']
STAGE_STATES = ('pending', 'in_progress', 'completed', 'blocked', 'skipped')
MAX_AGENTS = int(os.environ.get('CODEX_MAX_AGENTS', '5'))
MAX_AGENTS_HARD = os.environ.get('CODEX_MAX_AGENTS_HARD', '') in ('1', 'true', 'yes')
ARCHIVE_DIR_NAME = 'archive/workflow-state'   # v0.7.0：相对运行时目录（sfpaths 解析）
TODO_RESOLVED_NAME = 'todo-resolved.json'   # v0.4.0（B1）
TODO_STATE_NAME = 'todo-state.json'
TEST_EXECUTOR_NAME = 'test-executor.json'   # v0.6.0（B1：真实测试执行器）
TEST_TIMEOUT_DEFAULT_S = 300
TEST_COMMAND_MAX_LEN = 2000   # v1.2.4 安全护栏：test-executor.json command 长度上限


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def state_dir(root: Path) -> Path:
    # v0.7.0：运行时目录经 sfpaths 解析（新 .specflow/ / 旧 .codex/ 回退）
    return _rt_path(root, 'workflow-state')


def agents_dir(root: Path) -> Path:
    return state_dir(root) / 'agents'


def agent_state_path(root: Path, agent_id: str) -> Path:
    return agents_dir(root) / f"{agent_id}.json"


def global_state_path(root: Path) -> Path:
    return state_dir(root) / 'global.json'


# ─────────────────────────────────────────────
# File locking (cross-platform)
# ─────────────────────────────────────────────

class FileLock:
    """fcntl.flock on Unix, no-op fallback on Windows."""

    def __init__(self, lock_path: Path):
        self.lock_path = lock_path
        self._fh = None

    def __enter__(self):
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.lock_path, 'w', encoding='utf-8')
        if HAS_FCNTL:
            try:
                fcntl.flock(self._fh.fileno(), fcntl.LOCK_EX)
            except OSError:
                pass
        return self

    def __exit__(self, *exc):
        if self._fh is not None:
            if HAS_FCNTL:
                try:
                    fcntl.flock(self._fh.fileno(), fcntl.LOCK_UN)
                except OSError:
                    pass
            self._fh.close()


# ─────────────────────────────────────────────
# Storage helpers
# ─────────────────────────────────────────────

def read_json(path: Path, default: Any = None) -> Any:
    if not path.is_file():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return default


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)


def read_agent(root: Path, agent_id: str) -> dict[str, Any] | None:
    return read_json(agent_state_path(root, agent_id), None)


def write_agent(root: Path, agent_id: str, data: dict[str, Any]) -> None:
    write_json_atomic(agent_state_path(root, agent_id), data)


def read_global(root: Path) -> dict[str, Any]:
    g = read_json(global_state_path(root), None)
    if g is None:
        g = {
            'project_name': root.name,
            'initialized_at': now_iso(),
            'agents': [],
            'shared_outputs': [],
            'shared_context': {},
        }
        write_json_atomic(global_state_path(root), g)
    return g


def write_global(root: Path, data: dict[str, Any]) -> None:
    write_json_atomic(global_state_path(root), data)


def append_history(agent: dict[str, Any], entry: dict[str, Any]) -> None:
    history = agent.setdefault('history', [])
    entry['ts'] = entry.get('ts') or now_iso()
    history.append(entry)
    if len(history) > 100:
        agent['history'] = history[-100:]


def _update_global_stage(root: Path, agent_id: str, stage: str) -> None:
    g = read_global(root)
    for a in g.get('agents', []):
        if a['id'] == agent_id:
            a['current_stage'] = stage
            break
    write_global(root, g)


# ─────────────────────────────────────────────
# Agent lifecycle
# ─────────────────────────────────────────────

def make_initial_agent(agent_id: str, name: str, stages: list[str] | None = None) -> dict[str, Any]:
    stages = stages or DEFAULT_STAGES
    first_stage = stages[0] if stages else None
    stages_map: dict[str, dict[str, Any]] = {
        s: {
            'status': 'pending',
            'started_at': None,
            'completed_at': None,
            'outputs': [],
            'active_markers': [],
        } for s in stages
    }
    # First stage starts in_progress
    if first_stage:
        stages_map[first_stage]['status'] = 'in_progress'
        stages_map[first_stage]['started_at'] = now_iso()
    return {
        'agent_id': agent_id,
        'agent_name': name,
        'created_at': now_iso(),
        'current_stage': first_stage,
        'stages': stages_map,
        'history': [],
    }


def list_agents(root: Path) -> list[dict[str, Any]]:
    return read_global(root).get('agents', [])


def _read_agent_config_md(root: Path, agent_id: str) -> dict[str, Any] | None:
    """v0.6.0（A9 / WORKFLOW §6.3）：读项目级 agents/<id>.md（路径经 sfpaths）。

    返回 {agent_name, stages}（勾选的「启用阶段」映射到内部阶段名）；
    文件不存在或解析失败返回 None（不影响默认行为）。
    """
    path = _cfg_path(root, f'agents/{agent_id}.md')
    if not path.is_file():
        return None
    try:
        text = path.read_text(encoding='utf-8')
    except Exception:
        return None
    name = None
    m = re.search(r'^agent_name:\s*(.+?)\s*$', text, re.M)
    if m:
        name = m.group(1).strip().strip('"\'')
    # 阶段名映射（中勾选 → 内部阶段 id）
    stage_alias = {
        '需求分析': 'req-analysis', '架构设计': 'arch-design',
        '编码实现': 'coding', '代码评审': 'review', '测试验证': 'testing',
        'req-analysis': 'req-analysis', 'arch-design': 'arch-design',
        'coding': 'coding', 'review': 'review', 'testing': 'testing',
    }
    # 在「启用阶段」章节内找勾选行
    checked: list[str] = []
    in_section = False
    for line in text.splitlines():
        s = line.strip()
        if s.startswith('#'):
            in_section = '启用阶段' in s
            continue
        if not in_section:
            continue
        m = re.match(r'^-\s*\[[xX]\]\s*(.+?)\s*$', s)
        if m:
            label = m.group(1).strip()
            stage = stage_alias.get(label, stage_alias.get(label.lower()))
            if stage and stage not in checked:
                checked.append(stage)
    result: dict[str, Any] = {}
    if name:
        result['agent_name'] = name
    if checked:
        result['stages'] = checked
    return result or None


def create_agent(root: Path, agent_id: str, name: str,
                 stages: list[str] | None = None) -> dict[str, Any]:
    if agent_id in {a['id'] for a in list_agents(root)}:
        raise ValueError(f"agent '{agent_id}' already exists")
    if len(list_agents(root)) >= MAX_AGENTS:
        # v0.3.2（P2-3）：默认软警告；CODEX_MAX_AGENTS_HARD=1 时硬拒绝
        msg = f"agent count exceeds max ({MAX_AGENTS})"
        if MAX_AGENTS_HARD:
            raise ValueError(msg + ' (hard limit, CODEX_MAX_AGENTS_HARD=1)')
        print(f"warning: {msg}", file=sys.stderr)

    # v0.6.0（A9）：项目级 agents/<id>.md 覆盖名称与阶段（显式 CLI 参数最优先）
    cfg_md = _read_agent_config_md(root, agent_id)
    if cfg_md:
        if not name and cfg_md.get('agent_name'):
            name = cfg_md['agent_name']
        if stages is None and cfg_md.get('stages'):
            stages = cfg_md['stages']

    agent = make_initial_agent(agent_id, name, stages)
    append_history(agent, {'action': 'agent_created', 'by': 'user'})
    write_agent(root, agent_id, agent)

    g = read_global(root)
    g.setdefault('agents', []).append({
        'id': agent_id, 'name': name, 'current_stage': agent['current_stage'],
    })
    write_global(root, g)
    return agent


def delete_agent(root: Path, agent_id: str, confirm: bool = False) -> bool:
    if not confirm:
        raise ValueError("--confirm required to delete agent")
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")

    archive_path = _rt_path(root, f'{ARCHIVE_DIR_NAME}/{agent_id}-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(agent, indent=2, ensure_ascii=False), encoding='utf-8')

    try:
        agent_state_path(root, agent_id).unlink()
    except FileNotFoundError:
        pass

    g = read_global(root)
    g['agents'] = [a for a in g.get('agents', []) if a['id'] != agent_id]
    write_global(root, g)
    return True


# ─────────────────────────────────────────────
# Stage operations
# ─────────────────────────────────────────────

def _next_stage(stages: list[str], current: str | None) -> str | None:
    if current is None or current not in stages:
        return stages[0] if stages else None
    idx = stages.index(current)
    return stages[idx + 1] if idx + 1 < len(stages) else None


def _check_prerequisites(agent: dict[str, Any], target_stage: str,
                         stages: list[str]) -> tuple[bool, str]:
    if target_stage not in stages:
        return False, f"unknown stage: {target_stage}"
    for s in stages[:stages.index(target_stage)]:
        status = agent['stages'].get(s, {}).get('status')
        if status not in ('completed', 'skipped'):
            return False, f"prerequisite '{s}' not completed (status={status})"
    return True, ''


def check_outputs(root: Path, agent: dict[str, Any], stage: str) -> dict[str, Any]:
    """Check that stage output files exist (best-effort, basic existence check)."""
    result: dict[str, Any] = {
        'agent_id': agent['agent_id'], 'stage': stage,
        'checked_at': now_iso(), 'outputs': [],
        'overall': 'passed', 'blocked_advance': False,
    }
    outputs = agent.get('stages', {}).get(stage, {}).get('outputs') or []
    for out in outputs:
        if isinstance(out, str):
            path_str, required = out, True
        else:
            path_str = out.get('path', '')
            required = out.get('required', True)
        full = Path(path_str) if Path(path_str).is_absolute() else root / path_str
        exists = full.exists()
        size = full.stat().st_size if exists and full.is_file() else 0
        entry = {'path': path_str, 'exists': exists, 'size': size,
                 'passed': exists or not required, 'required': required}
        if required and not exists:
            entry['reason'] = 'required output missing'
            result['overall'] = 'failed'
            result['blocked_advance'] = True
        result['outputs'].append(entry)

    check_path = _rt_path(root, 'output-check.json')
    check_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        check_path.write_text(json.dumps(result, indent=2, ensure_ascii=False),
                              encoding='utf-8')
    except Exception:
        pass
    return result


def _emit(event_type: str, payload: dict[str, Any], root: Path | None) -> None:
    """v0.6.0（A7）：安全发事件（总线故障不阻塞状态机主流程）。"""
    if _events is None or root is None:
        return
    try:
        _events.append_event(root, event_type, payload)
    except Exception:
        pass


# ─────────────────────────────────────────────
# v0.6.0（B1）：真实测试执行器
# ─────────────────────────────────────────────

def load_test_config(root: Path) -> dict[str, Any]:
    path = _rt_path(root, TEST_EXECUTOR_NAME)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def run_stage_tests(root: Path, agent_id: str, stage: str) -> dict[str, Any]:
    """advance 门禁的真实测试执行（替代 ADR-004 D2 的「测试通过」占位条件）。

    配置 test-executor.json（路径经 sfpaths）：
      { "command": "npm test", "timeout_seconds": 300,
        "stages": ["testing"],          # 空/缺省 = 所有阶段都门禁
        "run_on_advance": true }        # advance 离开该阶段时执行
    环境开关：SPECFLOW_SKIP_TESTS=1 → 一律跳过（排障用）。
    返回 {status: passed|blocked|skipped|error, command, exit_code, detail, ...}；
    事件 test_run 落 events.jsonl，报告落 test-report.json（均经 sfpaths 解析）。

    v0.7.2 跨平台注记：command 通过 `subprocess.run(command, shell=True, ...)`
    执行——Windows 上走 cmd.exe（即 %COMSPEC%），支持 `&&` / `||` / `&` 但不
    支持 bash 风格的 `$()` / `${VAR}` / `;`。Windows 用户配置 command 时请使用
    cmd.exe 兼容语法（如 `npm test && npm run lint`）或单条命令。

    v1.2.4 安全护栏（信任边界声明 + 输入校验）：
      test-executor.json 是**用户/项目自有配置**（经 sfpaths 落在项目运行时目录），
      command 由配置所有者完全控制并以其自身权限执行——这与 `make test` 执行
      项目 Makefile 属同一信任级别，不是插件引入的提权面。护栏仅做输入健全性：
      command 必须为非空字符串且 ≤ TEST_COMMAND_MAX_LEN（2000）字符——超限或
      类型异常（数字/对象等）拒绝执行并以 error 状态留痕，防止误配置与病态
      负载（超长串撑爆事件/报告文件）。恶意命令不在防御范围（配置文件属
      用户主权），与 ai-sdlc 的 .sdlc/ 写保护边界不同，特此显式声明。
    """
    cfg = load_test_config(root)
    result: dict[str, Any] = {
        'agent_id': agent_id, 'stage': stage, 'ran_at': now_iso(),
        'status': 'skipped',
    }
    if os.environ.get('SPECFLOW_SKIP_TESTS', '').strip().lower() in ('1', 'true', 'yes'):
        result['detail'] = 'SPECFLOW_SKIP_TESTS=1'
        return result
    command = cfg.get('command')
    if not command or cfg.get('enabled') is False:
        result['detail'] = '未配置 test-executor.json（B1 门禁未启用）'
        return result
    # v1.2.4 安全护栏：command 必须为非空字符串且长度受限（见 docstring 信任边界声明）
    if not isinstance(command, str) or not command.strip():
        result['status'] = 'error'
        result['detail'] = f'test-executor.json 的 command 必须为非空字符串（当前类型: {type(command).__name__}）'
        _emit('test_run', {'command': None, 'stage': stage, 'via': 'advance',
                           'guard': 'invalid-command-type'}, root)
        return result
    if len(command) > TEST_COMMAND_MAX_LEN:
        result['status'] = 'error'
        result['command'] = command[:120] + '…（截断）'
        result['detail'] = f'command 超长（{len(command)} > {TEST_COMMAND_MAX_LEN} 字符）——疑似病态配置，拒绝执行'
        _emit('test_run', {'command': result['command'], 'stage': stage, 'via': 'advance',
                           'guard': 'command-too-long'}, root)
        return result
    if cfg.get('run_on_advance') is False:
        result['detail'] = 'run_on_advance=false'
        return result
    stages = cfg.get('stages')
    if isinstance(stages, list) and stages and stage not in stages:
        result['detail'] = f'stage {stage} 不在门禁 stages 清单内'
        return result

    timeout = int(cfg.get('timeout_seconds') or TEST_TIMEOUT_DEFAULT_S)
    result['command'] = command
    t0 = datetime.now()
    try:
        p = subprocess.run(command, shell=True, cwd=root, capture_output=True,
                           text=True, timeout=timeout)
        rc, out = p.returncode, ((p.stdout or '') + (p.stderr or ''))
        result['exit_code'] = rc
        result['status'] = 'passed' if rc == 0 else 'blocked'
        result['detail'] = out[-800:].strip()
    except subprocess.TimeoutExpired:
        result['status'] = 'blocked'
        result['exit_code'] = 'timeout'
        result['detail'] = f'超时（>{timeout}s）'
    except Exception as exc:
        result['status'] = 'error'
        result['detail'] = f'执行失败: {exc}'
    result['duration_ms'] = (datetime.now() - t0).total_seconds() * 1000

    _emit('test_run', {
        'command': command,
        'exit_code': result.get('exit_code'),
        'duration_ms': result['duration_ms'],
        'stage': stage, 'via': 'advance',
    }, root)
    try:
        rp = _rt_path(root, 'test-report.json')
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(result, indent=2, ensure_ascii=False),
                      encoding='utf-8')
    except Exception:
        pass
    return result


def _complete_stage(agent: dict[str, Any], stage: str,
                    root: Path | None = None,
                    outputs_check: str = 'unknown') -> None:
    agent['stages'][stage]['status'] = 'completed'
    agent['stages'][stage]['completed_at'] = now_iso()
    # v0.6.0（A7）：stage_exit 事件（HOOKS §2.3）
    _emit('stage_exit', {
        'agent': agent.get('agent_id'),
        'stage': stage,
        'outputs_check': outputs_check,
    }, root)


def _mark_agent_markers_resolved(root: Path, agent_id: str, stage: str) -> int:
    """v0.4.0（B1）：阶段完成（产出检查通过）→ 把该 agent 的 created 标记
    写入 todo-resolved.json（路径经 sfpaths；v0.6.0 起测试门禁为真实执行器，
    见 ADR-004 增补 / ADR-006）。返回本次写入条数。
    """
    state = read_json(_rt_path(root, TODO_STATE_NAME), None)
    if not state:
        return 0
    markers = state.get('markers', [])
    resolved = read_json(_rt_path(root, TODO_RESOLVED_NAME), {}) or {}
    now = now_iso()
    count = 0
    for m in markers:
        mid = m.get('id')
        if not mid or m.get('status') != 'created':
            continue
        m_agent = m.get('agent') or 'default'
        if m_agent != agent_id:
            continue
        resolved[mid] = {
            'reason': f'stage:{stage}:outputs-verified',
            'resolved_by': f'agent:{agent_id}',
            'at': now,
        }
        count += 1
    if count:
        try:
            p = _rt_path(root, TODO_RESOLVED_NAME)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(resolved, indent=2, ensure_ascii=False),
                         encoding='utf-8')
        except Exception:
            return 0
    return count


def _start_stage(agent: dict[str, Any], stage: str,
                 root: Path | None = None,
                 from_stage: str | None = None) -> None:
    agent['current_stage'] = stage
    agent['stages'][stage]['status'] = 'in_progress'
    if not agent['stages'][stage]['started_at']:
        agent['stages'][stage]['started_at'] = now_iso()
    # v0.6.0（A7）：stage_enter 事件（HOOKS §2.3）
    _emit('stage_enter', {
        'agent': agent.get('agent_id'),
        'stage': stage,
        'from': from_stage,
    }, root)


def advance(root: Path, agent_id: str) -> dict[str, Any]:
    """Advance agent to next stage. Checks outputs first."""
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")
    stages = list(agent['stages'].keys())
    current = agent.get('current_stage')
    if current is None:
        raise ValueError("agent has no current_stage")

    cur_status = agent['stages'][current]['status']
    if cur_status == 'completed':
        nxt = _next_stage(stages, current)
        if nxt is None:
            return {'agent_id': agent_id, 'action': 'advance',
                    'result': 'no_more_stages', 'current_stage': current}
        _start_stage(agent, nxt, root, from_stage=current)
        append_history(agent, {'action': 'stage_advanced', 'from': current, 'to': nxt})
        write_agent(root, agent_id, agent)
        _update_global_stage(root, agent_id, nxt)
        return {'agent_id': agent_id, 'action': 'advance', 'from': current,
                'to': nxt, 'current_stage': nxt, 'result': 'ok'}

    if cur_status != 'in_progress':
        raise ValueError(f"cannot advance from status '{cur_status}' (must be in_progress)")

    check = check_outputs(root, agent, current)
    if check['overall'] == 'failed':
        return {'agent_id': agent_id, 'action': 'advance', 'result': 'blocked',
                'reason': 'required outputs missing', 'check': check}

    # v0.6.0（B1）：真实测试执行门禁（替代「测试通过 = outputs check passed」
    # 占位条件，ADR-004 D2 → ADR-006）：配置了 test-executor 且匹配当前阶段时
    # 真跑测试；失败/超时 → advance 被阻塞（阶段保持 in_progress）
    test_gate = run_stage_tests(root, agent_id, current)
    if test_gate['status'] == 'blocked':
        return {'agent_id': agent_id, 'action': 'advance', 'result': 'blocked',
                'reason': 'tests failed (see test-report.json)',
                'test': test_gate}

    _complete_stage(agent, current, root,
                    outputs_check=('passed' if check['overall'] != 'failed' else 'failed'))
    # v0.4.0（B1）：产出检查通过 → 该 agent 的 created 标记记为 resolved 信号
    markers_resolved = _mark_agent_markers_resolved(root, agent_id, current)
    # v0.6.0（A8）：阶段产出文档自动 minor bump（COMMANDS §13.3——命令完成后
    # bump 产出文档版本；单文件失败不阻塞 advance，doc_version_bumped 事件留痕）
    try:
        import importlib.util as _ilu
        _dv_path = Path(__file__).resolve().parent / 'doc-version.py'
        _spec = _ilu.spec_from_file_location('doc_version', _dv_path)
        _dv = _ilu.module_from_spec(_spec)
        _spec.loader.exec_module(_dv)
        _dv.bump_stage_outputs(root, agent_id, current, level='minor')
    except Exception:
        pass
    nxt = _next_stage(stages, current)
    if nxt is None:
        append_history(agent, {'action': 'stage_advanced', 'from': current, 'to': 'END'})
        write_agent(root, agent_id, agent)
        _update_global_stage(root, agent_id, current)
        return {'agent_id': agent_id, 'action': 'advance', 'from': current,
                'to': 'END', 'current_stage': current, 'result': 'workflow_complete',
                'markers_resolved': markers_resolved}

    _start_stage(agent, nxt, root, from_stage=current)
    append_history(agent, {'action': 'stage_advanced', 'from': current, 'to': nxt})
    write_agent(root, agent_id, agent)
    _update_global_stage(root, agent_id, nxt)
    return {'agent_id': agent_id, 'action': 'advance', 'from': current,
            'to': nxt, 'current_stage': nxt, 'result': 'ok',
            'markers_resolved': markers_resolved}


def goto(root: Path, agent_id: str, stage: str) -> dict[str, Any]:
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")
    stages = list(agent['stages'].keys())
    ok, reason = _check_prerequisites(agent, stage, stages)
    if not ok:
        return {'agent_id': agent_id, 'action': 'goto', 'stage': stage,
                'result': 'blocked', 'reason': reason}

    old = agent.get('current_stage')
    if old and old in agent['stages'] and agent['stages'][old]['status'] == 'in_progress':
        _complete_stage(agent, old, root, outputs_check='goto')
    _start_stage(agent, stage, root, from_stage=old)
    append_history(agent, {'action': 'stage_goto', 'from': old, 'to': stage})
    write_agent(root, agent_id, agent)
    _update_global_stage(root, agent_id, stage)
    return {'agent_id': agent_id, 'action': 'goto', 'from': old,
            'to': stage, 'current_stage': stage, 'result': 'ok'}


def skip(root: Path, agent_id: str, force: bool = False) -> dict[str, Any]:
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")
    stages = list(agent['stages'].keys())
    current = agent.get('current_stage')
    if current is None:
        raise ValueError("agent has no current_stage")
    if not force:
        return {'agent_id': agent_id, 'action': 'skip', 'result': 'needs_confirmation',
                'message': 'use --force to skip'}
    _complete_stage(agent, current, root, outputs_check='skipped')
    agent['stages'][current]['status'] = 'skipped'
    nxt = _next_stage(stages, current)
    if nxt:
        _start_stage(agent, nxt, root, from_stage=current)
    append_history(agent, {'action': 'stage_skipped', 'stage': current})
    write_agent(root, agent_id, agent)
    if nxt:
        _update_global_stage(root, agent_id, nxt)
    return {'agent_id': agent_id, 'action': 'skip', 'stage': current,
            'next': nxt, 'current_stage': nxt, 'result': 'ok'}


def reset(root: Path, agent_id: str, force: bool = False) -> dict[str, Any]:
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")
    if not force:
        return {'agent_id': agent_id, 'action': 'reset', 'result': 'needs_confirmation',
                'message': 'use --force to reset'}
    archive_path = _rt_path(root, f'{ARCHIVE_DIR_NAME}/{agent_id}-reset-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    archive_path.write_text(json.dumps(agent, indent=2, ensure_ascii=False), encoding='utf-8')
    new_agent = make_initial_agent(agent_id, agent.get('agent_name', agent_id),
                                   stages=list(agent['stages'].keys()))
    append_history(new_agent, {'action': 'agent_reset'})
    write_agent(root, agent_id, new_agent)
    _update_global_stage(root, agent_id, new_agent['current_stage'])
    return {'agent_id': agent_id, 'action': 'reset', 'result': 'ok'}


def block(root: Path, agent_id: str, reason: str) -> dict[str, Any]:
    agent = read_agent(root, agent_id)
    if not agent:
        raise ValueError(f"agent '{agent_id}' not found")
    current = agent.get('current_stage')
    if current is None:
        raise ValueError("agent has no current_stage")
    agent['stages'][current]['status'] = 'blocked'
    agent['stages'][current]['block_reason'] = reason
    append_history(agent, {'action': 'stage_blocked', 'stage': current, 'reason': reason})
    write_agent(root, agent_id, agent)
    return {'agent_id': agent_id, 'action': 'block', 'stage': current,
            'reason': reason, 'result': 'ok'}


def status(root: Path, agent_id: str) -> dict[str, Any]:
    agent = read_agent(root, agent_id)
    if not agent:
        # v0.4.0（B3）：default agent 自动创建——CLI 默认 --agent default，
        # init / session-start 不再需要预先 create-agent
        if agent_id == 'default':
            agent = create_agent(root, 'default', 'Default Agent')
        else:
            raise ValueError(f"agent '{agent_id}' not found")
    return {
        'agent_id': agent['agent_id'],
        'agent_name': agent['agent_name'],
        'current_stage': agent['current_stage'],
        'stages': agent['stages'],
        'history_tail': agent.get('history', [])[-10:],
    }


def history(root: Path, agent_id: str, limit: int = 50) -> list[dict[str, Any]]:
    agent = read_agent(root, agent_id)
    if not agent:
        if agent_id == 'default':
            agent = create_agent(root, 'default', 'Default Agent')
        else:
            raise ValueError(f"agent '{agent_id}' not found")
    return agent.get('history', [])[-limit:]


# ─────────────────────────────────────────────
# Output import（v0.4.0 / B2）
# ─────────────────────────────────────────────


def import_outputs(root: Path, agent_id: str, parsed_file: Path | None = None) -> dict[str, Any]:
    """把 config.md 的产出声明导入 agent 状态 outputs（ADR-004）。

    来源（按优先级）：
      1. frontmatter `output` 字段（字符串 / 对象 / 列表，可带 stage 与 required）
      2. config_flat 中 `<stage>.outputs` / `outputs` 键的列表（字符串或 {path,required,stage}）
    路由：带 stage 或能命中 agent 阶段名的 → 对应阶段；否则 → 当前阶段。
    幂等：重复导入去重（按 path）。advance 在产出缺失时真实阻塞。
    """
    file = parsed_file or _rt_path(root, 'parsed-config.json')
    parsed = read_json(file, None)
    if parsed is None:
        return {'action': 'import-outputs', 'result': 'failed',
                'reason': f'parsed config not found: {file}'}

    # status 自动创建 default（B3）
    agent = read_agent(root, agent_id)
    if not agent:
        if agent_id != 'default':
            return {'action': 'import-outputs', 'result': 'failed',
                    'reason': f"agent '{agent_id}' not found"}
        agent = create_agent(root, 'default', 'Default Agent')
    agent_stages = set(agent['stages'].keys())

    flat: dict[str, Any] = parsed.get('config_flat') or {}
    fm: dict[str, Any] = parsed.get('frontmatter') or {}

    candidates: list[dict[str, Any]] = []

    def _add(path_str: Any, stage: str | None, required: bool, source: str) -> None:
        if isinstance(path_str, str) and path_str.strip():
            candidates.append({'path': path_str.strip(), 'stage': stage,
                               'required': required, 'source': source})
        elif isinstance(path_str, dict) and path_str.get('path'):
            candidates.append({
                'path': str(path_str['path']),
                'stage': path_str.get('stage') or stage,
                'required': bool(path_str.get('required', required)),
                'source': source,
            })

    # 1) frontmatter output
    fm_out = fm.get('output') or fm.get('outputs')
    if isinstance(fm_out, (list, tuple)):
        for o in fm_out:
            _add(o, None, True, 'frontmatter')
    elif fm_out:
        _add(fm_out, None, True, 'frontmatter')

    # 2) config_flat outputs 键
    for key, val in flat.items():
        stage = key[:-len('.outputs')] if key.endswith('.outputs') else None
        if key.endswith('.outputs') or key == 'outputs':
            if isinstance(val, (list, tuple)):
                for o in val:
                    _add(o, stage, True, f'config:{key}')
            elif val:
                _add(val, stage, True, f'config:{key}')

    imported: list[str] = []
    for cand in candidates:
        stage = cand['stage']
        if stage not in agent_stages:
            stage = agent.get('current_stage')
        if not stage or stage not in agent_stages:
            continue
        bucket = agent['stages'][stage].setdefault('outputs', [])
        if any((o.get('path') if isinstance(o, dict) else o) == cand['path'] for o in bucket):
            continue  # 幂等去重
        bucket.append({'path': cand['path'], 'required': cand['required']})
        imported.append(f"{stage}:{cand['path']}")

    if imported:
        append_history(agent, {'action': 'outputs_imported', 'count': len(imported)})
        write_agent(root, agent_id, agent)

    return {
        'action': 'import-outputs', 'agent_id': agent_id, 'result': 'ok',
        'imported': imported, 'imported_count': len(imported),
        'candidate_count': len(candidates),
        'agent_current_stage': agent.get('current_stage'),
    }


# ─────────────────────────────────────────────
# Output formatters
# ─────────────────────────────────────────────

def fmt_status(agent: dict[str, Any]) -> str:
    lines = [
        f"Agent: {agent['agent_id']}（{agent.get('agent_name', '')}）",
        f"当前阶段: {agent.get('current_stage', '-')}",
        f"",
        f"阶段进度:",
    ]
    for s, data in agent.get('stages', {}).items():
        marker = '✓' if data['status'] == 'completed' else ('→' if data['status'] == 'in_progress' else '○')
        started = (data.get('started_at') or '-')[:19]
        completed = (data.get('completed_at') or '-')[:19]
        lines.append(f"  {marker} {s:<16} {data['status']:<12} {started} → {completed}")
        if data.get('active_markers'):
            lines.append(f"    活跃标记: {', '.join(data['active_markers'])}")
    return '\n'.join(lines) + '\n'


def fmt_list(agents: list[dict[str, Any]]) -> str:
    if not agents:
        return "(no agents)\n"
    lines = ["Agents:"]
    for a in agents:
        lines.append(f"  - {a['id']:<12} {a.get('name', ''):<20} current: {a.get('current_stage', '-')}")
    return '\n'.join(lines) + '\n'


def fmt_history(entries: list[dict[str, Any]]) -> str:
    if not entries:
        return "(no history)\n"
    lines = ["History:"]
    for e in entries:
        ts = e.get('ts', '')[:19]
        action = e.get('action', '?')
        extra = []
        if 'from' in e and 'to' in e:
            extra.append(f"{e['from']} → {e['to']}")
        elif 'stage' in e:
            extra.append(f"stage={e['stage']}")
        if 'reason' in e:
            extra.append(f"reason=\"{e['reason']}\"")
        lines.append(f"  [{ts}] {action}  {' '.join(extra)}")
    return '\n'.join(lines) + '\n'


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description='Multi-Agent workflow state machine')
    p.add_argument('--project-root', default='.', help='Project root (default: cwd)')
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('status'); s.add_argument('--agent', default='default'); s.add_argument('--json', action='store_true')
    s = sub.add_parser('advance'); s.add_argument('--agent', required=True)
    s = sub.add_parser('goto'); s.add_argument('--agent', required=True); s.add_argument('--stage', required=True)
    s = sub.add_parser('skip'); s.add_argument('--agent', required=True); s.add_argument('--force', action='store_true')
    s = sub.add_parser('reset'); s.add_argument('--agent', required=True); s.add_argument('--force', action='store_true')
    s = sub.add_parser('block'); s.add_argument('--agent', required=True); s.add_argument('--reason', required=True)
    s = sub.add_parser('create-agent'); s.add_argument('--id', required=True); s.add_argument('--name', default='')
    s.add_argument('--stages', default=None, help='Comma-separated stage list')
    s = sub.add_parser('delete-agent'); s.add_argument('--id', required=True); s.add_argument('--confirm', action='store_true')
    sub.add_parser('list-agents')
    s = sub.add_parser('history'); s.add_argument('--agent', default='default'); s.add_argument('--limit', type=int, default=50)
    s = sub.add_parser('import-outputs')
    s.add_argument('--agent', default='default', help='目标 agent（default: default）')
    s.add_argument('--file', default=None, help='parsed-config.json 路径（默认 <运行时目录>/parsed-config.json）')
    s = sub.add_parser('test-run')  # v0.6.0（B1）
    s.add_argument('--agent', default='default')
    s.add_argument('--stage', default=None, help='指定阶段（默认当前阶段）')
    return p


def main() -> int:
    args = _build_parser().parse_args()
    root = Path(args.project_root).resolve()
    if not root.is_dir():
        print(f"error: project root does not exist: {root}", file=sys.stderr)
        return 1

    state_dir(root).mkdir(parents=True, exist_ok=True)
    agents_dir(root).mkdir(parents=True, exist_ok=True)

    try:
        with FileLock(state_dir(root) / '.lock'):
            return _dispatch(root, args)
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


def _dispatch(root: Path, args: argparse.Namespace) -> int:
    cmd = args.cmd
    try:
        if cmd == 'status':
            r = status(root, args.agent)
            if getattr(args, 'json', False):
                print(json.dumps(r, indent=2, ensure_ascii=False))
            else:
                print(fmt_status(r))
            return 0
        elif cmd == 'test-run':
            # v0.6.0（B1）：手动跑当前阶段测试门禁（报告 test-report.json）
            agent = read_agent(root, args.agent)
            stage = args.stage or (agent or {}).get('current_stage')
            if not stage:
                print(json.dumps({'action': 'test-run', 'result': 'failed',
                                  'reason': f"agent '{args.agent}' not found or no current_stage"},
                                 ensure_ascii=False))
                return 1
            r = run_stage_tests(root, args.agent, stage)
            print(json.dumps(r, indent=2, ensure_ascii=False))
            return 0 if r['status'] in ('passed', 'skipped') else 1
        elif cmd == 'advance':
            r = advance(root, args.agent)
        elif cmd == 'goto':
            r = goto(root, args.agent, args.stage)
        elif cmd == 'skip':
            r = skip(root, args.agent, force=args.force)
        elif cmd == 'reset':
            r = reset(root, args.agent, force=args.force)
        elif cmd == 'block':
            r = block(root, args.agent, args.reason)
        elif cmd == 'import-outputs':
            r = import_outputs(root, args.agent,
                               Path(args.file).resolve() if args.file else None)
            print(json.dumps(r, indent=2, ensure_ascii=False))
            return 0 if r.get('result') == 'ok' else 2
        elif cmd == 'create-agent':
            stages = args.stages.split(',') if args.stages else None
            a = create_agent(root, args.id, args.name, stages=stages)
            print(json.dumps({
                'agent_id': a['agent_id'], 'agent_name': a['agent_name'],
                'current_stage': a['current_stage'],
                'stages': list(a['stages'].keys()),
            }, indent=2, ensure_ascii=False))
            return 0
        elif cmd == 'delete-agent':
            deleted = delete_agent(root, args.id, confirm=args.confirm)
            print(json.dumps({'deleted': deleted, 'agent_id': args.id},
                             indent=2, ensure_ascii=False))
            return 0
        elif cmd == 'list-agents':
            print(fmt_list(list_agents(root)))
            return 0
        elif cmd == 'history':
            print(fmt_history(history(root, args.agent, args.limit)))
            return 0
        else:
            print(f"error: unknown command: {cmd}", file=sys.stderr)
            return 2

        # Shared output path for stage-mutation commands
        print(json.dumps(r, indent=2, ensure_ascii=False))
        if r.get('result') in ('ok', 'workflow_complete', 'no_more_stages'):
            return 0
        return 2
    except ValueError as e:
        print(json.dumps({'error': str(e)}, ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.exit(main())
