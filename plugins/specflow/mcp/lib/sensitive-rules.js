/**
 * sensitive-rules.js — specflow 敏感信息规则加载器（v0.6.0 / B6：跨语言单源）
 *
 * 单一事实源：rules/sensitive-rules.json（本模块与 Python 侧 scripts/lib/sanitize.py
 * 均在运行时加载该文件，规则修改零分叉——v0.4.0 的「同构镜像 + 对齐测试防漂移」
 * 方案升级为真正的单源）。
 *
 * 消费方：
 *   - mcp/privacy-guard/index.js（read_file_redacted / scan_output / redact_output）
 *   - hooks/scripts/post-tool-use.mjs（工具输出检测 + 命中时给出脱敏改写版本）
 *
 * JSON 约束（两语言公共 regex 子集 / [0-9] 替代 \d / {N} 分组占位）见文件内 comment。
 * severity 分级：high（密钥/证件/银行卡，post-tool-use 发 systemMessage 告警）
 * / low（邮箱/手机/内网地址，仅参与改写不告警）。
 *
 * CARD 规则（luhn:true）：候选串先过 Luhn 校验再打码——任意 13-16 位数字
 * （时间戳拼接、订单号）不会误伤（v0.3.2 / P1-6 引入，v0.6.0 起 Python 侧同样生效）。
 *
 * 加载失败策略：fail-loud（抛错并指明缺哪个文件）——隐私规则静默降级为空规则
 * 比报错更危险；rules/ 属安装载荷（classic 与插件模式均在树内），
 * 缺文件即安装损坏，doctor / test-plugin.sh 会捕获。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const RULES_SOURCE = path.join(__dirname, '..', '..', 'rules', 'sensitive-rules.json');

let RULES;

function loadRules() {
  let raw;
  try {
    raw = fs.readFileSync(RULES_SOURCE, 'utf8');
  } catch (err) {
    throw new Error(
      `[specflow] sensitive-rules.js 无法读取规则单源 ${RULES_SOURCE}：${err.message}。` +
      '安装可能损坏（rules/sensitive-rules.json 属必备载荷），请重装或运行 sf.sh doctor。');
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[specflow] sensitive-rules.json 不是合法 JSON：${err.message}（修复后重试）`);
  }
  const rules = Array.isArray(data.rules) ? data.rules : [];
  return rules.map((r) => {
    if (!r.id || !r.regex) {
      throw new Error(`[specflow] sensitive-rules.json 存在缺 id/regex 的规则项：${JSON.stringify(r)}`);
    }
    return {
      id: r.id,
      name: r.name || r.id,
      severity: r.severity === 'low' ? 'low' : 'high',
      repl: typeof r.repl === 'string' ? r.repl : '<REDACTED>',
      luhn: r.luhn === true,
      re: new RegExp(r.regex, 'g'),
    };
  });
}

RULES = loadRules();

/** Luhn 校验（银行卡 / 信用卡校验位算法） */
function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/** 分组占位 {N} → 实际捕获组内容（EMAIL 部分打码等场景） */
function expandRepl(repl, groups) {
  return repl.replace(/\{(\d+)\}/g, (_, d) => groups[Number(d) - 1] || '');
}

/**
 * 对文本执行全部规则。返回：
 *   { redacted, matches: [{rule, name, severity, count}], totalMatches, highMatches }
 */
function redactText(content, { severityFilter = null } = {}) {
  let result = String(content);
  const matches = [];
  let totalMatches = 0;
  let highMatches = 0;
  const rules = severityFilter ? RULES.filter(r => r.severity === severityFilter) : RULES;
  for (const rule of rules) {
    let count = 0;
    // replace 回调参数：(match, p1, p2, ..., offset, string) —— 捕获组 = 中间段
    result = result.replace(rule.re, (...args) => {
      const mm = args[0];
      const groups = args.slice(1, args.length - 2);
      if (rule.luhn) {
        const digits = mm.replace(/[^0-9]/g, '');
        if (!(digits.length >= 13 && digits.length <= 16 && luhnOk(digits))) {
          return mm; // 不是合法银行卡号：不打码、不计数
        }
      }
      count += 1;
      return expandRepl(rule.repl, groups);
    });
    rule.re.lastIndex = 0; // String.replace 会重置，防御性归零
    if (count > 0) {
      matches.push({ rule: rule.id, name: rule.name, severity: rule.severity, count });
      totalMatches += count;
      if (rule.severity === 'high') highMatches += count;
    }
  }
  return { redacted: result, matches, totalMatches, highMatches };
}

/** 只检测不改写（与 redactText 同一规则源，保证「检测即所见」） */
function scanText(content, { severityFilter = null } = {}) {
  const { matches, totalMatches, highMatches } = redactText(content, { severityFilter });
  return { matches, totalMatches, highMatches, verdict: highMatches > 0 ? 'SENSITIVE_HIGH' : (totalMatches > 0 ? 'SENSITIVE_LOW' : 'CLEAN') };
}

/** 规则源版本（可观测性：报告里带上当前生效的规则集版本） */
function rulesVersion() {
  try {
    return JSON.parse(fs.readFileSync(RULES_SOURCE, 'utf8')).version || 0;
  } catch {
    return null;
  }
}

module.exports = { RULES, RULES_SOURCE, luhnOk, redactText, scanText, rulesVersion };
