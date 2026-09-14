---
description: 自顶向下设计与实现（先整体后局部，逐层下钻）
argument-hint: <系统/子系统描述>
---
# /design-topdown — 自顶向下设计与实现

## 输入

用户参数：$ARGUMENTS

- 系统 / 子系统描述（整体目标）
- 若参数为空：停止并询问

## 流程

1. **顶层设计**：职责划分 + 模块清单 + 依赖方向（单向）；
   产出 `docs/design/<slug>.md` 顶层章节
2. **顶层标记**：`//TODO#NNN <顶层模块> [agent:default]`，
   层间依赖用 `[depends:]` 显式表达（下层依赖上层完成）
3. **逐层下钻**：当前层实现（转 `/coding`）→ 为下一层创建更细粒度
   标记 → 下钻；每层完成即 advance 一次（resolve 该层标记）
4. **评审**：每层或整体转 `/review`（推荐整体评审一次）
5. **收口**：全层完成 → CHANGELOG + current-sprint 更新

## 标记绑定

- 层级树：顶层标记 depends 树是「实现顺序契约」；
  每层 resolve 由 advance 自动判定

## 产出物

- `docs/design/<slug>.md`（分层设计，必需）
- 各层源码 + 每层测试
- 依赖树可从 `.specflow/todo-state.json` 的 depends_on 还原

## 反模式（禁止）

- ❌ 下钻时改动上层已 accepted 的接口而不留 ADR
- ❌ 深层标记忘记标 depends（并行开工顺序失控）
- ❌ 一次下钻超过 2 层（每层要过 review 再继续）
- ❌ 底层实现与顶层文档脱节（改了要回写）
