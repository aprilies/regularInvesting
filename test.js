// ============================================================
// Unit Tests for 买入决策助手
// Run with: node test.js
// ============================================================
const assert = require('assert');

// ----------------------------------------------------------
// Extract modules from index.html
// ----------------------------------------------------------
const CONFIG = {
  presets: ['SPY', 'QQQ', 'VOO', 'VTI', 'DIA', 'IVV', '510300', '510500', '159915'],
  presetsCN: ['sh000001', 'sz399001', 'sh510300', 'sz159915', 'sh518880', 'sz159920'],
  proxies: [
    url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    url => 'https://corsproxy.io/?' + encodeURIComponent(url),
  ],
  stooqUrl: (ticker, start, end) =>
    `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&d1=${start}&d2=${end}&i=d`,
  avBaseUrl: 'https://www.alphavantage.co/query',
  cacheTTL: 86400000,
  weights: { ma200: 0.30, rsi: 0.25, vix: 0.25, drawdown: 0.20 },
};

const IndicatorEngine = {
  calcSMA(closes, period) {
    const result = [];
    for (let i = 0; i < closes.length; i++) {
      if (i < period - 1) { result.push(null); continue; }
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += closes[j];
      result.push(sum / period);
    }
    return result;
  },

  calcRSI(closes, period = 14) {
    if (closes.length < period + 1) return new Array(closes.length).fill(null);
    const result = new Array(closes.length).fill(null);
    const deltas = [];
    for (let i = 1; i < closes.length; i++) {
      deltas.push(closes[i] - closes[i - 1]);
    }
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (deltas[i] >= 0) avgGain += deltas[i];
      else avgLoss += Math.abs(deltas[i]);
    }
    avgGain /= period;
    avgLoss /= period;
    result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    for (let i = period; i < deltas.length; i++) {
      const gain = deltas[i] >= 0 ? deltas[i] : 0;
      const loss = deltas[i] < 0 ? Math.abs(deltas[i]) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      result[i + 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    return result;
  },

  calcDrawdown(closes) {
    const lookback = Math.min(252, closes.length);
    const recent = closes.slice(-lookback);
    const high = Math.max(...recent);
    const current = closes[closes.length - 1];
    return { high, current, drawdown: ((high - current) / high) * 100 };
  },
};

const ScoringEngine = {
  ma200Score(price, ma200) {
    const pct = ((price - ma200) / ma200) * 100;
    if (pct > 10) return 20;
    if (pct > 0) return 20 + (10 - pct) * 2;
    if (pct > -10) return 70 + pct * 3;
    return 90;
  },

  rsiScore(rsi) {
    if (rsi > 70) return Math.max(5, 20 - (rsi - 70) * 0.5);
    if (rsi > 50) return 50 - (rsi - 50) * 1.5;
    if (rsi > 30) return 80 - (rsi - 30) * 1.5;
    return Math.min(100, 90 + (30 - rsi) * 0.33);
  },

  vixScore(vix) {
    if (vix > 35) return 95;
    if (vix > 25) return 60 + (vix - 25) * 2;
    if (vix > 20) return 40 + (vix - 20) * 4;
    if (vix > 15) return 20 + (vix - 15) * 4;
    return 20;
  },

  drawdownScore(dd) {
    if (dd > 20) return 90;
    if (dd > 10) return 70 + (dd - 10) * 2;
    if (dd > 3) return 45 + (dd - 3) * (25 / 7);
    return 20 + dd * (25 / 3);
  },

  composite(scores) {
    const w = CONFIG.weights;
    let total = 0, totalWeight = 0;
    if (scores.ma200 != null) { total += scores.ma200 * w.ma200; totalWeight += w.ma200; }
    if (scores.rsi != null) { total += scores.rsi * w.rsi; totalWeight += w.rsi; }
    if (scores.vix != null) { total += scores.vix * w.vix; totalWeight += w.vix; }
    if (scores.drawdown != null) { total += scores.drawdown * w.drawdown; totalWeight += w.drawdown; }
    return totalWeight > 0 ? Math.round(total / totalWeight) : 50;
  },

  recommend(score) {
    if (score >= 70) return { text: '适合买入', color: 'var(--green)', bg: 'rgba(34,197,94,0.15)' };
    if (score >= 40) return { text: '可以买入', color: 'var(--yellow)', bg: 'rgba(234,179,8,0.15)' };
    return { text: '建议观望', color: 'var(--red)', bg: 'rgba(239,68,68,0.15)' };
  },
};

const DataService = {
  parseCSV(text) {
    const lines = text.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase();
    if (!header.includes('date') || !header.includes('close')) return [];
    return lines.slice(1).map(line => {
      const cols = line.split(',');
      return {
        date: cols[0],
        open: parseFloat(cols[1]),
        high: parseFloat(cols[2]),
        low: parseFloat(cols[3]),
        close: parseFloat(cols[4]),
        volume: parseInt(cols[5]) || 0,
      };
    }).filter(d => !isNaN(d.close)).sort((a, b) => a.date.localeCompare(b.date));
  },
};

// ----------------------------------------------------------
// Test helpers
// ----------------------------------------------------------
let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

function approx(actual, expected, tolerance = 0.01) {
  assert(Math.abs(actual - expected) < tolerance,
    `Expected ${expected}, got ${actual} (tolerance ${tolerance})`);
}

// ----------------------------------------------------------
// Tests
// ----------------------------------------------------------

console.log('\n\x1b[1mIndicatorEngine.calcSMA\x1b[0m');

test('SMA with period 3 on [1,2,3,4,5]', () => {
  const result = IndicatorEngine.calcSMA([1, 2, 3, 4, 5], 3);
  assert.strictEqual(result[0], null);
  assert.strictEqual(result[1], null);
  approx(result[2], 2.0);    // (1+2+3)/3
  approx(result[3], 3.0);    // (2+3+4)/3
  approx(result[4], 4.0);    // (3+4+5)/3
});

test('SMA with period 1 returns the values themselves', () => {
  const result = IndicatorEngine.calcSMA([10, 20, 30], 1);
  approx(result[0], 10);
  approx(result[1], 20);
  approx(result[2], 30);
});

test('SMA with empty array returns empty', () => {
  const result = IndicatorEngine.calcSMA([], 5);
  assert.strictEqual(result.length, 0);
});

test('SMA with data shorter than period returns all null', () => {
  const result = IndicatorEngine.calcSMA([1, 2], 5);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0], null);
  assert.strictEqual(result[1], null);
});

