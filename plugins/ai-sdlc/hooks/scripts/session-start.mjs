#!/usr/bin/env node
/**
 * session-start.mjs — SessionStart hook（触发点 1/6）
 *
 * 设计原则（与 Anthropic playbook 对齐）：
 *   - **零显式注入**：用户不需要 @ 插件，不需要 slash 命令
 *   - 工件驱动：扫描仓库中已提交的 intent.md / spec.md / plan.md / REVIEW.md / AGENTS.md
 *   - 自动检测当前 SDLC 阶段并写入 scope 内 state.json
 *   - 只注入资源索引（~1KB）+ 当前阶段判定 + 缺失工件清单
 *   - 具体阶段规则由 user-prompt-submit 按需注入（首次进入该阶段时）
 *
 * v0.5.0 生命周期（详见插件 docs/lifecycle.md）：
 *   - 四级作用域路由：env SDLC_TASK > session-map 绑定 > resume 续绑 > legacy
 *   - 工件永不自动删除；周期结束由 new_cycle 归档轮转
 *   - 多会话隔离：新会话不自动吸附活跃任务（防污染），注入切换提示
 *
 * v0.10.0 首次使用自动初始化：
 *   - ensureProjectBootstrap（幂等）：state.json 全 schema + .gitignore/.codexignore
 *     托管块——用户无需手动 init，首次会话即完成初始化并注入声明
 *   - 工件工作区化：intent/spec/plan/REVIEW 落 .sdlc/ 工作区（不进版本控制），
 *     任务/周期结束归档至 .sdlc/archive/
 *
 * v0.12.0 输入分流（Input Triage，详见 rules/triage.md）：
 *   - 注入三分类协议（需求/ISSUE→SDLC；补充信息→融入当前工件；临时任务→不混入周期）
 *   - 队列状态提示：周期进行中→排队中；无周期→可直接处理
 *
 * v0.13.1（prompts 注册跨平台化 + 悬空引用修复）：
 *   - 补注入「意图→工具映射」真实表格（v0.13.0 仅在首用/治理段引用而未注入，
 *     属悬空引用——自然语言即命令的主通道锚点自此完整）
 *   - hook 自检官方 /prompts: 注册状态（未注册→一行跨平台指引：MCP
 *     register_prompts 主通道 / sh、ps1 平台脚本备选；已注册→静默）
 *
 * v0.13.2（hook 层环境自检 + 零操作）：
 *   - 运行环境画像注入（lib/env.mjs：平台 + POSIX shell / PowerShell 能力
 *     探测）：本机不可用的脚本形态直接告知 agent 勿调用（防报错），
 *     PreToolUse 侧另有能力感知护栏拦截漏网调用
 *   - 手册自动注册（ensurePromptsRegistered）：未注册/升版 → 自动刷新，
 *     使用者零操作；显式卸载（opt-out 标记）与 SDLC_PROMPTS_AUTO=off 静默尊重；
 *     替代 v0.13.1 的「未注册→提示 agent 引导用户手动注册」路径
 *
 * v0.13.3（MCP 启动链修复，详见插件 docs/architecture.md）：
 *   - writeMcpLauncherPointer()：把插件根/项目根写入 .sdlc/mcp-launcher.json，
 *     为 .mcp.json 内联 bootstrap（node -e 自定位引导）提供解析锚点。
 *     背景：Codex 以用户启动目录为插件 MCP 子进程 cwd、.mcp.json 相对 args
 *     按该 cwd 解析且不插值 ${VAR}（openai/codex#19582/#22842）——相对路径
 *     形式在真实插件安装下 ENOENT，MCP server 起不来。指针受 PreToolUse
 *     写保护（RUNTIME_STATE_RES），防 agent 改写重定向 MCP 加载路径。
 *
 * 输入（stdin JSON）：
 *   { session_id, transcript_path, cwd, hook_event_name: "SessionStart", source }
 *
 * 输出（stdout JSON）：
 *   { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "摘要" } }
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseInput, projectRootOf, emitHookOutput, appendAudit, appendEvent,
  readCodexState, writeCodexState, PLUGIN_ROOT, resolveScope, listTasks, appendGlobalAudit,
  writeMcpBindTicket, writeMcpLauncherPointer, ensureProjectBootstrap, defaultState,
  queuedQuickTasks, ensurePromptsRegistered, mutateCodexState,
} from './lib/common.mjs';
import { detectEnvironment, envSummaryLine, envConstraintLines } from './lib/env.mjs';
import { detectStage, STAGES, STAGE_BY_ID, findArtifact } from './lib/stage-detector.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

// v0.10.0 首次使用自动初始化（幂等引导，先于作用域路由——state/tasks 读取依赖它）：
//   state.json 全 schema 落盘 + .gitignore/.codexignore 托管块（.sdlc/ 不进版本控制）。
//   每次启动均执行（兼存量项目治愈：老版本 .sdlc/ 缺忽略块时补齐）；代价为数个 existsSync。
const bootstrap = ensureProjectBootstrap(projectRoot);

// 0. v0.5.0 作用域路由（多会话/多任务隔离核心）
const scope = resolveScope(projectRoot, input);

// 0b. v0.6.0 MCP 会话票据：供本会话 spawn 的 MCP server 进程认领会话身份。
//     stdio MCP 协议不携带 session 标识——靠队列 FIFO 1:1 配对实现
//     MCP 侧会话隔离（详见 docs/lifecycle.md「MCP 会话隔离」）。
//     startup/resume/clear 均写（幂等；孤儿票由认领方 10 分钟超时清理）。
if (input.session_id) {
  writeMcpBindTicket(projectRoot, {
    sessionId: input.session_id,
    source: input.source || 'startup',
    taskId: scope.taskId,
  });
}

// 0c. v0.13.3 MCP 启动器指针：为 .mcp.json 内联 bootstrap（node -e）提供解析
//     锚点（bootstrap 解析链：SDLC_PLUGIN_ROOT env > 本指针 > CODEX_HOME/plugins
//     扫描）。指针每次启动幂等刷新（临时文件 + rename 原子写），内容含插件版本
//     （自读 .codex-plugin/plugin.json）。失败不阻塞会话——仅注入一行修复提示
//     （可设 SDLC_PLUGIN_ROOT 显式指定插件根）。
const mcpLauncherWritten = writeMcpLauncherPointer(projectRoot, { pluginRoot: PLUGIN_ROOT });

// 1. 工件扫描 + 阶段自动检测（scope 感知）
const detection = detectStage(scope, { promptHint: '' });

// 2. 读取保存状态（防回归守卫需要保存的 current_stage）
// v0.10.0：回退模板用 common.defaultState 全量 schema（此前局部模板缺 v0.5–v0.9
// 字段——首个 hook 即 session-start 的项目会以残缺 schema 起步）
const prevState = readCodexState(scope, 'state.json') || defaultState();

// v0.5.1（防回归）：git 状态是瞬态的——实施 diff 一旦提交，基于「有 diff」的
// test/deploy 检测就会跌回 build_impl/build_plan，session-start 若无条件把检测值
// 写回 state，会静默回退已推进的阶段（后续 git merge 等事件因 savedStageId 变低
// 而永远无法触发 test→deploy→maintain 推进）。
// 规则：override（用户显式钉住）永远优先；否则保存阶段更靠后时以保存值为准。
// v0.13.5 X-lock：回写锁内执行且锁内重读——双会话同项目并发打开时，另一会话
//   hook/MCP 写入的中间态不再被本会话的旧快照覆盖回退
const STAGE_ORDER = STAGES.map(s => s.id);
mutateCodexState(scope, 'state.json', (cur) => {
  const diskState = cur || prevState;   // 锁内新鲜值；缺失则用本回合读到的 prevState
  const SAVED = STAGE_ORDER.indexOf(diskState.current_stage);
  const DET = STAGE_ORDER.indexOf(detection.stage);
  const effectiveStageId = detection.source === 'state.override'
    || SAVED < 0 || DET < 0 || DET >= SAVED
    ? detection.stage
    : diskState.current_stage;
  diskState.current_stage = effectiveStageId;
  diskState.updated_at = new Date().toISOString();
  diskState.last_session_id = input.session_id || `sess-${Date.now()}`;
  diskState.last_session_started_at = new Date().toISOString();
  return diskState;
});
const effectiveStageId = (() => {
  const SAVED = STAGE_ORDER.indexOf(prevState.current_stage);
  const DET = STAGE_ORDER.indexOf(detection.stage);
  return detection.source === 'state.override'
    || SAVED < 0 || DET < 0 || DET >= SAVED
    ? detection.stage
    : prevState.current_stage;
})();
const stage = STAGE_BY_ID[effectiveStageId] || STAGE_BY_ID[detection.stage];
// v0.13.10 显示一致性：守卫生效（保存阶段更靠后）时，detection 的 source /
//   substage / confidence 属于另一个阶段——直接展示会产出「Stage 6 — Maintain
//   + 子阶段 implementation + 来源 plan+accepted」这类自相矛盾注入。守卫
//   激活时统一呈现守卫说明（含原始检测值供排障），并抑制检测子阶段。
const stageGuardApplied = effectiveStageId !== detection.stage;
const displaySource = stageGuardApplied ? 'stage-guard(saved-newer)' : detection.source;
const displaySubstage = stageGuardApplied ? null : detection.substage;

// v0.13.2 运行环境画像（hook 层监测环境）：能力探测而非 OS 一刀切——
//   Windows 装了 Git Bash/WSL 则 .sh 可用；macOS/Linux 装了 pwsh 则 .ps1 可用。
//   本机不可用的脚本形态在此告知 agent 勿调用（PreToolUse 侧护栏兜底拦截）。
const envProfile = detectEnvironment();

// v0.13.3 MCP 启动器指针写入失败提示（透明声明 + 修复通道；成功时静默）
if (!mcpLauncherWritten) {
  appendEvent(scope, 'mcp_launcher_write_failed', {
    detail: 'writeMcpLauncherPointer returned false (fs error or .sdlc unwritable)',
  });
}

// v0.13.2 手册自动注册（零用户操作）：未注册/升版 → 自动刷新到用户 prompts
//   目录；显式卸载（opt-out 标记）与 SDLC_PROMPTS_AUTO=off 静默尊重。
//   成本：源目录 readdir + ≤ 2N 次 readFileSync（约 1ms 量级）。
const promptsAuto = ensurePromptsRegistered();

// 阶段覆写说明（审计可追溯）：检测与保存冲突时保留更靠后的保存阶段
if (effectiveStageId !== detection.stage) {
  appendEvent(scope, 'stage_guard_applied', {
    detection: detection.stage, kept: effectiveStageId,
    reason: 'saved-stage-newer (git state is transient; diff may be committed)',
  });
}

// 3. 写会话 hooks-state（用于去重 + token 预算追踪）
// v0.13.10：current_substage / stage_source 与上方显示同源（守卫生效时不得
//   写入另一阶段的子阶段/来源，防 hooks-state 诊断字段与实际阶段矛盾）
const hooksState = {
  session_id: input.session_id || `sess-${Date.now()}`,
  session_started_at: new Date().toISOString(),
  last_trigger: 'session_start',
  source: input.source || 'startup',
  current_stage: effectiveStageId,
  current_substage: displaySubstage,
  stage_confidence: detection.confidence,
  stage_source: displaySource,
  scope_mode: scope.mode,
  scope_task_id: scope.taskId,
  project_root: projectRoot,
  plugin_root: process.env.PLUGIN_ROOT || 'self-located',
  injected_files: [],
  hooks_executed: 1,
  cumulative_tokens: 0,
  last_inject_tokens: 0,
};
writeCodexState(scope, 'hooks-state.json', hooksState);

// 4. 事件总线
appendEvent(scope, 'session_start', {
  session_id: hooksState.session_id,
  detail: `stage=${effectiveStageId} confidence=${detection.confidence} source=${detection.source} scope=${scope.mode}${scope.taskId ? ':' + scope.taskId : ''}`,
});
if (scope.bindSource && scope.bindSource !== 'legacy') {
  appendGlobalAudit(projectRoot, {
    hook: 'session_start', trigger: 'SessionStart',
    result: 'scope_bound',
    detail: { session_id: hooksState.session_id, bind: scope.bindSource, task: scope.taskId, mode: scope.mode },
  });
}

// 5. 构建注入摘要（核心：告诉 agent "我们在哪 / 该做什么"）
const lines = [];
lines.push('【ai-sdlc 已激活】本会话由 ai-sdlc 插件注入（Anthropic《AI-Native SDLC playbook》实现）。');
lines.push('');

// v0.10.0 首次使用声明（自监测初始化的结果呈现）
if (bootstrap.firstUse) {
  lines.push('### 首次使用：ai-sdlc 已自动初始化');
  lines.push(`- 已创建 \`.sdlc/\` 工作区${bootstrap.actions.length > 1 ? '（含 ' + bootstrap.actions.slice(1).join('、') + ' 托管块）' : ''}，无需手动 init`);
  lines.push('- 工件（intent/spec/plan/REVIEW）写入 \`.sdlc/artifacts/\`（任务隔离模式：\`.sdlc/tasks/<id>/\`）——**不进版本控制**，属于任务推进的中间产物');
  lines.push('- 任务/周期结束后由 `new_cycle` / `task_close` 归档到 `.sdlc/archive/`（不删除，详见下方意图→工具映射）');
  lines.push('- 回合结束/需要决策时会发系统通知（弹窗+声音）——不想要设环境变量 `SDLC_NOTIFY=off`（详见 docs/usage-guide.md）');
  lines.push('');
}

// v0.5.0 作用域与任务隔离提示
lines.push('### 工作空间（会话隔离）');
if (scope.mode === 'task') {
  const bindText = {
    'env': '环境变量 SDLC_TASK 指定',
    'session-map': '本会话此前已绑定（自动恢复）',
    'resume': '会话恢复（续绑当前活跃任务）',
  }[scope.bindSource] || scope.bindSource;
  lines.push(`- 本会话工作在**任务隔离区** \`${scope.taskRel}\`（${bindText}）`);
  lines.push(`- 该任务的 state / 工件与其他任务完全隔离；阶段门禁按此任务的状态判定`);
  lines.push('- 切换：`task_switch({task_id})`；新建：`task_create({name})`；清单：`task_list`（MCP mcp__sdlc-orchestrator__ 工具，自然语言说"切到任务X/并行开个新任务"即可）');
} else {
  lines.push('- 本会话工作在**项目默认空间**（工件写 `.sdlc/artifacts/`；根目录/docs/ 存量工件仍可检测）');
  if (scope.envMissing) {
    lines.push(`- ⚠️ 环境变量 SDLC_TASK=\`${scope.envMissing}\` 指定的任务不存在，已回退默认空间`);
  }
  const tasks = listTasks(projectRoot).filter(t => t.status === 'active');
  if (tasks.length > 0) {
    const names = tasks.slice(0, 5).map(t => `\`${t.id}\``).join('、');
    lines.push(`- ℹ️ 当前存在 ${tasks.length} 个活跃任务（${names}${tasks.length > 5 ? ' …' : ''}）`);
    lines.push('- 本会话**未绑定**任何任务（默认空间独立工作，互不污染）');
    lines.push('- 若要协作某任务：`task_switch({task_id})`；并行新需求：`task_create({name})`（隔离工件与状态）');
  } else {
    lines.push('- 并行多需求场景建议为每个需求建独立任务：`task_create({name})`');
  }
}
lines.push('');
lines.push('**工件生命周期**：工件（intent/spec/plan/REVIEW）**永不自动删除**，也不进版本控制——会话结束仅存档快照；周期结束（新需求/下一轮迭代）用 `new_cycle` 归档旧工件到 `.sdlc/archive/` 并重置阶段机；任务完结用 `task_close` 归档。标准见插件 docs/lifecycle.md。');
lines.push('');

// v0.12.0 输入分流协议（每会话注入一次完整版；UserPromptSubmit 每回合轻量提醒）
const cycleActiveNow = !!(detection.artifacts.intent || detection.artifacts.spec || detection.artifacts.plan);
lines.push('### 输入分流协议（v0.12.0）');
lines.push('每条用户输入先三分类，再行动（完整标准 `rules/triage.md`）：');
lines.push('- **需求/ISSUE**（新功能/缺陷/改进，将产出交付物）→ 走 SDLC 流程（按当前阶段推进）');
lines.push('- **补充信息**（当前周期的澄清/Open questions 回答/范围约束补充）→ 融入当前阶段工件，不另开流程');
if (cycleActiveNow) {
  lines.push('- **临时任务**（一次性小事，与当前需求无关）→ 登记排队：MCP `quick_task({action:"add", desc})`——**周期走完后统一处理，不得混入当前周期工件或 diff**');
} else {
  lines.push('- **临时任务**（一次性小事）→ 直接处理即可，不落 SDLC 工件、不触发阶段语义');
}
lines.push('- 混合内容拆开处理；拿不准时先问用户一句确认，不得擅自混流');
const queuedAtStart = queuedQuickTasks(projectRoot);
if (queuedAtStart.length > 0) {
  lines.push('- 队列状态：' + queuedAtStart.length + ' 条临时任务待处理（' + (cycleActiveNow ? '当前周期走完后处理' : '无进行中周期，现在即可处理') + '）——`quick_task({action:"list"})` 查看');
}
lines.push('');

// v0.13.0 意图→工具映射表（自然语言即命令的落地锚点）——v0.13.1 补注入：
//   v0.13.0 仅在首用/治理段引用「意图→工具映射」但未实际注入表格（悬空
//   引用），主通道锚点自此完整。完整表与用法见 docs/usage-guide.md。
lines.push('### 意图→工具映射（自然语言即命令，v0.13.0）');
lines.push('用户自然语言表达意图 → agent 调 MCP `mcp__sdlc-orchestrator__` 工具：');
lines.push('| 用户意图（示例） | MCP 工具 |');
lines.push('|---|---|');
lines.push('| 「看进度/下一步做什么」「看 6 阶段全景」 | `status` / `workflow` |');
lines.push('| 「开新周期/旧需求收尾再迭代」 | `new_cycle` |');
lines.push('| 「并行开个新任务」「切到任务 X」「任务收尾」 | `task_create` / `task_switch` / `task_close` |');
lines.push('| 「这事排队，先走完流程」（临时任务，勿混入周期） | `quick_task({action:"add",desc})` |');
lines.push('| 「重试一轮」「我自己来修」（修复循环决策） | `loop_resolve({decision})` |');
lines.push('| 「需求变了，回设计阶段改 spec」 | `set_stage({stage:"design"})` |');
// v0.13.11 补人工门禁三行（此前映射表缺 accept_plan——plan 接受是最高频
//   人工门禁，上下文压缩后 agent 找不到记录接受的通道即死锁；CLI 回退通道
//   随行注入，MCP 工具未暴露时仍可落地）
lines.push('| 「接受/同意/批准这个计划」 | `accept_plan`（MCP 不可用：`bash sdlc.sh accept`） |');
lines.push('| 「批准发布/生产上线」 | `approve_release` |');
lines.push('| 「迁移工单号是 XXX」 | `set_change_ticket({ticket})` |');
lines.push('| 「注册操作手册」（启用官方 `/prompts:sdlc-<名>` 调用） | `register_prompts` |');
lines.push('| 「看最近审计/事件流」 | `audit` / `events` |');
lines.push('');

// v0.13.12 沙盒与权限协议（Codex 平台机制的教育性注入——一次会话一次，
//   预防性；被拒时的针对性提醒由三层联动承担：PreToolUse 规则 0f 预警 →
//   PostToolUse 拒绝检测 → UserPromptSubmit 1f 回合提醒）
lines.push('### 沙盒与权限（Codex 平台机制，v0.13.12）');
lines.push('- 网络访问（curl / npm install / npx playwright install / git clone…）与端口监听（dev server…）在 Codex 沙盒下**默认被拒**——这是平台安全机制，非本插件门禁');
lines.push('- 被拒时的正确动作：向用户呈报 ① 命令 ② 目的 ③ 所需权限（网络/端口），**请求授权提权运行**——不要反复重试，不要改写命令绕过沙盒');
lines.push('- Playwright 场景：环境未就绪先跑只读检测 `node ' + PLUGIN_ROOT + '/hooks/scripts/setup-playwright.mjs --check`（三选项含本机 Chrome 零浏览器下载通道）；**安装与否由用户抉择**（脚本无 `--yes` 拒绝执行）');
lines.push('');

// v0.13.2 手册自动注册结果注入（零用户操作）：registered/refreshed → 一行
//   声明（透明：告诉用户已可 /prompts: 调用及关闭方式）；failed → 手动通道
//   提示；skipped / opted-out / disabled / no-source → 静默（尊重用户选择，省 token）。
//   事件留痕 events.jsonl（prompts_auto_registered）。
if (promptsAuto.action === 'registered' || promptsAuto.action === 'refreshed') {
  appendEvent(scope, 'prompts_auto_registered', {
    action: promptsAuto.action, count: promptsAuto.count, total: promptsAuto.total,
    dir: promptsAuto.dir, via: 'session-start:ensurePromptsRegistered',
  });
  lines.push(`**\`/prompts:\` 手册已${promptsAuto.action === 'registered' ? '自动注册' : '自动刷新为插件当前版本'}**（${promptsAuto.count}/${promptsAuto.total} 份 → \`${promptsAuto.dir}\`）——\`/prompts:sdlc-<名>\` 即可用（如 \`/prompts:sdlc-quick\`）。卸载：MCP \`register_prompts({action:"remove"})\`（卸载后不再自动恢复）；关闭自动注册：\`SDLC_PROMPTS_AUTO=off\``);
  lines.push('');
} else if (promptsAuto.action === 'failed') {
  lines.push(`**\`/prompts:\` 手册自动注册失败**（${promptsAuto.error}）——手动通道：MCP \`register_prompts\`（跨平台）或 \`scripts/sh|ps/install-prompts\`（平台脚本）。未注册不影响任何功能。`);
  lines.push('');
}

// v0.13.3 MCP 启动器指针写入失败提示（透明声明 + 修复通道；成功时静默——
//   指针是常态基础设施，正常路径不向用户出声）
if (!mcpLauncherWritten) {
  lines.push('**⚠️ MCP 启动器指针写入失败**——插件 MCP server（`mcp__sdlc-orchestrator__*` 工具）可能无法自定位插件根。修复：重启会话（SessionStart 会重写 `.sdlc/mcp-launcher.json`），或设环境变量 `SDLC_PLUGIN_ROOT` 指向插件安装目录。');
  lines.push('');
}

// v0.13.2 运行环境画像（hook 自检）：不可用的脚本形态直接告知（防止跨平台
//   报错——Windows 无 bash 跑 .sh / 无 pwsh 的 macOS/Linux 跑 .ps1 均会直接
//   失败）；全可用时仅一行摘要。PreToolUse 侧另有能力感知护栏兜底拦截。
lines.push('### 运行环境（hook 自检，v0.13.2）');
lines.push(`- ${envSummaryLine(envProfile)}`);
for (const cl of envConstraintLines(envProfile)) lines.push(cl);
lines.push('');

lines.push('**核心约定**：每个 SDLC 阶段以一个工作区工件结束（`.sdlc/artifacts/` 或任务目录），下一阶段读取该工件开始。');
lines.push('插件已根据工作区/仓库中已存在的工件自动判定当前阶段，你无需用户显式 @ 插件或 slash 命令。');
lines.push('');

// 当前阶段
lines.push('### 当前 SDLC 阶段');
lines.push(`- **${stage.full}** — ${stage.description}`);
if (stageGuardApplied) {
  // v0.13.10：守卫说明（含原始检测值，可排障）——不再展示另一阶段的
  //   source/substage 造成矛盾
  lines.push(`- 检测来源：\`stage-guard(saved-newer)\`（工件检测为 \`${detection.stage}\`，保存阶段 \`${effectiveStageId}\` 更靠后已优先——git diff 是瞬态的，实施提交后检测会跌回早期阶段）`);
} else {
  lines.push(`- 检测来源：\`${detection.source}\`（置信度 ${detection.confidence}）`);
  if (detection.substage) lines.push(`- 子阶段：\`${detection.substage}\``);
}

// v0.6.0 Open questions 待回答提醒（跨会话记忆：上一次会话遗留的未回答问题）
if (detection.stage === 'planning' && detection.substage === 'awaiting_answers') {
  const oq = detection.open_questions || { unresolved: '?', items: [] };
  lines.push('');
  lines.push('### ⏸️ Open questions 待发起者回答');
  lines.push(`- intent.md 有 **${oq.unresolved}** 个开放问题未获回答，当前停留在 **Stage 1 Planning**（交互门禁）`);
  for (const q of (oq.items || []).filter(i => !i.resolved).slice(0, 5)) {
    lines.push(`  - ${q.text}`);
  }
  lines.push('- 请将问题逐条呈现给发起者并**等待回答**（勿自问自答）；答案融入 intent.md 后移除/标记条目，全部解决后自动推进 Stage 2');
}

// v0.7.0 修复循环中断恢复提醒（跨会话记忆：上一次会话遗留的未决策中断）
if (prevState.fix_loop) {
  const loop = prevState.fix_loop;
  lines.push('');
  lines.push('### 🛑 修复循环中断（等待用户决策）');
  lines.push('- 上个会话检测到修复循环（**' + loop.kind + '**，连续失败 ' + (loop.rounds || '?') + ' 轮），自动修复已被阻断');
  if (loop.summary) lines.push('  - 失败摘要：' + String(loop.summary).slice(0, 140));
  lines.push('- 请向用户呈报循环证据并等待决策：`loop_resolve({decision: "retry|new-intent|manual|escalate", note})`（用户自然语言如「重试一轮」「我自己来修」即触发）');
  lines.push('- 测试真实通过会自动解除中断');
}

// 工件清单
lines.push('');
lines.push('### 工件清单（.sdlc 工作区，不进版本控制）');
const arts = detection.artifacts;
const listArt = (label, a) => {
  if (a) lines.push(`- ✅ ${label}: \`${a.rel}\``);
  else lines.push(`- ⬜ ${label}: 未创建`);
};
listArt('intent.md', arts.intent);
listArt('spec.md', arts.spec);
listArt('plan.md', arts.plan);
listArt('REVIEW.md', arts.review);
listArt('AGENTS.md', arts.agents);

// 缺失工件（关键：告诉 agent 当前阶段下一步要做什么）
if (detection.missing && detection.missing.length > 0) {
  lines.push('');
  lines.push('### 当前阶段缺失工件（需要在本阶段产出）');
  for (const m of detection.missing) lines.push(`- ⚠️ \`${m}\` — 可读 \`${stage.prompt}\` 手册（含模板与执行步骤），或直接生成`);
}

// 下一阶段预览
lines.push('');
lines.push('### 阶段推进规则');
lines.push(`- 本阶段产出 \`${stage.artifact}\` 后，PostToolUse hook 会自动检测并推进到 **${STAGE_BY_ID[stage.next]?.full || stage.next}**`);
lines.push(`- 阶段门禁由 PreToolUse hook 强制（plan 模式禁改代码、修复期禁改测试、无工单禁改迁移）`);

// 资源索引
lines.push('');
lines.push('### 资源索引（按需读取，不全量注入）');
lines.push(`- 阶段规则：\`${stage.rule}\``);
lines.push(`- 阶段技能：\`skills/${stage.skill}/SKILL.md\``);
// v0.8.0 能力技能：实施/测试阶段涉及前端时提示 Playwright E2E 技能（改 UI 的真实测试证据来源）
// v0.13.12：环境检测入口随行（本地通常无 Playwright 依赖——先 --check 探测再由用户抉择安装）
if (effectiveStageId === 'build_impl' || effectiveStageId === 'test') {
  lines.push('- 能力技能：`skills/frontend-e2e/SKILL.md`（前端 E2E — Playwright；本次改动含 UI 时按它取得测试证据，`npx playwright test` 等标准命令会被测试门禁识别）；环境未就绪先跑只读检测 `node ' + PLUGIN_ROOT + '/hooks/scripts/setup-playwright.mjs --check`（安装与否由用户抉择，v0.13.12）');
}
lines.push(`- 阶段手册：\`${stage.prompt}\`（含模板与执行步骤，按需读取）`);
// v0.13.10 修复：工件模板行改为存在性判定——旧实现拼接
//   `templates/${stage.artifact.replace(/\+.*$/, '.md')}.tpl` 对非文件产物
//   （diff+tests / test-pass / pr-merged / incident→intent.md）生成不存在的
//   模板路径（悬空引用，agent 按图索骥会 ENOENT）。仅在该阶段 produces 中
//   存在带模板的真实文件工件时才注入该行（maintain 的闭环产物 intent.md
//   有模板，正确命中）。
{
  const tplName = (stage.produces || []).find(p => existsSync(resolve(PLUGIN_ROOT, 'templates', `${p}.tpl`)));
  if (tplName) lines.push(`- 工件模板：\`templates/${tplName}.tpl\``);
}
lines.push(`- 全局基线：\`spec/sdlc-baseline.md\`、\`spec/artifact-contract.md\``);

// 闭环提示（如果在 maintain 阶段）
if (effectiveStageId === 'maintain') {
  lines.push('');
  lines.push('### 闭环提示');
  lines.push('- 当前处于 Stage 6 Maintain。');
  lines.push('- 监控触发器（bands.yaml）配置在 `.sdlc/bands.yaml`，CI/CD 计划任务运行检测脚本。');
  lines.push('- 控制带被突破时，确定性脚本调用 Codex 写出新的 `intent.md`，自动回到 Stage 1 Planning（旧周期工件的 spec/plan/REVIEW 由 hook 自动归档，新 intent 保留为下一周期起点）。');
}

// 治理提示
lines.push('');
lines.push('### 治理与审计');
lines.push('- 工件链 = 审计追踪：intent.md → spec.md → plan.md → diff+tests → PR → incident.md');
lines.push('- 工件存放于 `.sdlc/` 工作区（gitignore 托管块管理，不进版本控制）；归档审计链：`.sdlc/archive/` + `.sdlc/cycles.json`');
lines.push('- 阶段决策与 hook 调用记录在 scope 内 `hook-audit.json`（任务隔离区或 `.sdlc/`）');
lines.push('- 周期归档索引：`.sdlc/cycles.json`；会话快照：`.sdlc/sessions/`');
lines.push('- MCP 工具：`mcp__sdlc-orchestrator__*` 可查询状态、推进阶段、归档开新周期（new_cycle）、任务管理（task_*）、临时任务队列（quick_task）——用户自然语言即可驱动（见上方意图→工具映射）');

appendAudit(scope, {
  hook: 'session_start', trigger: 'SessionStart',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    first_use: bootstrap.firstUse,
    bootstrap_actions: bootstrap.actions,
    stage: effectiveStageId,
    stage_guard: stageGuardApplied ? { detected: detection.stage, kept: effectiveStageId } : undefined,
    confidence: detection.confidence,
    source: displaySource,
    scope: scope.mode + (scope.taskId ? ':' + scope.taskId : ''),
    prompts_auto: promptsAuto.action + (promptsAuto.count != null ? ':' + promptsAuto.count + '/' + promptsAuto.total : ''),
    mcp_launcher: mcpLauncherWritten ? 'written' : 'failed',
    env: {
      platform: envProfile.platformLabel,
      posix_shell: envProfile.hasPosixShell,
      powershell: envProfile.hasPowerShell,
    },
    artifacts: Object.fromEntries(Object.entries(arts).map(([k, v]) => [k, v ? v.rel : null])),
  },
});

emitHookOutput({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
});
