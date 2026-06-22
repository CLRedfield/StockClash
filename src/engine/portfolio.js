// ====================== 投资组合：现金 / 多空 / 贷款 / 净值 / 强平 ======================
// 统一记账：shares 为带符号持仓（>0 多头，<0 空头）。
//   买入 q：cash -= q*price + fee；shares += q   （开多 / 平空）
//   卖出 q：cash += q*price - fee；shares -= q   （平多 / 开空）
//   净值  ：cash + shares*price - debt
// 该口径对多空两侧自然成立。

export class Portfolio {
  constructor({ initialCash, fee, loan, maintenanceMargin }) {
    this.cash = initialCash;
    this.initialCash = initialCash;
    this.shares = 0;
    this.avgEntry = 0;       // 当前持仓均价（用于盈亏展示）
    this.debt = 0;           // 未偿贷款（本金 + 已计提利息）
    this.borrowedTotal = 0;  // 累计借入本金（统计用）
    this.realized = 0;       // 已实现盈亏（统计）
    this.trades = 0;         // 成交笔数
    this.bankrupt = false;
    this.fee = fee;                       // { buy, sell }
    this.loan = loan;                     // { origination, accrual, maxLeverage }
    this.maintenanceMargin = maintenanceMargin;
    // 道具临时效果
    this.fx = { feeFreeNext: 0, feeMultNext: 1, shield: 0, frozenUntilTick: -1, accrualMult: 1, accrualMultUntil: -1, leverageBoostNext: 0 };
  }

  netWorth(price) { return this.cash + this.shares * price - this.debt; }
  positionValue(price) { return this.shares * price; }
  exposure(price) { return Math.abs(this.shares) * price; }
  unrealized(price) { return this.shares * (price - this.avgEntry); }
  isFrozen(tick) { return tick <= this.fx.frozenUntilTick; }

  _feeRate(side) {
    let r = side === 'buy' ? this.fee.buy : this.fee.sell;
    if (this.fx.feeFreeNext > 0) return 0;
    return r * (this.fx.feeMultNext || 1);
  }
  _consumeTradeFx() {
    if (this.fx.feeFreeNext > 0) this.fx.feeFreeNext--;
    this.fx.feeMultNext = 1;
  }

  // 买入 q 股（开多或平空）。返回 {ok, msg, fee}
  buy(q, price) {
    q = Math.floor(q);
    if (q <= 0) return { ok: false, msg: '数量无效' };
    const feeRate = this._feeRate('buy');
    const cost = q * price;
    const fee = cost * feeRate;
    if (cost + fee > this.cash + 1e-6) return { ok: false, msg: '现金不足' };
    // 均价：若与当前方向一致（加多 / 加空买回不算加仓）
    if (this.shares >= 0) {
      this.avgEntry = (this.avgEntry * this.shares + price * q) / (this.shares + q);
    } else {
      // 平空：结算这部分已实现盈亏
      const closeQ = Math.min(q, -this.shares);
      this.realized += closeQ * (this.avgEntry - price);
      if (q > -this.shares) this.avgEntry = price; // 反手成多
    }
    this.cash -= cost + fee;
    this.shares += q;
    if (this.shares === 0) this.avgEntry = 0;
    this.trades++; this._consumeTradeFx();
    return { ok: true, fee };
  }

