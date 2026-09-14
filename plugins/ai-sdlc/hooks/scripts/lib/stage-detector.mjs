/**
 * stage-detector.mjs — AI-Native SDLC 阶段自动检测
 *
 * 核心承诺：用户无需显式 @ 插件或 slash 命令，插件根据仓库中已提交的工件
 * 自动判定当前 SDLC 阶段。判定规则严格遵循 Anthropic《AI-Native SDLC playbook》：
 *
 *   阶段 1 PLANNING   — 任何提交 / 接受的 intent.md 都触发；无 intent.md 时
 *                       用户的首条提问自动视为"想生成 intent.md"
 *   阶段 1.5 PLANNING（awaiting_answers）— intent.md 已存在但 Open questions
 *                       仍有未回答项（v0.6.0 交互闭环：问题必须先呈现给发起者
 *                       并得到回答，否则停留在 Stage 1）
 *   阶段 2 DESIGN     — intent.md 已存在（Open questions 全部已回答/为空），但 spec.md 不存在
 *   阶段 3 BUILD      — spec.md 已存在（视为已被产品负责人接受）。
 *                       子阶段：plan.md 不存在 → plan_mode（计划模式，禁止改代码）
 *                                plan.md 存在 → implementation（实施）
 *   阶段 4 TEST       — plan.md + 主要代码改动都已落地（git 有 diff），未通过测试或测试不全
 *   阶段 5 DEPLOY     — 测试通过 + 等待 PR 审查 / 部署门禁
 *   阶段 6 MAINTAIN   — 工件链已合并到 main，进入监控/巡检/闭环
 *
 * 工件位置约定（v0.10.0 起工作区化，详见 docs/lifecycle.md）：
 *   - legacy 模式：`.sdlc/artifacts/`（默认工作区）；根目录 / docs/ 候选保留兼容
 *     存量（v0.9 及以前）项目的工件
 *   - task 模式：`.sdlc/tasks/<task-id>/` 优先（隔离工作区），legacy 候选作为回退
 *   - AGENTS.md        根目录（Codex 约定；遗留项目可能是 CLAUDE.md）
 *   - .sdlc/state.json 插件运行时状态（手工覆盖优先级最高）
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PLUGIN_ROOT, runtimePath, readCodexState, writeCodexState, fileExists, fileMtime, asScope, parseOpenQuestions, ARTIFACT_CANDIDATES, defaultState, mutateCodexState } from './common.mjs';

// ─────────────────────────────────────────────
// 阶段定义（与 prompts/ skills/ rules/ 对齐）
// ─────────────────────────────────────────────

export const STAGES = [
  {
    id: 'planning',
    name: 'Plan',
    full: 'Stage 1 — Planning',
    artifact: 'intent.md',
    next: 'design',
    description: '把发起者的痛点以原话形式捕获为 intent.md（.sdlc 工作区工件）',
    required_artifacts: [],
    produces: ['intent.md'],
    skill: 'sdlc-planning',
    prompt: 'prompts/intent.md',
    rule: 'rules/stage-planning.md',
  },
  {
    id: 'design',
    name: 'Design',
    full: 'Stage 2 — Design',
    artifact: 'spec.md',
    next: 'build_plan',
    description: '需求与设计在一个会话中合成 spec.md（应用组织 skills 标记关切）',
    required_artifacts: ['intent.md'],
    produces: ['spec.md'],
    skill: 'sdlc-design',
    prompt: 'prompts/spec.md',
    rule: 'rules/stage-design.md',
  },
  {
    id: 'build_plan',
    name: 'Build (Plan)',
    full: 'Stage 3a — Build / Plan Mode',
    artifact: 'plan.md',
    next: 'build_impl',
    description: 'Codex 在 plan 模式下读 spec.md 生成 plan.md，工程师迭代后接受',
    required_artifacts: ['spec.md'],
    produces: ['plan.md'],
    skill: 'sdlc-build',
    prompt: 'prompts/plan.md',
    rule: 'rules/stage-build.md',
    substage_of: 'build',
  },
  {
    id: 'build_impl',
    name: 'Build (Implementation)',
    full: 'Stage 3b — Build / Implementation',
    artifact: 'diff+tests',
    next: 'test',
    description: '接受 plan.md 后实施；偏离计划时同提交更新 plan.md',
    required_artifacts: ['plan.md'],
    produces: ['diff', 'tests'],
    skill: 'sdlc-build',
    prompt: 'prompts/build.md',
    rule: 'rules/stage-build.md',
    substage_of: 'build',
  },
  {
    id: 'test',
    name: 'Test',
    full: 'Stage 4 — Test',
    artifact: 'test-pass',
    next: 'deploy',
    description: '会话自检（make test/lint/build）+ 持续评估套件（AGENTS.md/skills/hooks 改动触发回归）',
    required_artifacts: ['plan.md'],
    produces: ['test-pass', 'eval-pass'],
    skill: 'sdlc-test',
    prompt: 'prompts/test.md',
    rule: 'rules/stage-test.md',
  },
  {
    id: 'deploy',
    name: 'Deploy',
    full: 'Stage 5 — Deploy',
    artifact: 'pr-merged',
    next: 'maintain',
    description: 'AI 在 PR 审查循环中双向 review + 钩子作为审批门 + CI/CD 沙盒部署',
    required_artifacts: ['test-pass'],
    produces: ['pr-merged'],
    skill: 'sdlc-deploy',
    prompt: 'prompts/deploy.md',
    rule: 'rules/stage-deploy.md',
  },
  {
    id: 'maintain',
    name: 'Maintain',
    full: 'Stage 6 — Maintain',
    artifact: 'incident→intent.md',
    next: 'planning',  // 闭环回到 Stage 1
    description: '确定性监控触发 Codex 写 intent.md，形成闭环',
    required_artifacts: ['pr-merged'],
    produces: ['intent.md'],  // 闭环产物
    skill: 'sdlc-maintain',
    prompt: 'prompts/maintain.md',
    rule: 'rules/stage-maintain.md',
  },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map(s => [s.id, s]));

// ─────────────────────────────────────────────
// 工件文件查找（多候选位置）
//   v0.10.0：候选表单源化——ARTIFACT_CANDIDATES 定义于 common.mjs（stage-detector /
//   MCP orchestrator / 周期归档共用；此前三份拷贝漂移风险）
// ─────────────────────────────────────────────

/**
 * 工件查找（v0.5.0 scope 感知）：
 * task 模式下优先任务隔离工作区 `.sdlc/tasks/<id>/<name>`，legacy 候选作回退。
 * 接受 scope 对象或 projectRoot 字符串（双模兼容）。
 */
