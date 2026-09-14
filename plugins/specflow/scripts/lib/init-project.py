#!/usr/bin/env python3
"""
init-project.py — Codex 插件项目初始化器（核心逻辑）

被以下入口调用：
  - bash:    ~/.codex/scripts/sh/init-project.sh
  - PowerShell: ~/.codex/scripts/ps/init-project.ps1
  - slash:   /init (在 Codex 会话里)

设计依据：docs/requirements/INIT.md + docs/decisions/ADR-001

功能：
  1. 检测当前目录与已初始化状态
  2. 最小交互（询问项目名 + 作者）
  3. 收集变量（环境扫描 + 用户输入 + git 信息）
  4. 渲染模板并写入项目（幂等：已存在不覆盖）
  5. git 初始化 + 安装 git hooks
  6. 自动验证
  7. 输出下一步指引

用法：
  python3 init-project.py <project_root> [--force] [--dry-run]
"""

import argparse
import json
import os
import re
import shutil
import subprocess
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


def _cfg_path(root: Path, name: str) -> Path:
    return _sfpaths.config_path(root, name) if _sfpaths else root / '.specflow' / name


def _rt_path(root: Path, name: str) -> Path:
    return _sfpaths.runtime_path(root, name) if _sfpaths else root / '.specflow' / name


# v0.7.2：跨平台 Python 解释器解析（与 sf.sh / sf.ps1 / common.mjs findPython 同语义）
# 此前硬编码 'python3' —— Windows 上不存在 python3.exe，subprocess.run 抛 FileNotFoundError
# 被 except Exception: pass 吞掉，env-scan / todo-scan / workflow-state 静默失败
_PY_CACHE: list[str] | None = None


def _resolve_python() -> str | None:
    """探测可用的 Python 解释器，返回命令词列表的字符串形式（'python3' / 'python' / 'py -3'）。

    优先级：SPECFLOW_PY 环境变量 → PATH 内 python3 → python → py -3（Windows 启动器）；
    与 sf.sh / sf.ps1 / hooks/scripts/lib/common.mjs findPython 保持一致。
    失败返回 None（调用方自行降级）。
    """
    global _PY_CACHE
    if _PY_CACHE is not None:
        return _PY_CACHE

    import shutil

    # 1) SPECFLOW_PY 显式指定（pyenv/conda 等非 PATH 场景）
    override = os.environ.get('SPECFLOW_PY', '').strip()
    if override:
        exe = override.split()[0]
        if shutil.which(exe) or Path(exe).is_file():
            _PY_CACHE = override
            return _PY_CACHE
        # 不可用 → 落到标准链（不立即报错；让上层在多场景下有机会命中）

    # 2) PATH 内命令（Windows 上 'python' 比 'python3' 更常见）
    for c in ('python3', 'python'):
        if shutil.which(c):
            _PY_CACHE = c
            return _PY_CACHE

    # 3) py -3（Windows 启动器；POSIX 上不存在）
    if shutil.which('py'):
        _PY_CACHE = 'py -3'
        return _PY_CACHE

    _PY_CACHE = None
    return None


def _py_cmd(script: Path, *args: str) -> list[str]:
    """构造运行 Python 子脚本的命令列表；解释器缺失时返回空列表（调用方降级）。"""
    py = _resolve_python()
    if py is None:
        return []
    # py 可能是 'py -3' 这种带参数的形式（与 SPECFLOW_PY 同语义）
    return py.split() + [str(script), *args]


# ─────────────────────────────────────────────
# 配置
# ─────────────────────────────────────────────

# 插件目录（优先环境变量；否则按脚本位置自定位 scripts/lib → 上溯 2 级，
# classic 安装时即为 ~/.codex，插件源目录直接调用也能找到 templates-project/）
PLUGIN_ROOT = Path(os.environ.get('CODEX_PLUGIN_ROOT') or Path(__file__).resolve().parents[2])
TEMPLATES_DIR = PLUGIN_ROOT / 'templates-project'
ENV_SCANNER = PLUGIN_ROOT / 'scripts/lib/env-scanner.py'
WORKFLOW_STATE = PLUGIN_ROOT / 'scripts/lib/workflow-state.py'
TODO_SCANNER = PLUGIN_ROOT / 'scripts/lib/todo-scanner.py'


def _plugin_version() -> str:
    """读取 .codex-plugin/plugin.json 的 version（v0.3.1：修复原来误写目录名的问题）"""
    try:
        pj = PLUGIN_ROOT / '.codex-plugin' / 'plugin.json'
        if pj.is_file():
            return str(json.loads(pj.read_text(encoding='utf-8')).get('version') or 'unknown')
    except Exception:
        pass
    return 'unknown'

# 项目级需要创建的目录骨架（v0.7.0：统一 .specflow/，配置与运行时同目录）
# v0.9.1：新增 .specflow/error-kb/ 错误知识库目录（v0.9.0 引入但 init 未创建骨架）
# v1.1.0：新增 .specflow/hooks/ .specflow/languages/ .specflow/rules/ DIY 自定义目录
PROJECT_DIRS = [
    '.specflow',
    '.specflow/workflow-state',
    '.specflow/workflow-state/agents',
    '.specflow/error-kb',               # v0.9.1：错误知识库目录
    '.specflow/error-kb-pending',      # v1.0.0：自动捕获 pending 目录
    '.specflow/hooks',                  # v1.0.0：自定义 hook 规则
    '.specflow/languages',              # v1.0.0：自定义语言模板
    '.specflow/rules',                  # v1.0.0：自定义阶段规则
    'context',
    'docs/requirements',
    'docs/design',
    'docs/decisions',
    'docs/changes',
    'docs/cards',
    'docs/guides',
    'docs/manifest',
    'docs/archive',
]

# 需要渲染的模板文件（template_path → target_path）
TEMPLATES = [
    ('AGENTS.md.tpl',                       'AGENTS.md'),
    ('config.md.tpl',                       '.specflow/config.md'),
    ('config.default.md.tpl',               '.specflow/config.default.md'),
    ('agents/README.md.tpl',                '.specflow/agents/README.md'),
    ('languages/README.md.tpl',             '.specflow/languages/README.md'),
    ('gitignore.tpl',                       '.gitignore'),
    ('README.md.tpl',                       'README.md'),
    ('docs/requirements/REQUIREMENTS.md.tpl', 'docs/requirements/REQUIREMENTS.md'),
    ('docs/decisions/README.md.tpl',        'docs/decisions/README.md'),
    ('docs/changes/CHANGELOG.md.tpl',       'docs/changes/CHANGELOG.md'),
    # v0.4.0 / A9：context 运行时目录模板（USAGE 附录 A.2 引用落地）
    ('context/current-sprint.md.tpl',       'context/current-sprint.md'),
    ('context/team-roster.yaml.tpl',        'context/team-roster.yaml'),
]

# 标记文件：表示项目已初始化（v0.7.0：.specflow/.initialized；旧项目 .codex/.initialized 回退）
INIT_MARKER = '.specflow/.initialized'

# ─────────────────────────────────────────────
# 日志
# ─────────────────────────────────────────────

class Color:
    if sys.stdout.isatty():
        RESET = '\033[0m'
        BLUE = '\033[34m'
        GREEN = '\033[32m'
        YELLOW = '\033[33m'
        RED = '\033[31m'
        GRAY = '\033[90m'
    else:
        RESET = BLUE = GREEN = YELLOW = RED = GRAY = ''

