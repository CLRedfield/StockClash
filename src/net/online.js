// ====================== 在线联机（公共 MQTT · 房主权威） ======================
import { el, clear } from '../ui/dom.js';
import { openOverlay, toast } from '../ui/prompts.js';
import { DEFAULTS, PRESETS, AI_NAMES, MARKET_KEYS, nextDiff, MAX_ROOM, deriveWindow, applyClassicRules } from '../engine/constants.js';
import { GameEngine } from '../engine/game.js';
import { pickAsset, randSeed } from '../engine/market.js';
import { renderRoomView } from '../ui/room.js';
import { GameUI, LocalController } from '../ui/game-ui.js';
import { showSettlement } from '../ui/settlement.js';
import { sample } from '../util.js';
import { promptNumber, showModePicker } from '../ui/prompts.js';
import { MqttBus, topics, getBroker, BROKER_ALTERNATIVES, genRoomCode, genClientId } from './mqtt.js';

let BUS = null;

export async function startOnlineFlow(lobby, isCreate) {
  const broker = await promptConnect();
  if (broker === null) return;
  try {
    toast('正在连接公共服务器…');
    BUS = new MqttBus(broker);
    await BUS.connect();
    toast('已连接 ✓', 'info', 1200);
  } catch (e) {
    toast('连接失败：' + (e.message || '无法连接 broker'), 'error', 4000);
    return;
  }
  if (isCreate) {
    const mode = await showModePicker({ current: 'classic' });
    if (!mode) { BUS?.end?.(); BUS = null; return; }   // 取消创建：断开连接
    const code = genRoomCode(); enterRoom(lobby, code, genClientId(), true, mode);
  }
  else { const code = await promptRoomCode(); if (code) enterRoom(lobby, code, genClientId(), false); }
}

function promptConnect() {
  return new Promise((resolve) => {
    const input = el('input', { class: 'name-input', value: getBroker() });
    const alts = el('div', { class: 'broker-alts' }, BROKER_ALTERNATIVES.map((u) =>
      el('button', { class: 'chip', text: u.replace('wss://', '').replace('/mqtt', ''), onclick: () => { input.value = u; } })));
    const body = el('div', { class: 'env-body' }, [
      el('p', { class: 'env-hint', text: '使用免费公共 MQTT 中转消息，无需注册。默认 EMQX，连不上可换下方服务器。' }),
      input, el('div', { class: 'broker-label', text: '备用服务器：' }), alts,
    ]);
    let ov = openOverlay({ title: '进入联机', bodyNode: body, buttons: [
      { label: '连接', primary: true, onClick: () => { const v = input.value.trim(); if (!v) return toast('请输入地址'); ov.close(); resolve(v); } },
      { label: '取消', onClick: () => { ov.close(); resolve(null); } },
    ] });
  });
}
function promptRoomCode() {
  return new Promise((resolve) => {
    const input = el('input', { class: 'name-input', placeholder: '6 位房间号', maxlength: '6', style: { textTransform: 'uppercase' } });
    let ov = openOverlay({ title: '加入房间', bodyNode: input, buttons: [
      { label: '加入', primary: true, onClick: () => { const v = input.value.trim().toUpperCase(); if (!v) return; ov.close(); resolve(v); } },
      { label: '取消', onClick: () => { ov.close(); resolve(null); } },
    ] });
  });
}

function freshRoom(code, myId, name, mode = 'classic') {
  const room = {
    ...structuredClone(DEFAULTS), code, hostId: myId, roomMode: mode,
    markets: ['cn'], totalSeats: 4, aiDifficulties: {}, allowSeatChange: false,
    players: [{ id: myId, name: name || '房主' }], status: 'waiting',
  };
  if (mode === 'classic') applyClassicRules(room);
  return room;
}

