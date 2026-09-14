/**
 * notify.mjs — ai-sdlc 回合结束通知（v0.11.0，零依赖，Node 18+）
 *
 * 目标：使用者在 agent 工作期间可以离开终端；回合结束（任务完成或
 * Codex 需要用户输入/决策）时，用**系统级信号**（弹窗 + 声音）把人叫回来，
 * 最大化等待时间的利用效率。
 *
 * 触发点（Stop hook，见 stop.mjs 接线）：
 *   - needs-input（硬门禁，agent 必须结束回合等待用户）：fix_loop 修复循环
 *     中断（等待四决策）、Open questions 待发起者回答。**总是通知**（不受
 *     防噪阈值约束——这两类等待没有用户输入就不会推进）。
 *   - turn-end（普通回合结束）：受 SDLC_NOTIFY_MIN_SECONDS 防噪阈值约束
 *     （默认 10s——终端前的快速问答回合不打扰；长任务完成必达）。
 *   回合时长 = Stop 时刻 − 上一次 UserPromptSubmit 记录的 hooks-state.last_prompt_at；
 *   无记录（如会话未经用户输入直接结束）按保守策略通知。
 *
 * 触发点（PreToolUse，v0.13.13 审批等待通知，见 pre-tool-use.mjs 规则 0f 接线）：
 *   - approval-wait（预测式）：网络/端口类命令（curl / npm install / dev
 *     server 等）在 Codex 沙盒下默认需要用户批准——审批弹窗（“1. Yes,
 *     proceed (y) / 2. No (esc)”）出现在**回合进行中**，任务静默暂停。
 *     PreToolUse 在命令放行前命中网络/端口特征即发 alert 级通知把人叫回。
 *     降噪：在场窗口（PostToolUse 在网络/端口命令完成时刷新
 *     hooks-state.netport_last_exec_at；默认 120s 内静默——刚批准过/刚
 *     拒过 = 人就在终端）；独立于规则 0f 的 agent 教育文案去重。
 *
 * 分发（全部 fire-and-forget：detached + stdio ignore + unref，绝不阻塞 hook）：
 *   - 自定义命令（SDLC_NOTIFY_CMD 模板，{title}/{body} 占位）优先
 *   - macOS（v0.13.8 重构，两通道解耦）：
 *     · 弹窗：自托管 applet（ai-sdlc-notifier.app，osacompile 惰性生成于
 *       $CODEX_HOME/sdlc-notifier/，LSUIElement agent 无 Dock 图标）作为
 *       display notification 的宿主——点击通知只激活本 applet（无 argv 静默
 *       退出），不再打开 Script Editor；未就绪时经 detached bootstrap
 *       （notify-mac-setup.mjs）生成后首弹；极端降级 osascript 直发（点击
 *       行为回 Script Editor——保底语义，文档披露）
 *     · 声音：afplay 独立派发（直接音频输出，不经通知中心——sound name
 *       在 osascript 类宿主上经常静默，实测不可靠）；needs-input 用专属音
 *       （SDLC_NOTIFY_SOUND_MAC_ALERT，默认 Funk）与 turn-end（默认 Glass）
 *       区分紧急度
 *   - Windows：powershell.exe -File notify.ps1（Toast 通知 + 默认提示音；
 *     旧环境降级 SystemSounds / msg.exe，见该文件头部）
 *   - Linux（尽力而为）：notify-send + canberra-gtk-play
 *
 * 配置（env，与 SDLC_MAX_FIX_ROUNDS 同一惯例，均带默认值零配置可用）：
 *   SDLC_NOTIFY=off|0|false|no     总开关（默认 on）
 *   SDLC_NOTIFY_POPUP=off          关弹窗（默认 on）
 *   SDLC_NOTIFY_SOUND=off          关声音（默认 on）
 *   SDLC_NOTIFY_MIN_SECONDS=<n>    防噪阈值秒（默认 10；0=总是通知；needs-input 不受限）
 *   SDLC_NOTIFY_SOUND_MAC=<name>   macOS 提示音名·turn-end（默认 Glass，白名单字符校验）
 *   SDLC_NOTIFY_SOUND_MAC_ALERT=<name>  macOS 提示音名·needs-input 与 approval-wait（默认 Funk）
 *   SDLC_NOTIFY_CMD=<template>     自定义通知命令（{title}/{body} 替换；子进程
 *                                  另获 SDLC_NOTIFY_TITLE/SDLC_NOTIFY_BODY 环境变量，
 *                                  规避 shell 引号转义）
 *   SDLC_NOTIFY_APPROVAL=off       关审批等待通知（默认 on；预测式覆盖见下）
 *   SDLC_NOTIFY_APPROVAL_PRESENCE=<s>  在场窗口秒（默认 120；0=每次审批等待都通知）
 *
 * 设计边界（诚实披露，见 docs/lifecycle.md「回合结束通知」）：
 *   - Codex CLI 原生的工具审批弹窗（approval prompt）发生在回合进行中，
 *     hooks.json 六事件里没有对应事件，插件层无法直接感知。v0.13.13 起以
 *     **预测式信号**近似覆盖：网络/端口类命令（沙盒默认拦截 → 必触发审批
 *     或拒绝）在 PreToolUse 放行时通知。非网络类命令在其他审批策略
 *     （如 untrusted 全询问）下的弹窗仍不可预测——已知盲区，文档披露。
 *   - 预测式的假阳性：若用户以自动放行策略运行（网络命令不弹窗直接执行），
 *     仍会收到审批等待通知——在场窗口把连续假阳性压缩到每窗口至多一次；
 *     不受打扰可 SDLC_NOTIFY_APPROVAL=off 整类关闭。
 *   - 通知是尽力而为：spawn 失败/平台组件缺失（如 Linux 无 notify-send）
 *     静默降级，绝不影响 hook 主流程与退出码。
 *   - macOS 通知中心的「应用通知权限」若被用户手动关掉，applet 弹窗不显示
 *     （afplay 声音仍会响——双通道解耦的容错红利）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────
// 配置解析（纯函数，供测试注入 env）
// ─────────────────────────────────────────────

const OFF_VALUES = /^(0|false|off|no|disabled?)$/i;

/**
 * 三态环境布尔：未设/空 → 默认值；OFF 词表 → false；其余任意非空值 → true。
 * （宽进严出：SDLC_NOTIFY=1/on/true/yes 均为开，只有显式 OFF 词才关。）
 */
