# SDLC Baseline — AI-Native 软件开发流程基线

> 本文件定义 ai-sdlc 插件遵循的基线规范，源自 Anthropic《AI-Native SDLC playbook》。
> 与具体语言、框架、组织无关。

## 六阶段闭环

```
Planning → Design → Build → Test → Deploy → Maintain → (回到 Planning)
```

每个阶段以一个工作区工件结束（`.sdlc/` 内，不进版本控制——工件是任务推进的中间产物，周期/任务结束归档即审计），下一阶段读取该工件开始。

## 工件契约

| 阶段 | 产物 | 接受者 | 触发下一阶段 |
|------|------|--------|--------------|
| 1 Planning | `intent.md` | 产品负责人（接受/关闭） | Stage 2: Design |
| 2 Design | `spec.md` | 产品负责人 + 策略所有者 | Stage 3a: Build (Plan) |
| 3a Build/Plan | `plan.md` | 工程师（显式 accept） | Stage 3b: Build (Impl) |
| 3b Build/Impl | diff + tests | 工程师 + 测试通过 | Stage 4: Test |
| 4 Test | test-pass + eval suite | CI 通过 | Stage 5: Deploy |
| 5 Deploy | PR merged to main | 代码所有者 + 发布管理员 | Stage 6: Maintain |
| 6 Maintain | 新 `intent.md`（闭环） | 服务所有者（分诊） | 回到 Stage 1 |

## 控制层次

| 层次 | 类型 | 强制性 | 例子 |
|------|------|--------|------|
| Skills | 建议性控制 | 编码时应用，不强制 | `secure-api-review` 在创建 API 时触发 |
| Hooks | 确定性控制 | 每次匹配动作都运行 | plan 模式禁改代码 / 修复期禁改测试 |
| Permissions | 配置层控制 | 静态允许/拒绝 | `permissions.deny: ["Read(.env*)"]` |
| Sandbox | 操作系统层控制 | 网络与文件系统隔离 | 域允许列表 + 凭证拒绝 |

**经验法则**：skills 使违规罕见，hooks 使其几乎不可能。

## 治理原则

1. **职责分离**：编写代码的代理没有批准它的途径。
2. **审计追踪**：工件链 = 审计追踪。每个工件都有作者、时间戳与完整修订历史（`.sdlc/` 工作区 + 周期归档 `cycle-meta.json`/`cycles.json`）。
3. **人工关卡**：人类对每个需要判断的决定负责。代理在产品门禁之前可以做所有事，之后不做任何事。
4. **配置即代码**：所有控制（skills / hooks / permissions / bands.yaml）都在版本控制中，像代码一样审查（阶段工件除外——它们是任务中间产物，不入版本控制）。

## 工件位置约定

```
<project-root>/
├── .sdlc/                     # 工作区（托管块忽略，不入版本控制）
│   ├── artifacts/
│   │   ├── intent.md          # 阶段工件（任务模式：tasks/<id>/）
│   │   ├── spec.md
│   │   ├── plan.md
│   │   └── REVIEW.md
│   ├── archive/               # 周期/任务归档（cycle-meta.json + 工件）
│   ├── state.json             # 运行时状态
│   ├── bands.yaml             # 闭环节奏配置（白名单例外，建议提交）
│   ├── hook-audit.json        # hook 审计日志
│   └── events.jsonl           # 事件流
├── AGENTS.md                  # 机构知识（Codex 约定，进 git；遗留项目可能是 CLAUDE.md）
├── evals/                     # 评估套件（进 git）
│   ├── <name>.json
│   └── check.sh
└── .github/workflows/
    └── agent-evals.yml        # CI 评估套件
```

> 存量项目根目录 / docs/ 的历史工件落位仍可被检测（候选表兼容）；
> 新工件一律写入工作区。

## 跨 CLI 与遗留系统共存

### 以仓库作为事实来源
- Markdown 工件是权威记录
- 遗留系统（Jira / ServiceNow / 需求工具）在提交中引用文件
- 适合工程主导的组织

### 以遗留系统作为事实来源
- Jira / ServiceNow 持有权威记录
- Markdown 工件是工作副本
- Codex 通过 MCP 连接器读写

### 以关联作为最低标准
- 所有工件都记录了记录 ID
- 所有遗留记录都包含 markdown 文件的提交 SHA
- 过渡期的良好起点

## 度量指标

### 领先指标
- 从首次对话到产出 `intent.md` 的时间（目标：小时级）
- `intent.md` 创建到 `spec.md` 创建的时间
- 从计划批准到合并 PR 的时间
- 首次 CI 成功率（针对代理编写的变更）
- 首次审核时间（目标：分钟级）
- 从安全漏洞发生到 triage 队列中的 `intent.md` 的时间

### 滞后指标
- `intent.md` 存活率（接受 vs 关闭）
- 构建开始后的需求返工
- 每个变更的返工周期
- 合并的 diff 仍然匹配 `plan.md` 的频率
- 每个 PR 的审查时间
- 在合并前捕获的缺陷 vs 逃逸到生产的数量
- 同类事件的重复发生（应随评估套件积累而减少）

## 反模式总览

- ❌ 跳过阶段（直接从想法到代码）
- ❌ 删除/改写已归档周期工件（销毁审计链）
- ❌ 新工件写入仓库根而非 `.sdlc/` 工作区（污染版本控制树）
- ❌ skills 写"应遵循"而不是"约束本节"
- ❌ 修复任务中修改测试文件
- ❌ 让 Codex 批准自己的 PR
- ❌ 生产部署不经发布管理员授权
- ❌ 监控无 bands.yaml（每个异常都变成事件）
- ❌ 修复后不加评估（同样问题复发）