def log(msg):    print(f"{Color.BLUE}[init]{Color.RESET} {msg}")
def ok(msg):     print(f"{Color.GREEN}[ok]{Color.RESET}    {msg}")
def warn(msg):   print(f"{Color.YELLOW}[warn]{Color.RESET}  {msg}")
def err(msg):    print(f"{Color.RED}[err]{Color.RESET}   {msg}", file=sys.stderr)
def debug(msg):  pass  # 简化版，不输出 debug


# ─────────────────────────────────────────────
# 步骤 1: 检测项目目录
# ─────────────────────────────────────────────

def detect_project_root():
    """获取当前工作目录作为项目根"""
    return Path.cwd().resolve()

def is_initialized(project_root):
    """检测项目是否已初始化（新 .specflow/.initialized 或旧 .codex/.initialized）"""
    if _sfpaths is not None:
        return _sfpaths.is_initialized(project_root)
    return (project_root / '.specflow' / '.initialized').exists() \
        or (project_root / '.codex' / '.initialized').exists()

def is_git_repo(project_root):
    """检测是否 git 仓库"""
    return (project_root / '.git').is_dir()


# ─────────────────────────────────────────
# v0.7.0：旧布局迁移（.codex-plugin/ + .codex/ → 统一 .specflow/）
# ─────────────────────────────────────────

def _legacy_dirs(project_root: Path) -> list[Path]:
    """检测旧布局目录（.codex-plugin/ 恒属我们；.codex/ 需含 specflow 运行时文件）。"""
    dirs = []
    cp = project_root / '.codex-plugin'
    if cp.is_dir():
        dirs.append(cp)
    cx = project_root / '.codex'
    if _sfpaths is not None:
        # 复用 sfpaths 的「属于我们」判定
        if cx.is_dir() and _sfpaths.layout(project_root) == 'legacy':
            dirs.append(cx)
    elif cx.is_dir() and any((cx / m).exists() for m in (
            '.initialized', 'hooks-state.json', 'todo-state.json',
            'events.jsonl', 'workflow-state', 'parsed-config.json')):
        dirs.append(cx)
    return dirs


def _dir_empty_of_real_content(p: Path) -> bool:
    """目录内仅剩 .gitkeep / 空子目录 → 可安全删除。"""
    try:
        for child in p.iterdir():
            if child.is_file() and child.name != '.gitkeep':
                return False
            if child.is_dir() and not _dir_empty_of_real_content(child):
                return False
        return True
    except OSError:
        return False


def _prune_empty_tree(p: Path) -> None:
    """自底向上删除仅含 .gitkeep/空目录的目录树。"""
    try:
        for child in sorted(p.iterdir(), reverse=True):
            if child.is_dir():
                _prune_empty_tree(child)
            elif child.name == '.gitkeep':
                child.unlink()
        if _dir_empty_of_real_content(p):
            p.rmdir()
    except OSError:
        pass


def _merge_move(src: Path, dst: Path, project_root: Path,
                moved: list[str], conflicts: list[str]) -> None:
    """递归移动 src → dst：目标不存在则移；已存在则保留目标（旧文件原地不动并记冲突）。"""
    if src.is_file():
        if dst.exists():
            if src.name == '.gitkeep':
                src.unlink()  # 占位文件：目标侧已有内容 → 直接删源（不算冲突）
                return
            conflicts.append(f'{src.relative_to(project_root)} → '
                             f'{dst.relative_to(project_root)}'
                             '（目标已存在，保留目标；旧文件留在原处）')
            return
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
        try:
            moved.append(str(src.relative_to(project_root)))
        except ValueError:
            moved.append(str(src))
        return
    if src.is_dir():
        for child in sorted(src.iterdir()):
            _merge_move(child, dst / child.name, project_root, moved, conflicts)


def migrate_legacy_layout(project_root: Path) -> dict[str, Any]:
    """v0.7.0（用户反馈第 1 项）：旧布局迁移——把 .codex-plugin/ 与 .codex/
    （v0.6.0 及之前初始化产生）的内容合并进统一 .specflow/ 目录。

    非破坏策略：
      - 目标位置不存在 → 移动（mv，同盘零拷贝）
      - 目标已存在（例如已跑过一次 v0.7.0 init 补齐了骨架）→ 保留 .specflow/
        内现有文件，旧文件原地不动并警告（用户自行取舍）
      - 迁移后旧目录若仅剩 .gitkeep/空子目录 → 删除；否则保留并提示
    幂等：重复执行无副作用（所有内容已在 .specflow/ 时两个旧目录均不存在）。
    """
    legacy = _legacy_dirs(project_root)
    if not legacy:
        return {'needed': False, 'moved': [], 'conflicts': [], 'kept': []}

    sf = project_root / '.specflow'
    sf.mkdir(parents=True, exist_ok=True)
    moved: list[str] = []
    conflicts: list[str] = []
    kept: list[str] = []
    for src in legacy:
        # 顶层旧目录（.codex-plugin/ 或 .codex/）的内容**拍平**进 .specflow/：
        # .codex-plugin/config.md → .specflow/config.md；.codex/todo-state.json → .specflow/todo-state.json
        _merge_move(src, sf, project_root, moved, conflicts)
        if _dir_empty_of_real_content(src):
            _prune_empty_tree(src)
        else:
            kept.append(str(src))

    # 迁移后补 .gitignore（v0.7.1：与 init 主流程共用 ensure_specflow_gitignore）
    ensure_specflow_gitignore(project_root)
    return {'needed': True, 'moved': moved, 'conflicts': conflicts, 'kept': kept}


def _gitignore_ignores_specflow(text: str) -> bool:
    """逐行判断 .gitignore 是否已忽略 .specflow（兼容带/不带斜杠与根锚定写法）。"""
    for raw in text.splitlines():
        line = raw.strip().rstrip('/')
        if line in ('.specflow', '/.specflow'):
            return True
    return False


def ensure_specflow_gitignore(project_root: Path) -> bool:
    """（v0.7.1 / 用户实测反馈）确保项目 .gitignore 忽略 .specflow/ 运行时目录。

    背景：gitignore.tpl 仅在 .gitignore **不存在**时落地；真实项目几乎都已有
    .gitignore（模板被跳过），导致 todo-state.json / events.jsonl / 缓存 /
    workflow-state 等运行时产物混入用户版本库。规则：
      - .gitignore 不存在 → 不动（由 gitignore.tpl 模板生成，内含忽略条目）
      - 已忽略 .specflow → 不动（幂等；兼容 .specflow 与 .specflow/ 两种写法）
      - 存在但未忽略 → 仅追加忽略块（非破坏，不动用户任何已有行）
    返回是否实际追加。
    """
    gi = project_root / '.gitignore'
    if not gi.is_file():
        return False
    try:
        text = gi.read_text(encoding='utf-8')
    except Exception:
        warn("无法读取 .gitignore，跳过 .specflow 忽略检查")
        return False
    if _gitignore_ignores_specflow(text):
        return False
    try:
        block = ('\n# specflow 运行时产物（init 自动追加）\n'
                 '.specflow/\n!.specflow/.gitkeep\n.specflow-backup-*/\n')
        with gi.open('a', encoding='utf-8') as fh:
            fh.write(block)
        ok("已追加 .gitignore 忽略条目（.specflow/ 运行时目录不进版本库）")
        return True
    except Exception as e:
        warn(f"追加 .gitignore 忽略条目失败: {e}")
        return False


# ─────────────────────────────────────────────
# 步骤 2: 最小交互
# ─────────────────────────────────────────────

