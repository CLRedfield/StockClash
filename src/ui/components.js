// ====================== 设计系统组件工厂（原生 DOM 版） ======================
// 把 skill 的 React 组件翻译为返回 DOM 节点的工厂；样式类在 styles.css 中实现。
import { el, clear } from './dom.js';
import { icon, svgMarkup } from './icons.js';
import { fmtPct } from './format.js';
import { DURATION_MIN, DURATION_MAX, DURATION_STEP, deriveWindow } from '../engine/constants.js';

// 时长文案：X 分 / X 分 Y 秒
export function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s ? `${m} 分 ${s} 秒` : `${m} 分`;
}

export const MKT_HUE = { cn: 'var(--mkt-cn)', hk: 'var(--mkt-hk)', us: 'var(--mkt-us)', crypto: 'var(--mkt-crypto)' };
export const DIFF_GLYPH = { easy: '简', normal: '普', hard: '难' };

// ---------- 字标 ----------
export function wordmark({ zhSize = 22 } = {}) {
  return el('div', { class: 'sc-wordmark' }, [
    el('span', { class: 'swm-zh', style: { fontSize: zhSize + 'px' } }, [
      document.createTextNode('操'), el('span', { class: 'gold', text: '盘' }), document.createTextNode('杀'),
    ]),
    el('span', { class: 'swm-en', style: { fontSize: (zhSize * 0.5) + 'px' } , text: 'StockClash' }),
  ]);
}

// ---------- 徽章 ----------
export function badge(label, tone = 'neutral', { dot = false } = {}) {
  const kids = [];
  if (dot) kids.push(el('span', { class: 'dot' }));
  kids.push(document.createTextNode(label));
  return el('span', { class: `badge ${tone}` }, kids);
}

// ---------- 图标按钮 ----------
export function iconBtn(name, { variant = 'ghost', size = 'md', label = '', onClick } = {}) {
  return el('button', { class: `icon-btn ${variant} ${size}`, title: label, 'aria-label': label, onclick: onClick }, [
    icon(name, { size: size === 'sm' ? 15 : 18 }),
  ]);
}

// ---------- 分段控件 ----------
export function segmented(options, value, onChange, { size = 'md' } = {}) {
  const wrap = el('div', { class: `segmented ${size}` , role: 'tablist' });
  options.forEach((opt) => {
    const o = typeof opt === 'string' ? { value: opt, label: opt } : opt;
    const active = o.value === value;
    const kids = [document.createTextNode(o.label)];
    if (o.star) kids.push(el('span', { class: 'star', text: '★' }));
    wrap.appendChild(el('button', { class: active ? 'active' : '', role: 'tab', onclick: () => onChange?.(o.value) }, kids));
  });
  return wrap;
}

// ---------- 开关 ----------
export function switchEl(checked, onChange, { disabled = false } = {}) {
  return el('button', {
    class: `switch ${checked ? 'on' : ''}`, role: 'switch', 'aria-checked': String(!!checked), disabled,
    onclick: () => !disabled && onChange?.(!checked),
  }, [el('span', { class: 'knob' })]);
}

export function switchRow(labelText, checked, onChange, { disabled = false, extra = null } = {}) {
  const kids = [switchEl(checked, onChange, { disabled }), document.createTextNode(' ' + labelText)];
  if (extra) kids.push(el('span', { class: 'mono-mini', text: ' ' + extra }));
  return el('label', { class: 'switch-label' }, kids);
}

// ---------- 源码片（K线来源多选） ----------
export function sourceChip({ market, label, checked, onChange, disabled = false }) {
  const hue = MKT_HUE[market] || 'var(--slate-500)';
  const box = el('span', { class: 'box' });
  box.innerHTML = '<span class="box-inner"></span>' + svgMarkup('check', 3.5);
  return el('button', {
    class: `source-chip ${checked ? 'on' : ''}`, 'data-market': market, role: 'checkbox',
    'aria-checked': String(!!checked), disabled, style: { '--hue': hue },
    onclick: () => !disabled && onChange?.(!checked),
  }, [box, document.createTextNode(label)]);
}

// ---------- 数字步进器 ----------
export function stepper({ value = 0, step = 1, min = 0, max = Infinity, unit = '', onChange }) {
  const clamp = (v) => Math.max(min, Math.min(max, v));
  const valNode = el('input', { class: 'val', type: 'number', value: String(value) });
  const unitNode = unit ? el('span', { class: 'unit', text: unit }) : null;
  const wrap = el('div', { class: 'stepper' }, [
    el('button', { class: 'minus', text: '−', onclick: () => commit(clamp(num() - step)) }),
    el('div', { style: { flex: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } }, [valNode, unitNode].filter(Boolean)),
    el('button', { class: 'plus', text: '+', onclick: () => commit(clamp(num() + step)) }),
  ]);
  function num() { const v = Math.floor(Number(valNode.value) || 0); return isNaN(v) ? 0 : v; }
  function commit(v) { valNode.value = String(v); onChange?.(v); }
  valNode.addEventListener('input', () => onChange?.(clamp(num())));
  valNode.addEventListener('blur', () => commit(clamp(num())));
  wrap.set = (v) => { valNode.value = String(v); };
  return wrap;
}

