// ====================== 公共 MQTT 传输层（免费 / 免注册 / 国内可用） ======================
// 与 hearthStoneKill2 同款：默认 EMQX 免费公共 broker。
import mqtt from 'mqtt';
import { NS } from '../engine/constants.js';

export const DEFAULT_BROKER = 'wss://broker.emqx.io:8084/mqtt';
export const BROKER_ALTERNATIVES = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker-cn.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export function getBroker() { return localStorage.getItem('sc_broker') || DEFAULT_BROKER; }
export function storeBroker(u) { localStorage.setItem('sc_broker', u); }

export function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
export function genClientId() {
  let id = sessionStorage.getItem('sc_cid');
  if (!id) { id = 'u' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('sc_cid', id); }
  return id;
}

export function topics(code) {
  const base = `${NS}/${code}`;
  return {
    lobby: `${base}/lobby`,        // 房间信息（retained，房主发布）
    join: `${base}/join`,          // 加入请求
    move: `${base}/move`,          // 换座申请
    feed: `${base}/feed`,          // 逐 tick 行情（房主发布，核心频道）
    act: `${base}/act`,            // 玩家操作 → 房主
    fx: `${base}/fx`,              // 动画特效广播
    end: `${base}/end`,            // 结算广播
    rank: `${base}/rank`,          // 公共排行
    chat: `${base}/chat`,
    state: (pid) => `${base}/st/${pid}`,  // 各玩家私有快照
    insider: (pid) => `${base}/in/${pid}`,// 内幕消息私发
  };
}

export class MqttBus {
  constructor(broker) {
    this.broker = broker || getBroker();
    this.client = null;
    this.handlers = new Map();
    this.subscribed = new Set();
    this.statusCb = null;
  }
  onStatus(fn) { this.statusCb = fn; }
  _status(s) { try { this.statusCb?.(s); } catch (e) {} }

  connect() {
    return new Promise((resolve, reject) => {
      let done = false;
      this.client = mqtt.connect(this.broker, {
        clientId: 'sc_' + Math.random().toString(16).slice(2, 10),
        clean: true, connectTimeout: 9000, reconnectPeriod: 4000, keepalive: 30,
      });
      this.client.on('connect', () => { if (!done) { done = true; storeBroker(this.broker); resolve(); } else this._status('connect'); });
      this.client.on('reconnect', () => this._status('reconnect'));
      this.client.on('offline', () => this._status('offline'));
      this.client.on('close', () => { if (done) this._status('offline'); });
      this.client.on('error', (e) => { if (!done) { done = true; reject(e); } });
      this.client.on('message', (topic, payload) => this._onMessage(topic, payload));
      setTimeout(() => { if (!done) { done = true; reject(new Error('连接超时')); } }, 10000);
    });
  }
  _onMessage(topic, payload) {
    let data; try { data = JSON.parse(payload.toString()); } catch (e) { return; }
    const set = this.handlers.get(topic);
    if (set) set.forEach((fn) => { try { fn(data, topic); } catch (err) { console.error('[mqtt handler]', err); } });
  }
  sub(topic, fn, opts = {}) {
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic).add(fn);
    if (!this.subscribed.has(topic)) { this.subscribed.add(topic); this.client.subscribe(topic, { qos: opts.qos ?? 1 }); }
    return () => this.handlers.get(topic)?.delete(fn);
  }
  pub(topic, data, opts = {}) {
    if (!this.client) return;
    this.client.publish(topic, JSON.stringify(data), { qos: opts.qos ?? 1, retain: !!opts.retain });
  }
  clearRetained(topic) { if (this.client) this.client.publish(topic, '', { qos: 0, retain: true }); }
  end() { try { this.client?.end(true); } catch (e) {} }
  get connected() { return !!this.client?.connected; }
}
