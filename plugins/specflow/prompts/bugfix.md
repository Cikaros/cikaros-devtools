---
description: 修 Bug（定位→修复→回归测试→归档）
argument-hint: <bug 描述或复现步骤>
---
# /bugfix — 修 Bug

## 输入

用户参数：$ARGUMENTS

- Bug 描述 / 复现步骤 / 报错信息（本地来源即可，不从 GitHub 拉 issue）
- 若参数为空：从 `.specflow/todo-state.json` 取最高优先级 FIXME 标记

## 流程

1. **复现**：先跑通最小复现（命令/用例）；无法复现 → 登记FIXME并
   标注「待复现」，不要盲修
2. **定位根因**：沿报错栈定位；区分「症状修复」与「根因修复」，
   只做根因修复（症状补丁要在报告中说明为何可接受）
3. **登记标记**：`//FIXME#NNN <根因一句话> [agent:default] [priority:high]`
4. **修复**：最小改动面修复；关联的回归测试与修复同批落盘
5. **回归**：跑受影响范围测试 + 新增回归用例（覆盖原失败路径）
6. **归档**：`docs/changes/bugfix-<slug>-<date>.md`（根因/修复/影响面/
   回归证据）；FIXME 由 advance 闭环 resolve

## 标记绑定

- 修复用 FIXME（区别于 TODO 的功能语义）；`[depends:]` 用于
  多处同根因的批量修复（先修源头标记，其余 depends 它）

## 产出物

- 修复代码 + 回归测试（同批）
- `docs/changes/bugfix-<slug>-<date>.md`（必需——重现与根因证据）

## 反模式（禁止）

- ❌ 未复现就改代码（改完连「是否修好」都无法回答）
- ❌ try/catch 吞异常式「修复」
- ❌ 顺手重构无关代码（混杂改动毁掉评审与回滚能力）
- ❌ 修复无回归用例（下次必复发）
- ❌ 改配置/环境变量绕过 bug 而不解释根因