// ---------- 规则片 ----------
export function ruleChip(iconName, label, val, { editable = false, onClick } = {}) {
  return el('button', { class: `rule-chip ${editable ? '' : 'locked'}`, onclick: () => editable && onClick?.() }, [
    icon(iconName, { size: 15, cls: 'ico-mut' }),
    el('span', { class: 'rk', text: label }),
    el('span', { class: 'rv', text: val }),
  ]);
}
export function toggleChip(label, on, { editable = false, onClick } = {}) {
  return el('button', { class: `rule-chip toggle ${on ? 'on' : ''} ${editable ? '' : 'locked'}`, onclick: () => editable && onClick?.() }, [
    el('span', { class: 'rk', text: label }), el('span', { class: 'rv', text: on ? '开' : '关' }),
  ]);
}

// ---------- 座位 ----------
// seat: { kind:'human'|'ai'|'empty', name, diff, isYou, isHost, idx(1based) }
export function seatTile(seat, i, { canEdit, canKick, selected, onCycleAi, onKick, onClick } = {}) {
  const kind = seat.kind;
  const diff = seat.diff || 'normal';
  const cls = ['seat-tile', kind];
  if (kind === 'ai') cls.push(diff);
  if (seat.isYou) cls.push('you');
  if (selected) cls.push('sel');
  if (kind === 'human' && onClick) cls.push('clickable');

  const avatarText = kind === 'empty' ? '' : kind === 'ai' ? 'AI' : (seat.name?.[0] || '玩');
  const nameKids = [document.createTextNode(kind === 'empty' ? '空位' : kind === 'ai' ? 'AI 补位' : seat.name)];
  if (seat.isHost) nameKids.push(el('span', { class: 'crown', title: '房主', text: '♛' }));
  if (seat.isYou) nameKids.push(el('span', { class: 'you-tag', text: '你' }));

  const kids = [
    el('span', { class: 'idx', text: '#' + i }),
    el('span', { class: 'ava', text: avatarText }),
    el('div', { class: 'meta' }, [el('div', { class: 'nm' }, nameKids)]),
  ];
  if (kind === 'ai' && canEdit) {
    kids.push(el('button', { class: 'diff-btn', title: '切换 AI 难度', text: DIFF_GLYPH[diff],
      onclick: (e) => { e.stopPropagation(); onCycleAi?.(); } }));
  }
  if (canKick && kind === 'human' && !seat.isYou) {
    kids.push(el('button', { class: 'kick-btn', title: '踢出', text: '✕',
      onclick: (e) => { e.stopPropagation(); onKick?.(); } }));
  }
  return el('div', { class: cls.join(' '), onclick: () => onClick?.() }, kids);
}