function envFlag(v, dflt) {
  if (v == null || String(v).trim() === '') return dflt;
  return !OFF_VALUES.test(String(v).trim());
}

/** 提示音名白名单（防路径注入：macOS afplay 拼接 /System/Library/Sounds/<name>.aiff） */
export function sanitizeSoundName(name) {
  const n = String(name == null ? '' : name).trim();
  return /^[A-Za-z0-9 _-]{1,40}$/.test(n) ? n : 'Glass';
}

/** needs-input 专属音白名单同规则（非法值回退 Funk） */
export function sanitizeAlertSoundName(name) {
  const n = String(name == null ? '' : name).trim();
  return /^[A-Za-z0-9 _-]{1,40}$/.test(n) ? n : 'Funk';
}

/** 审批等待通知在场窗口默认值（秒）——PostToolUse 网络端口命令完成后多久内静默 */
export const APPROVAL_PRESENCE_DEFAULT_S = 120;

/** @returns {{enabled,popup,sound,minSeconds,soundMac,soundMacAlert,customCmd,approval,approvalPresenceSeconds}} */
export function resolveNotifyConfig(env = process.env) {
  const secs = parseInt(String(env.SDLC_NOTIFY_MIN_SECONDS ?? '').trim(), 10);
  const presenceS = parseInt(String(env.SDLC_NOTIFY_APPROVAL_PRESENCE ?? '').trim(), 10);
  return {
    enabled: envFlag(env.SDLC_NOTIFY, true),
    popup: envFlag(env.SDLC_NOTIFY_POPUP, true),
    sound: envFlag(env.SDLC_NOTIFY_SOUND, true),
    minSeconds: Number.isFinite(secs) && secs >= 0 ? secs : 10,
    soundMac: sanitizeSoundName(env.SDLC_NOTIFY_SOUND_MAC),
    soundMacAlert: sanitizeAlertSoundName(env.SDLC_NOTIFY_SOUND_MAC_ALERT),
    customCmd: String(env.SDLC_NOTIFY_CMD || '').trim(),
    approval: envFlag(env.SDLC_NOTIFY_APPROVAL, true),
    approvalPresenceSeconds: Number.isFinite(presenceS) && presenceS >= 0 ? presenceS : APPROVAL_PRESENCE_DEFAULT_S,
  };
}

// ─────────────────────────────────────────────
// 通知内容构建（纯函数）
// ─────────────────────────────────────────────

