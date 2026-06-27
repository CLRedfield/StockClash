// ====================== 大厅 / 首页 / 本地房间 ======================
import { el, clear } from './dom.js';
import { icon } from './icons.js';
import { wordmark, badge } from './components.js';
import { DEFAULTS, PRESETS, AI_NAMES, nextDiff, deriveWindow, applyClassicRules, applyTycoonRules } from '../engine/constants.js';
import { GameEngine } from '../engine/game.js';
import { pickAsset, randSeed } from '../engine/market.js';
import { renderRoomView } from './room.js';
import { GameUI, LocalController } from './game-ui.js';
import { showSettlement } from './settlement.js';
import { promptNumber, showModePicker } from './prompts.js';
import { sample } from '../util.js';
import { startOnlineFlow } from '../net/online.js';

export class Lobby {
  constructor(root) {
    this.root = root;
    this.name = localStorage.getItem('sc_name') || '玩家';
    this.screen = 'home';
    this.room = this._freshRoom();
  }

  _freshRoom(mode = 'classic') {
    const tycoon = mode === 'tycoon';
    const room = {
      ...structuredClone(DEFAULTS),
      markets: ['cn'],
      totalSeats: 4,
      aiDifficulties: {},
      // 懂王模式：房主（你）专心控盘、不占座位；座位全是 AI 散户
      players: tycoon ? [] : [{ id: 'me', name: this.name }],
      hostId: 'me', hostName: this.name, myId: 'me', isLocal: true,
      roomMode: mode,
    };
    if (mode === 'classic') applyClassicRules(room);
    if (tycoon) applyTycoonRules(room);
    return room;
  }

  // 本地创建：先弹出经典 / 自定义二选一卡片，再进入房间
  async _createLocal() {
    const mode = await showModePicker({ current: this.room?.roomMode || 'classic' });
    if (!mode) return;
    this.room = this._freshRoom(mode);
    this.screen = 'local';
    this.render();
  }

  show() { this.screen = 'home'; this.render(); }
  render() {
    clear(this.root);
    if (this.screen === 'home') this.root.appendChild(this._home());
    else if (this.screen === 'local') this.root.appendChild(this._localRoom());
  }

  // ---------- 大厅首页 ----------
  _home() {
    const nameInput = el('input', { class: 'name-input', value: this.name, maxlength: '10', placeholder: '昵称',
      oninput: (e) => { this.name = e.target.value.trim() || '玩家'; localStorage.setItem('sc_name', this.name); } });

    const entries = [
      { id: 'local',  ico: 'monitor', title: '本地创建房间', sub: '1 名真人 + AI，无需联网', tone: 'secondary', on: () => this._createLocal() },
      { id: 'online', ico: 'wifi',    title: '联机创建房间', sub: '生成 6 位房间号，开黑连打', tone: 'primary',   on: () => startOnlineFlow(this, true) },
      { id: 'join',   ico: 'log-in',  title: '加入房间',     sub: '输入房间号加入好友',       tone: 'secondary', on: () => startOnlineFlow(this, false) },
    ];

    const entryCards = entries.map((e) => el('button', { class: `entry-card ${e.tone === 'primary' ? 'primary' : ''}`, onclick: e.on }, [
      el('span', { class: 'ec-ico' }, [icon(e.ico, { size: 24 })]),
      el('div', {}, [el('div', { class: 'ec-title', text: e.title }), el('div', { class: 'ec-sub', text: e.sub })]),
      el('span', { class: 'ec-go' }, [document.createTextNode('进入 '), icon('chevron-right', { size: 15 })]),
    ]));

    return el('div', { class: 'sc-screen home-screen' }, [
      el('div', { class: 'home-hero' }, [
        wordmark({ zhSize: 44 }),
        el('p', { class: 'home-tagline', html: '一局四分钟，跑完现实里四个月的行情。<br/>看谁是股神，谁在被割韭菜。' }),
        el('div', { class: 'home-badges' }, [
          badge('实时 K 线', 'up', { dot: true }),
          badge('做多做空 · 杠杆', 'accent'),
          badge('4 人同台', 'info'),
        ]),
        el('div', { class: 'home-name' }, [el('label', { text: '昵称' }), nameInput]),
      ]),
      el('div', { class: 'home-entries' }, entryCards),
      el('p', { class: 'home-foot', text: '历史行情仅作游戏化娱乐用途，费率 / 利率为可调平衡数值，不构成任何投资建议。' }),
    ]);
  }

