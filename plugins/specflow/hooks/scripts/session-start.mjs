#!/usr/bin/env node
/**
 * session-start.mjs — SessionStart hook（触发点 1/5）
 *
 * 输入（stdin JSON，Codex hooks 协议）：
 *   { session_id, transcript_path, cwd, hook_event_name: "SessionStart", source }
 *
 * 执行（对应 HOOKS.md §2.2.1，失败逐级降级，永不阻塞会话）：
 *   1. env-scanner.py  → <运行时目录>/env-scan.json
 *   2. doc-parser.py   → <运行时目录>/parsed-config.json（仅当项目配置 config.md 存在）
 *   3. todo-scanner.py → <运行时目录>/todo-state.json
 *   4. workflow-state.py status --agent default（v0.4.0 / B3：恢复工作流状态，
 *      项目已初始化时自动创建 default agent）
 *   5. 按主语言加载 templates/coding/<lang>/spec.md 摘要（v0.4.0 / A1；无对应
 *      语言规范时回退提示 spec/coding-standards.md 基线）
 *   6. 汇总写 <运行时目录>/hooks-state.json + loaded-sections.json（v0.4.0 / A5
 *      加载清单可观测：global / lang / stage 分层 + token 估算）
 *
 * v0.7.0：项目目录统一 .specflow/（旧项目自动回退，路径经 common.mjs sfPaths；
 * 用户反馈第 1 项）
 *
 * 输出（stdout JSON）：
 *   { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "摘要" } }
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseInput, projectRootOf, runPythonLib, safeJsonParse,
  writeCodexState, readCodexState, emitHookOutput, appendAudit, PLUGIN_ROOT,
  configPath, runtimeDirName, buildResourceIndex,
} from './lib/common.mjs';
import { mergeAll } from './lib/merge-engine.mjs';
import { ANTI_PATTERN_TRIGGERS } from './lib/common.mjs';
import { appendEvent } from './events.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();

/** 摘要策略：取前 N 个非空行，硬上限 maxChars 字符 */
function digestOf(relPath, { maxLines = 50, maxChars = 1800 } = {}) {
  const p = resolve(PLUGIN_ROOT, relPath);
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).slice(0, maxLines);
  let d = lines.join('\n');
  if (d.length > maxChars) d = `${d.slice(0, maxChars)}\n…（截断，完整内容: ${relPath}）`;
  return d;
}

const steps = [];
let environment = null;
let configKeys = 0;
let todoSummary = null;
let primaryLang = null;
const loadedSections = []; // v0.4.0 / A5：加载清单（含 token 估算）
const tokenEst = (s) => Math.ceil((s || '').length / 4);

// 1. 环境扫描
const scan = runPythonLib('env-scanner.py', [projectRoot, '--format=json'], projectRoot, 15);
if (scan.ok) {
  environment = safeJsonParse(scan.stdout);
  if (environment) {
    // env-scanner.py 实际输出：lang_stack.primary 为字符串；shell 嵌套在 os 下
    primaryLang = environment.lang_stack?.primary?.lang || environment.lang_stack?.primary || null;
    const shellName = environment.shell?.name || environment.os?.shell?.name || '?';
    steps.push({ step: 'env_scan', status: 'ok', summary: `${environment.os?.system || '?'}/${shellName}/${primaryLang || 'none'}` });
  } else {
    steps.push({ step: 'env_scan', status: 'warn', summary: 'stdout 非合法 JSON' });
  }
} else {
  steps.push({ step: 'env_scan', status: 'failed', error: (scan.stderr || '').slice(0, 300) });
}

// 2. 配置解析（仅当项目已初始化；v0.7.0 路径经 sfPaths）
const configFile = configPath(projectRoot, 'config.md');
if (existsSync(configFile)) {
  const parse = runPythonLib('doc-parser.py', [configFile, '--format=json'], projectRoot, 10);
  if (parse.ok) {
    const parsed = safeJsonParse(parse.stdout);
    const cfg = parsed?.config || {};
    configKeys = Object.keys(cfg).length;
    writeCodexState(projectRoot, 'parsed-config.json', parsed || {});
    steps.push({ step: 'parse_config', status: 'ok', summary: `${configKeys} keys` });
  } else {
    steps.push({ step: 'parse_config', status: 'warn', error: (parse.stderr || '').slice(0, 300) });
  }
} else {
  steps.push({ step: 'parse_config', status: 'skipped', summary: '未初始化项目（可运行 /setup-specflow 或 sf.sh init）' });
}

// 3. 标记扫描（todo-scanner.py 实际输出：markers 数组 + summary{total,created,resolved,deleted}）
const todoScan = runPythonLib('todo-scanner.py', [projectRoot, '--format=json'], projectRoot, 15);
if (todoScan.ok) {
  todoSummary = safeJsonParse(todoScan.stdout);
  writeCodexState(projectRoot, 'todo-state.json', todoSummary || {});
  const markerCount = todoSummary?.summary?.total
    ?? (Array.isArray(todoSummary?.markers) ? todoSummary.markers.length : 0);
  steps.push({ step: 'scan_todos', status: 'ok', summary: `${markerCount} markers` });
} else {
  steps.push({ step: 'scan_todos', status: 'warn', error: (todoScan.stderr || '').slice(0, 300) });
}

