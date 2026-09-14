#!/usr/bin/env python3
"""
doc-version.py — 文档版本管理（v0.6.0 / A8，COMMANDS §13.3）

落地 COMMANDS §13.3 的「命令完成后 bump 产出文档版本」：frontmatter `version`
按 SemVer 递增，`last_modified` 刷新为当前时间；同目录同名 `.version` 侧车文件
（docs/requirements/REQUIREMENTS.version 形态）同步更新（存在时）。

无 frontmatter 的文档 → `init` 子命令补一个最小合规 frontmatter
（title 取首个 # 标题；type 按 PARSER §6.2 推断目录语义默认 guide）。

集成：workflow-state advance 阶段完成（stage_exit）时自动对该阶段声明的
outputs 文档做 minor bump 并发 doc_version_bumped 事件（ADR-006）。

CLI：
  python3 doc-version.py show <file>                    # 查询版本
  python3 doc-version.py bump <file> [--major|--minor|--patch]  # bump（默认 patch）
  python3 doc-version.py init <file> [--version 0.1.0]  # 补最小 frontmatter
  python3 doc-version.py check <file>                   # 校验 SemVer + 版本型必填
  python3 doc-version.py bump-outputs <project_root> --agent <id> --stage <stage>
                                                        # advance 集成入口

退出码：0 成功 / 1 文件不存在 / 2 格式错误 / 3 无可 bump 的版本字段
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import events as _events
except Exception:
    _events = None

RE_SEMVER = re.compile(r'^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.\-]+)?$')
RE_FM_DELIM = re.compile(r'^---\s*$')
RE_FM_VERSION = re.compile(r'^(\s*)version:\s*(.+?)\s*$')
RE_FM_LASTMOD = re.compile(r'^(\s*)last_modified:\s*(.+?)\s*$')
RE_HEADING1 = re.compile(r'^#\s+(.+)$')

# 目录 → frontmatter type 推断（PARSER §6.2 / §6.3 路径语义）
DIR_TYPE_MAP = [
    ('docs/requirements/', 'requirement'),
    ('docs/decisions/', 'adr'),
    ('docs/changes/', 'changelog'),
    ('docs/component/', 'card'),
    ('docs/', 'guide'),
]


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def bump_semver(version: str, level: str) -> str:
    m = RE_SEMVER.match(version.strip())
    if not m:
        raise ValueError(f"invalid SemVer: {version!r}")
    major, minor, patch = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if level == 'major':
        major, minor, patch = major + 1, 0, 0
    elif level == 'minor':
        minor, patch = minor + 1, 0
    else:
        patch += 1
    return f"{major}.{minor}.{patch}"


def split_frontmatter(text: str) -> tuple[bool, list[str], list[str]]:
    """返回 (has_fm, fm_lines, body_lines)。"""
    lines = text.splitlines(keepends=True)
    if not lines or not RE_FM_DELIM.match(lines[0].rstrip('\n')):
        return False, [], lines
    for i in range(1, len(lines)):
        if RE_FM_DELIM.match(lines[i].rstrip('\n')):
            return True, lines[1:i], lines[i + 1:]
    return False, [], lines  # 未闭合 → 视作无 frontmatter


def read_version(path: Path) -> str | None:
    text = path.read_text(encoding='utf-8')
    has_fm, fm_lines, _ = split_frontmatter(text)
    if not has_fm:
        return None
    for ln in fm_lines:
        m = RE_FM_VERSION.match(ln.rstrip('\n'))
        if m:
            return m.group(2).strip()
    return None


def write_bump(path: Path, level: str) -> dict[str, Any]:
    """原地 bump：frontmatter version + last_modified；同步 .version 侧车文件。"""
    text = path.read_text(encoding='utf-8')
    has_fm, fm_lines, body_lines = split_frontmatter(text)
    if not has_fm:
        return {'file': str(path), 'error': 'no frontmatter (use init first)',
                'exit': 3}

    old_version: str | None = None
    new_fm: list[str] = []
    version_bumped = False
    lastmod_written = False
    for ln in fm_lines:
        stripped = ln.rstrip('\n')
        m = RE_FM_VERSION.match(stripped)
        if m and not version_bumped:
            old_version = m.group(2).strip()
            new_version = bump_semver(old_version, level)
            new_fm.append(f"{m.group(1)}version: {new_version}\n")
            version_bumped = True
            continue
        m = RE_FM_LASTMOD.match(stripped)
        if m and not lastmod_written:
            new_fm.append(f"{m.group(1)}last_modified: {now_iso()}\n")
            lastmod_written = True
            continue
        new_fm.append(ln)
    if not version_bumped:
        # 无 version 行 → 追加（保持「版本型必填」可用）
        old_version = None
        new_version = bump_semver('0.0.0', level) if level != 'patch' else '0.0.1'
        new_fm.append(f"version: {new_version}\n")
    if not lastmod_written:
        new_fm.append(f"last_modified: {now_iso()}\n")

    path.write_text('---\n' + ''.join(new_fm) + '---\n' + ''.join(body_lines),
                    encoding='utf-8')

    # 同步 .version 侧车文件（存在时）
    sidecar = path.with_suffix('.version')
    sidecar_updated = False
    if sidecar.is_file():
        sidecar.write_text(new_version + '\n', encoding='utf-8')
        sidecar_updated = True

    return {
        'file': str(path), 'level': level,
        'old_version': old_version, 'new_version': new_version,
        'last_modified_refreshed': True, 'sidecar_updated': sidecar_updated,
    }


def init_frontmatter(path: Path, version: str) -> dict[str, Any]:
    """为无 frontmatter 的文档补最小合规 frontmatter。"""
    text = path.read_text(encoding='utf-8')
    has_fm, _, _ = split_frontmatter(text)
    if has_fm:
        return {'file': str(path), 'error': 'frontmatter already exists', 'exit': 2}
    title = path.stem
    for ln in text.splitlines():
        m = RE_HEADING1.match(ln)
        if m:
            title = m.group(1).strip()
            break
    doc_type = 'guide'
    posix = path.as_posix()
    for prefix, t in DIR_TYPE_MAP:
        if posix.startswith(prefix):
            doc_type = t
            break
    fm = (
        '---\n'
        f'title: {title}\n'
        f'type: {doc_type}\n'
        f'version: {version}\n'
        f'last_modified: {now_iso()}\n'
        'author: specflow\n'
        'status: active\n'
        '---\n'
    )
    path.write_text(fm + text, encoding='utf-8')
    return {'file': str(path), 'initialized': True, 'version': version,
            'type': doc_type, 'title': title}


def infer_doc_type(path: Path) -> str:
    posix = path.as_posix()
    for prefix, t in DIR_TYPE_MAP:
        if posix.startswith(prefix):
            return t
    return 'guide'


VERSIONED_TYPES = {'requirement', 'design', 'adr', 'changelog', 'card'}


def check_file(path: Path) -> dict[str, Any]:
    text = path.read_text(encoding='utf-8')
    has_fm, fm_lines, _ = split_frontmatter(text)
    issues: list[str] = []
    version = None
    if not has_fm:
        issues.append('no frontmatter')
    else:
        for ln in fm_lines:
            s = ln.rstrip('\n')
            m = RE_FM_VERSION.match(s)
            if m:
                version = m.group(2).strip()
        if version is None:
            issues.append('missing version field')
        elif not RE_SEMVER.match(version):
            issues.append(f'invalid SemVer: {version}')
        if infer_doc_type(path) in VERSIONED_TYPES:
            if not any(RE_FM_LASTMOD.match(l.rstrip('\n')) for l in fm_lines):
                issues.append('missing last_modified (versioned doc)')
    return {'file': str(path), 'version': version,
            'valid': not issues, 'issues': issues}


# ─────────────────────────────────────────────
# advance 集成：bump 阶段产出文档
# ─────────────────────────────────────────────

def bump_stage_outputs(root: Path, agent_id: str, stage: str,
                       level: str = 'minor') -> dict[str, Any]:
    """读 agent 状态中该阶段声明的 outputs，对存在的 .md 逐一 bump。

    由 workflow-state.advance 在 stage_exit 时调用（也可手动执行）。
    bump 结果发 doc_version_bumped 事件；单文件失败不阻塞（记 errors）。
    """
    agent_path = root / '.specflow' / 'workflow-state' / 'agents' / f'{agent_id}.json'
    # v0.7.0：旧项目回退 .codex/（路径层 sfpaths）
    if not agent_path.is_file():
        try:
            import sfpaths as _sfpaths
            agent_path = _sfpaths.runtime_path(
                root, f'workflow-state/agents/{agent_id}.json')
        except Exception:
            pass
    if not agent_path.is_file():
        return {'error': f'agent state not found: {agent_path}', 'bumped': []}
    try:
        agent = json.loads(agent_path.read_text(encoding='utf-8'))
    except Exception as exc:
        return {'error': f'agent state unreadable: {exc}', 'bumped': []}
    outputs = (agent.get('stages', {}).get(stage, {}) or {}).get('outputs') or []
    bumped: list[str] = []
    errors: list[str] = []
    for rel in outputs:
        p = root / str(rel)
        if not p.is_file():
            continue
        if p.suffix.lower() != '.md':
            continue  # 只 bump Markdown 文档（配置/数据文件不动）
        try:
            r = write_bump(p, level)
            if r.get('new_version'):
                bumped.append(f"{rel} → {r['new_version']}")
            elif r.get('error'):
                errors.append(f"{rel}: {r['error']}")
        except Exception as exc:
            errors.append(f"{rel}: {exc}")
    result = {'agent': agent_id, 'stage': stage, 'level': level,
              'bumped': bumped, 'errors': errors}
    if _events is not None and bumped:
        _events.append_event(root, 'doc_version_bumped', {
            'bump': level, 'files': bumped, 'agent': agent_id, 'stage': stage,
        })
    return result


def main() -> int:
    ap = argparse.ArgumentParser(
        description='doc-version — specflow 文档版本管理（COMMANDS §13.3）')
    sub = ap.add_subparsers(dest='cmd', required=True)

    p_show = sub.add_parser('show', help='查询文档版本')
    p_show.add_argument('file')

    p_bump = sub.add_parser('bump', help='递增版本（默认 patch）')
    p_bump.add_argument('file')
    p_bump.add_argument('--major', action='store_true')
    p_bump.add_argument('--minor', action='store_true')
    p_bump.add_argument('--patch', action='store_true')

    p_init = sub.add_parser('init', help='补最小 frontmatter')
    p_init.add_argument('file')
    p_init.add_argument('--version', default='0.1.0')

    p_check = sub.add_parser('check', help='校验版本格式')
    p_check.add_argument('file')

    p_out = sub.add_parser('bump-outputs', help='bump 某阶段声明的 outputs（advance 集成）')
    p_out.add_argument('project_root')
    p_out.add_argument('--agent', required=True)
    p_out.add_argument('--stage', required=True)
    p_out.add_argument('--level', choices=['major', 'minor', 'patch'], default='minor')

    args = ap.parse_args()

    if args.cmd == 'show':
        path = Path(args.file)
        if not path.is_file():
            print(f"error: file not found: {path}", file=sys.stderr)
            return 1
        v = read_version(path)
        print(v if v else '(no version field)')
        return 0 if v else 3

    if args.cmd == 'bump':
        path = Path(args.file)
        if not path.is_file():
            print(f"error: file not found: {path}", file=sys.stderr)
            return 1
        level = ('major' if args.major else 'minor') if (args.major or args.minor) else 'patch'
        try:
            r = write_bump(path, level)
        except ValueError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2
        if r.get('error'):
            print(f"error: {r['error']}", file=sys.stderr)
            return int(r.get('exit', 2))
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0

    if args.cmd == 'init':
        path = Path(args.file)
        if not path.is_file():
            print(f"error: file not found: {path}", file=sys.stderr)
            return 1
        r = init_frontmatter(path, args.version)
        if r.get('error'):
            print(f"error: {r['error']}", file=sys.stderr)
            return 2
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0

    if args.cmd == 'check':
        path = Path(args.file)
        if not path.is_file():
            print(f"error: file not found: {path}", file=sys.stderr)
            return 1
        r = check_file(path)
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0 if r['valid'] else 2

    if args.cmd == 'bump-outputs':
        root = Path(args.project_root).resolve()
        r = bump_stage_outputs(root, args.agent, args.stage, args.level)
        print(json.dumps(r, indent=2, ensure_ascii=False))
        return 0 if not r.get('error') else 2

    return 1


if __name__ == '__main__':
    sys.exit(main())
