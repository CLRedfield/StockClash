// ====================== 轻量音效（Web Audio 程序合成，无音频文件） ======================
// 全部为即时合成音，受静音开关控制；偏好存 localStorage（默认开）。
// 浏览器策略要求「用户手势后」才能出声，故在进入对局（开始游戏的点击栈内）解锁 AudioContext。

let ctx = null;
let enabled = (localStorage.getItem('sc_sound') ?? '1') === '1';

function ensureCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// 在用户手势栈内调用一次以解锁播放（如「开始游戏」点击 → 进入对局）
export function unlockAudio() { if (enabled) ensureCtx(); }

export function isSoundOn() { return enabled; }
export function setSoundOn(v) {
  enabled = !!v;
  try { localStorage.setItem('sc_sound', enabled ? '1' : '0'); } catch (e) {}
  if (enabled) ensureCtx();
}
export function toggleSound() { setSoundOn(!enabled); return enabled; }

// notes: [{ f, f2?, t?, d, type?, g? }] —— f 频率Hz；f2 滑音终点；t 相对起始秒；d 时长秒；type 波形；g 相对增益
function playNotes(notes, masterGain = 0.16) {
  if (!enabled) return;
  const ac = ensureCtx(); if (!ac || ac.state !== 'running') return;
  const now = ac.currentTime;
  for (const n of notes) {
    const t0 = now + (n.t || 0);
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = n.type || 'sine';
    osc.frequency.setValueAtTime(n.f, t0);
    if (n.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, n.f2), t0 + n.d);
    const peak = Math.max(0.0002, (n.g ?? 1) * masterGain);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.d);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + n.d + 0.03);
  }
}

const SFX = {
  buy:       [{ f: 523, d: 0.10, type: 'triangle' }, { f: 784, t: 0.06, d: 0.12, type: 'triangle' }], // 上行
  sell:      [{ f: 494, d: 0.10, type: 'triangle' }, { f: 330, t: 0.06, d: 0.12, type: 'triangle' }], // 下行
  error:     [{ f: 196, d: 0.16, type: 'sawtooth', g: 0.7 }],
  prop:      [{ f: 880, d: 0.07, type: 'sine' }, { f: 1318, t: 0.05, d: 0.10, type: 'sine' }],
  crash:     [{ f: 320, f2: 90, d: 0.42, type: 'sawtooth', g: 0.9 }],
  pump:      [{ f: 420, f2: 1040, d: 0.42, type: 'sawtooth', g: 0.8 }],
  liquidate: [{ f: 260, f2: 70, d: 0.5, type: 'square', g: 0.9 }],
  win:       [{ f: 523, d: 0.14 }, { f: 659, t: 0.12, d: 0.14 }, { f: 784, t: 0.24, d: 0.14 }, { f: 1046, t: 0.36, d: 0.24 }],
  lose:      [{ f: 392, d: 0.18 }, { f: 311, t: 0.16, d: 0.18 }, { f: 247, t: 0.32, d: 0.30 }],
  click:     [{ f: 660, d: 0.05, type: 'sine', g: 0.6 }],
};

export function playSfx(name) { const s = SFX[name]; if (s) playNotes(s); }
