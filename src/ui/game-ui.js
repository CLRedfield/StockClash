// ====================== 交易主界面（经典终端布局） ======================
import { el, clear } from './dom.js';
import { toast, openOverlay, promptNumber } from './prompts.js';
import { icon } from './icons.js';
import { CandleChart } from './chart.js';
import { fmtPrice, fmtMoney, fmtCompact, fmtPct } from './format.js';
import { MARKETS } from '../engine/constants.js';
import { PROPS, needsTarget } from '../engine/props.js';
import { badge, statTile, priceTag, countdown, leaderboardRow } from './components.js';

// 道具 → 设计系统类别 + Lucide 图标（不再用 emoji）
const PROP_META = {
  feefree:    { cat: 'buff', color: 'var(--price-up)',   ico: 'ticket' },
  shield:     { cat: 'buff', color: 'var(--price-up)',   ico: 'shield' },
  freeze_loan:{ cat: 'buff', color: 'var(--price-up)',   ico: 'snowflake' },
  dip_ticket: { cat: 'buff', color: 'var(--price-up)',   ico: 'anchor' },
  insider:    { cat: 'info', color: 'var(--info-500)',   ico: 'eye' },
  crash:      { cat: 'pvp',  color: 'var(--price-down)', ico: 'bird' },
  pump:       { cat: 'pvp',  color: 'var(--price-down)', ico: 'rocket' },
  rate_hike:  { cat: 'pvp',  color: 'var(--price-down)', ico: 'trending-up' },
  freeze:     { cat: 'pvp',  color: 'var(--price-down)', ico: 'lock' },
  tax:        { cat: 'pvp',  color: 'var(--price-down)', ico: 'scissors' },
  tycoon_cut: { cat: 'pvp',  color: 'var(--price-down)', ico: 'zap' },
  poor_aid:   { cat: 'buff', color: 'var(--price-up)',   ico: 'hand-coins' },
};

// 本地引擎控制器（房主端 / 单机端复用）
export class LocalController {
  constructor(engine, myId, { spectator = false } = {}) {
    this.engine = engine; this.myId = myId; this.spectator = spectator; this.cfg = engine.cfg;
  }
  on(ev, fn) { return this.engine.on(ev, fn); }
  public() { return this.engine.publicState(); }
  private() { return this.engine.privateState(this.myId); }
  players() { return this.engine.players.map((p) => ({ id: p.id, name: p.name })); }
  act(action) { if (this.spectator) return { ok: false, msg: '观战中无法操作' }; return this.engine.act(this.myId, action); }
}

export class GameUI {
  constructor(ctrl, { onEnd } = {}) {
    this.ctrl = ctrl; this.onEnd = onEnd;
    this.cfg = ctrl.cfg;
    this.qty = 0;
    this.cur = '';
    this._assetSet = false;
    this.chart = new CandleChart({ colorUp: this.cfg.colorUp });
    this._unsubs = [];
    this._build();
    this._unsubs.push(ctrl.on('tick', () => this.render()));
    this._unsubs.push(ctrl.on('fx', (e) => this._fx(e)));
    this._unsubs.push(ctrl.on('end', (r) => { this.onEnd?.(r); }));
  }

  mountInto(parent) { clear(parent).appendChild(this.root); this.chart._resize(); this.render(); }
  destroy() { this._unsubs.forEach((u) => { try { u(); } catch (e) {} }); this.chart.destroy(); }

