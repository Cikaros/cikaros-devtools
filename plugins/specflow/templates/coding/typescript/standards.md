---
title: TypeScript 编码规范
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-03T00:00:00+08:00
author: Cikaros
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
  - templates/coding/typescript/spec.md
---

# TypeScript 编码规范（templates/coding/typescript/standards.md）

> 本文是 TypeScript 在 specflow 体系下的「可执行编码规范」——命名、格式化、
> 文件与目录结构、import 顺序、错误传播、日志、测试约定。语言规范基线见
> `templates/coding/typescript/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。遵循本文无需再查 Airbnb / Google 风格指南。

## 1. 命名约定

### 1.1 标识符大小写规则

- 变量、函数、属性：camelCase；如 `userService`、`fetchUser`、`isActive`。
- 类型别名、接口、类、枚举、record：PascalCase；如 `User`、`OrderStatus`。
- 常量（编译期已知且全局唯一）：UPPER_SNAKE_CASE；如 `MAX_RETRY = 3`。
- 文件名：kebab-case；如 `user-service.ts`、`order-repo.ts`。
- 布尔属性与方法：`is/has/can/should` 前缀；`isValid`、`hasPermission`、`canRead`。

### 1.2 命名禁忌

- 接口不加 `I` 前缀（`User` 而非 `IUser`）；类型别名不加 `T` 前缀。
- 禁止无信息命名：`data`、`info`、`temp`、`util`（除非在极局部作用域）。
- 禁止否定式布尔命名：用 `isValid` 而非 `isInvalid`（双重否定增加阅读负担）。
- 缩写词统一全小写或全大写：`userId`、`parseURL`；禁止 `userId` 与 `userID` 混用。

## 2. 格式化与文件结构

### 2.1 格式化基线

- Prettier 配置统一：`singleQuote: true`、`semi: true`、`printWidth: 100`、
  `trailingComma: 'all'`、`tabWidth: 2`；CI 用 `prettier --check` 守门。
- 行宽 100 软上限；超长字符串模板与类型签名可换行（缩进对齐）。
- import 排序：标准库 → 第三方 → `@/`（别名）→ 相对路径，组间空行；
  用 `eslint-plugin-import` 自动排序。

### 2.2 目录结构

```
src/
  api/          # HTTP / RPC 适配层
  services/     # 用例编排
  domain/       # 领域模型与纯函数规则
  infra/        # DB / 外部 SDK 适配
  utils/        # 纯工具（无业务）
  index.ts      # 仅 re-export
```

约束：`api → services → domain ← infra`，单向依赖；`domain` 不 import 任何上层。
违反依赖方向必须经 review 并在 PR 描述说明理由。

### 2.3 文件大小与拆分

- 一个文件一个主导出主体；文件超过 300 行考虑拆分；函数超过 40 行必须有拆分理由。
- `index.ts` 只做 re-export，禁止含逻辑、禁止含副作用（如读环境变量）。
- 测试文件与被测文件同目录：`user-service.ts` ↔ `user-service.test.ts`。

## 3. import 与依赖

### 3.1 import 风格

```ts
// 命名导出优先
import { UserService } from './user-service';
// 禁止：export default（重构工具无法安全重命名）

// 类型 import 显式标注
import type { User } from './types';
// 避免：运行时与类型混在一个 import 语句后用 type 标注单条
```

- 禁止 `import * as`（除非消费无类型导出的 CommonJS 模块）。
- 副作用 import（`import './polyfill'`）必须集中在入口文件，禁止散落业务模块。
- 循环依赖零容忍：`madge --circular src/` 输出必须为空，否则重构。

### 3.2 依赖管理

- 依赖锁定：`pnpm-lock.yaml` / `package-lock.json` 必须提交；CI 用 frozen-lockfile 安装。
- 禁止使用幻影依赖（未被 `package.json` 声明但能 import 的包），
  pnpm 默认隔离即可，npm 项目需 `eslint-plugin-import` 的 `no-extraneous-dependencies`。
- 升级策略：patch 走 renovate 自动合并；minor 走人工 PR；major 必须单独 PR + 回归测试。

## 4. 错误传播与日志

### 4.1 错误传播链

- 业务错误抛 `AppError` 子类（带 `code` 字段），禁止抛字符串 / 字面量。
- 内部层不吞错、不空 catch；`try/catch` 的 catch 分支必须处理或重抛（含日志也算处理）。
- 边界层（HTTP handler / MQ consumer）统一 catch + 转换为协议错误，
  消息禁止泄漏堆栈、内部路径、用户 PII（与 `templates/coding/security.md` 一致）。

### 4.2 日志约定

- 用结构化日志库（`pino` / `winston`），禁止 `console.log` 进生产路径。
- 日志字段固定 schema：`{level, msg, traceId, userId, ...payload}`；
  traceId 由请求入口注入，全链路透传。
- 禁止日志输出敏感字段（token、密码、完整身份证号）；超过 4 位的敏感字段做掩码。
- 日志级别：`error`（需人工介入）、`warn`（可恢复但需关注）、`info`（业务事件）、
  `debug`（仅本地）。

### 4.3 错误与日志的边界

```ts
try {
  await orderService.place(input);
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ msg: 'place order failed', traceId, err: err.message, stack: err.stack });
  if (err instanceof ValidationError) return reply.code(400).send({ code: err.code });
  return reply.code(500).send({ code: 'INTERNAL' });
}
```

## 5. 测试约定

### 5.1 测试组织

- 框架跟随项目（vitest / jest）；测试文件 `*.test.ts` 与被测文件同目录。
- 命名：`describe('UserService')` + `it('should return user when id exists')`，
  行为描述而非方法名罗列。
- 一个测试只断言一件事；`expect` 数量 ≤ 5，超过的拆成多个 `it`。

### 5.2 mock 与夹具

- mock 只 mock 边界（网络 / 时钟 / 随机 / DB），不 mock 被测内部函数。
- 夹具（fixture）独立成目录 `__fixtures__/`，禁止跨测试文件复制粘贴构造数据。
- 时间用假时钟（`vi.useFakeTimers`）；随机用注入的 `() => number` 而非直接 `Math.random`。

### 5.3 类型层测试

```ts
import { expectTypeOf } from 'vitest';

test('User is non-nullable', () => {
  expectTypeOf<User>().not.toBeNullType();
  expectTypeOf<Users[number]>().toEqualTypeOf<User>();
});
```

公共类型 API 必须有类型层断言（`expectTypeOf` 或 `@ts-expect-error` 用例），
保证重构时不破坏外部类型契约。覆盖率门禁核心模块行覆盖 ≥ 80%。
