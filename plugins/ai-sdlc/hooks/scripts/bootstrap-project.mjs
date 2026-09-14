#!/usr/bin/env node
/**
 * bootstrap-project.mjs — ai-sdlc 项目级自检初始化 CLI（幂等，零依赖）
 *
 * v0.10.0：sdlc 应自行监测并初始化首次使用的项目——本脚本是 ensureProjectBootstrap
 * 的命令行入口，与 SessionStart hook 的自动初始化共用同一实现（单一事实源）。
 *
 * 职责（全部幂等，重复执行无副作用）：
 *   1. `.sdlc/state.json` 缺失 → 落盘全量默认 schema（common.defaultState）
 *   2. `.git` / `.gitignore` 存在 → `.gitignore` 追加托管块
 *      （忽略 `.sdlc/*` + 白名单 bands.yaml / custom/ / hooks/——运行时与
 *      工件不进版本控制，任务结束后归档即可，无需提交）
 *   3. `.codexignore` 已存在 → 追加运行时文件忽略块（不含 artifacts/——
 *      工件必须可被 agent 读写）
 *
 * 消费方：
 *   - scripts/sh/init-project.sh（手动初始化，v0.10.0 起核心步骤委托本脚本）
 *   - scripts/sh/sdlc.sh status/workflow/advance（CLI 首次使用自动初始化）
 *   - SessionStart / PostToolUse / UserPromptSubmit hooks（直接调用库函数）
 *
 * 用法：
 *   node bootstrap-project.mjs [projectRoot]     # 默认 process.cwd()
 *
 * 输出（stdout 单行 JSON，供 shell 消费）：
 *   { "firstUse": true, "actions": [".sdlc/state.json", ".gitignore"], "stateDir": "..." }
 */

import { resolve } from 'node:path';
import { ensureProjectBootstrap } from './lib/common.mjs';

const rootArg = process.argv[2];
const projectRoot = rootArg ? resolve(rootArg) : process.cwd();
const result = ensureProjectBootstrap(projectRoot);
process.stdout.write(JSON.stringify(result) + '\n');
