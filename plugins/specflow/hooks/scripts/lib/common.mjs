/**
 * common.mjs — specflow hook 脚本公共库（零依赖，Node 18+）
 *
 * 约定：
 *   - PLUGIN_ROOT：优先取环境变量（插件模式由 Codex 注入），否则从脚本位置自定位
 *     hooks/scripts/lib/common.mjs → 上溯 3 级 = 插件根
 *   - PROJECT_ROOT（会话项目目录）：优先 stdin 输入的 cwd，否则 process.cwd()
 *   - Python：python3 → python → 常见绝对路径（受限 PATH 兼容）→ py -3，探测后缓存
 *   - 项目目录（v0.7.0）：统一 .specflow/，旧项目自动回退 .codex-plugin/.codex（sfPaths）
 *   - 输出契约：command hook stdout 输出单个 JSON 对象（Codex hooks 协议）
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 插件根目录（hooks/scripts/lib/ 上溯 3 级） */
export const PLUGIN_ROOT = process.env.PLUGIN_ROOT
  ? resolve(process.env.PLUGIN_ROOT)
  : resolve(__dirname, '..', '..', '..');

// ─────────────────────────────────────────────
// v0.7.0（用户反馈第 1 项）：项目级目录解析 —— 与 scripts/lib/sfpaths.py 同语义
//   .specflow 存在 → 新布局；否则有旧布局痕迹（.codex-plugin/ 或含运行时文件的 .codex/）
//   → legacy；否则默认新布局
// ─────────────────────────────────────────────

const SF_DIR = '.specflow';
// ⚠ 与 scripts/lib/sfpaths.py、mcp/lib/sf-paths.js 的 RUNTIME_MARKERS 保持一致
// （v0.7.1：补齐 7 个此前遗漏的运行时文件，三处清单曾有漂移 —— 极端场景下
//  hooks 与 Python 扫描器会判定出不同布局，读写分裂到两个目录）
const RUNTIME_MARKERS = [
  '.initialized', 'hooks-state.json', 'todo-state.json', 'todo-resolved.json',
  'todo-cache.json', 'events.jsonl', 'hook-audit.json', 'env-scan.json',
  'parsed-config.json', 'parse-cache.json', 'project-snapshot.json',
  'todo-list.md', 'test-executor.json', 'test-report.json', 'precommit-report.json',
  'privacy-audit.json', 'last-redaction.json', 'loaded-sections.json',
  'prompt-trace.json', 'session-end.json', 'output-check.json',
  'workflow-state',
];

function isLegacyRuntimeDir(root) {
  try {
    const d = resolve(root, '.codex');
    if (!existsSync(d)) return false;
    return RUNTIME_MARKERS.some(m => existsSync(resolve(d, m)));
  } catch { return false; }
}

export function layoutOf(projectRoot) {
  if (existsSync(resolve(projectRoot, SF_DIR))) return 'new';
  if (existsSync(resolve(projectRoot, '.codex-plugin')) || isLegacyRuntimeDir(projectRoot)) return 'legacy';
  return 'new';
}

/** 项目级配置文件路径（config.md / vars.yaml / languages/、agents/） */
export function configPath(projectRoot, name) {
  const rel = layoutOf(projectRoot) === 'legacy' ? '.codex-plugin' : SF_DIR;
  return resolve(projectRoot, rel, name);
}

/** 项目级运行时状态文件路径（todo-state.json / events.jsonl / ...） */
export function runtimePath(projectRoot, name) {
  const rel = layoutOf(projectRoot) === 'legacy' ? '.codex' : SF_DIR;
  return resolve(projectRoot, rel, name);
}

/** 运行时目录名（用于面向用户的提示文本，避免 legacy 项目被误导） */
export function runtimeDirName(projectRoot) {
  return layoutOf(projectRoot) === 'legacy' ? '.codex' : SF_DIR;
}

/** 读取 stdin 全量文本（Codex 把 hook 输入 JSON 写到 stdin） */
export function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** 解析 hook 输入；raw 为空或非法时返回 {} */
export function parseInput() {
  const raw = readStdin();
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { _parse_error: true, _raw: raw.slice(0, 500) };
  }
}

/** 解析输入或退回空对象（永不抛异常） */
export function safeJsonParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** 项目根：stdin.cwd > 环境变量 > 进程 cwd */
export function projectRootOf(input) {
  if (input && typeof input.cwd === 'string' && input.cwd) return resolve(input.cwd);
  if (process.env.SPECFLOW_PROJECT_ROOT) return resolve(process.env.SPECFLOW_PROJECT_ROOT);
  return process.cwd();
}

let _python = null;
/** 探测可用的 Python 解释器（v0.7.0：受限 PATH 兼容 —— 补常见绝对路径）
 *  v0.7.1：SPECFLOW_PY 环境变量覆盖与 sf.sh 同语义（pyenv/conda 等非 PATH 场景，
 *  此前仅 sf.sh 认该变量，hooks 调 Python 时被忽略 —— 探测口径不一致） */
export function findPython() {
  if (_python) return _python;
  // PATH 内命令优先；受限 PATH（GUI/IDE 发起的 git hook）下补常见安装路径；
  // py -3（Windows 启动器）最后；SPECFLOW_PY 显式指定时置于链首
  // v0.7.2：Unix 绝对路径仅在非 Windows 平台尝试（避免 Windows 上输出
  // "tried /usr/bin/python3" 误导信息；Windows 上 py -3 比 python3 更常见）
  const override = (process.env.SPECFLOW_PY || '').trim();
  const isWindows = process.platform === 'win32';
  const unixAbsPaths = isWindows ? [] : [
    '/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3',
    '/usr/bin/python', '/usr/local/bin/python'];
  const candidates = [
    ...(override ? [override.split(/\s+/).filter(Boolean)] : []),
    ...['python3', 'python', ...unixAbsPaths, 'py -3'].map(c => c.split(' ')),
  ];
  for (const parts of candidates) {
    try {
      const r = spawnSync(parts[0], [...parts.slice(1), '-c', 'print(1)'], { encoding: 'utf8', timeout: 5000 });
      if (r.status === 0) { _python = parts; return _python; }
    } catch { /* try next */ }
  }
  _python = null;
  return null;
}

/** 运行插件 scripts/lib/ 下的 Python 脚本；返回 {ok, stdout, stderr} */
export function runPythonLib(script, args, projectRoot, timeoutSec = 20) {
  const py = findPython();
  const scriptPath = resolve(PLUGIN_ROOT, 'scripts/lib', script);
  if (!py) return { ok: false, stderr: 'no python interpreter found (tried python3/python/py -3)', stdout: '' };
  if (!existsSync(scriptPath)) return { ok: false, stderr: `not found: ${scriptPath}`, stdout: '' };
  try {
    const r = spawnSync(py[0], [...py.slice(1), scriptPath, ...args], {
      encoding: 'utf8', cwd: projectRoot, timeout: timeoutSec * 1000,
      // v0.7.1：PYTHONDONTWRITEBYTECODE 避免在插件目录生成 __pycache__（git 噪音）
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    });
    return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' };
  } catch (e) {
    return { ok: false, stdout: '', stderr: String(e && e.message || e) };
  }
}

