// ====================== 可复现随机数（种子化） ======================
// mulberry32：快速、确定性强，房主定好种子后各端可算出完全一致的序列。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randSeed() { return (Math.random() * 4294967296) >>> 0; }

// 基于某 rng 的标准正态（Box-Muller）
export function gaussianFrom(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