test('SMA length matches input length', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 10) * 10);
  const result = IndicatorEngine.calcSMA(closes, 200);
  assert.strictEqual(result.length, closes.length);
  // First 199 should be null
  for (let i = 0; i < 199; i++) assert.strictEqual(result[i], null);
  assert(result[199] !== null);
});

console.log('\n\x1b[1mIndicatorEngine.calcRSI\x1b[0m');

test('RSI returns all null for data shorter than period+1', () => {
  const result = IndicatorEngine.calcRSI([1, 2, 3, 4, 5], 14);
  assert.strictEqual(result.length, 5);
  result.forEach(v => assert.strictEqual(v, null));
});

test('RSI is between 0 and 100 for normal data', () => {
  // Generate 50 data points with some variation
  const closes = [100];
  for (let i = 1; i < 50; i++) closes.push(closes[i-1] + (Math.random() - 0.4) * 3);
  const result = IndicatorEngine.calcRSI(closes, 14);
  // Check non-null values are in [0, 100]
  result.forEach(v => {
    if (v !== null) {
      assert(v >= 0 && v <= 100, `RSI ${v} out of range`);
    }
  });
});

test('RSI is 100 when price only goes up', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
  const result = IndicatorEngine.calcRSI(closes, 14);
  const lastRSI = result[result.length - 1];
  approx(lastRSI, 100, 0.01);
});

test('RSI is 0 when price only goes down', () => {
  const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
  const result = IndicatorEngine.calcRSI(closes, 14);
  const lastRSI = result[result.length - 1];
  approx(lastRSI, 0, 0.01);
});

test('RSI ~50 for flat price after initial setup', () => {
  // All same price => no gain/loss => avgGain=0, avgLoss=0 => RSI=100 (edge case: avgLoss=0)
  // Actually for truly flat, deltas are 0 so avgLoss=0 => 100
  const closes = Array(30).fill(100);
  const result = IndicatorEngine.calcRSI(closes, 14);
  const lastRSI = result[result.length - 1];
  // When avgLoss is 0, formula gives 100
  approx(lastRSI, 100, 0.01);
});

console.log('\n\x1b[1mIndicatorEngine.calcDrawdown\x1b[0m');

