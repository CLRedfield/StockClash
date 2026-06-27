// ====================== 统一房间视图（本地 / 联机共用） ======================
import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { MARKETS, MARKET_KEYS } from '../engine/constants.js';
import { fmtCompact } from './format.js';
import { promptNumber, toast, showModePicker } from './prompts.js';
import { wordmark, badge, segmented, switchRow, sourceChip, seatTile, ruleChip, durationSlider } from './components.js';

// 由 players + totalSeats + aiDifficulties 推导座位
export function buildSeats(state) {
  const seats = [];
  const players = state.players || [];
  for (let i = 0; i < state.totalSeats; i++) {
    const p = players[i];
    if (p) seats.push({ kind: 'human', name: p.name, id: p.id, isYou: p.id === state.myId, isHost: p.id === state.hostId });
    else seats.push({ kind: 'ai', name: 'AI 操盘手', diff: (state.aiDifficulties || {})[i] || 'normal' });
  }
  return seats;
}

function card(headerNode, bodyNode, { tight = false } = {}) {
  return el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [headerNode]),
    el('div', { class: `card-body ${tight ? 'tight' : ''}` }, [bodyNode]),
  ]);
}
function cardTitle(iconName, text, rightNode = null) {
  return el('div', { class: 'card-head', style: { width: '100%' } }, [
    el('span', { class: 'ct' }, [icon(iconName, { size: 16 }), document.createTextNode(text)]),
    rightNode,
  ]);
}
function field(labelText, node) {
  return el('div', {}, [el('p', { class: 'eyebrow room-field-label', text: labelText }), node]);
}