/** 把 JSON 写到项目运行时目录 <name>（自动建目录；v0.7.0 路径经 sfPaths） */
export function writeCodexState(projectRoot, name, data) {
  try {
    const dir = dirname(runtimePath(projectRoot, name));
    mkdirSync(dir, { recursive: true });
    writeFileSync(runtimePath(projectRoot, name), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

/** 读取项目运行时目录 <name>；不存在返回 null（v0.7.0 路径经 sfPaths） */
export function readCodexState(projectRoot, name) {
  try {
    const p = runtimePath(projectRoot, name);
    return existsSync(p) ? safeJsonParse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

/** 审计日志：项目运行时目录 hook-audit.json，保留最近 200 条（v0.7.0 路径经 sfPaths） */
export function appendAudit(projectRoot, entry) {
  try {
    const p = runtimePath(projectRoot, 'hook-audit.json');
    mkdirSync(dirname(p), { recursive: true });
    let list = [];
    if (existsSync(p)) { const parsed = safeJsonParse(readFileSync(p, 'utf8')); if (Array.isArray(parsed)) list = parsed; }
    list.push({ ts: new Date().toISOString(), ...entry });
    if (list.length > 200) list = list.slice(-200);
    writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch { return false; }
}

/** 按 Codex hooks 协议输出 JSON 到 stdout（唯一出口，保证格式合法） */
export function emitHookOutput(obj) {
  process.stdout.write(JSON.stringify(obj ?? {}));
}

/** 常量：阶段关键词表（与 docs/requirements/WORKFLOW.md 阶段对齐） */
export const STAGE_KEYWORDS = {
  'req-analysis': ['需求', 'PRD', '故事卡', '验收', 'requirement', 'user story'],
  'arch-design': ['架构', 'ADR', '模块拆分', '技术选型', 'architecture', 'design doc'],
  coding: ['实现', '写代码', '修bug', '修复', 'refactor', '重构', 'implement', 'coding'],
  review: ['评审', 'review', 'PR检查', 'code review'],
  testing: ['测试', 'test', '覆盖率', 'coverage', 'e2e', '集成测试'],
};

/** 从 prompt 文本检测工作流阶段 */
export function detectStage(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const p = prompt.toLowerCase();
  for (const [stage, kws] of Object.entries(STAGE_KEYWORDS)) {
    if (kws.some(k => p.includes(k.toLowerCase()))) return stage;
  }
  return null;
}

// ─────────────────────────────────────────────
// v0.8.0 智能提示机制：按需注入而非全量加载
// ─────────────────────────────────────────────

/**
 * 语言关键词表（v0.9.0：扩展到 13 语言）
 * 命中时提示用户可读取对应 features.md / anti-patterns.md
 */
export const LANG_KEYWORDS = {
  typescript: ['typescript', 'tsx', 'jest', 'vite', 'next.js', 'deno', 'bun',
               'interface ', 'type ', 'as const', 'satisfies', 'unknown', 'never'],
  python: ['python', 'pytest', 'django', 'flask', 'fastapi', 'pandas', 'numpy',
           'def ', 'import ', '__init__', 'dataclass', 'asyncio', 'await ', 'pyproject'],
  go: ['golang', 'go ', 'goroutine', 'channel', 'go.mod', 'go.sum',
       'func ', 'package main', 'interface{}', 'errgroup', 'context.'],
  java: ['java', 'jvm', 'spring', 'maven', 'gradle', 'junit',
         'public class', 'private ', 'Optional', 'Stream', 'record ', 'sealed'],
  // v0.9.0 新增 9 语言
  c: ['clang', 'gcc', 'malloc', 'free(', 'sizeof', 'printf', 'stddef', 'stdint',
      'pthread', 'FILE *', 'fopen'],
  cpp: ['c++', 'cpp', 'constexpr', 'namespace', 'std::', 'template', 'nullptr',
        'unique_ptr', 'shared_ptr', 'auto ', 'constexpr if', '<vector>'],
  csharp: ['c#', 'csharp', 'dotnet', '.net', 'linq', 'async task', 'async void', 'using system',
           'console.writeline', 'gethenvironmentvariable', 'task<'],
  javascript: ['javascript', 'js ', 'nodejs', 'node.js', 'es2022', 'esm',
               'require(', 'module.exports', 'console.log', 'promise', 'async function'],
  rust: ['rust', 'cargo', 'rustc', 'tokio', 'serde', 'borrow', 'lifetime',
         'impl ', 'trait ', 'unwrap', 'result<', 'option<', 'println!'],
  zig: ['zig', 'comptime', 'allocator', 'build.zig', 'orelse', 'catch',
        'pub fn', 'const =', 'var =', '@intcast', 'panic'],
  kotlin: ['kotlin', 'kmp', 'coroutine', 'suspend fun', 'data class', 'sealed class',
           'viewmodel', 'compose', 'gradle.kts', 'jvm'],
  shell: ['bash', 'shell', 'sh ', 'zsh', 'shellcheck', 'pipefail',
          '#!/bin/', 'set -e', 'chmod +x'],
  powershell: ['powershell', 'pwsh', 'ps1', 'cmdlet', 'write-output', 'write-host',
               'get-childitem', 'invoke-', '$erroractionpreference', '-whatif'],
};

/**
 * 反模式关键词表（命中时直接注入对应警告，不需用户主动查）
 * 每个条目：[模式, 语言, 反模式 ID, 警告摘要]
 */
export const ANTI_PATTERN_TRIGGERS = [
  // === TypeScript (6) ===
  [': any', 'typescript', 'no-implicit-any', '禁止用 any；确实无法定型时用 unknown + 类型守卫收窄'],
  ['as any', 'typescript', 'no-as-any', '禁止 as any；用 as + 类型守卫或泛型约束替代'],
  ['as unknown as', 'typescript', 'no-double-assertion', '禁止双重断言 as unknown as T；说明为何类型不兼容或重构边界'],
  ['@ts-ignore', 'typescript', 'no-ts-ignore', '禁止 @ts-ignore；用 @ts-expect-error + 一行原因注释'],
  ['catch (e)', 'typescript', 'no-implicit-any-catch', 'catch 子句变量需显式标注 unknown 而非依赖 any'],
  ['enum ', 'typescript', 'prefer-union-over-enum', '开放集合用 union string literal 而非 enum'],
  // === Python (6) ===
  ['=[]', 'python', 'no-mutable-default', '可变默认参数（=[]）会跨调用共享状态；用 None + 内部赋值'],
  ['={}', 'python', 'no-mutable-default-dict', '可变默认参数（={}）会跨调用共享状态；用 None + 内部赋值'],
  ['except:', 'python', 'no-bare-except', '禁止裸 except:；用 except Exception 或具体异常类型'],
  ['except Exception:\n    pass', 'python', 'no-swallow-exception', '不要空 pass 吞异常；至少 log 或 re-raise'],
  ['type:ignore', 'python', 'no-blind-ignore', 'type:ignore 需带具体错误码（如 type:ignore[assignment]）'],
  ['global ', 'python', 'avoid-global-mutation', '避免模块级可变全局；用 dataclass 单例或依赖注入'],
  // === Go (5) ===
  ['interface{}', 'go', 'prefer-any', 'Go 1.18+ 用 any 替代 interface{}'],
  ['map[string]interface{}', 'go', 'no-string-key-any-map', '避免 map[string]any 作领域模型；定义 struct'],
  ['func() {', 'go', 'no-bare-goroutine', '裸 go func() 无错误处理与 panic 恢复；用 errgroup'],
  ['fmt.Sprintf', 'go', 'errors-with-wrap', '错误链用 fmt.Errorf("...: %w", err) 而非 Sprintf'],
  ['_ = err', 'go', 'no-discarded-error', '禁止 _ = err 丢弃错误；显式处理或 wrap'],
  // === Java (5) ===
  ['.get()', 'java', 'no-optional-get', 'Optional.get() 抛 NoSuchElementException；用 orElse/orElseThrow/ifPresent'],
  ['Optional<', 'java', 'no-optional-field', 'Optional 不应用作字段或参数；仅作返回值'],
  ['new Date()', 'java', 'no-legacy-date', '禁止 new Date() / Calendar；用 java.time.Instant/LocalDateTime'],
  ['Executors.newCachedThreadPool', 'java', 'no-unbounded-pool', '禁止 newCachedThreadPool（无界）；用 ThreadPoolExecutor 显式有界'],
  ['synchronized ', 'java', 'prefer-juc', '优先用 java.util.concurrent 而非 synchronized'],
  // === C (5) v0.9.2 新增 ===
  ['gets(', 'c', 'no-gets', 'gets 已从 C11 移除（缓冲区溢出）；用 fgets(buf, size, stdin)'],
  ['strcpy(', 'c', 'no-strcpy', 'strcpy 无边界检查；用 strncpy + 显式终止符或 strlcpy'],
  ['strcat(', 'c', 'no-strcat', 'strcat 无边界检查；用 strncat 或自己管理缓冲区'],
  ['sprintf(', 'c', 'no-sprintf', 'sprintf 无边界检查；用 snprintf(buf, size, fmt, ...)'],
  ['malloc(strlen', 'c', 'no-malloc-strlen-no-null', 'malloc(strlen(s)) 忘记 +1 给 \\0；用 strlen(s) + 1'],
  // === C++ (5) v0.9.2 新增 ===
  ['using namespace std;', 'cpp', 'no-using-namespace-std', '禁止 using namespace std（污染全局命名空间）；用 std:: 前缀'],
  ['std::move(', 'cpp', 'no-move-on-return', 'return std::move(x) 抑制 RVO；直接 return x;'],
  ['catch (...)', 'cpp', 'no-catch-all', 'catch (...) 吞掉所有异常无法处理；捕获具体类型'],
  ['new ', 'cpp', 'no-raw-new', '避免裸 new；用 make_unique/make_shared + RAII'],
  ['shared_ptr<T> p(new T', 'cpp', 'no-shared-ptr-raw-new', 'shared_ptr 接管裸 new 易泄漏；用 make_shared<T>(...)'],
  // === C# (5) v0.9.2 新增 ===
  ['async void', 'csharp', 'no-async-void', 'async void 异常无法捕获、调用方无法 await；用 async Task'],
  ['.Result', 'csharp', 'no-result-block', 'task.Result 死锁风险；用 await task'],
  ['.Wait()', 'csharp', 'no-wait-block', 'task.Wait() 死锁风险；用 await task'],
  ['GC.Collect(', 'csharp', 'no-manual-gc', 'GC.Collect 几乎总是错误；GC 自调度'],
  ['throw new Exception(', 'csharp', 'no-throw-base-exception', '禁止 throw new Exception；用具体异常类型'],
  // === JavaScript (5) v0.9.2 新增 ===
  [' == ', 'javascript', 'no-loose-equal', '用 === 严格相等避免强制类型转换坑'],
  ['var ', 'javascript', 'no-var', '用 let/const 块作用域替代 var 函数作用域'],
  ['eval(', 'javascript', 'no-eval', 'eval 注入风险 + 性能差；用 JSON.parse 或 Function 构造'],
  ['document.write(', 'javascript', 'no-document-write', 'document.write 阻塞解析 + 覆盖文档；用 DOM API'],
  ['new Promise(function', 'javascript', 'no-promise-constructor-async', 'Promise 构造器不处理异步异常；用 async/await'],
  // === Rust (5) v0.9.2 新增 ===
  ['.unwrap()', 'rust', 'no-unwrap', 'unwrap 在 None/Err 时 panic；用 ? / unwrap_or / unwrap_or_else'],
  ['.clone()', 'rust', 'avoid-clone', '优先用引用；仅在编译器要求时 clone'],
  ['Box<dyn ', 'rust', 'prefer-generics', 'Box<dyn Trait> 动态分发有开销；泛型静态分发优先'],
  ['unsafe ', 'rust', 'no-unsafe-without-comment', '每个 unsafe 块需注释说明为何安全'],
  ['tokio::main', 'rust', 'no-blocking-in-async', 'tokio::main 上阻塞调用阻塞 runtime 线程；用 spawn_blocking'],
  // === Zig (5) v0.9.2 新增 ===
  ['catch unreachable', 'zig', 'no-catch-unreachable', 'catch unreachable 掩盖错误；仅在证明不可能时用'],
  ['orelse unreachable', 'zig', 'no-orelse-unreachable', 'orelse unreachable 掩盖错误；用 orelse default_value'],
  ['@intCast(', 'zig', 'no-intcast-no-check', '@intCast 无范围检查会截断 UB；检查或用 std.math.cast'],
  ['std.debug.print', 'zig', 'no-debug-print-in-release', 'std.debug.print 仅 debug 输出；release 用 std.log'],
  ['allocator.alloc(', 'zig', 'no-alloc-without-defer', 'allocator.alloc 后必须 defer allocator.free；否则泄漏'],
  // === Kotlin (5) v0.9.2 新增 ===
  ['!!', 'kotlin', 'no-null-assertion', '!! 是代码异味；用 ? / ?: / smart cast'],
  ['GlobalScope.', 'kotlin', 'no-global-scope', 'GlobalScope 无结构化并发；用 viewModelScope/lifecycleScope'],
  ['runBlocking', 'kotlin', 'no-runblocking-in-prod', 'runBlocking 阻塞线程；用协程作用域'],
  ['lateinit var', 'kotlin', 'no-lateinit-if-possible', 'lateinit 延迟初始化易 NPE；优先用 lazy 或可空类型'],
  ['isInstance ', 'kotlin', 'no-explicit-isinstance', '用 is + smart cast 替代 isInstance + as'],
  // === Shell (5) v0.9.2 新增 ===
  ['$(ls', 'shell', 'no-ls-in-for', 'for x in $(ls) 文件名含空格出错；用通配符或 find -print0'],
  ['eval ', 'shell', 'no-eval', 'eval 注入风险；用参数化或 bash -c'],
  ['function ', 'shell', 'no-function-keyword', 'function 关键字非 POSIX；用 foo() { }'],
  ['echo -e', 'shell', 'no-echo-e', 'echo -e 不跨平台；用 printf'],
  ['cd ', 'shell', 'no-cd-without-and', 'cd 失败仍执行后续；用 cd dir && cmd'],
  // === PowerShell (5) v0.9.2 新增 ===
  ['Write-Host ', 'powershell', 'no-write-host-for-output', 'Write-Host 不进管道；用 Write-Output 或直接输出'],
  ['Invoke-Expression', 'powershell', 'no-invoke-expression', 'Invoke-Expression 注入风险 + 性能差；用 & 调用'],
  ['cmd /c', 'powershell', 'no-cmd-c', 'cmd /c 调用破坏 PowerShell 原生语义；用原生 cmdlet'],
  ['$ErrorActionPreference = "SilentlyContinue"', 'powershell', 'no-silently-continue', '吞所有错误；用 try/catch 或 scope-local 设置'],
  ['Get-Content ', 'powershell', 'no-getcontent-without-raw', '大文件逐行读慢；用 -Raw 或 [IO.File]::ReadAllText'],
];

/**
 * 智能注入策略：检测 prompt 中是否包含反模式 / 语言关键词 / 阶段关键词，
 * 返回应注入的内容（仅未注入过的）
 *
 * @param {string} prompt - 用户 prompt
 * @param {object} hooksState - 当前 hooks-state（用于去重）
 * @returns {object} { stage, language, antiPatterns, suggestFiles }
 */
export function smartInject(prompt, hooksState = {}) {
  if (!prompt || typeof prompt !== 'string') {
    return { stage: null, language: null, antiPatterns: [], suggestFiles: [] };
  }
  const lower = prompt.toLowerCase();
  const result = { stage: null, language: null, antiPatterns: [], suggestFiles: [] };

  // 1. 阶段检测
  result.stage = detectStage(prompt);

  // 2. 语言检测（取命中数最多的语言；v0.9.2：同命中数时优先更长关键词的语言）
  //    修复 v0.9.1 bug：javascript 关键词命中时 java 也命中（子串），
  //    sort 后取第一个可能误选 java。v0.9.2 加权重：长关键词命中权重更高
  const langHits = {};
  const langWeightedHits = {};
  for (const [lang, kws] of Object.entries(LANG_KEYWORDS)) {
    const matchedKws = kws.filter(k => lower.includes(k.toLowerCase()));
    langHits[lang] = matchedKws.length;
    // v0.9.2：权重 = 命中关键词长度之和（长关键词权重更高，避免 javascript 被 java 抢走）
    langWeightedHits[lang] = matchedKws.reduce((sum, k) => sum + k.length, 0);
  }
  const topLang = Object.entries(langHits).sort((a, b) => {
    // 先按命中次数降序
    if (b[1] !== a[1]) return b[1] - a[1];
    // v0.9.2：同命中数时按权重（关键词长度之和）降序——javascript (10 chars) > java (4 chars)
    return (langWeightedHits[b[0]] || 0) - (langWeightedHits[a[0]] || 0);
  })[0];
  if (topLang && topLang[1] > 0) result.language = topLang[0];

  // 3. 反模式检测（v0.9.1：必须语言匹配才触发，避免跨语言误报）
  //    v0.9.0 bug：`new Date()` 标记为 java 反模式，但 JS 也用；`enum ` 标记为 TS 反模式，
  //    但 Java/Kotlin/C# 也用 enum。v0.9.1 修复：只在检测到的语言与反模式所属语言一致时触发
  const injectedAnti = new Set(hooksState.injected_anti_patterns || []);
  for (const [pattern, lang, id, warn] of ANTI_PATTERN_TRIGGERS) {
    if (prompt.includes(pattern) && !injectedAnti.has(id)) {
      // v0.9.1：语言过滤——若已检测到语言且与反模式所属语言不符，跳过
      // 例外：若未检测到任何语言（result.language === null），仍触发（用户可能只是在问通用问题）
      if (result.language && result.language !== lang) continue;
      result.antiPatterns.push({ id, lang, pattern, warn });
      injectedAnti.add(id);
    }
  }

  // 4. 建议文件（按需读取提示，不主动注入内容）
  const injectedFiles = new Set(hooksState.injected_files || []);
  if (result.language && !injectedFiles.has(`templates/coding/${result.language}/features.md`)) {
    result.suggestFiles.push({
      path: `templates/coding/${result.language}/features.md`,
      reason: `检测到 ${result.language} 关键词，可读取该语言的特性清单`,
    });
  }
  if (result.stage && !injectedFiles.has(`rules/stage-${result.stage}.md`)) {
    result.suggestFiles.push({
      path: `rules/stage-${result.stage}.md`,
      reason: `检测到 ${result.stage} 阶段关键词，将注入阶段规则摘要`,
    });
  }

  return result;
}

/**
 * token 预算追踪：估算字符串 token 数（粗略 4 字符 = 1 token）
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * 生成索引摘要（用于 session-start）：列出可用资源 + 获取方式，不注入具体内容
 * v0.9.1：补全 v0.9.0 工具链衔接与错误知识库的索引项
 */
export function buildResourceIndex(projectRoot, primaryLang, currentStage) {
  const lines = [
    '## specflow 资源索引（按需读取，避免全量加载）',
    '',
    '### 阶段规则（rules/stage-<stage>.md）',
    '- req-analysis / arch-design / coding / review / testing',
    '- 获取方式：UserPromptSubmit hook 自动检测 prompt 阶段关键词并注入摘要；',
    '  也可手动读取：`Read rules/stage-coding.md`',
    '',
    '### 语言规范（templates/coding/<lang>/）',
    '- 支持 13 语言：typescript / javascript / python / go / java / kotlin /',
    '  c / cpp / csharp / rust / zig / shell / powershell',
    '- 每个语言含 5 份文档：spec.md（总览）/ features.md（特性）/ standards.md（编码规范）/',
    '  anti-patterns.md（反模式与易错点）/ docs.md（文档规范）',
    '- 当前主语言: ' + (primaryLang || '未检出'),
    primaryLang ? `- 当 prompt 含 ${primaryLang} 关键词时，hook 会提示读取对应 features.md` : '',
    '- 反模式：当 prompt 出现已知反模式（如 `: any` / `interface{}` / `Optional.get()`），',
    '  hook 会**直接注入警告**（v0.9.1：仅当检测到的语言与反模式所属语言一致时触发）',
    '',
    '### 工具链配置（templates/coding/toolchains.json）v0.9.0',
    '- 10 个工具链：java-jdk / node-js / rust-cargo / go-toolchain / python-pip /',
    '  c-cpp-toolchain / dotnet / zig-toolchain / android-sdk / shell-toolchain',
    '- 语言与工具链双向映射：项目根有特征文件 → 关联工具链 → 提示语言规则；',
    '  prompt 含语言关键词但无特征文件 → 提示用户可能缺少工具链配置',
    '- 工具链内嵌 commonErrors：工具输出命中已知错误时自动注入修复方案',
    '',
    '### 错误知识库（.specflow/error-kb/）v0.9.0',
    '- 项目本地错误记录：`.specflow/error-kb/<lang>/*.md`（含 frontmatter: pattern/cause/fix）',
    '- 顶层 .md 视为跨语言通用记录；按语言分子目录便于组织',
    '- PostToolUse hook 自动匹配工具输出与知识库，命中时注入修复方案',
    '- 用户可手动创建 .md 文件记录项目特定错误（参见 docs/guides/error-kb.md）',
    '- 记录原则：**只记录模型默认不知道的内容**（项目特定踩坑、版本兼容性问题等），',
    '  不复制通用文档',
    '',
    '### slash 命令（prompts/*.md）',
    '- 主线: /req-analysis /arch-design /coding /review /testing',
    '- 任务: /new-feature /bugfix /design-* /unit-test /integration-test',
    '- 工具: /setup-specflow /todo /workflow /agent /sanitize /config',
    '',
    '### MCP 工具（按需调用）',
    '- mcp__hook-orchestrator__* 查询 hook 审计 / 事件总线 / 工作流状态',
    '- mcp__config-reader__* 读配置键',
    '- mcp__env-scanner__* 查环境',
    '- mcp__privacy-guard__* 扫敏感信息',
    '',
    '### 设计原则',
    '- **不主动注入大段内容**：只注入索引 + 关键警告',
    '- **按需读取**：用户问到具体语言特性/阶段规则时，agent 主动 Read 对应文件',
    '- **去重**：同一会话内已注入的文件不再重复注入（hooks-state.injected_files 记录）',
    '- **token 预算**：单次注入上限 ~2000 字符，累计上限 ~8000 字符',
  ].filter(Boolean);
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// v0.9.0 语言-工具链衔接 + 错误知识库
// ─────────────────────────────────────────────

let _toolchainsCache = null;

/**
 * 加载 toolchains.json（仓库根 templates/coding/toolchains.json）
 * 缓存避免重复读盘
 */
export function loadToolchains() {
  if (_toolchainsCache) return _toolchainsCache;
  const path = resolve(PLUGIN_ROOT, 'templates/coding/toolchains.json');
  if (!existsSync(path)) {
    _toolchainsCache = { toolchains: [] };
    return _toolchainsCache;
  }
  try {
    _toolchainsCache = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    _toolchainsCache = { toolchains: [] };
  }
  return _toolchainsCache;
}

/**
 * 检测项目根目录下存在的工具链特征文件
 * 返回匹配的 toolchain 数组
 * v0.9.1：支持浅层递归（最多 2 级深度），解决 v0.9.0 只读顶层导致
 *         src/MyApp/MyApp.csproj / packages/api/package.json 无法检测的问题
 */
export function detectToolchains(projectRoot) {
  const { toolchains } = loadToolchains();
  const matched = [];
  for (const tc of toolchains) {
    const hitFiles = tc.detect.files.filter(f => {
      // 支持 glob 简单匹配（*.csproj 等）
      if (f.startsWith('*.')) {
        const ext = f.slice(1);  // 含点号，如 ".csproj"
        return existsSyncShallowGlob(projectRoot, ext, 2);
      }
      // 普通文件名：先查顶层，再浅层递归
      if (existsSync(join(projectRoot, f))) return true;
      return existsSyncShallowName(projectRoot, f, 2);
    });
    if (hitFiles.length > 0) {
      matched.push({ ...tc, matched_files: hitFiles });
    }
  }
  return matched;
}

/**
 * 浅层递归查找匹配扩展名的文件（默认 2 级深度）
 */
function existsSyncShallowGlob(dir, ext, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return false;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(ext)) return true;
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && e.name !== 'dist' && e.name !== 'build' && e.name !== 'target') {
      if (existsSyncShallowGlob(join(dir, e.name), ext, maxDepth, currentDepth + 1)) return true;
    }
  }
  return false;
}

/**
 * 浅层递归查找具名文件（如 go.mod / Cargo.toml）
 */
function existsSyncShallowName(dir, name, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return false;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return false; }
  for (const e of entries) {
    if (e.isFile() && e.name === name) return true;
    if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.git' && e.name !== 'dist' && e.name !== 'build' && e.name !== 'target') {
      if (existsSyncShallowName(join(dir, e.name), name, maxDepth, currentDepth + 1)) return true;
    }
  }
  return false;
}

/**
 * 反向映射：给定语言名，返回对应的所有工具链
 */
export function toolchainsForLanguage(lang) {
  if (!lang) return [];
  const { toolchains } = loadToolchains();
  return toolchains.filter(tc => tc.languages.includes(lang));
}

/**
 * 在 tool_response / 错误日志中匹配已知工具链错误模式
 * 返回匹配的修复方案数组（用于注入）
 */
export function matchKnownErrors(text, toolchains = []) {
  if (!text || toolchains.length === 0) return [];
  const matches = [];
  for (const tc of toolchains) {
    for (const err of tc.commonErrors || []) {
      if (text.includes(err.pattern)) {
        matches.push({
          toolchain: tc.name,
          pattern: err.pattern,
          cause: err.cause,
          fix: err.fix,
        });
      }
    }
  }
  return matches;
}

/**
 * 错误知识库路径：<运行时目录>/error-kb/<lang>/ 或全局 <运行时目录>/error-kb/
 * 用户可手动添加 .md 文件记录项目特定错误（含 frontmatter: pattern/cause/fix/lang）
 */
export function errorKbDir(projectRoot, lang = null) {
  const base = runtimePath(projectRoot, 'error-kb');
  return lang ? join(base, lang) : base;
}

/**
 * 递归遍历目录，返回所有 .md 文件路径（深度上限避免过深遍历）
 * v0.9.1：修复 v0.9.0 的 matchLocalErrorKb 不递归子目录 bug——
 *   .specflow/error-kb/<lang>/ 下的 .md 文件原来无法被匹配
 */
function walkMdFiles(dir, maxDepth = 3, currentDepth = 0) {
  if (currentDepth >= maxDepth) return [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const e of entries) {
    const fullPath = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...walkMdFiles(fullPath, maxDepth, currentDepth + 1));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * v0.9.1：健壮的 frontmatter 解析（支持 CRLF / 转义引号 / 单引号 / 无引号）
 * v0.9.0 的正则 /[^"\n]+/ 在引号转义与 CRLF 下会失败
 */
function parseFrontmatter(content) {
  // 支持 LF 与 CRLF；frontmatter 块以 --- 开始，下一个 --- 结束
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];
  const result = {};
  for (const line of fm.split(/\r?\n/)) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    // 去除外层引号（单或双）
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
      // 反转义内部引号（仅双引号场景）
      value = value.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    result[key] = value;
  }
  return result;
}

/**
 * 加载并匹配项目本地的错误知识库（.specflow/error-kb/ 下的 .md 文件，递归子目录）
 * v0.9.1：递归子目录 + 健壮 frontmatter 解析
 *
 * 知识库文件格式（Markdown + frontmatter）：
 * ---
 * pattern: "EADDRINUSE"
 * cause: 端口被占用
 * fix: lsof -i :PORT 找进程；kill PID 或换端口
 * lang: javascript
 * recorded_at: 2026-09-03T...
 * source: 用户实测记录
 * ---
 * 自由正文（可包含更详细的诊断步骤、相关链接等）
 *
 * @param {string} projectRoot
 * @param {string} text - 待匹配的文本（如工具输出）
 * @param {string|null} lang - 优先匹配该语言目录；null 则搜索全部
 */
export function matchLocalErrorKb(projectRoot, text, lang = null) {
  if (!text) return [];
  const matches = [];
  const kbBase = errorKbDir(projectRoot);
  if (!existsSync(kbBase)) return [];

  // v0.9.1：搜索策略——
  //   1. 若指定 lang：先递归 <lang>/ 子目录，再递归 kbBase 顶层 .md（顶层文件视为跨语言通用）
  //   2. 若未指定 lang：递归整个 kbBase（含所有 <lang>/ 子目录与 _global/）
  const searchRoots = lang
    ? [join(kbBase, lang), kbBase]
    : [kbBase];

  const seenFiles = new Set();
  for (const root of searchRoots) {
    if (!existsSync(root)) continue;
    // v0.9.1 搜索策略：
    //   - lang 指定时，对 kbBase 只读顶层 .md（不递归子目录，避免重复匹配 <lang>/ 下文件）
    //   - lang 未指定时，对 kbBase 递归（含所有子目录与 _global/）
    //   - 对 <lang>/ 子目录本身，永远递归（用户在该目录下可能再分日期子目录等）
    const isKbBaseWithLang = (root === kbBase && lang);
    const files = isKbBaseWithLang
      ? readdirOnlyMd(root)  // 仅顶层 .md（跨语言通用记录）
      : walkMdFiles(root, 3);
    for (const path of files) {
      if (seenFiles.has(path)) continue;
      seenFiles.add(path);
      try {
        const content = readFileSync(path, 'utf8');
        const fm = parseFrontmatter(content);
        if (!fm) continue;
        const pattern = fm.pattern;
        if (pattern && matchPattern(text, pattern, fm.matchStrategy || 'exact', parseInt(fm.fuzzyThreshold || '3'))) {
          matches.push({
            source: 'local_kb',
            file: path.replace(kbBase + '/', '').replace(kbBase + '\\', ''),
            pattern,
            cause: fm.cause || '(未记录)',
            fix: fm.fix || '(未记录)',
            lang: fm.lang || lang || 'unknown',
            matchStrategy: fm.matchStrategy || 'exact',
          });
        }
      } catch {}
    }
  }
  return matches;
}

/**
 * 仅读取目录顶层的 .md 文件（不递归）
 */
function readdirOnlyMd(dir) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isFile() && e.name.endsWith('.md'))
    .map(e => join(dir, e.name));
}

