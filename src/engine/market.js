// ====================== 行情系统：真实感合成走势 + 逐 tick 揭示 ======================
// 说明：当前版本用「按市场波动率标定的随机过程」合成逐 tick 价格，
// 走势具备趋势、波动聚集、偶发跳空等真实特征。架构上 series 由
// (种子, 市场, 长度) 完全决定，可无缝替换为「打包真实历史 K 线」的数据源。
import { mulberry32, gaussianFrom, randSeed } from './rng.js';
import { MARKETS, TICKER_POOL, TYCOON_BIAS_MAX } from './constants.js';
import { pickRandom } from '../util.js';
import { pickRealAsset, buildRealPath } from './datasets.js';

// 生成长度为 n+1 的逐 tick 价格序列与成交量
export function generateSeries(seed, marketKey, n) {
  const p = MARKETS[marketKey];
  const rnd = mulberry32(seed);
  const g = () => gaussianFrom(rnd);

  let price = p.base * (0.6 + rnd() * 0.9);       // 随机起始价
  let logVol = Math.log(p.tickVol);
  let drift = p.drift * (rnd() * 2 - 1);          // 本局趋势偏向
  const seg = Math.max(20, Math.floor(n / 4));    // 趋势分段

  const prices = [price];
  const vols = [0];
  for (let i = 1; i <= n; i++) {
    if (i % seg === 0) drift = p.drift * (rnd() * 2 - 1) * 1.8; // 阶段性切换趋势
    // 波动聚集：对数波动率均值回归
    logVol += 0.12 * (Math.log(p.tickVol) - logVol) + 0.09 * g();
    const vol = Math.exp(logVol);
    let ret = drift + vol * g();
    if (rnd() < 0.012) ret += (rnd() < 0.5 ? -1 : 1) * vol * 6; // 偶发跳空
    // A股涨跌停（按 tick 近似限制单步幅度）
    if (p.hasLimit) ret = Math.max(-p.limit / 6, Math.min(p.limit / 6, ret));
    price *= Math.exp(ret);
    if (price < p.base * 0.04) price = p.base * 0.04;
    prices.push(price);
    vols.push(Math.abs(ret) * 8000 + 2000 + rnd() * 4000);
  }
  return { prices, vols };
}

// 把逐 tick 价格聚合成蜡烛（每 tpc 个 tick 一根）
export function buildCandles(prices, vols, tpc, upTo) {
  const candles = [];
  const last = upTo == null ? prices.length - 1 : upTo;
  for (let start = 0; start <= last; start += tpc) {
    const end = Math.min(start + tpc, last);
    if (end <= start && start !== 0) break;
    let o = prices[start], c = prices[end], h = -Infinity, l = Infinity, v = 0;
    for (let i = start; i <= end; i++) { h = Math.max(h, prices[i]); l = Math.min(l, prices[i]); v += vols[i] || 0; }
    candles.push({ o, h, l, c, v, done: end >= start + tpc });
  }
  return candles;
}

export class Market {
  // cfg: { seed, marketKey, name, symbol, n, ticksPerCandle, windowDays, blind }
  constructor(cfg) {
    this.cfg = cfg;
    this.profile = MARKETS[cfg.marketKey];
    this.cur = this.profile.cur;
    this.n = cfg.n;
    this.ticksPerCandle = cfg.ticksPerCandle;
    this.cursor = 0; // 已揭示到的 tick 下标
    this.meta = null;
    // 优先用真实历史行情；数据未就绪/无对应标的时回退合成走势
    let real = null;
    if (cfg.symbol) real = buildRealPath(cfg.marketKey, cfg.symbol, cfg.seed, cfg.n, cfg.windowDays);
    if (real) { this.prices = real.prices; this.vols = real.vols; this.meta = real.meta; this.isReal = true; }
    else { const s = generateSeries(cfg.seed, cfg.marketKey, cfg.n); this.prices = s.prices; this.vols = s.vols; this.isReal = false; }

    // 懂王模式：在原有走势上叠加房主实时控盘的「额外趋势」（持续生效）+ 一次性冲击
    this.tycoon = !!cfg.tycoon;
    this.bias = 0;        // 当前额外趋势（每根 K 线，持续生效，直到房主改动）
    this.oneShot = 0;     // 一次性冲击（黑天鹅 / 利好道具，叠加到下一根）
    if (this.tycoon) { this.livePrice = this.prices[0]; this.livePrices = [this.prices[0]]; }
  }

  get price() { return this.tycoon ? this.livePrice : this.prices[this.cursor]; }
  get startPrice() { return this.prices[0]; }
  get changePct() { return this.price / this.startPrice - 1; }
  get done() { return this.cursor >= this.n; }

  advance() {
    if (this.cursor >= this.n) return this.price;
    this.cursor++;
    if (this.tycoon) this._advanceLive();
    return this.price;
  }

  // 懂王控盘：本根涨跌 = 原走势涨跌(natRet) + 房主额外趋势(bias) + 一次性冲击(oneShot)
  _advanceLive() {
    const i = this.cursor;
    const natRet = this.prices[i] / this.prices[i - 1] - 1;
    const ret = natRet + this.bias + this.oneShot;
    this.oneShot = 0;
    let next = this.livePrice * (1 + ret);
    const floor = this.prices[0] * 1e-4, cap = this.prices[0] * 1e9;
    if (!isFinite(next) || next > cap) next = cap;
    if (next < floor) next = floor;
    this.livePrice = next;
    this.livePrices.push(next);
  }

  // 设置房主额外趋势（持续生效），范围 ±TYCOON_BIAS_MAX
  setBias(pct) { this.bias = Math.max(-TYCOON_BIAS_MAX, Math.min(TYCOON_BIAS_MAX, pct || 0)); return this.bias; }

  // 全场价格冲击：缩放剩余路径（道具：黑天鹅 / 利好突袭）。懂王模式下改为叠加到下一根。
  applyShock(pct) {
    if (this.tycoon) { this.oneShot += pct; return; }
    const f = 1 + pct;
    for (let i = this.cursor + 1; i < this.prices.length; i++) this.prices[i] *= f;
  }

  // 未来 k 个 tick 的涨跌方向（道具：内幕消息；房主权威下由房主计算后单独下发）
  peekDirections(k) {
    const out = [];
    for (let i = 1; i <= k; i++) {
      const a = this.prices[this.cursor + i - 1], b = this.prices[this.cursor + i];
      if (b == null) break;
      out.push(b > a ? 1 : (b < a ? -1 : 0));
    }
    return out;
  }

  revealedCandles() {
    if (this.tycoon) return buildCandles(this.livePrices, this.vols, this.ticksPerCandle, this.livePrices.length - 1);
    return buildCandles(this.prices, this.vols, this.ticksPerCandle, this.cursor);
  }

  // 供网络同步：只暴露已揭示的价格（懂王模式用实时生成的 livePrices）
  revealedPrices() { return this.tycoon ? this.livePrices.slice() : this.prices.slice(0, this.cursor + 1); }
}

// 随机挑一个标的（优先真实数据，回退合成）
export function pickAsset(markets) {
  const real = pickRealAsset(markets);
  if (real) return real;
  const mk = pickRandom(markets);
  const name = pickRandom(TICKER_POOL[mk]);
  return { marketKey: mk, name };
}

export { randSeed };
