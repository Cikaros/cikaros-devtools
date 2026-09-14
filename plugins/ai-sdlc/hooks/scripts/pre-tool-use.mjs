#!/usr/bin/env node
/**
 * pre-tool-use.mjs — PreToolUse hook（触发点 3/6）
 *
 * ═══════════════════════════════════════════════════════════════════
 * 文档写入保护策略 v2（Write Protection Policy，与 Anthropic playbook 对齐）
 * 完整标准见插件 docs/write-policy.md
 *
 * 设计原则：门禁保护的是「业务代码」与「运行时状态」，
 * 不阻碍文档创作——计划/设计阶段的本职产出就是文档。
 *
 * 第一层 · 文件分级（任何阶段生效）：
 *   🟢 文档类     *.md *.txt *.rst *.adoc *.org *.tex（README/CHANGELOG/
 *                 design 笔记/ADR 等一切纯文档）→ 放行
 *   🟢 插件目录   .sdlc/**（状态文件除外）→ 放行
 *   🟢 任务工作区 .sdlc/tasks/<id>/intent.md|spec.md|plan.md|REVIEW.md → 放行（文档）
 *   🟡 机构知识   AGENTS.md / CLAUDE.md / REVIEW.md → 放行 + warn
 *                 （playbook 治理：修改应经代码所有者审查）
 *   🟡 已接受规格 spec.md 在 build/test/deploy 阶段被编辑 → 放行 + warn
 *                 （需求变更应回 design 阶段走变更流程）
 *   🟡 周期归档   .sdlc/archive/** 与 docs/sdlc/archive/**（历史兼容） → 放行 + warn
 *                 （审计链：历史周期记录，修改应说明原因）
 *   🔴 运行时状态 .sdlc/state.json / hooks-state.json / session-map.json /
 *                 cycles.json / tasks.json；.sdlc/tasks/<id>/state.json /
 *                 hooks-state.json / task.json；.sdlc/sessions/*.json / *.tmp / *.lock
 *                 （agent 手改 state 可自我授权绕过门禁：plan_accepted /
 *                   release_approval 等全在此类文件；隔离索引被改 = 污染隔离；
 *                   状态只能由 hook 与 MCP 工具受控修改；用户可在编辑器中
 *                   直接手工编辑）
 *
 * 第二层 · 阶段门禁（仅约束业务代码类；且仅「已参与工作流」时硬拦）：
 *   - plan 模式禁改代码（Stage 3a）：业务代码类写入 → block
 *     （playbook："Codex 在工程师接受计划前无法编辑代码"）
 *   - 修复期禁改测试（Stage 3b + in_fix_mode）：测试文件 → block
 *   - 修复循环中断（v0.7.0 fix_loop）：业务代码类写入 → block
 *     （循环命中后必须先向用户呈报证据并等待决策，不得继续自动修）
 *   - 无工单禁改迁移（Stage 5）：migration/terraform → block
 *   - 生产部署授权（Stage 5）：Bash deploy+production → block
 *   - 未参与工作流（!sdlc_engaged）的项目 → 降级为 warn（防误伤无关仓库）
 *
 * 第三层 · Bash 门禁加固（v0.4.0 修复）：
 *   - 链式命令按 && / || / ; / | / 换行 拆段，逐段白名单校验
 *     （v0.3.0 整串前缀匹配可被 `git status && rm -rf x` 绕过）
 *   - 输出重定向（> / >> / 2>file）→ 视为写操作（`cat a > b` 绕过修复）
 *   - 命令替换 $(...) / 反引号 → 拒绝
 *   - apply_patch：解析 patch 文本中的目标路径逐一校验
 *     （v0.3.0 只看 file_path，patch 内路径完全未检查）
 *   - v0.13.11 引号感知（用户实测误报链）：上述全部检查升级为 shell 词法
 *     语义——引号内的 | > $ ` 是字面文本不是语法（`rg "a|b|c" | head` 的
 *     搜索模式不再被误切分误拦）；双引号内 $()/反引号仍会执行（保持拦截）；
 *     转义形态 \| \< 同样字面化；引号包裹的重定向/删除目标现在能被真实
 *     提取（`> ".sdlc/state.json"`、`rm '.sdlc/state.json'` 不再逃逸规则 0e）
 *   - v0.13.11 受控接受通道：plan 等待接受期的 CLI 回退入口
 *     （accept-plan.mjs / sdlc.sh accept）精确路径豁免——MCP 工具未随会话
 *     暴露时 agent 仍有合法通道记录工程师的显式接受（防死锁）
 *   - v0.13.12 受控探测通道：setup-playwright.mjs --check（只读环境检测）
 *     段级豁免——plan 模式下评估前端测试方案也应允许探测环境（安装入口
 *     --install 不豁免：写 package.json + 网络下载属带副作用操作，Stage 3b 起）
 *
 * 第五层 · 沙盒授权预警（v0.13.12，规则 0f）：网络访问/端口监听类命令在
 *   Codex 沙盒下默认被拒（平台安全机制，非本插件门禁）。放行这类命令时
 *   注入授权应对协议（warn/additionalContext，每会话去重一次）——被拒时
 *   agent 应向用户呈报命令与目的请求授权提权，而不是反复重试或绕过。
 *   配套：PostToolUse 检测失败输出特征 → hooks-state.sandbox_denied →
 *   UserPromptSubmit 下回合针对性提醒（三层联动）。
 *   v0.13.13 审批等待通知（用户反馈：审批弹窗 “1. Yes, proceed (y) / 2. No
 *   (esc)” 出现在回合进行中，用户不知道任务已暂停）：同一判定点（netPortKind
 *   命中）另发**系统级桌面通知**把人叫回（lib/notify.mjs notifyApprovalWait，
 *   alert 级；agent 教育文案去重与用户通知在场窗口互独立）。在场窗口降噪：
 *   PostToolUse 在网络/端口命令完成时刷新 hooks-state.netport_last_exec_at，
 *   默认 120s 内不重复通知（刚批准/拒过 = 人就在终端）。
 *
 * 第四层 · 跨平台脚本护栏（v0.13.2，规则 0d）：
 *   - hook 层监测运行环境（lib/env.mjs 能力探测：POSIX shell / PowerShell
 *     是否真实可用），拦截「注定失败」的脚本调用（Windows 无 bash 时跑
 *     .sh / 无 pwsh 的 macOS/Linux 跑 .ps1）并给出等价替代
 *   - 能力感知而非 OS 一刀切：装了 Git Bash/WSL 的 Windows 照常跑 .sh；
 *   装了 pwsh 的 macOS/Linux 照常跑 .ps1
 *   - 只拦执行形态（bash/sh/powershell 启动器 / 直接执行 .sh/.ps1），
 *     cat/ls/grep 等读取路径不误伤；与 engagement 无关（纯错误预防）
 *
 * 输入（stdin JSON）：
 *   { session_id, cwd, tool_name, tool_input: { command?, file_path?, patch? }, hook_event_name }
 *
 * 输出（stdout JSON）：
 *   {}                              放行
 *   { decision: "block", reason }   阻止（exit 2，stderr 进 agent 上下文）
 *   { decision: "warn", reason }    警告但放行（additionalContext）
 */

import { resolve, basename } from 'node:path';
import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, readCodexState,
  resolveScope, isTestCommand, isEngaged, fileExists, PLUGIN_ROOT,
  readHooksStateForSession, mutateCodexState,
} from './lib/common.mjs';
import { detectEnvironment, scriptPlatformViolation, scriptGuardMessage } from './lib/env.mjs';
import { detectStage, STAGE_BY_ID } from './lib/stage-detector.mjs';
import { netPortKind, sandboxWarnText } from './lib/sandbox.mjs';
import { notifyApprovalWait } from './lib/notify.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

// v0.5.0 作用域路由：门禁按会话绑定任务的状态判定（多任务隔离）
const scope = resolveScope(projectRoot, input);

const toolName = input.tool_name || input.tool || '';
const toolInput = input.tool_input || {};
const command = toolInput.command || '';
const filePath = toolInput.file_path || toolInput.path || '';
// v0.7.0：Bash 工具名兼容（与 apply_patch 同类的协议不对称防御）
const isShellTool = toolName === 'Bash' || toolName === 'shell' || toolName === 'Shell';


