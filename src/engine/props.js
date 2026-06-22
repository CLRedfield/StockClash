// ====================== 道具系统 ======================
// 每个道具：{ id, name, icon, type, rarity, target, desc, apply(game, user, targetPlayer) }
// type: self(自用) | info(信息) | pvp(搅局)。target: 'self' | 'enemy' | 'all'
//   target === 'enemy' → 使用时需手动选目标；其余即时生效。
import { pickRandom } from '../util.js';

// 当前价格下，按「持仓市值」给某玩家施加 pct 变动（对多/空恒为正确方向）。空仓无效。
function adjustPositionValue(p, g, pct) {
  const price = g.market.price;
  const posVal = Math.abs(p.pf.shares) * price;
  if (posVal <= 0) return false;
  p.pf.cash += posVal * pct;   // 净值随之变动 posVal×pct（多头亏/赚、空头同向）
  return true;
}
// 非破产玩家按净值排序（高→低）
function rankByNet(g) {
  const price = g.market.price;
  return g.players.filter((p) => !p.pf.bankrupt).slice().sort((a, b) => b.pf.netWorth(price) - a.pf.netWorth(price));
}
// 「股票跑 N 个交易日」对应的 tick 数（windowDays 个交易日铺在 totalTicks 个 tick 上）
function ticksForTradingDays(g, days) {
  const wd = (g.market.cfg && g.market.cfg.windowDays) || Math.round(g.totalTicks / 3);
  const tpd = g.totalTicks / Math.max(1, wd);
  return Math.max(1, Math.round(days * tpd));
}

export const PROPS = {
  feefree:   { id: 'feefree', name: '免单券', icon: '🎟️', type: 'self', target: 'self', rarity: 'common',
    desc: '下一笔交易免手续费', apply: (g, u) => { u.pf.fx.feeFreeNext += 1; } },
  shield:    { id: 'shield', name: '止损盾', icon: '🛡️', type: 'self', target: 'self', rarity: 'rare',
    desc: '抵消下一次爆仓 / 强平', apply: (g, u) => { u.pf.fx.shield += 1; } },
  freeze_loan:{ id: 'freeze_loan', name: '债务减免', icon: '❄️', type: 'self', target: 'self', rarity: 'rare',
    desc: '自己的欠债立即减少 2%（无欠债则无效）', apply: (g, u) => { if (u.pf.debt > 0) u.pf.debt *= 0.98; } },
  dip_ticket:{ id: 'dip_ticket', name: '抄底券', icon: '💎', type: 'self', target: 'self', rarity: 'epic',
    desc: '下一次贷款杠杆 +1 倍且免起始利息', apply: (g, u) => { u.pf.fx.leverageBoostNext = 1; } },
  insider:   { id: 'insider', name: '内幕消息', icon: '🕵️', type: 'info', target: 'self', rarity: 'rare',
    desc: '查看未来 3 个 tick 的涨跌方向', apply: (g, u) => { g.giveInsider(u, 3); } },
  crash:     { id: 'crash', name: '黑天鹅', icon: '🦢', type: 'pvp', target: 'all', rarity: 'epic',
    desc: '触发一次全场砸盘（约 -6%）', apply: (g) => { g.marketShock(-0.06); } },
  pump:      { id: 'pump', name: '利好突袭', icon: '🚀', type: 'pvp', target: 'all', rarity: 'epic',
    desc: '触发一次全场拉升（约 +6%）', apply: (g) => { g.marketShock(0.06); } },
  rate_hike: { id: 'rate_hike', name: '加息冲击', icon: '📈', type: 'pvp', target: 'enemy', rarity: 'rare',
    desc: '指定对手的欠债立即增加 2%（无欠债则无效）', apply: (g, u, t) => { if (t && t.pf.debt > 0) t.pf.debt *= 1.02; } },
  freeze:    { id: 'freeze', name: '冻结交易', icon: '🧊', type: 'pvp', target: 'enemy', rarity: 'rare',
    desc: '指定对手相当于股票跑 2.5 个交易日无法下单',
    apply: (g, u, t) => { if (t) t.pf.fx.frozenUntilTick = g.tick + ticksForTradingDays(g, 2.5); } },
  tax:       { id: 'tax', name: '抽佣', icon: '💸', type: 'pvp', target: 'enemy', rarity: 'common',
    desc: '对手下一笔手续费翻倍', apply: (g, u, t) => { if (t) t.pf.fx.feeMultNext = 2; } },
  // —— 史诗：劫富济贫（自动锁定当前首富/垫底，无需选目标） ——
  tycoon_cut:{ id: 'tycoon_cut', name: '劫富', icon: '⚡', type: 'pvp', target: 'self', rarity: 'epic',
    desc: '当前钱最多的玩家：持仓市值立即 −5%（其空仓则无效）',
    apply: (g) => { const r = rankByNet(g); if (r.length) adjustPositionValue(r[0], g, -0.05); } },
  poor_aid:  { id: 'poor_aid', name: '济贫', icon: '🤝', type: 'pvp', target: 'self', rarity: 'epic',
    desc: '当前钱最少的玩家：持仓市值立即 +5%（其空仓则无效）',
    apply: (g) => { const r = rankByNet(g); if (r.length) adjustPositionValue(r[r.length - 1], g, 0.05); } },
};

export const PROP_IDS = Object.keys(PROPS);
const RARITY_WEIGHT = { common: 60, rare: 30, epic: 10 };

// 抽一个道具 id（按稀有度加权随机）
export function rollProp(rnd = Math.random) {
  const pool = [];
  for (const id of PROP_IDS) for (let i = 0; i < RARITY_WEIGHT[PROPS[id].rarity]; i++) pool.push(id);
  return pool[Math.floor(rnd() * pool.length)];
}

export const needsTarget = (id) => PROPS[id]?.target === 'enemy';