export function renderRoomView(container, state, h) {
  clear(container);
  const canEdit = state.canEdit;
  const roomMode = state.roomMode || 'custom';
  // 经典：规则锁定（仅 K 线来源、座位、时长可调）；自定义 / 懂王：全部可调
  // 懂王每次切入时由 applyTycoonRules 载入默认，之后房主可自由微调
  const rulesEditable = canEdit && roomMode !== 'classic';
  const durEditable = rulesEditable;
  const root = el('div', { class: 'room-wrap' });

  // ---- 头部 ----
  const headRight = [];
  if (!state.isLocal && state.code) {
    headRight.push(el('div', { class: 'room-code' }, [
      el('span', { class: 'rc-label', text: '房间号' }),
      el('span', { class: 'rc-val', text: state.code }),
      el('button', { class: 'btn btn-secondary sm', onclick: () => { try { navigator.clipboard.writeText(state.code); toast('已复制房间号', 'success'); } catch (e) { toast('复制失败，请手动记下', 'warn'); } } }, [icon('copy', { size: 14 }), document.createTextNode('复制邀请')]),
    ]));
  }
  root.appendChild(el('div', { class: 'room-head' }, [
    el('div', { class: 'rh-left' }, [wordmark({ zhSize: 22 }), badge(state.isLocal ? '本地房间' : '联机房间', state.isLocal ? 'neutral' : 'info', { dot: true })]),
    ...headRight,
  ]));

  // ---- 主体两栏 ----
  const grid = el('div', { class: 'room-grid' });

  // 玩法模式：经典 / 自定义 / 懂王 —— 点「更换玩法」弹出三选一卡片
  const MODE_META = {
    classic: { ico: 'trophy', name: '经典模式', desc: '官方推荐配置：1 股 ×100、休市、约 3 个月、道具。规则已锁定。' },
    custom:  { ico: 'sliders-horizontal', name: '自定义模式', desc: '自由调节下方全部规则。' },
    tycoon:  { ico: 'crown', name: '懂王模式', desc: '房主实时控盘：原有走势上叠加 ±50% 趋势。房主不买卖、不上榜，下方规则可自由微调。' },
  };
  const mm = MODE_META[roomMode] || MODE_META.custom;
  const modeControl = el('div', { class: `mode-banner ${roomMode}` }, [
    el('span', { class: 'mb-ico' }, [icon(mm.ico, { size: 18 })]),
    el('div', { class: 'mb-text' }, [
      el('div', { class: 'mb-name', text: mm.name }),
      el('div', { class: 'mb-desc', text: mm.desc }),
    ]),
    canEdit ? el('button', { class: 'btn btn-secondary sm mb-change', onclick: async () => {
      const m = await showModePicker({ current: roomMode }); if (m && m !== roomMode) h.onRoomMode?.(m);
    } }, [icon('rotate-ccw', { size: 14 }), document.createTextNode('更换玩法')]) : null,
  ].filter(Boolean));

  // 左：规则配置
  const mkChips = el('div', { class: 'chip-row' });
  MARKET_KEYS.forEach((k) => mkChips.appendChild(sourceChip({
    market: k, label: MARKETS[k].name, checked: (state.markets || []).includes(k),
    disabled: !canEdit, onChange: () => h.onMarketToggle(k),
  })));

  const durControl = durationSlider({
    value: state.durationSec, disabled: !durEditable, onCommit: (sec) => h.onDuration(sec),
    recess: !!state.recessMode, recessRun: state.recessRun, recessRest: state.recessRest,
    opTime: !!state.opTimeMode, opTimeSec: state.opTimeSec,
  });

  // 开局金钱：固定金额 / 按开盘股价倍数
  const cashMode = state.cashMode || 'fixed';
  const cashSeg = segmented([
    { value: 'fixed', label: '固定金额' },
    { value: 'multiple', label: '按开盘股价' },
  ], cashMode, (m) => rulesEditable && h.onCashMode(m), { size: 'sm' });
  const cashValue = el('div', { class: 'rule-chips', style: { marginTop: '9px' } }, [
    cashMode === 'multiple'
      ? ruleChip('wallet', '开盘 1 股 ×', (state.cashMultiple || 100) + ' 倍', { editable: rulesEditable, onClick: () => h.onEditCashMultiple() })
      : ruleChip('wallet', '初始资金', fmtCompact(state.initialCash, '¥'), { editable: rulesEditable, onClick: () => h.onEditCash() }),
  ]);
  const cashControl = el('div', {}, [cashSeg, cashValue,
    cashMode === 'multiple' ? el('p', { class: 'tier-hint', text: '实际开局资金 = 倍数 × 开盘 1 股价格（开局随机标的揭晓时确定）' }) : null,
  ]);

  const rules = el('div', { class: 'rule-chips' }, [
    ruleChip('receipt', '手续费', '×' + state.feeScale.toFixed(2), { editable: rulesEditable, onClick: () => h.onEditFee() }),
    ruleChip('percent', '贷款', `+${(state.loanOrigination * 100).toFixed(0)}% / ${state.loanAccrualSec}s`, { editable: rulesEditable, onClick: () => h.onEditLoan() }),
    ruleChip('hand-coins', '杠杆', state.maxLeverage + '×', { editable: rulesEditable, onClick: () => h.onEditLeverage() }),
  ]);

  const toggles = el('div', { class: 'toggles-row' }, [
    switchRow('盲盒模式', state.blindMode, () => rulesEditable && h.onToggleBlind(), { disabled: !rulesEditable }),
    switchRow('道具模式', state.propMode, () => rulesEditable && h.onToggleProp(), { disabled: !rulesEditable, extra: state.propMode ? state.propIntervalSec + 's' : '' }),
    switchRow('增加操作时间', state.opTimeMode, () => rulesEditable && h.onToggleOpTime(), { disabled: !rulesEditable, extra: state.opTimeMode ? `每 ${state.opTimeSec}s` : '' }),
    switchRow('休市', state.recessMode, () => rulesEditable && h.onToggleRecess(), { disabled: !rulesEditable, extra: state.recessMode ? `跑${state.recessRun}s·歇${state.recessRest}s` : '' }),
  ]);

  // 子配置（开启对应模式后可点按编辑）
  const subChips = el('div', { class: 'rule-chips' });
  if (state.propMode) subChips.appendChild(ruleChip('timer', '道具间隔', state.propIntervalSec + 's', { editable: rulesEditable, onClick: () => h.onEditPropInterval() }));
  if (state.opTimeMode) subChips.appendChild(ruleChip('timer', '刷新间隔', state.opTimeSec + 's', { editable: rulesEditable, onClick: () => h.onEditOpTime() }));
  if (state.recessMode) {
    subChips.appendChild(ruleChip('play', '运行', state.recessRun + 's', { editable: rulesEditable, onClick: () => h.onEditRecessRun() }));
    subChips.appendChild(ruleChip('pause', '休息', state.recessRest + 's', { editable: rulesEditable, onClick: () => h.onEditRecessRest() }));
  }

  const rulesBody = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } }, [
    field('玩法模式', modeControl),
    field('K 线来源（可多选，开局随机抽）', mkChips),
    field('一局时长（拖动自由调节）', durControl),
    field('开局金钱', cashControl),
    field('规则速览' + (rulesEditable ? '（点击编辑）' : ''), rules),
    toggles,
    subChips.childNodes.length ? subChips : null,
  ]);
  grid.appendChild(el('div', { class: 'card' }, [
    cardTitle('sliders-horizontal', '规则配置'),
    el('div', { class: 'card-body' }, [rulesBody]),
  ]));

  // 右：座位
  const seats = buildSeats(state);
  const humanCount = seats.filter((s) => s.kind === 'human').length;
  const seatGrid = el('div', { class: 'seat-grid' });
  seats.forEach((s, i) => seatGrid.appendChild(seatTile(s, i + 1, {
    canEdit, canKick: state.canKick, selected: state.selectedSeat === i,
    onCycleAi: () => h.onSeatDifficulty(i),
    onKick: () => h.onKick(i),
    onClick: s.kind === 'human' ? () => h.onSeatClick(i) : null,
  })));

  const hostBanner = state.tycoon ? el('div', { class: 'tycoon-host-banner' }, [
    el('span', { class: 'thb-ico' }, [icon('crown', { size: 16 })]),
    el('div', { class: 'thb-text' }, [
      el('div', { class: 'thb-name' }, [document.createTextNode(state.tycoonHostName || '房主'), el('span', { class: 'thb-tag', text: '懂王 · 房主' })]),
      el('div', { class: 'thb-sub', text: '不参与买卖，专心控盘 · 以下为散户席（其他玩家 + AI）' }),
    ]),
  ]) : null;
  const seatBody = el('div', {}, [hostBanner, seatGrid].filter(Boolean));
  if (canEdit) {
    seatBody.appendChild(el('div', { class: 'seat-counter' }, [
      el('button', { class: 'btn btn-secondary sm', onclick: () => h.onSeatCount(state.totalSeats - 1) }, [document.createTextNode('－ 减 AI')]),
      el('span', { class: 'sc-num', text: state.totalSeats + ' 席' }),
      el('button', { class: 'btn btn-secondary sm', onclick: () => h.onSeatCount(state.totalSeats + 1) }, [document.createTextNode('＋ 加 AI')]),
    ]));
    if (!state.isLocal) seatBody.appendChild(el('div', { style: { marginTop: '14px' } }, [
      switchRow('允许玩家自由申请换座', !!state.allowSeatChange, () => h.onToggleSeatChange()),
    ]));
    seatBody.appendChild(el('div', { class: 'room-hint', text: '点两个真人座位互换；✕ 踢出；AI 角标点按切换难度' }));
  } else if (state.canSwap) {
    seatBody.appendChild(el('div', { class: 'room-hint', text: '点你的座位再点目标座位，申请与其互换' }));
  }
  grid.appendChild(el('div', { class: 'card' }, [
    cardTitle('users', state.tycoon ? '散户席' : '座位', badge(`${humanCount}/${state.totalSeats}`, 'neutral')),
    el('div', { class: 'card-body' }, [seatBody]),
  ]));

  root.appendChild(grid);

  // ---- 观战席 ----
  if (state.spectators && state.spectators.length) {
    const sp = el('div', { class: 'spectator-row' });
    state.spectators.forEach((s) => sp.appendChild(badge(s.name + (s.isYou ? '（你）' : ''), s.isYou ? 'accent' : 'neutral')));
    root.appendChild(el('div', { style: { marginTop: '16px' } }, [el('p', { class: 'eyebrow', style: { marginBottom: '9px' }, text: `观战席（${state.spectators.length}）` }), sp]));
  }

  // ---- 操作 ----
  const actions = el('div', { class: 'room-actions' });
  if (canEdit) {
    const canStart = (state.markets || []).length > 0;
    actions.appendChild(el('button', { class: 'btn btn-secondary lg', onclick: () => h.onExit() }, [document.createTextNode('退出')]));
    actions.appendChild(el('button', { class: 'btn btn-primary lg', disabled: !canStart, onclick: () => canStart && h.onStart() }, [icon('play', { size: 18 }), document.createTextNode('开始游戏')]));
    if (!canStart) root.appendChild(el('div', { class: 'room-warn', text: '请至少勾选一个 K 线来源' }));
  } else {
    actions.appendChild(el('div', { class: 'room-wait', text: state.waitingNote || '等待房主开始…' }));
    actions.appendChild(el('button', { class: 'btn btn-secondary lg', onclick: () => h.onExit() }, [document.createTextNode('退出')]));
  }
  root.appendChild(actions);

  container.appendChild(root);
}

export { promptNumber };