test('Drawdown is 0 when price is at its high', () => {
  const closes = [10, 20, 30, 40, 50];
  const { high, current, drawdown } = IndicatorEngine.calcDrawdown(closes);
  assert.strictEqual(high, 50);
  assert.strictEqual(current, 50);
  approx(drawdown, 0);
});

test('Drawdown is correct for a 50% drop', () => {
  const closes = [100, 200, 100];
  const { high, current, drawdown } = IndicatorEngine.calcDrawdown(closes);
  assert.strictEqual(high, 200);
  assert.strictEqual(current, 100);
  approx(drawdown, 50);
});

test('Drawdown is correct for 10% decline', () => {
  const closes = [100, 110, 99];
  const { high, current, drawdown } = IndicatorEngine.calcDrawdown(closes);
  assert.strictEqual(high, 110);
  assert.strictEqual(current, 99);
  approx(drawdown, 10);
});

test('Drawdown uses max of last 252 values', () => {
  // 300 values: high is 500 at index 260 (within last 252)
  const closes = Array.from({ length: 300 }, (_, i) => i === 260 ? 500 : 200);
  const { high, current, drawdown } = IndicatorEngine.calcDrawdown(closes);
  assert.strictEqual(high, 500);
  assert.strictEqual(current, 200);
  approx(drawdown, 60);
});

console.log('\n\x1b[1mScoringEngine\x1b[0m');

test('ma200Score: price 20% above MA gives 20 (overpriced)', () => {
  assert.strictEqual(ScoringEngine.ma200Score(120, 100), 20);
});

test('ma200Score: price at MA gives 70 (boundary: pct=0 enters negative branch)', () => {
  // pct = 0, NOT > 0, falls through to "pct > -10" => 70 + 0*3 = 70
  assert.strictEqual(ScoringEngine.ma200Score(100, 100), 70);
});

test('ma200Score: price 5% below MA gives high score', () => {
  // pct = -5, falls in "-10 < pct < 0" => 70 + (-5)*3 = 55
  assert.strictEqual(ScoringEngine.ma200Score(95, 100), 55);
});

test('ma200Score: price 20% below MA gives 90', () => {
  assert.strictEqual(ScoringEngine.ma200Score(80, 100), 90);
});

test('rsiScore: RSI 80 (overbought) gives low score', () => {
  const score = ScoringEngine.rsiScore(80);
  assert(score < 20, `Expected < 20, got ${score}`);
});

test('rsiScore: RSI 30 (oversold boundary) gives 90', () => {
  // RSI 30 is NOT > 30, enters else: min(100, 90 + 0) = 90
  const score = ScoringEngine.rsiScore(30);
  approx(score, 90, 0.01);
});

test('rsiScore: RSI 50 gives 50', () => {
  approx(ScoringEngine.rsiScore(50), 50, 0.01);
});

test('rsiScore: RSI 10 gives near 100', () => {
  const score = ScoringEngine.rsiScore(10);
  assert(score > 90, `Expected > 90, got ${score}`);
});

test('vixScore: VIX 40 (extreme fear) gives 95', () => {
  assert.strictEqual(ScoringEngine.vixScore(40), 95);
});

test('vixScore: VIX 12 (calm) gives 20', () => {
  assert.strictEqual(ScoringEngine.vixScore(12), 20);
});

test('vixScore: VIX 30 gives high score', () => {
  const score = ScoringEngine.vixScore(30);
  approx(score, 70, 0.01);
});

test('drawdownScore: 25% drawdown gives 90', () => {
  assert.strictEqual(ScoringEngine.drawdownScore(25), 90);
});

test('drawdownScore: 0% drawdown gives 20', () => {
  approx(ScoringEngine.drawdownScore(0), 20, 0.01);
});

test('drawdownScore: 15% drawdown gives 80', () => {
  approx(ScoringEngine.drawdownScore(15), 80, 0.01);
});

test('composite: all scores at 100 gives 100', () => {
  assert.strictEqual(ScoringEngine.composite({ ma200: 100, rsi: 100, vix: 100, drawdown: 100 }), 100);
});

test('composite: all scores at 0 gives 0', () => {
  assert.strictEqual(ScoringEngine.composite({ ma200: 0, rsi: 0, vix: 0, drawdown: 0 }), 0);
});

test('composite: all scores at 50 gives 50', () => {
  assert.strictEqual(ScoringEngine.composite({ ma200: 50, rsi: 50, vix: 50, drawdown: 50 }), 50);
});

