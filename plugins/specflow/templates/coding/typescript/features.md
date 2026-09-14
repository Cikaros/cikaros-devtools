---
title: TypeScript 语言特性
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

# TypeScript 语言特性（templates/coding/typescript/features.md）

> 本文是 TypeScript 在 specflow 体系下的「特性清单」，列出团队约定的现代语法、
> 类型系统能力、模块解析模型、并发原语与错误处理范式。语言规范基线见
> `templates/coding/typescript/spec.md`；与语言无关的安全补充见
> `templates/coding/security.md`。读到这份文档即应能在不查外部资料的前提下，
> 写出符合本仓库约定的 TypeScript 代码。

## 1. 现代语法演进

### 1.1 类型层与运行时层的演进坐标

- 目标 TypeScript ≥ 5.4（`satisfies`、`infer` 嵌套、`const` 类型参数均已稳定）；
  `tsconfig.json` 中 `target` 与 `lib` 必须显式声明，禁止依赖默认值。
- 严格模式基线：`"strict": true`、`"noUncheckedIndexedAccess": true`、
  `"exactOptionalPropertyTypes": true`；新项目全部开启，存量项目逐目录放宽需注释理由。
- 模块统一 ESM；`moduleResolution: "NodeNext"` 或 `"Bundler"`（视构建工具而定），
  `module` 与 `moduleResolution` 必须配套，禁止混搭（如 `ESNext` + `Node`）。

### 1.2 关键现代语法

```ts
// satisfies：保留推导的同时约束字面量形状（比 as 安全）
const config = {
  port: 8080,
  host: '0.0.0.0',
} satisfies ServerConfig; // 类型不收窄为字面量，但被 ServerConfig 约束

// const 类型参数：让推导落到字面量层
function first<const T>(xs: readonly T[]): T {
  return xs[0];
}
const a = first(['a', 'b']); // 推导为 'a' 而非 string

// using（Stage 3，TS 5.2+）：确定性资源释放
using db = acquireConnection(); // 离开作用域自动 [Symbol.dispose]()
```

### 1.3 模板字面量类型

```ts
type Route = `/api/${string}`;
type EventName = `${'user' | 'order'}.${'created' | 'updated'}`;
// 'user.created' | 'user.updated' | 'order.created' | 'order.updated'

type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
```

禁止把模板字面量类型当作字符串拼接使用——它只参与编译期类型计算，运行时不产生任何值。

## 2. 类型系统能力

### 2.1 条件类型与推导

```ts
type Unwrap<T> = T extends Promise<infer U> ? U : T;
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T;

// 分布式条件类型：裸类型参数触发分布
type ToArray<T> = T extends unknown ? T[] : never;
type R = ToArray<string | number>; // string[] | number[]
```

约束：条件类型嵌套不超过 3 层；超过的应抽成命名工具类型并注释推导意图，
否则后续维护者无法快速理解类型推导链。

### 2.2 可辨识联合与穷尽检查

```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

function handle<T, E>(r: Result<T, E>): T {
  switch (r.ok) {
    case true:
      return r.value;
    case false:
      throw new Error(String(r.error));
    default:
      // exhaustive check：新增分支未处理时编译失败
      const _: never = r;
      throw new Error(`unhandled: ${_}`);
  }
}
```

### 2.3 工具类型与派生

优先复用内置工具类型（`Partial/Required/Pick/Omit/ReturnType/Parameters/Awaited`），
派生类型从源推导（`type State = typeof initialState`），禁止复制粘贴字段定义。

```ts
const initialState = { loading: false, data: null as string | null };
type State = typeof initialState; // 派生而非手写
type LoadingState = Pick<State, 'loading'>;
```

## 3. 模块与依赖模型

### 3.1 模块解析策略

- `NodeNext`：跟随 Node 的 ESM/CJS 互操作规则（`.js` 扩展名 import、`type: module`），
  适用于发布到 npm 的库与 Node 服务。
- `Bundler`：仅用于由打包器（Vite/esbuild/webpack）消费的纯前端项目；
  禁止在 Node 服务里用 `Bundler`（运行时解析行为不一致）。
- `paths` 别名必须与构建工具同步配置（`vite.config.ts`/`tsconfig.paths`），
  且禁止别名只配在 tsconfig 没配在打包器（运行时报 ENOENT）。

### 3.2 package.json 的 exports 字段

```json
{
  "name": "@cikaros/sdk",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./testing": {
      "types": "./dist/testing.d.ts",
      "import": "./dist/testing.js"
    }
  },
  "imports": {
    "#internal/*": "./src/internal/*"
  }
}
```

`exports` 必须配齐 `types` 条件（否则消费者拿不到类型）；
内部跨包引用走 `imports`（`#` 前缀子路径），不暴露给外部。

### 3.3 依赖与锁文件

- 运行时依赖用 caret（`^x.y.z`），开发依赖用 tilde（`~x.y.z`）收紧；
  锁文件必须提交且 CI 使用 `npm ci` / `pnpm install --frozen-lockfile`。
- peerDependencies 必须声明且版本范围与宿主实际兼容（写错会被 npm 7+ 自动安装导致幻影依赖）。

## 4. 异步与并发

### 4.1 async/await 与 Promise 组合

```ts
// 并行批量：失败全部 reject
const results = await Promise.all(ids.map(fetchUser));

// 失败容忍：返回 {status, value|reason}
const settled = await Promise.allSettled(ids.map(fetchUser));
const ok = settled.filter((r): r is PromiseFulfilledResult<User> =>
  r.status === 'fulfilled'
);
```

禁止裸 `.then().catch()` 链，除非是组合并行任务的边界；
循环内 `await` 必须改为 `Promise.all`（顺序依赖场景除外且注释说明）。

### 4.2 可取消与超时

```ts
async function fetchWithTimeout(url: string, ms: number, signal?: AbortSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), ms);
  signal?.addEventListener('abort', () => ctrl.abort(signal.reason));
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

长任务（>1s）必须接受 `AbortSignal` 参数；finally 中清理定时器/订阅，
禁止未 await 的 floating promise（lint `no-floating-promises`）。

## 5. 错误处理范式

### 5.1 业务错误子类

```ts
export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}
export class ValidationError extends AppError {}
```

抛错必须带 `code`（可被边界层映射为 HTTP/RPC 状态码），
`cause` 用于保留原始错误链（ES2022）。

### 5.2 边界层收敛

HTTP handler / MQ consumer / CLI 入口必须 try/catch 全包裹，
把内部 `AppError` 映射为协议错误响应，其他 `Error` 转为 5xx 并打结构化日志。
内部层不吞错、不空 catch；`catch (e)` 中 `e` 默认 `unknown`，
收窄为 `Error` 后再访问 `.message`。