def ask_minimal_info(project_root, args):
    """询问项目名与作者（默认值取自目录名 / git config）"""
    print()
    log(f"当前目录: {project_root}")
    log(f"模式: 项目级初始化")
    if args.force:
        warn("--force 模式：将备份后覆盖已存在文件")
    if args.dry_run:
        warn("--dry-run 模式：只打印不执行")
    print()
    log("请回答以下问题（直接回车使用默认值）：")

    # 项目名（默认=目录名）
    default_name = project_root.name
    name = input(f"  1. 项目名称 [{default_name}]: ").strip()
    if not name:
        name = default_name

    # 作者（默认=git config）
    default_author = _get_git_author(project_root)
    author_input = input(f"  2. 作者信息 [{default_author}]: ").strip()
    author = author_input if author_input else default_author

    print()
    return name, author


# ─────────────────────────────────
# v0.6.0（B5）：引导式初始化（USAGE §4.3，8 问）
# ─────────────────────────────────

PROJECT_TYPES = ['web', 'api', 'cli', 'library', 'monorepo']
PROJECT_TYPE_LABELS = {
    'web': 'web 应用', 'api': 'API 服务', 'cli': 'CLI 工具',
    'library': '库 / SDK', 'monorepo': 'monorepo',
}
LANG_CHOICES = ['typescript', 'python', 'go', 'java', 'rust', 'multi']
PKG_CHOICES = ['npm', 'pnpm', 'yarn', 'uv', 'poetry', 'pip']
TEST_CHOICES = ['vitest', 'jest', 'pytest', 'go-test', 'cargo-test', 'maven-surefire']
STRICTNESS_CHOICES = ['standard', 'strict']

# 测试框架 → 测试命令（B1 真实测试执行器 / pre-commit 门禁共用）
TEST_COMMANDS = {
    'vitest': 'npx vitest run',
    'jest': 'npm test',
    'pytest': 'python3 -m pytest',
    'go-test': 'go test ./...',
    'cargo-test': 'cargo test',
    'maven-surefire': 'mvn test',
}


def _detect_pkg_manager(project_root: Path, lang: str) -> str:
    if (project_root / 'pnpm-lock.yaml').is_file():
        return 'pnpm'
    if (project_root / 'yarn.lock').is_file():
        return 'yarn'
    if (project_root / 'uv.lock').is_file():
        return 'uv'
    if (project_root / 'poetry.lock').is_file():
        return 'poetry'
    if (project_root / 'package.json').is_file():
        return 'npm'
    if (project_root / 'requirements.txt').is_file():
        return 'pip'
    if lang == 'python':
        return 'pip'
    if lang in ('typescript',):
        return 'npm'
    return 'npm'


def _detect_test_framework(project_root: Path, env_info: dict) -> str | None:
    detected = ((env_info.get('test_framework') or {}).get('detected')) or []
    if detected:
        return detected[0]
    pkg = project_root / 'package.json'
    if pkg.is_file():
        try:
            scripts = json.loads(pkg.read_text(encoding='utf-8')).get('scripts', {})
            if 'test' in scripts:
                return 'jest'
        except Exception:
            pass
    return None


def _ask_numbered(prompt: str, choices: list[str], default: str,
                  labels: dict[str, str] | None = None) -> str:
    """编号单选（回车=默认）；非法输入重问（最多 3 次后用默认）。"""
    lines = []
    for i, c in enumerate(choices, 1):
        mark = '（默认）' if c == default else ''
        label = (labels or {}).get(c, c)
        lines.append(f"     [{i}] {label}{mark}")
    default_idx = str(choices.index(default) + 1) if default in choices else '1'
    for _ in range(3):
        raw = input(f"  {prompt}\n" + '\n'.join(lines)
                    + f"\n     选择 [{default_idx}]: ").strip()
        if not raw:
            return default
        if raw.isdigit() and 1 <= int(raw) <= len(choices):
            return choices[int(raw) - 1]
        if raw in choices:
            return raw
        print(f"     （无效输入：{raw}，请输入 1-{len(choices)} 或回车）")
    return default


def ask_guided_info(project_root, args, env_info: dict) -> dict:
    """B5 引导式初始化：8 问（USAGE §4.3）。

    非交互场景（--type/--lang/... 已传或 stdin 非 TTY）自动取默认值，
    问答结果回写 vars.yaml / workflow stages / test-executor.json（B1）。
    """
    print()
    log(f"当前目录: {project_root}")
    log("模式: 引导式初始化（8 问，回车全部用默认值）")
    if args.dry_run:
        warn("--dry-run 模式：只打印不执行")
    print()

    lang_stack = env_info.get('lang_stack')
    detected_lang = None
    if isinstance(lang_stack, dict):
        detected_lang = lang_stack.get('primary')
    elif isinstance(lang_stack, str):
        detected_lang = lang_stack
    if detected_lang not in LANG_CHOICES:
        detected_lang = 'typescript'

    detected_test = _detect_test_framework(project_root, env_info)
    default_test = detected_test if detected_test in TEST_CHOICES else 'vitest'

    interactive = sys.stdin.isatty() and not (args.type_ and args.lang)

    # 1-2: 名称 / 作者（与最小模式同默认值）
    if interactive:
        default_name = project_root.name
        name = input(f"  1. 项目名称 [{default_name}]: ").strip() or default_name
        default_author = _get_git_author(project_root)
        author = input(f"  2. 作者信息 [{default_author}]: ").strip() or default_author
    else:
        name = args.name or project_root.name
        author = args.author or _get_git_author(project_root)

    # 3: 项目类型
    if args.type_ in PROJECT_TYPES:
        ptype = args.type_
    elif interactive:
        ptype = _ask_numbered('3. 项目类型:', PROJECT_TYPES, 'web', PROJECT_TYPE_LABELS)
    else:
        ptype = 'web'

    # 4: 主语言栈
    if args.lang in LANG_CHOICES:
        lang = args.lang
    elif interactive:
        lang = _ask_numbered('4. 主语言栈:', LANG_CHOICES, detected_lang)
    else:
        lang = detected_lang

    # 5: 包管理器
    if args.pkg_manager in PKG_CHOICES:
        pkg = args.pkg_manager
    else:
        pkg_default = _detect_pkg_manager(project_root, lang)
        if interactive:
            pkg = _ask_numbered('5. 包管理器:', PKG_CHOICES, pkg_default)
        else:
            pkg = pkg_default

    # 6: 测试框架
    if args.test_framework in TEST_CHOICES:
        test_fw = args.test_framework
    else:
        if interactive:
            test_fw = _ask_numbered('6. 测试框架:', TEST_CHOICES, default_test)
        else:
            test_fw = default_test

    # 7: 工作流阶段（默认全部启用；输入序号禁用）
    all_stages = ['req-analysis', 'arch-design', 'coding', 'review', 'testing']
    if args.stages:
        chosen = [s.strip() for s in args.stages.split(',')
                  if s.strip() in all_stages]
        stages = chosen or all_stages
    elif interactive:
        print("  7. 工作流阶段（默认全部启用）:")
        for i, s in enumerate(all_stages, 1):
            print(f"     [{i}] {s}")
        raw = input("     输入要禁用的阶段序号（如 2,4；回车=全启用）: ").strip()
        disabled = set()
        for part in raw.replace('，', ',').split(','):
            part = part.strip()
            if part.isdigit() and 1 <= int(part) <= len(all_stages):
                disabled.add(all_stages[int(part) - 1])
        stages = [s for s in all_stages if s not in disabled] or all_stages
    else:
        stages = list(all_stages)

    # 8: 严格度
    if args.strictness in STRICTNESS_CHOICES:
        strictness = args.strictness
    elif interactive:
        strictness = _ask_numbered('8. 严格度:', STRICTNESS_CHOICES, 'standard',
                                   {'standard': '标准（lint 未过警告不阻塞）',
                                    'strict': '严格（未完成标记拒绝提交）'})
    else:
        strictness = 'standard'

    print()
    return {
        'name': name, 'author': author, 'type': ptype, 'lang': lang,
        'pkg_manager': pkg, 'test_framework': test_fw,
        'stages': stages, 'strictness': strictness,
        'test_command': TEST_COMMANDS.get(test_fw),
    }

