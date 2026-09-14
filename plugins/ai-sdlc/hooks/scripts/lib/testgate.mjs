/**
 * testgate.mjs — 测试门禁与修复循环：Intent Open questions 解析、测试命令识别（防伪造）、失败签名提取、循环检测（A→A/振荡/轮次超限）、resolveFixLoop 用户决策落地
 * 分层：L4 门禁层（依赖：paths / state / audit / cycles）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { asScope } from './paths.mjs';
import { readCodexState, mutateCodexState } from './state.mjs';
import { appendEvent, appendGlobalAudit } from './audit.mjs';
import { newCycle } from './cycles.mjs';

// ═══════════════════════════════════════════════════════════
// v0.6.0 Intent Open Questions 解析（交互闭环核心）
// 权威标准：插件 docs/lifecycle.md「Intent 提问闭环」章节
// ═══════════════════════════════════════════════════════════

/**
 * 解析 markdown 工件（intent.md / spec.md）的 `## Open questions` 章节，
 * 统计未解决问题数。阶段推进门禁据此判定「是否已给发起者回答机会」。
 *
 * 条目标记约定（与 templates/intent.md.tpl 对齐）：
 *   - 列表项 `- 问题` 为待回答问题
 *   - `- [x] 问题` / `~~问题~~` / 行尾 `[resolved]`/`(answered)` = 已回答（保留审计痕迹）
 *   - 模板占位符（`<`、`例如`）不计入
 *   - 章节缺失 / 无实义条目 → 0
 *
 * @param {string} artifactPath 工件绝对路径
 * @returns {{ total: number, unresolved: number, items: Array<{text, resolved}> }}
 */