/**
 * 记录新错误到本地知识库（v0.9.0 自我提升能力）
 * v0.9.1：修复文件名哈希冲突（用 sha1 替代 slice+sanitize）+ frontmatter 转义问题
 *
 * 文件名：<timestamp>-<sha1-prefix>.md（避免 Unicode 模式全部变 _ 导致冲突）
 *
 * @param {string} projectRoot
 * @param {object} entry - { pattern, cause, fix, lang, source }
 * @returns {string|null} 写入的文件路径，失败返回 null
 */
export function recordErrorToKb(projectRoot, { pattern, cause, fix, lang, source = 'auto_detected' }) {
  if (!pattern) return null;
  const dir = errorKbDir(projectRoot, lang || 'unknown');
  try { mkdirSync(dir, { recursive: true }); } catch { return null; }
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  // v0.9.1：用 sha1 前 12 位作 hash，避免 Unicode 模式（如「依赖未安装」）全部变 _ 导致冲突
  let patternHash;
  try {
    patternHash = createHash('sha1').update(pattern).digest('hex').slice(0, 12);
  } catch {
    // 回退：旧逻辑（截断 + sanitize），仅在没有 crypto 时
    patternHash = pattern.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
  }
  const filename = `${ts}-${patternHash}.md`;
  const path = join(dir, filename);

  // v0.9.1：frontmatter 值统一用双引号包裹 + 转义内部双引号，reader 端 parseFrontmatter 能正确反转义
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const content = `---
pattern: "${esc(pattern)}"
cause: "${esc(cause || '(待补充)')}"
fix: "${esc(fix || '(待补充)')}"
lang: ${lang || 'unknown'}
recorded_at: ${new Date().toISOString()}
source: ${source}
---

# 错误记录：${pattern}

## 上下文
（自动捕获，可手动补充触发场景）

## 修复
${fix || '(待补充)'}

## 关联文件
（自动捕获时可附上出错的文件路径）
`;
  try {
    writeFileSync(path, content, 'utf8');
    return path;
  } catch {
    return null;
  }
}

