// ====================== 弹层 / 提示（设计系统 Toast + Dialog） ======================
import { el } from './dom.js';
import { icon } from './icons.js';

const overlayRoot = () => document.getElementById('overlay-root');
const toastRoot = () => document.getElementById('toast-root');

// Toast 类型 → Lucide 图标
const TOAST_ICON = {
  info: 'activity', success: 'check', up: 'trending-up', down: 'trending-down',
  error: 'x', warn: 'zap', accent: 'trophy',
};

export function toast(msg, kind = 'info', ms = 1600) {
  const t = el('div', { class: `toast ${kind}` }, [
    el('span', { class: 'ti' }, [icon(TOAST_ICON[kind] || 'activity', { size: 17 })]),
    el('span', { class: 'tx', text: msg }),
  ]);
  toastRoot().appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

// openOverlay({ title, bodyNode, buttons:[{label,onClick,primary,danger}], closable, className, tone })
export function openOverlay({ title, bodyNode, buttons = [], closable = false, className = '', tone = 'default' }) {
  const root = overlayRoot();
  const back = el('div', { class: 'overlay-back' });
  const panel = el('div', { class: `overlay-panel ${className}` }, [
    el('div', { class: `overlay-accent ${tone !== 'default' ? tone : ''}` }),
  ]);
  const inner = el('div', { class: 'overlay-inner' });
  if (title) inner.appendChild(el('div', { class: 'overlay-title', text: title }));
  if (bodyNode) inner.appendChild(bodyNode);
  panel.appendChild(inner);
  if (buttons.length) {
    const bar = el('div', { class: 'overlay-buttons' });
    buttons.forEach((b) => bar.appendChild(el('button', {
      class: `btn ${b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-secondary'}`,
      text: b.label, onclick: () => b.onClick?.(),
    })));
    panel.appendChild(bar);
  }
  back.appendChild(panel);
  root.appendChild(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => { back.classList.remove('show'); setTimeout(() => back.remove(), 200); };
  if (closable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  return { close, panel };
}

// 玩法模式二选一卡片弹层 → Promise<'classic'|'custom'|null>
export function showModePicker({ current = 'classic' } = {}) {
  return new Promise((resolve) => {
    let ov;
    const card = (mode, ico, title, sub, feats, recommended) => {
      const featList = el('ul', { class: 'mp-feats' }, feats.map((f) =>
        el('li', {}, [icon('check', { size: 14 }), document.createTextNode(f)])));
      return el('button', { class: `mode-card ${mode} ${mode === current ? 'current' : ''}`,
        onclick: () => { ov.close(); resolve(mode); } }, [
        recommended ? el('span', { class: 'mp-rec', text: '推荐' }) : null,
        el('span', { class: 'mp-ico' }, [icon(ico, { size: 26 })]),
        el('div', { class: 'mp-title', text: title }),
        el('div', { class: 'mp-sub', text: sub }),
        featList,
        el('span', { class: 'mp-pick' }, [document.createTextNode(mode === current ? '当前选择' : '选择此模式'), icon('chevron-right', { size: 15 })]),
      ].filter(Boolean));
    };
    const body = el('div', { class: 'mode-picker' }, [
      card('classic', 'trophy', '经典模式', '官方推荐 · 开箱即玩', [
        '开局资金 = 开盘 1 股 ×100',
        '开启休市机制',
        '模拟约 3 个月行情',
        '开启道具玩法',
        '规则锁定，无需调参',
      ], true),
      card('custom', 'sliders-horizontal', '自定义模式', '完全自由 · 自己定规则', [
        '自由设定开局资金',
        '自由调节时长 / 费率 / 杠杆',
        '自选休市 / 道具 / 盲盒',
        '适合进阶玩家精调',
      ], false),
    ]);
    ov = openOverlay({ title: '选择玩法模式', bodyNode: body, className: 'wide mode-picker-ov', closable: true, buttons: [
      { label: '取消', onClick: () => { ov.close(); resolve(null); } },
    ] });
  });
}

// 数字输入弹层 → Promise<number|null>
export function promptNumber({ title, label, value = 0, min = 0, max = Infinity, step = 1, hint = '' }) {
  return new Promise((resolve) => {
    const input = el('input', { class: 'num-input', type: 'number', value: String(value), min: String(min), step: String(step) });
    const body = el('div', { class: 'num-body' }, [
      label ? el('div', { class: 'num-label', text: label }) : null,
      input,
      hint ? el('div', { class: 'num-hint', text: hint }) : null,
    ]);
    let ov;
    const ok = () => { let v = Math.floor(Number(input.value)); if (isNaN(v)) v = 0; v = Math.max(min, Math.min(max, v)); ov.close(); resolve(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    ov = openOverlay({ title, bodyNode: body, buttons: [
      { label: '取消', onClick: () => { ov.close(); resolve(null); } },
      { label: '确定', primary: true, onClick: ok },
    ] });
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}