  // ---------- 本地房间 ----------
  _localRoom() {
    const screen = el('div', { class: 'sc-screen room-screen' });
    this._renderLocalRoom(screen);
    return screen;
  }
  _renderLocalRoom(screen) {
    const r = this.room;
    const state = {
      isLocal: true, canEdit: true, canKick: false, canSwap: false,
      roomMode: r.roomMode, tycoon: r.roomMode === 'tycoon', tycoonHostName: r.hostName || this.name,
      markets: r.markets, preset: r.preset, durationSec: r.durationSec, windowLabel: r.windowLabel,
      initialCash: r.initialCash, cashMode: r.cashMode, cashMultiple: r.cashMultiple, feeScale: r.feeScale, loanOrigination: r.loanOrigination, loanAccrual: r.loanAccrual,
      loanAccrualSec: r.loanAccrualSec, maxLeverage: r.maxLeverage, blindMode: r.blindMode, propMode: r.propMode,
      propIntervalSec: r.propIntervalSec, recessMode: r.recessMode, recessRun: r.recessRun, recessRest: r.recessRest,
      opTimeMode: r.opTimeMode, opTimeSec: r.opTimeSec, totalSeats: r.totalSeats, players: r.players, aiDifficulties: r.aiDifficulties,
      hostId: 'me', myId: 'me', selectedSeat: null,
    };
    renderRoomView(screen, state, this._roomHandlers(() => this._renderLocalRoom(screen)));
  }