/**
 * 智能提示 v0.9.0：扩展 smartInject 加入工具链检测
 * 在原 smartInject 基础上追加 toolchains / knownErrors 字段
 *
 * 两种工具链提示：
 * 1. 项目根有特征文件 → detected（matched_files 非空）
 * 2. prompt 含语言关键词但无对应特征文件 → suggested（matched_files 空，note 提示）
 */
export function smartInjectV2(prompt, hooksState = {}, projectRoot = null) {
  const base = smartInject(prompt, hooksState);
  const result = { ...base, toolchains: [] };

  if (!projectRoot) return result;

  // 1. 检测项目根存在的工具链（基于特征文件）
  const detected = detectToolchains(projectRoot);
  const detectedNames = new Set(detected.map(tc => tc.name));
  for (const tc of detected) {
    result.toolchains.push({
      name: tc.name,
      displayName: tc.displayName,
      languages: tc.languages,
      matched_files: tc.matched_files,
      relation: 'detected',
    });
  }

  // 2. 反向：prompt 检测到的语言，其工具链未在 detected 中 → suggested
  if (base.language) {
    const langTcs = toolchainsForLanguage(base.language);
    for (const tc of langTcs) {
      if (!detectedNames.has(tc.name)) {
        result.toolchains.push({
          name: tc.name,
          displayName: tc.displayName,
          languages: tc.languages,
          relation: 'suggested',
          note: `语言 ${base.language} 对应工具链，但项目根未检测到特征文件（${tc.detect.files.slice(0, 3).join(', ')} 等）`,
        });
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────
// v0.9.2 错误自动捕获机制
// ─────────────────────────────────────────────

/**
 * 错误检测关键词表——用于识别工具输出是否含错误
 * 命中时返回提取的 pattern（供后续记录到知识库）
 */
const ERROR_INDICATORS = [
  /error:\s*(.{5,80})/i,           // error: <message>
  /Error:\s*(.{5,80})/,            // Error: <message>
  /ERROR\]?\s*(.{5,80})/,          // ERROR] <message>
  /fatal:\s*(.{5,80})/i,           // fatal: <message>
  /exception\s*(.{5,80})/i,        // exception <message>
  /failed\s*(.{5,80})/i,           // failed <message>
  /cannot\s+(.{5,60})/i,           // cannot <action>
  /undefined\s+(.{5,40})/i,        // undefined <reference>
  /not\s+found\s*(.{5,60})/i,      // not found <thing>
];

/**
 * 检测工具输出中是否含错误模式
 * 返回 { pattern, context } 或 null
 *   - pattern: 提取的错误特征字符串（用于知识库匹配，应短而独特）
 *   - context: 错误上下文（前后各 100 字符，便于用户判断）
 *
 * v0.9.2 优化：pattern 提取策略——
 *   1. 优先取错误码（如 EADDRINUSE / E404 / CS0234 等大写字母+数字组合）
 *   2. 次选取错误关键词后的第一个词组（截断到 30 字符，避免 URL 等长串）
 *   3. 清理：去掉 URL / 文件路径 / 行号等噪音
 */
export function detectErrorInOutput(text) {
  if (!text || typeof text !== 'string') return null;

  // 1. 优先匹配错误码（EADDRINUSE / E404 / E0599 / CS0234 / TS2304 / ERR_CODE 等）
  //    v0.9.2 修正：E\d{3,5} 支持 3-5 位数字（如 E404 / E0599 / E110001）；
  //    用 [^A-Za-z0-9] 边界替代 \b（在方括号 [E0599] 内 \b 不工作）
  //    v0.9.2 补充：纯字母错误码如 EADDRINUSE / EACCES / ENOENT 也匹配
  const errCodeMatch = text.match(/(?:^|[^A-Za-z0-9])(EADDRINUSE|EACCES|ENOENT|ECONNREFUSED|ECONNRESET|EPIPE|EROFS|EMFILE|ENOTDIR|EISDIR|EEXIST|ENOSPC|EPERM|EACCES|[EENCT][A-Z]{2,}\d{2,}|E\d{3,5}|CS\d{4}|TS\d{4}|ERR_[A-Z_]+)(?:[^A-Za-z0-9]|$)/);
  if (errCodeMatch) {
    const pattern = errCodeMatch[1];
    const matchIdx = text.indexOf(pattern);
    const ctxStart = Math.max(0, matchIdx - 100);
    const ctxEnd = Math.min(text.length, matchIdx + pattern.length + 100);
    return { pattern, context: text.slice(ctxStart, ctxEnd) };
  }

  // 2. 匹配 error/fatal/exception 等关键词后的内容
  for (const re of ERROR_INDICATORS) {
    const m = text.match(re);
    if (m) {
      let pattern = m[1].trim().replace(/\s+/g, ' ');
      // v0.9.2 清理噪音：去掉 URL / 文件路径 / 行号
      pattern = pattern
        .replace(/https?:\/\/\S+/g, '')  // URL
        .replace(/\/[\w./-]+\.(py|js|ts|go|rs|java|c|cpp|cs|sh|ps1|zig|kt):\d+/g, '')  // 文件:行号
        .replace(/\s+/g, ' ')
        .trim();
      // 截断到 40 字符（知识库 pattern 应短而独特）
      pattern = pattern.slice(0, 40);
      // 跳过太短或太通用的 pattern
      if (pattern.length < 8) continue;
      const matchIdx = text.indexOf(m[0]);
      const ctxStart = Math.max(0, matchIdx - 100);
      const ctxEnd = Math.min(text.length, matchIdx + m[0].length + 100);
      return { pattern, context: text.slice(ctxStart, ctxEnd) };
    }
  }
  return null;
}

/**
 * 记录待确认的错误到 .specflow/error-kb-pending/
 * Stop hook 会在会话结束时检查 pending 错误并提示用户「是否记录到知识库」
 *
 * @param {string} projectRoot
 * @param {object} entry - { pattern, context, tool, lang, toolchains, detected_at }
 * @returns {string|null} 写入的文件路径
 */
export function recordPendingError(projectRoot, entry) {
  if (!entry || !entry.pattern) return null;
  const pendingDir = runtimePath(projectRoot, 'error-kb-pending');
  try { mkdirSync(pendingDir, { recursive: true }); } catch { return null; }
  const ts = (entry.detected_at || new Date().toISOString()).replace(/[:.]/g, '-');
  let patternHash;
  try {
    patternHash = createHash('sha1').update(entry.pattern).digest('hex').slice(0, 12);
  } catch {
    patternHash = entry.pattern.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_');
  }
  const filename = `${ts}-${patternHash}.json`;
  const path = join(pendingDir, filename);
  try {
    writeFileSync(path, JSON.stringify({
      ...entry,
      pending: true,
      recorded_at: new Date().toISOString(),
    }, null, 2), 'utf8');
    return path;
  } catch {
    return null;
  }
}

/**
 * 读取所有 pending 错误（供 Stop hook 提示用户）
 * 返回 [{ file, pattern, context, tool, lang, detected_at }]
 */
export function readPendingErrors(projectRoot) {
  const pendingDir = runtimePath(projectRoot, 'error-kb-pending');
  if (!existsSync(pendingDir)) return [];
  let entries = [];
  try { entries = readdirSync(pendingDir, { withFileTypes: true }); } catch { return []; }
  const result = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(pendingDir, e.name), 'utf8'));
      result.push({ ...data, file: e.name });
    } catch {}
  }
  return result;
}

