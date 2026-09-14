# {{project.name}} — Codex 项目指令

> 项目级 AGENTS.md，与插件级 ~/.codex/AGENTS.md 叠加生效。

## 1. 项目信息
- 项目名：{{project.name}}
- 作者：{{env.USERNAME}} <{{env.USEREMAIL}}>
- 主语言：{{lang.primary}}
- 当前分支：{{git.branch}}
- 项目根：{{project.root}}
- 初始化时间：{{now}}

## 2. 工作流
按 5 阶段推进：需求分析 → 架构设计 → 编码实现 → 代码评审 → 测试验证
- /workflow status — 查看进度
- /workflow advance — 推进下一阶段

## 3. 项目规则
- 命名规范：遵循 {{lang.primary}} 社区习惯
- 提交规范：Conventional Commits
- 测试覆盖率：≥ 80%
- 复杂度门槛：≤ 15

## 4. 项目结构
src/         源码
tests/       测试
docs/        文档
.specflow/      运行时状态（不进 git）
.specflow/  项目配置（覆盖全局）

## 5. 反模式（禁止）
- ❌ 把插件文件复制到项目目录
- ❌ 跳过 /setup-specflow 直接手建目录
- ❌ 在 .specflow/ 里手动写状态文件