// ---------- 排行行（每 tick 重建） ----------
// row: { rank, name, net(text), deltaPct(number), you, ai, broke }
export function leaderboardRow({ rank, name, net, deltaPct = 0, you = false, ai = null, broke = false }) {
  const dir = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  const whoKids = [el('span', { class: 'nm' }, [
    document.createTextNode(name),
    you ? el('span', { class: 'you', text: ' · 你' }) : null,
  ].filter(Boolean))];
  if (ai) whoKids.push(el('span', { class: `ai-chip ${ai === 'bot' ? '' : ai}`, text: ai === 'bot' ? 'AI' : 'AI·' + (DIFF_GLYPH[ai] || '普') }));
  if (broke) whoKids.push(el('span', { class: 'broke-tag', text: '破产' }));

  return el('div', { class: `lb-row ${you ? 'me' : ''} ${broke ? 'broke' : ''}` }, [
    el('span', { class: `rank r${rank}`, text: String(rank) }),
    el('span', { class: 'ava', text: (name || '?').slice(0, 1) }),
    el('div', { class: 'who' }, whoKids),
    el('div', { class: 'vals' }, [
      el('div', { class: 'vnw', text: net }),
      el('div', { class: `vpc ${dir}`, text: (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%' }),
    ]),
  ]);
}

// ---------- 懂王上帝视角榜单行（显示每个散户的多空持仓） ----------
// row: { rank, name, posText, posDir('up'|'down'|'flat'), net(text), deltaPct(number), ai, broke }
export function tycoonTraderRow({ rank, name, posText, posDir = 'flat', net, deltaPct = 0, ai = null, broke = false }) {
  const dir = deltaPct > 0 ? 'up' : deltaPct < 0 ? 'down' : 'flat';
  const whoTop = [el('span', { class: 'nm' }, [document.createTextNode(name)])];
  if (ai) whoTop.push(el('span', { class: 'ai-chip', text: 'AI' }));
  if (broke) whoTop.push(el('span', { class: 'broke-tag', text: '破产' }));
  return el('div', { class: `lb-row ty-row ${broke ? 'broke' : ''}` }, [
    el('span', { class: `rank r${rank}`, text: String(rank) }),
    el('span', { class: 'ava', text: (name || '?').slice(0, 1) }),
    el('div', { class: 'who' }, [
      el('div', { class: 'who-top' }, whoTop),
      el('span', { class: `ty-pos ${posDir}`, text: posText }),
    ]),
    el('div', { class: 'vals' }, [
      el('div', { class: 'vnw', text: net }),
      el('div', { class: `vpc ${dir}`, text: (deltaPct > 0 ? '+' : '') + deltaPct.toFixed(1) + '%' }),
    ]),
  ]);
}

// ---------- 统计块（HUD，可更新） ----------
export function statTile(label, { emphasis = false } = {}) {
  const v = el('div', { class: 'sv' });
  const sub = el('div', { class: 'ss' });
  const wrap = el('div', { class: `stat-tile ${emphasis ? 'emph' : ''}` }, [
    el('div', { class: 'sl', text: label }), v, sub,
  ]);
  return {
    wrap,
    set(value, accent = '', subVal = '') {
      v.textContent = value; v.className = 'sv ' + accent;
      sub.textContent = subVal; sub.className = 'ss ' + accent;
      sub.style.display = subVal ? '' : 'none';
    },
  };
}

// ---------- 价格标签（可更新） ----------
export function priceTag({ size = 'md' } = {}) {
  const arrow = el('span', { class: 'arrow' });
  const pp = el('span', { class: 'pp' });
  const pcText = el('span');
  const pc = el('span', { class: 'pc' }, [arrow, pcText]);
  const wrap = el('div', { class: `price-tag ${size}` }, [pp, pc]);
  return {
    wrap,
    set(priceText, dir, changePct) {
      pp.textContent = priceText;
      arrow.textContent = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
      pcText.textContent = fmtPct(changePct);
      wrap.className = `price-tag ${size} ${dir}`;
    },
  };
}

// ---------- 一局时长拖条 ----------
// 拖条值 = 交易内容（基础时长）。增加操作时间 / 休市会拉长真实时长，读出里给出提示。
// onCommit(sec) 在释放（change）时触发；拖动（input）时本地实时刷新读出。
export function durationSlider({ value, disabled = false, onCommit,
  recess = false, recessRun = 10, recessRest = 5, opTime = false, opTimeSec = 2 } = {}) {
  const input = el('input', {
    class: 'sc-slider', type: 'range',
    min: String(DURATION_MIN), max: String(DURATION_MAX), step: String(DURATION_STEP),
    value: String(value), disabled,
  });
  const readout = el('div', { class: 'duration-readout' });

  const paint = (v) => {
    clear(readout);
    readout.appendChild(el('span', { class: 'dr-main' }, [
      el('b', { text: fmtDur(v) }), document.createTextNode(' 交易时长'),
      el('span', { class: 'dr-win', text: ` · ≈ ${deriveWindow(v)}真实行情` }),
    ]));
    // 真实时长（与引擎算法一致）：每 tick = tickSec 秒，休市按运行/休息比放大
    const tickSec = opTime ? opTimeSec : 1;
    let totalWallTicks = v;
    if (recess) {
      const runLen = Math.max(1, Math.round(recessRun / tickSec));
      const restLen = Math.max(1, Math.round(recessRest / tickSec));
      totalWallTicks = Math.round(v * (runLen + restLen) / runLen);
    }
    const actualSec = totalWallTicks * tickSec;
    if (opTime || recess) {
      const reasons = [];
      if (opTime) reasons.push(`每 ${opTimeSec}s 刷新`);
      if (recess) reasons.push(`跑 ${recessRun}s·歇 ${recessRest}s`);
      readout.appendChild(el('span', { class: 'dr-recess' }, [
        icon('timer', { size: 13 }),
        document.createTextNode(`实际约 ${fmtDur(actualSec)}（${reasons.join(' · ')}）`),
      ]));
    }
    const pct = ((v - DURATION_MIN) / (DURATION_MAX - DURATION_MIN)) * 100;
    input.style.setProperty('--fill', pct.toFixed(1) + '%');
  };

  input.addEventListener('input', () => paint(Number(input.value)));
  input.addEventListener('change', () => onCommit?.(Number(input.value)));
  paint(value);
  return el('div', { class: 'duration-control' }, [input, readout]);
}

// ---------- 倒计时（可更新） ----------
export function countdown({ size = 'md' } = {}) {
  const v = el('span', { class: 'v' });
  const fill = el('div', { class: 'fill' });
  const timeRow = el('div', { class: 'cd-time' }, [icon('timer', { size: 15 }), v]);
  const wrap = el('div', { class: `countdown ${size}` }, [timeRow, el('div', { class: 'track' }, [fill])]);
  return {
    wrap,
    set(remainingSec, totalSec) {
      const r = Math.max(0, Math.ceil(remainingSec));
      const m = Math.floor(r / 60), s = r % 60;
      v.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const frac = totalSec ? Math.max(0, Math.min(1, remainingSec / totalSec)) : 0;
      fill.style.width = (frac * 100).toFixed(1) + '%';
      wrap.className = `countdown ${size} ${r <= 15 ? 'danger' : r <= 30 ? 'warn' : ''}`;
    },
  };
}
