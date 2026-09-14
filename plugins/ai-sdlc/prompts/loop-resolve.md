---
description: "修复循环中断的用户决策通道——loop_resolve：retry/new-intent/manual/escalate"
---

# loop-resolve — 修复循环中断决策（操作手册）

> **调用方式（v0.13.0）**：官方 CLI 不支持自定义 slash 命令——用户自然语言表达决策
> （见下方映射），agent 调 MCP 工具落地；或注册后用 `/prompts:sdlc-loop-resolve`
> 调用本手册（v0.13.2 起会话启动时自动注册/刷新，零操作；手动刷新/卸载：
> MCP `register_prompts` 或 sh/ps1 平台脚本）。

你正在处理 **ai-sdlc Fix Loop Guard** 的中断状态：插件检测到测试失败出现循环
（同一失败签名在最近窗口内重复出现，或本周期连续失败轮次超限），已阻断自动修复。

## 触发条件（自动，无需用户操作）

- 同一失败签名重复出现（A→A 相邻重复 / A→B→A 振荡，**含跨周期**——intent 迭代后同一问题再现同样命中）
- 本周期连续失败轮次达到上限（默认 3，可用环境变量 `SDLC_MAX_FIX_ROUNDS` 调整）

触发后插件会：阻断业务代码写入（PreToolUse）、每回合注入中断提醒、
Stop 时要求把循环证据呈报用户。

## 你的职责：呈报证据，等待决策

1. **汇总循环证据**（不要猜测，从状态与测试输出取证）：
   - `mcp__sdlc-orchestrator__status` 的 `test_gate` 段：失败历史（签名/周期/摘要）、连续轮次、最近退出码
   - 已尝试过哪些修复方向、各自的结果
2. **向用户呈报并结束回合**，等待用户从四个决策中选择
3. **决策落地后**按用户选择行动

## 四个决策的语义

| 决策 | 效果 | 适用场景 |
|------|------|----------|
| `retry` | 轮次计数重置，允许再修一轮；**同失败再现会立即再次中断** | 用户判断问题接近解决（有明确新思路） |
| `new-intent` | 归档当前周期（cycle+1），把失败作为 incident 写入新 intent.md | 失败暴露的是需求/设计缺口，需要下一个 intent 迭代 |
| `manual` | 用户接管手工修复；agent 转只读协助（分析/解释/建议） | 修复需要人类判断或环境操作 |
| `escalate` | 记录升级决策，汇总证据呈报更高层 | 问题超出当前会话能力范围 |

## 意图 → 工具映射（agent 侧）

| 用户说（示例） | 工具调用 |
|------|------|
| "再修一轮，我判断边界条件写反了" | `loop_resolve({decision:"retry", note:"用户判断边界条件写反了"})` |
| "这失败暴露的是数据模型缺口" / "换个思路重开" | `loop_resolve({decision:"new-intent", note:"失败暴露的是数据模型缺口"})` |
| "我自己来修，你只负责分析" | `loop_resolve({decision:"manual"})` |
| "升级给服务所有者处理" | `loop_resolve({decision:"escalate", note:"需要服务所有者介入"})` |

工具：`mcp__sdlc-orchestrator__loop_resolve`（参数 decision / note）。

## 治理

- 决策与循环证据全部留痕：`state.fix_loop_resolutions` / `hook-audit.json` / 事件流 `fix_loop_detected` / `fix_loop_resolved`
- 测试**真实通过**会自动解除中断——但不得为解除而跳过/删除/弱化失败测试（反模式）
- 权威标准：插件 `docs/lifecycle.md`「测试门禁与修复循环中断」章节
