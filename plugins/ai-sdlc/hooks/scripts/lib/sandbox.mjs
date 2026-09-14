/**
 * sandbox.mjs — Codex 沙盒授权协作（v0.13.12）
 * 分层：L3 门禁辅助层（依赖：无 —— 纯函数 + 只读探测）
 *
 * 背景（用户实测）：curl 等网络访问命令、dev server 等端口监听命令在
 *   Codex 沙盒下默认被拒绝执行——这是**平台安全机制**（非本插件门禁）。
 *   agent 被拒后的正确动作是「向用户呈报命令与目的，请求授权提权运行」，
 *   而不是反复原样重试或尝试绕过沙盒。本模块提供三类判定：
 *
 *   1. netPortKind(command) —— 命令是否需要网络/端口（预警侧：PreToolUse
 *      在放行这类命令前注入授权应对协议，每会话去重一次）
 *   2. detectSandboxDenial({command, toolResponse}) —— 执行结果是否疑似
 *      被沙盒拒绝（证据侧：PostToolUse 检测失败输出特征，记入 hooks-state
 *      供下回合 UserPromptSubmit 提醒；被拒的测试命令不计失败轮次——
 *      沙盒拒绝 ≠ 测试失败，计入会误导 fix_loop 以为代码有问题）
 *   3. SANDBOX_PROTOCOL_TEXT / sandboxHintFor(kind) —— 注入文案单一事实源
 *
 * 设计约束：
 *   - 引号感知：`rg "curl|wget" f` 的引号内文本是搜索模式不是命令——
 *     拆段复用 v0.13.11 的词法语义（quoteSpans 同款实现，独立内联避免
 *     改动已回归覆盖的 pre-tool-use 内部结构；与 testgate.mjs 自持
 *     extractShellCPayloads 的先例一致）
 *   - 拒绝特征分级：强特征（沙盒/提权自述）任意命令命中即记；弱特征
 *     （EPERM/ENOTFOUND/permission denied 等）仅在命令本身是网络/端口类
 *     时才记——防普通文件权限错误误报
 *   - 零副作用：全部函数只读，不执行任何命令
 */

// ═══════════════════════════════════════════════════════════
// 引号感知词法（语义对齐 pre-tool-use.mjs v0.13.11 实现）
// ═══════════════════════════════════════════════════════════

/** 引号区段识别（单/双引号；未闭合保守视为引号内） */
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
    } else {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') { spans.push({ start, end: i, quote }); quote = null; }
    }
  }
  if (quote !== null) spans.push({ start, end: c.length - 1, quote });
  return spans;
}

/**
 * 引号感知命令拆段（&& / || / ; / | / 换行）：引号内的分隔符是字面文本
 * 不切分（`rg "a|b" | head` 只有引号外那一个 | 是管道）。
 * @returns {string[]} 命令段（已 trim，空段剔除）
 */
