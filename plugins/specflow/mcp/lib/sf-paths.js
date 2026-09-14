/**
 * sf-paths.js — specflow 项目级目录解析（MCP 侧，v0.7.0，用户反馈第 1 项）
 *
 * 与 scripts/lib/sfpaths.py、hooks/scripts/lib/common.mjs 同语义：
 *   <root>/.specflow 存在 → 新布局（配置与运行时同目录）
 *   否则有旧布局痕迹（.codex-plugin/ 或含 specflow 运行时文件的 .codex/）→ legacy
 *   否则默认新布局
 * 旧项目升级：重新运行 sf.sh init 自动迁移（非破坏）。
 */

const { existsSync } = require('node:fs');
const { resolve, join } = require('node:path');

const SF_DIR = '.specflow';
// ⚠ 与 scripts/lib/sfpaths.py、hooks/scripts/lib/common.mjs 的 RUNTIME_MARKERS 保持一致
// （v0.7.1：补齐 7 个此前遗漏的运行时文件，三处清单曾有漂移）
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
    const d = join(root, '.codex');
    if (!existsSync(d)) return false;
    return RUNTIME_MARKERS.some(m => existsSync(join(d, m)));
  } catch { return false; }
}

function layoutOf(projectRoot) {
  try {
    if (existsSync(join(projectRoot, SF_DIR))) return 'new';
    if (existsSync(join(projectRoot, '.codex-plugin')) || isLegacyRuntimeDir(projectRoot)) return 'legacy';
  } catch { /* fallthrough */ }
  return 'new';
}

/** 项目级配置文件路径（config.md / vars.yaml / agents/ / languages/） */
function configPath(projectRoot, name) {
  const rel = layoutOf(projectRoot) === 'legacy' ? '.codex-plugin' : SF_DIR;
  return resolve(projectRoot, rel, name);
}

/** 项目级运行时状态文件路径（todo-state.json / events.jsonl / ...） */
function runtimePath(projectRoot, name) {
  const rel = layoutOf(projectRoot) === 'legacy' ? '.codex' : SF_DIR;
  return resolve(projectRoot, rel, name);
}

module.exports = { layoutOf, configPath, runtimePath, SF_DIR };