/**
 * 将 pending 错误转为正式知识库记录（用户确认后调用）
 * 删除 pending 文件 + 调用 recordErrorToKb 写入正式知识库
 *
 * @param {string} projectRoot
 * @param {string} pendingFile - pending 文件名
 * @param {object} confirmed - 用户确认的 { cause, fix }（pattern/lang 从 pending 读）
 * @returns {string|null} 正式知识库文件路径
 */
export function confirmPendingError(projectRoot, pendingFile, confirmed) {
  const pendingDir = runtimePath(projectRoot, 'error-kb-pending');
  const pendingPath = join(pendingDir, pendingFile);
  if (!existsSync(pendingPath)) return null;
  let entry;
  try {
    entry = JSON.parse(readFileSync(pendingPath, 'utf8'));
  } catch { return null; }
  // 写入正式知识库
  const kbPath = recordErrorToKb(projectRoot, {
    pattern: entry.pattern,
    cause: confirmed.cause || entry.context?.slice(0, 100) || '(待补充)',
    fix: confirmed.fix || '(待补充)',
    lang: entry.lang || 'unknown',
    source: 'auto_captured',
  });
  // 删除 pending 文件
  try { writeFileSync(pendingPath, '', 'utf8'); } catch {}
  return kbPath;
}

/**
 * 清除指定 pending 错误（用户拒绝记录时调用）
 */
