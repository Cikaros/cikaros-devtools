/**
 * merge-engine.mjs — specflow 合并引擎（v1.0.0 DIY 架构核心）
 *
 * 职责：
 *   加载项目自定义文件 + 内置内容 → 按维度合并策略 → 产出最终规则集
 *   SessionStart 时执行一次，结果缓存到 <运行时目录>/merged-config.json
 *
 * 合并策略（ADR-009 D2）：
 *   - 阶段规则：自定义阶段追加到内置 5 阶段后；同名阶段规则覆盖
 *   - 语言模板：同名覆盖；新语言追加
 *   - 反模式规则：自定义 rules 追加到内置 ANTI_PATTERN_TRIGGERS（去重 by id）
 *   - hook 规则：自定义 rules 追加到内置规则后执行（内置优先）
 *   - 配置：6 层优先级（环境变量 > 个人 > 项目 > 团队 > 全局 > 内置）
 *
 * 降级策略（REQ-MERGE-04）：
 *   自定义文件不存在/格式错误时，该维度回退到内置 + 告警
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * 内置 5 阶段（无自定义时的回退值）
 */
export const BUILTIN_STAGES = [
  { name: 'req-analysis', order: 1, displayName: '需求分析' },
  { name: 'arch-design', order: 2, displayName: '架构设计' },
  { name: 'coding', order: 3, displayName: '编码实现' },
  { name: 'review', order: 4, displayName: '代码评审' },
  { name: 'testing', order: 5, displayName: '测试验证' },
];

/**
 * 合并引擎主入口
 * @param {object} opts - { projectRoot, pluginRoot, builtinAntiPatterns, builtinLangKeywords, builtinToolchains }
 * @returns {object} merged config { stages, antiPatterns, langKeywords, toolchains, hookRules, customFiles, warnings }
 */
export function mergeAll(opts) {
  const {
    projectRoot,
    pluginRoot,
    builtinAntiPatterns = [],
    builtinLangKeywords = {},
    builtinToolchains = { toolchains: [] },
  } = opts;

  const warnings = [];
  const customFiles = {};

  // === 1. 阶段/工作流 ===
  const stagesResult = mergeStages(projectRoot, pluginRoot);
  customFiles.stages = stagesResult.source;
  warnings.push(...stagesResult.warnings);

  // === 2. 语言模板 ===
  const langResult = mergeLanguages(projectRoot, pluginRoot);
  customFiles.languages = langResult.source;
  warnings.push(...langResult.warnings);

  // === 3. 反模式规则 ===
  const apResult = mergeAntiPatterns(projectRoot, builtinAntiPatterns);
  customFiles.antiPatterns = apResult.source;
  warnings.push(...apResult.warnings);

  // === 4. hook 规则 ===
  const hookResult = mergeHookRules(projectRoot);
  customFiles.hookRules = hookResult.source;
  warnings.push(...hookResult.warnings);

  // === 5. 知识库配置（v1.1.0 P1）===
  const kbResult = mergeErrorKbConfig(projectRoot);
  customFiles.errorKbConfig = kbResult.source;
  warnings.push(...kbResult.warnings);

  // === 6. MCP 工具配置（v1.1.0 P1）===
  const mcpResult = mergeMcpTools(projectRoot);
  customFiles.mcpTools = mcpResult.source;
  warnings.push(...mcpResult.warnings);

  // === 5. 工具链（当前直接用内置，自定义工具链是 P1）===
  const toolchains = builtinToolchains;

  return {
    stages: stagesResult.stages,
    antiPatterns: apResult.antiPatterns,
    languages: langResult.languages,
    hookRules: hookResult.hookRules,
    errorKbConfig: kbResult.config,
    mcpTools: mcpResult.tools,
    toolchains,
    customFiles,
    warnings,
    merged_at: new Date().toISOString(),
  };
}

// ─── 阶段合并 ───

