---
description: 管理 TODO/FIXME 标记（3 态生命周期 + depends 门控）
argument-hint: [list|<id>|<id> start|<id> close|add <desc>]
---
# /todo — 标记管理

## 输入

用户参数：$ARGUMENTS

- 子命令：`list` / `<id>` 详情 / `<id> start`（开工门控）/
  `<id> close`（删除注释归档）/ `add <描述>`
- 若参数为空：等价 `list`（按优先级 + ID 排序）

## 流程

1. **列表/详情**：读 `.specflow/todo-state.json`（状态源；展示用
   `sf.sh todo "$(pwd)" --format=md`）
2. **开工门控**（v0.4.0）：`<id> start` 必须先跑
   `sf.sh todo "$(pwd)" --check-start <id>`——depends 未全部
   resolved 时退出码 3 + 未完成依赖清单，此时先做依赖标记
3. **创建**：`add <desc>` 用 next_id 分配（勿手工编造）；
   元数据：`[agent:xxx]` `[priority:high|medium|low]`
   `[depends:TODO#N,...]` `#issue` `@owner`
4. **resolve 是自动的**：workflow advance 产出检查通过 → 该 agent 的
   created 标记登记 `.specflow/todo-resolved.json` → 下次扫描变 resolved。
   **没有手工 resolve 路径**（防止绕过产出检查）
5. **close**：删除代码中的标记注释 → 下次扫描自动 deleted 并保留归档记录

## 标记绑定

- 本命令是标记的创建/查询/关闭入口；resolve 归 workflow 闭环管
- 生命周期：created → resolved（自动）→ deleted（注释删除）；无 in_progress

## 产出物

- `.specflow/todo-state.json`（状态 + by_agent 分桶 + summary）
- `.specflow/todo.version`（ID 分配计数器）

## 反模式（禁止）

- ❌ 手工编辑 todo-state.json 把标记改成 resolved（闭环会被视为未验证）
- ❌ 同一 ID 出现在多个文件（single-file 约束，扫描会告警）
- ❌ 绕过 start 门控直接开工依赖未完成的标记
- ❌ 描述里塞实现细节（一句话说明，细节进需求/设计文档）
- ❌ 给已 deleted 的 ID 重新分配（todo.version 单调递增）
