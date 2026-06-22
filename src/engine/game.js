// ====================== 游戏引擎：时钟 / 交易 / 计息 / 强平 / 道具 / 结算 ======================
import { Emitter } from '../util.js';
import { Market } from './market.js';
import { Portfolio } from './portfolio.js';
import { AITrader } from './ai.js';
import { FEE_PROFILE, AI_CHAOS, RECESS_RUN, RECESS_REST } from './constants.js';
import { PROPS, rollProp, needsTarget } from './props.js';
import { mulberry32 } from './rng.js';

export class GameEngine {
  // { cfg, seats:[{id,name,isHuman,diff}], asset:{marketKey,name}, seed }
  constructor({ cfg, seats, asset, seed }) {
    this.cfg = cfg;
    this.asset = asset;
    this.seed = seed >>> 0;
    this.rnd = mulberry32((this.seed ^ 0x9e3779b9) >>> 0);
    this.emitter = new Emitter();
    this.tick = 0;
    this.running = false;
    this.ended = false;

    // 增加操作时间：每次刷新的真实秒数（开启则用 opTimeSec，默认 2；否则 1s）
    cfg.tickSec = cfg.opTimeMode ? (cfg.opTimeSec || 2) : 1;

    // 拖条值 = 交易内容（tick 数）；真实时长 = ticks × tickSec（刷新间隔越大越长）
    const n = Math.round(cfg.durationSec);
    this.totalTicks = n;
    this.ticksPerCandle = Math.max(1, Math.round(n / 60));
    this.accrualEvery = Math.max(1, Math.round(cfg.loanAccrualSec / cfg.tickSec));
    this.propEvery = Math.max(1, Math.round(cfg.propIntervalSec / cfg.tickSec));

    // 休市节奏：跑 recessRun 秒、歇 recessRest 秒（可由房主配置）。墙钟总时长按运行/休息比放大
    this.recess = !!cfg.recessMode;
    this.runLen = Math.max(1, Math.round((cfg.recessRun || RECESS_RUN) / cfg.tickSec));
    this.restLen = Math.max(1, Math.round((cfg.recessRest || RECESS_REST) / cfg.tickSec));
    this.wallTick = 0;       // 墙钟 tick（含休市）
    this.resting = false;    // 当前是否处于休市
    this.totalWallTicks = this.recess
      ? Math.round(this.totalTicks * (this.runLen + this.restLen) / this.runLen)
      : this.totalTicks;

    this.market = new Market({ seed: this.seed, marketKey: asset.marketKey, name: asset.name, symbol: asset.symbol, n, ticksPerCandle: this.ticksPerCandle, windowDays: Math.round(n / 3), blind: cfg.blindMode });

    // 开局金钱：按开盘股价模式 = 倍数 × 开盘 1 股价格（标的揭晓后确定）
    if (cfg.cashMode === 'multiple') {
      cfg.initialCash = Math.max(1, Math.round((cfg.cashMultiple || 100) * this.market.startPrice));
    }

    const feeBase = FEE_PROFILE[asset.marketKey];
    const fee = { buy: feeBase.buy * cfg.feeScale, sell: feeBase.sell * cfg.feeScale };
    const loan = { origination: cfg.loanOrigination, accrual: cfg.loanAccrual, maxLeverage: cfg.maxLeverage };

    this.players = seats.map((s) => ({
      id: s.id, name: s.name, isHuman: !!s.isHuman, diff: s.diff || 'normal',
      pf: new Portfolio({ initialCash: cfg.initialCash, fee, loan, maintenanceMargin: cfg.maintenanceMargin }),
      ai: s.isHuman ? null : new AITrader({ chaos: AI_CHAOS[s.diff] ?? AI_CHAOS.normal }),
      props: [],
      insider: null,
      peakNW: cfg.initialCash, maxDD: 0,
    }));
  }

  on(ev, fn) { return this.emitter.on(ev, fn); }
  emit(ev, ...a) { this.emitter.emit(ev, ...a); }
  player(id) { return this.players.find((p) => p.id === id); }
  get price() { return this.market.price; }