function mergeStages(projectRoot, pluginRoot) {
  const stagesFile = resolve(projectRoot, '.specflow/stages.md');
  const source = { file: '.specflow/stages.md', exists: existsSync(stagesFile) };
  const warnings = [];

  if (!source.exists) {
    // 回退到内置 5 阶段
    return { stages: BUILTIN_STAGES.map(s => ({ ...s, transitions: null, outputs: null })), source, warnings };
  }

  try {
    const content = readFileSync(stagesFile, 'utf8');
    const parsed = parseStagesMd(content);

    // 内置阶段 + 自定义阶段（追加）
    const builtinNames = new Set(BUILTIN_STAGES.map(s => s.name));
    const customStages = parsed.stages.filter(s => !builtinNames.has(s.name));
    const allStages = [
      ...BUILTIN_STAGES.map(s => {
        const custom = parsed.stages.find(cs => cs.name === s.name);
        return custom ? { ...s, ...custom } : { ...s, transitions: null, outputs: null };
      }),
      ...customStages,
    ];

    // 附带 transitions
    for (const stage of allStages) {
      const key = `${stage.name}`;
      // transitions 在 parsed.transitions 里用 "from→to" 键
      for (const [transKey, transVal] of Object.entries(parsed.transitions || {})) {
        if (transKey.startsWith(key + '→')) {
          stage.transitions = stage.transitions || [];
          stage.transitions.push({ to: transKey.split('→')[1], ...transVal });
        }
      }
    }

    return { stages: allStages, source, warnings };
  } catch (e) {
    warnings.push(`stages.md 解析失败: ${e.message}，回退到内置 5 阶段`);
    return { stages: BUILTIN_STAGES.map(s => ({ ...s, transitions: null, outputs: null })), source, warnings };
  }
}

/**
 * 解析 stages.md（表格 + codex:json block）
 */
