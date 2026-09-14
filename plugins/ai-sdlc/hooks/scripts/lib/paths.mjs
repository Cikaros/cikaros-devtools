/**
 * paths.mjs — 插件/项目路径与作用域解析（PLUGIN_ROOT、.sdlc/、任务目录、scope 构造、工件候选表）
 * 分层：L0 基础层（依赖：仅 Node 内置模块）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** 插件根目录（hooks/scripts/lib/ 上溯 3 级） */
export const PLUGIN_ROOT = process.env.PLUGIN_ROOT
  ? resolve(process.env.PLUGIN_ROOT)
  : resolve(__dirname, '..', '..', '..');

const SDLC_DIR = '.sdlc';

// ─────────────────────────────────────────────
// v0.10.0 工件候选路径（单一事实源）
//   stage-detector / MCP orchestrator / 周期归档共用；候选顺序 = 检测优先级。
//   仓库根 / docs/ 路径在前 = 存量（v0.9 及以前）项目的工件优先命中，行为不变；
//   新项目工件按 prompts 约定写入 .sdlc/artifacts/（工作区，不进版本控制）。
// ─────────────────────────────────────────────
export const ARTIFACT_CANDIDATES = {
  'intent.md': ['intent.md', 'docs/intent.md', 'intent/current.md', '.sdlc/artifacts/intent.md'],
  'spec.md':   ['spec.md', 'docs/spec.md', 'docs/specs/current.md', '.sdlc/artifacts/spec.md'],
  'plan.md':   ['plan.md', 'docs/plan.md', 'docs/plans/current.md', '.sdlc/artifacts/plan.md'],
  'REVIEW.md': ['REVIEW.md', 'docs/REVIEW.md', '.sdlc/artifacts/REVIEW.md'],
  'AGENTS.md': ['AGENTS.md', 'CLAUDE.md'],
  'evals':     ['evals/', '.github/workflows/agent-evals.yml'],
  'bands':     ['bands.yaml', '.sdlc/bands.yaml', 'config/bands.yaml'],
};
// ─────────────────────────────────────────────
// 路径解析
// ─────────────────────────────────────────────

/** 项目级运行时目录（.sdlc/），自动创建 */
export function sdlcDir(projectRoot) {
  const d = resolve(projectRoot, SDLC_DIR);
  try { if (!existsSync(d)) mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

/**
 * 双模参数归一：字符串 projectRoot → legacy scope；scope 对象原样通过。
 * legacy scope 与 v0.4.0 行为完全一致（状态/工件都在项目根 + .sdlc/）。
 */
export function asScope(x) {
  if (x && typeof x === 'object' && x.stateDir) return x;
  const projectRoot = resolve(String(x));
  return {
    mode: 'legacy',
    taskId: null,
    taskDir: null,
    taskRel: null,
    stateDir: sdlcDir(projectRoot),
    projectRoot,
  };
}

/** 任务目录（.sdlc/tasks/<id>/），自动创建 */
export function taskDirOf(projectRoot, taskId) {
  const d = join(sdlcDir(projectRoot), 'tasks', taskId);
  try { if (!existsSync(d)) mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

/** 项目级运行时状态文件路径（scope 感知；legacy = .sdlc/<name>，task = 任务目录/<name>） */
export function runtimePath(scopeOrRoot, name) {
  const s = asScope(scopeOrRoot);
  return join(s.stateDir, name);
}

/** 项目级配置文件路径（DIY 自定义，始终全局 .sdlc/，不随任务隔离） */
export function configPath(projectRoot, name) {
  return resolve(sdlcDir(projectRoot), name);
}