/** AppleScript 字符串字面量转义（反斜杠 + 双引号） */
export function escapeAppleScript(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** 回合时长人类可读化：5s / 1m5s / 1h02m */
export function formatDuration(ms) {
  const s = Math.max(0, Math.round(Number(ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 > 0 ? `${m}m${s % 60}s` : `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

function clip(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/**
 * 构建回合结束通知（不负责分发）。
 *   needs-input 两个硬门禁绕过防噪阈值；turn-end 低于阈值返回 null（不打扰）。
 *   durationMs 为 null（无 UserPromptSubmit 记录）按保守策略：通知。
 * @returns {{kind:'needs-input'|'turn-end', title:string, body:string}|null}
 */
export function buildStopNotification({
  config,
  fixLoop = false, fixLoopRounds = null,
  awaitingAnswers = false, openQuestions = null,
  stageFull = '', humanGate = false,
  durationMs = null, scopeTag = '',
}) {
  const needsInput = fixLoop || awaitingAnswers;
  if (!needsInput) {
    if (config.minSeconds > 0 && durationMs != null && durationMs < config.minSeconds * 1000) {
      return null;   // 防噪：终端前的快速问答回合
    }
  }

  const stage = stageFull || 'SDLC';
  let title, body;
  if (fixLoop) {
    title = 'ai-sdlc · 需要你的决策';
    body = `修复循环中断（已连续失败 ${fixLoopRounds ?? '?'} 轮）· 阶段 ${stage} · 等待循环决策（loop_resolve）`;
  } else if (awaitingAnswers) {
    title = 'ai-sdlc · 等待你的回答';
    body = `intent.md 有 ${openQuestions ?? '?'} 个 Open questions 待回答 · 阶段 ${stage}`;
  } else {
    const parts = [`阶段 ${stage}`];
    if (humanGate) parts.push('含人工关卡');
    if (durationMs != null) parts.push(`历时 ${formatDuration(durationMs)}`);
    if (scopeTag && scopeTag !== 'legacy') parts.push(scopeTag);
    parts.push('回到终端查看');
    title = 'ai-sdlc · 回合完成';
    body = parts.join(' · ');
  }
  return { kind: needsInput ? 'needs-input' : 'turn-end', title, body: clip(body, 200) };
}

/**
 * 构建审批等待通知（v0.13.13，纯函数，不负责分发）。
 *   适用时刻：Codex 审批弹窗（“1. Yes, proceed (y) / 2. No (esc)”）出现在
 *   回合进行中——任务静默暂停、Stop 通知覆盖不到。PreToolUse 命中网络/端口
 *   特征即预测「即将弹审批」并构建本通知（alert 级：用户动作必需）。
 * @param {{command?:string, kind?:'network'|'port'|null}} p
 * @returns {{kind:'approval-wait', title:string, body:string}}
 */
export function buildApprovalWaitNotification({ command = '', kind = null } = {}) {
  const label = kind === 'network' ? '网络访问' : (kind === 'port' ? '端口监听' : '网络/端口');
  const cmd = clip(String(command || ''), 120);
  return {
    kind: 'approval-wait',
    title: 'ai-sdlc · 等待你的批准',
    body: clip(
      `Codex 正在等待你的选择（y 继续 / esc 拒绝）· 命令需${label}权限 · ` +
      (cmd || '命令见终端') + ' · 回到终端处理',
      200),
  };
}

// ─────────────────────────────────────────────
// macOS 通知宿主 applet（v0.13.8，自托管，免 Script Editor 归属）
// ─────────────────────────────────────────────

/**
 * 插件根目录推断（notify.mjs 位于 <root>/hooks/scripts/lib/）。
 * 用于版本自读 .codex-plugin/plugin.json（单一事实源，与 mcplink 同惯例）。
 */
function inferPluginRoot() {
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

/** 通知宿主 applet 版本标记（升版自愈：标记不匹配 → 重新生成） */
export function notifierVersion(pluginRoot) {
  try {
    const pj = JSON.parse(readFileSync(join(pluginRoot ?? inferPluginRoot(), '.codex-plugin/plugin.json'), 'utf8'));
    return `ai-sdlc-notifier/${pj.version || '0'}`;
  } catch { return 'ai-sdlc-notifier/0'; }
}

/** applet 缓存目录：$CODEX_HOME/sdlc-notifier（用户级，跨项目复用，与 prompts 注册同哲学） */
export function appletCacheDir(env = process.env) {
  const codexHome = String(env.CODEX_HOME || '').trim() || join(homedir(), '.codex');
  return join(codexHome, 'sdlc-notifier');
}

export function appletPath(env = process.env) {
  return join(appletCacheDir(env), 'ai-sdlc-notifier.app');
}

export function appletExecutable(env = process.env) {
  return join(appletPath(env), 'Contents', 'MacOS', 'ai-sdlc-notifier');
}

/** applet 就绪检测（同步快路径，~0.1ms，dispatchMacOS 每次调用） */
export function appletReady(env = process.env) {
  try { return existsSync(appletExecutable(env)); } catch { return false; }
}

/**
 * applet AppleScript 源码（每行一个 -e，osacompile 多行拼接标准用法）：
 *   - 有 argv（title body）＝被 notify 派发调用 → 弹通知（不带 sound name，
 *     声音由主进程 afplay 独立派发——通知中心声音策略不可靠）
 *   - 无 argv ＝用户点击通知激活本 app → 静默退出（不打开任何编辑器）
 */
export function buildAppletSource() {
  return [
    'on run argv',
    'if (count of argv) >= 2 then',
    'display notification (item 2 of argv) with title (item 1 of argv)',
    'end if',
    'end run',
  ];
}

/**
 * Info.plist 补丁（纯函数，零依赖文本处理，不调 plutil）：
 *   - LSUIElement=true：agent app 无 Dock 图标/无窗口/无菜单——点击通知激活无感
 *   - CFBundleDisplayName=ai-sdlc：通知中心来源显示名
 *   - CFBundleIdentifier 归一为 dev.cikaros.ai-sdlc-notifier（osacompile 默认
 *     指向 ScriptEditor 域——通知中心接此归因）
 *   - CFBundleGetInfoString=版本标记：升版自愈依据
 * 幂等：已有键不重复插入；已有 CFBundleIdentifier 替换值（防重复键）。
 * 安全：嵌套 dict 用 lastIndexOf('</dict>') 只命中顶层字典（plist 根 dict
 * 是文档最后一个 </dict>）。
 */
export function patchInfoPlist(text, versionMark) {
  let out = String(text);
  const BUNDLE_ID = 'dev.cikaros.ai-sdlc-notifier';
  // 归一 bundle identifier（已有则替换，防重复键）
  if (/<key>CFBundleIdentifier<\/key>\s*<string>[^<]*<\/string>/.test(out)) {
    out = out.replace(/(<key>CFBundleIdentifier<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${BUNDLE_ID}$2`);
  }
  const inject = [];
  if (!out.includes('<key>LSUIElement</key>')) inject.push('<key>LSUIElement</key><true/>');
  if (!out.includes('<key>CFBundleDisplayName</key>')) inject.push('<key>CFBundleDisplayName</key><string>ai-sdlc</string>');
  if (versionMark && !out.includes(versionMark)) inject.push(`<key>CFBundleGetInfoString</key><string>${versionMark}</string>`);
  if (inject.length === 0) return out;
  const idx = out.lastIndexOf('</dict>');
  if (idx === -1) return out;
  return out.slice(0, idx) + inject.join('') + out.slice(idx);
}

// ─────────────────────────────────────────────
// 平台分发（fire-and-forget）
// ─────────────────────────────────────────────

/** 子进程环境：附带标题/正文（自定义命令免引号转义地取值） */
function childEnv(title, body) {
  return { ...process.env, SDLC_NOTIFY_TITLE: title, SDLC_NOTIFY_BODY: body };
}

/**
 * 脱钩派发：detached + ignore stdio + unref。
 *   异步失败（ENOENT：平台组件缺失）由 error 事件静默吸收——通知尽力而为。
 * @returns {boolean} spawn 是否同步成功（不含异步失败）
 */
function fireAndForget(cmd, args, opts = {}) {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...opts });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch { return false; }
}

