// ====================== AI 操盘手 ======================
// 只看已揭示的历史 tick（不预知未来）。难度通过失误率 chaos 调节。
import { AI_CHAOS } from './constants.js';
import { rollProp, PROPS, needsTarget } from './props.js';

export class AITrader {
  constructor({ chaos = AI_CHAOS.normal } = {}) {
    this.chaos = chaos;
    this.cooldown = 0;            // 行动节流
    this.aggression = 0.5 + (0.3 - chaos) ; // 困难更激进
  }

  roll(rnd) { return rnd() < this.chaos; }

  // 简单均线趋势判断
  trend(prices) {
    const n = prices.length;
    if (n < 8) return 0;
    const shortK = Math.min(6, n), longK = Math.min(20, n);
    const sma = (k) => { let s = 0; for (let i = n - k; i < n; i++) s += prices[i]; return s / k; };
    const ms = sma(shortK), ml = sma(longK);
    return (ms - ml) / ml; // >0 上行
  }

  // 返回一个动作：{kind:'buy'|'sell'|'flat'|'loan'|'prop'|'none', ...}
  decide(ctx) {
    // ctx: { prices, price, pf, rnd, tick, propMode, props, enemies, marketKey }
    const { price, pf, rnd } = ctx;
    if (pf.bankrupt) return { kind: 'none' };
    if (this.cooldown > 0) { this.cooldown--; return { kind: 'none' }; }

    // 道具：有就用（困难更会针对领先者）
    if (ctx.propMode && ctx.props && ctx.props.length && rnd() < 0.5) {
      const id = ctx.props[Math.floor(rnd() * ctx.props.length)];
      const def = PROPS[id];
      if (def) {
        this.cooldown = 2 + Math.floor(rnd() * 3);
        if (needsTarget(id)) {
          const leader = (ctx.enemies || []).slice().sort((a, b) => b.nw - a.nw)[0];
          if (leader) return { kind: 'prop', propId: id, targetId: leader.id };
          return { kind: 'none' };
        }
        return { kind: 'prop', propId: id };
      }
    }

    this.cooldown = 3 + Math.floor(rnd() * 5);
    const t = this.trend(ctx.prices);
    const random = this.roll(rnd);

    // 失误：随机方向
    if (random) {
      const r = rnd();
      if (pf.shares !== 0 && r < 0.4) return { kind: 'flat' };
      if (r < 0.7) { const q = this._sizeBuy(pf, price, 0.3 + rnd() * 0.4); return q > 0 ? { kind: 'buy', qty: q } : { kind: 'none' }; }
      const q = this._sizeShort(pf, price, 0.2 + rnd() * 0.3); return q > 0 ? { kind: 'sell', qty: q } : { kind: 'none' };
    }

    const strongUp = t > 0.004, strongDown = t < -0.004;
    // 多头管理
    if (pf.shares > 0 && strongDown) return { kind: 'flat' };
    if (pf.shares < 0 && strongUp) return { kind: 'flat' };
    if (strongUp && pf.shares <= 0) {
      const q = this._sizeBuy(pf, price, this.aggression);
      return q > 0 ? { kind: 'buy', qty: q } : { kind: 'none' };
    }
    if (strongDown && pf.shares >= 0 && this.chaos <= 0.31) { // 仅普通/困难会做空
      const q = this._sizeShort(pf, price, this.aggression * 0.7);
      return q > 0 ? { kind: 'sell', qty: q } : { kind: 'none' };
    }
    return { kind: 'none' };
  }

  _sizeBuy(pf, price, frac) {
    const max = pf.maxBuyQty(price);
    return Math.floor(max * Math.min(1, frac));
  }
  _sizeShort(pf, price, frac) {
    // 用净值的一部分作为空头敞口
    const nw = pf.netWorth(price);
    const budget = nw * Math.min(0.8, frac);
    return Math.max(0, Math.floor(budget / price));
  }
}
