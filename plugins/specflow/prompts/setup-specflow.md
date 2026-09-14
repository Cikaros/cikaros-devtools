---
description: 初始化/接管当前项目的 specflow 工程化环境
argument-hint: [--refresh|（空）]
---
# /setup-specflow — 项目初始化

## 输入

用户参数：$ARGUMENTS

- 空参数：交互式初始化（项目名 + 作者两问，其余自动探测）
- `--refresh`：只刷新项目快照与 TODO 清单（不动模板 / git hooks）

## 流程

1. **初始化**（等价 `sf.sh init`）：
   - 环境探测（env-scanner：OS/shell/语言栈/包管理器）
   - 渲染 9 个模板：AGENTS.md / config.md（含产出声明 codex:json 块）/
     .gitignore / README / REQUIREMENTS / ADR 索引 / CHANGELOG /
     `context/current-sprint.md` + `context/team-roster.yaml`
   - 已有项目（检出依赖清单或 src/ 等）→ 自动执行项目扫描：
     目录 / 依赖 / 现有文档 / git 历史 / 标记 →
     `.specflow/project-snapshot.json` + `.specflow/todo-list.md`
   - 创建 default workflow agent（5 阶段）
   - git init（按需）+ 安装 git hooks（提示性行为，见反模式）
   - 幂等：已存在文件跳过，`--force` 备份后覆盖
2. **--refresh**：重跑环境扫描 + 快照 + TODO 清单，适合依赖变更 /
   大量新标记后校准
3. **验证**：输出 `sf.sh doctor` / `scan` / `todo` 验证指引

## 标记绑定

- 接管已有项目时**不自动**为存量代码创建标记（由 /todo add 或主线
  命令按需创建，避免标记洪水）
- `.specflow/todo-list.md` 只做快照登记，非状态源

## 产出物

- 项目骨架 9 文件 + 目录树（docs/、context/、.specflow/）
- `.specflow/project-snapshot.json` + `.specflow/todo-list.md`（已有项目）
- `.specflow/.initialized` 标记（幂等判据）

## 反模式（禁止）

- ❌ 期待 init 的 5 项扫描做深度静态分析（v0.4.0 是「最小版」：
  目录/依赖/文档/git/标记清单；代码语义分析在 v0.5.0+ 路线）
- ❌ 把 git hooks 当质量门禁（当前 pre-commit 只输出标记摘要，
  lint+test+sanitize 实装在 v0.5.0+）
- ❌ 在共享仓库根初始化到别人项目（先确认目录归属）
- ❌ --refresh 之后不重跑 todo 扫描就断言标记状态
