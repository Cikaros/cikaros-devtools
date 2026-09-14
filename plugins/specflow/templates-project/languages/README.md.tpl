# 自定义语言规范目录（.specflow/languages/）

内置语言规范（templates/coding/）：TypeScript / Python / Go / Java。

## 作用（REQUIREMENTS §4.4）

项目使用内置之外的语言（Rust / Kotlin / Zig …）时，在本目录放
`<lang>.md`。SessionStart hook 检测到主语言后，**本目录的同名文件优先于
内置模板**注入会话上下文（loaded-sections.json 的 lang 层可见加载来源）。

## 示例（.specflow/languages/rust.md）

```markdown
# Rust 规范

## 1. 语法
- Edition 2021；clippy 零警告是合入前提

## 2. 高级特性
- unsafe 必须有 SAFETY 注释与最小化范围

## 3. 编码规范
- 错误处理一律 Result/thiserror，禁止 unwrap 进入生产路径

## 4. 反模式
- ❌ String 承载一切字符串（语义明确用 enum + match）
```

## 建议结构（4 部分）

与内置规范对齐：`1. 语法` / `2. 高级特性` / `3. 编码规范` / `4. 反模式`。
文件名（去 .md）必须与 env-scanner 检测出的主语言一致
（如 `rust.md` 对应检测值 `rust`）。