/**
 * macOS 分发计划（纯函数，可测）：
 *   popupChain —— 依序降级的弹窗通道（第一个 spawn 成功者胜出）：
 *     applet（已就绪快路径）→ applet-bootstrap（未就绪：detached 生成+首弹）
 *     → osascript-legacy（极端保底，点击会开 Script Editor——文档披露）
 *   soundFile —— afplay 音频文件（null ＝声音关闭）；alert 类用专属音
 */
export function macDispatchPlan(config, { ready = false, alert = false } = {}) {
  const popupChain = [];
  if (config.popup) {
    if (ready) popupChain.push('applet');
    popupChain.push('applet-bootstrap');
    popupChain.push('osascript-legacy');
  }
  const soundFile = config.sound
    ? `/System/Library/Sounds/${sanitizeSoundName(alert ? config.soundMacAlert : config.soundMac)}.aiff`
    : null;
  return { popupChain, soundFile };
}

/** 弹窗链步骤执行器 */
function execMacStep(step, title, body) {
  if (step === 'applet') {
    return fireAndForget(appletExecutable(), [title, body], { env: childEnv(title, body) });
  }
  if (step === 'applet-bootstrap') {
    const setup = fileURLToPath(new URL('./notify-mac-setup.mjs', import.meta.url));
    return fireAndForget(process.execPath, [setup, title, body], { env: childEnv(title, body) });
  }
  // osascript-legacy：不带 sound name（声音由 afplay 独立通道，避免双声）
  const as = `display notification "${escapeAppleScript(body)}" with title "${escapeAppleScript(title)}"`;
  return fireAndForget('osascript', ['-e', as], { env: childEnv(title, body) });
}

