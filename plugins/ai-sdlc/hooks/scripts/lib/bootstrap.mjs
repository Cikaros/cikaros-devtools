/**
 * bootstrap.mjs — 首次使用自动初始化：state.json 全 schema 落盘 + .gitignore/.codexignore 托管块（幂等）
 * 分层：L3 领域层（依赖：paths / util / state）
 * v0.13.6 代码组织轮次从 common.mjs 按领域拆出——函数体原样保留（行为零变更），
 * 全量回归见 scripts/（triage / regression / round1-6 / smoke）。版本历史见
 * 插件 docs/changes/CHANGELOG.md。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { sdlcDir, asScope } from './paths.mjs';
import { fileExists } from './util.mjs';
import { writeCodexState, defaultState } from './state.mjs';

// ─────────────────────────────────────────────
// v0.10.0 首次使用自动初始化（ensureProjectBootstrap）
//   设计要求：用户不执行任何手动 init 命令，首个会话即完成初始化并自我声明。
//   幂等且廉价（数个 existsSync + 至多一次读文件），SessionStart 每次执行均安全。
//   .gitignore 托管块采用「忽略 .sdlc/* + 白名单例外」——未来新增运行时文件
//   默认被忽略（v0.9 前的 init 块清单过时即源于逐文件列名的漂移）；仅团队共享
//   配置（bands.yaml / custom/ / hooks/）留在版本控制。
// ─────────────────────────────────────────────
const GITIGNORE_MARK = '# >>> ai-sdlc workspace (runtime + artifacts, do not commit) >>>';
const GITIGNORE_MARK_END = '# <<< ai-sdlc workspace <<<';
const CODEXIGNORE_MARK = '# >>> ai-sdlc runtime (not for model context) >>>';
const CODEXIGNORE_MARK_END = '# <<< ai-sdlc runtime <<<';

const GITIGNORE_BLOCK = [
  '.sdlc/*',
  '!.sdlc/bands.yaml',
  '!.sdlc/custom/',
  '!.sdlc/hooks/',
].join('\n');

const CODEXIGNORE_BLOCK = [
  '.sdlc/state.json',
  '.sdlc/hooks-state.json',
  '.sdlc/session-end.json',
  '.sdlc/prompt-trace.json',
  '.sdlc/hook-audit.json',
  '.sdlc/events.jsonl',
  '.sdlc/merged-config.json',
  '.sdlc/session-map.json',
  '.sdlc/tasks.json',
  '.sdlc/quick-tasks.json',
  '.sdlc/cycles.json',
  '.sdlc/mcp-launcher.json',
  '.sdlc/mcp-bind-queue/',
  '.sdlc/sessions/',
  '.sdlc/*.tmp',
  '.sdlc/*.lock',
].join('\n');
// 注意：.codexignore 块刻意不含 .sdlc/artifacts/ 与 .sdlc/tasks/ —— 工件必须可被
// agent 读写（v0.9 的 init 脚本曾列 artifacts/，与「工件是下一阶段的输入」自相矛盾）。

/** 幂等追加托管块（已含标记则不动；返回是否写入） */
function ensureManagedBlock(filePath, mark, markEnd, block) {
  try {
    const existed = existsSync(filePath);
    const text = existed ? readFileSync(filePath, 'utf8') : '';
    if (text.includes(mark)) return false;
    const out = (existed && !text.endsWith('\n') ? text + '\n' : text)
      + (existed && text.trim() !== '' ? '\n' : '') + mark + '\n' + block + '\n' + markEnd + '\n';
    writeFileSync(filePath, out, 'utf8');
    return true;
  } catch { return false; }
}

/**
 * 项目引导（幂等）：
 *   1. state.json —— 缺失则落盘全量默认 schema（首次使用标记 firstUse=true）
 *   2. .gitignore 托管块 —— 仅当 .git 或 .gitignore 存在（非 git 目录不制造噪音；
 *      兼存量项目治愈：老版本建的 .sdlc/ 无忽略块时补齐）
 *   3. .codexignore 托管块 —— 仅追加到已存在文件（不主动新建）
 * @returns {{ firstUse: boolean, actions: string[], stateDir: string }}
 */
export function ensureProjectBootstrap(projectRoot) {
  const root = resolve(String(projectRoot));
  const actions = [];

  // 工件工作区目录（v0.10.0 落位约定的默认写入目标；agent 首个工件无需自建目录）
  try {
    const artDir = join(sdlcDir(root), 'artifacts');
    if (!existsSync(artDir)) { mkdirSync(artDir, { recursive: true }); actions.push('.sdlc/artifacts/'); }
  } catch {}

  const statePath = join(sdlcDir(root), 'state.json');
  const firstUse = !existsSync(statePath);
  if (firstUse) {
    if (writeCodexState(asScope(root), 'state.json', defaultState())) actions.push('.sdlc/state.json');
  }

  if (fileExists(join(root, '.git')) || fileExists(join(root, '.gitignore'))) {
    if (ensureManagedBlock(join(root, '.gitignore'), GITIGNORE_MARK, GITIGNORE_MARK_END, GITIGNORE_BLOCK)) {
      actions.push('.gitignore');
    }
  }

  const codexignore = join(root, '.codexignore');
  if (fileExists(codexignore)) {
    if (ensureManagedBlock(codexignore, CODEXIGNORE_MARK, CODEXIGNORE_MARK_END, CODEXIGNORE_BLOCK)) {
      actions.push('.codexignore');
    }
  }

  return { firstUse, actions, stateDir: sdlcDir(root) };
}