export function findArtifact(scopeOrRoot, name) {
  const s = asScope(scopeOrRoot);
  const candidates = ARTIFACT_CANDIDATES[name] || [name];
  const all = s.mode === 'task'
    ? [join(s.taskRel, name), ...candidates]
    : candidates;
  for (const rel of all) {
    const p = resolve(s.projectRoot, rel);
    if (fileExists(p)) return { path: p, rel };
  }
  return null;
}

export function artifactExists(scopeOrRoot, name) {
  return findArtifact(scopeOrRoot, name) !== null;
}

// ─────────────────────────────────────────────
// git 状态探测（用于判定 build_impl / test / deploy 是否就绪）
// v0.5.0：scope 感知——git 操作始终针对项目仓库根（task 工作区在同仓库内）
// ─────────────────────────────────────────────

function gitStatusPorcelain(scope) {
  const s = asScope(scope);
  // 不依赖外部 git 命令——优先看 .git 是否存在；存在则尝试 git status --porcelain
  // 失败时降级为 null（不影响阶段判定主路径）
  if (!fileExists(resolve(s.projectRoot, '.git'))) return null;
  try {
    const r = spawnSync('git', ['status', '--porcelain'], { cwd: s.projectRoot, encoding: 'utf8', timeout: 3000 });
    if (r.status !== 0 || !r.stdout) return null;
    // v0.7.0 修复：不得对整串 stdout 做 trim()——porcelain 行格式为「XY + 空格 +
    // 路径」（如 ` M .sdlc/state.json`，X 为空格很常见）。整串 trim 会剥掉首行
    // 的前导空格，使首行 slice(3) 路径错位（`.sdlc/` 变成 `sdlc/`），下方
    // .sdlc/ 过滤对首行失效——纯插件状态变更被误判为业务 diff，maintain 检测
    // 失效 / test-deploy 误触发。改为逐行 trim（保留行内前导状态字符语义）。
    return r.stdout.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  } catch { return null; }
}