export function parseOpenQuestions(artifactPath) {
  let text = null;
  try { text = readFileSync(artifactPath, 'utf8'); } catch { return { total: 0, unresolved: 0, items: [] }; }
  if (!text) return { total: 0, unresolved: 0, items: [] };

  // 定位章节标题（## Open questions，大小写不敏感）
  const m = text.match(/^#{2}\s+open\s+questions\s*$/im);
  if (!m) return { total: 0, unresolved: 0, items: [] };

  const after = text.slice(m.index + m[0].length);
  // 章节结束：下一个任意级别标题（#/##/###）
  const next = after.match(/^#{1,3}\s+\S/m);
  const section = next ? after.slice(0, next.index) : after;

  const items = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    const li = line.match(/^[-*]\s+(.*)$/);
    if (!li) continue;
    const body = li[1].trim();
    if (!body) continue;
    // 模板占位符过滤（`- <`、`- <例如：…`）
    if (body === '<' || /^<例如/.test(body)) continue;
    // 已回答标记：- [x] / 删除线包裹 / 行尾 [resolved]|(answered) / 行尾 ✅
    const resolved = /^\[[xX]\]\s/.test(body)
      || (/^~~/.test(body) && /~~\s*$/.test(body))
      || /[\[(](?:resolved|answered)[\])]$/i.test(body);
    items.push({ text: body, resolved });
  }
  return {
    total: items.length,
    unresolved: items.filter(i => !i.resolved).length,
    items,
  };
}

// ═══════════════════════════════════════════════════════════
// v0.7.0 测试门禁与修复循环中断（Test Gate & Fix Loop Guard）
// 权威标准：插件 docs/lifecycle.md「测试门禁与修复循环中断」章节
// 语义：
//   1. plan 接受并实施后必须真实运行测试（未测试不得 push/PR/报告完成）
//   2. 测试失败 → 就地修复（fix code not test）或 new_cycle 开下一个
//      intent 迭代（把失败作为 incident 写入新周期）
//   3. 修复循环（同签名重复 A→A / A→B→A、同周期轮次超限）→ 中断并询问
//      用户，由用户决策（retry / new-intent / manual / escalate），
//      绝不无休止自动循环下去
// ═══════════════════════════════════════════════════════════

const TEST_FAILURE_HISTORY_LIMIT = 50;   // state 内保留的最近失败记录数
const FIX_LOOP_WINDOW = 5;               // 振荡检测窗口（最近 N 次失败，跨周期）
const FIX_LOOP_REPEAT = 2;               // 窗口内同签名出现次数阈值

/** 同周期内最大连续失败轮次（env SDLC_MAX_FIX_ROUNDS 可覆盖，默认 3） */
export function maxFixRounds() {
  const n = parseInt(process.env.SDLC_MAX_FIX_ROUNDS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/**
 * 测试命令识别（v0.7.0，v0.8.0 扩展 Playwright）：显式形式整串匹配 + 裸 runner 只认命令段首词。
 * v0.8.0：frontend-e2e 技能标准命令纳入识别——
 *   - (npx|pnpm|yarn|bunx) [dlx|exec] playwright test / @playwright/test
 *   - npm|pnpm|yarn|bun run e2e / test:e2e（社区约定的 E2E 脚本名）
 *   - 裸 `playwright test`（PATH 直达，BARE_TEST_CMDS 两词匹配）
 *   - 刻意不识别 playwright install/codegen/show-report（副作用/工具命令非测试执行）
 */
const TEST_CMD_RE = /\b(?:make\s+test|npm\s+(?:test|run\s+(?:test|e2e|test:e2e))|pnpm\s+(?:test|run\s+(?:test|e2e|test:e2e)|exec\s+playwright\s+test)|yarn\s+(?:test|run\s+(?:test|e2e|test:e2e)|playwright\s+test)|bun\s+(?:test|run\s+(?:test|e2e|test:e2e))|bunx\s+playwright\s+test|npx\s+(?:(?:dlx\s+)?(?:playwright|@playwright\/test)\s+test|jest|vitest|mocha|karma|pytest)|python3?\s+-m\s+(?:pytest|unittest)|pytest|py\.test|cargo\s+(?:test|nextest)|go\s+test|dotnet\s+test|deno\s+test|gradlew?\s+test|mvn\s+(?:test|surefire:test))\b/;
const BARE_TEST_RUNNERS = new Set(['jest', 'vitest', 'mocha', 'karma', 'py.test']);
/** 裸两词命令（v0.8.0）：段首 `playwright test` 命中；`playwright install/codegen/show-report` 不命中 */
const BARE_TEST_CMDS = new Set(['playwright test']);

/**
 * v0.9.0：引号感知提取 shell -c 包装的引号负载——`bash -c "npm test"` /
 * `sh -lc 'npx playwright test'`（支持组合旗标 -lc/-ec 与前置旗标 `-l -c`）。
 * 背景：v0.8.0 的引号字面量剥离（防伪造）把整段引号内容剥成空串，`bash -c "npm test"`
 * 这类真实包裹形态随之漏判（当时定性为失败安全方向并记为遗留）。
 *
 * 为什么用引号感知扫描而不是纯正则：纯正则会把 `echo 'bash -c "npm test"'`
 * 里引号**内**的文本也当成包装命令提取 → 伪证向量（echo 一段字符串即可
 * 伪造 test_pass）。扫描器只在「不在引号内」的位置识别 shell 词，防伪造
 * 边界与 v0.8.0 剥离规则对齐：
 *   - `git commit -m "make test"` 无 shell -c 形态 → 不进入提取，仍被剥离
 *   - `bash -c "echo 'npm test'"` 负载 `echo 'npm test'` → 递归后内层引号剥离 → 不命中
 *   - `echo 'bash -c "npm test"'` 的 bash -c 在引号内 → 不提取 → 不命中
 * 深度上限 SHELL_WRAP_MAX_DEPTH：嵌套包装两层足够覆盖真实用法，更深的构造
 * 保持漏判的失败安全方向。
 */
const SHELL_C_WORD_RE = /^(?:bash|sh|zsh|dash|ksh)\s+(?:--?[a-zA-Z-]+\s+)*(?:-{1,2}[a-zA-Z]*c)\s+/;
const SHELL_WRAP_MAX_DEPTH = 2;

/** @see SHELL_C_WORD_RE —— 提取全部「引号外」shell -c 的引号负载 */
function extractShellCPayloads(c) {
  const payloads = [];
  let quote = null;   // 当前所在的引号类型（' 或 "），null = 引号外
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (quote) {
      // 引号内：同型引号闭合（前一字符是反斜杠转义则不闭合）
      if (ch === quote && c[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    // 词首检测：仅分隔符/行首之后的位置才尝试匹配 shell 词
    //（防 `debugbash -c …` 这类伪词误入提取）
    if (i > 0 && !/[\s;&|()]/.test(c[i - 1])) continue;
    const rest = c.slice(i);
    const m = rest.match(SHELL_C_WORD_RE);
    if (m) {
      const after = rest.slice(m[0].length);
      const q = after.match(/^(?:"([^"]*)"|'([^']*)')/);
      if (q) {
        payloads.push(q[1] !== undefined ? q[1] : q[2]);
        i += m[0].length + q[0].length - 1;   // 跳过已消化的包装段
      }
    }
  }
  return payloads;
}

/**
 * 判定 Bash 命令是否为测试命令（PostToolUse 记录 / fix_loop 期间豁免的取证命令）。
 *   - 显式形式（make test / npm test / npx vitest / python -m pytest / go test …）
 *   - 裸 runner（jest / vitest / mocha / karma / py.test）只认**命令段首词**——
 *     `echo jest`、`build:jest-xxx`、`cat x.log | grep jest` 均不命中；
 *     `npm run build && vitest run` 的第二段首词 vitest 命中
 *   - 裸两词命令（v0.8.0）：`playwright test`（含路径前缀形式
 *     `./node_modules/.bin/playwright test`）命中；`playwright install` 等子命令不命中
 *   - shell -c 包装（v0.9.0）：`bash -c "npm test"` 的引号负载递归判定（≤2 层）
 * @param {string} command
 * @returns {boolean}
 */
export function isTestCommand(command, _depth = 0) {
  const c = String(command || '');
  if (!c) return false;
  // v0.8.0 加固：整串正则匹配前先剥离引号字面量——`echo "npm run e2e"`、
  // `git commit -m "fix: make test pass"` 中的字符串字面量不得计为测试执行
  //（防伪造 test_pass 绕过门禁）
  const stripped = c.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  if (TEST_CMD_RE.test(stripped)) return true;
  // v0.9.0：shell -c 包装负载递归识别（闭合 v0.8.0 遗留漏判；见 extractShellCPayloads 注释）
  if (_depth < SHELL_WRAP_MAX_DEPTH) {
    for (const payload of extractShellCPayloads(c)) {
      if (payload && isTestCommand(payload, _depth + 1)) return true;
    }
  }
  return c.split(/&&|\|\||;|\||\n/).some(seg => {
    const words = seg.trim().split(/\s+/);
    const first = words[0] || '';
    const base = first.replace(/^\.\//, '').replace(/^.*\//, '');  // .bin/jest → jest
    if (BARE_TEST_RUNNERS.has(first) || BARE_TEST_RUNNERS.has(base)) return true;
    // v0.8.0 裸两词：首词（含路径前缀归一化后）+ 第二词拼成两词命令再比对
    if (words[1] !== undefined) {
      const two = `${base} ${words[1]}`;
      if (BARE_TEST_CMDS.has(two)) return true;
    }
    return false;
  });
}

/**
 * 多框架通用的测试失败行匹配（v0.8.0 扩展 Playwright）
 */
const FAIL_LINE_PATTERNS = [
  /^\s*(?:FAIL|FAILED)\b/i,             // jest/vitest/go/cargo 摘要行
  /^\s*(?:✕|×)\s+\S/,                   // jest/vitest 失败用例标记
  /^\s*---\s*FAIL:\s*\S+/,              // go test: --- FAIL: TestXxx
  /^\s*(?:FAILED|ERROR)\s+\S+::\S+/,    // pytest: FAILED tests/x.py::test_y
  /^\s*\d+\)\s+\S+/,                    // mocha/karma 编号失败 + playwright 汇总条目 `1) [chromium] › …`
  /^\s*✘\s*\d+\s+\[/,                  // playwright list 报告器：`✘  2 [chromium] › spec.ts:10:5 › title`
  /^\s*Error:\s+expect\b/,               // playwright 断言失败：`Error: expect(locator).toBeVisible() …`
  /^\s*(?:AssertionError|ExpectationError)\b/,
  /^\s*panic:\s+/,                        // go panic
  /^\s*test\s+result:\s*FAILED/i,        // cargo test 汇总
];

/**
 * 从测试命令输出中提取失败签名（循环检测的指纹）。
 * 签名原则：只保留「哪些用例/断言失败」这一结构信息，剥离数字/耗时/ANSI
 * 颜色码等易变噪声——同一问题重复出现必须得到同一签名。
 * @returns {{ kind: 'framework'|'error-lines'|'exit-only', sig: string, summary: string }}
 */
export function extractTestFailureSignature(stdout, command, exitCode) {
  const text = String(stdout || '');
  if (text.trim()) {
    const lines = text.split('\n');
    const failLines = [];
    for (const raw of lines) {
      const line = raw.replace(/\r$/, '').trimEnd();
      if (FAIL_LINE_PATTERNS.some(re => re.test(line))) failLines.push(line);
      if (failLines.length >= 20) break;
    }
    if (failLines.length > 0) {
      return { kind: 'framework', sig: signatureHash(failLines.join('\n')), summary: failLines.slice(0, 3).join(' | ').slice(0, 160) };
    }
    // 有输出但非测试框架格式（如构建工具报错）：提取 error/fail 行
    const errLines = lines.filter(l => /\b(?:error|failed|failure|exception)\b/i.test(l)).slice(0, 10);
    if (errLines.length > 0) {
      return { kind: 'error-lines', sig: signatureHash(errLines.join('\n')), summary: errLines.slice(0, 3).join(' | ').slice(0, 160) };
    }
  }
  // 无 stdout / 无可识别行 → 弱签名（命令 + 退出码）：同命令同退出码视为同一问题。
  // 注意：exit code 不能进数字归一化管道（否则 exit 1 与 exit 2 同签名）——
  // 命令部分归一化后拼接显式退出码后缀。
  return {
    kind: 'exit-only',
    sig: signatureHash(String(command || '').slice(0, 120)) + '-' + (exitCode ?? 'x'),
    summary: `exit=${exitCode}（无输出可解析）`,
  };
}

/** 签名归一化 + sha1 截断：去数字/耗时/ANSI 色码/空白 */
function signatureHash(s) {
  const normalized = String(s)
    .replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '')      // ANSI 颜色/控制码
    .replace(/\d+(?:\.\d+)?/g, 'N')               // 数字（计数/耗时/行号）
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4000);
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}

/**
 * 修复循环检测（Fix Loop Guard 核心）。
 * 规则：
 *   R1 窗口内同签名出现 ≥2 次 → A→A（相邻重复）或 A→B→A / A→B→C→A（振荡）
 *      —— 含跨周期：new-cycle 后同一失败再现同样命中（intent 迭代未解决问题）
 *   R2 同周期连续失败轮次 ≥ maxFixRounds（默认 3）→ 轮次超限
 * @returns {object|null} fix_loop 对象（含 kind/rounds/window/hint），null = 无循环
 */
export function detectFixLoop(state) {
  const failures = Array.isArray(state.test_failures) ? state.test_failures : [];

  // R1 同签名重复（更具诊断价值，优先报告）：最近窗口内同一签名出现 ≥2 次
  // —— 涵盖 A→A（相邻重复）与 A→B→A / A→B→C→A（振荡），含跨周期：
  // new-cycle 后同一失败再现同样命中（intent 迭代未解决问题）
  if (failures.length >= 2) {
    const window = failures.slice(-FIX_LOOP_WINDOW);
    const last = window[window.length - 1];
    const repeats = window.filter(f => f.sig === last.sig).length;
    if (repeats >= FIX_LOOP_REPEAT) {
      const adjacent = window[window.length - 2].sig === last.sig;
      return {
        kind: adjacent ? 'repeat-immediate' : 'oscillation',
        detected_at: new Date().toISOString(),
        rounds: state.fix_rounds || 0,
        window: window.map(f => ({ sig: f.sig, cycle: f.cycle || null, ts: f.ts })),
        repeated_sig: last.sig,
        summary: last.summary || null,
        hint: '同一失败签名在最近窗口内重复出现（A→A 或 A→B→A 型振荡）——继续自动修复大概率在原地打转，请中断并交由用户决策。',
      };
    }
  }

  // R2 轮次超限（兜底）：同周期连续失败 ≥ maxFixRounds（默认 3；env
  // SDLC_MAX_FIX_ROUNDS 可调，=1 时首败即中断是合法配置）。不受签名数量
  // 门槛限制（历史截断后 fix_rounds 与 test_failures 长度可能不同步）。
  const rounds = state.fix_rounds || 0;
  if (rounds >= maxFixRounds() && failures.length >= 1) {
    const lastAny = failures[failures.length - 1];
    return {
      kind: 'rounds-exceeded',
      detected_at: new Date().toISOString(),
      rounds,
      window: failures.slice(-FIX_LOOP_WINDOW).map(f => ({ sig: f.sig, cycle: f.cycle || null, ts: f.ts })),
      repeated_sig: null,
      summary: lastAny.summary || null,
      hint: `本周期内已连续 ${rounds} 轮测试未通过（上限 ${maxFixRounds()}）——失败未见收敛，请中断并交由用户决策。`,
    };
  }
  return null;
}

/** fix_loop 决策通道合法值 */
export const FIX_LOOP_DECISIONS = ['retry', 'new-intent', 'manual', 'escalate'];

/**
 * 解除修复循环中断（用户决策落地）。
 *   retry      重置轮次计数，允许再修一轮（同签名再失败会立即再次中断——连续确认后才可能真正走出）
 *   new-intent 把失败作为 incident 开启下一个 intent 周期（newCycle 归档轮转，
 *              失败历史跨周期保留以继续监测循环）
 *   manual     用户接管修复（agent 只读；状态机不动，决策留痕）
 *   escalate   升级人工/更高层处理（记录后暂停自动修复）
 * @returns {{ ok: boolean, error?: string, decision?: string, cycle?: number, note?: string }}
 */
export function resolveFixLoop(scopeOrRoot, decision, note = '') {
  const s = asScope(scopeOrRoot);
  const oldState = readCodexState(s, 'state.json') || {};
  if (!FIX_LOOP_DECISIONS.includes(decision)) {
    return { ok: false, error: `未知决策「${decision}」，可选：${FIX_LOOP_DECISIONS.join(' / ')}` };
  }
  if (!oldState.fix_loop) {
    return { ok: false, error: '当前无修复循环中断（state.fix_loop 未设置）' };
  }

  const record = {
    kind: oldState.fix_loop.kind,
    rounds: oldState.fix_loop.rounds || 0,
    decision, note: String(note || '').slice(0, 300),
    resolved_at: new Date().toISOString(),
  };

  let cycleInfo = null;
  if (decision === 'new-intent') {
    // 先归档轮转（fresh 状态由 newCycle 写入），再把决策留痕补写到 fresh 状态上
    const cyc = newCycle(s, { reason: 'loop_resolve_new_intent' });
    cycleInfo = cyc;
    // v0.13.5 X-lock：补写锁内执行（锁内重读 fresh——newCycle 刚写入的最新值）
    mutateCodexState(s, 'state.json', (fresh0) => {
      const fresh = fresh0 || {};
      fresh.fix_loop_resolutions = [...(oldState.fix_loop_resolutions || []), record];
      fresh.fix_rounds = 0;   // 新周期重新计数（test_failures 已由 newCycle 跨周期保留）
      fresh.updated_at = new Date().toISOString();
      return fresh;
    });
  } else {
    // v0.13.5 X-lock：锁内读-改-写（并发 resolve/retry 决策不互盖）
    mutateCodexState(s, 'state.json', (cur) => {
      const st = cur || {};
      st.fix_loop = null;
      st.fix_loop_resolutions = [...(st.fix_loop_resolutions || []), record];
      if (decision === 'retry') st.fix_rounds = 0;   // 允许再修一轮
      st.updated_at = new Date().toISOString();
      return st;
    });
  }

  appendEvent(s, 'fix_loop_resolved', {
    decision, kind: record.kind, rounds: record.rounds,
    cycle: cycleInfo ? cycleInfo.cycle : (oldState.cycle_id || null),
    note: record.note,
  });
  appendGlobalAudit(s.projectRoot, {
    hook: 'lifecycle', trigger: 'fix_loop_resolve',
    result: decision,
    detail: { kind: record.kind, rounds: record.rounds, task: s.taskId, note: record.note },
  });

  return {
    ok: true, decision,
    cycle: cycleInfo ? cycleInfo.cycle : null,
    note: decision === 'new-intent'
      ? `已开启 cycle ${cycleInfo.cycle}（旧周期工件归档于 ${cycleInfo.archive_dir || '（无工件可归档）'}）——请把上一周期的失败测试作为 incident 写入新的 intent.md，作为下一迭代的起点。`
      : decision === 'retry'
        ? '轮次计数已重置，允许继续修复一轮；若同一失败再现将立即再次中断（连续确认防死循环）。'
        : decision === 'manual'
          ? '已记录用户接管决策——请停止自动修改代码，转为只读协助（分析/解释/给建议），等待用户手工修复。'
          : '已记录升级决策——请汇总循环证据（失败历史/已尝试方案）呈报用户或更高层处理。',
  };
}