def _get_git_author(project_root):
    """获取 git config 的 user.name 与 user.email"""
    try:
        name = subprocess.run(
            ['git', '-C', str(project_root), 'config', 'user.name'],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip()
        email = subprocess.run(
            ['git', '-C', str(project_root), 'config', 'user.email'],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip()
        if name and email:
            return f"{name} <{email}>"
        elif name:
            return name
    except Exception:
        pass
    # v0.7.2：Windows 用 USERNAME 而非 USER；macOS/Linux 用 USER；
    # 两者都缺失时回退 anonymous
    return os.environ.get('USER') or os.environ.get('USERNAME') or 'anonymous'


# ─────────────────────────────────────────────
# 步骤 3: 收集变量
# ─────────────────────────────────────────────

def collect_variables(project_root, project_name, author):
    """收集模板渲染所需的全部变量"""
    # 调 env-scanner 拿环境信息
    env_info = _run_env_scanner(project_root)

    # 解析作者
    name, email = _parse_author(author)

    # 获取 git 分支
    git_branch = _get_git_branch(project_root)

    # env-scanner.py 实际输出：os.shell 嵌套在 os 下；lang_stack.primary 是字符串
    lang_stack = env_info.get('lang_stack')
    if isinstance(lang_stack, dict):
        lang_primary = lang_stack.get('primary') or 'none'
    elif isinstance(lang_stack, str) and lang_stack:
        lang_primary = lang_stack
    else:
        lang_primary = 'none'
    os_shell = (env_info.get('os', {}).get('shell') or {}).get('name', 'unknown')

    return {
        'project.name': project_name,
        'project.root': str(project_root),
        'project.description': '',  # 留空，用户自己填
        'env.USERNAME': name,
        'env.USEREMAIL': email,
        'os.name': env_info.get('os', {}).get('system', 'unknown'),
        'os.shell': os_shell,
        'lang.primary': lang_primary,
        'git.branch': git_branch,
        'git.author': name,
        'now': datetime.now().isoformat(timespec='seconds'),
        'today': datetime.now().strftime('%Y-%m-%d'),
    }

def _run_env_scanner(project_root):
    """调用 env-scanner.py 拿环境信息"""
    if not ENV_SCANNER.exists():
        return {}
    try:
        cmd = _py_cmd(ENV_SCANNER, str(project_root), '--format=json')
        if not cmd:
            return {}
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=10,
        )
        if r.returncode == 0:
            return json.loads(r.stdout)
    except Exception:
        pass
    return {}

def _parse_author(author_str):
    """解析 'Name <email>' 格式"""
    m = re.match(r'^(.+?)\s*<(.+?)>$', author_str)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return author_str, ''

def _get_git_branch(project_root):
    """获取当前 git 分支"""
    try:
        r = subprocess.run(
            ['git', '-C', str(project_root), 'rev-parse', '--abbrev-ref', 'HEAD'],
            capture_output=True, text=True, timeout=2,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return 'unknown'


# ─────────────────────────────────────────────
# 步骤 4: 渲染模板
# ─────────────────────────────────────────────

def render_template(template_path, variables):
    """渲染模板：替换 {{var}} 与 {{var|default:"x"}} 语法"""
    content = Path(template_path).read_text(encoding='utf-8')

    # 处理 {{var|default:"fallback"}} 语法
    def replace_with_default(m):
        var_expr = m.group(1)
        if '|' in var_expr:
            var_name, default_part = var_expr.split('|', 1)
            var_name = var_name.strip()
            # 提取默认值
            default_match = re.match(r'default:\s*"([^"]*)"', default_part.strip())
            if default_match:
                default_val = default_match.group(1)
                return str(variables.get(var_name, default_val))
            return str(variables.get(var_name, ''))
        else:
            return str(variables.get(var_expr.strip(), ''))

    content = re.sub(r'\{\{([^{}]+)\}\}', replace_with_default, content)
    return content

def render_templates(variables, project_root, force=False):
    """渲染所有模板并写入项目"""
    if not TEMPLATES_DIR.is_dir():
        err(f"模板目录不存在: {TEMPLATES_DIR}")
        err("请确认插件已正确安装：插件模式用 codex plugin list 检查；"
            "classic 模式重跑 bash ~/.codex/scripts/sh/install.sh；"
            "或先用 sf.sh doctor 自检")
        sys.exit(1)

    created = []
    skipped = []
    backup_dir = None

    for tpl_rel, target_rel in TEMPLATES:
        tpl_path = TEMPLATES_DIR / tpl_rel
        target_path = project_root / target_rel

        if not tpl_path.exists():
            debug(f"模板不存在，跳过: {tpl_rel}")
            continue

        # 幂等：已存在不覆盖（除非 force）
        if target_path.exists():
            if force:
                if backup_dir is None:
                    backup_dir = project_root / f'.specflow-backup-{datetime.now().strftime("%Y%m%d-%H%M%S")}'
                    backup_dir.mkdir(parents=True, exist_ok=True)
                rel_to_backup = target_path.relative_to(project_root)
                backup_path = backup_dir / rel_to_backup
                backup_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target_path, backup_path)
                content = render_template(tpl_path, variables)
                target_path.parent.mkdir(parents=True, exist_ok=True)
                target_path.write_text(content, encoding='utf-8')
                ok(f"覆盖 {target_rel}（已备份到 {backup_dir.name}/）")
                created.append(target_rel)
            else:
                skipped.append(target_rel)
        else:
            content = render_template(tpl_path, variables)
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(content, encoding='utf-8')
            ok(f"生成 {target_rel}")
            created.append(target_rel)

    # 项目级 .codexignore（幂等：已存在不覆盖）
    ignore_path = project_root / '.codexignore'
    if ignore_path.exists():
        skipped.append('.codexignore')
    elif not args_dry_run:
        ignore_path.write_text(CODEXIGNORE_DEFAULT, encoding='utf-8')
        ok("生成 .codexignore（PreToolUse 拦截黑名单）")
        created.append('.codexignore')

    # 创建空目录骨架（.gitkeep）
    for d in PROJECT_DIRS:
        dir_path = project_root / d
        if not dir_path.exists():
            if not args_dry_run:
                dir_path.mkdir(parents=True, exist_ok=True)
            ok(f"创建目录 {d}/")
        # 加 .gitkeep
        gitkeep = dir_path / '.gitkeep'
        if not gitkeep.exists() and not args_dry_run:
            gitkeep.touch()

    return created, skipped, backup_dir

# 项目级 .codexignore 默认内容（PreToolUse hook 依赖它做黑名单拦截）
CODEXIGNORE_DEFAULT = """# specflow 项目级黑名单（PreToolUse hook 按此拦截工具调用）
*.pem
*.key
.env
.env.*
!.env.example
**/secrets/**
**/node_modules/**
**/dist/**
**/__pycache__/**
*.log
.DS_Store
"""

# 模块全局变量（hack：用于在 render_templates 内访问 args.dry_run）
args_dry_run = False


# ─────────────────────────────────────────────
# 步骤 4.5: 已有项目扫描与快照（v0.4.0 / A4）────────────────────────────

EXISTING_PROJECT_HINTS = [
    'package.json', 'pyproject.toml', 'setup.py', 'go.mod', 'pom.xml',
    'build.gradle', 'Cargo.toml', 'requirements.txt', 'src', 'lib', 'tests',
]


def is_existing_project(project_root: Path) -> bool:
    """启发式判断：目录里已有代码/依赖清单 → 已有项目（走扫描分支而非空白引导）。"""
    return any((project_root / h).exists() for h in EXISTING_PROJECT_HINTS)


def _inventory_docs(project_root: Path) -> dict[str, Any]:
    """盘点已有文档（USAGE §4.4：现有文档扫描）。

    v0.6.0（A4 深度扫描）：除固定位置外，递归 docs/ 树并解析每份 Markdown
    的 frontmatter（title/type/version/status）——让 Agent 直接看到文档资产
    版本与状态，而不只是「存在」。
    """
    result: dict[str, Any] = {}
    for name, rels in {
        'requirements': ('docs/requirements/REQUIREMENTS.md',),
        'decisions': ('docs/decisions/README.md',),
        'changes': ('docs/changes/CHANGELOG.md', 'CHANGELOG.md'),
        'agents': ('AGENTS.md',),
        'config': ('.specflow/config.md', '.codex-plugin/config.md'),
    }.items():
        found = [str(r) for r in rels if (project_root / r).is_file()]
        if found:
            result[name] = found

    # docs/ 树 + 项目根一层 Markdown 的 frontmatter 盘点
    docs: list[dict[str, Any]] = []
    seen: set[Path] = set()
    candidates: list[Path] = [project_root / 'docs']
    for f in (project_root).glob('*.md'):
        candidates.append(f)
    for base in candidates:
        if base.is_file():
            files = [base]
        elif base.is_dir():
            files = [p for p in base.rglob('*.md') if p.is_file()]
        else:
            continue
        for p in files:
            r = p.relative_to(project_root)
            if p in seen or r.as_posix().startswith(('.specflow', '.codex', 'node_modules')):
                continue
            seen.add(p)
            docs.append(_doc_frontmatter(p, str(r)))
    if docs:
        result['docs_tree'] = sorted(docs, key=lambda d: d['path'])
    return result


def _doc_frontmatter(path: Path, rel: str) -> dict[str, Any]:
    """提取 Markdown frontmatter 的 title/type/version/status（无则仅记 path）。"""
    entry: dict[str, Any] = {'path': rel}
    try:
        lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()
    except Exception:
        return entry
    if not lines or lines[0].strip() != '---':
        entry['size_bytes'] = sum(len(l) + 1 for l in lines)
        return entry
    for ln in lines[1:60]:
        s = ln.strip()
        if s == '---':
            break
        m = re.match(r'^(title|type|version|status|author|last_modified):\s*(.*?)\s*$', s)
        if m:
            key = m.group(1)
            val = m.group(2).strip().strip('"\'')
            if val:
                entry[key] = val[:80]
    return entry


def _detect_ci(project_root: Path) -> dict[str, Any]:
    """v0.6.0（A4）：CI 配置检测。"""
    markers = {
        'github-actions': ('.github/workflows',),
        'gitlab-ci': ('.gitlab-ci.yml',),
        'jenkins': ('Jenkinsfile',),
        'circleci': ('.circleci/config.yml',),
        'travis': ('.travis.yml',),
        'azure-pipelines': ('azure-pipelines.yml',),
    }
    detected = []
    for name, rels in markers.items():
        if any((project_root / r).exists() for r in rels):
            detected.append(name)
    workflows = []
    gh = project_root / '.github' / 'workflows'
    if gh.is_dir():
        workflows = sorted(p.name for p in gh.glob('*.yml'))[:20]
    return {'detected': detected, 'github_workflows': workflows}


def _detect_coverage(project_root: Path) -> dict[str, Any]:
    """v0.6.0（A4）：覆盖率配置检测。"""
    found = []
    for f in ('codecov.yml', '.codecov.yml', '.coveragerc', '.cobertura.xml'):
        if (project_root / f).is_file():
            found.append(f)
    pyproject = project_root / 'pyproject.toml'
    if pyproject.is_file():
        try:
            txt = pyproject.read_text(encoding='utf-8', errors='ignore')
            if '[tool.coverage' in txt:
                found.append('pyproject.toml:[tool.coverage]')
        except Exception:
            pass
    pkg = project_root / 'package.json'
    if pkg.is_file():
        try:
            obj = json.loads(pkg.read_text(encoding='utf-8'))
            jcf = obj.get('jest') or {}
            if (jcf.get('collectCoverage')) or any(
                    'coverage' in (obj.get('scripts') or {}).get(k, '')
                    for k in ('test', 'test:coverage')):
                found.append('package.json:jest-coverage')
        except Exception:
            pass
    return {'configured': bool(found), 'config_files': found}


def _git_stats(project_root: Path) -> dict[str, Any]:
    """git 历史最小统计（USAGE §4.5）。"""
    def _run(*args):
        try:
            r = subprocess.run(['git', '-C', str(project_root), *args],
                               capture_output=True, text=True, timeout=5)
            return r.stdout.strip() if r.returncode == 0 else None
        except Exception:
            return None
    total = _run('rev-list', '--count', 'HEAD')
    last = _run('log', '-1', '--format=%ci')
    branches = _run('branch', '--format=%(refname:short)')
    tags = _run('tag', '--list')
    # v0.6.0（A4）：热点文件（最近 500 提交的变更频次 Top10）——
    # Agent 优先关注高变动文件（变更风险区）
    churn_raw = _run('log', '-500', '--name-only', '--format=')
    churn: list[dict[str, Any]] = []
    if churn_raw:
        counts: dict[str, int] = {}
        for f in churn_raw.splitlines():
            f = f.strip()
            if f:
                counts[f] = counts.get(f, 0) + 1
        churn = [{'path': p, 'changes': c}
                 for p, c in sorted(counts.items(), key=lambda kv: -kv[1])[:10]]
    return {
        'is_repo': total is not None,
        'total_commits': int(total) if total and total.isdigit() else 0,
        'last_commit_at': last,
        'branches': branches.splitlines() if branches else [],
        'tags': tags.splitlines() if tags else [],
        'top_churn_files': churn,
    }


def _dep_files(project_root: Path) -> dict[str, Any]:
    """依赖清单扫描（USAGE §4.4：目录 / 依赖扫描，语言栈复用 env-scanner）。"""
    out: dict[str, Any] = {}
    for f in ('package.json', 'pyproject.toml', 'go.mod', 'pom.xml',
              'build.gradle', 'Cargo.toml', 'requirements.txt'):
        p = project_root / f
        if p.is_file():
            try:
                out[f] = p.stat().st_size
            except OSError:
                pass
    return out


def _run_todo_scan(project_root: Path) -> dict[str, Any] | None:
    if not TODO_SCANNER.exists():
        return None
    try:
        cmd = _py_cmd(TODO_SCANNER, str(project_root), '--format=json')
        if not cmd:
            return None
        r = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
        )
        if r.returncode == 0:
            return json.loads(r.stdout)
    except Exception:
        pass
    return None