// 4.（v0.4.0 / B3）恢复工作流状态：status --agent default（default 不存在时自动创建）
let currentStage = null;
const initialized = existsSync(configFile);
if (initialized) {
  const wf = runPythonLib('workflow-state.py',
    ['--project-root', projectRoot, 'status', '--agent', 'default', '--json'], projectRoot, 10);
  if (wf.ok) {
    const wfs = safeJsonParse(wf.stdout);
    if (wfs && wfs.current_stage) {
      currentStage = wfs.current_stage;
      //（v0.4.0 / B2）产出声明导入：config.md 的 outputs → agent 状态
      const imp = runPythonLib('workflow-state.py',
        ['--project-root', projectRoot, 'import-outputs', '--agent', 'default'], projectRoot, 10);
      const impr = imp.ok ? safeJsonParse(imp.stdout) : null;
      steps.push({
        step: 'restore_workflow', status: 'ok',
        summary: `stage=${currentStage}${impr?.imported_count ? `, outputs+${impr.imported_count}` : ''}`,
      });
    } else {
      steps.push({ step: 'restore_workflow', status: 'warn', summary: 'status 输出无 current_stage' });
    }
  } else {
    steps.push({ step: 'restore_workflow', status: 'warn', error: (wf.stderr || '').slice(0, 300) });
  }
}

// 5.（v0.4.0 / A5）加载清单 global 层：spec/ 基线（始终登记，可观测）
for (const rel of ['spec/coding-standards.md', 'spec/security-baseline.md']) {
  const p = resolve(PLUGIN_ROOT, rel);
  if (existsSync(p)) {
    const content = readFileSync(p, 'utf8');
    loadedSections.push({ layer: 'global', file: rel, token_estimate: tokenEst(content), chars: content.length, loaded_by: 'session-start' });
  }
}

// 6.（v0.4.0 / A1）按主语言加载语言规范摘要
//    v0.9.1：移除 LANG_DIR_MAP 硬编码（v0.9.0 只覆盖 5 语言且 kotlin 错指 java），
//            改为目录存在性检查——支持 13 语言（templates/coding/<lang>/spec.md）
//    v0.9.1：移除 langSpecDigest 的大段计算（v0.8.0 起已不注入内容，只用 token 估算）
//            只记录 loaded-sections 用于可观测性
let langSpecRel = null;
if (primaryLang) {
  const langKey = String(primaryLang).toLowerCase();
  // 项目自定义语言规范优先（<配置目录>/languages/<lang>.md，v0.7.0 路径经 sfPaths）
  const customRel = `${runtimeDirName(projectRoot) === '.codex' ? '.codex-plugin' : '.specflow'}/languages/${langKey}.md`;
  const customPath = configPath(projectRoot, `languages/${langKey}.md`);
  if (existsSync(customPath)) {
    langSpecRel = customRel;
    try {
      const raw = readFileSync(customPath, 'utf8');
      loadedSections.push({
        layer: 'lang', file: langSpecRel, lang: String(primaryLang),
        token_estimate: tokenEst(raw.slice(0, 2000)),
        note: '项目自定义语言规范（优先于内置模板）', loaded_by: 'session-start',
      });
    } catch {}
  }
  if (!langSpecRel) {
    // v0.9.1：直接检查 templates/coding/<langKey>/spec.md 是否存在（支持 13 语言）
    const builtinRel = `templates/coding/${langKey}/spec.md`;
    const p = resolve(PLUGIN_ROOT, builtinRel);
    if (existsSync(p)) {
      langSpecRel = builtinRel;
      try {
        const raw = readFileSync(p, 'utf8');
        loadedSections.push({
          layer: 'lang', file: langSpecRel, lang: String(primaryLang),
          token_estimate: tokenEst(raw.slice(0, 2000)),
          note: '语言规范模板（按需读取，不注入内容，v0.8.0 智能提示）', loaded_by: 'session-start',
        });
      } catch {}
    }
  }
}

// 7. v1.0.0 合并引擎——SessionStart 执行一次，结果缓存供所有 hook 共享
const mergedConfig = mergeAll({
  projectRoot,
  pluginRoot: PLUGIN_ROOT,
  builtinAntiPatterns: ANTI_PATTERN_TRIGGERS,  // v1.1.1 修复 P0-2：传内置反模式给合并引擎，让 merged-config.json 成为单一事实源
  builtinLangKeywords: {},
  builtinToolchains: {},
});
writeCodexState(projectRoot, 'merged-config.json', mergedConfig);
if (mergedConfig.warnings.length > 0) {
  for (const w of mergedConfig.warnings) {
    appendAudit(projectRoot, { hook: 'merge_engine', trigger: 'SessionStart', result: 'warning', detail: { warning: w } });
  }
}
appendAudit(projectRoot, {
  hook: 'merge_engine', trigger: 'SessionStart',
  result: 'success', detail: {
    stages: mergedConfig.stages.length,
    antiPatterns: mergedConfig.antiPatterns.length,
    languages: Object.keys(mergedConfig.languages).length,
    hookRules: mergedConfig.hookRules.preToolUse.length + mergedConfig.hookRules.postToolUse.length,
    customFiles: Object.keys(mergedConfig.customFiles).length,
    warnings: mergedConfig.warnings.length,
  },
});