function enterRoom(lobby, code, myId, isHost, mode = 'classic') {
  const T = topics(code);
  let room = isHost ? freshRoom(code, myId, lobby.name, mode) : { code, players: [], status: 'waiting', hostId: null, markets: [], totalSeats: 4 };
  let started = false, wasIn = false, hub = null, ui = null;
  const screen = () => { clear(lobby.root); const s = el('div', { class: 'room-screen' }); lobby.root.appendChild(s); return s; };
  let host = screen();

  const publishLobby = () => BUS.pub(T.lobby, room, { retain: true });

  const showRoom = () => { started = false; host = screen(); render(); };

  const render = () => {
    const cap = room.totalSeats || 4;
    const players = room.players || [];
    const amSpec = players.findIndex((p) => p.id === myId) >= cap;
    const spectators = players.slice(cap).map((p) => ({ name: p.name, isYou: p.id === myId }));
    const state = {
      isLocal: false, code, canEdit: isHost, canKick: isHost, canSwap: isHost || room.allowSeatChange,
      roomMode: room.roomMode,
      markets: room.markets, preset: room.preset, durationSec: room.durationSec, windowLabel: room.windowLabel,
      initialCash: room.initialCash, cashMode: room.cashMode, cashMultiple: room.cashMultiple, feeScale: room.feeScale, loanOrigination: room.loanOrigination, loanAccrual: room.loanAccrual,
      loanAccrualSec: room.loanAccrualSec, maxLeverage: room.maxLeverage, blindMode: room.blindMode, propMode: room.propMode,
      propIntervalSec: room.propIntervalSec, recessMode: room.recessMode, recessRun: room.recessRun, recessRest: room.recessRest,
      opTimeMode: room.opTimeMode, opTimeSec: room.opTimeSec, totalSeats: cap, players: players.slice(0, cap), aiDifficulties: room.aiDifficulties || {},
      hostId: room.hostId, myId, selectedSeat, allowSeatChange: room.allowSeatChange, spectators,
      waitingNote: amSpec ? '名额已满，你将作为观战者进入' : '等待房主开始…',
    };
    renderRoomView(host, state, handlers());
  };

  let selectedSeat = null;
  const handlers = () => ({
    onRoomMode: (mode) => { if (room.roomMode === mode) return; room.roomMode = mode; if (mode === 'classic') applyClassicRules(room); publishLobby(); render(); },
    onMarketToggle: (k) => { const i = room.markets.indexOf(k); if (i >= 0) { if (room.markets.length > 1) room.markets.splice(i, 1); } else room.markets.push(k); publishLobby(); render(); },
    onPreset: (key) => { const p = PRESETS.find((x) => x.key === key); if (p) { room.preset = key; room.durationSec = p.durationSec; room.tickSec = p.tickSec; room.windowLabel = p.windowLabel; } publishLobby(); render(); },
    onEditCash: async () => { const v = await promptNumber({ title: '初始资金', value: room.initialCash, min: 1000, step: 10000 }); if (v) { room.initialCash = v; publishLobby(); render(); } },
    onCashMode: (mode) => { room.cashMode = mode; publishLobby(); render(); },
    onEditCashMultiple: async () => { const v = await promptNumber({ title: '开盘 1 股的倍数', value: room.cashMultiple, min: 1, max: 100000, hint: '初始资金 = 倍数 × 开盘 1 股价格。默认 100 倍。' }); if (v) { room.cashMultiple = v; publishLobby(); render(); } },
    onEditFee: async () => { const v = await promptNumber({ title: '手续费倍率（×100）', value: Math.round(room.feeScale * 100), min: 0, max: 1000, hint: '100=原始，0=免费' }); if (v != null) { room.feeScale = v / 100; publishLobby(); render(); } },
    onEditLoan: async () => {
      const a = await promptNumber({ title: '放款即计利息 %', value: Math.round(room.loanOrigination * 100), min: 0, max: 100 }); if (a == null) return;
      const b = await promptNumber({ title: '每周期复利 %', value: Math.round(room.loanAccrual * 100), min: 0, max: 100 }); if (b == null) return;
      const c = await promptNumber({ title: '复利间隔（秒）', value: room.loanAccrualSec, min: 5, max: 120 }); if (c == null) return;
      room.loanOrigination = a / 100; room.loanAccrual = b / 100; room.loanAccrualSec = c; publishLobby(); render();
    },
    onEditLeverage: async () => { const v = await promptNumber({ title: '杠杆上限（倍）', value: room.maxLeverage, min: 1, max: 10 }); if (v) { room.maxLeverage = v; publishLobby(); render(); } },
    onToggleBlind: () => { room.blindMode = !room.blindMode; publishLobby(); render(); },
    onToggleProp: () => { room.propMode = !room.propMode; publishLobby(); render(); },
    onToggleRecess: () => { room.recessMode = !room.recessMode; publishLobby(); render(); },
    onToggleOpTime: () => { room.opTimeMode = !room.opTimeMode; publishLobby(); render(); },
    onDuration: (sec) => { room.durationSec = sec; room.windowLabel = deriveWindow(sec); room.preset = 'custom'; publishLobby(); render(); },
    onEditOpTime: async () => { const v = await promptNumber({ title: '每次刷新的秒数', value: room.opTimeSec, min: 1, max: 10, hint: '默认 2 秒。越大每次操作时间越充裕，整局真实时长也越长。' }); if (v) { room.opTimeSec = v; publishLobby(); render(); } },
    onEditRecessRun: async () => { const v = await promptNumber({ title: '休市 · 运行时长（秒）', value: room.recessRun, min: 2, max: 120 }); if (v) { room.recessRun = v; publishLobby(); render(); } },
    onEditRecessRest: async () => { const v = await promptNumber({ title: '休市 · 休息时长（秒）', value: room.recessRest, min: 1, max: 60 }); if (v) { room.recessRest = v; publishLobby(); render(); } },
    onEditPropInterval: async () => { const v = await promptNumber({ title: '道具发放间隔（秒）', value: room.propIntervalSec, min: 10, max: 180 }); if (v) { room.propIntervalSec = v; publishLobby(); render(); } },
    onSeatCount: (n) => { room.totalSeats = Math.max(Math.max(2, 1), Math.min(8, n)); publishLobby(); render(); },
    onSeatDifficulty: (i) => { room.aiDifficulties = room.aiDifficulties || {}; room.aiDifficulties[i] = nextDiff(room.aiDifficulties[i]); publishLobby(); render(); },
    onKick: (i) => {
      const p = room.players[i]; if (!p || p.id === room.hostId) return;
      let ov = openOverlay({ title: '移出玩家', bodyNode: el('div', { class: 'menu-hint', text: `确定将「${p.name}」移出房间？` }), buttons: [
        { label: '确定移出', danger: true, onClick: () => { ov.close(); const j = room.players.findIndex((x) => x.id === p.id); if (j >= 0) { room.players.splice(j, 1); selectedSeat = null; publishLobby(); render(); toast(`已移出 ${p.name}`); } } },
        { label: '取消', onClick: () => ov.close() },
      ] });
    },
    onSeatClick: (i) => {
      const cap = room.totalSeats;
      if (isHost) {
        const s = room.players[i];
        if (!s) { selectedSeat = null; render(); return; }       // 点空位（AI）不可换
        if (selectedSeat == null) selectedSeat = i;
        else if (selectedSeat === i) selectedSeat = null;
        else { const a = room.players[selectedSeat], b = room.players[i]; if (a && b) { room.players[selectedSeat] = b; room.players[i] = a; } selectedSeat = null; publishLobby(); }
        render();
      } else if (room.allowSeatChange) {
        const me = room.players.findIndex((p) => p.id === myId);
        if (me === i) return;
        BUS.pub(T.move, { id: myId, toIndex: i }); toast('已申请换位…');
      }
    },
    onToggleSeatChange: () => { room.allowSeatChange = !room.allowSeatChange; publishLobby(); render(); },
    onStart: () => startHostGame(),
    onExit: () => { BUS?.end(); location.reload(); },
  });

  // ---------- 房主：开局 ----------
  const startHostGame = () => {
    started = true;
    const cap = room.totalSeats;
    const seatPlayers = room.players.slice(0, cap);
    const spectators = room.players.slice(cap).map((p) => p.id);
    const aiNames = sample(AI_NAMES, cap);
    const seats = [];
    for (let i = 0; i < cap; i++) {
      const p = seatPlayers[i];
      if (p) seats.push({ id: p.id, name: p.name, isHuman: true });
      else seats.push({ id: 'ai' + i, name: aiNames[i] || ('AI' + i), isHuman: false, diff: (room.aiDifficulties || {})[i] || 'normal' });
    }
    const asset = pickAsset(room.markets);
    const seed = randSeed();
    room.status = 'playing'; room.spectators = spectators; publishLobby();

    const engine = new GameEngine({ cfg: { ...room }, seats, asset, seed });
    hub = new NetHostHub(T, engine, myId, seats.filter((s) => s.isHuman).map((s) => s.id), spectators);
    hub.start();

    clear(lobby.root);
    const gameRoot = el('div', { class: 'game-root-wrap' }); lobby.root.appendChild(gameRoot);
    ui = new GameUI(new LocalController(engine, myId), { onEnd: (results) => onGameEnd(engine, results) });
    ui.mountInto(gameRoot);
    engine.start();
  };

  const onGameEnd = (engine, results) => {
    ui?.destroy();
    showSettlement(lobby.root, {
      results, asset: engine.asset, cur: engine.market.cur,
      prices: engine.market.prices.slice(0, engine.market.cursor + 1), myId,
      rematchLabel: '再来一局（回房间）',
      onRematch: () => { hub?.stop(); backToRoom(); }, onExit: () => { BUS?.end(); location.reload(); },
    });
  };

  const backToRoom = () => {
    (room.players || []).forEach((p) => BUS.clearRetained(T.state(p.id)));
    BUS.clearRetained(T.feed); BUS.clearRetained(T.rank); BUS.clearRetained(T.end);
    room.status = 'waiting'; delete room.spectators; selectedSeat = null; publishLobby(); showRoom();
  };

  // ---------- 客户端：进入对局 ----------
  const enterClientGame = () => {
    started = true;
    const cap = room.totalSeats;
    const idx = (room.players || []).findIndex((p) => p.id === myId);
    const spectator = !(idx >= 0 && idx < cap);
    const ctrl = new NetController(BUS, T, myId, { ...room }, spectator);
    clear(lobby.root);
    const gameRoot = el('div', { class: 'game-root-wrap' }); lobby.root.appendChild(gameRoot);
    ui = new GameUI(ctrl, { onEnd: (results) => {
      ui?.destroy();
      showSettlement(lobby.root, { results: results.results || results, asset: results.asset || ctrl.lastAsset, cur: results.cur || '',
        prices: results.prices || ctrl.lastPrices || [], myId, rematchLabel: '等待房主再来一局',
        onRematch: () => toast('请等待房主开始下一局'), onExit: () => { BUS?.end(); location.reload(); } });
    } });
    ctrl.attach();
    ui.mountInto(gameRoot);
    toast(spectator ? '你正在观战' : '已进入对局');
  };

  // ---------- 订阅 ----------
  if (isHost) {
    BUS.sub(T.join, (msg) => {
      if (!msg?.id || room.status !== 'waiting') return;
      if (room.players.some((p) => p.id === msg.id)) { publishLobby(); return; }
      if (room.players.length >= MAX_ROOM) return;
      room.players.push({ id: msg.id, name: msg.name || '玩家' }); publishLobby(); render();
      toast(`${msg.name || '玩家'} 加入了房间`);
    });
    BUS.sub(T.move, (msg) => {
      if (!room.allowSeatChange || room.status !== 'waiting' || !msg?.id) return;
      const from = room.players.findIndex((p) => p.id === msg.id); const to = msg.toIndex;
      if (from < 0 || to == null || to < 0 || to >= room.totalSeats || from === to) return;
      const b = room.players[to]; if (!b) return;
      const a = room.players[from]; room.players[from] = b; room.players[to] = a; publishLobby(); render();
    });
    showRoom(); publishLobby();
  } else {
    BUS.sub(T.lobby, (r) => {
      if (!r || !r.code) return;
      room = r;
      const inRoom = (r.players || []).some((p) => p.id === myId);
      if (wasIn && !inRoom && r.status === 'waiting') { wasIn = false; toast('你已被房主移出房间', 'error', 2500); BUS?.end(); setTimeout(() => location.reload(), 1600); return; }
      if (inRoom) wasIn = true;
      if (r.status === 'playing' && !started) { enterClientGame(); return; }
      if (r.status === 'waiting' && started) { showRoom(); return; }
      if (r.status === 'waiting') render();
    });
    const join = () => BUS.pub(T.join, { id: myId, name: lobby.name || '玩家' });
    join(); setTimeout(() => { if (room.status === 'waiting' && !room.players?.some((p) => p.id === myId)) join(); }, 1600);
    host = screen(); render();
  }
}

