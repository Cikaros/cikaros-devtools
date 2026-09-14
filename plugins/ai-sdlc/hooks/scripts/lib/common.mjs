/**
 * common.mjs — ai-sdlc hook 公共库（桶导出 / 唯一公共入口）
 *
 * v0.13.6 代码组织轮次：本文件从 1865 行单体重构为领域模块的桶（barrel）——
 * hooks / MCP ESM 桥 / 测试全部经本文件导入，导入面自 v0.5.0 起保持不变。
 * 新增能力请放入对应领域模块并经本桶导出；不要在本文件写实现。
 *
 * 模块地图（依赖自上而下分层，无环）：
 *   L0  paths.mjs    插件/项目路径、作用域构造、ARTIFACT_CANDIDATES
 *   L0  util.mjs     stdin/JSON（BOM 安全）、hook 输出、文件小工具、id 归一化
 *   L1  atomic.mjs   原子写底座 + 跨进程锁（mutateJsonFile）
 *   L2  state.mjs    状态机 schema + scope 感知状态 IO（read/write/mutate）
 *   L2  audit.mjs    审计（hook-audit.json）+ 事件总线（events.jsonl 滚动）
 *   L3  bootstrap.mjs     首次使用自动初始化（state 落盘 + ignore 托管块）
 *   L3  quicktasks.mjs    临时任务队列（输入分流）
 *   L3  prompts.mjs       /prompts: 手册注册（跨平台单一事实源）
 *   L3  mcplink.mjs       MCP 会话票据 + 启动器指针
 *   L3  cycles.mjs        周期归档 + 新周期 + 会话快照
 *   L4  testgate.mjs      测试门禁 + 修复循环（依赖 cycles）
 *   L4  tasks.mjs         任务索引 + 会话亲和 + 作用域路由（依赖 cycles）
 *   既有同目录模块（未参与本轮拆分）：
 *   env.mjs         运行环境画像 + 跨平台脚本护栏（v0.13.2）
 *   stage-detector.mjs  阶段检测状态机
 *   notify.mjs/.ps1 回合结束通知
 *
 * 与 specflow 同构约定：
 *   - PLUGIN_ROOT 优先 process.env.PLUGIN_ROOT（Codex 注入），否则脚本位置自定位
 *     （lib/ 上溯 3 级 = 插件根）；PROJECT_ROOT 优先 stdin.cwd
 *   - 项目级目录统一 .sdlc/；输出契约：command hook stdout 输出单个 JSON 对象
 *
 * 版本历史与设计决策见插件 docs/changes/CHANGELOG.md 与 docs/architecture.md。
 */

// L0 路径与作用域
export {
  PLUGIN_ROOT, ARTIFACT_CANDIDATES,
  sdlcDir, asScope, taskDirOf, runtimePath, configPath,
} from './paths.mjs';

// L0 通用工具
export {
  readStdin, parseInput, safeJsonParse, readTextBomSafe, projectRootOf,
  emitHookOutput, emitEmpty,
  fileExists, fileMtime, readFileText, headLines,
  estimateTokens,
  slugify, stamp, safeSessionId, sessionMapKey,
} from './util.mjs';

// L1 原子写 + 跨进程锁
export {
  writeJsonExclusive, atomicWriteFileExclusive, tryAuditLock, mutateJsonFile,
} from './atomic.mjs';

// L2 状态机与状态 IO
export {
  defaultState, isEngaged,
  readCodexState, writeCodexState, readGlobalJson, writeGlobalJson,
  mutateCodexState, mutateTaskIndex,
  readHooksStateForSession,
} from './state.mjs';

// L2 审计 + 事件总线
export { appendAudit, appendEvent, appendGlobalAudit } from './audit.mjs';

// L3 首次使用自动初始化
export { ensureProjectBootstrap } from './bootstrap.mjs';

// L3 临时任务队列（输入分流）
export {
  readQuickTasks, writeQuickTasks, addQuickTask, updateQuickTask,
  listQuickTasks, queuedQuickTasks,
} from './quicktasks.mjs';

// L3 /prompts: 手册注册
export {
  defaultPromptsDir, listPromptManuals, promptsRegisterStatus,
  registerPromptManuals, removePromptManuals, ensurePromptsRegistered,
} from './prompts.mjs';

// L3 MCP 会话票据 + 启动器指针
export {
  writeMcpBindTicket, claimMcpBindTicket, writeMcpLauncherPointer,
} from './mcplink.mjs';

// L3 周期归档 + 会话快照
export {
  archiveCycleArtifacts, newCycle, saveSessionSnapshot, listCycles,
} from './cycles.mjs';

// L4 测试门禁 + 修复循环
export {
  parseOpenQuestions, maxFixRounds, isTestCommand,
  extractTestFailureSignature, detectFixLoop, FIX_LOOP_DECISIONS, resolveFixLoop,
} from './testgate.mjs';

// L4 任务索引 + 会话亲和 + 作用域路由
export {
  readTaskIndex, writeTaskIndex, listTasks, createTask, getTask,
  switchTask, closeTask,
  readSessionMap, bindSession, unbindSession,
  scopeForTask, resolveScope,
} from './tasks.mjs';
