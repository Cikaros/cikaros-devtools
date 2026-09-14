---
description: 单模块设计与实现（设计卡片驱动）
argument-hint: <module-name>
---
# /design-module — 模块设计与实现

## 输入

用户参数：$ARGUMENTS

- 模块名（须对应项目内已有目录；按 package.json / pyproject / go.mod
  等识别项目类别后定位）
- 若参数为空：列出候选模块（snapshot 模块清单）供选择

## 流程

1. **写设计卡片**：`docs/component/cards/<module>.md`（7 张既有卡片
  见 docs/component/cards/，作为格式参照）：职责 / 对外接口 /
  内部结构 / 依赖 / 失败模式 / 测试策略 / 观测性
2. **标记**：卡片内每个接口点创建 `//TODO#NNN <module>:<接口点>
   [agent:default]`
3. **实现**：转 `/coding`——实现严格对照卡片接口签名，偏差回写卡片
4. **评审**：转 `/review <module 目录>`——对照卡片核对「实现 = 设计」
5. **收口**：advance；卡片状态标记 implemented

## 标记绑定

- 标记描述带模块前缀（`<module>:<接口点>`）便于 by_module 聚合
- 卡片与实现的偏差本身要开标记（`align: <偏差>`）

## 产出物

- `docs/component/cards/<module>.md`（必需，先于代码）
- 模块源码 + 模块级测试
- （可选）模块 README

## 反模式（禁止）

- ❌ 先写代码后补卡片（卡片是设计工具不是事后文档）
- ❌ 卡片接口签名与实现不一致且无 align 标记
- ❌ 模块内塞跨模块职责（出现即说明边界切错了）
- ❌ 失败模式章节写「不会失败」（每个 IO / 依赖都有失败路径）
