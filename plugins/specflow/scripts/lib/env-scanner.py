#!/usr/bin/env python3
"""
env-scanner.py — Environment Scanner for specflow

Scans project + system environment, providing variable values for doc-parser
to resolve {{env.*}}, {{git.*}}, {{os.*}}, {{lang.*}}, {{project.*}} placeholders.

Per HOOKS.md §2.2.1 (session_start) and env-scanner card §1.

7 categories:
  1. OS / Shell
  2. Lang stack detection
  3. Toolchain (22+ tools)
  4. Dependencies
  5. CI config
  6. Test framework
  7. Git info

Output: <project_root>/.specflow/env-scan.json
（v0.7.0 布局；旧项目 .codex/ 自动回退，见 sfpaths.py）

CLI:
  python3 env-scanner.py <project_root> [--format=json|md|summary] [--force]

Uses only Python 3.10+ standard library.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# Toolchain: 22 tools — name -> executable
TOOLS: dict[str, str] = {
    'node': 'node', 'npm': 'npm', 'pnpm': 'pnpm', 'yarn': 'yarn',
    'python3': 'python3', 'pip': 'pip', 'uv': 'uv', 'poetry': 'poetry',
    'go': 'go', 'java': 'java', 'mvn': 'mvn', 'gradle': 'gradle',
    'git': 'git', 'docker': 'docker', 'make': 'make', 'curl': 'curl',
    'jq': 'jq', 'rustc': 'rustc', 'cargo': 'cargo', 'deno': 'deno',
    'bun': 'bun', 'terraform': 'terraform',
}

# Lang detection: (lang, marker_file, package_manager)
LANG_MARKERS: list[tuple[str, str, str | None]] = [
    ('typescript', 'package.json', None),
    ('javascript', 'package.json', None),
    ('python', 'pyproject.toml', None),
    ('python', 'requirements.txt', None),
    ('go', 'go.mod', None),
    ('rust', 'Cargo.toml', None),
    ('java', 'pom.xml', 'maven'),
    ('java', 'build.gradle', 'gradle'),
    ('java', 'build.gradle.kts', 'gradle'),
]

CI_MARKERS: dict[str, str] = {
    '.github/workflows': 'github-actions',
    '.gitlab-ci.yml': 'gitlab-ci',
    'Jenkinsfile': 'jenkins',
    '.circleci/config.yml': 'circleci',
    'azure-pipelines.yml': 'azure-pipelines',
    '.travis.yml': 'travis',
    'bitbucket-pipelines.yml': 'bitbucket-pipelines',
}

TEST_MARKERS: list[tuple[str, str]] = [
    ('jest.config.js', 'jest'), ('jest.config.ts', 'jest'),
    ('vitest.config.ts', 'vitest'),
    ('pytest.ini', 'pytest'), ('tox.ini', 'pytest'), ('conftest.py', 'pytest'),
    ('go.mod', 'go-test'), ('pom.xml', 'maven-surefire'),
    ('Cargo.toml', 'cargo-test'),
]

SCAN_IGNORE = {'.git', 'node_modules', 'dist', 'build', 'target', '.venv', '__pycache__',
               '.codex', '.specflow', '.codex-plugin'}


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec='seconds')


def run_cmd(args: list[str], cwd: Path | None = None, timeout: float = 3.0) -> str | None:
    """Run a command, return stripped stdout or None on failure."""
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=timeout,
                           cwd=cwd, shell=False, check=False)
        return r.stdout.strip() if r.returncode == 0 else None
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None


def safe_read(path: Path) -> str | None:
    try:
        return path.read_text(encoding='utf-8')
    except Exception:
        return None


def scan_os_shell() -> dict[str, Any]:
    shell = os.environ.get('SHELL') or os.environ.get('COMSPEC') or 'unknown'
    return {
        'system': platform.system() or 'unknown',
        'release': platform.release() or 'unknown',
        'machine': platform.machine() or 'unknown',
        'processor': platform.processor() or 'unknown',
        'python_version': platform.python_version(),
        'shell': {'name': Path(shell).name if shell else 'unknown', 'path': shell},
    }


def _detect_version(exe: str) -> str | None:
    out = run_cmd([exe, '--version'])
    if not out:
        return None
    first = out.splitlines()[0]
    m = re.search(r'(\d+\.\d+(?:\.\d+)?)', first)
    return m.group(1) if m else first[:80]


def scan_toolchain() -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for name, exe in TOOLS.items():
        path = shutil.which(exe)
        if not path:
            continue
        result[name] = {'path': path, 'version': _detect_version(exe) or 'unknown'}
    return result


def scan_git(project_root: Path) -> dict[str, Any]:
    info: dict[str, Any] = {
        'is_repo': (project_root / '.git').exists(),
        'branch': None, 'commit': None, 'author': None, 'email': None, 'remotes': [],
    }
    if not info['is_repo']:
        return info
    info['branch'] = run_cmd(['git', '-C', str(project_root), 'rev-parse', '--abbrev-ref', 'HEAD'], timeout=2)
    info['commit'] = run_cmd(['git', '-C', str(project_root), 'rev-parse', '--short', 'HEAD'], timeout=2)
    info['author'] = run_cmd(['git', '-C', str(project_root), 'config', 'user.name'], timeout=2)
    info['email'] = run_cmd(['git', '-C', str(project_root), 'config', 'user.email'], timeout=2)
    remotes_raw = run_cmd(['git', '-C', str(project_root), 'remote'], timeout=2)
    if remotes_raw:
        info['remotes'] = [r for r in remotes_raw.splitlines() if r]
    return info


def _lang_version(project_root: Path, lang: str, marker: str) -> str | None:
    if lang == 'python':
        return platform.python_version()
    if lang in ('typescript', 'javascript'):
        pkg = safe_read(project_root / 'package.json')
        if pkg:
            m = re.search(r'"(?:typescript|typescript-node)"\s*:\s*"(\^?~?[\d.]+)"', pkg)
            if m:
                return m.group(1)
        return None
    if lang == 'go':
        mod = safe_read(project_root / 'go.mod')
        if mod:
            m = re.search(r'^go\s+([\d.]+)', mod, re.MULTILINE)
            if m:
                return m.group(1)
        return None
    if lang == 'rust':
        toml = safe_read(project_root / 'Cargo.toml')
        if toml:
            m = re.search(r'rust-version\s*=\s*"([\d.]+)"', toml)
            if m:
                return m.group(1)
        return None
    if lang == 'java':
        return run_cmd(['java', '-version'], timeout=3)
    return None


def _detect_pkg_manager(project_root: Path) -> str | None:
    for lock, mgr in [
        ('pnpm-lock.yaml', 'pnpm'), ('yarn.lock', 'yarn'),
        ('package-lock.json', 'npm'), ('bun.lockb', 'bun'), ('bun.lock', 'bun'),
        ('uv.lock', 'uv'), ('poetry.lock', 'poetry'),
        ('Cargo.lock', 'cargo'), ('go.sum', 'go'),
    ]:
        if (project_root / lock).exists():
            return mgr
    return None


def scan_lang_stack(project_root: Path) -> dict[str, Any]:
    result: dict[str, Any] = {
        'primary': None, 'version': None,
        'package_manager': None, 'all_detected': [],
    }
    for lang, marker, pkg_mgr in LANG_MARKERS:
        if (project_root / marker).exists():
            if lang not in result['all_detected']:
                result['all_detected'].append(lang)
            if result['primary'] is None:
                result['primary'] = lang
                result['version'] = _lang_version(project_root, lang, marker)
                result['package_manager'] = pkg_mgr or _detect_pkg_manager(project_root)
    if result['primary'] is None:
        result['primary'] = 'python'
        result['version'] = platform.python_version()
    return result


def scan_dependencies(project_root: Path) -> dict[str, Any]:
    deps: dict[str, Any] = {}
    pkg = safe_read(project_root / 'package.json')
    if pkg:
        try:
            obj = json.loads(pkg)
            deps['npm'] = {
                'dependencies': list((obj.get('dependencies') or {}).keys()),
                'dev_dependencies': list((obj.get('devDependencies') or {}).keys()),
                'total': len(obj.get('dependencies') or {}) + len(obj.get('devDependencies') or {}),
            }
        except json.JSONDecodeError:
            pass
    req = safe_read(project_root / 'requirements.txt')
    if req:
        deps['python_requirements'] = [
            line.split('==')[0].split('>=')[0].split('<=')[0].strip()
            for line in req.splitlines()
            if line.strip() and not line.startswith('#')
        ]
    gomod = safe_read(project_root / 'go.mod')
    if gomod:
        deps['go'] = re.findall(r'^\s*([\w./-]+)\s+v[\d.]+', gomod, re.MULTILINE)
    cargo = safe_read(project_root / 'Cargo.toml')
    if cargo:
        deps['cargo'] = re.findall(r'^\s*([\w-]+)\s*=\s*"', cargo, re.MULTILINE)
    return deps


def scan_ci(project_root: Path) -> dict[str, Any]:
    detected = [name for rel, name in CI_MARKERS.items() if (project_root / rel).exists()]
    return {'detected': detected, 'primary': detected[0] if detected else None}


def scan_test_framework(project_root: Path) -> dict[str, Any]:
    detected: list[str] = []
    for marker, name in TEST_MARKERS:
        if (project_root / marker).exists() and name not in detected:
            detected.append(name)
    test_dirs = [d for d in ['tests', 'test', '__tests__', 'spec']
                 if (project_root / d).is_dir()]
    return {
        'detected': detected, 'test_dirs': test_dirs,
        'primary': detected[0] if detected else None,
    }


def scan_project_meta(project_root: Path) -> dict[str, Any]:
    name = project_root.name
    pkg = safe_read(project_root / 'package.json')
    if pkg:
        try:
            obj = json.loads(pkg)
            if obj.get('name'):
                name = obj['name']
        except json.JSONDecodeError:
            pass
    return {
        'name': name,
        'root': str(project_root),
        'has_readme': (project_root / 'README.md').exists(),
        'has_changelog': (project_root / 'CHANGELOG.md').exists(),
        'has_agents_md': (project_root / 'AGENTS.md').exists(),
        'has_config_md': ((project_root / '.specflow' / 'config.md').exists()
                          or (project_root / '.codex-plugin' / 'config.md').exists()),
    }


def scan_directory_structure(project_root: Path) -> dict[str, Any]:
    tree: dict[str, Any] = {}
    try:
        for entry in sorted(project_root.iterdir()):
            if entry.name in SCAN_IGNORE or entry.name.startswith('.'):
                continue
            if entry.is_dir():
                tree[entry.name] = {'type': 'dir'}
            else:
                tree[entry.name] = {'type': 'file', 'size': entry.stat().st_size}
    except (PermissionError, OSError):
        pass
    return tree


def to_variables(scan: dict[str, Any]) -> dict[str, Any]:
    """Flatten scan result into {{namespace.field}} variables."""
    os_info = scan.get('os', {})
    git_info = scan.get('git', {})
    lang_info = scan.get('lang_stack', {})
    proj_info = scan.get('project', {})
    return {
        'env': dict(os.environ),
        'os': {
            'name': os_info.get('system'),
            'arch': os_info.get('machine'),
            'shell': (os_info.get('shell') or {}).get('name'),
        },
        'git': {
            'branch': git_info.get('branch'),
            'commit': git_info.get('commit'),
            'author': git_info.get('author'),
        },
        'lang': {
            'primary': lang_info.get('primary'),
            'version': lang_info.get('version'),
            'package_manager': lang_info.get('package_manager'),
        },
        'project': {
            'name': proj_info.get('name'),
            'root': proj_info.get('root'),
            'description': None,
        },
        'user': {},
        'now': now_iso(),
        'today': datetime.now().strftime('%Y-%m-%d'),
    }


def scan_project(project_root: Path) -> dict[str, Any]:
    """Full environment scan."""
    project_root = project_root.resolve()
    result = {
        'scanned_at': now_iso(),
        'project_root': str(project_root),
        'os': scan_os_shell(),
        'lang_stack': scan_lang_stack(project_root),
        'toolchain': scan_toolchain(),
        'dependencies': scan_dependencies(project_root),
        'ci': scan_ci(project_root),
        'test_framework': scan_test_framework(project_root),
        'git': scan_git(project_root),
        'project': scan_project_meta(project_root),
        'directory_structure': scan_directory_structure(project_root),
    }
    result['variables'] = to_variables(result)
    return result


def write_output(scan: dict[str, Any], project_root: Path) -> Path:
    # v0.7.0：路径经 sfpaths 解析（新 .specflow/ / 旧 .codex/ 回退）
    try:
        import sfpaths as _sfpaths
        out_dir = _sfpaths.runtime_path(project_root, 'env-scan.json').parent
    except Exception:
        out_dir = project_root / '.specflow'
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / 'env-scan.json'
    out_path.write_text(json.dumps(scan, indent=2, ensure_ascii=False), encoding='utf-8')
    return out_path


def fmt_summary(scan: dict[str, Any]) -> str:
    os_info = scan['os']
    lang = scan['lang_stack']
    return (
        f"env: {os_info['system']}/{os_info['shell']['name']} | "
        f"lang: {lang['primary']}/{lang['version']} | "
        f"pkg: {lang.get('package_manager') or '-'} | "
        f"tools: {len(scan['toolchain'])} | "
        f"ci: {scan['ci'].get('primary') or '-'}"
    )


def fmt_md(scan: dict[str, Any]) -> str:
    lines: list[str] = [
        f"# Environment Scan: {scan['project']['name']}",
        f"",
        f"- Scanned at: `{scan['scanned_at']}`",
        f"- OS: `{scan['os']['system']} {scan['os']['release']}` ({scan['os']['machine']})",
        f"- Shell: `{scan['os']['shell']['name']}`",
        f"",
        f"## Language stack",
    ]
    ls = scan['lang_stack']
    lines.append(f"- Primary: `{ls['primary']}` ({ls.get('version') or 'unknown'})")
    lines.append(f"- Package manager: `{ls.get('package_manager') or '-'}`")
    lines.append(f"- All detected: {', '.join(ls['all_detected']) or '-'}")
    lines.append(f"")
    lines.append(f"## Toolchain ({len(scan['toolchain'])} tools)")
    for name, info in sorted(scan['toolchain'].items()):
        lines.append(f"- `{name}`: {info['version']} (`{info['path']}`)")
    lines.append(f"")
    lines.append(f"## CI")
    lines.append(f"- Detected: {', '.join(scan['ci']['detected']) or 'none'}")
    lines.append(f"")
    lines.append(f"## Test framework")
    tf = scan['test_framework']
    lines.append(f"- Detected: {', '.join(tf['detected']) or 'none'}")
    lines.append(f"- Test dirs: {', '.join(tf['test_dirs']) or 'none'}")
    lines.append(f"")
    lines.append(f"## Git")
    g = scan['git']
    if g.get('is_repo'):
        lines.append(f"- Branch: `{g.get('branch')}`")
        lines.append(f"- Commit: `{g.get('commit')}`")
        lines.append(f"- Author: `{g.get('author')}`")
    else:
        lines.append(f"- Not a git repo")
    return '\n'.join(lines) + '\n'


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Environment scanner — produces .specflow/env-scan.json',
    )
    parser.add_argument('project_root', nargs='?', default='.',
                        help='Project root (default: current directory)')
    parser.add_argument('--format', choices=['json', 'md', 'summary'],
                        default='json', help='Output format')
    parser.add_argument('--force', action='store_true',
                        help='Force re-scan (always re-scans; kept for CLI compat)')
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    if not project_root.is_dir():
        print(f"error: project root does not exist: {project_root}", file=sys.stderr)
        return 1

    try:
        scan = scan_project(project_root)
        out_path = write_output(scan, project_root)
        try:
            scan['_output'] = str(out_path.relative_to(project_root))
        except ValueError:
            scan['_output'] = str(out_path)
    except Exception as exc:
        print(f"error: scan failed: {exc}", file=sys.stderr)
        return 2

    if args.format == 'json':
        print(json.dumps(scan, indent=2, ensure_ascii=False))
    elif args.format == 'md':
        print(fmt_md(scan))
    else:
        print(fmt_summary(scan))
    return 0


if __name__ == '__main__':
    sys.exit(main())