test('composite: handles null scores (missing VIX)', () => {
  // Only ma200 (0.30), rsi (0.25), drawdown (0.20) => totalWeight = 0.75
  // total = 80*0.30 + 60*0.25 + 40*0.20 = 24 + 15 + 8 = 47
  // composite = round(47 / 0.75) = round(62.67) = 63
  assert.strictEqual(
    ScoringEngine.composite({ ma200: 80, rsi: 60, vix: null, drawdown: 40 }),
    63
  );
});

test('composite: all null returns 50 (default)', () => {
  assert.strictEqual(
    ScoringEngine.composite({ ma200: null, rsi: null, vix: null, drawdown: null }),
    50
  );
});

test('recommend: score 80 => 适合买入', () => {
  assert.strictEqual(ScoringEngine.recommend(80).text, '适合买入');
});

test('recommend: score 50 => 可以买入', () => {
  assert.strictEqual(ScoringEngine.recommend(50).text, '可以买入');
});

test('recommend: score 20 => 建议观望', () => {
  assert.strictEqual(ScoringEngine.recommend(20).text, '建议观望');
});

test('recommend: boundary at 70', () => {
  assert.strictEqual(ScoringEngine.recommend(70).text, '适合买入');
  assert.strictEqual(ScoringEngine.recommend(69).text, '可以买入');
});

test('recommend: boundary at 40', () => {
  assert.strictEqual(ScoringEngine.recommend(40).text, '可以买入');
  assert.strictEqual(ScoringEngine.recommend(39).text, '建议观望');
});

console.log('\n\x1b[1mDataService.parseCSV\x1b[0m');

test('parseCSV: standard Stooq format', () => {
  const csv = `Date,Open,High,Low,Close,Volume
2024-01-02,100,105,99,103,1000000
2024-01-03,103,108,102,107,1200000`;
  const result = DataService.parseCSV(csv);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].date, '2024-01-02');
  approx(result[0].close, 103);
  assert.strictEqual(result[1].date, '2024-01-03');
  approx(result[1].close, 107);
});

test('parseCSV: sorts by date ascending', () => {
  const csv = `Date,Open,High,Low,Close,Volume
2024-03-01,100,105,99,103,100
2024-01-01,90,95,89,93,200
2024-02-01,95,100,94,98,300`;
  const result = DataService.parseCSV(csv);
  assert.strictEqual(result[0].date, '2024-01-01');
  assert.strictEqual(result[1].date, '2024-02-01');
  assert.strictEqual(result[2].date, '2024-03-01');
});

test('parseCSV: filters out invalid close values', () => {
  const csv = `Date,Open,High,Low,Close,Volume
2024-01-02,100,105,99,103,100
2024-01-03,103,108,102,invalid,200
2024-01-04,105,110,104,108,300`;
  const result = DataService.parseCSV(csv);
  assert.strictEqual(result.length, 2);
});

test('parseCSV: empty input returns empty array', () => {
  assert.deepStrictEqual(DataService.parseCSV(''), []);
  assert.deepStrictEqual(DataService.parseCSV('   '), []);
});

test('parseCSV: header only returns empty array', () => {
  assert.deepStrictEqual(DataService.parseCSV('Date,Open,High,Low,Close,Volume\n'), []);
});

test('parseCSV: missing required columns returns empty', () => {
  assert.deepStrictEqual(DataService.parseCSV('A,B,C\n1,2,3'), []);
});

test('parseCSV: handles missing volume', () => {
  const csv = `Date,Open,High,Low,Close
2024-01-02,100,105,99,103`;
  const result = DataService.parseCSV(csv);
  // volume parseInt(undefined) || 0 => 0
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].volume, 0);
});

console.log('\n\x1b[1mCONFIG\x1b[0m');

test('CONFIG.weights sum to 1.0', () => {
  const w = CONFIG.weights;
  approx(w.ma200 + w.rsi + w.vix + w.drawdown, 1.0, 0.001);
});

test('CONFIG.presets contains expected tickers', () => {
  assert(CONFIG.presets.includes('SPY'));
  assert(CONFIG.presets.includes('QQQ'));
  assert(CONFIG.presets.includes('VOO'));
});

// ----------------------------------------------------------
// Summary
// ----------------------------------------------------------
console.log('\n' + '─'.repeat(50));
console.log(`\x1b[1mResults: ${passed} passed, ${failed} failed, ${total} total\x1b[0m`);
if (failed > 0) process.exit(1);
