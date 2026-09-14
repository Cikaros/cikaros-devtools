/**
 * index.js — sdlc-orchestrator MCP server 入口（CJS，零依赖）
 *
 * .mcp.json 内联 bootstrap 解析到插件根后拉起本文件。
 * v0.13.6 代码组织轮次：服务端上下文在 context.js，23 个工具实现与定义在
 * tools.js，本文件只做入口装配。v0.13.7 SessionEnd 超时对齐 Codex 3s 上限；
 * v0.13.8 macOS 通知交互重构；v0.13.9 Bash 门禁误报修复轮（服务端无改动）；
 * v0.13.10 全流程模拟排错轮（服务端：session_scope bind 缺参文案修正。其余
 * 修复在 hooks 侧——阶段检测 diff 过滤/并集门禁/守卫显示/悬空模板引用）；
 * v0.13.11 plan 接受通道轮（服务端：accept_plan 工具补 plan_accepted 事件
 * 留痕 via:mcp:accept_plan——与 CLI 回退通道 accept-plan.mjs 同事件名可审计；
 * 其余修复在 hooks 侧——引号感知词法/生命周期状态条/受控 CLI 豁免）；
 * v0.13.12 沙盒授权与受控环境轮（全部在 hooks 侧——PreToolUse 规则 0f
 * 网络端口预警/PostToolUse 沙盒拒绝证据与测试不计数/UserPromptSubmit 1f
 * 回合提醒/setup-playwright.mjs 受控安装入口；MCP 工具面无变更）；
 * v0.13.13 审批等待通知轮（全部在 hooks 侧——PreToolUse 规则 0f 同判定点
 * 另发 approval-wait 桌面通知把用户叫回终端选 y/esc，PostToolUse 在场窗口
 * 刷新 netport_last_exec_at；MCP 工具面无变更）。
 * 版本历史见插件 docs/changes/CHANGELOG.md。
 */

const { runMcpServer } = require('../lib/mcp-lite.js');
const { tools, callTool } = require('./tools.js');

runMcpServer({
  name: 'sdlc-orchestrator',
  version: '0.13.13',
  tools,
  callTool,
});