  // 卖出 q 股（平多或开空）
  sell(q, price, { allowShort = true } = {}) {
    q = Math.floor(q);
    if (q <= 0) return { ok: false, msg: '数量无效' };
    if (this.shares <= 0 && !allowShort) return { ok: false, msg: '不可做空' };
    const feeRate = this._feeRate('sell');
    const proceeds = q * price;
    const fee = proceeds * feeRate;
    // 若开空 / 加空，校验保证金
    if (this.shares - q < 0) {
      const newShares = this.shares - q;
      const futureNW = (this.cash + proceeds - fee) + newShares * price - this.debt;
      const exposure = Math.abs(newShares) * price;
      if (futureNW < this.maintenanceMargin * exposure) return { ok: false, msg: '保证金不足，无法做空这么多' };
    }
    if (this.shares > 0) {
      const closeQ = Math.min(q, this.shares);
      this.realized += closeQ * (price - this.avgEntry);
      if (q > this.shares) this.avgEntry = price; // 反手成空
    } else {
      this.avgEntry = (this.avgEntry * (-this.shares) + price * q) / (-this.shares + q);
    }
    this.cash += proceeds - fee;
    this.shares -= q;
    if (this.shares === 0) this.avgEntry = 0;
    this.trades++; this._consumeTradeFx();
    return { ok: true, fee };
  }

  // 一键平仓
  flatten(price) {
    if (this.shares > 0) return this.sell(this.shares, price);
    if (this.shares < 0) return this.buy(-this.shares, price);
    return { ok: false, msg: '无持仓' };
  }

  // 最大可买股数（含手续费，受现金约束）
  maxBuyQty(price) {
    const r = this._feeRate('buy');
    return Math.max(0, Math.floor(this.cash / (price * (1 + r))));
  }

  // 借款
  borrow(amount, price) {
    amount = Math.floor(amount);
    if (amount <= 0) return { ok: false, msg: '金额无效' };
    if (this.debt > 1e-6) return { ok: false, msg: '欠债时不能再贷款' };
    const cap = this.netWorth(price) * (this.loan.maxLeverage + (this.fx.leverageBoostNext || 0));
    if (amount > cap) return { ok: false, msg: `超出杠杆上限（最多可借 ${Math.floor(cap)}）` };
    const orig = this.fx.leverageBoostNext > 0 ? 0 : this.loan.origination; // 抄底券免起始利息
    this.cash += amount;
    this.debt += amount * (1 + orig);   // 放款即计起始利息
    this.borrowedTotal += amount;
    this.fx.leverageBoostNext = 0;
    return { ok: true };
  }

  // 还款
  repay(amount) {
    amount = Math.floor(amount);
    if (this.debt <= 0) return { ok: false, msg: '无欠款' };
    const amt = Math.min(amount, this.debt, this.cash);
    if (amt <= 0) return { ok: false, msg: '现金不足' };
    this.cash -= amt; this.debt -= amt;
    if (this.debt < 1) this.debt = 0;
    return { ok: true, paid: amt };
  }

  // 周期复利（每 loanAccrualSec 秒调用一次）
  accrue() {
    if (this.debt <= 0) return;
    const rate = this.loan.accrual * (this.fx.accrualMult || 1);
    this.debt *= (1 + rate);
  }

  // 强平检查：保证金不足 → 平仓；净值 ≤ 0 → 破产
  checkLiquidation(price) {
    const nw = this.netWorth(price);
    if (this.shares !== 0) {
      const exposure = this.exposure(price);
      if (nw < this.maintenanceMargin * exposure || nw <= 0) {
        if (this.fx.shield > 0) { this.fx.shield--; return { liquidated: false, shielded: true }; }
        this.flatten(price);
        const after = this.netWorth(price);
        if (after <= 0) { this.bankrupt = true; return { liquidated: true, bankrupt: true }; }
        return { liquidated: true };
      }
    } else if (nw <= 0) {
      this.bankrupt = true; return { liquidated: false, bankrupt: true };
    }
    return { liquidated: false };
  }

  // 结算：按最后价格强平 + 扣贷款本息
  settle(price) {
    this.flatten(price);
    this.cash -= this.debt; this.debt = 0;
    return this.cash;
  }

  snapshot(price) {
    return {
      cash: this.cash, shares: this.shares, avgEntry: this.avgEntry, debt: this.debt,
      netWorth: this.netWorth(price), unrealized: this.unrealized(price),
      bankrupt: this.bankrupt, trades: this.trades,
      shield: this.fx.shield, feeFree: this.fx.feeFreeNext,
    };
  }
}
