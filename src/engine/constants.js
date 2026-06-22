// ====================== 全局常量与配置 ======================

// 市场画像：tickVol = 每个 tick 的对数收益标准差；drift = 每局随机趋势的幅度；base = 价格量级
export const MARKETS = {
  cn:     { key: 'cn',     name: '大A',     cur: '¥',   tickVol: 0.0060, drift: 0.0008, base: 28,   hasLimit: true,  limit: 0.10 },
  hk:     { key: 'hk',     name: '港股',    cur: 'HK$', tickVol: 0.0090, drift: 0.0010, base: 46,   hasLimit: false },
  us:     { key: 'us',     name: '美股',    cur: '$',   tickVol: 0.0080, drift: 0.0012, base: 160,  hasLimit: false },
  crypto: { key: 'crypto', name: '虚拟货币', cur: '$',   tickVol: 0.0180, drift: 0.0016, base: 2400, hasLimit: false, c24: true },
};
export const MARKET_KEYS = ['cn', 'hk', 'us', 'crypto'];

// 各市场手续费（买/卖费率）—— 游戏平衡数值，可在房间内统一缩放
export const FEE_PROFILE = {
  cn:     { buy: 0.0003, sell: 0.0008 },
  hk:     { buy: 0.0013, sell: 0.0013 },
  us:     { buy: 0.0001, sell: 0.0002 },
  crypto: { buy: 0.0010, sell: 0.0010 },
};

// 标的名称池（虚构，仅作展示；蓝筹 + 妖股混搭）
export const TICKER_POOL = {
  cn: ['长江白酒', '光伏新能', '中芯半导', '宁德动力', '招商银行', '比亚迪车', '隆基绿能', '贵州酱香', '北方稀土', '三一重工', '东方财富', '中国神华'],
  hk: ['腾讯控股', '美团点评', '小米集团', '友邦保险', '汇丰控股', '比亚迪H', '快手科技', '舜宇光学', '安踏体育', '药明生物', '理想汽车H', '香港交易'],
  us: ['苹果', '英伟达', '特斯拉', '微软', '亚马逊', '谷歌', 'Meta', '台积电美', '奈飞', '超微电脑', 'AMD', '可口可乐'],
  crypto: ['比特币', '以太坊', '索拉纳', '狗狗币', '币安币', '瑞波币', '艾达币', '波场', '柴犬币', '雪崩协议', '波卡', '门罗币'],
};

// 难度 → AI 失误率（chaos 越高越随机越弱）
export const AI_CHAOS = { easy: 0.62, normal: 0.30, hard: 0.05 };
export const AI_DIFFICULTIES = [
  { key: 'easy', name: '简单', desc: '追涨杀跌、爱割肉' },
  { key: 'normal', name: '普通', desc: '趋势跟随，均衡' },
  { key: 'hard', name: '困难', desc: '会用杠杆与做空' },
];
export const DIFF_SHORT = { easy: '简', normal: '普', hard: '难' };
export const DIFF_ORDER = ['easy', 'normal', 'hard'];
export const nextDiff = (d) => DIFF_ORDER[(DIFF_ORDER.indexOf(d || 'normal') + 1) % DIFF_ORDER.length];

// AI 候选昵称
export const AI_NAMES = ['量化猫', '老韭菜', '抄底王', '追涨哥', '空军司令', '钻石手', '梭哈大师', '稳健叔', '镰刀君', '佛系散户'];

// 局时长 / 行情窗口预设
export const PRESETS = [
  { key: 'blitz',    name: '闪电', durationSec: 120, windowLabel: '2 个月', tickSec: 1 },
  { key: 'standard', name: '标准', durationSec: 240, windowLabel: '4 个月', tickSec: 1 },
  { key: 'long',     name: '长局', durationSec: 480, windowLabel: '1 年',   tickSec: 1 },
];

// 房间默认规则
export const DEFAULTS = {
  roomMode: 'classic',         // 玩法模式：'classic' 经典（固定规则）/ 'custom' 自定义（自由调节）
  preset: 'standard',
  durationSec: 240,
  tickSec: 1,
  windowLabel: '4 个月',
  initialCash: 100000,
  cashMode: 'fixed',           // 开局金钱：'fixed' 固定金额 / 'multiple' 按开盘 1 股价格的倍数
  cashMultiple: 100,           // multiple 模式：初始资金 = 倍数 × 开盘股价
  feeScale: 1,                 // 手续费整体缩放
  loanOrigination: 0.02,       // 放款即计利息
  loanAccrual: 0.02,           // 每周期复利
  loanAccrualSec: 30,          // 复利间隔（秒）
  maxLeverage: 2,              // 可借总额 = 净值 × 倍数
  maintenanceMargin: 0.25,     // 维持保证金率
  blindMode: false,            // 盲盒：隐藏标的与日期
  propMode: false,             // 道具模式
  propIntervalSec: 60,         // 发放间隔
  propSlots: 3,                // 道具栏上限
  opTimeMode: false,           // 增加操作时间：把每次刷新间隔拉长（真实时长随之变长）
  opTimeSec: 2,                // 开启后每次刷新的真实秒数（默认 2s）
  recessMode: false,           // 休市：每跑 recessRun 秒歇 recessRest 秒
  recessRun: 10,               // 休市：运行时长（秒）
  recessRest: 5,               // 休市：休息时长（秒）
  colorUp: 'green',            // 设计系统：'green' 绿涨红跌（国际惯例，品牌默认） / 'red' 红涨绿跌
};

// 经典模式：一套固定规则 —— 开局钱 = 开盘 1 股 × 100、开启休市、模拟约 3 个月、开启道具。
export const CLASSIC_RULES = {
  cashMode: 'multiple',   // 按开盘股价倍数
  cashMultiple: 100,      // 开盘 1 股 × 100
  recessMode: true,       // 休市
  durationSec: 180,       // 模拟约 3 个月（约 1 分钟 ≈ 1 个月）
  windowLabel: '3 个月',
  preset: 'custom',
  propMode: true,         // 开启道具
};

// 把经典规则覆盖到房间配置上（座位、K 线来源等不受影响）
export function applyClassicRules(room) {
  Object.assign(room, CLASSIC_RULES);
  return room;
}

// 一局时长拖条范围：1–15 分钟，步进 30 秒（始终为 10 的倍数，便于休市 ×1.5 精确对齐）
export const DURATION_MIN = 60;
export const DURATION_MAX = 900;
export const DURATION_STEP = 30;

// 休市节奏：跑 RECESS_RUN 秒，歇 RECESS_REST 秒
export const RECESS_RUN = 10;
export const RECESS_REST = 5;
export const RECESS_FACTOR = (RECESS_RUN + RECESS_REST) / RECESS_RUN; // 1.5

// 由交易时长推导行情窗口文案（约 1 分钟 ≈ 1 个月）
export function deriveWindow(durationSec) {
  const months = Math.max(1, Math.round(durationSec / 60));
  if (months < 12) return months + ' 个月';
  const years = months / 12;
  return (Number.isInteger(years) ? years : years.toFixed(1)) + ' 年';
}

export const MAX_ROOM = 10;     // 房间总人数上限（含观战）
export const NS = 'stockclash1'; // MQTT 主题命名空间
