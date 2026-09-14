/**
 * server-state.js — sdlc-orchestrator 进程级可变上下文（CJS）
 *
 * v0.13.6 代码组织轮次引入：context.js 与 tools.js 共享的可变模块级状态
 * 收敛为单一容器对象（属性赋值 = 原变量重新赋值，语义不变）。
 * 只放状态，不放行为；初始化与变更逻辑在 context.js（routeScope / 桥初始化）
 * 与 tools.js（session_scope bind/unbind）。
 */

module.exports = {
  /** ESM 生命周期桥命名空间（context.js 桥初始化写入；requireLifecycle 守卫读取） */
  lifecycle: null,

  /** 工件候选路径（桥接成功后被 common.mjs 单源替换；本副本仅桥接失败的兜底） */
  ARTIFACT_CANDIDATES: {
    'intent.md': ['intent.md', 'docs/intent.md', 'intent/current.md', '.sdlc/artifacts/intent.md'],
    'spec.md':   ['spec.md', 'docs/spec.md', 'docs/specs/current.md', '.sdlc/artifacts/spec.md'],
    'plan.md':   ['plan.md', 'docs/plan.md', 'docs/plans/current.md', '.sdlc/artifacts/plan.md'],
    'REVIEW.md': ['REVIEW.md', 'docs/REVIEW.md', '.sdlc/artifacts/REVIEW.md'],
    'AGENTS.md': ['AGENTS.md', 'CLAUDE.md'],
  },

  /** 会话 pin：null=未尝试认领；false=认领过但无票；object=已 pin（routeScope / session_scope 写） */
  pinnedSession: null,

  /** 本次工具调用的作用域（routeScope 每次调用前写入） */
  currentScope: null,

  /** 路由诊断（供 status / session_scope 报告） */
  scopeBindingInfo: { mode: 'unbound' },
};