// ====================== 房主通讯枢纽 ======================
class NetHostHub {
  constructor(T, engine, hostId, humanIds, spectators) {
    this.T = T; this.engine = engine; this.hostId = hostId; this.humanIds = humanIds; this.spectators = spectators || [];
    this._unsubs = []; this.stopped = false;
  }
  start() {
    this._unsubs.push(this.engine.on('tick', () => this.broadcast()));
    this._unsubs.push(this.engine.on('fx', (e) => BUS.pub(this.T.fx, e, { qos: 0 })));
    this._unsubs.push(this.engine.on('end', (results) => {
      BUS.pub(this.T.end, { results, asset: this.engine.asset, cur: this.engine.market.cur, prices: this.engine.market.prices.slice(0, this.engine.market.cursor + 1) }, { retain: true });
    }));
    this._unsubs.push(BUS.sub(this.T.act, (doc) => { if (doc?.playerId && doc.action) this.engine.act(doc.playerId, doc.action); }));
    this.broadcast();
  }
  stop() { this.stopped = true; this._unsubs.forEach((u) => { try { u(); } catch (e) {} }); this._unsubs = []; }
  broadcast() {
    if (this.stopped) return;
    BUS.pub(this.T.feed, this.engine.publicState(), { qos: 0, retain: true });
    for (const pid of this.humanIds) if (pid !== this.hostId) BUS.pub(this.T.state(pid), this.engine.privateState(pid), { qos: 0, retain: true });
  }
}