def write_project_snapshot(project_root: Path, env_info: dict[str, Any],
                           project_name: str) -> Path:
    """写 <运行时目录>/project-snapshot.json + todo-list.md（USAGE §4.6；路径经 sfpaths）。"""
    snapshot = {
        'snapshot_at': datetime.now().isoformat(timespec='seconds'),
        'project_name': project_name,
        'project_root': str(project_root),
        'existing_project': is_existing_project(project_root),
        'env': {
            'os': env_info.get('os', {}),
            'lang_stack': env_info.get('lang_stack'),
            'package_managers': env_info.get('package_managers')
                                or env_info.get('package_manager'),
            'test_frameworks': env_info.get('test_frameworks')
                               or env_info.get('test_framework'),
            'tools': env_info.get('tools'),
        },
        'dependency_files': _dep_files(project_root),
        'docs_inventory': _inventory_docs(project_root),
        'git': _git_stats(project_root),
        # v0.6.0（A4 深度扫描）：CI / 覆盖率配置
        'ci': _detect_ci(project_root),
        'coverage': _detect_coverage(project_root),
    }
    codex_dir = _rt_path(project_root, 'project-snapshot.json').parent
    codex_dir.mkdir(parents=True, exist_ok=True)
    snap_path = codex_dir / 'project-snapshot.json'
    snap_path.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False),
                          encoding='utf-8')

    # todo-list.md：现有 TODO/FIXME 清单（复用 todo-scanner）
    todo_md = []
    todo_path = codex_dir / 'todo-list.md'
    scan = _run_todo_scan(project_root)
    if scan is not None:
        s = scan.get('summary', {})
        todo_md.append(f"# TODO 清单（{project_name}）\n\n")
        todo_md.append(f"- 扫描时间: {scan.get('scanned_at')}\n")
        todo_md.append(
            f"- 总计: {s.get('total', 0)}（created {s.get('created', 0)} / "
            f"resolved {s.get('resolved', 0)} / deleted {s.get('deleted', 0)}）\n\n")
        todo_md.append('| 标记 | 优先级 | 位置 | 状态 | 说明 |\n')
        todo_md.append('|------|--------|------|------|------|\n')
        for m in scan.get('markers', []):
            loc = f"{Path(m['file']).name}:{m['line']}" if m.get('file') else '-'
            desc = (m.get('description') or '').replace('|', '\\|')[:60]
            todo_md.append(
                f"| `{m['id']}` | {m.get('priority', '-')} | `{loc}` | "
                f"{m.get('status', '-')} | {desc} |\n")
    else:
        todo_md.append(f"# TODO 清单（{project_name}）\n\n（扫描器不可用或未发现标记）\n")
    todo_path.write_text(''.join(todo_md), encoding='utf-8')
    return snap_path


