#!/usr/bin/env python3
"""
sanitize.py — Privacy Sanitizer for specflow

Per privacy-guard design card §1 and HOOKS.md §2.2.5.

v0.6.0（B6）：规则跨语言单源 —— 本文件与 mcp/lib/sensitive-rules.js 均在运行时
加载 rules/sensitive-rules.json（12 条，high/low 分级，CARD 过 Luhn 校验）。
regex 取 JS/Python 公共子集；分组替换 {1}/{2} 占位符在此转换为捕获组函数。
覆盖：PEM 私钥 / OpenAI+Anthropic key / AWS AKID / GitHub token / Slack token /
JWT / 身份证 / 银行卡（Luhn）/ 手机 / 内网 IPv4 / 内网 URL / 邮箱（局部打码）。

CLI:
  python3 sanitize.py <file>                 # prints redacted content to stdout
  python3 sanitize.py <file> --summary       # prints match summary only
  python3 sanitize.py <file> --audit         # also writes privacy-audit.json（<运行时目录>）
  python3 sanitize.py <file> --severity high # 只跑高危规则（密钥/证件/银行卡）

Uses only Python 3.10+ standard library. Never crashes — always returns something.
规则源缺失时 fail-loud（空规则静默放行比报错更危险；sf.sh doctor 可检测）。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

# 规则单源：插件根/rules/sensitive-rules.json（scripts/lib 上溯 2 级即插件根；
# classic 安装树同构：~/.codex/scripts/lib → ~/.codex/rules）
RULES_SOURCE = Path(__file__).resolve().parents[2] / 'rules' / 'sensitive-rules.json'

Rule = dict[str, Any]  # {id, name, severity, repl, luhn, pattern}


def load_rules() -> list[Rule]:
    """从 JSON 单源加载并编译规则（与 mcp/lib/sensitive-rules.js 同一文件）。"""
    try:
        data = json.loads(RULES_SOURCE.read_text(encoding='utf-8'))
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"[specflow] sanitize.py 无法读取规则单源 {RULES_SOURCE}：{exc}。"
            "安装可能损坏（rules/sensitive-rules.json 属必备载荷），请重装或运行 sf.sh doctor。"
        ) from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"[specflow] sensitive-rules.json 不是合法 JSON：{exc}（修复后重试）"
        ) from exc
    rules: list[Rule] = []
    for r in data.get('rules', []):
        if not r.get('id') or not r.get('regex'):
            raise RuntimeError(
                f"[specflow] sensitive-rules.json 存在缺 id/regex 的规则项：{r}")
        rules.append({
            'id': r['id'],
            'name': r.get('name') or r['id'],
            'severity': 'low' if r.get('severity') == 'low' else 'high',
            'repl': r.get('repl') if isinstance(r.get('repl'), str) else '<REDACTED>',
            'luhn': r.get('luhn') is True,
            'pattern': re.compile(r['regex']),
        })
    return rules


try:
    RULES: list[Rule] = load_rules()
except RuntimeError as _rule_err:
    # 模块导入阶段不炸（hook/CLI 有各自的失败处理），首次使用时再报
    RULES = []
    _RULES_ERROR: str | None = str(_rule_err)
else:
    _RULES_ERROR = None


def luhn_ok(digits: str) -> bool:
    """Luhn 校验（银行卡 / 信用卡校验位算法）——与 JS 侧 luhnOk 同构。"""
    total = 0
    alt = False
    for ch in reversed(digits):
        n = int(ch)
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return total % 10 == 0


_RE_GROUP = re.compile(r'\{(\d+)\}')


def _expand_repl(repl: str, m: re.Match[str]) -> str:
    """分组占位 {N} → 捕获组内容（与 JS 侧 expandRepl 同构）。"""
    return _RE_GROUP.sub(lambda g: m.group(int(g.group(1))) or '', repl)


# ─────────────────────────────────────────────
# Sanitizer
# ─────────────────────────────────────────────

def sanitize_text(text: str,
                  severity_filter: str | None = None) -> tuple[str, dict[str, Any]]:
    """Apply redaction rules to text（规则单源 rules/sensitive-rules.json）。

    Returns (sanitized_text, summary)。severity_filter（'high'/'low'）只跑对应
    分级（与 JS 侧 redactText 的 severityFilter 同构）。CARD 规则候选串先过
    Luhn 才打码；EMAIL 等分组替换按 {N} 占位展开。
    """
    if _RULES_ERROR:
        raise RuntimeError(_RULES_ERROR)

    sanitized = text
    matches: list[dict[str, Any]] = []
    per_rule: dict[str, int] = {}

    rules = [r for r in RULES
             if severity_filter is None or r['severity'] == severity_filter]

    for rule in rules:
        pattern: re.Pattern[str] = rule['pattern']
        new_matches: list[dict[str, Any]] = []
        for m in pattern.finditer(sanitized):
            original = m.group(0)
            if rule['luhn']:
                digits = re.sub(r'[^0-9]', '', original)
                if not (13 <= len(digits) <= 16 and luhn_ok(digits)):
                    continue  # 不是合法银行卡号：不打码、不计数
            new_matches.append({
                'rule': rule['id'],
                'name': rule['name'],
                'severity': rule['severity'],
                'hash': hashlib.sha256(original.encode('utf-8')).hexdigest()[:16],
                'start': m.start(),
                'length': len(original),
            })

        if new_matches:
            def _repl(m: re.Match[str], _rule: dict[str, Any] = rule) -> str:
                if _rule['luhn']:
                    digits = re.sub(r'[^0-9]', '', m.group(0))
                    if not (13 <= len(digits) <= 16 and luhn_ok(digits)):
                        return m.group(0)
                return _expand_repl(_rule['repl'], m)

            sanitized = pattern.sub(_repl, sanitized)
            per_rule[rule['id']] = len(new_matches)
            matches.extend(new_matches)

    summary: dict[str, Any] = {
        'total_matches': sum(per_rule.values()),
        'per_rule': per_rule,
        'rules_evaluated': len(rules),
        'rules_triggered': len(per_rule),
        'high_matches': sum(1 for mm in matches if mm.get('severity') == 'high'),
        'rules_version': _rules_version(),
        'matches': matches,
    }
    return sanitized, summary


def _rules_version() -> int | None:
    try:
        return int(json.loads(RULES_SOURCE.read_text(encoding='utf-8')).get('version', 0))
    except Exception:
        return None


def sanitize_file(path: Path) -> dict[str, Any]:
    """Read a file, sanitize it, return result dict."""
    try:
        content = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        # Treat as binary; return placeholder
        return {
            'file': str(path),
            'error': 'binary file skipped',
            'sanitized': '',
            'summary': {'total_matches': 0, 'per_rule': {}, 'rules_triggered': 0},
        }
    except FileNotFoundError:
        return {
            'file': str(path),
            'error': 'file not found',
            'sanitized': '',
            'summary': {'total_matches': 0, 'per_rule': {}, 'rules_triggered': 0},
        }
    except Exception as exc:
        return {
            'file': str(path),
            'error': f'read failed: {exc}',
            'sanitized': '',
            'summary': {'total_matches': 0, 'per_rule': {}, 'rules_triggered': 0},
        }

    sanitized, summary = sanitize_text(content)
    return {
        'file': str(path),
        'sanitized_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'original_size': len(content),
        'sanitized_size': len(sanitized),
        'sanitized': sanitized,
        'summary': summary,
    }


# ─────────────────────────────────────────────
# Output formatters
# ─────────────────────────────────────────────

def fmt_summary(result: dict[str, Any]) -> str:
    if result.get('error'):
        return f"file: {result['file']} | error: {result['error']}"
    s = result['summary']
    rules = ', '.join(f"{k}={v}" for k, v in s['per_rule'].items()) or '-'
    return (
        f"file: {result['file']} | "
        f"size: {result['original_size']} → {result['sanitized_size']} | "
        f"matches: {s['total_matches']} | rules: {rules}"
    )


def fmt_md(result: dict[str, Any]) -> str:
    if result.get('error'):
        return f"# Sanitize failed\n\n- File: `{result['file']}`\n- Error: {result['error']}\n"
    s = result['summary']
    lines = [
        f"# Sanitize Report",
        f"",
        f"- File: `{result['file']}`",
        f"- Sanitized at: `{result['sanitized_at']}`",
        f"- Size: {result['original_size']} → {result['sanitized_size']} bytes",
        f"- Total matches: **{s['total_matches']}**",
        f"- Rules triggered: {s['rules_triggered']} / {s['rules_evaluated']}",
        f"",
        f"## Per-rule matches",
        f"",
        f"| Rule | Name | Count |",
        f"|------|------|-------|",
    ]
    if s['per_rule']:
        rule_meta = {r['id']: r for r in RULES}
        for rule_id, count in sorted(s['per_rule'].items()):
            name = rule_meta.get(rule_id, {}).get('name', '')
            lines.append(f"| `{rule_id}` | {name} | {count} |")
    else:
        lines.append(f"| _none_ | — | 0 |")
    return '\n'.join(lines) + '\n'


# ─────────────────────────────────────────────
# Audit log
# ─────────────────────────────────────────────

def write_audit(result: dict[str, Any], project_root: Path | None = None) -> Path | None:
    """Append to privacy-audit.json (rolling 200 entries；v0.7.0 路径经 sfpaths)."""
    base = project_root or Path(result.get('file', '.')).parent
    try:
        import sfpaths as _sfpaths
        audit_path = _sfpaths.runtime_path(base, 'privacy-audit.json')
    except Exception:
        audit_path = base / '.specflow' / 'privacy-audit.json'
    audit_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        existing: list[dict[str, Any]] = []
        if audit_path.exists():
            existing = json.loads(audit_path.read_text(encoding='utf-8'))
            if not isinstance(existing, list):
                existing = []
        # Build audit entry — never log original or sanitized content, only hashes
        entry = {
            'ts': result.get('sanitized_at') or datetime.now().astimezone().isoformat(timespec='seconds'),
            'file': result.get('file'),
            'original_size': result.get('original_size'),
            'sanitized_size': result.get('sanitized_size'),
            'total_matches': result['summary']['total_matches'],
            'per_rule': result['summary']['per_rule'],
            'match_hashes': [m['hash'] for m in result['summary']['matches'][:50]],
        }
        existing.append(entry)
        # Rolling: keep last 200
        existing = existing[-200:]
        audit_path.write_text(json.dumps(existing, indent=2, ensure_ascii=False), encoding='utf-8')
        return audit_path
    except Exception:
        return None


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description='Privacy sanitizer — redact sensitive information from files',
    )
    parser.add_argument('file', help='File to sanitize')
    parser.add_argument('--format', choices=['text', 'json', 'md', 'summary'],
                        default='text', help='Output format (default: redacted text)')
    parser.add_argument('--audit', action='store_true',
                        help='Also write audit entry to privacy-audit.json（<运行时目录>）')
    parser.add_argument('--severity', choices=['high', 'low'], default=None,
                        help='（v0.6.0 / B6）只跑对应分级的规则（默认全跑）')
    parser.add_argument('--project-root', default=None,
                        help='Project root for audit log location (default: file parent)')
    args = parser.parse_args()

    path = Path(args.file).resolve()
    if not path.is_file():
        print(f"error: file not found: {path}", file=sys.stderr)
        return 1

    try:
        content = path.read_text(encoding='utf-8')
    except UnicodeDecodeError:
        result = {
            'file': str(path), 'error': 'binary file skipped', 'sanitized': '',
            'summary': {'total_matches': 0, 'per_rule': {}, 'rules_triggered': 0},
        }
        _emit(args, result)
        return 2

    # v0.6.0（B6）：规则单源加载失败 → fail-loud（退出码 3，区别于普通错误）
    try:
        sanitized, summary = sanitize_text(content, severity_filter=args.severity)
    except RuntimeError as err:
        print(f"error: {err}", file=sys.stderr)
        return 3
    result = {
        'file': str(path),
        'sanitized_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'original_size': len(content),
        'sanitized_size': len(sanitized),
        'sanitized': sanitized,
        'summary': summary,
    }

    if args.audit:
        project_root = Path(args.project_root).resolve() if args.project_root else None
        write_audit(result, project_root=project_root)

    _emit(args, result)
    return 0


def _emit(args: argparse.Namespace, result: dict[str, Any]) -> None:
    if args.format == 'text':
        # Print just the redacted content
        sys.stdout.write(result.get('sanitized', ''))
        if not result.get('sanitized', '').endswith('\n'):
            sys.stdout.write('\n')
    elif args.format == 'json':
        # Include everything except original content
        out = dict(result)
        print(json.dumps(out, indent=2, ensure_ascii=False))
    elif args.format == 'md':
        print(fmt_md(result))
    else:  # summary
        print(fmt_summary(result))


if __name__ == '__main__':
    sys.exit(main())
