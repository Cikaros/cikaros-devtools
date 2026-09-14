---
description: 编码实现主线命令（coding 阶段）
argument-hint: <模块/标记引用 或 ADR 引用>
---
# /coding — 编码实现（主线 3/5）

## 输入

用户参数：$ARGUMENTS

- 待实现模块名 / TODO 标记 ID / ADR 引用（如 `ADR-007`
  或 `TODO#012`）
- 若参数为空：取 `.specflow/todo-state.json` 中当前 agent 的最高优先级
  created 标记

## 流程

1. **开工门控**：处理带 depends 的标记前先运行
   `sf.sh todo "$(pwd)" --check-start <ID>`——依赖未 resolve 会被拒绝
   （退出码 3 + 未完成依赖清单），此时先做依赖标记
2. **读规范**：`.specflow/loaded-sections.json` 确认语言规范已注入
   （TypeScript/Python 有专属模板，其余回退 spec/coding-standards.md）；
   按 `rules/stage-coding.md` 与 `spec/security-baseline.md` 执行
3. **实现**：小步提交粒度实现；每个 TODO 标记对应的代码写到即写，
   标记注释留在实现处（后续 resolved 判定依赖它可被扫描到）
4. **自检**：跑项目测试 / lint；无法运行时说明原因并标注风险
5. **推进**：`sf.sh workflow advance --agent default`——coding 阶段
   required 产出（默认 `src/`，建议级）缺失不阻塞，但会告警

## 标记绑定

- 实现前：标记已由 /req-analysis 或 /arch-design 创建；本命令**不新增**
  实现级标记（发现新问题点时创建补充标记）
- 实现完成后：**不手工 resolve**——advance 通过产出检查后自动登记
  resolved（`.specflow/todo-resolved.json`）
- 废弃的实现点：删除代码注释 → 下次扫描自动 deleted

## 产出物

- 源码变更（默认 `src/`，建议级产出）
- 测试代码（与被测文件同目录，单测命令见 /unit-test）
- `docs/changes/` 变更记录（建议，复用 CHANGELOG 模板）

## 反模式（禁止）

- ❌ 跳过 depends 门控硬开工（门控存在就是要用）
- ❌ 手工把标记改成 resolved（破坏自动判定闭环）
- ❌ 一次性改动 > 5 个文件且无说明
- ❌ 提交不可运行 / 未过自检的代码并声称完成
- ❌ 违背 ADR 的实现（发现 ADR 有误先提新 ADR，不静默偏离）
- ❌ 把密钥/凭证写进代码或测试夹具（见 security.md）