function gitHasUncommittedDiff(scope) {
  const lines = gitStatusPorcelain(scope);
  if (!lines) return false;
  // 过滤掉 .sdlc/ 自身的运行时文件（含 tasks/ 工作区——那属于插件状态而非业务 diff）
  // v0.13.10 修复：插件 bootstrap 自建的忽略文件（.gitignore / .codexignore）在
  //   未提交（porcelain `??`）状态同样不构成业务 diff——全新项目首会话若把它计入，
  //   plan.md 落地后 hasDiff=true 会让 detectStage 误判为 Stage 4 TEST：
  //   ① 规则 1（plan 模式禁改代码）以 detection.stage 判定，误跳后门禁失效；
  //   ② Stop 按 detection.stage 呈现「测试未通过」误导 + 错误人工关卡。
  //   已提交后的用户自行修改（` M`）仍计入——那是真实的业务编辑。
  return lines.some(l => {
    // v0.7.0：porcelain 路径从 index 3 开始（XY 状态 + 空格）；首行不再被
    // 整串 trim 破坏，但仍防御性处理空行/短行
    if (l.length < 3) return false;
    const xy = l.slice(0, 2);
    const path = l.slice(3).trim();
    if (xy === '??' && (path === '.gitignore' || path === '.codexignore' || path === '.gitattributes')) return false;
    return !path.startsWith('.sdlc/') && !path.startsWith('.specflow/');
  });
}

function gitBranch(scope) {
  const s = asScope(scope);
  if (!fileExists(resolve(s.projectRoot, '.git'))) return null;
  try {
    // v0.4.0 修复：优先 branch --show-current。
    // rev-parse --abbrev-ref HEAD 在「未首次提交的新分支」（unborn branch）上
    // exit 128 → 返回 null → 刚创建 feature 分支的新仓库永远检测不到
    // test/deploy 阶段（gitBranch null 使 deploy 条件 branch && ... 恒假）。
    const r = spawnSync('git', ['branch', '--show-current'], { cwd: s.projectRoot, encoding: 'utf8', timeout: 2000 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
    // 回退：兼容旧 git（<2.22）与 detached HEAD（返回 'HEAD'）
    const r2 = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: s.projectRoot, encoding: 'utf8', timeout: 2000 });
    if (r2.status === 0 && r2.stdout && r2.stdout.trim()) return r2.stdout.trim();
    return null;
  } catch { return null; }
}

// ─────────────────────────────────────────────
// 主检测函数：根据工件存在性 + git 状态推导当前阶段
// ─────────────────────────────────────────────

/**
 * 自动检测当前 SDLC 阶段
 * @param {string} projectRoot
 * @param {object} opts - { promptHint: 用户当前 prompt（用于强化 planning 判定） }
 * @returns {object} { stage, substage, artifacts, missing, confidence, source }
 */
