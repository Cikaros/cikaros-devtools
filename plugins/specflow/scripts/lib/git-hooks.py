#!/usr/bin/env python3
"""
git-hooks.py — specflow git hooks 真跑（v0.6.0 / A7，HOOKS §2.3）

v0.4.0 前的 git hooks 是提示性桩（pre-commit 只跑 todo 摘要即放行）；v0.6.0 实装：

pre-commit（阻塞项 = 高敏隐私命中 / 配置的测试命令失败；其余为警告）：
  1. sanitize —— 对暂存文件跑脱敏检测（规则单源 rules/sensitive-rules.json），
     high 级命中（密钥/证件/银行卡）→ 拒绝提交（防止密钥进 git 历史）
  2. todo    —— 暂存文件中 created 状态标记：默认警告；STRICT=1 时拒绝
  3. lint    —— 检测项目 lint 命令（package.json scripts.lint / ruff /
     golangci-lint）：跑失败默认仅警告（不阻塞提交）
  4. test    —— test-executor.json（路径经 sfpaths）的 command 且 run_on_commit=true
     时真跑测试（超时保护）：失败 → 拒绝提交（B1 测试门禁的 commit 侧入口）
  结果写 events.jsonl（git_pre_commit 事件）与 precommit-report.json
  （v0.7.0：均位于 .specflow/，旧项目 .codex/ 自动回退）

post-checkout / post-merge（非阻塞）：
  - 对比 HEAD@{1}..HEAD 的依赖文件变更（package.json / lock 文件 /
    pyproject.toml / requirements / go.mod / Cargo.toml / pom.xml 等）
    → 提示「依赖变更，建议重装/重启会话」
  - 重扫 todo（刷新 todo-state.json，配合 mtime 缓存开销极小）

环境开关（均可被 test-executor.json / 环境变量覆盖）：
  SPECFLOW_PRECOMMIT_SANITIZE=0 跳过脱敏检测
  SPECFLOW_PRECOMMIT_LINT=0     跳过 lint
  SPECFLOW_PRECOMMIT_TEST=0     跳过测试
  SPECFLOW_PRECOMMIT_STRICT=1   created 标记也拒绝提交

CLI：
  python3 git-hooks.py <project_root> pre-commit|post-checkout|post-merge

退出码：0 = 放行 / 1 = 拒绝（pre-commit 阻塞项命中）/ 2 = 内部错误（放行，
绝不因插件自身故障阻塞 git 操作——与 install-git-hooks.sh 的防丢失守卫同策略）
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from importlib import util as _imp_util
from pathlib import Path
from typing import Any

_LIB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_LIB_DIR))
try:
    import events as _events
except Exception:
    _events = None

# v0.7.0：路径层 sfpaths（.specflow 新旧兼容，用户反馈第 1 项）
try:
    import sfpaths as _sfpaths
except Exception:
    _sfpaths = None


def _rt_path(root: Path, name: str) -> Path:
    return _sfpaths.runtime_path(root, name) if _sfpaths else root / '.specflow' / name


def _load_lib_module(stem: str):
    """按文件加载带连字符的库模块（todo-scanner.py 等无法用 import 语句）。"""
    path = _LIB_DIR / f'{stem}.py'
    if not path.is_file():
        return None
    spec = _imp_util.spec_from_file_location(stem.replace('-', '_'), path)
    mod = _imp_util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

TEST_EXECUTOR_NAME = 'test-executor.json'  # v0.7.0：相对运行时目录（sfpaths 解析）

DEP_FILES = (
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'bun.lockb', 'requirements.txt', 'requirements-dev.txt',
    'pyproject.toml', 'uv.lock', 'poetry.lock', 'Pipfile', 'Pipfile.lock',
    'go.mod', 'go.sum', 'Cargo.toml', 'Cargo.lock',
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json',
)

LINT_TIMEOUT_S = 120
TEST_TIMEOUT_DEFAULT_S = 300
MAX_SCAN_BYTES = 512 * 1024  # 单文件脱敏检测上限（跳过超大文件）

TEXT_EXTS = {
    '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.yaml',
    '.yml', '.toml', '.md', '.txt', '.sh', '.bash', '.rb', '.go', '.rs',
    '.java', '.kt', '.swift', '.c', '.h', '.cpp', '.hpp', '.sql', '.env',
    '.cfg', '.ini', '.conf', '.xml', '.html', '.css', '.scss', '.vue',
}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def _env_flag(name: str, default: bool = True) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() not in ('0', 'false', 'no', 'off')


def _git(root: Path, *args: str) -> tuple[int, str]:
    try:
        p = subprocess.run(['git', *args], cwd=root, capture_output=True,
                           text=True, timeout=30)
        return p.returncode, (p.stdout or '') + (p.stderr or '')
    except Exception:
        return 1, ''


def _emit(root: Path, etype: str, payload: dict[str, Any]) -> None:
    if _events is not None:
        try:
            _events.append_event(root, etype, payload)
        except Exception:
            pass


# ─────────────────────────────────────────────
# pre-commit 子步骤
# ─────────────────────────────────────────────

def staged_files(root: Path) -> list[str]:
    rc, out = _git(root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR')
    if rc != 0:
        return []
    return [f for f in out.splitlines() if f.strip()]


def run_sanitize_check(root: Path, files: list[str]) -> dict[str, Any]:
    """对暂存文件跑脱敏检测（high 级命中 → blocked）。"""
    _sanitize = _load_lib_module('sanitize')
    if _sanitize is None:
        return {'step': 'sanitize', 'status': 'skipped',
                'detail': 'sanitize.py 缺失'}

    hits: list[dict[str, Any]] = []
    for rel in files:
        path = root / rel
        if not path.is_file() or path.suffix.lower() not in TEXT_EXTS:
            continue
        try:
            content = path.read_text(encoding='utf-8', errors='ignore')[:MAX_SCAN_BYTES]
        except Exception:
            continue
        try:
            _, summary = _sanitize.sanitize_text(content, severity_filter='high')
        except RuntimeError:
            raise  # 规则单源缺失 fail-loud
        if summary.get('high_matches'):
            for m in summary['matches']:
                hits.append({'file': rel, 'rule': m['rule'], 'line_hint': m['start']})
    return {
        'step': 'sanitize',
        'status': 'blocked' if hits else 'passed',
        'high_hits': hits,
    }


def run_todo_check(root: Path, files: list[str]) -> dict[str, Any]:
    """暂存文件中 created 状态标记检查（默认警告 / STRICT 拒绝）。"""
    _todo = _load_lib_module('todo-scanner')
    if _todo is None:
        return {'step': 'todo', 'status': 'skipped', 'detail': 'todo-scanner.py 缺失'}

    strict = os.environ.get('SPECFLOW_PRECOMMIT_STRICT', '').strip() in ('1', 'true', 'yes')
    created: list[dict[str, Any]] = []
    for rel in files:
        path = root / rel
        if not path.is_file():
            continue
        try:
            markers = _todo.scan_file(path)
        except Exception:
            continue
        for m in markers:
            created.append({'file': rel, 'marker': m['id'], 'line': m.get('line')})
    return {
        'step': 'todo',
        'status': ('blocked' if strict else 'warn') if created else 'passed',
        'created_in_staged': created,
        'strict': strict,
    }


def _detect_lint_command(root: Path) -> tuple[str, str] | None:
    """按锁文件/配置探测 lint 命令。返回 (command, manager) 或 None。"""
    pkg = root / 'package.json'
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text(encoding='utf-8')).get('scripts', {})
        except Exception:
            scripts = {}
        runner = 'npm'
        if (root / 'pnpm-lock.yaml').is_file():
            runner = 'pnpm'
        elif (root / 'yarn.lock').is_file():
            runner = 'yarn'
        if 'lint' in scripts:
            return f'{runner} run lint', runner
    pyproject = root / 'pyproject.toml'
    ruff_cfg = root / 'ruff.toml'
    if ruff_cfg.is_file() or pyproject.is_file():
        py = pyproject.read_text(encoding='utf-8', errors='ignore') if pyproject.is_file() else ''
        if ruff_cfg.is_file() or '[tool.ruff' in py:
            return 'ruff check .', 'ruff'
    if (root / '.golangci.yml').is_file() or (root / '.golangci.yaml').is_file():
        return 'golangci-lint run', 'golangci'
    return None


def run_lint(root: Path) -> dict[str, Any]:
    """lint 非阻塞：无命令 → skipped；跑失败 → warn（不拒绝提交）。

    v0.7.2 跨平台注记：`shell=True` 在 Windows 上走 cmd.exe（即 %COMSPEC%）；
    cmd.exe 支持 `&&` / `||` / `&` 但不支持 bash 风格的 `$()` / `${VAR}` / `;`。
    用户在 `.specflow/test-executor.json` 里配置 command 时，Windows 上应使用
    cmd.exe 兼容语法（如 `npm test && npm run lint`），或直接给单条命令。
    """
    detected = _detect_lint_command(root)
    if detected is None:
        return {'step': 'lint', 'status': 'skipped', 'detail': '未检测到 lint 配置'}
    command, manager = detected
    try:
        p = subprocess.run(command, shell=True, cwd=root, capture_output=True,
                           text=True, timeout=LINT_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return {'step': 'lint', 'status': 'warn', 'command': command,
                'detail': f'超时（>{LINT_TIMEOUT_S}s），跳过'}
    except Exception as exc:
        return {'step': 'lint', 'status': 'warn', 'command': command,
                'detail': f'执行失败: {exc}'}
    out_tail = ((p.stdout or '') + (p.stderr or ''))[-800:].strip()
    return {
        'step': 'lint',
        'status': 'passed' if p.returncode == 0 else 'warn',
        'command': command,
        'exit_code': p.returncode,
        'detail': out_tail or None,
    }


def _load_test_config(root: Path) -> dict[str, Any]:
    path = _rt_path(root, TEST_EXECUTOR_NAME)
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def run_tests(root: Path) -> dict[str, Any]:
    """commit 侧测试门禁：配置了 command 且 run_on_commit=true 才跑；失败 → blocked。

    v0.7.2 跨平台注记：与 run_lint 同样的 shell=True 语义；Windows 上走 cmd.exe，
    command 字符串需 cmd.exe 兼容（避免 bash-isms 如 `$()` / `${VAR}` / `;`）。
    """
    cfg = _load_test_config(root)
    command = cfg.get('command')
    if not command or not cfg.get('run_on_commit'):
        return {'step': 'test', 'status': 'skipped',
                'detail': '未配置 test-executor.json 或 run_on_commit != true'}
    timeout = int(cfg.get('timeout_seconds') or TEST_TIMEOUT_DEFAULT_S)
    t0 = datetime.now()
    try:
        p = subprocess.run(command, shell=True, cwd=root, capture_output=True,
                           text=True, timeout=timeout)
        rc, out = p.returncode, ((p.stdout or '') + (p.stderr or ''))
    except subprocess.TimeoutExpired:
        _emit(root, 'test_run', {'command': command, 'exit_code': 'timeout',
                                 'duration_ms': (datetime.now() - t0).total_seconds() * 1000,
                                 'via': 'pre-commit'})
        return {'step': 'test', 'status': 'blocked', 'command': command,
                'detail': f'超时（>{timeout}s）'}
    except Exception as exc:
        return {'step': 'test', 'status': 'warn', 'command': command,
                'detail': f'执行失败: {exc}'}
    duration_ms = (datetime.now() - t0).total_seconds() * 1000
    _emit(root, 'test_run', {
        'command': command, 'exit_code': rc,
        'duration_ms': duration_ms, 'via': 'pre-commit',
    })
    return {
        'step': 'test',
        'status': 'passed' if rc == 0 else 'blocked',
        'command': command,
        'exit_code': rc,
        'detail': out[-800:].strip() or None,
    }


# ─────────────────────────────────────────────
# post-checkout / post-merge
# ─────────────────────────────────────────────

def run_dep_change_check(root: Path, hook: str) -> dict[str, Any]:
    """对比 HEAD@{1}..HEAD 依赖文件变更（首次 checkout 无上版本 → skipped）。"""
    rc, out = _git(root, 'diff', '--name-only', 'HEAD@{1}', 'HEAD')
    if rc != 0:
        return {'hook': hook, 'status': 'skipped', 'detail': '无上一提交可比（首次检出/浅克隆）'}
    changed = {line.strip() for line in out.splitlines() if line.strip()}
    dep_changed = sorted(c for c in changed if Path(c).name in DEP_FILES)
    result = {
        'hook': hook,
        'status': 'hint' if dep_changed else 'passed',
        'changed_files': len(changed),
        'dep_changes': dep_changed,
    }
    if dep_changed:
        print('[specflow] 依赖文件变更：')
        for d in dep_changed:
            print(f"  - {d}")
        print('[specflow] 建议：重装依赖并重启 codex 会话（依赖决定语言栈/规则加载）')
    # 顺带刷新 todo 状态（mtime 缓存命中时开销极小）
    try:
        _todo = _load_lib_module('todo-scanner')
        if _todo is not None:
            _todo.scan_project_state(root)
    except Exception:
        pass
    return result


# ─────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────

def pre_commit(root: Path) -> int:
    report: dict[str, Any] = {'hook': 'pre-commit', 'ran_at': now_iso(), 'steps': []}
    files = staged_files(root)
    report['staged_files'] = len(files)
    blocked = False

    if _env_flag('SPECFLOW_PRECOMMIT_SANITIZE', True) and files:
        step = run_sanitize_check(root, files)
        report['steps'].append(step)
        if step['status'] == 'blocked':
            blocked = True
            print('[specflow] ✗ 拒绝提交：暂存文件含高敏信息（密钥/证件/银行卡）:')
            for h in step['high_hits']:
                print(f"  - {h['file']}  rule={h['rule']}")
            print('[specflow] 处理：移除密钥 → 或改用环境变量/密钥管理；确认误报可设 '
                  'SPECFLOW_PRECOMMIT_SANITIZE=0 跳过本次检测')
    else:
        report['steps'].append({'step': 'sanitize', 'status': 'skipped',
                                'detail': 'SPECFLOW_PRECOMMIT_SANITIZE=0 或无暂存文件'})

    if _env_flag('SPECFLOW_PRECOMMIT_LINT', True):
        step = run_lint(root)
        report['steps'].append(step)
        if step['status'] == 'warn':
            print(f"[specflow] ⚠ lint 未通过（非阻塞）: {step.get('command')}")
            if step.get('detail'):
                print(f"  {step['detail'][:300]}")
    else:
        report['steps'].append({'step': 'lint', 'status': 'skipped',
                                'detail': 'SPECFLOW_PRECOMMIT_LINT=0'})

    if _env_flag('SPECFLOW_PRECOMMIT_TEST', True):
        step = run_tests(root)
        report['steps'].append(step)
        if step['status'] == 'blocked':
            blocked = True
            print(f"[specflow] ✗ 拒绝提交：测试未通过（{step.get('command')}）")
            if step.get('detail'):
                print(f"  {step['detail'][:500]}")
        elif step['status'] == 'warn':
            print(f"[specflow] ⚠ 测试无法执行（非阻塞）: {step.get('detail', '')}")
    else:
        report['steps'].append({'step': 'test', 'status': 'skipped',
                                'detail': 'SPECFLOW_PRECOMMIT_TEST=0'})

    if _env_flag('SPECFLOW_PRECOMMIT_TODO', True) and files:
        step = run_todo_check(root, files)
        report['steps'].append(step)
        if step['status'] == 'blocked':
            blocked = True
            print('[specflow] ✗ 拒绝提交（STRICT 模式）：暂存文件含未完成标记:')
            for c in step['created_in_staged']:
                print(f"  - {c['file']}:{c['line']}  {c['marker']}")
        elif step['status'] == 'warn':
            print(f"[specflow] ⚠ 暂存文件含 {len(step['created_in_staged'])} 个未完成标记"
                  '（非阻塞；STRICT=1 时拒绝）')
    else:
        report['steps'].append({'step': 'todo', 'status': 'skipped',
                                'detail': 'SPECFLOW_PRECOMMIT_TODO=0 或无暂存文件'})

    report['result'] = 'fail' if blocked else 'pass'
    steps_detail = ', '.join(
        '{}:{}'.format(s['step'], s['status']) for s in report['steps'])
    try:
        rp = _rt_path(root, 'precommit-report.json')
        rp.parent.mkdir(parents=True, exist_ok=True)
        rp.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    except Exception:
        pass
    _emit(root, 'git_pre_commit', {
        'result': report['result'],
        'detail': '{} staged, {}'.format(len(files), steps_detail),
    })
    return 1 if blocked else 0


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    root = Path(sys.argv[1]).resolve()
    hook = sys.argv[2]
    if not root.is_dir():
        print(f"error: project root not found: {root}", file=sys.stderr)
        return 2

    try:
        if hook == 'pre-commit':
            return pre_commit(root)
        if hook in ('post-checkout', 'post-merge'):
            result = run_dep_change_check(root, hook)
            _emit(root, f'git_{hook}', {
                'result': result.get('status', 'unknown'),
                'detail': f"dep_changes={len(result.get('dep_changes', []))}",
            })
            print(f"[specflow] {hook} 完成（{result['status']}）")
            return 0
        print(f"error: unknown hook: {hook} (pre-commit|post-checkout|post-merge)",
              file=sys.stderr)
        return 2
    except RuntimeError as err:
        # 规则单源缺失等显式 fail-loud → 打印但不阻塞 git（防丢失守卫同策略）
        print(f"[specflow] ⚠ {err}", file=sys.stderr)
        return 0
    except Exception as exc:
        print(f"[specflow] ⚠ git hook 内部错误（放行，不阻塞 git）: {exc}",
              file=sys.stderr)
        return 0


if __name__ == '__main__':
    sys.exit(main())
