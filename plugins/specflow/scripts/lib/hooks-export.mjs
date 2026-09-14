#!/usr/bin/env node
/**
 * hooks-export.mjs — hooks.json 导出 / 合并 / 剥离工具（零依赖）
 *
 * 用法：
 *   hooks-export.mjs <src> <dst> <root>     把 src（插件 hooks/hooks.json，含 ${PLUGIN_ROOT}
 *                                            占位符）中的 specflow 条目替换为 root 绝对路径后
 *                                            合并进 dst（不存在则新建；已存在的 specflow 条目
 *                                            先剥离再追加 → 幂等）
 *   hooks-export.mjs --strip <dst> <root>   从 dst 中剥除指向 root 的 specflow 条目
 *                                            （剥完 hooks 为空则删除 dst）
 *
 * 判定"specflow 条目"的依据：命令字符串包含 <root>/hooks/scripts/ 路径。
 * 退出码：0 成功 / 1 参数或 IO 错误。
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const [,, ...rest] = process.argv;

function usage() {
  process.stderr.write([
    'usage:',
    '  hooks-export.mjs <src> <dst> <root>   merge specflow entries (root-substituted) into dst',
    '  hooks-export.mjs --strip <dst> <root> remove specflow entries pointing at root from dst',
  ].join('\n') + '\n');
  process.exit(1);
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/** 递归替换对象/数组中所有字符串里的 ${PLUGIN_ROOT} */
function substitute(node, rootAbs) {
  if (typeof node === 'string') return node.split('${PLUGIN_ROOT}').join(rootAbs);
  if (Array.isArray(node)) return node.map(v => substitute(v, rootAbs));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = substitute(v, rootAbs);
    return out;
  }
  return node;
}

/** 判断某事件分组（{matcher?, hooks:[...]}）是否属于 specflow（命令含 rootAbs 路径） */
function isSpecflowGroup(group, rootAbs) {
  if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) return false;
  const needle = `${rootAbs}/hooks/scripts`;
  return group.hooks.some(h => h && typeof h.command === 'string' && h.command.includes(needle));
}

function stripSpecflow(doc, rootAbs) {
  if (!doc || typeof doc !== 'object') return doc;
  if (!doc.hooks || typeof doc.hooks !== 'object') return doc;
  for (const event of Object.keys(doc.hooks)) {
    const groups = doc.hooks[event];
    if (!Array.isArray(groups)) continue;
    doc.hooks[event] = groups.filter(g => !isSpecflowGroup(g, rootAbs));
    if (doc.hooks[event].length === 0) delete doc.hooks[event];
  }
  if (Object.keys(doc.hooks).length === 0) delete doc.hooks;
  return doc;
}

function mergeInto(dstDoc, srcDoc, rootAbs) {
  const base = stripSpecflow(dstDoc && typeof dstDoc === 'object' ? dstDoc : {}, rootAbs);
  if (!base.hooks || typeof base.hooks !== 'object') base.hooks = {};
  for (const [event, groups] of Object.entries(srcDoc.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    const kept = (base.hooks[event] || []).filter(g => !isSpecflowGroup(g, rootAbs));
    base.hooks[event] = [...kept, ...groups];
  }
  // 描述：保留用户原描述，并标注 specflow 参与合并
  if (typeof base.description === 'string' && !base.description.includes('specflow')) {
    base.description = `${base.description} (+ specflow entries)`;
  } else if (!base.description) {
    base.description = srcDoc.description || 'merged hooks (specflow)';
  }
  return base;
}

function main() {
  if (rest[0] === '--strip') {
    const [, dst, root] = rest;
    if (!dst || !root) usage();
    const rootAbs = resolve(root);
    if (!existsSync(dst)) { process.stdout.write('{}\n'); return; }
    const doc = safeParse(readFileSync(dst, 'utf8'));
    if (!doc) {
      process.stderr.write(`[hooks-export] dst 不是合法 JSON，跳过剥离: ${dst}\n`);
      process.exit(1);
    }
    const stripped = stripSpecflow(doc, rootAbs);
    if (!stripped.hooks || Object.keys(stripped.hooks).length === 0) {
      unlinkSync(dst);
      process.stdout.write(JSON.stringify({ stripped: true, removed_file: dst }) + '\n');
    } else {
      writeFileSync(dst, JSON.stringify(stripped, null, 2) + '\n', 'utf8');
      process.stdout.write(JSON.stringify({ stripped: true, kept_events: Object.keys(stripped.hooks) }) + '\n');
    }
    return;
  }

  const [src, dst, root] = rest;
  if (!src || !dst || !root) usage();
  const rootAbs = resolve(root);
  const srcText = existsSync(src) ? readFileSync(src, 'utf8') : null;
  if (srcText == null) {
    process.stderr.write(`[hooks-export] src 不存在: ${src}\n`);
    process.exit(1);
  }
  const srcDoc = safeParse(srcText);
  if (!srcDoc || typeof srcDoc.hooks !== 'object') {
    process.stderr.write(`[hooks-export] src 不是合法 hooks.json: ${src}\n`);
    process.exit(1);
  }
  const substituted = substitute(srcDoc, rootAbs);
  const dstDoc = existsSync(dst) ? safeParse(readFileSync(dst, 'utf8')) : null;
  const merged = mergeInto(dstDoc, substituted, rootAbs);
  writeFileSync(dst, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({
    exported: dst,
    events: Object.keys(merged.hooks || {}),
    substituted_root: rootAbs,
  }, null, 2) + '\n');
}

main();