function dispatchMacOS(title, body, config, alert = false) {
  const plan = macDispatchPlan(config, { ready: appletReady(), alert });
  const via = [];
  for (const step of plan.popupChain) {
    if (execMacStep(step, title, body)) { via.push(step); break; }
  }
  // 声音与弹窗解耦：afplay 直接音频输出，不依赖通知中心声音策略（必达）
  if (plan.soundFile && fireAndForget('afplay', [plan.soundFile], { env: childEnv(title, body) })) {
    via.push('afplay');
  }
  return { dispatched: via.length > 0, via: via.join('+') || 'not-available' };
}

function dispatchWindows(title, body, config) {
  if (!config.popup && !config.sound) return { dispatched: false, via: 'nothing-enabled' };
  // 参数经 argv 传给 -File（不经 -Command 拼接）——无引号/注入面；
  // powershell.exe（Windows PowerShell 5.1）全系 Windows 预装，toast 需其 WinRT 投影。
  const ps1 = fileURLToPath(new URL('./notify.ps1', import.meta.url));
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, '-Title', title, '-Body', body];
  if (!config.popup) args.push('-NoPopup');
  if (!config.sound) args.push('-NoSound');
  const okSpawn = fireAndForget('powershell.exe', args, { env: childEnv(title, body) });
  return { dispatched: okSpawn, via: okSpawn ? 'powershell-toast' : 'powershell-spawn-failed' };
}

function dispatchLinux(title, body, config) {
  // 尽力而为：组件缺失时 spawn 异步 ENOENT → 静默
  const via = [];
  if (config.popup && fireAndForget('notify-send', ['-a', 'ai-sdlc', title, body], { env: childEnv(title, body) })) {
    via.push('notify-send');
  }
  if (config.sound && fireAndForget('canberra-gtk-play', ['-i', 'message'], { env: childEnv(title, body) })) {
    via.push('canberra');
  }
  return { dispatched: via.length > 0, via: via.join('+') || 'not-available' };
}

/**
 * 分发一条通知。优先 SDLC_NOTIFY_CMD；否则按平台内置链路。
 *   自定义命令属用户本机自配（与任意 shell 别名同级信任），模板原样交给 shell。
 *   alert=true（needs-input 类）在 macOS 上选用专属提示音。
 * @returns {{dispatched:boolean, via:string}}
 */
export function dispatchNotification({ title, body, config, alert = false }) {
  if (config.customCmd) {
    const cmd = config.customCmd.replaceAll('{title}', title).replaceAll('{body}', body);
    const okSpawn = fireAndForget(cmd, [], { shell: true, env: childEnv(title, body) });
    return { dispatched: okSpawn, via: okSpawn ? 'custom' : 'custom-spawn-failed' };
  }
  if (process.platform === 'darwin') return dispatchMacOS(title, body, config, alert);
  if (process.platform === 'win32') return dispatchWindows(title, body, config);
  return dispatchLinux(title, body, config);
}

// ─────────────────────────────────────────────
// Stop hook 编排入口（stop.mjs 唯一调用点）
// ─────────────────────────────────────────────