// ====================== 客户端控制器（实现 GameUI 接口） ======================
class NetController {
  constructor(bus, T, myId, cfg, spectator) {
    this.bus = bus; this.T = T; this.myId = myId; this.cfg = cfg; this.spectator = spectator;
    this._pub = null; this._priv = null; this._listeners = { tick: new Set(), fx: new Set(), end: new Set() };
    this.lastAsset = null; this.lastPrices = null;
    this._unsubs = [];
  }
  attach() {
    this._unsubs.push(this.bus.sub(this.T.feed, (s) => { this._pub = s; this.lastAsset = s.asset; this.lastPrices = s.prices; this._emit('tick'); }, { qos: 0 }));
    if (!this.spectator) this._unsubs.push(this.bus.sub(this.T.state(this.myId), (s) => { this._priv = s; this._emit('tick'); }, { qos: 0 }));
    this._unsubs.push(this.bus.sub(this.T.fx, (e) => this._emit('fx', e), { qos: 0 }));
    this._unsubs.push(this.bus.sub(this.T.end, (r) => this._emit('end', r)));
  }
  on(ev, fn) { this._listeners[ev]?.add(fn); return () => this._listeners[ev]?.delete(fn); }
  _emit(ev, ...a) { this._listeners[ev]?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); }
  public() { return this._pub; }
  private() { return this._priv; }
  players() { return (this._pub?.leaderboard || []).map((p) => ({ id: p.id, name: p.name })); }
  act(action) { if (this.spectator) return { ok: false, msg: '观战中' }; this.bus.pub(this.T.act, { playerId: this.myId, action }); return { ok: true }; }
}
