---
title: TypeScript 反模式与陷阱
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

# TypeScript 反模式与陷阱（templates/coding/typescript/anti-patterns.md）

> 本文收录 TypeScript 项目中高频出现且代价昂贵的反模式，每条都给出 ❌ 反例、
> ✅ 正例与一句话原因。语言规范基线见 `templates/coding/typescript/spec.md`；
> 安全相关反模式见 `templates/coding/security.md`。
> 所有反例均来自真实 PR review，禁止以「我这次是特例」为由复现。

## 1. 类型系统滥用类反模式

### 1.1 `any` 贯穿业务代码

❌ 反例：

```ts
function process(data: any): any {
  return data.items.map((i: any) => i.value);
}
const result: any = process(response);
```

✅ 正例：

```ts
interface Response { items: Array<{ value: string }> }
function process(data: Response): string[] {
  return data.items.map((i) => i.value);
}
const result: string[] = process(response);
```

`any` 关闭类型检查，等于回到 JavaScript；任何重构都不会有编译期保护，错误推迟到运行时。

### 1.2 双重断言 `as unknown as T`

❌ 反例：

```ts
const user = fetchUser() as unknown as AdminUser;
```

✅ 正例：

```ts
const user = await fetchUser();
if (!isAdminUser(user)) throw new ValidationError('NOT_ADMIN', 'user is not admin');
// 收窄函数：function isAdminUser(u: User): u is AdminUser
```

`as unknown as T` 绕过类型系统，等于不做任何类型校验；应当用类型守卫函数显式收窄。

### 1.3 字符串拼 key 访问强类型对象

❌ 反例：

```ts
const value = config[`${env}_endpoint`]; // 类型为 any/unknown，丢失约束
```

✅ 正例：

```ts
const endpoints = { dev: '...', prod: '...' } as const;
type Env = keyof typeof endpoints;
function getEndpoint(env: Env): string {
  return endpoints[env];
}
```

字符串拼 key 等于绕过类型系统；应把 key 收敛为字面量联合类型，让编译器校验。

## 2. 异步与并发类反模式

### 2.1 循环内 `await`

❌ 反例：

```ts
for (const id of ids) {
  const user = await fetchUser(id); // 串行 N 次往返，N×RTT
  users.push(user);
}
```

✅ 正例：

```ts
const users = await Promise.all(ids.map(fetchUser));
// 失败容忍：const users = await Promise.allSettled(ids.map(fetchUser));
```

循环 await 把并行机会变成串行；除非后一个调用依赖前一个的结果，否则必须并行。

### 2.2 未 await 的 floating promise

❌ 反例：

```ts
void notify(user); // 忘记 await，异常被静默吞掉
```

✅ 正例：

```ts
await notify(user).catch((e) => logger.warn({ msg: 'notify failed', err: String(e) }));
```

未 await 的 promise 异常不会冒泡到调用栈，排障困难；必须 await 或显式 `.catch`。

## 3. 错误处理类反模式

### 3.1 空 catch 与 `e: any` 透传

❌ 反例：

```ts
try {
  await fetch(url);
} catch (e: any) {
  return { error: e.message, stack: e.stack }; // 堆栈泄漏给用户
}
```

✅ 正例：

```ts
try {
  await fetch(url);
} catch (e) {
  const err = e instanceof Error ? e : new Error(String(e));
  logger.error({ msg: 'fetch failed', url, err: err.message });
  return { code: 'INTERNAL' };
}
```

空 catch 吞错、`e: any` 透传堆栈给用户都是典型安全与排障问题；
`e` 默认 `unknown`，必须收窄为 `Error` 后再访问属性。

### 3.2 `catch (e)` 不区分错误类型

❌ 反例：

```ts
try {
  await risky();
} catch (e) {
  return retry(); // 业务错误与系统错误一视同仁，可能重试 4xx
}
```

✅ 正例：

```ts
try {
  await risky();
} catch (e) {
  if (e instanceof ValidationError) return { code: e.code };
  if (e instanceof NetworkError && attempt < MAX_RETRY) return retry();
  throw e;
}
```

不区分错误类型会导致 4xx 也被重试、业务错误被当作系统错误重抛；
必须按 `instanceof` 分支处理。

## 4. 模块与导出类反模式

### 4.1 `export default`

❌ 反例：

```ts
export default class UserService {}
// 消费方：import UserSvc from './user-service'; // 名字随意，重构断链
```

✅ 正例：

```ts
export class UserService {}
// 消费方：import { UserService } from './user-service';
```

`export default` 让重构工具无法安全重命名，且消费方命名随意导致同一类多份命名；
统一命名导出是团队可维护性的底线。

### 4.2 深层可选链静默返回 `undefined`

❌ 反例：

```ts
const city = user?.address?.contact?.location?.city; // 4 层可选链，任一为空则 undefined
```

✅ 正例：

```ts
interface Contact { location: { city: string } }
interface User { contact: Contact } // 把不变量上移到类型定义，可选只是边界
const city = user?.contact.location.city ?? 'unknown';
```

3 层以上可选链说明数据形状设计有问题；应当把「必填」的不变量上移到类型定义，
让可选只在真正的边界（如外部 API 响应）出现。

## 5. 类型设计类反模式

### 5.1 用 `enum` 承载开放集合

❌ 反例：

```ts
enum Env { Dev = 'dev', Prod = 'prod' }
// 新增 staging 需要改 enum 定义并发布，下游升级链路长
```

✅ 正例：

```ts
type Env = 'dev' | 'prod' | 'staging';
const ENVS = ['dev', 'prod', 'staging'] as const satisfies readonly Env[];
```

`enum` 是运行时对象，跨包升级成本高；字面量联合类型是纯类型层零运行时开销，
新增值只需类型扩展。

### 5.2 非空断言链 `a!.b!.c`

❌ 反例：

```ts
const city = user!.address!.contact!.location!.city;
```

✅ 正例：

```ts
if (!user?.address?.contact?.location) {
  throw new ValidationError('INCOMPLETE_USER', 'user location missing');
}
const city = user.address.contact.location.city;
```

`!` 链等于告诉编译器「我担保非空」但运行时未必；一次以上非空断言视为类型设计失败，
应当用显式校验 + early throw 表达不变量。

## 6. 工程化类反模式

### 6.1 `@ts-ignore` 成片出现

❌ 反例：

```ts
// @ts-ignore
// @ts-ignore
const result = legacyApi(input);
```

✅ 正例：

```ts
// @ts-expect-error legacyApi lacks types, tracked in #1234
const result = legacyApi(input);
// 或：包裹到带类型的适配层，业务代码只见类型
```

`@ts-ignore` 静默吞掉所有错误且不会被 CI 检出；
`@ts-expect-error` 在错误消失时会编译失败，强制开发者清理。
