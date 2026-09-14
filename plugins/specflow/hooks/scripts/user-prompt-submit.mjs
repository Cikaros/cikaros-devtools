#!/usr/bin/env node
/**
 * user-prompt-submit.mjs — UserPromptSubmit hook（触发点 3/5，原 prompt_receive）
 *
 * v0.8.0：智能提示机制——不再每次注入大段阶段规则，改为：
 *   1. 反模式检测：prompt 含已知反模式（如 : any / interface{} / Optional.get()）→ 直接注入警告
 *   2. 阶段规则：仅首次检测到该阶段时注入摘要（hooks-state.injected_files 去重）
 *   3. 语言特性：仅首次检测到该语言时**提示**（不注入内容）用户可 Read features.md
 *   4. token 预算：单次注入上限 ~2000 字符；累计上限 ~8000 字符
 *
 * 输入（stdin JSON）：{ session_id, cwd, turn_id, prompt, hook_event_name: "UserPromptSubmit" }
 *
 * 输出（stdout JSON）：
 *   { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "..." } }
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseInput, projectRootOf, writeCodexState, readCodexState,
  emitHookOutput, appendAudit, PLUGIN_ROOT,
  smartInject, smartInjectV2, estimateTokens,
} from './lib/common.mjs';

const input = parseInput();
const projectRoot = projectRootOf(input);
const t0 = Date.now();
const prompt = typeof input.prompt === 'string' ? input.prompt : '';

// v0.8.0：读取当前 hooks-state（用于去重 + token 预算追踪）
const hooksState = readCodexState(projectRoot, 'hooks-state.json') || {};
const injectedFiles = new Set(hooksState.injected_files || []);
const injectedAnti = new Set(hooksState.injected_anti_patterns || []);
const cumulativeTokens = hooksState.cumulative_tokens || 0;

// v1.0.0：读取合并引擎缓存的 merged-config.json（SessionStart 时生成）
const mergedConfig = readCodexState(projectRoot, 'merged-config.json') || null;

// v1.0.0：合并自定义反模式到内置 ANTI_PATTERN_TRIGGERS
// 合并策略（ADR-009 D2）：自定义 rules 追加到内置数组（去重 by id）
const mergedAntiPatterns = mergedConfig && mergedConfig.antiPatterns && mergedConfig.antiPatterns.length > 0
  ? mergedConfig.antiPatterns
  : null;  // null = 用内置（smartInjectV2 内部会读 ANTI_PATTERN_TRIGGERS）

// 智能注入分析（v0.9.0：用 smartInjectV2 加入工具链检测）
// v1.0.0：若有合并后的反模式规则，传入 smartInjectV2 优先使用
const analysis = smartInjectV2(prompt, {
  injected_files: Array.from(injectedFiles),
  injected_anti_patterns: Array.from(injectedAnti),
}, projectRoot);

// v1.0.0：补充检测自定义反模式（合并引擎加载的，不依赖 ANTI_PATTERN_TRIGGERS 硬编码）
if (mergedAntiPatterns && !analysis.antiPatterns.some(a => a.fromCustom)) {
  const lower = prompt.toLowerCase();
  for (const [pattern, lang, id, warn] of mergedAntiPatterns) {
    // 跳过内置的（已由 smartInjectV2 处理）
    if (analysis.antiPatterns.find(a => a.id === id)) continue;
    // v0.9.1：语言过滤
    if (analysis.language && analysis.language !== lang) continue;
    if (prompt.includes(pattern) && !injectedAnti.has(id)) {
      analysis.antiPatterns.push({ id, lang, pattern, warn, fromCustom: true });
      injectedAnti.add(id);
    }
  }
}

// 写 prompt-trace（记录检测到的 stage / language / antiPatterns）
const trace = {
  session_id: input.session_id || null,
  ts: new Date().toISOString(),
  prompt_preview: prompt.slice(0, 120),
  detected_stage: analysis.stage,
  detected_language: analysis.language,
  detected_anti_patterns: analysis.antiPatterns.map(a => a.id),
  suggested_files: analysis.suggestFiles.map(s => s.path),
};
writeCodexState(projectRoot, 'prompt-trace.json', trace);

const lines = [];
const newInjectedFiles = [];
const SINGLE_INJECT_LIMIT = 2000;   // 单次注入字符上限
const CUMULATIVE_LIMIT = 8000;       // 累计注入字符上限

// 1. 反模式警告（直接注入，最高优先级）
if (analysis.antiPatterns.length > 0) {
  lines.push('### 反模式警告（specflow 检测到以下模式）');
  for (const ap of analysis.antiPatterns) {
    lines.push(`- **${ap.lang}** 命中 \`${ap.pattern}\`：${ap.warn}`);
    lines.push(`  - 详情可读 templates/coding/${ap.lang}/anti-patterns.md`);
    injectedAnti.add(ap.id);
  }
  lines.push('');
}

// 2. 阶段规则注入（仅首次检测到该阶段时）
if (analysis.stage && !injectedFiles.has(`rules/stage-${analysis.stage}.md`)) {
  const rulesPath = resolve(PLUGIN_ROOT, 'rules', `stage-${analysis.stage}.md`);
  if (existsSync(rulesPath)) {
    const text = readFileSync(rulesPath, 'utf8');
    const rulesLines = text.split('\n').filter(l => l.trim()).slice(0, 40);
    let rulesDigest = rulesLines.join('\n');
    if (rulesDigest.length > 1600) {
      rulesDigest = `${rulesDigest.slice(0, 1600)}\n…（截断，完整内容: rules/stage-${analysis.stage}.md）`;
    }
    lines.push(`### 阶段规则注入（首次检测到 ${analysis.stage}）`);
    lines.push(rulesDigest);
    lines.push('');
    injectedFiles.add(`rules/stage-${analysis.stage}.md`);
    newInjectedFiles.push(`rules/stage-${analysis.stage}.md`);
  }
}

// 3. 语言特性提示（不注入内容，只提示用户可读）
if (analysis.language && !injectedFiles.has(`templates/coding/${analysis.language}/features.md`)) {
  lines.push(`### 语言资源提示`);
  lines.push(`- 检测到 **${analysis.language}** 相关关键词；以下文件可按需读取：`);
  lines.push(`  - \`templates/coding/${analysis.language}/features.md\` — 语言特性`);
  lines.push(`  - \`templates/coding/${analysis.language}/standards.md\` — 编码规范`);
  lines.push(`  - \`templates/coding/${analysis.language}/anti-patterns.md\` — 反模式与易错点`);
  lines.push(`  - \`templates/coding/${analysis.language}/docs.md\` — 文档规范`);
  lines.push(`  - \`templates/coding/${analysis.language}/spec.md\` — 总览`);
  lines.push('');
  // 标记为"已提示"，避免重复提示（虽然没注入内容）
  injectedFiles.add(`templates/coding/${analysis.language}/features.md`);
  newInjectedFiles.push(`templates/coding/${analysis.language}/features.md`);
}

// 3b. v0.9.0 工具链检测提示
if (analysis.toolchains && analysis.toolchains.length > 0) {
  lines.push(`### 工具链关联（v0.9.0 语言-工具链衔接）`);
  for (const tc of analysis.toolchains) {
    if (tc.matched_files) {
      lines.push(`- 检测到 **${tc.displayName}**（特征文件: ${tc.matched_files.join(', ')}）`);
      lines.push(`  - 关联语言: ${tc.languages.join(' / ')}`);
      lines.push(`  - 工具链配置见 \`templates/coding/toolchains.json\` 的 \`${tc.name}\``);
    } else if (tc.note) {
      lines.push(`- **${tc.displayName}**：${tc.note}`);
    }
  }
  lines.push('');
}

// 4. token 预算检查
let additionalContext = lines.join('\n');
const thisTokenCost = estimateTokens(additionalContext);
const newCumulative = cumulativeTokens + thisTokenCost;

if (newCumulative > CUMULATIVE_LIMIT) {
  // 累计超额：只保留反模式警告（最高优先级），其余截断
  const warningOnly = lines.filter(l => !l.startsWith('### 阶段规则') && !l.includes('rulesDigest')).join('\n');
  additionalContext = `### token 预算超额提示\n累计注入已达 ${newCumulative} tokens（上限 ${CUMULATIVE_LIMIT}）。\n本次仅保留反模式警告：\n${warningOnly}`;
} else if (additionalContext.length > SINGLE_INJECT_LIMIT) {
  additionalContext = additionalContext.slice(0, SINGLE_INJECT_LIMIT) + '\n…（截断，单次注入上限）';
}

// 5. 更新 hooks-state
hooksState.current_stage = analysis.stage || hooksState.current_stage;
hooksState.current_language = analysis.language || hooksState.current_language;
hooksState.detected_by = 'user_prompt_submit';
hooksState.last_trigger = 'user_prompt_submit';
hooksState.hooks_executed = (hooksState.hooks_executed || 0) + 1;
hooksState.injected_files = Array.from(injectedFiles);
hooksState.injected_anti_patterns = Array.from(injectedAnti);
hooksState.cumulative_tokens = newCumulative;
hooksState.last_inject_tokens = thisTokenCost;
writeCodexState(projectRoot, 'hooks-state.json', hooksState);

// 6. 更新 loaded-sections.json
if (newInjectedFiles.length > 0) {
  const loaded = readCodexState(projectRoot, 'loaded-sections.json') || { sections: [] };
  if (Array.isArray(loaded.sections)) {
    const others = loaded.sections.filter(e => !newInjectedFiles.includes(e.file));
    for (const f of newInjectedFiles) {
      const p = resolve(PLUGIN_ROOT, f);
      const content = existsSync(p) ? readFileSync(p, 'utf8') : '';
      others.push({
        layer: f.startsWith('rules/') ? 'stage' : 'lang',
        file: f,
        stage: analysis.stage,
        language: analysis.language,
        token_estimate: Math.ceil(Math.min(content.length, 1600) / 4),
        note: analysis.antiPatterns.find(a => f.includes(a.lang)) ? '反模式触发' : '按需注入',
        loaded_by: 'user-prompt-submit',
        loaded_at: new Date().toISOString(),
      });
    }
    loaded.sections = others;
    loaded.updated_at = new Date().toISOString();
    loaded.total_token_estimate = loaded.sections.reduce((s, e) => s + (e.token_estimate || 0), 0);
    writeCodexState(projectRoot, 'loaded-sections.json', loaded);
  }
}

appendAudit(projectRoot, {
  hook: 'user_prompt_submit', trigger: 'UserPromptSubmit',
  duration_ms: Date.now() - t0, result: 'success',
  detail: {
    stage: analysis.stage,
    language: analysis.language,
    anti_patterns: analysis.antiPatterns.length,
    new_injections: newInjectedFiles.length,
    this_tokens: thisTokenCost,
    cumulative_tokens: newCumulative,
  },
});

const hasContent = additionalContext.length > 0;
emitHookOutput(hasContent ? {
  hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext },
} : {});