  _roomHandlers(rerender) {
    const r = this.room;
    return {
      onRoomMode: (mode) => {
        if (r.roomMode === mode) return;
        const wasT = r.roomMode === 'tycoon', isT = mode === 'tycoon';
        r.roomMode = mode;
        if (isT && !wasT) r.players = (r.players || []).filter((p) => p.id !== 'me');
        else if (!isT && wasT) r.players = [{ id: 'me', name: this.name }, ...(r.players || [])];
        if (mode === 'classic') applyClassicRules(r);
        if (mode === 'tycoon') applyTycoonRules(r);
        rerender();
      },
      onMarketToggle: (k) => { const i = r.markets.indexOf(k); if (i >= 0) { if (r.markets.length > 1) r.markets.splice(i, 1); } else r.markets.push(k); rerender(); },
      onPreset: (key) => { const p = PRESETS.find((x) => x.key === key); if (p) { r.preset = key; r.durationSec = p.durationSec; r.tickSec = p.tickSec; r.windowLabel = p.windowLabel; } rerender(); },
      onEditCash: async () => { const v = await promptNumber({ title: '初始资金', value: r.initialCash, min: 1000, step: 10000 }); if (v) { r.initialCash = v; rerender(); } },
      onCashMode: (mode) => { r.cashMode = mode; rerender(); },
      onEditCashMultiple: async () => { const v = await promptNumber({ title: '开盘 1 股的倍数', value: r.cashMultiple, min: 1, max: 100000, hint: '初始资金 = 倍数 × 开盘 1 股价格。默认 100 倍。' }); if (v) { r.cashMultiple = v; rerender(); } },
      onEditFee: async () => { const v = await promptNumber({ title: '手续费倍率（×100）', label: '当前 ×' + r.feeScale.toFixed(2), value: Math.round(r.feeScale * 100), min: 0, max: 1000, hint: '100 = 原始费率，0 = 免手续费' }); if (v != null) { r.feeScale = v / 100; rerender(); } },
      onEditLoan: async () => {
        const a = await promptNumber({ title: '放款即计利息 %', value: Math.round(r.loanOrigination * 100), min: 0, max: 100 }); if (a == null) return;
        const b = await promptNumber({ title: '每周期复利 %', value: Math.round(r.loanAccrual * 100), min: 0, max: 100 }); if (b == null) return;
        const c = await promptNumber({ title: '复利间隔（秒）', value: r.loanAccrualSec, min: 5, max: 120 }); if (c == null) return;
        r.loanOrigination = a / 100; r.loanAccrual = b / 100; r.loanAccrualSec = c; rerender();
      },
      onEditLeverage: async () => { const v = await promptNumber({ title: '杠杆上限（倍）', value: r.maxLeverage, min: 1, max: 10 }); if (v) { r.maxLeverage = v; rerender(); } },
      onToggleBlind: () => { r.blindMode = !r.blindMode; rerender(); },
      onToggleProp: () => { r.propMode = !r.propMode; rerender(); },
      onToggleRecess: () => { r.recessMode = !r.recessMode; rerender(); },
      onToggleOpTime: () => { r.opTimeMode = !r.opTimeMode; rerender(); },
      onDuration: (sec) => { r.durationSec = sec; r.windowLabel = deriveWindow(sec); r.preset = 'custom'; rerender(); },
      onEditPropInterval: async () => { const v = await promptNumber({ title: '道具发放间隔（秒）', value: r.propIntervalSec, min: 10, max: 180 }); if (v) { r.propIntervalSec = v; rerender(); } },
      onEditOpTime: async () => { const v = await promptNumber({ title: '每次刷新的秒数', value: r.opTimeSec, min: 1, max: 10, hint: '默认 2 秒。越大每次操作时间越充裕，整局真实时长也越长。' }); if (v) { r.opTimeSec = v; rerender(); } },
      onEditRecessRun: async () => { const v = await promptNumber({ title: '休市 · 运行时长（秒）', value: r.recessRun, min: 2, max: 120, hint: '连续交易这么久后进入休市。' }); if (v) { r.recessRun = v; rerender(); } },
      onEditRecessRest: async () => { const v = await promptNumber({ title: '休市 · 休息时长（秒）', value: r.recessRest, min: 1, max: 60, hint: '休市期间行情暂停、不可交易。' }); if (v) { r.recessRest = v; rerender(); } },
      onSeatCount: (n) => { r.totalSeats = Math.max(Math.max(2, r.players.length), Math.min(8, n)); rerender(); },
      onSeatDifficulty: (i) => { r.aiDifficulties[i] = nextDiff(r.aiDifficulties[i]); rerender(); },
      onKick: () => {}, onSeatClick: () => {}, onToggleSeatChange: () => {},
      onStart: () => this._startLocal(),
      onExit: () => this.show(),
    };
  }

  _startLocal() {
    const r = this.room;
    const tycoon = r.roomMode === 'tycoon';
    const cap = r.totalSeats;
    const aiNames = sample(AI_NAMES, cap);
    const seats = [];
    if (!tycoon) seats.push({ id: 'me', name: this.name, isHuman: true });   // 懂王模式：你不下场，全是 AI 散户
    for (let i = seats.length; i < cap; i++) seats.push({ id: 'ai' + i, name: aiNames[i] || ('AI' + i), isHuman: false, diff: r.aiDifficulties[i] || 'normal' });
    const asset = pickAsset(r.markets);
    const seed = randSeed();
    const engine = new GameEngine({ cfg: r, seats, asset, seed });
    const ctrl = new LocalController(engine, 'me', { tycoonHost: tycoon });
    const ui = new GameUI(ctrl, { onEnd: (results) => this._showResult(engine, results, ui) });
    ui.mountInto(this.root);
    engine.start();
  }

  _showResult(engine, results, ui) {
    ui.destroy();
    showSettlement(this.root, {
      results, asset: engine.asset, cur: engine.market.cur,
      prices: engine.market.revealedPrices(), myId: 'me',
      onRematch: () => { this.screen = 'local'; this.render(); },
      onExit: () => this.show(),
    });
  }
}
