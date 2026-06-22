// ====================== 真实历史行情数据集（public/data/*.json） ======================
// 数据由 scripts/fetch-data.mjs 从 Yahoo Finance 抓取（日 K，5 年）。
// 作为静态资源按需 fetch，不打进主包。加载完成前/失败时，引擎自动回退到合成走势。
import { mulberry32, gaussianFrom } from './rng.js';

const FILES = ['cn', 'hk', 'us', 'crypto'];
const POOLS = {};            // marketKey -> [{ symbol, name, dates, candles }]
let _ready = false;
let _promise = null;

const BASE = (() => { try { return import.meta.env.BASE_URL || '/'; } catch (e) { return '/'; } })();

// 预加载全部市场数据（幂等）。前端可在开局前 await 以确保首局即用真实数据。
export function preloadDatasets() {
  if (_promise) return _promise;
  _promise = Promise.all(FILES.map(async (m) => {
    try {
      const res = await fetch(`${BASE}data/${m}.json`);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      POOLS[m] = Array.isArray(j.assets) ? j.assets : [];
    } catch (e) {
      POOLS[m] = [];
      if (typeof console !== 'undefined') console.warn('[datasets] 加载失败，回退合成数据:', m, e.message);
    }
  })).then(() => { _ready = true; return POOLS; });
  return _promise;
}

export function datasetsReady() { return _ready; }
export function hasRealData(marketKey) { return (POOLS[marketKey] || []).length > 0; }
export function getAssetPool(marketKey) { return POOLS[marketKey] || []; }

// 从勾选市场并集随机挑一个真实标的 → { marketKey, symbol, name }，无可用数据则 null
export function pickRealAsset(markets, rnd = Math.random) {
  const avail = (markets || []).filter((m) => (POOLS[m] || []).length > 0);
  if (!avail.length) return null;
  const mk = avail[Math.floor(rnd() * avail.length)];
  const pool = POOLS[mk];
  const a = pool[Math.floor(rnd() * pool.length)];
  return { marketKey: mk, symbol: a.symbol, name: a.name };
}

// 取某真实标的的随机历史窗口，重采样为 n+1 个逐 tick 价格（日 K 锚点 + 日内插值 + 小幅噪声）。
// 由 seed 完全决定（窗口与噪声），可复现。返回 { prices, vols, meta } 或 null。
export function buildRealPath(marketKey, symbol, seed, n, windowDays) {
  const pool = POOLS[marketKey] || [];
  const asset = pool.find((a) => a.symbol === symbol);
  if (!asset) return null;
  const candles = asset.candles, dates = asset.dates, D = candles.length;
  const W = Math.min(D - 1, windowDays || Math.round(n / 3));
  if (W < 5 || D < W + 2) return null;

  const rnd = mulberry32((seed ^ 0x5bd1e995) >>> 0);
  const g = () => gaussianFrom(rnd);
  const s = Math.floor(rnd() * (D - W - 1));        // 随机起始交易日

  const closes = [], highs = [], lows = [], vols = [];
  for (let k = 0; k <= W; k++) { const c = candles[s + k]; closes.push(c[3]); highs.push(c[1]); lows.push(c[2]); vols.push(c[4]); }

  const prices = [], outVols = [];
  for (let i = 0; i <= n; i++) {
    const f = i * W / n, day = Math.min(W - 1, Math.floor(f)), frac = f - day;
    const base = closes[day] * (1 - frac) + closes[day + 1] * frac;      // 收盘价线性插值
    const amp = Math.max(0.002, (highs[day] - lows[day]) / (closes[day] || 1)); // 当日振幅
    prices.push(base * (1 + g() * amp * 0.16));                          // 叠加逐秒小噪声
    outVols.push(vols[day] || 0);
  }
  prices[0] = closes[0]; prices[n] = closes[W];                          // 端点对齐真实收盘
  return { prices, vols: outVols, meta: { startDate: dates[s], endDate: dates[s + W], symbol, name: asset.name } };
}

// 模块加载即开始预热（前端无需显式调用；导航到开局通常已加载完毕）
preloadDatasets();