export function dismissPendingError(projectRoot, pendingFile) {
  const pendingDir = runtimePath(projectRoot, 'error-kb-pending');
  const pendingPath = join(pendingDir, pendingFile);
  if (!existsSync(pendingPath)) return false;
  try { writeFileSync(pendingPath, '', 'utf8'); return true; } catch { return false; }
}

// ─────────────────────────────────────────────
// v1.1.0 知识库匹配策略 + Levenshtein + 4 层配置
// ─────────────────────────────────────────────

/**
 * 通用模式匹配函数（v1.1.0）
 * @param {string} text - 待匹配文本
 * @param {string} pattern - 模式
 * @param {string} strategy - exact / regex / fuzzy
 * @param {number} fuzzyThreshold - fuzzy 模式的 Levenshtein 距离阈值
 * @returns {boolean}
 */
export function matchPattern(text, pattern, strategy = 'exact', fuzzyThreshold = 3) {
  if (!text || !pattern) return false;
  // v1.1.1 P1-6/P1-7：文本长度上限（防 fuzzy 超时）
  const MAX_TEXT_LEN = 8000;
  const safeText = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;
  switch (strategy) {
    case 'regex':
      try {
        // v1.1.1 P1-7：限制 pattern 长度
        if (pattern.length > 200) return false;
        // v1.1.1 修正：移除 ReDoS 检测——误报合法正则（如 (error|warning)+）
        // ReDoS 风险由文本长度上限（8000 字符）缓解——即使触发也是毫秒级而非分钟级
        return new RegExp(pattern).test(safeText);
      } catch {
        // 编译失败降级为精确匹配
        return safeText.includes(pattern);
      }
    case 'fuzzy':
      // v1.1.1 P1-6：fuzzyMatch 限制文本长度
      return fuzzyMatch(safeText, pattern, fuzzyThreshold);
    case 'exact':
    default:
      return text.includes(pattern);
  }
}

