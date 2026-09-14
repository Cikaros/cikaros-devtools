---
title: 原生 hooks.json 作为唯一事实源
type: adr
status: active
decided_at: 2026-09-02
deciders: [specflow]
---

# ADR-003: 放弃 config.toml 伪 hooks 表，改用 Codex 原生 hooks.json

## 背景

v0.2.x 建立在错误假设上：以为 `config.toml` 支持 `[hooks.*]` TOML 表声明触发点、
`executor = "mcp"` 指到 MCP 工具。经与官方文档核对，该机制**从未存在**——
config.toml 不解析这些表（静默忽略），真实机制是 hooks.json（事件
SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop / SessionEnd 等，
handler 类型 command | mcp_tool，支持 matcher / timeout / async /
additionalContextLimit）。自造的 `hooks/manifest.md` 同样不被 Codex 读取。
由此产生「无法全局安装」与「看不到 hooks.json」两个用户症状。

## 决策

1. **hooks.json 是唯一可执行事实源**：6 个事件全部挂 `command` 型 handler
   （零依赖 Node 脚本 `hooks/scripts/*.mjs`）；manifest.md 降级为纯文档
   （现已归档，非事实源）
2. **插件化**：`.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json`
   使 `codex plugin marketplace add` 成为一等路径。**只发布
   `.codex-plugin/plugin.json`**，不在根目录再放一份 plugin.json（并存会触发
   hooks 被静默禁用的已知 bug）
3. **插件 hooks 需信任**：安装指引必须包含会话内 `/hooks` 审查信任，否则 hooks
   被静默跳过（Codex 安全设计）
4. **MCP 去构建化**：4 个 MCP server 从 TS + npm build 改零依赖纯 JS
   （`mcp/lib/mcp-lite.js` 手写 JSON-RPC）
5. ~~classic 兜底（老版本 Codex 由 install.sh --classic 生成 ~/.codex/hooks.json）~~
   ——已于 v1.2.2（仓库 v1.3.0）随 marketplace-only 重构移除

## 后果

- 正向：全局安装与 hooks 真实执行两个原始问题直接解决；安装不要求联网、
  不覆盖用户配置
- 风险：依赖 Codex ≥ 0.142 的事件名与字段格式（已集中在单文件，改名改动面小）

## 增补（v0.3.1 审计）

classic 时代的共享目录所有权（非破坏复制 + manifest 精确卸载）、模板泄漏排除、
git hooks「sf.sh 缺失即放行」守卫、`.codexignore` 取反白名单三处生效、
mcp-lite protocolVersion 回显语义——均已在当轮修复（详见 CHANGELOG v0.3.1）。

## 关联

- 下游实现：`hooks/hooks.json`、`hooks/scripts/*.mjs`、`mcp/lib/mcp-lite.js`、
  `.codex-plugin/plugin.json`
- 相关 ADR：ADR-002（Markdown 即配置——hooks.json 为其例外：可执行配置用
  Codex 原生 JSON）、ADR-005（安装流）
