---
description: 单元测试生成与补齐（happy + edge + failure）
argument-hint: <path> [--coverage=<n>]
---
# /unit-test — 单元测试

## 输入

用户参数：$ARGUMENTS

- 目标路径（文件或目录）；`--coverage=<n>` 指定门槛（默认读
  config.md `testing.line_coverage`，缺省 80）
- 若参数为空：取最近一次改动涉及的文件（git diff --name-only）

## 流程

1. **覆盖缺口扫描**：跑框架覆盖率（vitest --coverage / pytest --cov /
   go test -cover 等）；框架不可识别时明确说明，不伪造数据
2. **登记标记**：每个未覆盖文件/关键分支创建
   `//TODO#NNN test: <文件/分支> [agent:default] [priority:medium]`
3. **生成用例**：每目标三类——happy（主路径）/ edge（边界与空值）/
   failure（错误路径与异常传播）；遵循 `rules/stage-testing.md` 与
   语言 spec.md 的测试章节
4. **执行**：跑测试 + 覆盖率；达标 → advance 自动 resolve 测试标记；
   不达标 → 缺口部分继续补
5. **报告**：`docs/changes/test-report-<date>.md` 追加单测结果

## 标记绑定

- `test:` 前缀标记 + depends 指向被测实现标记（实现未 resolve 时
  测试标记不应开工）

## 产出物

- 测试文件（与被测文件同目录或 tests/ 镜像结构）
- 覆盖率报告（框架产物）
- `.specflow/loaded-sections.json` stage 层记录（自动）

## 反模式（禁止）

- ❌ mock 被测对象内部（只 mock 边界：网络/时钟/随机/文件系统）
- ❌ 用实现细节断言（测行为不测内部调用次数）
- ❌ 空断言凑覆盖率（CI 覆盖率≠质量）
- ❌ 测试依赖执行顺序或共享可变状态
- ❌ flaky 用例不登记 FIXME 就 skip
