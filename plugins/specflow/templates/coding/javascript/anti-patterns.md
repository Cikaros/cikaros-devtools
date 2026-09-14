---
title: JavaScript 反模式与易错点
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
  - templates/coding/javascript/spec.md
---
# JavaScript 反模式与易错点（templates/coding/javascript/anti-patterns.md）

> JavaScript 语言特定的反模式——hook 检测到这些模式时**直接注入警告**。
> 通用反模式（如 magic number / 深嵌套）见 `spec/coding-standards.md`，不在此重复。

## 1. 类型与内存

### 1.1 ❌ Bad
```javascript
`==` 比较
```

1.2 ✅ Good
```
强制类型转换坑；用 `===` 严格相等
```

### 2.1 ❌ Bad
```javascript
`var x = 1;`
```

2.2 ✅ Good
```
函数作用域 + hoisting；用 `let` / `const` 块作用域
```

### 3.1 ❌ Bad
```javascript
`for (const k in arr)` 遍历数组
```

3.2 ✅ Good
```
`for...in` 遍历字符串键；数组用 `for...of` 或 `forEach`
```

### 4.1 ❌ Bad
```javascript
`setTimeout(() => fn(), 0)`
```

4.2 ✅ Good
```
与 `queueMicrotask(fn)` 语义不同；优先用后者
```

## 2. 错误处理

### 1.1 ❌ Bad
```javascript
`console.log(typeof null)` 期望 `null`
```

1.2 ✅ Good
```
返回 `"object"`；用 `x === null` 显式判断
```

### 2.1 ❌ Bad
```javascript
`new Promise((resolve) => resolve(asyncFn()))`
```

2.2 ✅ Good
```
Promise 构造器不处理异步异常；用 `Promise.resolve().then(asyncFn)` 或 `async`
```

### 3.1 ❌ Bad
```javascript
`delete arr[i]` 删除数组元素
```

3.2 ✅ Good
```
留下 `undefined` 空洞；用 `arr.splice(i, 1)` 或 `arr.filter`
```

### 4.1 ❌ Bad
```javascript
`x = x || defaultValue` 当 x 为 `0` 或 `""`
```

4.2 ✅ Good
```
falsy 误判；用 `x ?? defaultValue`（nullish 合并）
```

## 3. 工具链与构建

参见 `toolchains.json`——hook 检测到工具链命令时也会触发警告。

## 4. 检测规则

本文件的 anti-pattern 列表会被 `hooks/scripts/lib/common.mjs` 的 `ANTI_PATTERN_TRIGGERS` 引用；
hook 自动检测以下模式并注入警告（无需用户主动查询）。