export function splitSegmentsQuoteAware(cmd) {
  const c = String(cmd || '');
  const spans = quoteSpans(c);
  const isQuoted = (i) => spans.some(s => i > s.start && i < s.end);
  const parts = [];
  let cur = '';
  for (let i = 0; i < c.length; i++) {
    const ch = c[i];
    if (!isQuoted(i) && /[;&|\n]/.test(ch)) {
      // 连续分隔符（&&、||、;&）聚合：下一字符同类则一并消费
      parts.push(cur); cur = '';
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map(s => s.trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════
// 1. 网络 / 端口命令特征（预警侧）
//   匹配粒度：段首词（引号感知拆段后逐段匹配）。
//   误报方向权衡：漏预警无害（失败安全——命令照样执行，只是没有提前教育）；
//   误预警有噪音成本（每个无关命令都注入提示）——所以裸 next/vite/http 等
//   易撞名词不进清单，保留 npx 包装形态与高置信段首词。
// ═══════════════════════════════════════════════════════════

/** 网络访问类命令段（下载/安装/远程交互） */
const NET_SEG_RES = [
  /^curl\b/, /^wget\b/, /^aria2c\b/, /^axel\b/,
  /^npm\s+(?:install|i|ci|add|update|upgrade|publish|dist-tag)\b/,
  /^pnpm\s+(?:install|i|add|update|upgrade|publish)\b/,
  /^yarn\s+(?:install|add|upgrade|publish)\b/,
  /^bun\s+(?:install|i|add|update)\b/,
  /^(?:npx|pnpm\s+exec|pnpm\s+dlx|yarn\s+dl|bunx)\s+\S+\s+(?:install|add)\b/,   // npx playwright install …
  /^pip3?\s+(?:install|download)\b/, /^uv\s+(?:pip\s+)?install\b/, /^poetry\s+(?:install|add)\b/, /^pipx\s+install\b/,
  /^cargo\s+(?:install|publish)\b/, /^cargo\s+add\b/,
  /^go\s+(?:get|install|mod\s+(?:download|tidy))\b/,
  /^gem\s+(?:install|update)\b/, /^bundle\s+install\b/,
  /^composer\s+(?:install|require|update)\b/,
  /^mvn\b/, /^mvnw\b/, /^gradlew?\b/,
  /^git\s+(?:clone|fetch|pull|push|ls-remote|submodule\s+(?:update|init))\b/,
  /^gh\s+\b/,
  /^brew\s+(?:install|upgrade|tap)\b/,
  /^apt(?:-get)?\s+(?:install|update|upgrade)\b/, /^apk\s+add\b/,
  /^(?:yum|dnf)\s+install\b/, /^pacman\s+-S\b/, /^zypper\s+install\b/,
  /^choco\s+(?:install|upgrade)\b/, /^winget\s+(?:install|upgrade)\b/, /^scoop\s+install\b/,
  /^docker\s+(?:pull|run|build|compose\s+(?:up|pull))\b/,
  /^kubectl\s+\b/, /^helm\s+\b/, /^terraform\s+init\b/,
];

/** 端口监听类命令段（dev server / 长驻服务 / 端口转发） */
const PORT_SEG_RES = [
  /^npm\s+run\s+(?:dev|start|preview|serve|watch)\b/,
  /^pnpm\s+(?:run\s+)?(?:dev|start|preview|serve)\b/,
  /^yarn\s+(?:run\s+)?(?:dev|start|preview|serve)\b/,
  /^bun\s+(?:run\s+)?(?:dev|start|preview|serve)\b/,
  /^(?:npx|pnpm\s+(?:dlx|exec)|yarn\s+dl|bunx)\s+(?:vite|next|nuxt|astro|remix|ng|vue-cli-service|live-server|http-server)\b/,
  /^ng\s+serve\b/, /^vue-cli-service\s+serve\b/,
  /^python3?\s+-m\s+http\.server\b/, /^php\s+-S\b/, /^ruby\s+-runserver\b/,
  /(?:^|[\/ ])manage\.py\s+runserver\b/, /^flask\s+run\b/,
  /^uvicorn\b/, /^gunicorn\b/, /^daphne\b/,
  /^ssh\s+-[^\s]*L\b/, /^kubectl\s+port-forward\b/,
  /^serve\b/, /^http-server\b/, /^live-server\b/,
];

/**
 * 判定 Bash 命令的网络/端口属性（引号感知段级匹配）。
 *   受控安装入口（setup-playwright.mjs --install）的网络属性由其 CLI 语义
 *   决定，不走本函数——PreToolUse 预警在豁免判定之外统一覆盖。
 * @param {string} command
 * @returns {'network'|'port'|null} 命中类别（多段命令任一段命中即返回；
 *   network 优先——一条命令既下载又起服务时按更需授权的方向提示）
 */
export function netPortKind(command) {
  const c = String(command || '');
  if (!c) return null;
  let hitPort = false;
  for (const seg of splitSegmentsQuoteAware(c)) {
    if (NET_SEG_RES.some(rx => rx.test(seg))) return 'network';
    if (!hitPort && PORT_SEG_RES.some(rx => rx.test(seg))) hitPort = true;
  }
  return hitPort ? 'port' : null;
}

// ═══════════════════════════════════════════════════════════
// 2. 沙盒拒绝特征（证据侧 —— PostToolUse 检测失败输出）
// ═══════════════════════════════════════════════════════════

/** 强特征：沙盒/提权自述（任意命令命中即记，不依赖命令类别） */
const DENY_STRONG_RES = [
  /network\s+access\s+(?:is\s+)?(?:disabled|denied|not\s+allowed|unavailable)/i,
  /\bsandbox\b[^\n]{0,80}(?:denied|blocked|reject|violation|not\s+permitted|refused)/i,
  /(?:denied|blocked|rejected|refused)[^\n]{0,80}\bsandbox\b/i,
  /\bseatbelt\b/i, /\blandlock\b/i,
  /requires?\s+(?:approval|escalation|elevation)/i,
  /run\s+with\s+(?:--full-access|full\s+access|escalated)/i,
  /codex\s+sandbox/i,
];

/** 弱特征：网络失败/权限症状（仅网络/端口类命令命中才记——防文件权限误报） */
const DENY_WEAK_RES = [
  /\bEPERM\b/, /\bEACCES\b/, /\bEHOSTUNREACH\b/, /\bENETUNREACH\b/,
  /\bENOTFOUND\b/, /\bETIMEDOUT\b/, /\bECONNREFUSED\b/, /\bECONNRESET\b/,
  /operation\s+not\s+permitted/i,
  /permission\s+denied/i,
  /could\s+not\s+resolve\s+host/i, /getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)/i,
  /request\s+timed?\s*out/i, /network\s+request\s+failed/i,
  /network\s+error/i, /fetch\s+failed/i, /self\s+signed\s+certificate/i,
  /network\s+is\s+down/i,
];

/** 扫描文本上限（输出可能极大，特征匹配取头部窗口足够） */
const DENY_SCAN_LIMIT = 8000;

/**
 * 检测一次 Bash 执行是否疑似被 Codex 沙盒拒绝。
 *   判定条件（全部满足才命中——宁缺勿假）：
 *     a) 有明确失败证据（exit_code !== 0 或 success === false）
 *     b) 输出文本（stdout + stderr）命中强特征，或（弱特征 且 命令本身
 *        是网络/端口类）
 *   注意：EADDRINUSE（端口被占）不在特征内——那是资源冲突不是沙盒拒绝。
 * @param {{command:string, toolResponse:{stdout?:string, stderr?:string, output?:string, exit_code?:number|boolean, success?:boolean}}} arg
 * @returns {{kind:'sandbox'|'net_fail', evidence:string, command_kind:'network'|'port'|null}|null}
 */
export function detectSandboxDenial({ command, toolResponse }) {
  const tr = toolResponse || {};
  const exitCode = typeof tr.exit_code === 'number' ? tr.exit_code
    : (tr.success === false ? 1 : (tr.exit_code === false ? 1 : 0));
  const failed = (typeof tr.exit_code === 'number' && tr.exit_code !== 0)
    || tr.success === false
    || tr.exit_code === false;
  if (!failed) return null;

  const text = String(tr.stdout || '') + '\n' + String(tr.stderr || '') + '\n' + String(tr.output || '');
  const window = text.length > DENY_SCAN_LIMIT ? text.slice(0, DENY_SCAN_LIMIT) : text;
  if (!window.trim()) return null;

  const cmdKind = netPortKind(command);
  for (const rx of DENY_STRONG_RES) {
    const m = window.match(rx);
    if (m) return { kind: 'sandbox', evidence: m[0].slice(0, 120), command_kind: cmdKind };
  }
  if (cmdKind) {
    for (const rx of DENY_WEAK_RES) {
      const m = window.match(rx);
      if (m) return { kind: 'net_fail', evidence: m[0].slice(0, 120), command_kind: cmdKind };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// 3. 注入文案（单一事实源 —— PreToolUse 预警 / UserPromptSubmit 提醒共用）
// ═══════════════════════════════════════════════════════════

/** 类别 → 所需权限描述 */
const KIND_LABEL = {
  network: '网络访问',
  port: '端口监听（本地 dev server / 服务绑定）',
};

/**
 * PreToolUse 预警文案（规则 0f，每会话去重一次注入）。
 * @param {string} command 命中网络/端口特征的命令
 * @param {'network'|'port'} kind
 * @param {string} pluginRoot PLUGIN_ROOT（playwright 备选通道指引用）
 * @returns {string} warn additionalContext 文本
 */
export function sandboxWarnText(command, kind, pluginRoot) {
  const label = KIND_LABEL[kind] || '网络/端口';
  return `[ai-sdlc] 即将执行的命令需要**${label}**——Codex 沙盒默认拒绝此类操作（平台安全机制，非本插件门禁）。\n` +
    `当前命令：\`${String(command).slice(0, 160)}\`\n` +
    `若执行被拒（输出特征：network access is disabled / sandbox denied / Operation not permitted / EPERM / EACCES / ENOTFOUND 等）：\n` +
    `- **不要**反复原样重试，**不要**尝试改写命令形态绕过沙盒（违规）\n` +
    `- 应向用户呈报：① 需要执行的命令 ② 目的（装依赖/下载浏览器/起 dev server…）③ 所需权限（${label}）\n` +
    `- 由用户决定：批准提权运行（escalate），或选无需网络的替代方案\n` +
    `替代方案参考：Playwright 场景可先跑只读检测 \`node ${pluginRoot}/hooks/scripts/setup-playwright.mjs --check\`（本机 Chrome 通道可零浏览器下载）。\n` +
    `本提示每会话仅出现一次；真实被拒时下回合会收到针对性提醒。`;
}

/**
 * UserPromptSubmit 回合提醒文案（1f：上一命令疑似被沙盒拒绝）。
 * @param {{at:string, command:string, kind:string, evidence?:string}} denied hooks-state.sandbox_denied
 * @param {string} pluginRoot
 * @returns {string} 注入文本
 */
export function sandboxDeniedReminderText(denied, pluginRoot) {
  const d = denied || {};
  const kindText = d.kind === 'sandbox' ? '沙盒拒绝' : (d.kind === 'net_fail' ? '网络失败（疑似沙盒拦截）' : '疑似沙盒拒绝');
  const evidence = d.evidence ? `（输出特征：\`${String(d.evidence).slice(0, 80)}\`）` : '';
  return `### ⚠️ 上一命令疑似被 Codex 沙盒拒绝——需要用户授权\n` +
    `- 命令：\`${String(d.command || '').slice(0, 160)}\` ${kindText}${evidence}\n` +
    `- 正确动作：向用户呈报该命令与目的、说明所需权限（网络访问/端口监听），**请求授权提权运行**——不要反复重试或绕过沙盒\n` +
    `- Playwright 依赖场景：\`node ${pluginRoot}/hooks/scripts/setup-playwright.mjs --check\` 查看环境与替代选项（本机 Chrome 通道零浏览器下载），安装与否由用户抉择\n` +
    `- 用户若拒绝授权：改用无需网络的替代方案并如实说明`;
}