  start() {
    if (this.running) return;
    this.running = true;
    this.emit('tick'); // 初始渲染
    this.timer = setInterval(() => this.step(), this.cfg.tickSec * 1000);
  }
  stop() { this.running = false; if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  step() {
    if (!this.running) return;
    this.wallTick++;
    const cycle = this.runLen + this.restLen;
    const isRun = !this.recess || ((this.wallTick - 1) % cycle) < this.runLen;
    this.resting = !isRun;

    // 休市中：行情冻结、暂停交易/AI/计息/发道具，仅墙钟推进
    if (isRun && !this.market.done) this._advanceMarketTick();

    this.emit('tick');
    if (this.wallTick >= this.totalWallTicks) this.finish();
  }

  // 一个「交易 tick」：行情前进一格 + 计息 / 强平 / AI / 道具 / 统计
  _advanceMarketTick() {
    this.market.advance();
    this.tick++;
    const price = this.market.price;

    // 效果到期
    for (const p of this.players) {
      if (p.pf.fx.accrualMultUntil >= 0 && this.tick > p.pf.fx.accrualMultUntil) { p.pf.fx.accrualMult = 1; p.pf.fx.accrualMultUntil = -1; }
      if (p.insider && this.tick > p.insider.expire) p.insider = null;
    }

    // 贷款复利
    if (this.tick % this.accrualEvery === 0) {
      for (const p of this.players) if (p.pf.debt > 0) { p.pf.accrue(); this.emit('fx', { kind: 'accrue', id: p.id }); }
    }

    // 强平检查
    for (const p of this.players) {
      if (p.pf.bankrupt) continue;
      const r = p.pf.checkLiquidation(price);
      if (r.liquidated) this.emit('fx', { kind: 'liquidate', id: p.id, bankrupt: !!r.bankrupt });
      else if (r.shielded) this.emit('fx', { kind: 'shield', id: p.id });
      else if (r.bankrupt) this.emit('fx', { kind: 'bankrupt', id: p.id });
    }

    // AI 决策
    for (const p of this.players) {
      if (!p.ai || p.pf.bankrupt || p.pf.isFrozen(this.tick)) continue;
      const enemies = this.players.filter((q) => q.id !== p.id).map((q) => ({ id: q.id, nw: q.pf.netWorth(price) }));
      const action = p.ai.decide({
        prices: this.market.prices.slice(0, this.market.cursor + 1),
        price, pf: p.pf, rnd: this.rnd, tick: this.tick,
        propMode: this.cfg.propMode, props: p.props, enemies, marketKey: this.asset.marketKey,
      });
      this._applyAction(p, action, { silent: true });
    }

    // 发放道具
    if (this.cfg.propMode && this.tick % this.propEvery === 0) {
      for (const p of this.players) {
        if (p.pf.bankrupt) continue;
        if (p.props.length >= this.cfg.propSlots) p.props.shift();
        const id = rollProp(this.rnd);
        p.props.push(id);
        this.emit('fx', { kind: 'getprop', id: p.id, propId: id });
      }
    }

    // 统计峰值/回撤
    for (const p of this.players) {
      const nw = p.pf.netWorth(price);
      if (nw > p.peakNW) p.peakNW = nw;
      const dd = p.peakNW > 0 ? (p.peakNW - nw) / p.peakNW : 0;
      if (dd > p.maxDD) p.maxDD = dd;
    }
  }

  // ---------- 动作 ----------
  _applyAction(p, action, { silent = false } = {}) {
    if (!action || action.kind === 'none') return { ok: false };
    if (this.resting) return { ok: false, msg: '休市中，暂停交易' };
    if (p.pf.isFrozen(this.tick)) return { ok: false, msg: '交易被冻结' };
    const price = this.market.price;
    let res;
    switch (action.kind) {
      case 'buy': res = p.pf.buy(action.qty, price); break;
      case 'sell': res = p.pf.sell(action.qty, price); break;
      case 'flat': res = p.pf.flatten(price); break;
      case 'loan': res = p.pf.borrow(action.amount, price); break;
      case 'repay': res = p.pf.repay(action.amount); break;
      case 'prop': res = this._useProp(p, action.propId, action.targetId); break;
      default: res = { ok: false, msg: '未知操作' };
    }
    if (res?.ok && !silent) this.emit('fx', { kind: 'trade', id: p.id, action: action.kind });
    if (res?.ok) this.emit('tick');
    return res;
  }

  _useProp(p, propId, targetId) {
    const idx = p.props.indexOf(propId);
    if (idx < 0) return { ok: false, msg: '没有该道具' };
    const def = PROPS[propId];
    if (!def) return { ok: false, msg: '无效道具' };
    if (needsTarget(propId) && !targetId) return { ok: false, msg: '需要选择目标' };
    const target = targetId ? this.player(targetId) : null;
    p.props.splice(idx, 1);
    def.apply(this, p, target);
    this.emit('fx', { kind: 'prop', propId, by: p.id, target: targetId, name: def.name, icon: def.icon });
    return { ok: true };
  }

  giveInsider(p, k) { p.insider = { dirs: this.market.peekDirections(k), expire: this.tick + Math.round(5 / this.cfg.tickSec) }; }
  marketShock(pct) { this.market.applyShock(pct); this.emit('fx', { kind: pct < 0 ? 'crash' : 'pump', pct }); }

  // 外部（UI / 网络）调用的动作入口
  act(playerId, action) { const p = this.player(playerId); return p ? this._applyAction(p, action) : { ok: false }; }

  // ---------- 结算 ----------
  finish() {
    if (this.ended) return;
    this.ended = true;
    this.stop();
    const last = this.market.price;
    const results = this.players.map((p) => {
      const finalCash = p.pf.settle(last);
      return {
        id: p.id, name: p.name, isHuman: p.isHuman, diff: p.diff,
        finalCash, ret: finalCash / this.cfg.initialCash - 1,
        trades: p.pf.trades, borrowed: p.pf.borrowedTotal, maxDD: p.maxDD, bankrupt: p.pf.bankrupt,
      };
    }).sort((a, b) => b.finalCash - a.finalCash || a.maxDD - b.maxDD);
    results.forEach((r, i) => (r.rank = i + 1));
    this.results = results;
    this.emit('end', results);
  }

  // ---------- 状态快照（供 UI / 网络） ----------
  leaderboard() {
    const price = this.market.price;
    return this.players.map((p) => ({ id: p.id, name: p.name, isHuman: p.isHuman, nw: p.pf.netWorth(price), bankrupt: p.pf.bankrupt }))
      .sort((a, b) => b.nw - a.nw);
  }
  publicState() {
    return {
      tick: this.tick, totalTicks: this.totalTicks, cursor: this.market.cursor,
      remainSec: Math.max(0, (this.totalWallTicks - this.wallTick) * this.cfg.tickSec),
      totalSec: this.totalWallTicks * this.cfg.tickSec,
      marketClosed: this.resting,
      initialCash: this.cfg.initialCash,
      prices: this.market.revealedPrices(), ticksPerCandle: this.ticksPerCandle,
      asset: this.cfg.blindMode
        ? { marketKey: this.asset.marketKey, name: '神秘标的' }
        : { marketKey: this.asset.marketKey, name: this.asset.name, symbol: this.asset.symbol, period: this.market.meta ? `${this.market.meta.startDate} ~ ${this.market.meta.endDate}` : undefined, real: this.market.isReal },
      cur: this.market.cur, leaderboard: this.leaderboard(),
    };
  }
  privateState(pid) {
    const p = this.player(pid); if (!p) return null;
    return { ...p.pf.snapshot(this.market.price), props: p.props.slice(), insider: p.insider, frozen: p.pf.isFrozen(this.tick) };
  }
}
