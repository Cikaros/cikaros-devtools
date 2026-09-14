---
title: 编码规范基线
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-01T18:00:00+08:00
author: specflow
status: active
refs:
  - docs/requirements/REQUIREMENTS.md
  - docs/requirements/PARSER.md
---

# 编码规范基线（spec/coding-standards.md）

> **本文档是语言无关的通用编码规范，属于 `semantic: spec` 层，整个会话期间始终加载。**
>
> 各语言的细节规范在 `templates/coding/<lang>/spec.md` 中按需加载——session-start
> 会按 env-scan 检出的主语言注入对应摘要（v0.4.0 起 TypeScript 与 Python 模板已落地，
> 其余语言暂回退本基线，登记于 `.specflow/loaded-sections.json`）。语言无关的安全
> 补充见 `templates/coding/security.md`。
>
> 本规范不可变——变更需走 ADR 流程。

---

## 1. 命名规范

### 1.1 通用原则

- **名副其实**：名字应能说明"做什么"而非"怎么做"。`getUserById` > `processUser`。
- **避免缩写**：除行业通用缩写（`URL` / `HTTP` / `JSON` / `API` / `ID`），不使用个人缩写。`fetchUsr` → `fetchUser`。
- **不混用风格**：同一项目内一种命名风格贯彻到底，不混用 camelCase 与 snake_case。

### 1.2 按语言社区习惯

| 语言 | 变量 / 函数 | 类 / 接口 / 类型 | 常量 | 文件名 | 包名 |
|------|------------|-----------------|------|--------|------|
| TypeScript / JavaScript | camelCase | PascalCase | UPPER_SNAKE_CASE | kebab-case | kebab-case |
| Python | snake_case | PascalCase | UPPER_SNAKE_CASE | snake_case | snake_case |
| Go | camelCase（导出 PascalCase） | PascalCase | PascalCase（不缩写） | snake_case | lowercasenosep |
| Java | camelCase | PascalCase | UPPER_SNAKE_CASE | PascalCase | lowercasenosep |
| Rust | snake_case | PascalCase | UPPER_SNAKE_CASE | snake_case | snake_case |
| Kotlin | camelCase | PascalCase | UPPER_SNAKE_CASE | PascalCase | lowercasenosep |

### 1.3 布尔变量

- 用 `is` / `has` / `can` / `should` 前缀：`isValid` / `hasPermission` / `canRead` / `shouldRetry`。
- 避免 `not` 前缀：用 `isEmpty` 而非 `isNotEmpty`（让调用方写 `if (!isEmpty)` 更自然）。

### 1.4 集合变量

- 用复数形式：`users` 而非 `userList`（除非强调类型）。
- Map 用 `keyToValue` 形式：`userIdToName` 而非 `userMap`。

---

## 2. 注释规范

### 2.1 注释三原则

1. **代码自解释优先**：好的命名 + 简短函数体 > 长篇注释。注释是"代码无法表达时"的补充。
2. **解释 Why，不解释 What**：代码已经说了 What（`fetchUser`）；注释要说 Why（"// 用 Redis 缓存避免数据库压力，TTL 5 分钟平衡新鲜度与性能"）。
3. **及时更新**：过时注释比没注释更糟——修改代码时同步修改注释，删除无关注释。

### 2.2 必须注释的场景

- **公共 API**：函数 / 类 / 模块的对外契约（入参 / 出参 / 异常 / 副作用）
- **复杂算法**：非直观的算法步骤（如快排的 partition 选择策略）
- **业务规则**：与具体业务相关的硬编码值（如"// 退款金额上限 10000 元，依据财务政策 BR-2024-08"）
- **TODO / FIXME**：未完成的代码用 `// TODO#NNN(@user): 描述` 标记，从 `.specflow/todo.version` 分配 ID
- **临时绕过**：用 `// FIXME#NNN(@user): 临时绕过 X，待 Y 修复后移除` 标记

### 2.3 文档注释

各语言用原生文档注释工具：

| 语言 | 工具 | 示例 |
|------|------|------|
| TypeScript | JSDoc / TSDoc | `/** ... */` |
| Python | docstring（Google / NumPy 风格二选一） | `""" ... """` |
| Go | godoc | `// FuncName ...` 紧贴函数 |
| Java | Javadoc | `/** ... */` |
| Rust | rustdoc | `/// ...` |

公共 API 必须有文档注释；内部辅助函数可选。

### 2.4 禁止的注释

- ❌ "What" 注释：`// 加载用户` 在 `loadUser` 函数上方
- ❌ 历史注释：`// 旧代码：xxx // 新代码：xxx`（用 git 历史看）
- ❌ 注释掉的代码块：删除，用 git 历史查
- ❌ 个人标记：`// 张三 2024-09-01 加`（用 git blame 看）
- ❌ 区域分隔符：`// ===== 业务逻辑 =====`（用函数拆分代替）