def create_default_agent(project_root: Path, stages: list[str] | None = None) -> bool:
    """v0.4.0 / B3：创建 default workflow agent（幂等，已存在则跳过）。

    v0.6.0 / B5：stages 非空时按引导式选择创建（如禁用部分阶段）。
    """
    if not WORKFLOW_STATE.exists():
        warn(f"workflow-state.py 不存在，跳过 default agent 创建: {WORKFLOW_STATE}")
        return False
    try:
        cmd = _py_cmd(WORKFLOW_STATE, '--project-root', str(project_root),
                      'create-agent', '--id', 'default', '--name', 'Default Agent')
        if not cmd:
            warn('Python 解释器不可用，跳过 default agent 创建')
            return False
        if stages:
            cmd += ['--stages', ','.join(stages)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        if r.returncode == 0:
            stage_desc = ' → '.join(stages) if stages else '5 阶段：req-analysis → testing'
            ok(f"已创建 default workflow agent（{stage_desc}）")
            return True
        # 已存在 → 幂等跳过（阶段清单不变更——重装不破坏既有状态，--force 重建）
        if 'already exists' in (r.stdout or '') + (r.stderr or ''):
            ok("default workflow agent 已存在，跳过")
            return True
        warn(f"default agent 创建失败（非致命）: {(r.stderr or r.stdout or '').strip()[:200]}")
    except Exception as exc:
        warn(f"default agent 创建异常（非致命）: {exc}")
    return False


def _write_guided_outputs(project_root: Path, info: dict) -> None:
    """v0.6.0（B5 + B1）：引导式答案落盘。

    - <项目配置目录>/vars.yaml：8 问答案作为 doc-parser 变量层最高优先级
      （PARSER §5.5：project.* / tooling.* 命名空间）；已存在时幂等跳过
    - <运行时目录>/test-executor.json：B1 真实测试门禁配置（advance + pre-commit 共用）
    """
    if args_dry_run:
        return
    vars_path = _cfg_path(project_root, 'vars.yaml')
    if not vars_path.exists():
        name, email = _parse_author(info['author'])
        lines = [
            '# specflow 引导式初始化生成（v0.6.0 / B5，USAGE §4.3）',
            '# 本文件为 doc-parser 变量层最高优先级（PARSER §5.5）；可直接编辑',
            'project:',
            f"  name: \"{info['name']}\"",
            f"  type: {info['type']}",
            f"  lang: {info['lang']}",
            '  description: ""  # TODO: 补充项目描述',
            'user:',
            f"  author: \"{info['author']}\"",
        ]
        if email:
            lines.append(f"  email: \"{email}\"")
        lines += [
            'tooling:',
            f"  package_manager: {info['pkg_manager']}",
            f"  test_framework: {info['test_framework']}",
            'workflow:',
            f"  strictness: {info['strictness']}",
            f"  stages: {', '.join(info['stages'])}",
        ]
        try:
            vars_path.parent.mkdir(parents=True, exist_ok=True)
            vars_path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
            ok(f"引导式答案已写入 {vars_path}")
        except Exception as exc:
            warn(f"vars.yaml 写入失败（非致命）: {exc}")
    else:
        log("vars.yaml 已存在，跳过（避免覆盖手工编辑）")

    if info.get('test_command'):
        te_path = _rt_path(project_root, 'test-executor.json')
        if not te_path.exists():
            cfg = {
                'command': info['test_command'],
                'timeout_seconds': 300,
                'stages': ['testing'],
                'run_on_advance': True,
                'run_on_commit': True,
                'source': 'guided-init',
            }
            try:
                te_path.parent.mkdir(parents=True, exist_ok=True)
                te_path.write_text(
                    json.dumps(cfg, indent=2, ensure_ascii=False) + '\n',
                    encoding='utf-8')
                ok(f"真实测试门禁已配置 {te_path}（B1：advance/pre-commit 真跑测试）")
            except Exception as exc:
                warn(f"test-executor.json 写入失败（非致命）: {exc}")
        else:
            log("test-executor.json 已存在，跳过")

    if info.get('strictness') == 'strict':
        log("严格模式提示：pre-commit 将拒绝含未完成标记的提交"
            "（SPECFLOW_PRECOMMIT_STRICT=1；详见 scripts/lib/git-hooks.py）")


# 步骤 5: git 初始化 + hooks 安装
# ─────────────────────────────────────────────

def init_git_and_hooks(project_root, args):
    """git init（若需要）+ 安装 git hooks"""
    if not is_git_repo(project_root):
        log("当前目录不是 git 仓库，执行 git init...")
        if not args.dry_run:
            r = subprocess.run(['git', '-C', str(project_root), 'init'], capture_output=True, text=True)
            if r.returncode == 0:
                ok("git init 完成")
            else:
                warn(f"git init 失败: {r.stderr}")
        else:
            ok("(dry-run) git init")
    else:
        ok("git 仓库已存在，跳过 git init")

    # 安装 git hooks
    # v0.7.2：跨平台分发 —— Windows 走 PowerShell 安装器，POSIX 走 bash；
    # 两者都缺失时降级为跳过（非致命，与既有契约一致）
    ps_installer = PLUGIN_ROOT / 'scripts/ps/install-git-hooks.ps1'
    sh_installer = PLUGIN_ROOT / 'scripts/sh/install-git-hooks.sh'
    is_windows = sys.platform.startswith('win')
    installer = ps_installer if is_windows else sh_installer
    if installer.exists():
        log(f"安装 git hooks (via {installer.name})...")
        if not args.dry_run:
            env = os.environ.copy()
            env['CODEX_PROJECT_ROOT'] = str(project_root)
            try:
                if is_windows:
                    # Windows：尝试 pwsh，回退 powershell；两者都不可用则跳过
                    pwsh = shutil.which('pwsh') or shutil.which('powershell') or shutil.which('pwsh.exe') or shutil.which('powershell.exe')
                    if not pwsh:
                        warn('未找到 pwsh / powershell，跳过 git hooks 安装（非致命）')
                    else:
                        # v0.7.7：显式传 -ProjectRoot 参数（不依赖环境变量回退，更稳健）
                        r = subprocess.run(
                            [pwsh, '-ExecutionPolicy', 'Bypass', '-File', str(installer),
                             '-ProjectRoot', str(project_root)],
                            capture_output=True, text=True, cwd=str(project_root), env=env,
                        )
                        if r.returncode == 0:
                            ok("git hooks 安装完成（pre-commit / post-checkout / post-merge）")
                        else:
                            warn(f"git hooks 安装失败（非致命）: {r.stderr}")
                else:
                    r = subprocess.run(
                        ['bash', str(installer)],
                        capture_output=True, text=True, cwd=str(project_root), env=env,
                    )
                    if r.returncode == 0:
                        ok("git hooks 安装完成（pre-commit / post-checkout / post-merge）")
                    else:
                        warn(f"git hooks 安装失败（非致命）: {r.stderr}")
            except FileNotFoundError as exc:
                # bash / pwsh 缺失（罕见但需要兜底）：非致命，与既有契约一致
                warn(f"git hooks 安装器调用失败（非致命）: {exc}")
            except Exception as exc:
                warn(f"git hooks 安装异常（非致命）: {exc}")
        else:
            ok("(dry-run) 安装 git hooks")
    else:
        warn(f"git hooks 安装器不存在: {installer}")


# ─────────────────────────────────────────────
# 步骤 6: 自动验证
# ─────────────────────────────────────────────

def verify_initialization(project_root):
    """验证初始化是否成功"""
    log("验证初始化...")
    checks = [
        ('AGENTS.md',                              'project AGENTS.md'),
        ('.specflow/config.md',                    'project config'),
        ('.gitignore',                              'gitignore'),
        ('docs/requirements/REQUIREMENTS.md',     'requirement doc'),
        ('docs/decisions/README.md',              'ADR index'),
        ('docs/changes/CHANGELOG.md',             'CHANGELOG'),
        ('.specflow',                              'runtime dir'),
        ('.specflow/workflow-state/agents',       'workflow state dir'),
    ]

    all_passed = True
    for rel, desc in checks:
        path = project_root / rel
        if path.exists():
            size = path.stat().st_size if path.is_file() else 0
            size_str = f'{size} B' if size < 1024 else f'{size // 1024} KB'
            ok(f"{desc}（{size_str}）")
        else:
            warn(f"{desc} 未创建")
            all_passed = False

    # 写入初始化标记（v0.3.1：plugin_version 记真实版本号而非目录名）
    if all_passed:
        marker = project_root / INIT_MARKER
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(
            f'initialized_at: {datetime.now().isoformat()}\n'
            f'plugin_version: {_plugin_version()}\n',
            encoding='utf-8',
        )

    return all_passed


# ─────────────────────────────────────────────
# 步骤 7: 输出指引
# ─────────────────────────────────────────────

def print_next_steps(project_root):
    """输出下一步操作指引"""
    print()
    ok("初始化完成！")
    print()
    log("下一步：")
    # v0.7.2：Windows 上 vim 不一定存在；用 notepad 兜底，POSIX 用 vim
    editor = 'notepad' if sys.platform.startswith('win') else 'vim'
    print(f"  1. 编辑项目级配置")
    print(f"     {editor} {project_root}/.specflow/config.md")
    print()
    print(f"  2. 在 docs/requirements/REQUIREMENTS.md 写需求")
    print(f"     {editor} {project_root}/docs/requirements/REQUIREMENTS.md")
    print()
    print(f"  3. 启动 codex 会话")
    print(f"     cd {project_root} && codex")
    print(f"     （SessionStart hook 自动执行：环境扫描 + 加载配置 + 注入文档）")
    print()
    log("验证：")
    # v0.7.2：按平台给出真实可用的 sf 路径与命令语法
    #   - POSIX: bash sf.sh ...
    #   - Windows: powershell -File sf.ps1 ...（PS 5.1 默认即装；$(pwd) 改 (Get-Location)）
    home = Path.home()
    is_win = sys.platform.startswith('win')
    if is_win:
        if PLUGIN_ROOT == (home / '.codex').resolve():
            sf_cmd = 'powershell -ExecutionPolicy Bypass -File ~/.codex/scripts/ps/sf.ps1'
        else:
            sf_cmd = f'powershell -ExecutionPolicy Bypass -File "{PLUGIN_ROOT}/scripts/ps/sf.ps1"'
        pwd_expr = '(Get-Location)'
    else:
        if PLUGIN_ROOT == (home / '.codex').resolve():
            sf_cmd = "bash ~/.codex/scripts/sh/sf.sh"
        else:
            sf_cmd = f"bash \"{PLUGIN_ROOT}/scripts/sh/sf.sh\""
        pwd_expr = '"$(pwd)"'
    print(f"  {sf_cmd} scan            # 跑环境扫描")
    print(f"  {sf_cmd} doctor          # 环境自检")
    print(f'  {sf_cmd} todo {pwd_expr}   # 扫描 TODO/FIXME 标记')
    print()
    if is_git_repo(project_root):
        log("git hooks 已安装（v0.6.0 起为真实门禁，插件故障一律放行不阻塞提交）：")
        print(f"  - pre-commit: 暂存区高敏隐私扫描（命中即阻塞）+ 配置的测试命令"
              f"（run_on_commit，失败阻塞）+ lint 探测（失败仅警告）+ 未完成标记摘要"
              f"（SPECFLOW_PRECOMMIT_STRICT=1 时阻塞）")
        print(f"  - post-checkout / post-merge: 依赖清单变更检测 + TODO 重扫提示")
        print(f"  - 报告落盘 .specflow/precommit-report.json，事件见 .specflow/events.jsonl")


# ─────────────────────────────────────────────
# 主入口
# ─────────────────────────────────────────────

def main():
    global args_dry_run

    parser = argparse.ArgumentParser(description='Codex 插件项目初始化器')
    parser.add_argument('project_root', nargs='?', default='.',
                        help='项目根目录（默认当前目录）')
    parser.add_argument('--force', action='store_true',
                        help='强制重新初始化（备份后覆盖已存在文件）')
    parser.add_argument('--dry-run', action='store_true',
                        help='只打印不执行')
    parser.add_argument('--name', help='项目名（跳过交互）')
    parser.add_argument('--author', help='作者信息（跳过交互）')
    parser.add_argument('--no-migrate', action='store_true',
                        help='（v0.7.0）跳过旧布局迁移（.codex-plugin/.codex → .specflow；'
                             '默认自动迁移，非破坏）')
    parser.add_argument('--refresh', action='store_true',
                        help='（v0.4.0 / A4）仅刷新快照与 TODO 清单：重跑环境扫描 + '
                             'project-snapshot.json + todo-list.md，不动模板与 git hooks')
    parser.add_argument('--guided', action='store_true',
                        help='（v0.6.0 / B5）引导式初始化：8 问（项目名/作者/类型/'
                             '主语言/包管理器/测试框架/阶段/严格度）；非 TTY 时全取默认值')
    parser.add_argument('--type', default=None, dest='type_',
                        choices=PROJECT_TYPES, help='（B5 非交互）项目类型')
    parser.add_argument('--lang', default=None, choices=LANG_CHOICES,
                        help='（B5 非交互）主语言栈')
    parser.add_argument('--pkg-manager', default=None, choices=PKG_CHOICES,
                        help='（B5 非交互）包管理器')
    parser.add_argument('--test-framework', default=None, choices=TEST_CHOICES,
                        help='（B5 非交互）测试框架（自动写 .specflow/test-executor.json）')
    parser.add_argument('--stages', default=None,
                        help='（B5 非交互）逗号分隔工作流阶段（如 req-analysis,coding）')
    parser.add_argument('--strictness', default=None, choices=STRICTNESS_CHOICES,
                        help='（B5 非交互）严格度（standard/strict）')
    args = parser.parse_args()

    args_dry_run = args.dry_run

    project_root = Path(args.project_root).resolve()
    if not project_root.is_dir():
        err(f"项目目录不存在: {project_root}")
        sys.exit(1)

    print()
    print("=" * 60)
    print("  Codex 插件项目初始化器")
    print("=" * 60)

    # v0.4.0 / A4：--refresh —— 只刷新快照与 TODO 清单后退出
    if args.refresh:
        log("--refresh 模式：刷新项目快照与 TODO 清单")
        env_info = _run_env_scanner(project_root)
        name = args.name or project_root.name
        snap = write_project_snapshot(project_root, env_info, name)
        ok(f"已刷新 {snap}")
        ok(f"已刷新 {_rt_path(project_root, 'todo-list.md')}")
        print()
        return

    # Step 1: 检测已初始化
    if is_initialized(project_root) and not args.force:
        log(f"检测到 {project_root} 已初始化（初始化标记存在）")
        if not args.force:
            warn("已初始化，仅创建缺失内容。如需重新初始化请加 --force")
            print()

    # Step 1.5（v0.7.0 / 用户反馈第 1 项）：旧布局迁移 ——
    # .codex-plugin/ + .codex/ → 统一 .specflow/（非破坏；--no-migrate 可跳过）
    if not args.no_migrate:
        mig = migrate_legacy_layout(project_root)
        if mig['needed']:
            log("检测到旧布局（.codex-plugin/ 或 .codex/），迁移到统一 .specflow/ 目录...")
            if mig['moved']:
                ok(f"已迁移 {len(mig['moved'])} 个文件/目录到 .specflow/（非破坏移动）")
            for c in mig['conflicts']:
                warn(f"冲突未动: {c}")
            for k in mig['kept']:
                warn(f"旧目录仍有内容（含冲突文件），保留: {k}")
            if not mig['conflicts']:
                ok("旧布局目录已清空删除；此后所有读写均走 .specflow/")
            print()

    # Step 2: 交互（v0.6.0 / B5：--guided 走 8 问，否则保持 2 问最小模式）
    guided = getattr(args, 'guided', False)
    if guided or any([args.type_, args.lang, args.pkg_manager,
                      args.test_framework, args.stages, args.strictness]):
        env_info_pre = _run_env_scanner(project_root)
        guided_info = ask_guided_info(project_root, args, env_info_pre)
        project_name = guided_info['name']
        author = guided_info['author']
        log(f"项目名: {project_name}")
        log(f"作者: {author}")
    elif args.name and args.author:
        project_name = args.name
        author = args.author
        log(f"项目名: {project_name}")
        log(f"作者: {author}")
        guided_info = None
    else:
        project_name, author = ask_minimal_info(project_root, args)
        guided_info = None

    # Step 3: 收集变量
    log("收集环境变量...")
    variables = collect_variables(project_root, project_name, author)
    ok(f"项目名: {variables['project.name']}")
    ok(f"作者: {variables['env.USERNAME']} <{variables['env.USEREMAIL']}>")
    ok(f"主语言: {variables['lang.primary']}")
    ok(f"OS: {variables['os.name']}")
    ok(f"Shell: {variables['os.shell']}")
    ok(f"Git 分支: {variables['git.branch']}")

    # Step 4: 渲染模板
    print()
    log("渲染模板并写入项目...")
    if args.dry_run:
        for tpl_rel, target_rel in TEMPLATES:
            target_path = project_root / target_rel
            if target_path.exists():
                print(f"  (dry-run) 跳过已存在: {target_rel}")
            else:
                print(f"  (dry-run) 将创建: {target_rel}")
        return

    created, skipped, backup_dir = render_templates(variables, project_root, force=args.force)

    # Step 4.1（v0.7.1 / 用户实测反馈）：确保已有 .gitignore 忽略 .specflow/。
    # 模板仅在 .gitignore 不存在时生成；已有项目同样需要忽略运行时产物（幂等）。
    ensure_specflow_gitignore(project_root)

    if skipped:
        print()
        log(f"已跳过 {len(skipped)} 个已存在文件（使用 --force 可覆盖）:")
        for s in skipped:
            print(f"  - {s}")

    if backup_dir:
        warn(f"已备份原文件到 {backup_dir.name}/")

    # Step 4.5（v0.4.0 / A4）：已有项目扫描 → 快照 + TODO 清单
    print()
    if is_existing_project(project_root):
        log("检测到已有项目特征（依赖清单/源码目录），执行项目扫描...")
        env_info = _run_env_scanner(project_root)
        snap = write_project_snapshot(project_root, env_info, project_name)
        ok(f"项目快照: {snap}")
        ok(f"TODO 清单: {_rt_path(project_root, 'todo-list.md')}")
    else:
        log("空白项目：跳过项目扫描（--refresh 可随时补跑）")

    # Step 4.6（v0.4.0 / B3）：default workflow agent
    # v0.6.0（B5）：引导式选择的阶段清单优先（--stages / 交互第 7 问）
    if guided_info and guided_info.get('stages'):
        create_default_agent(project_root, stages=guided_info['stages'])
    else:
        create_default_agent(project_root)

    # Step 4.7（v0.6.0 / B5 + B1）：引导式答案落盘 ——
    # vars.yaml（doc-parser 变量层最高优先级）+ test-executor.json（真实测试门禁）
    if guided_info:
        _write_guided_outputs(project_root, guided_info)

    # Step 5: git 初始化 + hooks
    print()
    log("git 初始化与 hooks 安装...")
    init_git_and_hooks(project_root, args)

    # Step 6: 验证
    print()
    log("验证...")
    if verify_initialization(project_root):
        ok("验证通过，项目已就绪")
    else:
        warn("部分文件未创建，请检查")

    # Step 7: 输出指引
    print_next_steps(project_root)


if __name__ == '__main__':
    main()