export function detectStage(scopeOrRoot, opts = {}) {
  const s = asScope(scopeOrRoot);
  const artifacts = {
    intent: findArtifact(s, 'intent.md'),
    spec:   findArtifact(s, 'spec.md'),
    plan:   findArtifact(s, 'plan.md'),
    review: findArtifact(s, 'REVIEW.md'),
    agents: findArtifact(s, 'AGENTS.md'),
    evals:  findArtifact(s, 'evals'),
    bands:  findArtifact(s, 'bands'),
  };

  // 手工 override 优先（scope 内 state.json 的 stage_override 字段）
  const state = readCodexState(s, 'state.json') || {};
  if (state.stage_override && STAGE_BY_ID[state.stage_override]) {
    return {
      stage: state.stage_override,
      substage: null,
      artifacts,
      missing: [],
      confidence: 'manual',
      source: 'state.override',
    };
  }

  const hasIntent = !!artifacts.intent;
  const hasSpec = !!artifacts.spec;
  const hasPlan = !!artifacts.plan;
  const hasDiff = gitHasUncommittedDiff(s);
  const branch = gitBranch(s);

  // Stage 6 MAINTAIN：main 分支 + 无未提交 diff + 上次部署记录存在
  if (state.last_deployed_at && (branch === 'main' || branch === 'master') && !hasDiff) {
    return {
      stage: 'maintain',
      substage: null,
      artifacts,
      missing: [],
      confidence: 'high',
      source: 'git.main+deployed',
    };
  }

  // Stage 5 DEPLOY：分支非 main + 有 diff + 测试已通过（state.test_pass）
  if (state.test_pass && hasDiff && branch && branch !== 'main' && branch !== 'master') {
    return {
      stage: 'deploy',
      substage: null,
      artifacts,
      missing: [],
      confidence: 'high',
      source: 'git.branch+test_pass',
    };
  }

  // Stage 4 TEST：plan 已存在 + 有 diff + 测试尚未通过
  if (hasPlan && hasDiff && !state.test_pass) {
    return {
      stage: 'test',
      substage: null,
      artifacts,
      missing: [],
      confidence: 'high',
      source: 'plan+diff+test_pending',
    };
  }

  // Stage 3b BUILD_IMPL：plan 已存在 + 用户已批准（state.plan_accepted）
  if (hasPlan && state.plan_accepted) {
    return {
      stage: 'build_impl',
      substage: 'implementation',
      artifacts,
      missing: [],
      confidence: 'high',
      source: 'plan+accepted',
    };
  }

  // Stage 3a BUILD_PLAN：spec 已存在，plan 不存在
  if (hasSpec && !hasPlan) {
    return {
      stage: 'build_plan',
      substage: 'plan_mode',
      artifacts,
      missing: ['plan.md'],
      confidence: 'high',
      source: 'spec+no-plan',
    };
  }

  // Stage 3a BUILD_PLAN（等待接受）：plan 已写、未被接受、尚无实施 diff。
  // v0.5.1 修复：此前该状态一路跌落到 planning——plan 模式代码门禁
  // （PreToolUse 规则 1 按 detection.stage 判定）在「plan 写完到工程师
  // 接受之间」静默失效，session-start 还会把 planning 写回 state 污染
  // 保存的阶段机。playbook 语义：plan.md 产出后必须显式 accept_plan。
  if (hasPlan && !state.plan_accepted && !hasDiff) {
    return {
      stage: 'build_plan',
      substage: 'awaiting_acceptance',
      artifacts,
      missing: [],
      confidence: 'high',
      source: 'plan+not-accepted',
    };
  }

  // Stage 1.5 PLANNING（awaiting_answers）：intent 已存在，但 Open questions 仍有未回答项。
  // v0.6.0 交互闭环：Open questions 是写给发起者的问题，必须先在对话中呈现并等待
  // 回答。未回答 = 仍处于 Stage 1——防止 PostToolUse 在用户未响应时推进到 design，
  // 也防止 detectStage 工件推断把 awaiting 状态误报为 design。
  if (hasIntent && !hasSpec) {
    const oq = parseOpenQuestions(artifacts.intent.path);
    if (oq.unresolved > 0) {
      return {
        stage: 'planning',
        substage: 'awaiting_answers',
        artifacts,
        missing: [],
        confidence: 'high',
        source: 'intent+open-questions',
        open_questions: oq,
      };
    }
    return {
      stage: 'design',
      substage: null,
      artifacts,
      missing: ['spec.md'],
      confidence: 'high',
      source: 'intent+no-spec',
    };
  }

  // Stage 1 PLANNING：默认（任何场景，包括无工件）
  return {
    stage: 'planning',
    substage: null,
    artifacts,
    missing: ['intent.md'],
    confidence: hasIntent ? 'medium' : 'high',
    source: hasIntent ? 'intent-exists-no-spec-fallback' : 'default',
  };
}

// ─────────────────────────────────────────────
// 阶段推进：标记当前阶段完成、进入下一阶段
// ─────────────────────────────────────────────

/**
 * 阶段推进：标记当前阶段完成、进入下一阶段（scope 感知）
 * v0.5.0 修复：推进成功后清除 stage_override。
 * 此前 override 一旦设置永不清除（advanceStage 不处理），阶段机粘死在
 * 用户手工钉住的阶段上，MCP set_stage 回退后无法恢复正常自动推进。
 */
