// ====================== 入口 ======================
import { Lobby } from './ui/lobby.js';

const app = document.getElementById('app');
const lobby = new Lobby(app);

// 简短开屏后进入大厅
setTimeout(() => lobby.show(), 500);

window.addEventListener('error', (e) => console.error('[global]', e.error || e.message));