---

## 3. 错误处理

### 3.1 不吞错

- **禁止 `catch` 后什么都不做**：`try { ... } catch (e) {}` 是反模式。
- **必须至少记录日志**：`logger.error("加载用户失败", { userId, error: e })`。
- **必须传递上下文**：错误日志含输入参数、当前状态，便于复现。

### 3.2 错误分类

| 类型 | 处理方式 | 示例 |
|------|---------|------|
| 输入校验错误 | 返回 4xx，附详细字段错误 | `{ code: "INVALID_INPUT", field: "email", msg: "格式错误" }` |
| 业务规则错误 | 返回 4xx，附业务错误码 | `{ code: "REFUND_EXCEED_LIMIT", limit: 10000 }` |
| 资源不存在 | 返回 404 | `{ code: "USER_NOT_FOUND" }` |
| 权限不足 | 返回 403 | `{ code: "FORBIDDEN" }` |
| 内部异常 | 返回 500，记完整堆栈日志 | `{ code: "INTERNAL_ERROR", trace_id: "xxx" }` |
| 第三方调用失败 | 重试 + 降级 + 告警 | 详见 §3.4 |

### 3.3 错误上下文

- 抛错时附"用户可读消息"+"机器可读 code"+"trace_id"三要素。
- 中间层 catch 后包装为本层语义错误再抛：`throw new AuthError("登录失败", { cause: e, userId })`。
- 不在底层抛"数据库连接失败"到顶层——顶层只看"登录失败"。

### 3.4 第三方调用失败

- **重试**：默认 3 次指数退避（1s / 2s / 4s），最多 3 次。
- **降级**：重试失败后用缓存值 / 默认值，但必须显式声明"数据可能过期"。
- **告警**：连续失败超过阈值（如 5 分钟内 10 次）触发告警。
- **超时**：所有第三方调用必须设超时，默认 30s，可按业务调整。

### 3.5 错误日志

- ERROR 级别记完整堆栈（用 `logger.error(e.stack || e)`）。
- WARN 级别记可恢复异常（如重试成功的失败）。
- INFO 级别记业务流程关键节点（如"用户 X 触发退款 Y 元"）。
- DEBUG 级别记详细参数（仅开发环境开启）。

---

## 4. 日志规范

### 4.1 统一 logger

- 用项目统一的 logger，不直接用 `console.log` / `print` / `fmt.Println`。
- logger 支持：级别（DEBUG / INFO / WARN / ERROR）、结构化字段、trace_id 贯穿。

### 4.2 不打印 PII

- **禁止打印**：密码 / 密钥 / 令牌 / 身份证号 / 手机号 / 银行卡号 / 邮箱（除非脱敏后）。
- **必脱敏**：用户 ID 在日志中替换为 hash 或部分掩码（如 `user:abc****xyz`）。
- **脱敏由 privacy-guard 自动处理**（HOOKS.md §2.2.5），但代码层应避免主动打印敏感字段。

### 4.3 日志格式

统一 JSON 格式（生产环境）+ 文本格式（开发环境）：

```json
{
  "ts": "2026-09-01T16:00:00+08:00",
  "level": "INFO",
  "msg": "用户登录成功",
  "trace_id": "abc123",
  "user_id_hash": "abc****xyz",
  "ip": "1.2.3.4",
  "duration_ms": 142
}
```

### 4.4 日志级别选择

| 级别 | 何时用 | 示例 |
|------|-------|------|
| DEBUG | 详细参数 / 内部状态 | "查询参数：userId=123, include=posts" |
| INFO | 业务关键流程节点 | "订单 #456 已支付" |
| WARN | 可恢复异常 / 非预期但可处理 | "Redis 连接失败，降级到内存缓存" |
| ERROR | 不可恢复异常 / 需人工介入 | "数据库写入失败" |

---

## 5. 目录结构

### 5.1 按职责分层

```
src/
├── api/                  # HTTP 路由与请求处理
│   ├── handlers/         # 各资源的 handler
│   └── middleware/       # 中间件（鉴权 / 日志 / 限流）
├── service/              # 业务逻辑
│   ├── user/             # 按业务领域分包
│   └── order/
├── repository/           # 数据访问层
│   ├── user/
│   └── order/
├── domain/               # 领域模型与业务规则
│   ├── user/
│   └── order/
├── infra/                # 基础设施（DB / 缓存 / 消息队列）
├── utils/                # 通用工具（无业务语义）
└── config/               # 配置加载
```

### 5.2 目录约定

- `src/` 下不直接放业务文件——按业务领域分包。
- `tests/` 镜像 `src/` 结构：`tests/api/handlers/user.test.ts` 对应 `src/api/handlers/user.ts`。
- `docs/` 用 C4 四层（context / container / component / code，详见 REQUIREMENTS.md §4.3）。
- 不创建 `helpers/` / `common/` / `misc/` 等语义模糊的目录——按具体职责命名。