export function advanceStage(scopeOrRoot, fromStage) {
  const s = asScope(scopeOrRoot);
  const stage = STAGE_BY_ID[fromStage];
  if (!stage) return { ok: false, error: `unknown stage: ${fromStage}` };

  // 产出检查
  const missing = [];
  for (const p of stage.produces) {
    if (p === 'diff' || p === 'tests' || p === 'test-pass' || p === 'eval-pass' || p === 'pr-merged' || p === 'incident→intent.md') continue;
    if (!artifactExists(s, p)) missing.push(p);
  }
  if (missing.length > 0) {
    return { ok: false, error: `missing artifacts: ${missing.join(', ')}` };
  }

  const next = stage.next;
  // v0.13.5 X-lock：锁内读-改-写——并发 PostToolUse 推进 / MCP advance
  //   不再用各自读到的旧快照互盖（丢 current_stage 推进）
  const written = mutateCodexState(s, 'state.json', (cur) => {
    const state = cur || {};
    // 推进前重验：并发进程已推进过（current_stage 已是 next）→ 幂等跳过，
    //   防止双重推进把 previous_stage 回写旧值
    if (state.current_stage === next) return null;
    state.previous_stage = fromStage;
    state.current_stage = next;
    state[`${fromStage}_completed_at`] = new Date().toISOString();
    // 进入下一阶段时清除该阶段的接受标志
    // v0.10.0：deploy 门禁真值为 release_approval（deploy_approved 为无置位方的死字段，
    // 与 MCP toolAdvance / sdlc.sh 语义对齐——三处推进实现曾各自重置不同字段）
    if (next === 'build_plan') state.plan_accepted = false;
    if (next === 'test') state.test_pass = false;
    if (next === 'deploy') state.release_approval = false;
    // v0.5.0：推进即解除手工 override（override 语义 = 钉住直到下一次推进）
    if (state.stage_override) {
      state.stage_override = null;
      state.stage_override_cleared_at = new Date().toISOString();
    }
    return state;
  });
  return { ok: true, next, locked: !!written };
}

// ─────────────────────────────────────────────
// 状态文件读写（scope 感知）
// ─────────────────────────────────────────────

export function writeState(scopeOrRoot, state) {
  return writeCodexState(scopeOrRoot, 'state.json', state);
}

export function getState(scopeOrRoot) {
  return readCodexState(scopeOrRoot, 'state.json') || initDefaultState();
}

export function initDefaultState() {
  // v0.10.0：委托 common.defaultState（单一事实源；此前本处副本缺 release_approval /
  // in_fix_mode / change_ticket 等字段，与 createTask/newCycle 的全量模板漂移）
  return defaultState();
}

// ─────────────────────────────────────────────
// 反模式触发规则（最小核心集，跨语言通用）
// ─────────────────────────────────────────────

export const ANTI_PATTERNS = [
  // 通用：禁止把生产凭证硬编码
  { id: 'hardcoded-secret', lang: '*', pattern: /(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][A-Za-z0-9+/=]{12,}["']/i, warn: '疑似硬编码凭证，必须改用环境变量或 secrets 管理' },
  // 通用：禁止 console.log / print 残留（生产代码）
  { id: 'debug-residue-js', lang: 'javascript', pattern: /console\.(log|debug)\s*\(/, warn: '生产代码禁止残留 console.log；改为正式 logger 或删除' },
  { id: 'debug-residue-ts', lang: 'typescript', pattern: /console\.(log|debug)\s*\(/, warn: '生产代码禁止残留 console.log；改为正式 logger 或删除' },
  { id: 'debug-residue-py', lang: 'python', pattern: /^\s*print\s*\(/m, warn: '生产 Python 代码避免裸 print；改用 logging' },
  // 安全：禁止禁用 SSL 验证
  { id: 'ssl-verify-off', lang: 'python', pattern: /verify\s*=\s*False/i, warn: '禁用 SSL 验证仅限本地调试，生产环境禁止' },
  { id: 'ssl-verify-off-js', lang: 'javascript', pattern: /rejectUnauthorized\s*:\s*false/i, warn: '禁用 SSL 验证仅限本地调试，生产环境禁止' },
  // 测试：禁止在修复任务中改测试文件
  { id: 'test-edit-during-fix', lang: '*', pattern: null, warn: '修复任务期间不应修改测试文件——若必须修改，先更新 plan.md 说明原因', trigger: 'file_path' },
];

export function detectAntiPatterns(text) {
  const hits = [];
  for (const ap of ANTI_PATTERNS) {
    if (!ap.pattern) continue;
    if (ap.pattern.test(text)) hits.push(ap);
  }
  return hits;
}