const state = readCodexState(scope, 'state.json') || {};
const detection = detectStage(scope);
const stage = STAGE_BY_ID[detection.stage];
// v0.13.10 并集阶段判定：git diff 是瞬态的——测试通过并提交后，基于「有 diff」
//   的 test/deploy 检测跌回 build_impl（保存值仍在前段阶段）。仅看 detection.stage
//   会让 deploy 阶段门禁（规则 3 迁移工单 / 规则 4 生产授权）在「已提交」窗口
//   静默失效，也会让 build_impl 的修复期测试保护（规则 2）在 detection=test
//   窗口漏拦——与规则 4b（push 门禁）v0.7.0 已采用的并集语义对齐：
//   保存值与检测值任一侧命中即拦（防漏，宁严勿漏）。
const stageSet = new Set([state.current_stage, detection.stage].filter(Boolean));

// ─────────────────────────────────────────────
// 工作流参与判定（v0.4.0；v0.10.0 统一至 common.isEngaged 单一实现）：
//   硬门禁（block）只对「显式参与 ai-sdlc 工作流」的项目生效，
//   防止仅有 spec.md 文件的普通仓库被误拦。
//   参与证据：sdlc_engaged 标记（工件写入/任务创建/MCP 首次调用时置位）、
//   或任一受控状态位已被 MCP 工具设置（plan_accepted / in_fix_mode /
//   change_ticket / release_approval / deploy_initialized / stage_override）。
//   此前本文件手写 7 字段、post/stop 各手写 6 字段（漏 change_ticket）——
//   三处判定集不一致已收敛。
// ─────────────────────────────────────────────
const engaged = isEngaged(state);

const isWriteOp = ['Edit', 'Write', 'apply_patch', 'MultiEdit'].includes(toolName);

// ─────────────────────────────────────────────
// 第一层：文件分级
// ─────────────────────────────────────────────

/** 🟢 纯文档扩展名（任何阶段可编辑） */
const DOC_EXT = /\.(md|markdown|mdown|mkd|txt|rst|adoc|asciidoc|org|tex|latex)$/i;

/** 无扩展名的已知文档文件名 */
const DOC_BASENAMES = /^(readme|changelog|changes|history|authors|contributors|contributing|code_of_conduct|license|licence|notice|todo|news|maintainers|security)$/i;

/** 🟡 机构知识工件（放行 + warn） */
const KNOWLEDGE_BASENAMES = /^(agents|claude|review|cursor|copilot-instructions)\.md$/i;

/** 🔴 插件运行时状态（hook/MCP 专属，agent 禁改；v0.5.0 扩展任务/隔离索引/会话快照；v0.6.0 扩展 MCP 会话票据队列；v0.10.0 扩展 .lock 审计锁；v0.12.0 扩展 quick-tasks 临时任务队列；v0.13.3 扩展 mcp-launcher 启动器指针 + 事件流/审计/快照文件（与 .codexignore 托管块清单对齐——此前声明为运行时文件却未拦截，伪造 events/audit = 污染审计链）） */
const RUNTIME_STATE_RES = [
  /(^|\/)\.sdlc\/(state|hooks-state|merged-config|session-map|cycles|tasks|quick-tasks|mcp-launcher|session-end|prompt-trace|hook-audit)\.json$/i,
  /(^|\/)\.sdlc\/events\.jsonl$/i,
  /(^|\/)\.sdlc\/tasks\/[^/]+\/(state|hooks-state|task)\.json$/i,
  /(^|\/)\.sdlc\/sessions\/[^/]+\.json$/i,
  /(^|\/)\.sdlc\/mcp-bind-queue\//i,   // v0.6.0：会话票据队列（伪造 = 冒充其他会话的 MCP 路由）
  /(^|\/)\.sdlc\/[^\n]*\.(tmp|lock)$/i,  // v0.9.0 原子写 tmp + v0.10.0 审计锁（即使
                                       // 未来某处回退固定名，写入 tmp/lock 也不可利用）
];
/**
 * v0.13.4 路径分隔符规范化（Windows 兼容）：agent 常写反斜杠路径
 * （`C:\Users\x\.sdlc\state.json` 或 `.\.sdlc\state.json`），而本文件所有
 * 路径正则用 `/` 分隔——不规范化则 Windows 风格路径全部逃逸写保护/分级。
 * 仅影响判定输入，不改写真实文件路径（POSIX 反斜杠文件名极罕见，兼容收益
 * 远大于误判风险）。
 */
function normSep(p) {
  return String(p).replace(/\\/g, '/');
}

const RUNTIME_STATE = {
  test: (p) => RUNTIME_STATE_RES.some(re => re.test(normSep(p))),
};

/** 🟡 周期归档目录（历史周期记录 = 审计链，放行 + warn；v0.10.0 起默认 .sdlc/archive，docs/sdlc/archive 为历史兼容） */
const ARCHIVE_PATH = /(^|\/)(\.sdlc\/archive|docs\/sdlc\/archive)\//i;

/** 🔵 业务代码扩展名（plan 模式禁改） */
const CODE_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|cjs|mts|cts|py|pyw|pyi|go|rs|java|cs|kt|kts|swift|rb|php|vue|svelte|scala|sc|c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm|sh|bash|zsh|fish|ps1|psm1|bat|cmd|sql|pl|pm|lua|r|rmd|jl|dart|ex|exs|erl|hrl|hs|ml|mli|clj|cljs|cljc|edn|elm|nim|zig|v|vsh|cr|pas|asm|s|S|f|f90|vb)$/i;

/** 🔵 构建/依赖清单（plan 模式禁改） */
const BUILD_FILES = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|npm-shrinkwrap\.json|bun\.lockb|Cargo\.toml|Cargo\.lock|go\.mod|go\.sum|pom\.xml|build\.gradle|build\.gradle\.kts|settings\.gradle|settings\.gradle\.kts|gradle\.properties|Makefile|makefile|GNUmakefile|Dockerfile|docker-compose\.ya?ml|docker-compose\.[^/]*\.ya?ml|requirements\.txt|requirements-dev\.txt|pyproject\.toml|setup\.py|setup\.cfg|Pipfile|Pipfile\.lock|Gemfile|Gemfile\.lock|Rakefile|composer\.json|composer\.lock|mix\.exs|mix\.locks?|CMakeLists\.txt|meson\.build|WORKSPACE|BUILD|BUILD\.bazel|bazelrc|justfile|Justfile|taskfile\.ya?ml)$/;

/** 🔵 运行时配置扩展名（plan 模式禁改） */
const CONFIG_EXT = /\.(toml|yaml|yml|ini|conf|cfg|properties|env|json|xml|proto|graphql|gql|tfvars)$/i;

/** 🔵 配置类点文件（.gitignore / .env / .npmrc 等） */
const CONFIG_DOTFILES = /(^|\/)\.(gitignore|gitattributes|gitmodules|dockerignore|editorconfig|npmrc|yarnrc|yarnrc\.yml|nvmrc|node-version|python-version|tool-versions|prettierrc[a-z0-9_.-]*|eslintrc[a-z0-9_.-]*|babelrc|env[a-z0-9_.-]*)$/i;

/** 🔵 迁移/基础设施类（deploy 阶段需变更工单） */
const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate|terraform|infrastructure|infra|k8s|kubernetes|helm|charts)\//i;
const MIGRATION_EXT = /\.(sql|tf|tfvars|hcl)$/i;

/** 🔵 测试代码类（修复期禁改） */
const TEST_FILE = /(_test|_spec|\.(test|spec))\.(js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|cs|kt|swift|rb|php|vue|svelte|scala|c|cpp)\b/i
  || /(^|\/)(tests?|__tests?__|spec|specs|mocha|cypress|e2e)\//;

/**
 * 对单个目标路径做分类
 * @returns 'doc' | 'knowledge' | 'runtime_state' | 'spec' | 'archive' | 'code' | 'unknown'
 */