// 8. hooks 状态 + 加载清单落盘（路径经 sfPaths）
//    v0.9.1：schema 统一——current_lang 改为 current_language（与 user-prompt-submit 对齐）
//    v0.9.1：初始化 v0.8.0/v0.9.0 新增字段（injected_anti_patterns / cumulative_tokens / last_inject_tokens）
//    v1.0.0：初始化 DIY 字段（custom_files / merged_config_path）
const state = {
  session_id: input.session_id || `sess-${Date.now()}`,
  session_started_at: new Date().toISOString(),
  last_trigger: 'session_start',
  source: input.source || 'startup',
  current_stage: currentStage,
  current_language: primaryLang,         // v0.9.1：与 user-prompt-submit 对齐
  project_root: projectRoot,
  plugin_root: process.env.PLUGIN_ROOT || 'self-located',
  injected_files: langSpecRel ? [langSpecRel] : [],
  injected_anti_patterns: [],             // v0.9.1：初始化
  hooks_executed: 1,
  cumulative_tokens: 0,                   // v0.9.1：初始化
  last_inject_tokens: 0,                  // v0.9.1：初始化
};
writeCodexState(projectRoot, 'hooks-state.json', state);

//（v0.4.0 / A5）<运行时目录>/loaded-sections.json：global/lang 分层 + token 估算
writeCodexState(projectRoot, 'loaded-sections.json', {
  updated_at: new Date().toISOString(),
  session_id: state.session_id,
  sections: loadedSections,
  total_token_estimate: loadedSections.reduce((s, e) => s + (e.token_estimate || 0), 0),
});

appendAudit(projectRoot, {
  hook: 'session_start', trigger: 'SessionStart',
  duration_ms: Date.now() - t0, result: steps.some(s => s.status === 'failed') ? 'degraded' : 'success',
  detail: { steps: steps.length, config_keys: configKeys, markers: todoSummary?.summary?.total ?? (Array.isArray(todoSummary?.markers) ? todoSummary.markers.length : 0), stage: currentStage },
});

// v0.6.0（A7）：session_start 事件（事件总线 events.jsonl，路径经 sfPaths）
appendEvent(projectRoot, 'session_start', {
  session_id: state.session_id,
  detail: `loaded ${loadedSections.length} sections, lang=${primaryLang || 'n/a'}, stage=${currentStage || 'n/a'}`,
});

// 8. 注入上下文摘要（v0.8.0：智能提示机制——只注入索引 + 关键警告，不全量加载）
//    设计原则：session-start 只告诉 agent「有什么资源 + 怎么获取」；
//    具体内容由 user-prompt-submit 按需注入（反模式警告直接注入，阶段规则/语言特性按需提示）
const os = environment?.os?.system || '?';
const shell = environment?.shell?.name || environment?.os?.shell?.name || '?';
const markers = todoSummary?.summary?.total
  ?? (Array.isArray(todoSummary?.markers) ? todoSummary.markers.length : 0);
const created = todoSummary?.summary?.created ?? 0;
const unresolved = created || markers;

const rtName = runtimeDirName(projectRoot);   // v0.7.0：提示文本用真实运行时目录名
const lines = [
  '【specflow 已激活】本会话由 specflow 插件注入。采用**智能提示机制**——',
  '此会话启动只注入资源索引；具体阶段规则/语言特性/反模式由 UserPromptSubmit hook 按需注入。',
  '',
  `### 工程状态`,
  `- 环境: ${os}/${shell}，主语言: ${primaryLang || '未检出'}`,
  `- 配置: ${configKeys > 0 ? `${configKeys} 个配置键已解析（${rtName}/parsed-config.json）` : '项目未初始化（可运行 /setup-specflow）'}`,
  `- 标记: 共 ${markers} 个 TODO/FIXME（详见 ${rtName}/todo-state.json，用 mcp__hook-orchestrator__get_hook_status 查询）`,
  currentStage
    ? `- 工作流: default agent 当前阶段 ${currentStage}（产出检查已接入，advance 缺产出会阻塞）`
    : '- 规则: 请遵循 spec/ 与 rules/ 规范；编码改动前先确认当前工作流阶段',
];
if (markers > 0) lines.push(`- 优先处理未完成标记: ${unresolved} 个 created 状态（形如 //TODO#NNN 注释）`);
if (steps.some(s => s.status === 'failed' || s.status === 'warn')) {
  lines.push(`- ⚠ 部分步骤降级（详情见 ${rtName}/hook-audit.json），不影响会话继续`);
}

// v0.8.0：追加资源索引（替代旧版的全量注入语言规范摘要）
lines.push('');
lines.push(buildResourceIndex(projectRoot, primaryLang, currentStage));

emitHookOutput({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: lines.join('\n'),
  },
});