function parseStagesMd(content) {
  // 提取 frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const fm = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split(/\r?\n/)) {
      const m = line.match(/^(\w+):\s*(.*)$/);
      if (m) fm[m[1]] = m[2];
    }
  }

  // 提取阶段表格（| 序号 | 阶段名 | 说明 | 产出物 |）
  const stages = [];
  const tableLines = content.split(/\r?\n/).filter(l => l.trim().startsWith('|') && !l.includes('---'));
  for (const line of tableLines) {
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 2 && /^\d+$/.test(cells[0])) {
      stages.push({
        name: cells[1],
        order: parseInt(cells[0]),
        displayName: cells[2] || cells[1],
        output: cells[3] || null,
      });
    }
  }

  // 提取 codex:json block（transitions）
  let transitions = {};
  const jsonBlockMatch = content.match(/```codex:json\r?\n([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1]);
      transitions = parsed.transitions || {};
    } catch {}
  }

  return { version: fm.version || 1, stages, transitions };
}

// ─── 语言模板合并 ───

function mergeLanguages(projectRoot, pluginRoot) {
  const customLangDir = resolve(projectRoot, '.specflow/languages');
  const builtinLangDir = resolve(pluginRoot, 'templates/coding');
  const source = { file: '.specflow/languages/', exists: existsSync(customLangDir) };
  const warnings = [];

  // 收集内置语言
  const languages = {};
  try {
    const builtinLangs = readdirSync(builtinLangDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    for (const lang of builtinLangs) {
      languages[lang] = { source: 'builtin', path: resolve(builtinLangDir, lang) };
    }
  } catch {}

  // 覆盖/追加自定义语言
  if (source.exists) {
    try {
      const customLangs = readdirSync(customLangDir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name);
      for (const lang of customLangs) {
        languages[lang] = { source: 'custom', path: resolve(customLangDir, lang) };
      }
    } catch (e) {
      warnings.push(`读取 .specflow/languages/ 失败: ${e.message}`);
    }
  }

  return { languages, source, warnings };
}

// ─── 反模式规则合并 ───

function mergeAntiPatterns(projectRoot, builtinAntiPatterns) {
  const apFile = resolve(projectRoot, '.specflow/anti-patterns.json');
  const source = { file: '.specflow/anti-patterns.json', exists: existsSync(apFile) };
  const warnings = [];

  if (!source.exists) {
    return { antiPatterns: builtinAntiPatterns, source, warnings };
  }

  try {
    const content = readFileSync(apFile, 'utf8');
    const parsed = JSON.parse(content);
    const customRules = parsed.rules || [];

    // 合并：内置 + 自定义（去重 by id）
    const seenIds = new Set(builtinAntiPatterns.map(r => r[2])); // r[2] = id
    const merged = [...builtinAntiPatterns];
    for (const rule of customRules) {
      if (rule.id && seenIds.has(rule.id)) {
        warnings.push(`反模式规则 ${rule.id} 与内置规则重复，跳过`);
        continue;
      }
      if (!rule.pattern || !rule.lang || !rule.id || !rule.warn) {
        warnings.push(`反模式规则缺失必填字段: ${JSON.stringify(rule).slice(0, 80)}`);
        continue;
      }
      // pattern 长度限制（REQ-SEC-01）
      if (rule.pattern.length > 100) {
        warnings.push(`反模式 pattern 过长（>100 字符）: ${rule.id}`);
        continue;
      }
      seenIds.add(rule.id);
      merged.push([rule.pattern, rule.lang, rule.id, rule.warn]);
    }

    source.customCount = customRules.length;
    return { antiPatterns: merged, source, warnings };
  } catch (e) {
    warnings.push(`anti-patterns.json 解析失败: ${e.message}，回退到内置`);
    return { antiPatterns: builtinAntiPatterns, source, warnings };
  }
}

// ─── hook 规则合并 ───

function mergeHookRules(projectRoot) {
  const source = { preToolUse: null, postToolUse: null };
  const warnings = [];
  const hookRules = { preToolUse: [], postToolUse: [] };

  // PreToolUse
  const preFile = resolve(projectRoot, '.specflow/hooks/pre-tool-use.json');
  source.preToolUse = { file: '.specflow/hooks/pre-tool-use.json', exists: existsSync(preFile) };
  if (source.preToolUse.exists) {
    try {
      const parsed = JSON.parse(readFileSync(preFile, 'utf8'));
      hookRules.preToolUse = validateHookRules(parsed.rules || [], 'pre-tool-use', warnings);
    } catch (e) {
      warnings.push(`pre-tool-use.json 解析失败: ${e.message}`);
    }
  }

  // PostToolUse
  const postFile = resolve(projectRoot, '.specflow/hooks/post-tool-use.json');
  source.postToolUse = { file: '.specflow/hooks/post-tool-use.json', exists: existsSync(postFile) };
  if (source.postToolUse.exists) {
    try {
      const parsed = JSON.parse(readFileSync(postFile, 'utf8'));
      hookRules.postToolUse = validateHookRules(parsed.rules || [], 'post-tool-use', warnings);
    } catch (e) {
      warnings.push(`post-tool-use.json 解析失败: ${e.message}`);
    }
  }

  return { hookRules, source, warnings };
}

/**
 * 校验 hook 规则格式
 * 必填：id, pattern, action(pre)/severity(post)
 * 可选：matcher, reason, message, lang
 */
function validateHookRules(rules, type, warnings) {
  const valid = [];
  for (const rule of rules) {
    if (!rule.id || !rule.pattern) {
      warnings.push(`${type} 规则缺失 id/pattern: ${JSON.stringify(rule).slice(0, 80)}`);
      continue;
    }
    if (rule.pattern.length > 100) {
      warnings.push(`${type} pattern 过长（>100 字符）: ${rule.id}`);
      continue;
    }
    // 测试 pattern 正则是否可编译
    try {
      new RegExp(rule.pattern);
      // v1.1.1 P1-2：也测试 matcher 正则
      new RegExp(`^(?:${rule.matcher || '.*'})$`);
    } catch (e) {
      warnings.push(`${type} pattern 正则编译失败 (${rule.id}): ${e.message}，跳过此规则`);
      continue;
    }
    valid.push({
      id: rule.id,
      pattern: rule.pattern,
      matcher: rule.matcher || '.*',
      action: rule.action || (type === 'pre-tool-use' ? 'warn' : undefined),
      severity: rule.severity || (type === 'post-tool-use' ? 'warn' : undefined),
      reason: rule.reason || rule.message || '',
    });
  }
  return valid;
}

/**
 * 生成合并配置摘要（供 sf.sh config show 使用）
 */
export function summarizeMergedConfig(merged) {
  return {
    stages: merged.stages.map(s => `${s.order}. ${s.name} (${s.displayName})`),
    antiPatterns: {
      total: merged.antiPatterns.length,
      builtin: merged.antiPatterns.length - (merged.customFiles.antiPatterns?.customCount || 0),
      custom: merged.customFiles.antiPatterns?.customCount || 0,
    },
    languages: Object.entries(merged.languages).map(([lang, info]) => `${lang} (${info.source})`),
    hookRules: {
      preToolUse: merged.hookRules.preToolUse.length,
      postToolUse: merged.hookRules.postToolUse.length,
    },
    customFiles: Object.entries(merged.customFiles).map(([dim, info]) => {
      if (typeof info === 'object' && info !== null) {
        if (info.exists !== undefined) return `${dim}: ${info.exists ? 'loaded' : 'not found'}`;
        if (info.preToolUse) return `${dim}: pre=${info.preToolUse.exists}, post=${info.postToolUse.exists}`;
      }
      return `${dim}: ${JSON.stringify(info)}`;
    }),
    warnings: merged.warnings,
  };
}

// ─── 知识库配置合并（v1.1.0 P1）───

function mergeErrorKbConfig(projectRoot) {
  const cfgFile = resolve(projectRoot, '.specflow/error-kb-config.json');
  const source = { file: '.specflow/error-kb-config.json', exists: existsSync(cfgFile) };
  const warnings = [];
  const defaultConfig = {
    organization: 'by-lang',
    matchStrategy: 'exact',
    fuzzyThreshold: 3,
  };

  if (!source.exists) {
    return { config: defaultConfig, source, warnings };
  }

  try {
    const parsed = JSON.parse(readFileSync(cfgFile, 'utf8'));
    const config = { ...defaultConfig, ...parsed };

    // 校验枚举值
    if (!['exact', 'regex', 'fuzzy'].includes(config.matchStrategy)) {
      warnings.push(`error-kb-config.json matchStrategy "${config.matchStrategy}" 无效，降级为 exact`);
      config.matchStrategy = 'exact';
    }
    if (!['by-lang', 'by-module', 'flat'].includes(config.organization)) {
      warnings.push(`error-kb-config.json organization "${config.organization}" 无效，降级为 by-lang`);
      config.organization = 'by-lang';
    }
    if (typeof config.fuzzyThreshold !== 'number' || config.fuzzyThreshold < 0 || config.fuzzyThreshold > 10) {
      warnings.push(`error-kb-config.json fuzzyThreshold ${config.fuzzyThreshold} 无效，降级为 3`);
      config.fuzzyThreshold = 3;
    }

    return { config, source, warnings };
  } catch (e) {
    warnings.push(`error-kb-config.json 解析失败: ${e.message}，回退默认`);
    return { config: defaultConfig, source, warnings };
  }
}

// ─── MCP 工具配置合并（v1.1.0 P1）───

function mergeMcpTools(projectRoot) {
  const mcpFile = resolve(projectRoot, '.specflow/mcp-tools.json');
  const source = { file: '.specflow/mcp-tools.json', exists: existsSync(mcpFile) };
  const warnings = [];
  const tools = [];

  if (!source.exists) {
    return { tools, source, warnings };
  }

  try {
    const parsed = JSON.parse(readFileSync(mcpFile, 'utf8'));
    for (const tool of parsed.tools || []) {
      if (!tool.name || !tool.command) {
        warnings.push(`MCP 工具缺失 name/command: ${JSON.stringify(tool).slice(0, 80)}`);
        continue;
      }
      // 安全检查：禁止 ../ 和绝对路径（REQ-SEC-02）
      const cmdPath = tool.args && tool.args[0] ? tool.args[0] : tool.command;
      if (cmdPath.includes('..') || /^[\\/]/.test(cmdPath)) {
        warnings.push(`MCP 工具 ${tool.name} 路径不安全（含 ../ 或绝对路径），跳过`);
        continue;
      }
      tools.push({
        name: tool.name,
        description: tool.description || '',
        command: tool.command,
        args: tool.args || [],
        events: tool.events || [],
        matcher: tool.matcher || '.*',
        timeout: tool.timeout || 30,
      });
    }
    return { tools, source, warnings };
  } catch (e) {
    warnings.push(`mcp-tools.json 解析失败: ${e.message}`);
    return { tools, source, warnings };
  }
}
