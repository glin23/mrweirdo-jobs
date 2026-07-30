// 第 6 轮验收扣分项③：jobvite/icims 半成品 helpers 的 checkSuccess 里藏着与
// Directive 事故同一句判定——「thank you for your interest」被当成功信号，而
// Directive 失败横幅的原文恰恰含这句（「Thank you for your interest! You have
// already applied…」）。这两个平台是 v0.8 alpha、走带提交门的单 URL 技能，今天
// 不在 -auto 批次里，但毒枝留一天就是一天的定时炸弹（R6-C：一行删除，不用等
// 阶段 4 整体收编）。
//
// helpers 是注入浏览器的 IIFE（window.JobVite = …），Node 里 import 不了。测试
// 从出货源码里把 checkSuccess 的 patterns 数组原样取出来跑——数组是驱动自己的
// 字节，不是这里重打的一份。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = join(ROOT, 'test', 'fixtures', 'submission_pages');
const directiveBanner = readFileSync(join(FIXTURES, 'deny_directive_304.txt'), 'utf8');

function shippedSuccessPatterns(rel) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  const fn = src.slice(src.indexOf('checkSuccess'));
  const m = fn.match(/const patterns = (\[[\s\S]*?\]);/);
  assert.ok(m, `${rel}: checkSuccess patterns array not found — test is stale, fix the extraction`);
  return new Function(`return ${m[1]};`)();
}

for (const rel of ['shared/jobvite_helpers.js', 'shared/icims_helpers.js']) {
  test(`${rel}: Directive 失败横幅（thank you for your interest）不许命中任何成功正则`, () => {
    const patterns = shippedSuccessPatterns(rel);
    assert.ok(patterns.length >= 3, 'patterns array extracted');
    for (const p of patterns) {
      assert.equal(
        p.test(directiveBanner),
        false,
        `${rel}: ${p} matches the Directive failure banner — the exact mechanism behind the six fake successes`
      );
    }
  });

  test(`${rel}: 真成功文案仍然认得（不能把否掉毒枝做成什么都不认）`, () => {
    const patterns = shippedSuccessPatterns(rel);
    for (const text of ['Your application has been submitted.', 'Thank you for applying to Acme.']) {
      assert.ok(patterns.some((p) => p.test(text)), `${rel}: no pattern matches "${text}"`);
    }
  });
}