### 5.3 文件大小

- 单文件 < 300 行（超过应拆分）。
- 单函数 < 50 行（超过应抽取子函数）。
- 单类 < 500 行（超过应拆分职责）。
- 单 package / module < 20 个文件（超过应拆分）。

---

## 6. 安全基线

### 6.1 SQL 注入防护

- **必须参数化查询**：用 prepared statement / ORM，禁止字符串拼接 SQL。
- **白名单校验动态字段名**：如表名 / 字段名不能直接拼接，必须从白名单查。

### 6.2 XSS 防护

- **输出编码**：渲染 HTML 时按上下文编码（HTML / attribute / JS / URL）。
- **CSP 头**：默认 `default-src 'self'`，按需放开。
- **禁止 `v-html` / `dangerouslySetInnerHTML`**：除非内容已 sanitize。

### 6.3 密钥管理

- **禁止硬编码**：密钥不进代码、不进注释、不进 git。
- **从环境变量 / 密钥管理服务读**：`process.env.API_KEY` / Vault / AWS Secrets Manager。
- **`.env` 不进 git**：`.gitignore` 必须含 `.env`。
- **密钥轮换**：定期轮换，旧密钥失效后清理。

### 6.4 鉴权与授权

- **每个敏感接口必须鉴权**：默认拒绝，显式放开。
- **最小权限原则**：用户 / 服务账号仅授予完成任务所需的最小权限。
- **会话管理**：session / token 设过期时间，闲置超时登出。

详见 `spec/security-baseline.md`。

---

## 7. 测试规范

### 7.1 测试金字塔

```
       /\
      /e2e\        少（关键链路，< 5%）
     /------\
    /集成测试\      中（跨模块，~ 20%）
   /----------\
  /   单元测试  \    多（业务逻辑，~ 75%）
 /--------------\
```

### 7.2 测试覆盖

- **业务逻辑层覆盖率 ≥ 80%**（行覆盖 + 分支覆盖）。
- **API 层覆盖率 ≥ 70%**（含 happy + 错误 + 鉴权）。
- **数据访问层覆盖率 ≥ 60%**（用 in-memory db 或 mock）。
- 严格项目门槛 90%+，宽松项目门槛 70%+（CONVERGENCE.md §4.5 严格度选择）。

### 7.3 测试用例三件套

每个公共函数至少 3 类用例：

- **happy path**：正常输入返回预期结果。
- **edge case**：边界值（空 / 极大 / 极小 / null / undefined）。
- **failure case**：异常输入返回错误或抛异常。

### 7.4 测试命名

- 测试名说明"测什么 + 期望什么"：`it("should return 404 when user not found", ...)`。
- 不用 `test1` / `test2` 等无意义命名。

### 7.5 测试隔离

- 每个测试用例独立，不依赖其他用例的副作用。
- 用 setup / teardown 清理状态。
- 不依赖测试执行顺序。

---

## 8. 提交规范

### 8.1 Conventional Commits 1.0

格式：`<type>(<scope>): <subject>`

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修 bug |
| `docs` | 文档变更 |
| `style` | 格式调整（不影响代码逻辑） |
| `refactor` | 重构（非新增功能、非修 bug） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建 / 依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 杂项（不修改 src 或测试） |
| `revert` | 回滚某次提交 |

### 8.2 提交粒度

- **一个提交一个逻辑变更**：不把不相关变更混在同一提交。
- **不一个提交包含多个功能**：拆分提交。
- **不一个功能拆太细**：避免 10 个小提交组合成一个功能——按"完整可独立运行"粒度。

### 8.3 提交信息

- subject 行 ≤ 72 字符，用 imperative（"add" 而非 "added"）。
- body 说明 What + Why + How（How 可选，代码已表达）。
- 关联 Issue / TODO 标记：`Fixes #142`、`TODO#001`。

### 8.4 签名提交

- 严格项目要求 GPG / SSH 签名提交（CONVERGENCE.md §2.7 commit_signed）。
- 默认项目建议但不强制。

---

## 9. 文档与代码同步

- 修改公共 API 必须同步修改文档注释与 API 文档（`docs/api/`）。
- 修改架构决策必须走 ADR 流程（`docs/decisions/`）。
- 修改需求必须同步修改需求文档版本（`*.version` bump）。
- 修改行为必须更新 CHANGELOG（`docs/changes/CHANGELOG.md` [Unreleased]）。

---

## 10. 不可变原则

本规范属于 `semantic: spec` 层，不可在项目级覆盖。变更需走 ADR 流程：

1. 提交 ADR 描述变更原因与影响
2. 团队评审通过后合并
3. bump 本文档 version（SemVer）
4. 通知所有项目更新引用

详细规范变更历史见 `docs/changes/CHANGELOG.md`。
