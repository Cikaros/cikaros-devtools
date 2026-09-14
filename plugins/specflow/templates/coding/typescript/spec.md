---
title: TypeScript 语言规范
type: requirement
semantic: spec
version: 1.0.0
last_modified: 2026-09-02T00:00:00+08:00
author: specflow
status: active
refs:
  - spec/coding-standards.md
  - spec/security-baseline.md
  - templates/coding/security.md
---

# TypeScript 语言规范（templates/coding/typescript/spec.md）

> 按需加载层：session-start 检测到主语言为 TypeScript / JavaScript 时注入摘要。
> 与语言无关的通用基线见 `spec/coding-standards.md`；安全补充见 `templates/coding/security.md`。

## 1. 语法

### 1.1 TypeScript 严格模式基线

- `tsconfig.json` 必须开启 `"strict": true`；禁止用 `// @ts-ignore` 绕过类型错误，
  修不了的错误用 `// @ts-expect-error` + 一行原因注释（可被 CI 检出）。
- 禁止 `any`（入参 / 返回值 / 变量声明）；确实无法定型时用 `unknown` + 收窄（narrowing）。
  与第三方无类型库交互的边界处允许 `any`，但必须收敛在一个 `*.d.ts` 或适配层文件内。
- 类型断言 `as` 只允许出现在类型收窄或测试代码中；禁止 `as unknown as T` 双重断言。

### 1.2 现代语法约定

- 模块一律 ES Module（`import/export`）；禁用 CommonJS（`require/module.exports`），
  仅构建工具配置文件（`.cjs`）例外。
- 异步一律 `async/await`；禁止裸 `.then().catch()` 链（组合并行任务时例外，
  且必须处理每个分支的 rejection）。
- 优先 `const`，其次 `let`，禁用 `var`。
- 联合类型判别用可辨识联合（discriminated union）+ `switch (kind)` + exhaustive check
  （`never` 兜底），禁止散落的 `if typeof` 判断。

### 1.3 命名

- 变量 / 函数 camelCase；类型 / 接口 / 类 / 枚举 PascalCase；常量 UPPER_SNAKE_CASE；
  文件名 kebab-case（如 `user-service.ts`）。
- 接口命名不加 `I` 前缀（`User` 而非 `IUser`）；类型别名不加 `T` 前缀。
- 布尔属性用 `is/has/can/should` 前缀：`isValid` / `hasPermission`。

## 2. 高级特性

### 2.1 泛型

- 泛型参数命名见名知义（`<TItem, TResult>`），仅单字符 `<T>` 允许用于极简 identity 场景。
- 公共 API 的泛型必须带默认值或约束：`<T extends Entity = BaseEntity>`。
- 禁止为「看起来高级」而泛化——只有一个调用方的函数不写泛型。

### 2.2 工具类型与推导

- 复用内置工具类型（`Partial/Required/Pick/Omit/ReturnType/Parameters`），
  不手写等价结构。
- 派生类型优先从源推导（`type Users = typeof users`），禁止复制粘贴字段定义。
- `satisfies` 优于 `as` 做字面量校验（保留推导的同时约束形状）。

### 2.3 装饰器 / 反射 / 命名空间

- 装饰器仅限框架约定场景（NestJS controller / class-validator）；
  业务代码禁用自定义装饰器。
- 禁用 `namespace` 与 `declare global` 扩展（d.ts 类型补全除外）。
- 运行时反射（Reflect.metadata）禁止出现在库代码中。

### 2.4 异步与并发

- `Promise.all` 做批量并行；失败容忍场景用 `Promise.allSettled`。
- 长任务必须支持 `AbortSignal` 取消；`finally` 里清理资源。
- 禁止未 await 的 floating promise（lint `@typescript-eslint/no-floating-promises`）。

## 3. 编码规范

### 3.1 工程结构

- `src/` 分层：`api | services | domain | infra | utils`；单向依赖
  （api → services → domain ← infra），domain 不 import 任何上层。
- 一个文件一个导出主体；文件 > 300 行考虑拆分；函数 > 40 行必须有拆分理由。
- `index.ts` 只做 re-export，禁止含逻辑。

### 3.2 错误处理

- 业务错误抛 `Error` 子类（带 `code` 字段）；禁止抛字符串 / 字面量。
- 边界层（HTTP handler / MQ consumer）统一 catch + 转换；内部层不吞错。
- `try/catch` 的 catch 分支必须处理或重抛（含日志也算处理）；禁止空 catch。

### 3.3 测试

- 单测框架跟随项目（vitest / jest）；测试文件与被测文件同目录
  `*.test.ts`。
- 公共函数测试覆盖类型边界（`expectTypeOf` / `@ts-expect-error` 用例）。
- mock 只 mock 边界（网络 / 时钟 / 随机），不 mock 被测内部函数。

### 3.4 依赖与构建

- 依赖用 caret 范围（`^x.y.z`）；锁文件必须提交。
- 构建产物（`dist/`）不入库；`type-check` 与 `lint` 必须进 CI。

## 4. 反模式（禁止）

- ❌ `any` 贯穿业务代码 / `@ts-ignore` 成片出现。
- ❌ 用 `enum` 承载开放集合（用 union 字面量类型代替）；`const enum` 进库代码
  （isolatedModules 兼容性陷阱）。
- ❌ 在循环里 `await`（应 `Promise.all`）。
- ❌ `!` 非空断言成链（`a!.b!.c`）；一次以上非空断言视为类型设计失败。
- ❌ 把 `catch (e)` 里的 `e: any` 直接透传给用户（含堆栈泄漏风险）。
- ❌ `export default`（重构工具无法安全重命名；统一命名导出）。
- ❌ 运行时用字符串拼 key 访问强类型对象（丢失类型安全，用 `keyof` 收敛）。
- ❌ 深层可选链 + 静默返回 `undefined`（`a?.b?.c` 三层以上应重构数据形状）。