/**
 * 回合结束通知编排：读配置 → 构建内容（含防噪判定）→ fire-and-forget 分发。
 *   返回值进 stop hook 的审计明细（detail.notify）——「为什么没通知」可排障。
 * @param {object} p
 * @param {number|null} p.lastPromptAt  hooks-state.last_prompt_at（epoch ms）
 * @param {boolean} p.fixLoop           修复循环中断（state.fix_loop && isEngaged）
 * @param {number|null} p.fixLoopRounds
 * @param {boolean} p.awaitingAnswers   planning/awaiting_answers
 * @param {number|null} p.openQuestions 未回答数
 * @param {string} p.stageFull          如 "Stage 3b · Build (implement)"
 * @param {boolean} p.humanGate         当前阶段有人工关卡
 * @param {string} p.scopeTag           'legacy' | 'task:T-xxx'
 * @param {object} [p.config]           已解析配置（测试注入；默认读 process.env）
 * @returns {{notified:boolean, kind:string|null, reason:string, duration_ms:number|null}}
 */
export function notifyTurnEnd({
  lastPromptAt = null,
  fixLoop = false, fixLoopRounds = null,
  awaitingAnswers = false, openQuestions = null,
  stageFull = '', humanGate = false, scopeTag = '',
  config = resolveNotifyConfig(),
}) {
  if (!config.enabled) return { notified: false, kind: null, reason: 'disabled', duration_ms: null };
  const durationMs = typeof lastPromptAt === 'number' && lastPromptAt > 0 ? Date.now() - lastPromptAt : null;
  const note = buildStopNotification({
    config, fixLoop, fixLoopRounds, awaitingAnswers, openQuestions,
    stageFull, humanGate, durationMs, scopeTag,
  });
  if (!note) return { notified: false, kind: null, reason: 'below-min-duration', duration_ms: durationMs };
  const r = dispatchNotification({ title: note.title, body: note.body, config, alert: note.kind === 'needs-input' });
  return {
    notified: r.dispatched,
    kind: note.kind,
    reason: r.dispatched ? `via:${r.via}` : `dispatch-failed:${r.via}`,
    duration_ms: durationMs,
  };
}

// ─────────────────────────────────────────────
// PreToolUse 编排入口（pre-tool-use.mjs 规则 0f 调用点，v0.13.13）
// ─────────────────────────────────────────────

/**
 * 审批等待通知编排（预测式）：配置 → 在场窗口判定 → 构建 → fire-and-forget 分发。
 *   返回值进 pre-tool-use 审计明细（detail.approval_notify）——「为什么没通知」
 *   可排障（disabled / approval-off / presence-window / via:xxx）。
 *
 * 在场窗口（approvalPresenceSeconds，默认 120s）：PostToolUse 在网络/端口命令
 *   **完成**时刷新 hooks-state.netport_last_exec_at——刚完成 = 用户刚批准过/
 *   刚拒绝过（人在终端）或该策略下根本不弹窗（自动放行）。窗口内静默，把
 *   连续审批的噪音压缩到每窗口至多一次通知；窗口外的等待重新通知（人可能
 *   又离开了）。被沙盒拒绝的执行同样刷新在场（用户刚在弹窗上选过 No，或
 *   on-failure 流程的弹窗刚出现——后者已由本次执行前的 PreToolUse 通知覆盖）。
 *
 * @param {object} p
 * @param {string} p.command          触发命令（网络/端口特征已由调用方判定）
 * @param {'network'|'port'} p.kind   netPortKind 命中类别
 * @param {number|null} p.lastNetPortAt  hooks-state.netport_last_exec_at（epoch ms；null=无记录）
 * @param {object} [p.config]         已解析配置（测试注入；默认读 process.env）
 * @param {Function} [p.dispatch]     分发函数（测试注入；默认 dispatchNotification）
 * @returns {{notified:boolean, reason:string}}
 */
export function notifyApprovalWait({
  command = '', kind = null, lastNetPortAt = null,
  config = resolveNotifyConfig(), dispatch = dispatchNotification,
} = {}) {
  if (!config.enabled) return { notified: false, reason: 'disabled' };
  if (!config.approval) return { notified: false, reason: 'approval-off' };
  if (typeof lastNetPortAt === 'number' && lastNetPortAt > 0
    && config.approvalPresenceSeconds > 0
    && Date.now() - lastNetPortAt < config.approvalPresenceSeconds * 1000) {
    return { notified: false, reason: 'presence-window' };
  }
  const note = buildApprovalWaitNotification({ command, kind });
  const r = dispatch({ title: note.title, body: note.body, config, alert: true });
  return { notified: r.dispatched, reason: r.dispatched ? `via:${r.via}` : `dispatch-failed:${r.via}` };
}
