// ====================== 数字 / 货币 / 百分比格式化 ======================

// 价格：根据量级选小数位
export function fmtPrice(n) {
  if (n == null || isNaN(n)) return '--';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

// 金额（带货币符号，整数千分位）
export function fmtMoney(n, cur = '¥') {
  if (n == null || isNaN(n)) return cur + '0';
  const sign = n < 0 ? '-' : '';
  return sign + cur + Math.round(Math.abs(n)).toLocaleString('en-US');
}

// 紧凑金额（万 / 亿）
export function fmtCompact(n, cur = '¥') {
  const a = Math.abs(n), sign = n < 0 ? '-' : '';
  if (a >= 1e8) return sign + cur + (a / 1e8).toFixed(2) + '亿';
  if (a >= 1e4) return sign + cur + (a / 1e4).toFixed(2) + '万';
  return sign + cur + Math.round(a).toLocaleString('en-US');
}

// 百分比（带符号）
export function fmtPct(n) {
  if (n == null || isNaN(n)) return '--';
  return (n >= 0 ? '+' : '') + (n * 100).toFixed(2) + '%';
}

// 时间 mm:ss
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
