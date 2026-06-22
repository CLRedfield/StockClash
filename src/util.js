// ====================== 通用工具 ======================
let _id = 1;
export const uid = (prefix = 'id') => `${prefix}_${_id++}`;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export const randInt = (n) => Math.floor(Math.random() * n);
export const pickRandom = (arr) => arr[randInt(arr.length)];

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export const sample = (arr, n) => shuffle(arr).slice(0, n);
export const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

// 简单事件总线
export class Emitter {
  constructor() { this.map = new Map(); }
  on(ev, fn) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) { this.map.get(ev)?.delete(fn); }
  emit(ev, ...args) {
    this.map.get(ev)?.forEach((fn) => { try { fn(...args); } catch (e) { console.error('[emit]', ev, e); } });
  }
}

// 可外部 resolve 的 Promise
export function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
