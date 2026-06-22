// ====================== K 线图（Canvas 蜡烛图，逐秒生长） ======================
// 设计系统：绿涨红跌、hairline 虚线网格、成交量 35% 透明、成本均价金色虚线、
// 圆角最新价标签。颜色取自 CSS tokens（--price-up / --price-down / --gold-500）。
import { el } from './dom.js';
import { buildCandles } from '../engine/market.js';
import { fmtPrice } from './format.js';

export class CandleChart {
  constructor({ colorUp = 'green' } = {}) {
    this.colorUp = colorUp; // 'green' = 绿涨红跌（设计系统默认）；'red' = 红涨绿跌
    this.canvas = el('canvas', { class: 'chart-canvas' });
    this.ctx = this.canvas.getContext('2d');
    this.root = el('div', { class: 'chart-wrap' }, [this.canvas]);
    this.data = null;     // { prices, vols, tpc, cur }
    this.avgEntry = 0;
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.root);
  }
  themeVar(name, fallback) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  get colors() {
    const up = this.themeVar('--price-up', '#0a8f59');
    const down = this.themeVar('--price-down', '#e5484d');
    return this.colorUp === 'red' ? { up: down, down: up } : { up, down };
  }
  _resize() {
    const r = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, r.width * dpr);
    this.canvas.height = Math.max(1, r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = r.width; this.H = r.height;
    if (this.data) this.draw();
  }
  setData(prices, vols, tpc, cur) { this.data = { prices, vols, tpc, cur: cur || '' }; if (!this.W) this._resize(); else this.draw(); }
  setAvgEntry(p) { this.avgEntry = p || 0; }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  draw() {
    const { ctx } = this; const W = this.W, H = this.H;
    if (!W || !H || !this.data) return;
    ctx.clearRect(0, 0, W, H);
    const padL = 8, padR = 56, padT = 12, padB = 6;
    const volH = Math.min(64, H * 0.18);
    const gap = 8;
    const priceH = H - padT - padB - volH - gap;
    const { prices, vols, tpc } = this.data;
    const candles = buildCandles(prices, vols, tpc, prices.length - 1);
    if (!candles.length) return;
    const maxN = Math.max(60, Math.ceil(this.expectedCandles || candles.length));
    const view = candles;
    let hi = -Infinity, lo = Infinity, vmax = 0;
    for (const c of view) { hi = Math.max(hi, c.h); lo = Math.min(lo, c.l); vmax = Math.max(vmax, c.v); }
    if (this.avgEntry > 0) { hi = Math.max(hi, this.avgEntry); lo = Math.min(lo, this.avgEntry); }
    const pad = (hi - lo) * 0.08 || hi * 0.02; hi += pad; lo -= pad;
    const plotW = W - padL - padR;
    const xStep = plotW / maxN;
    const cw = Math.max(1.5, Math.min(14, xStep * 0.62));
    const yPrice = (p) => padT + (hi - p) / (hi - lo) * priceH;
    const yVolBase = padT + priceH + gap + volH;

    const up = this.colors.up, down = this.colors.down;

    // 网格 + 价格刻度（hairline 虚线）
    const gridCol = this.themeVar('--chart-grid', '#e6eaf0');
    const axisCol = this.themeVar('--chart-axis', '#98a2b3');
    ctx.lineWidth = 1; ctx.font = '9px "JetBrains Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const p = lo + (hi - lo) * i / 4; const y = yPrice(p);
      ctx.strokeStyle = gridCol; ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = axisCol; ctx.fillText(fmtPrice(p), W - padR + 6, y);
    }

    // 成交量（35% 透明）
    for (let i = 0; i < view.length; i++) {
      const c = view[i]; const x = padL + i * xStep + (xStep - cw) / 2;
      const h = vmax > 0 ? (c.v / vmax) * (volH - 4) : 0;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = (c.c >= c.o ? up : down);
      ctx.fillRect(x, yVolBase - h, cw, h);
      ctx.globalAlpha = 1;
    }

    // 成本均价线（金色虚线）
    if (this.avgEntry > 0) {
      const y = yPrice(this.avgEntry);
      const accent = this.themeVar('--chart-accent', '#c8932a');
      ctx.strokeStyle = accent; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = accent; ctx.fillText('成本 ' + fmtPrice(this.avgEntry), padL + 4, y - 9);
    }

    // 蜡烛
    for (let i = 0; i < view.length; i++) {
      const c = view[i]; const xc = padL + i * xStep + xStep / 2;
      const col = c.c >= c.o ? up : down;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xc, yPrice(c.h)); ctx.lineTo(xc, yPrice(c.l)); ctx.stroke();
      const yo = yPrice(c.o), ycl = yPrice(c.c);
      const top = Math.min(yo, ycl), bh = Math.max(1.5, Math.abs(yo - ycl));
      this._roundRect(xc - cw / 2, top, cw, bh, Math.min(1.5, cw / 2)); ctx.fill();
    }

    // 最新价标线 + 圆角标签
    const lastP = prices[prices.length - 1]; const ly = yPrice(lastP);
    const lastUp = prices[prices.length - 1] >= prices[Math.max(0, prices.length - 2)];
    const lcol = lastUp ? up : down;
    ctx.strokeStyle = lcol; ctx.globalAlpha = 0.7; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = lcol; this._roundRect(W - padR + 1, ly - 8, padR - 3, 16, 3); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 9.5px "JetBrains Mono", ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(fmtPrice(lastP), W - padR + (padR - 2) / 2, ly);
    ctx.textAlign = 'left';
  }
  destroy() { try { this._ro.disconnect(); } catch (e) {} }
}
