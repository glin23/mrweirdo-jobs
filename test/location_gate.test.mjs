// restart-apply-2 地点筛（拍板人 A1：全美可搬 + 美国远程）：非美国地点一律拦；
// 查不到的地点不再默认放行；附加地点（Ashby secondaryLocations / 结构化国家）纳入判断。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationVerdict } from '../shared/location_gate.mjs';

const A1 = { geographic_preference: { primary_country: 'US', countries_open_to: ['US'], relocation_policy: 'anywhere_primary_country', remote_acceptable: true, preferred_metros: ['Anywhere US', 'Bay Area', 'San Francisco', 'New York', 'Remote-US'] } };
const v = (job, intent = A1) => locationVerdict(job, intent);

test('非美国地点一律拦（含 BUG_REPORT 漏网的 Almaty / UK / Europe / "UAE " / Munich / Korea / Jerusalem / Burnaby）', () => {
  for (const location of ['Almaty, Kazakhstan', 'United Kingdom', 'UK Remote', 'Europe', 'UAE ', 'Munich', 'Seoul, Korea', 'Jerusalem', 'Burnaby, BC', 'Toronto', 'London', 'Remote - Europe', 'Remote (EMEA)', 'Freiburg', 'Singapore']) {
    const r = v({ location });
    assert.equal(r.ok, false, location);
    assert.match(r.reason, /^location_(mismatch|unrecognized)/, location);
  }
});

test('美国地点放行：城市 / 州 / 国家写法 / 美国远程', () => {
  for (const location of ['Mountain View', 'San Francisco, CA', 'New York City', 'Palo Alto', 'Austin, Texas', 'Remote - US', 'US Remote (EST Timezone Only)', 'United States', 'Los Angeles', 'Seattle, WA', 'Brooklyn, NY', 'Culver City, California']) {
    assert.equal(v({ location }).ok, true, location);
  }
});

test('无国家限定的 Remote：放行（用户接受远程）；但附加地点全是外国时拦', () => {
  assert.equal(v({ location: 'Remote' }).ok, true);
  assert.equal(v({ location: 'Remote', locations: ['Remote', 'London', 'Berlin'] }).ok, false);
  assert.equal(v({ location: 'Remote' }, { geographic_preference: { ...A1.geographic_preference, remote_acceptable: false } }).ok, false);
});

test('附加地点：主地点 London、附加有 New York City → 放行；结构化国家优先于地名', () => {
  assert.equal(v({ location: 'London', locations: ['London', 'New York City', 'Germany'] }).ok, true);
  assert.equal(v({ location: 'Somewhereville', location_countries: ['United States'] }).ok, true);
  assert.equal(v({ location: 'Springfield', location_countries: ['United Kingdom'] }).ok, false);
});

test('查不到的地点：拦并记 location_unrecognized:<原文>，不再默认放行', () => {
  const r = v({ location: 'Xyzzy Town' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'location_unrecognized:Xyzzy Town');
});

test('没写地点：放行（看板常不给地点，交打分与表单）', () => {
  assert.equal(v({ location: '' }).ok, true);
});

test('开了中国的用户：中国城市放行（沿用 countries_open_to CN）', () => {
  const cn = { geographic_preference: { ...A1.geographic_preference, countries_open_to: ['US', 'CN'] } };
  assert.equal(v({ location: 'Shanghai' }, cn).ok, true);
  assert.equal(v({ location: 'Shanghai' }).ok, false);
});

test('易混：Latin America / "Bangalore, IN" / "La Paz" / Venice, Italy 不是美国；"Portland, OR" 是', () => {
  assert.equal(v({ location: 'Remote - Latin America' }).ok, false);
  assert.equal(v({ location: 'Bangalore, IN' }).ok, false);
  assert.equal(v({ location: 'Venice, Italy' }).ok, false);
  assert.equal(v({ location: 'La Paz' }).ok, false);
  assert.equal(v({ location: 'Portland, OR' }).ok, true);
  assert.equal(v({ location: 'Remote - US or Canada' }).ok, true);
});