/**
 * Levenshtein 距离算法（v1.1.0 P2）
 * 计算两个字符串的编辑距离
 */
export function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  const dp = Array(n + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,       // 删除
        dp[j - 1] + 1,   // 插入
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)  // 替换
      );
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * 模糊匹配：在 text 中查找与 pattern 编辑距离 <= threshold 的子串
 * v1.1.0 P2 实现
 */
function fuzzyMatch(text, pattern, threshold) {
  if (!text || !pattern) return false;
  const patLen = pattern.length;
  // 在 text 中滑动窗口，比较每个子串与 pattern 的 Levenshtein 距离
  // 优化：只比较长度接近 pattern 的子串（patLen - threshold 到 patLen + threshold）
  const minLen = Math.max(1, patLen - threshold);
  const maxLen = Math.min(text.length, patLen + threshold);
  for (let len = minLen; len <= maxLen; len++) {
    for (let i = 0; i <= text.length - len; i++) {
      const substr = text.slice(i, i + len);
      if (levenshteinDistance(substr, pattern) <= threshold) {
        return true;
      }
    }
  }
  return false;
}

/**
 * v1.1.0 P1: 4 层配置合并
 * 优先级（高 → 低）：
 *   1. 环境变量（SPECFLOW_* 前缀）
 *   2. 个人配置（~/.specflow/config.personal.md）
 *   3. 项目配置（.specflow/config.md）
 *   4. 团队配置（.specflow/config.team.md）
 *   5. 全局配置（~/.specflow/config.md）
 *   6. 内置默认（templates-project/config.default.md）
 *
 * @param {string} projectRoot
 * @param {string} pluginRoot
 * @returns {object} { config, sources }
 */
