// ====================== 结算界面 ======================
import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { fmtCompact, fmtPct } from './format.js';
import { MARKETS } from '../engine/constants.js';
import { badge, statTile, leaderboardRow } from './components.js';

export function showSettlement(parent, { results, asset, cur, prices, myId, onRematch, onExit, rematchLabel = '再来一局' }) {
  clear(parent);
  const screen = el('div', { class: 'sc-screen settle-screen' });
  const root = el('div', { class: 'settle-wrap' });
  const champ = results[0];
  const champMe = champ.id === myId;
  const champUp = champ.ret >= 0;

  // ---- 股神横幅 ----
  root.appendChild(el('div', { class: 'winner-banner' }, [
    el('span', { class: 'wb-medal' }, [icon('trophy', { size: 26 })]),
    el('div', { class: 'wb-mid' }, [
      el('div', { class: 'wb-eyebrow', text: '本局股神' }),
      el('div', { class: 'wb-name', text: champ.name + (champMe ? ' · 你' : '') + (champ.isHuman ? '' : '（AI）') }),
    ]),
    el('div', { class: 'wb-right' }, [
      el('div', { class: 'wb-money ' + (champUp ? 'up' : 'down'), text: fmtCompact(champ.finalCash, cur) }),
      el('div', { class: 'wb-ret ' + (champUp ? 'up' : 'down'), text: fmtPct(champ.ret) + ' 收益率' }),
    ]),
  ]));

  // ---- 两栏：走势复盘 + 排名 ----
  const grid = el('div', { class: 'settle-grid' });

  const mkName = MARKETS[asset.marketKey]?.name || '';
  const curveStats = el('div', { class: 'curve-stats' });
  const st = (label, val, accent) => { const t = statTile(label); t.set(val, accent || ''); return t.wrap; };
  curveStats.appendChild(st('收益率', fmtPct(champ.ret), champUp ? 'up' : 'down'));
  curveStats.appendChild(st('最大回撤', (champ.maxDD * 100).toFixed(1) + '%', 'down'));
  curveStats.appendChild(st('交易次数', String(champ.trades)));
  curveStats.appendChild(st('标的揭晓', asset.name, 'accent'));

  grid.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head', style: { width: '100%' } }, [
      el('span', { class: 'ct' }, [icon('activity', { size: 16 }), document.createTextNode('走势复盘')]),
      badge(`${mkName} · ${asset.name}`, asset.marketKey || 'cn', { dot: true }),
    ]),
    el('div', { class: 'card-body' }, [sparkline(prices), curveStats]),
  ]));

  const rankList = el('div', {});
  results.forEach((r, i) => {
    rankList.appendChild(el('div', { style: { borderBottom: i < results.length - 1 ? '1px solid var(--border-subtle)' : 'none' } }, [
      leaderboardRow({
        rank: i + 1, name: r.name, net: fmtCompact(r.finalCash, cur), deltaPct: r.ret * 100,
        you: r.id === myId, ai: r.isHuman ? null : (r.diff || 'normal'), broke: r.bankrupt || r.finalCash <= 0,
      }),
    ]));
  });
  grid.appendChild(el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [el('span', { class: 'ct' }, [icon('list-ordered', { size: 16 }), document.createTextNode('最终排名')])]),
    el('div', { class: 'card-body tight' }, [rankList]),
  ]));

  root.appendChild(grid);

  // ---- 操作 ----
  const actions = el('div', { class: 'settle-actions' });
  if (onRematch) actions.appendChild(el('button', { class: 'btn btn-secondary lg', onclick: () => onRematch() }, [icon('rotate-ccw', { size: 18 }), document.createTextNode(rematchLabel)]));
  actions.appendChild(el('button', { class: 'btn btn-primary lg', onclick: () => onExit() }, [icon('users', { size: 18 }), document.createTextNode('返回大厅')]));
  root.appendChild(actions);

  screen.appendChild(root);
  parent.appendChild(screen);
}

// 走势复盘 sparkline（SVG，绿涨红跌 + 面积渐变）
function sparkline(prices) {
  const W = 720, H = 150;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('width', '100%'); svg.setAttribute('height', String(H));
  svg.setAttribute('class', 'spark');
  if (!prices || prices.length < 2) return svg;

  let hi = Math.max(...prices), lo = Math.min(...prices); const rng = (hi - lo) || 1;
  const x = (i) => 6 + i * ((W - 12) / (prices.length - 1));
  const y = (p) => 8 + (1 - (p - lo) / rng) * (H - 16);
  const up = prices[prices.length - 1] >= prices[0];
  const color = up ? 'var(--price-up)' : 'var(--price-down)';
  const d = prices.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  const area = `${d} L${x(prices.length - 1).toFixed(1)} ${H - 8} L6 ${H - 8} Z`;
  const gid = 'sg' + Math.floor(prices.length);

  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.18"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient>`;
  svg.appendChild(defs);

  const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  // 开局基准虚线
  svg.appendChild(mk('line', { x1: 6, y1: y(prices[0]).toFixed(1), x2: W - 6, y2: y(prices[0]).toFixed(1), stroke: 'var(--border-strong)', 'stroke-dasharray': '3 3', 'stroke-width': 1 }));
  svg.appendChild(mk('path', { d: area, fill: `url(#${gid})` }));
  svg.appendChild(mk('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  return svg;
}
