---
description: 测试验证主线命令（testing 阶段）
argument-hint: <测试范围：模块/路径/全部>
---
# /testing — 测试验证（主线 5/5）

## 输入

用户参数：$ARGUMENTS

- 测试范围：模块名 / 路径 / `all`（全量）
- 若参数为空：从 `.specflow/todo-state.json` 取当前 agent 全部 created 标记，
  逐个验证其对应改动的测试覆盖

## 流程

1. **确定基线**：读 `.specflow/config.md`（parsed 视图
   `.specflow/parsed-config.json`）拿覆盖率门槛（行/分支）与 E2E 开关
2. **跑既有测试**：按项目框架执行（vitest/jest/pytest/go test…），
   记录通过率与覆盖率；框架不可识别时明确说明，不编造结果
3. **补缺口**：为无覆盖的标记相关代码补测试（单测走 /unit-test，
   集成走 /integration-test）
4. **写测试报告**：结果 + 覆盖率 + 失败清单写入产出
5. **推进**：`sf.sh workflow advance --agent default`——testing 阶段
   产出（默认建议级）缺失会告警；报告缺失可在 config.md 升为 required

## 标记绑定

- 测试发现的新缺陷：创建 `//FIXME#NNN <缺陷描述> [agent:default]
  [priority:high]`（FIXME 专用于缺陷）
- 测试补齐的标记：由 advance 自动 resolve
- 本命令不手工 resolve 任何标记

## 产出物

- `docs/changes/test-report-<date>.md`（测试报告，建议级）
- 新增测试文件（`tests/` 或与被测文件同目录）
- 覆盖率报告（框架产物，如 coverage/）

## 反模式（禁止）

- ❌ 编造/猜测测试结果（跑不了就明说跑不了）
- ❌ 为凑覆盖率写无断言的「空测试」
- ❌ mock 被测对象本身（只 mock 边界：网络/时钟/随机）
- ❌ 测试之间共享可变状态（顺序依赖）
- ❌ 把 flaky 测试标记 skip 而不登记 FIXME
- ❌ 覆盖率达标但核心分支（错误处理）全空