export function loadMergedConfig(projectRoot, pluginRoot) {
  const layers = [
    { name: 'global', path: join(_home(), '.specflow', 'config.md') },
    { name: 'team', path: join(projectRoot, '.specflow', 'config.team.md') },
    { name: 'project', path: join(projectRoot, '.specflow', 'config.md') },
    { name: 'personal', path: join(_home(), '.specflow', 'config.personal.md') },
  ];

  const sources = [];
  const merged = {};

  // 从低到高加载（高优先级覆盖低优先级）
  for (const layer of layers) {
    if (!existsSync(layer.path)) {
      sources.push({ name: layer.name, path: layer.path, loaded: false });
      continue;
    }
    try {
      const content = readFileSync(layer.path, 'utf8');
      // 简单 checkbox 解析：- [x] key / - [ ] key / key: value
      const checkboxRegex = /^[-*]\s*\[([ x])\]\s*(.+?)(?::\s*(.+))?$/gm;
      let m;
      while ((m = checkboxRegex.exec(content)) !== null) {
        const checked = m[1] === 'x';
        const key = m[2].trim();
        const value = m[3] ? m[3].trim() : checked;
        merged[key] = { value, source: layer.name };
      }
      sources.push({ name: layer.name, path: layer.path, loaded: true, keys: Object.keys(merged).length });
    } catch {
      sources.push({ name: layer.name, path: layer.path, loaded: false, error: 'parse failed' });
    }
  }

  // 环境变量覆盖（最高优先级）
  for (const [envKey, envVal] of Object.entries(process.env)) {
    if (envKey.startsWith('SPECFLOW_')) {
      const configKey = envKey.slice('SPECFLOW_'.length).replace(/_/g, ' ').toLowerCase();
      merged[configKey] = { value: envVal, source: 'env' };
    }
  }

  return { config: merged, sources };
}

function _home() {
  return process.env.HOME || process.env.USERPROFILE || '.';
}