  _build() {
    this.root = el('div', { class: 'sc-screen game-screen' });
    const wrap = el('div', { class: 'game-wrap' });

    // ---- 顶栏 ----
    this.elMkBadge = badge('', 'neutral');
    this.elTitle = el('span', { class: 'in-title' });
    this.elSub = el('span', { class: 'in-sub' });
    this.priceTag = priceTag({ size: 'lg' });
    this.elInsider = el('div', { class: 'insider', style: { display: 'none' } });
    this.countdown = countdown({ size: 'md' });
    this.elClosed = badge('休市中', 'warn', { dot: true });
    this.elClosed.style.display = 'none';
    const top = el('div', { class: 'game-top' }, [
      el('div', { class: 'gt-left' }, [
        el('div', { class: 'instrument' }, [
          el('div', { class: 'in-name' }, [this.elTitle, this.elMkBadge]),
          this.elSub,
        ]),
        this.priceTag.wrap,
        this.elInsider,
      ]),
      el('div', { class: 'gt-right' }, [this.elClosed, this.countdown.wrap]),
    ]);

    // ---- 主体：左（图+HUD+操作） / 右（排行+道具） ----
    const chartCard = el('div', { class: 'card chart-card' }, [el('div', { class: 'card-body' }, [this.chart.root])]);

    this.stCash = statTile('现金');
    this.stPos = statTile('持仓');
    this.stDebt = statTile('负债');
    this.stNW = statTile('净值', { emphasis: true });
    const hudCard = el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [
      el('div', { class: 'hud' }, [this.stCash.wrap, this.stPos.wrap, this.stDebt.wrap, this.stNW.wrap]),
    ])]);

    // 交易面板
    this.stepperWrap = this._buildQty();
    this.btnBuy = el('button', { class: 'btn btn-up lg', onclick: () => this._buy() }, [icon('trending-up', { size: 17 }), this._span('buyTxt', '买入 / 做多')]);
    this.btnSell = el('button', { class: 'btn btn-down lg', onclick: () => this._sell() }, [icon('trending-down', { size: 17 }), this._span('sellTxt', '卖出 / 做空')]);
    this.btnFlat = el('button', { class: 'btn btn-secondary', onclick: () => this._do({ kind: 'flat' }) }, [document.createTextNode('一键平仓')]);
    this.btnRepay = el('button', { class: 'btn btn-ghost outline', onclick: () => this._repay() }, [icon('undo-2', { size: 16 }), document.createTextNode('还款')]);
    this.btnLoan = el('button', { class: 'btn btn-ghost outline loan-tall', onclick: () => this._loan() }, [icon('hand-coins', { size: 20 }), el('span', { text: '借款' })]);

    // 快捷操作：竖排定额买/卖
    this._quickBtns = [];
    this.quickPanel = el('div', { class: 'quick-panel' });
    this.quickPanel.style.display = 'none';
    [10, 50, 100, 500, 1000].forEach((amt) => {
      const buy = el('button', { class: 'btn btn-up sm qa-btn', onclick: () => this._do({ kind: 'buy', qty: amt }) }, [document.createTextNode('买 ' + amt)]);
      const sell = el('button', { class: 'btn btn-down sm qa-btn', onclick: () => this._do({ kind: 'sell', qty: amt }) }, [document.createTextNode('卖 ' + amt)]);
      this._quickBtns.push(buy, sell);
      this.quickPanel.appendChild(el('div', { class: 'quick-row' }, [buy, sell]));
    });
    // 最底部：全买 / 全卖
    const buyAll = el('button', { class: 'btn btn-up sm qa-btn', onclick: () => this._buyAll() }, [document.createTextNode('全买')]);
    const sellAll = el('button', { class: 'btn btn-down sm qa-btn', onclick: () => this._sellAll() }, [document.createTextNode('全卖')]);
    this._quickBtns.push(buyAll, sellAll);
    this.quickPanel.appendChild(el('div', { class: 'quick-row quick-all' }, [buyAll, sellAll]));
    this.btnQuick = el('button', { class: 'btn btn-secondary quick-toggle', onclick: () => this._toggleQuick() }, [
      icon('zap', { size: 16 }), document.createTextNode('快捷操作'), el('span', { class: 'qchev', text: '▾' }),
    ]);

    const taMain = el('div', { class: 'ta-main' }, [
      el('div', { class: 'ta-top' }, [this.stepperWrap, this._quickPct()]),
      el('div', { class: 'ta-grid' }, [this.btnBuy, this.btnSell]),
      this.btnQuick,
      this.quickPanel,
      el('div', { class: 'ta-grid' }, [this.btnFlat, this.btnRepay]),
      el('div', { class: 'trade-hint', text: '买入＝做多 / 平空　卖出＝做空 / 平多' }),
    ]);
    const taLoan = el('div', { class: 'ta-loan' }, [this.btnLoan]);
    const tradeCard = el('div', { class: 'card' }, [el('div', { class: 'card-body' }, [
      el('div', { class: 'trade-actions' }, [taMain, taLoan]),
    ])]);

    const leftCol = el('div', { class: 'game-col left' }, [chartCard, hudCard, tradeCard]);

    // 右栏
    this.elBoard = el('div', { class: 'board-list' });
    const boardCard = el('div', { class: 'card' }, [el('div', { class: 'card-body tight' }, [
      el('div', { class: 'board' }, [
        el('div', { class: 'board-head' }, [el('span', { class: 'eyebrow', text: '实时排行榜' }), icon('trophy', { size: 14 })]),
        this.elBoard,
      ]),
    ])]);
    this.elProps = el('div', { class: 'propbar' });
    this.propsCard = el('div', { class: 'card' }, [el('div', { class: 'card-body tight' }, [this.elProps])]);
    if (!this.cfg.propMode) this.propsCard.style.display = 'none';
    const rightCol = el('div', { class: 'game-col right' }, [boardCard, this.propsCard]);

    wrap.appendChild(top);
    wrap.appendChild(el('div', { class: 'game-main' }, [leftCol, rightCol]));
    this.root.appendChild(wrap);
  }

  _span(key, text) { const s = el('span', { text }); this['_' + key] = s; return s; }

  _buildQty() {
    // 数字输入 + ± 步进
    this.elQty = el('input', { class: 'val', type: 'number', min: '0', value: '0',
      oninput: (e) => { this.qty = Math.max(0, Math.floor(Number(e.target.value) || 0)); } });
    const dec = el('button', { class: 'minus', text: '−', onclick: () => this._setQty(this.qty - 10) });
    const inc = el('button', { class: 'plus', text: '+', onclick: () => this._setQty(this.qty + 10) });
    return el('div', { class: 'stepper' }, [dec,
      el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } }, [this.elQty, el('span', { class: 'unit', text: '股' })]),
      inc]);
  }
  _quickPct() {
    const mk = (label, pct) => el('button', { onclick: () => this._fillPct(pct) }, [document.createTextNode(label)]);
    return el('div', { class: 'segmented sm' }, [mk('25%', 0.25), mk('50%', 0.5), mk('最大', 1)]);
  }
  _toggleQuick() {
    this.quickOpen = !this.quickOpen;
    this.quickPanel.style.display = this.quickOpen ? '' : 'none';
    this.btnQuick.classList.toggle('active', this.quickOpen);
  }

  // ---------- 操作 ----------
  _setQty(q) { this.qty = Math.max(0, Math.floor(q)); this.elQty.value = String(this.qty); }
  _fillPct(pct) {
    const pub = this.ctrl.public(); const pv = this.ctrl.private(); if (!pv || !pub) return;
    const price = pub.prices[pub.prices.length - 1];
    const max = Math.floor(pv.cash / (price * 1.002));
    this._setQty(Math.floor(max * pct));
  }
  _do(action) { const r = this.ctrl.act(action); if (r && !r.ok && r.msg) toast(r.msg, 'error'); else if (r && r.ok) this.render(); return r; }
  _buy() { if (this.qty <= 0) return toast('请输入股数', 'error'); this._do({ kind: 'buy', qty: this.qty }); }
  _sell() { if (this.qty <= 0) return toast('请输入股数', 'error'); this._do({ kind: 'sell', qty: this.qty }); }
  _buyAll() {
    const pub = this.ctrl.public(); const pv = this.ctrl.private(); if (!pub || !pv) return;
    const price = pub.prices[pub.prices.length - 1];
    const qty = Math.floor(pv.cash / (price * 1.002));
    if (qty <= 0) return toast('现金不足，无法买入', 'error');
    this._do({ kind: 'buy', qty });
  }
  _sellAll() {
    const pub = this.ctrl.public(); const pv = this.ctrl.private(); if (!pub || !pv) return;
    const price = pub.prices[pub.prices.length - 1];
    // 先清掉多头，再用现金等额做空（约 1× 敞口，避免过度杠杆被拒）
    const longPart = pv.shares > 0 ? pv.shares : 0;
    const qty = longPart + Math.floor(pv.cash / (price * 1.002));
    if (qty <= 0) return toast('无可卖数量', 'error');
    this._do({ kind: 'sell', qty });
  }
  async _loan() {
    const pv = this.ctrl.private(); if (!pv) return;
    if (pv.debt > 0) return toast('欠债时不能再贷款', 'error');
    const v = await promptNumber({ title: '贷款', label: `当前净值 ${fmtMoney(pv.netWorth, '¥')}，最多可借 ${fmtMoney(Math.floor(pv.netWorth * this.cfg.maxLeverage), '¥')}`, value: Math.floor(pv.netWorth), min: 0, hint: `放款即计 +${(this.cfg.loanOrigination * 100).toFixed(0)}%，每 ${this.cfg.loanAccrualSec}s 复利 +${(this.cfg.loanAccrual * 100).toFixed(0)}%` });
    if (v) this._do({ kind: 'loan', amount: v });
  }
  async _repay() {
    const pv = this.ctrl.private(); if (!pv) return;
    if (pv.debt <= 0) return toast('当前无欠款', 'info');
    const v = await promptNumber({ title: '还款', label: `欠款 ${fmtMoney(pv.debt, '¥')}，现金 ${fmtMoney(pv.cash, '¥')}`, value: Math.min(Math.floor(pv.debt), Math.floor(pv.cash)), min: 0 });
    if (v) this._do({ kind: 'repay', amount: v });
  }
  _useProp(propId) {
    if (needsTarget(propId)) {
      const others = this.ctrl.players().filter((p) => p.id !== this.ctrl.myId);
      const body = el('div', { class: 'target-list' }, others.map((p) => el('button', { class: 'btn btn-secondary', text: p.name,
        onclick: () => { ov.close(); this._do({ kind: 'prop', propId, targetId: p.id }); } })));
      const ov = openOverlay({ title: `对谁使用「${PROPS[propId].name}」？`, bodyNode: body, closable: true, tone: 'danger', buttons: [{ label: '取消', onClick: () => ov.close() }] });
    } else {
      this._do({ kind: 'prop', propId });
    }
  }

  // ---------- 渲染 ----------
  render() {
    const pub = this.ctrl.public(); if (!pub) return;
    this.cur = pub.cur;
    const prices = pub.prices; const price = prices[prices.length - 1];

    // 顶栏标的（仅首次设定，局内不变）
    if (!this._assetSet) {
      const mk = MARKETS[pub.asset.marketKey] || { name: '', key: 'cn' };
      this.elMkBadge.className = 'badge ' + (this.cfg.blindMode ? 'warn' : pub.asset.marketKey);
      this.elMkBadge.textContent = this.cfg.blindMode ? '盲盒' : mk.name;
      this.elTitle.textContent = this.cfg.blindMode ? '神秘标的' : pub.asset.name;
      this.elSub.textContent = this.cfg.blindMode ? '标的与日期隐藏 · 加速回放' : `${mk.name} · 逐秒加速回放`;
      this._assetSet = true;
    }

    // 价格与涨跌（相对开局）
    const ret0 = prices.length > 1 ? price / prices[0] - 1 : 0;
    const dir = ret0 > 0 ? 'up' : ret0 < 0 ? 'down' : 'flat';
    this.priceTag.set(pub.cur + fmtPrice(price), dir, ret0);

    // 倒计时（墙钟，含休市；旧版无字段时回退）
    const remain = pub.remainSec != null ? pub.remainSec : (pub.totalTicks - pub.tick) * this.cfg.tickSec;
    const total = pub.totalSec != null ? pub.totalSec : pub.totalTicks * this.cfg.tickSec;
    this.countdown.set(remain, total);

    // 休市指示
    const closed = !!pub.marketClosed;
    this.elClosed.style.display = closed ? '' : 'none';
    this.chart.root.classList.toggle('closed', closed);
    const baseCash = pub.initialCash || this.cfg.initialCash;

    // 私有资产
    const pv = this.ctrl.private();
    this.chart.setAvgEntry(pv && pv.shares !== 0 ? pv.avgEntry : 0);
    this.chart.expectedCandles = Math.ceil(pub.totalTicks / pub.ticksPerCandle);
    this.chart.setData(prices, this._volsFor(pub), pub.ticksPerCandle, pub.cur);

    if (pv) {
      this.stCash.set(fmtCompact(pv.cash, pub.cur));
      const posDir = pv.shares > 0 ? '多' : (pv.shares < 0 ? '空' : '—');
      const posAccent = pv.shares > 0 ? 'up' : pv.shares < 0 ? 'down' : '';
      this.stPos.set(pv.shares === 0 ? '空仓' : `${posDir} ${Math.abs(pv.shares)}`, posAccent,
        pv.shares !== 0 ? fmtPct(pv.unrealized / (Math.abs(pv.shares) * pv.avgEntry || 1)) : '');
      this.stDebt.set(pv.debt > 0 ? fmtCompact(pv.debt, pub.cur) : '无', pv.debt > 0 ? 'warn' : '');
      const ret = pv.netWorth / baseCash - 1;
      this.stNW.set(fmtCompact(pv.netWorth, pub.cur), ret >= 0 ? 'up' : 'down', fmtPct(ret));

      // 内幕
      if (pv.insider && pv.insider.dirs) {
        clear(this.elInsider); this.elInsider.style.display = '';
        this.elInsider.appendChild(el('span', { class: 'il' }, [icon('eye', { size: 13 }), document.createTextNode('未来')]));
        pv.insider.dirs.forEach((d) => this.elInsider.appendChild(el('span', { class: 'ar ' + (d > 0 ? 'u' : d < 0 ? 'd' : 'f'), text: d > 0 ? '▲' : d < 0 ? '▼' : '▬' })));
      } else { this.elInsider.style.display = 'none'; }

      // 道具栏
      this._renderProps(pv.props || []);

      // 按钮状态（休市中禁用交易）
      const frozen = pv.frozen || pv.bankrupt || this.ctrl.spectator || closed;
      [this.btnBuy, this.btnSell, this.btnFlat, this.btnLoan, this.btnRepay, ...this._quickBtns].forEach((b) => b.disabled = frozen);
      this._buyTxt.textContent = pv.shares < 0 ? '买入 / 平空' : '买入 / 做多';
      this._sellTxt.textContent = pv.shares > 0 ? '卖出 / 平多' : '卖出 / 做空';
      this.btnLoan.disabled = frozen || pv.debt > 0;
      this.btnRepay.disabled = frozen || pv.debt <= 0;
      this.btnFlat.disabled = frozen || pv.shares === 0;
      if (pv.bankrupt) this._buyTxt.textContent = '已破产';
    }

    // 排行榜
    this._renderBoard(pub.leaderboard, baseCash);
  }

  _volsFor(pub) {
    const p = pub.prices; const v = [0];
    for (let i = 1; i < p.length; i++) v.push(Math.abs(p[i] - p[i - 1]) / p[i - 1] * 60000 + 3000);
    return v;
  }

  _renderProps(props) {
    if (!this.cfg.propMode) return;
    clear(this.elProps);
    this.elProps.appendChild(el('span', { class: 'eyebrow', text: '道具栏' }));
    const slotsWrap = el('div', { class: 'slots' });
    // 聚合相同道具计数
    const counts = {};
    props.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    const ids = Object.keys(counts);
    ids.forEach((id) => {
      const d = PROPS[id]; const m = PROP_META[id]; if (!d || !m) return;
      const slot = el('button', { class: 'prop-slot', title: `${d.name} · ${d.desc}`, style: { '--cat': m.color },
        onclick: () => this._useProp(id) }, [icon(m.ico, { size: 20 })]);
      if (counts[id] > 1) slot.appendChild(el('span', { class: 'count', text: String(counts[id]) }));
      slotsWrap.appendChild(slot);
    });
    const empties = Math.max(0, (this.cfg.propSlots || 3) - ids.length);
    for (let i = 0; i < empties; i++) slotsWrap.appendChild(el('div', { class: 'prop-slot empty' }));
    this.elProps.appendChild(slotsWrap);
  }

  _renderBoard(lb, baseCash) {
    clear(this.elBoard);
    const base = baseCash || this.cfg.initialCash;
    lb.forEach((p, i) => {
      const ret = base ? (p.nw / base - 1) * 100 : 0;
      this.elBoard.appendChild(leaderboardRow({
        rank: i + 1, name: p.name, net: fmtCompact(p.nw, this.cur), deltaPct: ret,
        you: p.id === this.ctrl.myId, ai: p.isHuman ? null : 'bot', broke: p.bankrupt,
      }));
    });
  }

  _fx(e) {
    if (!e) return;
    if (e.kind === 'crash' || e.kind === 'pump') {
      this.chart.root.classList.add(e.kind);
      setTimeout(() => this.chart.root.classList.remove(e.kind), 600);
      if (e.kind === 'crash') toast('黑天鹅！全场砸盘', 'down');
      else toast('利好突袭！全场拉升', 'up');
    }
    if (e.id !== this.ctrl.myId) return;
    if (e.kind === 'liquidate') toast(e.bankrupt ? '你已爆仓破产！' : '触发强制平仓', 'error', 2200);
    else if (e.kind === 'shield') toast('止损盾抵消了一次爆仓', 'info');
    else if (e.kind === 'getprop') { const d = PROPS[e.propId]; if (d) toast(`获得道具：${d.name}`, 'accent', 1400); }
  }
}