function classifyFile(p) {
  if (!p) return 'unknown';
  p = normSep(p);   // v0.13.4：Windows 反斜杠路径规范化后判定（否则全部逃逸）
  const base = basename(p);
  const lower = base.toLowerCase();

  // 🔴 运行时状态最优先（即使 .sdlc/ 整体放行，状态文件也不放行）
  if (RUNTIME_STATE.test(p)) return 'runtime_state';

  // 🟡 周期归档目录（优先于 spec/knowledge：归档内的历史工件无论原名一律 archive）
  if (ARCHIVE_PATH.test(p)) return 'archive';

  // 🟢 插件目录（.sdlc/ 其余内容：bands.yaml 自定义、tasks/<id>/ 工件等）
  if (/(^|\/)\.sdlc\//.test(p)) return 'doc';

  // 🟡 机构知识
  if (KNOWLEDGE_BASENAMES.test(lower)) return 'knowledge';

  // 🟡 阶段规格工件
  if (lower === 'spec.md' || lower === 'intent.md' || lower === 'plan.md') return 'spec';

  // 🟢 文档类
  if (DOC_EXT.test(base)) return 'doc';
  if (!/\./.test(base) && DOC_BASENAMES.test(lower)) return 'doc';

  // 🔵 业务代码/构建/配置
  if (CODE_EXT.test(base)) return 'code';
  if (BUILD_FILES.test(p)) return 'code';
  if (CONFIG_EXT.test(base)) return 'code';
  if (CONFIG_DOTFILES.test(p)) return 'code';

  // 其余（无扩展名杂项、图片、二进制等）→ 不按代码拦，plan 模式放行
  return 'unknown';
}

/**
 * 从 apply_patch 的 patch 文本中提取目标路径
 * （Codex apply_patch 格式：*** Add File: / *** Update File: /
 *   *** Delete File: / *** Move to: / *** Copy to:）
 */
function patchTargets(patchText) {
  const paths = [];
  const text = String(patchText || '');
  const re = /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+(.+)$/gm;
  const re2 = /^\*\*\*\s+(?:Move|Copy)\s+to:\s+(.+)$/gm;
  for (const m of text.matchAll(re)) paths.push(m[1].trim());
  for (const m of text.matchAll(re2)) paths.push(m[1].trim());
  return paths;
}

// 本次调用涉及的全部目标路径（file_path + patch 内路径）
const targets = [];
if (filePath) targets.push(filePath);
if (toolInput.patch) targets.push(...patchTargets(toolInput.patch));
const targetClasses = targets.map(classifyFile);

let decision = 'allow';
let reason = '';
let severity = 'info';

function block(r) { decision = 'block'; reason = r; severity = 'error'; }
function warn(r) { if (decision === 'allow') { decision = 'warn'; reason = r; severity = 'warn'; } }

// ─────────────────────────────────────────────
// 第三层：Bash 只读校验（v0.4.0 加固；v0.13.9 误报修复轮：
//   sed 读形态白名单 / quoted heredoc 载荷剥离 / apply_patch 载荷目标分类
//   （文档放行、代码具名拦截）/ 文档目标重定向分类放行（规则 1b 传
//   allowDocWrites；规则 0b fix_loop 保持严格）/ /dev/null 汇豁免 /
//   stdout-only 工具白名单。定义于规则段之前避免 TDZ）
//   v0.13.11 引号感知修复轮（用户实测：`rg -n "accept_plan|plan_accepted|
//   accept-plan" … | head -80` 被「非只读命令段（plan_accepted）」误拦——
//   引号内的 | 被当成管道切分；同类：引号内 > 的模式文本、单引号内 $()/反引号
//   字面量均被误判）。
// ─────────────────────────────────────────────

/** 只读命令前缀白名单（逐段校验） */
const READONLY_PREFIXES = [
  /^git\s+(status|log|diff|show|branch|rev-parse|remote|ls-files|describe|stash\s+list|blame|shortlog|grep)\b/,
  /^ls\b/, /^cat\b/, /^head\b/, /^tail\b/, /^rg\b/, /^grep\b/, /^find\b/,
  /^pwd\b/, /^cd\b/, /^which\b/, /^command\s+-v\b/, /^whoami\b/, /^id\b/,
  /^wc\b/, /^tree\b/, /^file\b/, /^stat\b/, /^du\b/, /^df\b/, /^date\b/,
  /^env\b/, /^printenv\b/, /^uname\b/, /^arch\b/, /^hostname\b/,
  /^make\s+(help|-n|--dry-run)\b/, /^npm\s+(run\s+help|ls|--version)\b/,
  /^npx\s+--version\b/,
  /^(node|deno|bun|python|python3|cargo|rustc|go|java|git|pip|pip3|ruby|php|perl)\s+(-v|-V|--version)\b/,
  /^go\s+version\b/, /^cargo\s+--help\b/, /^rustc\s+--version\b/,
  // v0.13.9：stdout-only 工具（无重定向时零副作用；有重定向先被上方位检查拦下）
  /^echo\b/, /^printf\b/, /^sort\b/, /^uniq\b/, /^cut\b/, /^diff\b/, /^nl\b/,
];

/**
 * v0.13.9 拆出 heredoc 载荷：quoted 定界符（<<'X' / <<"X"）且标记位于行尾时，
 * 载荷是**纯数据**（shell 不展开、不执行）——不参与语法检查。典型形态即
 * `apply_patch <<'PATCH' ... PATCH`（plan.md 内容含 markdown 反引号/`>`
 * 引用块——此前被整串扫描误判为命令替换/重定向）。
 * 未闭合（找不到定界行）→ 载荷取到串尾（同语义）；unquoted 定界符不拆分
 * （载荷内 $ 展开是真实执行风险，保持整串检查）。
 * @returns {{shellPart:string, payload:string|null}}
 */
function splitHeredoc(cmd) {
  const c = String(cmd);
  const m = c.match(/<<-?\s*(['"])([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\n/);
  if (!m) return { shellPart: c, payload: null };
  const start = m.index + m[0].length;             // 载荷起点（标记行之后）
  const rest = c.slice(start);
  const endRe = new RegExp(`^${m[2]}$`, 'm');
  const end = rest.match(endRe);
  return { shellPart: c.slice(0, m.index) + m[0].replace(/\n$/, ''), payload: end ? rest.slice(0, end.index) : rest };
}

// ─────────────────────────────────────────────
// v0.13.11 shell 词法工具（引号感知——全部只读静态分析，不执行）
// ─────────────────────────────────────────────

/**
 * 引号区段识别（单/双引号）。语义对齐 POSIX shell：
 *   - 引号外 `\x` 转义下一字符（字面保留）；双引号内 `\" \\ \$ \`` 转义
 *   - 单引号内一切字符字面（含 | > $ ` \）
 *   - 未闭合引号 → 余下全部视为引号内（该命令本身是 shell 语法错误不会
 *     执行——保守处理方向：不切分/不检测为语法，宁可放行一个无效命令）
 * @returns {Array<{start:number,end:number,quote:"'"|'"'}>} 区段含引号字符本身
 */
function quoteSpans(cmd) {
  const c = String(cmd);
  const spans = [];
  let quote = null, start = 0;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (quote === null) {
      if (ch === '\\') { i++; continue; }
      if (ch === "'" || ch === '"') { quote = ch; start = i; }
    } else if (quote === "'") {
      if (ch === "'") { spans.push({ start, end: i, quote }); quote = null; }
    } else {   // 双引号
      if (ch === '\\') { i++; continue; }              // \" \\ \$ \` 转义
      if (ch === '"') { spans.push({ start, end: i, quote }); quote = null; }
    }
  }
  if (quote !== null) spans.push({ start, end: c.length - 1, quote });
  return spans;
}

/** 字符位置是否在引号区段内部（不含引号字符本身） */
function inAnyQuote(spans, i) {
  return spans.some(s => i > s.start && i < s.end);
}

/**
 * 命令替换探针（v0.13.11）：仅保留「会被 shell 执行」的活字符，字面字符以
 * 空格占位。判定依据：$()/反引号在单引号内与转义形态下是字面文本（不执行），
 * 在双引号内与裸位置会真实执行（保持拦截——bash 双引号内替换确实生效）。
 * 修正的误报形态：`rg '\$\(' f`、`rg "a`b" f`（历史：整串扫描一律拦）。
 */
function substitutionProbe(cmd) {
  const c = String(cmd);
  let out = '';
  let quote = null;
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (quote === null) {
      if (ch === '\\') { out += '  '; i++; continue; }
      if (ch === "'" || ch === '"') { quote = ch; out += ' '; continue; }
      out += ch;
    } else if (quote === "'") {
      if (ch === "'") { quote = null; out += ' '; continue; }
      out += ' ';
    } else {
      if (ch === '\\') { out += '  '; i++; continue; }
      if (ch === '"') { quote = null; out += ' '; continue; }
      out += ch;                                            // 双引号内 $ ( ` 仍是活的
    }
  }
  return out;
}

/** 剥除 token 两端成对引号（`".sdlc/x"` → `.sdlc/x`；不成对原样保守返回） */
function stripQuotes(tok) {
  const m = String(tok).match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2] : String(tok);
}

/**
 * v0.13.11 引号感知重定向扫描：定位引号外的 > / >>（含 >&file 双流写形态），
 * 提取目标 token（跳过目标前空白；引号包裹的目标整段纳入后剥引号——
 * `> ".sdlc/state.json"` 此前因 token 含引号字符而逃逸规则 0e 命中）。
 * fd 合并（>& / >&1 / 2>&1）不产生文件目标——跳过。
 * @returns {Array<{op:'>'|'>>', target:string|null}>} target=null 表示裸 >/进程替换（>（cmd））
 */
function findRedirects(cmd) {
  const c = String(cmd);
  const spans = quoteSpans(c);
  const out = [];
  for (let i = 0; i < c.length; i++) {
    if (inAnyQuote(spans, i)) continue;
    if (c[i] !== '>') continue;
    let j = i + 1;
    let op = '>';
    if (c[j] === '>') { op = '>>'; j++; }
    if (c[j] === '&') {
      // >& 后跟数字 = fd 合并（安全）；跟其他 token = 双流写文件（>&file ≡ >file 2>&1）
      let k = j + 1;
      while (k < c.length && /[0-9]/.test(c[k])) k++;
      if (k === j + 1 || (k < c.length && !/[\s;|&<>()]/.test(c[k]))) {
        // >& 后非纯数字（或数字后紧跟非分隔符 = 文件名以数字开头）→ 按文件目标处理
        let t = k;
        while (t < c.length && /\s/.test(c[t])) t++;
        let tok = '';
        while (t < c.length) {
          if (inAnyQuote(spans, t)) { tok += c[t]; t++; continue; }
          if (/[\s;|&<>()]/.test(c[t])) break;
          tok += c[t]; t++;
        }
        out.push({ op: '>', target: tok || null });
        i = t - 1;
      } else { i = j; }                                     // 纯数字 fd 合并：跳过
      continue;
    }
    let t = j;
    while (t < c.length && /\s/.test(c[t])) t++;            // 跳过目标前空白
    let tok = '';
    while (t < c.length) {
      if (inAnyQuote(spans, t)) { tok += c[t]; t++; continue; }
      if (/[\s;|&<>()]/.test(c[t])) break;
      tok += c[t]; t++;
    }
    out.push({ op, target: stripQuotes(tok) || null });
    i = t - 1;
  }
  return out;
}

/**
 * v0.13.11 引号感知切分：操作符（&& || ; | 换行）仅在引号外生效。
 * 修复：`rg -n "accept_plan|plan_accepted|accept-plan" … | head -80` 的搜索
 * 模式内 | 被误切分 → 产生「非只读命令段（plan_accepted）」确凿误报（用户
 * 实测，v0.13.9 的 heredoc 载荷剥离未覆盖本形态）。转义形态 \| \< 同样字面化。
 */
function splitShellSegments(cmd) {
  const c = String(cmd);
  const spans = quoteSpans(c);
  const out = [];
  let cur = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (!inAnyQuote(spans, i)) {
      if (ch === '&' && c[i + 1] === '&') { out.push(cur); cur = ''; i++; continue; }
      if (ch === '|' && c[i + 1] === '|') { out.push(cur); cur = ''; i++; continue; }
      if (ch === '|' || ch === ';' || ch === '\n') { out.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}

/**
 * v0.13.9 重定向目标提取（v0.13.11 升级为引号感知）：从 shellPart 提取引号外
 * > / >> / >&file 的目标 token（剥引号）。与 shellWriteTargets 同一语义源
 * （后者复用本函数）。
 */
function extractRedirectTargets(shellCmd) {
  return findRedirects(shellCmd)
    .map(r => r.target)
    .filter(Boolean);
}

/**
 * v0.13.11 受控接受入口段判定（规则 1b 豁免）：MCP 工具未随会话暴露时
 * （用户实测：会话未暴露 mcp__sdlc-orchestrator__* 且无 CLI 回退 → agent
 * 无合法通道记录工程师的显式接受，死锁在 plan 门禁），以下两种**精确路径**
 * 形态的段视为合法接受操作（语义与 MCP accept_plan 一致，脚本内部走同一把
 * 跨进程锁）——路径必须等于本插件安装根（防伪造同路径名脚本）:
 *   node <PLUGIN_ROOT>/hooks/scripts/accept-plan.mjs [project-root]
 *   bash <PLUGIN_ROOT>/scripts/sh/sdlc.sh accept
 * 仅豁免 accept——advance/reset 等其他子命令仍拦（可跳过产出/门禁检查，
 * 不接受经 Bash 通道代劳）。
 */
function isControlledAcceptSeg(seg) {
  const parts = String(seg).trim().split(/\s+/);
  if (parts.length < 2) return false;
  const head = parts[0].toLowerCase().replace(/\.exe$/, '');
  const target = normSep(stripQuotes(parts[1]));
  const MJS = normSep(PLUGIN_ROOT) + '/hooks/scripts/accept-plan.mjs';
  const SH = normSep(PLUGIN_ROOT) + '/scripts/sh/sdlc.sh';
  if (head === 'node' && target === MJS) return true;
  if ((head === 'bash' || head === 'sh' || head === 'zsh') && target === SH) {
    return /^accept\b/.test(parts[2] || '');
  }
  return false;
}

/**
 * v0.13.12 受控探测段判定（规则 1b 豁免）：setup-playwright.mjs 的**只读**
 * 入口——plan 模式下评估前端测试方案需要探测环境（包管理器/依赖/浏览器
 * 缓存/本机 Chrome），这是无副作用的合法探测。精确路径匹配插件安装根
 * （防伪造同路径名脚本）；仅 --check / --help 形态豁免：
 *   node <PLUGIN_ROOT>/hooks/scripts/setup-playwright.mjs --check [project-root]
 * --install（写 package.json + 网络下载）不豁免——Stage 3b 起才合法。
 */
function isControlledProbeSeg(seg) {
  const parts = String(seg).trim().split(/\s+/);
  if (parts.length < 2) return false;
  const head = parts[0].toLowerCase().replace(/\.exe$/, '');
  const target = normSep(stripQuotes(parts[1]));
  const MJS = normSep(PLUGIN_ROOT) + '/hooks/scripts/setup-playwright.mjs';
  if (head !== 'node' || target !== MJS) return false;
  // 参数前缀限定：--check / --help / -h 才是只读形态（--install 落在后面不命中）
  return parts.slice(2, 5).some(a => a === '--check' || a === '--help' || a === '-h');
}

/**
 * 判定 Bash 命令是否违反 plan 模式只读约束
 *   v0.13.9 修复四类误报（用户实测）：
 *   a) /dev/null 汇（stderr/stdout 抑制）不再计为写——`cat x 2>/dev/null` 放行
 *   b) quoted heredoc 载荷不再整串扫描——markdown 反引号 ≠ 命令替换
 *   c) sed 读形态（无 -i/--in-place 且脚本无 w 写命令）= 纯读取放行
 *   d) opts.allowDocWrites（规则 1b）：重定向目标与 apply_patch 载荷目标
 *      经 classifyFile 分类——文档/spec 类放行（与规则 1 工具通道语义对齐：
 *      plan 阶段的本职产出就是文档）；代码类拦截并具名。
 *      规则 0b（fix_loop 中断期）不传该参——中断期等待用户决策，写文档同样
 *      不允许（严格模式，行为不变）。
 *   v0.13.11 引号感知（用户实测误报）：全部语法检查升级为 shell 词法语义
 *   （详见上方词法工具注释）——引号内的 | > $ ` 是字面文本；新增
 *   opts.allowControlledAccept（仅规则 1b）：受控接受 CLI 段豁免。
 *   v0.13.12 新增 opts.allowControlledProbe（仅规则 1b）：受控探测
 *   CLI 段豁免（setup-playwright.mjs --check 只读形态）。
 * @param {object} [opts]
 * @param {boolean} [opts.allowDocWrites] 文档目标写形态放行（plan 模式语义）
 * @param {boolean} [opts.allowControlledAccept] 受控接受 CLI 段豁免（plan 等待接受期）
 * @param {boolean} [opts.allowControlledProbe] 受控探测 CLI 段豁免（环境检测只读入口）
 * @returns {string|null} 违规原因（null = 只读/文档写放行）
 */
function bashWriteViolation(cmd, opts = {}) {
  const allowDocWrites = opts.allowDocWrites === true;
  const allowControlledAccept = opts.allowControlledAccept === true;
  const allowControlledProbe = opts.allowControlledProbe === true;
  const { shellPart, payload } = splitHeredoc(String(cmd));

  // 1. 命令替换 → 拒绝（无法静态判定内嵌命令的副作用；heredoc 载荷已剥离）
  //    v0.13.11 探针语义：单引号内/转义形态的 $( 与 ` 是字面文本（rg 搜索
  //    模式常见）；双引号内与裸位置仍会真实执行 → 保持拦截
  if (/\$\(|`/.test(substitutionProbe(shellPart))) {
    return '含命令替换 $(...) 或反引号（无法静态判定副作用）';
  }

  // 2. 输出重定向 → 写操作（/dev/null 汇豁免；fd 合并 2>&1 安全；
  //    v0.13.11 引号感知：引号内的 > 是模式文本不算重定向；引号包裹的
  //    目标真实提取剥引号；>&file 双流写形态不再漏判）
  const redirects = findRedirects(shellPart).filter(r => r.target !== '/dev/null');
  if (redirects.length > 0) {
    if (allowDocWrites) {
      const targets = redirects.map(r => r.target).filter(Boolean);
      if (targets.length === 0) return '含输出重定向 >（写文件或进程替换）';
      const bad = targets.find(p => classifyFile(p) === 'code');
      if (bad) return `重定向目标为业务代码（${bad}）`;
      // 全部目标为文档/spec/未知类 → 写形态放行，继续段白名单校验
    } else {
      return redirects.some(r => r.op === '>>')
        ? '含追加重定向 >>（写文件）'
        : '含输出重定向 >（写文件或进程替换）';
    }
  }

  // 3. 链式命令拆段（&& / || / ; / | / 换行），逐段白名单校验
  //    修复 v0.3.0 整串前缀匹配可被 `git status && rm -rf x` 绕过的漏洞
  //    v0.13.11 引号感知切分：引号内的 | 不再被误当管道（rg 搜索模式）
  const segments = splitShellSegments(shellPart).map(s => s.trim()).filter(Boolean);
  if (segments.length === 0 && payload == null) return null;
  for (const seg of segments) {
    // v0.13.11 受控接受通道（仅规则 1b 传入）：plan 等待接受期的 CLI 回退
    //   入口段放行（MCP 工具不可用时记录工程师显式接受的唯一合法通道）
    if (allowControlledAccept && isControlledAcceptSeg(seg)) continue;
    // v0.13.12 受控探测通道（仅规则 1b 传入）：setup-playwright.mjs --check
    //   只读环境检测段放行（plan 模式评估前端测试方案的合法探测）
    if (allowControlledProbe && isControlledProbeSeg(seg)) continue;
    // find 的 -delete / -exec 具有破坏性，单独排除
    if (/^find\b/.test(seg) && /(\s|=)(-delete|-exec|-execdir|-fprint|-fprintf)\b/.test(seg)) {
      return `find 子命令含破坏性参数（${seg.slice(0, 60)}）`;
    }
    // v0.13.9 sed 读形态：无就地编辑参数且脚本无 w 写命令 = 纯读取（stdout 打印）
    if (/^sed\b/.test(seg)) {
      if (/(^|\s)(-{1,2}i\b|-i\S|--in-place)/.test(seg)) {
        return `sed 含就地编辑参数（${seg.slice(0, 60)}）`;
      }
      const unquoted = seg.replace(/'[^']*'|"[^"]*"/g, ' ');
      if (/'[^']*\bw\b[^']*'/.test(seg) || /"[^"]*\bw\b[^"]*"/.test(seg) || /\bw\s+\S/.test(unquoted)) {
        return `sed 脚本疑似含 w 写命令（${seg.slice(0, 60)}）`;
      }
      continue;   // 只读段
    }
    // v0.13.9 apply_patch heredoc：按载荷目标分类（规则 1 工具通道语义对齐）
    if (/^apply_patch\b/.test(seg)) {
      if (payload == null) return `apply_patch 无 heredoc 载荷（目标未知，保守拦截：${seg.slice(0, 40)}）`;
      const paths = patchTargets(payload);
      const bad = paths.find(p => classifyFile(p) === 'code');
      if (bad) return `apply_patch 载荷含业务代码目标（${bad}）`;
      if (!allowDocWrites && paths.length > 0) return `apply_patch 写载荷（${paths[0]}）——当前模式禁写`;
      continue;   // 文档目标（或空载荷）→ 放行
    }
    const ok = READONLY_PREFIXES.some(rx => rx.test(seg));
    if (!ok) return `非只读命令段（${seg.slice(0, 60)}）`;
  }
  return null;
}

/**
 * v0.13.3 shell 写目标提取（防绕过）：从 shell 命令中提取重定向目标与常见
 * 写命令的文件参数，供规则 0e 做运行时状态命中检查。
 * 设计约束：
 *   - 只提取「写形态」（> >> 2> 2>> &> 重定向目标；tee/rm/truncate/shred 全部
 *     文件参数；cp/install/mv 目标参数（mv 源也被移走 = 破坏信任锚，全参数））
 *   - 误提取无害：引号内的 > 等形态可能误判出额外路径，但只要不命中
 *     RUNTIME_STATE 正则就不产生任何影响（读取形态 cat/ls/rg/grep 不提取）
 *   - v0.13.4：提取结果与判定均经 normSep 规范化（Windows 反斜杠路径不逃逸）
 *   - v0.13.11 引号感知升级：引号内的 > / | 不再误提取（搜索模式文本）；
 *     引号包裹的写目标（`rm '.sdlc/state.json'`）剥引号后真实命中（此前
 *     token 含引号字符逃逸锚定正则——预存漏判修复）；已知边界：含空格的
 *     引号路径拆词后两半均不命中（罕见，预存行为，误提取无害方向）
 */
function shellWriteTargets(cmd) {
  const c = String(cmd || '');
  const out = [];
  // 1. 输出重定向目标（引号外 > / >> / >&file 的目标，剥引号）
  //    v0.13.9 复用 extractRedirectTargets（单一事实源；v0.13.11 升级词法）
  out.push(...extractRedirectTargets(c));
  // 2. 拆段后的写命令参数（v0.13.11 引号感知切分 + 参数剥引号）
  const segments = splitShellSegments(c).map(s => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const parts = seg.split(/\s+/);
    const head = parts[0];
    if (!head) continue;
    const args = parts.slice(1).map(stripQuotes).filter(x => x && !x.startsWith('-'));
    if (head === 'tee' || head === 'tee.exe') {
      out.push(...args); // tee 的所有非选项参数都是写目标
    } else if (head === 'rm' || head === 'truncate' || head === 'shred') {
      out.push(...args);
    } else if (head === 'cp' || head === 'cp.exe' || head === 'install') {
      if (args.length > 0) out.push(args[args.length - 1]); // 目标是末参数（多源复制时为目录，命中也无害）
    } else if (head === 'mv' || head === 'mv.exe') {
      out.push(...args); // 源被移走同样破坏信任锚，全参数
    } else if (head === 'dd') {
      for (const a of parts.slice(1)) { if (/^of=/.test(a)) out.push(stripQuotes(a.slice(3))); }
    }
  }
  return out;
}

// ─────────────────────────────────────────────
// 规则 0：运行时状态文件 — 任何阶段、任何项目一律 block（v0.4.0 新增，v0.5.0 扩展）
// ─────────────────────────────────────────────
if (isWriteOp && targetClasses.includes('runtime_state')) {
  const st = targets[targetClasses.indexOf('runtime_state')];
  block(`[ai-sdlc] 禁止直接编辑运行时状态/隔离索引文件 \`${st}\`。\n` +
    `此类文件是门禁与隔离的信任锚点：plan_accepted / test_pass / release_approval\n` +
    `等授权标志在 state.json；session-map/tasks.json/cycles.json 决定多会话/多任务\n` +
    `隔离路由；quick-tasks.json 是临时任务队列——agent 手工编辑等于自我授权
    绕过门禁、污染隔离或伪造排队状态。\n` +
    `请改用受控接口：\n` +
    `  - 接受计划：mcp__sdlc-orchestrator__accept_plan（MCP 不可用时：\n` +
    `    node ${PLUGIN_ROOT}/hooks/scripts/accept-plan.mjs 或 bash ${PLUGIN_ROOT}/scripts/sh/sdlc.sh accept）\n` +
    `  - 修复模式：mcp__sdlc-orchestrator__set_fix_mode\n` +
    `  - 发布授权：mcp__sdlc-orchestrator__approve_release\n` +
    `  - 变更工单：mcp__sdlc-orchestrator__set_change_ticket\n` +
    `  - 阶段覆盖：mcp__sdlc-orchestrator__set_stage\n` +
    `  - 任务/周期：mcp__sdlc-orchestrator__task_* / new_cycle 工具（用户自然语言即触发）\n` +
    `  - 临时任务队列：mcp__sdlc-orchestrator__quick_task 工具（用户自然语言即触发）\n` +
    `  - 手工修改：用户可直接在编辑器中修改（不经过 agent 工具调用）\n` +
    `完整策略见插件 docs/write-policy.md 与 docs/lifecycle.md。`);
}

// ─────────────────────────────────────────────
// 规则 0e（v0.13.3）：shell 写通道加固 —— 经 Bash 重定向/写命令触碰运行时状态
//   一律 block。背景：规则 0 只覆盖 Edit/Write/apply_patch 的 file_path 通道，
//   `echo ... > .sdlc/state.json` 经 shell 重定向可绕过（自我授权/污染隔离/
//   伪造票据/篡改 MCP 启动指针）。本规则补齐该通道：
//   - shellWriteTargets 提取重定向目标与写命令参数（误提取无害——非运行时
//     路径不命中）；读取形态（cat/ls/rg/grep）不提取不受影响
//   - engagement 无关（信任锚点保护，与规则 0 同级）；拦截面与规则 0 的
//     RUNTIME_STATE_RES 完全同源
// ─────────────────────────────────────────────
const shellWriteHit = (isShellTool && command)
  ? shellWriteTargets(command).find(p => RUNTIME_STATE.test(p)) || null
  : null;
if (shellWriteHit) {
  block(`[ai-sdlc] 禁止经 shell 重定向/写命令触碰运行时状态文件 \`${shellWriteHit}\`。\n` +
    `此类文件是门禁与隔离的信任锚点（state.json 的授权标志、session-map/tasks 的\n` +
    `隔离路由、quick-tasks 队列、mcp-launcher.json 的 MCP 启动指针、events/audit\n` +
    `审计链）——绕过受控接口直接写等于自我授权、污染隔离或伪造审计。\n` +
    `请改用受控接口（mcp__sdlc-orchestrator__ 工具，用户自然语言即触发）：\n` +
    `  - 状态查询：status；生命周期操作：new_cycle / task_* / quick_task\n` +
    `  - 手工修改：用户可直接在编辑器中修改（不经过 agent 工具调用）\n` +
    `完整策略见插件 docs/write-policy.md 与 docs/lifecycle.md。`);
}

// ─────────────────────────────────────────────
// 规则 0d（v0.13.2）：跨平台脚本护栏 —— hook 层监测环境，约束脚本调用
//   防止「注定失败」的命令进入执行（Windows 无 bash 跑 install-prompts.sh、
//   无 pwsh 的 macOS/Linux 跑 install-prompts.ps1 均会直接报错）。
//   能力探测见 lib/env.mjs（PATH 扫描 + Git Bash/WSL 常见落点；单次 < 1ms）。
//   与 engagement 无关（纯错误预防，非工作流门禁）；误伤面：只匹配执行
//   形态（launcher / 段首 .sh/.ps1），cat/ls/grep 读取与 node *.mjs 不拦。
// ─────────────────────────────────────────────
const envProfile = detectEnvironment();
const scriptViolation = (isShellTool && command)
  ? scriptPlatformViolation(command, envProfile)
  : null;
if (scriptViolation) {
  block(scriptGuardMessage(scriptViolation, envProfile));
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 规则 0b：v0.7.0 修复循环中断门禁（fix_loop）—— 阻断「继续自动修下去」
//   循环检测命中（同签名重复 A→A / A→B→A / 轮次超限）后，agent 继续改业务
//   代码 = 在原地打转。必须先向用户呈现循环证据并等待决策（MCP loop_resolve
//   工具）。文档写入放行（写新 intent.md / 更新 plan 是合法
//   逃生路径）；测试命令是 Bash 执行（不经写入门禁，允许重跑取证）。
//   fix_loop 由 hook 置位 + state.json 受规则 0 保护（agent 无法伪造/清除）。
// ─────────────────────────────────────────────
if (decision === 'allow' && state.fix_loop && isWriteOp) {
  const loop = state.fix_loop;
  const codeTargets = targets.filter((p, i) => targetClasses[i] === 'code');
  if (codeTargets.length > 0) {
    const listed = codeTargets.map(p => '`' + p + '`').join('、');
    // v0.7.0 扫描轮 3：未参与工作流时降级 warn（防御性兜底——置位侧已门控；
    // 与全部 block 级门禁的 engagement 语义一致）
    if (!engaged) {
      warn('[ai-sdlc] 检测到疑似修复循环（' + loop.kind + '，连续失败 ' + loop.rounds + ' 轮），但本项目未启用 ai-sdlc 工作流，本次仅提醒不拦截。\n' +
        '若要启用循环中断门禁：写入 intent.md / spec.md / plan.md 任一工件，或调用任一 mcp__sdlc-orchestrator__ 工具；\n' +
        '若不希望再看到此提醒：删除 .sdlc/ 目录即可。');
    } else block('[ai-sdlc] 检测到修复循环，已中断自动修复（fix_loop: ' + loop.kind + '）。\n' +
      '同一测试失败已重复出现（或本周期已连续 ' + loop.rounds + ' 轮未收敛），继续自动修改\n' +
      '代码大概率在原地打转（A→B→A）。本次试图修改：' + listed + '。\n' +
      '请**停止自动修复**，把循环证据呈报给用户并等待决策：\n' +
      '  - 失败摘要：' + String(loop.summary || '见 state.test_failures').slice(0, 120) + '\n' +
      '  - 已连续失败轮次：' + loop.rounds + '\n' +
      '用户决策通道（任选其一）：\n' +
      '  - loop_resolve({decision:"retry"})      —— 用户判断可修复，允许再修一轮\n' +
      '  - loop_resolve({decision:"new-intent"})   —— 把失败作为 incident 开启下一个 intent 周期\n' +
      '  - loop_resolve({decision:"manual"})       —— 用户接管手工修复（agent 转只读协助）\n' +
      '  - loop_resolve({decision:"escalate"})     —— 升级人工/更高层处理\n' +
      '注意：写文档（intent.md / plan.md 等）不受本门禁限制——若判定问题属需求/\n' +
      '设计缺口，可在向用户呈报后更新工件说明。完整标准见插件 docs/lifecycle.md。');
  }
}

// ─────────────────────────────────────────────
// 规则 0b 扩展：fix_loop 状态下的 Bash 加固（v0.7.0 扫描轮 2）
//   写操作类工具（Edit/Write/apply_patch）已由上方拦截；Bash 侧的写类
//   命令（重定向 `echo x > src/app.js`、命令替换、非只读段）同样拦截——
//   与 plan 模式 v0.4.0 加固同类漏洞的对称防御。
//   豁免：测试命令（重跑取证）+ 只读命令（git status / ls / cat …）。
// ─────────────────────────────────────────────
if (decision === 'allow' && state.fix_loop && engaged && isShellTool && command) {
  const testCmd = isTestCommand(command);
  if (!testCmd) {
    const violation = bashWriteViolation(command);
    if (violation) {
      block('[ai-sdlc] 修复循环中断期间禁止执行写类/非只读 Bash 命令。\n' +
        '违规原因：' + violation + '\n' +
        '当前命令：`' + command.slice(0, 300) + '`\n' +
        '中断状态下的合法操作：只读命令（git status/diff、ls/cat/rg）与测试命令\n' +
        '（make test / npm test / pytest 等，用于取证）。修改代码必须等待用户决策：\n' +
        'MCP loop_resolve({decision:"retry|new-intent|manual|escalate"})（用户自然语言如「重试一轮」即触发）。');
    }
  }
}

// 规则 1：plan 模式禁改业务代码（Stage 3a BUILD_PLAN）
// v0.4.0 变更：白名单式放行文档；仅拦业务代码类；未参与工作流降级 warn
// ─────────────────────────────────────────────
if (decision === 'allow' && detection.stage === 'build_plan' && isWriteOp) {
  const codeTargets = targets.filter((p, i) => targetClasses[i] === 'code');
  if (codeTargets.length > 0) {
    const listed = codeTargets.map(p => `\`${p}\``).join('、');
    if (engaged) {
      block(`[ai-sdlc] 当前在 plan 模式（Stage 3a BUILD_PLAN），禁止修改业务代码。\n` +
        `这是 Anthropic playbook 的硬约束："Codex 在工程师接受计划前无法编辑代码"。\n` +
        `本次试图修改：${listed}。\n` +
        `请先生成并提交 \`plan.md\`，工程师通过 mcp__sdlc-orchestrator__accept_plan\n` +
        `接受后进入 Stage 3b（实施）才能改代码（用户已明确表达接受但 MCP 工具\n` +
        `不可用时，受控 CLI 回退：bash ${PLUGIN_ROOT}/scripts/sh/sdlc.sh accept）。\n` +
        `文档（*.md / *.txt 等）不受此限制——计划阶段的本职产出就是文档。\n` +
        `若本项目不再需要 ai-sdlc 门禁：删除 \`.sdlc/\` 或调 MCP reset。`);
    } else {
      warn(`[ai-sdlc] 检测到 \`spec.md\` 存在而 \`plan.md\` 不存在（疑似 plan 模式），\n` +
        `但本项目未启用 ai-sdlc 工作流（state.sdlc_engaged 未设置），本次仅提醒不拦截。\n` +
        `涉及目标：${listed}。\n` +
        `若要启用完整门禁：让 agent 写入 intent.md / spec.md / plan.md 任一工件，\n` +
        `或调用任一 mcp__sdlc-orchestrator__ 工具（如 status）。若不希望再看到此提醒：删除 \`.sdlc/\` 目录即可。`);
    }
  }
}

// ─────────────────────────────────────────────
// 规则 1b：plan 模式 Bash 只读白名单（v0.4.0 加固）
// ─────────────────────────────────────────────
if (decision === 'allow' && detection.stage === 'build_plan' && isShellTool && command) {
  // v0.13.9 allowDocWrites：文档/spec 目标的写形态（apply_patch heredoc 载荷、
  //   重定向）按规则 1 工具通道语义放行——plan 阶段本职产出就是文档；
  //   代码目标仍拦（具名提示）。sed 读形态与 /dev/null 汇全局放行。
  // v0.13.11 allowControlledAccept：受控接受 CLI 段豁免（MCP 不可用时的
  //   回退通道——用户已明确表达接受时 agent 记录接受的唯一合法 Bash 形态；
  //   路径精确匹配插件安装根，advance/reset 等其他子命令不豁免）
  // v0.13.12 allowControlledProbe：受控探测 CLI 段豁免（setup-playwright
  //   --check 只读环境检测——安装入口 --install 不豁免，Stage 3b 起才合法）
  const violation = bashWriteViolation(command, { allowDocWrites: true, allowControlledAccept: true, allowControlledProbe: true });
  if (violation) {
    if (engaged) {
      block(`[ai-sdlc] plan 模式禁止执行写类/非只读 Bash 命令。\n` +
        `违规原因：${violation}\n` +
        `当前命令：\`${command.slice(0, 300)}\`\n` +
        `plan 模式允许：只读操作（git status/log/diff、ls/cat/rg、sed -n、\n` +
        `--version/--help、make -n 等；引号内的 | > $ \` 是搜索模式字面量，\n` +
        `合法）与文档产出（plan.md 等经 Write/Edit/\n` +
        `apply_patch 工具，或 apply_patch heredoc / 重定向到文档目标）。\n` +
        `业务代码修改需等 accept_plan 后（Stage 3b）——用户已明确表达接受时：\n` +
        `MCP \`accept_plan\` 工具，或受控 CLI 回退 \`bash ${PLUGIN_ROOT}/scripts/sh/sdlc.sh accept\`\n` +
        `（仅 accept 子命令豁免；勿手改 .sdlc/state.json，会被拦截）。\n` +
        `白名单见 docs/write-policy.md。`);
    } else {
      warn(`[ai-sdlc] 疑似 plan 模式下的非只读命令（未启用工作流，仅提醒不拦截）：\n` +
        `${violation}。命令：\`${command.slice(0, 160)}\``);
    }
  }
}

// ─────────────────────────────────────────────
// 规则 2：修复期禁改测试文件（in_fix_mode，v0.13.10 并集阶段判定）
//   in_fix_mode 只能由 MCP set_fix_mode 设置 → 本身即工作流参与证据，直接硬拦。
//   阶段判定取并集：测试失败后存在未提交 diff 时 detection=test，但保存值
//   仍在 build_impl——仅看检测值会在修复循环窗口（本规则的核心场景）漏拦。
// ─────────────────────────────────────────────
if (decision === 'allow' && stageSet.has('build_impl') && state.in_fix_mode) {
  const testTargets = targets.filter(p => TEST_FILE.test(p));
  if (isWriteOp && testTargets.length > 0) {
    block(`[ai-sdlc] 修复模式（in_fix_mode=true）禁止修改测试文件。\n` +
      `这是 Anthropic playbook 的核心控制："修复代码的代理不能削弱对该代码的检查"。\n` +
      `当前试图修改：\`${testTargets.join('、')}\`。\n` +
      `若测试本身有 bug：先 mcp__sdlc-orchestrator__set_fix_mode(false) 退出修复模式，\n` +
      `更新测试并说明原因，再重新进入修复模式。`);
  }
}

// ─────────────────────────────────────────────
// 规则 3：无变更工单禁改迁移/基础设施（Stage 5 DEPLOY，v0.13.10 并集阶段判定——
//   提交后 detection 跌回 build_impl 而保存值在 deploy 的窗口同拦）
// ─────────────────────────────────────────────
if (decision === 'allow' && stageSet.has('deploy')) {
  const migTargets = targets.filter(p => MIGRATION_PATH.test(p) || MIGRATION_EXT.test(p));
  if (isWriteOp && migTargets.length > 0 && !state.change_ticket) {
    block(`[ai-sdlc] Stage 5 DEPLOY 阶段修改迁移/基础设施文件需要变更工单。\n` +
      `当前 state.change_ticket 未设置。\n` +
      `请先通过 MCP 工具 \`mcp__sdlc-orchestrator__set_change_ticket\` 设置工单号，\n` +
      `再修改 \`${migTargets.join('、')}\`。`);
  }
}

// ─────────────────────────────────────────────
// 规则 4：生产部署授权（Stage 5 DEPLOY，v0.13.10 并集阶段判定——
//   提交后 detection 跌回 build_impl 而保存值在 deploy 的窗口同拦）
// ─────────────────────────────────────────────
if (decision === 'allow' && stageSet.has('deploy') && isShellTool && command) {
  const cmd = command.toLowerCase();
  if (cmd.includes('deploy') && cmd.includes('production') && !state.release_approval) {
    block(`[ai-sdlc] 生产部署需要发布授权。\n` +
      `当前 state.release_approval 未设置。\n` +
      `请发布管理员通过 MCP 工具 \`mcp__sdlc-orchestrator__approve_release\` 设置授权。\n` +
      `当前命令：\`${command.slice(0, 100)}\`。`);
  }
}

// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// 规则 4b：v0.7.0 测试门禁——未通过测试禁止 push / PR
//   「plan 接受并实施后必须先真实运行测试」：测试未通过（!state.test_pass）
//   时阻断 git push / gh pr create。阶段取保存值与检测值的并集——diff 提交后
//   检测会跌回 build_impl，但保存值仍在 test；任一侧命中即拦（防漏）。
//   fix_loop 状态下同样拦截——测试门禁不因循环中断而放宽（未测试的代码
//   永远不能推送）；循环处置引导由规则 0b 的 block 文案承担。
// ─────────────────────────────────────────────
if (decision === 'allow' && isShellTool && command) {
  const isPushOrPr = /\b(git\s+push|gh\s+pr\s+create)\b/.test(command);
  if (isPushOrPr) {
    const stageSet = new Set([state.current_stage, detection.stage].filter(Boolean));
    const inBuildOrTest = stageSet.has('build_impl') || stageSet.has('test');
    if (!state.test_pass && inBuildOrTest && !engaged) {
      // v0.7.0 扫描轮 3：未参与工作流 → warn 降级（仓库恰有 plan.md+diff 的误伤面）
      warn('[ai-sdlc] 疑似 SDLC 测试门禁场景（plan 已落地且有 diff、测试未通过），\n' +
        '但本项目未启用 ai-sdlc 工作流，本次仅提醒不拦截推送。\n' +
        '若要启用完整门禁：写入 intent.md / spec.md / plan.md 任一工件，或调用任一 mcp__sdlc-orchestrator__ 工具；\n' +
        '若不希望再看到此提醒：删除 .sdlc/ 目录即可。');
    }
    if (!state.test_pass && inBuildOrTest && engaged) {
      const hint = (state.test_runs || 0) === 0
        ? '尚未运行过任何测试——请先运行测试套件。'
        : '上次测试退出码 ' + (state.last_test_exit_code ?? '未知') + '——请先修复（修代码不修测试），或 MCP new_cycle 把失败作为新 intent。';
      block('[ai-sdlc] 测试门禁：测试尚未通过，禁止推送/创建 PR。\n' +
        'playbook 硬约束：plan 接受并实施后必须先运行测试（make test / npm test /\n' +
        'pytest 等）且全绿，才能 git push / gh pr create。\n' +
        '当前状态：test_pass=' + state.test_pass + '，本周期测试执行次数=' + (state.test_runs || 0) + '。\n' +
        hint + '\n' +
        '若同一失败反复出现（修复循环），插件会自动中断并引导用户决策。\n' +
        '若项目确实无测试套件：补最小冒烟测试，或经用户明确同意后调 MCP advance 推进（逃生通道）。');
    }
  }
}

// ─────────────────────────────────────────────
// 规则 0c（v0.10.0）：工件落位护栏——在 .sdlc/ 工作区外**新建**阶段工件时提醒。
//   工件是任务推进的中间产物（不进版本控制）：默认落 `.sdlc/artifacts/<name>`
//   （任务隔离模式：`.sdlc/tasks/<id>/<name>`）。仅对「新建」提醒——
//   存量项目根目录/docs/ 已有同名工件时静默放行（legacy 延续，检测/归档照常）。
//   warn 不 block：落位错误不影响推进链（候选表兼容根目录），只损失整洁。
// ─────────────────────────────────────────────
if (decision === 'allow' && isWriteOp) {
  const ARTIFACT_BASENAMES = ['intent.md', 'spec.md', 'plan.md', 'review.md'];
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const lower = basename(p).toLowerCase();
    if (!ARTIFACT_BASENAMES.includes(lower)) continue;
    if (/(^|\/)\.sdlc\//.test(p)) continue;                 // 工作区内 → 正确落位
    if (ARCHIVE_PATH.test(p)) continue;                      // 归档目录 → 规则 5c 负责
    if (fileExists(resolve(projectRoot, p))) continue;       // 存量工件更新 → legacy 延续
    const suggested = scope.mode === 'task' && scope.taskRel
      ? `${scope.taskRel}/${basename(p)}`
      : `.sdlc/artifacts/${basename(p)}`;
    warn(`[ai-sdlc] 你正在 \`.sdlc/\` 工作区之外新建工件 \`${p}\`。\n` +
      `v0.10.0 起工件是任务推进的中间产物，不进版本控制：\n` +
      `请写入 \`${suggested}\`。\n` +
      `（存量项目根目录的同名工件仍可更新与检测——本次仅提醒不拦截）`);
    break;
  }
}

// 规则 5a：机构知识工件 warn（任何阶段，放行）
// ─────────────────────────────────────────────
if (decision === 'allow' && isWriteOp && targetClasses.includes('knowledge')) {
  const kt = targets[targetClasses.indexOf('knowledge')];
  warn(`[ai-sdlc] 你正在修改机构知识文件 \`${kt}\`。\n` +
    `按 playbook 治理要求，此类文件修改应经代码所有者审查（建议走 PR 流程）。\n` +
    `例外：Codex 同样错误犯两次后的自我纠正（playbook 明确允许），可继续。`);
}

// ─────────────────────────────────────────────
// 规则 5b：已接受规格 spec.md 漂移 warn（build 之后阶段）
//   意图：需求变更应回 design 阶段走变更流程，而非实施中途改规格
// ─────────────────────────────────────────────
if (decision === 'allow' && isWriteOp
    && ['build_plan', 'build_impl', 'test', 'deploy'].includes(detection.stage)) {
  const specIdx = targets.findIndex((p, i) => targetClasses[i] === 'spec' && basename(p).toLowerCase() === 'spec.md');
  if (specIdx >= 0) {
    warn(`[ai-sdlc] 你正在 build/test/deploy 阶段修改 \`${targets[specIdx]}\`。\n` +
      `spec.md 是已被接受的规格工件，实施中途修改属于需求漂移。\n` +
      `若需求确已变化：回到 design 阶段走变更流程（更新 spec.md 并同步 plan.md），\n` +
      `并在提交说明中记录变更原因。若只是笔误修正，可继续。`);
  }
}

// ─────────────────────────────────────────────
// 规则 5c：周期归档目录 warn（v0.5.0：审计链保护，放行 + 提醒）
//   归档目录内存放历史周期工件与 cycle-meta.json，是审计追踪的一部分。
//   追加新条目（hook/MCP 归档动作）不经 agent 工具调用；agent 直接改写
//   历史归档应说明原因（合规留痕），故 warn 不 block。
// ─────────────────────────────────────────────
if (decision === 'allow' && isWriteOp && targetClasses.includes('archive')) {
  const at = targets[targetClasses.indexOf('archive')];
  warn(`[ai-sdlc] 你正在修改周期归档目录内的文件 \`${at}\`。\n` +
    `归档目录（.sdlc/archive/ 默认；docs/sdlc/archive/ 为历史兼容）保存历史周期的工件与元数据，\n` +
    `属于审计追踪链——改写历史记录应说明原因。\n` +
    `若只是查阅：改用只读操作即可。完整生命周期标准见 docs/lifecycle.md。`);
}

// ─────────────────────────────────────────────
// 规则 0f（v0.13.12）：沙盒授权预警 —— 网络访问/端口监听类命令放行前的
//   授权应对协议注入（warn/additionalContext，每会话去重一次）。
//   背景（用户实测）：curl 等网络命令、dev server 等端口监听命令在 Codex
//   沙盒下默认被拒——这是平台安全机制（非本插件门禁）。agent 被拒后的
//   正确动作是向用户呈报命令与目的、请求授权提权运行，而不是反复重试
//   或尝试绕过。本层是预防性教育（放行时注入）；配套证据层在 PostToolUse
//   （失败输出特征 → hooks-state.sandbox_denied）与提醒层在
//   UserPromptSubmit（下回合针对性提醒）——三层联动。
//   位置在全部 block 级门禁之后：被门禁拦截的命令不会执行，无需预警；
//   与其他 warn 类规则的互斥：单次输出仅一条 additionalContext，先命中
//   者优先（warn 只在 allow 时生效）——门禁类 warn 优先于本预警，可接受。
// ─────────────────────────────────────────────
let sandboxWarnKind = null;
let approvalNotifyReason = null;
if (decision === 'allow' && isShellTool && command) {
  const kind = netPortKind(command);
  if (kind) {
    const hs = readHooksStateForSession(scope, input.session_id || null);
    if (!hs.sandbox_protocol_shown) {
      sandboxWarnKind = kind;
      warn(sandboxWarnText(command, kind, PLUGIN_ROOT));
      try {
        mutateCodexState(scope, 'hooks-state.json', (cur) => {
          const c = cur || {};
          // 去重标记仅对同一会话生效（接管语义与 readHooksStateForSession/
          //   user-prompt-submit 一致：新会话重新预警一次，无害且防残留）。
          //   session_id 必须随标记落盘——否则去重退化为全局去重，接管重置
          //   失效（v0.13.12 测试发现）
          if (!input.session_id || !c.session_id || c.session_id === input.session_id) {
            if (!c.session_id && input.session_id) c.session_id = input.session_id;
            c.sandbox_protocol_shown = true;
            c.sandbox_protocol_shown_at = new Date().toISOString();
          }
          return c;
        });
      } catch { /* 标记写失败仅影响去重（多预警一次），方向安全 */ }
    }
    // v0.13.13 审批等待通知（预测式，用户召回）：网络/端口命令即将触发
    //   Codex 审批弹窗（y/esc）——任务静默暂停且 Stop 通知覆盖不到（回合
    //   未结束）。与上方 agent 教育文案的去重相互独立：文案面向 agent 每会话
    //   一次足够；通知面向用户按「在场窗口」去重（PostToolUse 在命令完成时
    //   刷新 netport_last_exec_at——刚批准/拒过 = 人在终端，默认 120s 内静默）。
    //   notifyApprovalWait 内部 fire-and-forget，绝不阻塞本 hook。
    const ap = notifyApprovalWait({
      command, kind,
      lastNetPortAt: typeof hs.netport_last_exec_at === 'number' ? hs.netport_last_exec_at : null,
    });
    approvalNotifyReason = ap.reason;
  }
}

// ─────────────────────────────────────────────
// 输出
// ─────────────────────────────────────────────
appendAudit(scope, {
  hook: 'pre_tool_use', trigger: 'PreToolUse',
  duration_ms: Date.now() - t0,
  result: decision,
  detail: {
    tool: toolName, file: filePath, command_preview: command.slice(0, 80),
    stage: detection.stage, severity, engaged,
    scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
    target_classes: targetClasses,
    patch_targets: toolInput.patch ? patchTargets(toolInput.patch).length : 0,
    script_guard: scriptViolation ? scriptViolation.kind : undefined,
    shell_state_guard: shellWriteHit || undefined,
    sandbox_warn: sandboxWarnKind || undefined,
    approval_notify: approvalNotifyReason || undefined,
    env: (isShellTool && command) ? {
      platform: envProfile.platformLabel,
      posix_shell: envProfile.hasPosixShell,
      powershell: envProfile.hasPowerShell,
    } : undefined,
  },
});

if (decision === 'block') {
  // exit code 2 表示阻止，stderr 进 agent 上下文（Codex hooks 协议）
  process.stderr.write(reason + '\n');
  process.exit(2);
}

if (decision === 'warn') {
  emitHookOutput({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: reason,
    },
  });
} else {
  emitHookOutput({});
}
