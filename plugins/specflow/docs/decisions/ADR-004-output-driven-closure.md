---
title: 产出驱动闭环：产出声明导入与标记自动 resolved
type: adr
status: accepted
decided_at: 2026-09-02
deciders: [specflow]
---

# ADR-004: 产出驱动闭环

## 背景

v0.3.1 存在两条「机制存在、接线缺失」的断裂：产出声明的唯一来源是手工编辑状态
文件（实测恒为空数组，advance 永远放行）；resolved 是死状态（除继承旧值外从不
产生）。

## 决策

### D1. 产出声明的唯一来源是 config.md（Markdown 事实源）

- 声明形式：config.md 内 `codex:json` 块的 `<stage>.outputs` 键（如
  `"req-analysis.outputs": [{"path": "...", "required": true}]`），辅以
  frontmatter `output` 字段
- 导入时机：session-start 自动 + `workflow import-outputs` 手动重放；导入幂等
  （按 path 去重）
- 派生缓存 parsed-config.json 不是事实源

### D2. resolved 由 advance 自动判定，无手工路径

- `advance` 通过产出检查 → 该 agent 名下（`[agent:<id>]` 绑定，缺省 default）
  的 created 标记写入 todo-resolved.json（reason: `stage:<s>:outputs-verified`，
  含审计字段）→ todo-scanner 扫描合并判定 resolved
- ~~「测试通过」为占位条件~~——已被 ADR-006 D3 的真实测试执行器替换
- 手工 resolve 被刻意禁止：防止绕过产出检查造成「声明完成但产物缺失」

### D3. default agent 自动创建

`status` / `history` / `import-outputs` 遇缺失 default 自动创建（5 阶段标准流程）；
非 default 不自动创建（防 typo 静默建 agent）；init 完成即创建。

## 备选方案（放弃）

- marker 级产出声明（粒度过细，config 噪音大）
- 测试结果内嵌 todo-resolved.json（判定与数据耦合，无法幂等重判）
- 手工 resolve 命令（破坏闭环可信性）

## 后果

- 正面：产出检查从「恒空转」变为真实门禁；标记 3 态生命周期闭环；「声明 = 事实」
  原则落地
- 权衡：**未绑定 agent 的标记在 default advance 时全部 resolve**——并行 agent
  场景务必写 `[agent:]`（行为契约）
- 缓解：todo-resolved.json 保留 reason/at/resolved_by 审计字段，误判可回溯

## 关联

- 相关 ADR：ADR-006（D3 替换本 ADR D2 的占位条件）、ADR-009（自定义阶段沿用
  产出驱动模型）
