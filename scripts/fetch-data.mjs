// ====================== 抓取真实历史日 K → public/data/*.json ======================
// 用法:
//   node scripts/fetch-data.mjs            # 抓全部市场
//   node scripts/fetch-data.mjs crypto     # 只抓加密（也可 cn/hk/us）
// 数据源：股票(A股/港股/美股)= Yahoo Finance；加密 = Binance 原生（OKX 兜底）。
// 数据仅作游戏化娱乐用途。
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const YEARS = 5;
const DAY = 86400000;

// 各市场配置：source + [拉取符号, 显示名]
const MARKETS_CFG = {
  cn: { source: 'yahoo', list: [
    ['600519.SS', '贵州茅台'], ['601318.SS', '中国平安'], ['600036.SS', '招商银行'],
    ['000858.SZ', '五粮液'], ['002594.SZ', '比亚迪'], ['300750.SZ', '宁德时代'],
    ['601012.SS', '隆基绿能'], ['600276.SS', '恒瑞医药'], ['000333.SZ', '美的集团'],
    ['601899.SS', '紫金矿业'], ['600900.SS', '长江电力'], ['000001.SZ', '平安银行'],
  ] },
  hk: { source: 'yahoo', list: [
    ['0700.HK', '腾讯控股'], ['9988.HK', '阿里巴巴'], ['3690.HK', '美团'],
    ['1810.HK', '小米集团'], ['1299.HK', '友邦保险'], ['0005.HK', '汇丰控股'],
    ['1024.HK', '快手'], ['2331.HK', '李宁'], ['9618.HK', '京东集团'],
    ['2020.HK', '安踏体育'], ['2269.HK', '药明生物'], ['0388.HK', '香港交易所'],
  ] },
  us: { source: 'yahoo', list: [
    ['AAPL', '苹果'], ['NVDA', '英伟达'], ['TSLA', '特斯拉'], ['MSFT', '微软'],
    ['AMZN', '亚马逊'], ['GOOGL', '谷歌'], ['META', 'Meta'], ['TSM', '台积电'],
    ['NFLX', '奈飞'], ['AMD', 'AMD'], ['COIN', 'Coinbase'], ['SMCI', '超微电脑'],
  ] },
  // 加密：用 Binance 现货 USDT 交易对（OKX 自动兜底）
  crypto: { source: 'binance', list: [
    ['BTCUSDT', '比特币'], ['ETHUSDT', '以太坊'], ['SOLUSDT', '索拉纳'], ['DOGEUSDT', '狗狗币'],
    ['BNBUSDT', '币安币'], ['XRPUSDT', '瑞波币'], ['ADAUSDT', '艾达币'], ['TRXUSDT', '波场'],
    ['AVAXUSDT', '雪崩协议'], ['DOTUSDT', '波卡'], ['LINKUSDT', 'Chainlink'], ['LTCUSDT', '莱特币'],
  ] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x) => { if (x == null || isNaN(x)) return null; const a = Math.abs(x); const d = a >= 100 ? 2 : a >= 1 ? 3 : 6; return Number(x.toFixed(d)); };
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---------- Yahoo（股票） ----------
async function fetchYahoo(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${YEARS}y`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error('yahoo HTTP ' + res.status);
  const j = await res.json();
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error('空数据');
  const t = r.timestamp, q = r.indicators.quote[0];
  const dates = [], candles = [];
  for (let i = 0; i < t.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i], v = q.volume[i];
    if (o == null || h == null || l == null || c == null) continue;
    dates.push(isoDay(t[i] * 1000));
    candles.push([round(o), round(h), round(l), round(c), Math.round(v || 0)]);
  }
  return { dates, candles, via: 'yahoo' };
}

// ---------- Binance（加密，1000 根/请求，分页拿满 5 年） ----------
async function fetchBinance(symbol) {
  let startTime = Date.now() - YEARS * 365 * DAY;
  const dates = [], candles = [];
  for (let guard = 0; guard < 12; guard++) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&startTime=${startTime}&limit=1000`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('binance HTTP ' + res.status);
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const k of arr) {
      const d = isoDay(k[0]);
      if (dates.length && dates[dates.length - 1] === d) continue;
      dates.push(d);
      candles.push([round(+k[1]), round(+k[2]), round(+k[3]), round(+k[4]), Math.round(+k[5])]);
    }
    if (arr.length < 1000) break;
    startTime = arr[arr.length - 1][0] + DAY;
    if (startTime > Date.now()) break;
    await sleep(300);
  }
  return { dates, candles, via: 'binance' };
}

// ---------- OKX（加密兜底，100 根/请求，新→旧分页） ----------
async function fetchOKX(symbol) {
  const instId = symbol.replace('USDT', '-USDT');
  const stop = Date.now() - YEARS * 365 * DAY;
  const rows = []; let after = '';
  for (let guard = 0; guard < 30; guard++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${instId}&bar=1D&limit=100${after ? `&after=${after}` : ''}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error('okx HTTP ' + res.status);
    const j = await res.json();
    const data = j?.data || [];
    if (!data.length) break;
    rows.push(...data);
    const lastTs = +data[data.length - 1][0];
    after = String(lastTs);
    if (lastTs < stop) break;
    await sleep(200);
  }
  rows.sort((a, b) => +a[0] - +b[0]);
  const dates = [], candles = [];
  for (const k of rows) {
    if (+k[0] < stop) continue;
    const d = isoDay(+k[0]);
    if (dates.length && dates[dates.length - 1] === d) continue;
    dates.push(d);
    candles.push([round(+k[1]), round(+k[2]), round(+k[3]), round(+k[4]), Math.round(+k[5])]);
  }
  return { dates, candles, via: 'okx' };
}

async function fetchOne(source, symbol) {
  if (source === 'yahoo') return fetchYahoo(symbol);
  // 加密：Binance 优先，失败转 OKX
  try { return await fetchBinance(symbol); }
  catch (e) { console.log(`    binance 失败(${e.message})，转 OKX…`); return fetchOKX(symbol); }
}

async function run() {
  const arg = process.argv[2];
  const targets = arg && MARKETS_CFG[arg] ? [arg] : Object.keys(MARKETS_CFG);
  await mkdir(OUT_DIR, { recursive: true });
  for (const market of targets) {
    const { source, list } = MARKETS_CFG[market];
    const assets = []; const vias = new Set();
    for (const [symbol, name] of list) {
      try {
        const d = await fetchOne(source, symbol);
        if (d.candles.length < 200) { console.log(`  ! ${market}/${symbol} 数据过少(${d.candles.length})，跳过`); continue; }
        assets.push({ symbol, name, dates: d.dates, candles: d.candles });
        vias.add(d.via);
        console.log(`  ✓ ${market}/${symbol} ${name}  ${d.candles.length}天 ${d.dates[0]}~${d.dates.at(-1)} [${d.via}]`);
      } catch (e) {
        console.log(`  ✗ ${market}/${symbol} ${name}  失败: ${e.message}`);
      }
      await sleep(300);
    }
    const out = { market, source: [...vias].join('+') || source, range: `${YEARS}y`, fetchedAt: isoDay(Date.now()), assets };
    const path = join(OUT_DIR, `${market}.json`);
    await writeFile(path, JSON.stringify(out));
    console.log(`→ 写入 ${path}  (${assets.length} 标的, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB, 源:${out.source})\n`);
  }
  console.log('完成。');
}
run().catch((e) => { console.error(e); process.exit(1); });
