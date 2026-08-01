// 竞速答题服务器
// 提供：静态页面(主持人/玩家/编辑) + 视频文件 + 题目读写 API + WebSocket 实时游戏
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const VIDEO_DIR = path.join(ROOT, 'videos');
const AVATAR_DIR = path.join(ROOT, 'avatars');
const QUESTIONS_FILE = path.join(ROOT, 'data', 'questions.json');

// ---------- 工具 ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

const LAN_IP = getLanIp();
// 云端部署时用公网地址（Render 注入 RENDER_EXTERNAL_URL；Railway 注入 RAILWAY_PUBLIC_DOMAIN）；否则用局域网地址
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '';
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || RAILWAY_URL || '').replace(/\/+$/, '');
let JOIN_URL = PUBLIC_URL ? `${PUBLIC_URL}/player` : `http://${LAN_IP}:${PORT}/player`;

function loadQuestions() {
  try {
    const raw = fs.readFileSync(QUESTIONS_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data.questions) ? data.questions : [];
  } catch (e) {
    console.error('读取题目失败:', e.message);
    return [];
  }
}

function saveQuestions(questions) {
  const dir = path.dirname(QUESTIONS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify({ questions }, null, 2), 'utf-8');
}

// ---------- 静态视频/文件范围请求(支持视频拖动) ----------
function serveFile(req, res, filePath) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('文件不存在: ' + path.basename(filePath));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      if (start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
      });
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

function safeJoin(base, target) {
  const p = path.normalize(path.join(base, target));
  if (!p.startsWith(base)) return null; // 防目录穿越
  return p;
}

// ---------- HTTP 服务 ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { pathname = url.pathname; } // 非法编码不再让服务器崩溃

  // 题目读取
  if (pathname === '/api/questions' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ questions: loadQuestions() }));
    return;
  }
  // 题目保存
  if (pathname === '/api/questions' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const questions = Array.isArray(data.questions) ? data.questions : [];
        saveQuestions(questions);
        res.writeHead(200, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: true, count: questions.length }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': MIME['.json'] });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
    });
    return;
  }
  // 上传本地视频到 videos/ 目录（编辑器用）
  if (pathname === '/api/upload' && req.method === 'POST') {
    const filename = url.searchParams.get('name') || `upload_${Date.now()}.mp4`;
    const safeName = path.basename(filename).replace(/[^\w.\-一-龥]/g, '_');
    if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
    const dest = path.join(VIDEO_DIR, safeName);
    const out = fs.createWriteStream(dest);
    req.pipe(out);
    out.on('finish', () => {
      res.writeHead(200, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ ok: true, path: `/videos/${safeName}` }));
    });
    out.on('error', (e) => {
      res.writeHead(500, { 'Content-Type': MIME['.json'] });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    });
    return;
  }
  // 列出 videos 目录已有文件
  if (pathname === '/api/videos' && req.method === 'GET') {
    let list = [];
    try {
      if (fs.existsSync(VIDEO_DIR)) {
        const files = fs.readdirSync(VIDEO_DIR).filter((f) => MIME[path.extname(f).toLowerCase()]);
        // 若同名已有 .mp4，则隐藏对应的 .mov（.mov 多为 HEVC，浏览器只出声不出画）
        const mp4Bases = new Set(
          files.filter((f) => path.extname(f).toLowerCase() === '.mp4')
               .map((f) => f.slice(0, -4).toLowerCase())
        );
        list = files
          .filter((f) => !(path.extname(f).toLowerCase() === '.mov' && mp4Bases.has(f.slice(0, -4).toLowerCase())))
          .map((f) => `/videos/${f}`);
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ videos: list }));
    return;
  }
  // 列出 avatars 目录里的头像图片（头像库）
  if (pathname === '/api/avatars' && req.method === 'GET') {
    let list = [];
    try {
      if (fs.existsSync(AVATAR_DIR)) {
        const imgExt = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
        list = fs.readdirSync(AVATAR_DIR)
          .filter((f) => imgExt.includes(path.extname(f).toLowerCase()))
          .map((f) => `/avatars/${f}`);
      }
    } catch (_) {}
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ avatars: list }));
    return;
  }
  // 加入信息（二维码 + 地址）
  if (pathname === '/api/joininfo' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'] });
    res.end(JSON.stringify({ joinUrl: JOIN_URL, qr: qrDataUrl }));
    return;
  }

  // 视频文件
  if (pathname.startsWith('/videos/')) {
    const target = safeJoin(VIDEO_DIR, pathname.slice('/videos/'.length));
    if (!target) { res.writeHead(403); res.end(); return; }
    serveFile(req, res, target);
    return;
  }

  // 头像图片
  if (pathname.startsWith('/avatars/')) {
    const target = safeJoin(AVATAR_DIR, pathname.slice('/avatars/'.length));
    if (!target) { res.writeHead(403); res.end(); return; }
    serveFile(req, res, target);
    return;
  }

  // 页面路由
  let filePath;
  if (pathname === '/' || pathname === '/host') filePath = path.join(PUBLIC_DIR, 'host.html');
  else if (pathname === '/player') filePath = path.join(PUBLIC_DIR, 'player.html');
  else if (pathname === '/editor') filePath = path.join(PUBLIC_DIR, 'editor.html');
  else {
    const target = safeJoin(PUBLIC_DIR, pathname);
    if (!target) { res.writeHead(403); res.end(); return; }
    filePath = target;
  }
  serveFile(req, res, filePath);
});

// ---------- 加入地址 + 二维码 ----------
let qrDataUrl = '';
// 更新加入地址并重新生成二维码，然后广播给主持人（二维码会实时刷新）
function updateJoin(playerUrl) {
  JOIN_URL = playerUrl;
  QRCode.toDataURL(playerUrl, { width: 320, margin: 1 }, (err, dataUrl) => {
    if (!err) { qrDataUrl = dataUrl; broadcast(); }
  });
}
updateJoin(JOIN_URL); // 初始为局域网地址

// ---------- Cloudflare 公网隧道（--tunnel 时启用，供手机流量访问）----------
function startTunnel() {
  const { spawn } = require('child_process');
  // 优先用项目目录下的 cloudflared.exe，否则用 PATH 里的 cloudflared
  const localBin = path.join(ROOT, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  const bin = fs.existsSync(localBin) ? localBin : 'cloudflared';
  console.log('正在建立公网隧道（Cloudflare）……请稍候几秒');
  let cf;
  try {
    // --protocol http2：强制走 TCP 443，绕开公司防火墙常拦的 QUIC/UDP(7844)，
    //                    否则会出现「网址生成了但隧道连不上 → 手机报 Error 1033」。
    // --edge-ip-version 4：只用 IPv4 边缘节点，避免 IPv6 环境握手失败。
    cf = spawn(bin, [
      'tunnel',
      '--url', `http://localhost:${PORT}`,
      '--no-autoupdate',
      '--protocol', 'http2',
      '--edge-ip-version', '4',
    ], { windowsHide: true });
  } catch (e) {
    console.error('无法启动 cloudflared:', e.message);
    return;
  }
  const onData = (buf) => {
    const text = buf.toString();
    // 提取真正的隧道地址：形如 https://xxx-yyy-zzz.trycloudflare.com
    // 注意排除 api.trycloudflare.com（那是 Cloudflare 的接口地址，不是隧道）
    const all = text.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/gi) || [];
    const url = all.find((u) => !/^https:\/\/api\./i.test(u));
    if (url && JOIN_URL.indexOf('trycloudflare') === -1) {
      console.log('\n✅ 公网地址已生成:', url);
      console.log('   手机（任意网络/流量）扫描主持人大屏的二维码即可加入。\n');
      updateJoin(url + '/player');
    }
    // 隧道真正连上（出现 Registered tunnel connection 才代表可用）
    if (/Registered tunnel connection/i.test(text)) {
      console.log('   ✔ 隧道连接已注册，公网地址现在可用了。');
    }
    // 隧道建立失败时提示（常见于公司防火墙拦截）
    if (/failed to request quick Tunnel|Unable to reach the origin|context deadline exceeded|Failed to (dial|serve)|no more connections active|Lost connection/i.test(text)) {
      console.error('\n⚠️  公网隧道连接不稳定/失败，多半是公司网络或防火墙拦截了 Cloudflare。');
      console.error('   → 手机会看到 Error 1033。可换网络（如用手机热点给这台电脑联网），或改用局域网模式(run.bat)。\n');
    }
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);
  cf.on('error', (e) => console.error('cloudflared 出错:', e.message, '\n请确认 cloudflared 已就绪、且电脑能访问外网。'));
  // 退出时清理隧道进程
  const kill = () => { try { cf.kill(); } catch (_) {} };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(0); });
  process.on('SIGTERM', () => { kill(); process.exit(0); });
}

// ---------- ngrok 公网隧道（--ngrok 时启用，走 443，适合封了 7844 的网络）----------
// 用 ngrok 官方 Node SDK(@ngrok/ngrok)，数据通道走 443，能穿过只放行 443 的防火墙。
// （Cloudflare 免费隧道必须走 7844，那种被封 7844 的网络会一直 Error 1033，改用 ngrok 即可。）
async function startNgrok() {
  // 读取 authtoken：优先环境变量，其次项目里的 ngrok-token.txt
  let token = (process.env.NGROK_AUTHTOKEN || '').trim();
  const tokenFile = path.join(ROOT, 'ngrok-token.txt');
  if (!token && fs.existsSync(tokenFile)) {
    // 取第一行非空、非 # 注释的内容作为 token（文件里可写说明）
    const raw = fs.readFileSync(tokenFile, 'utf8').replace(/^﻿/, '');
    token = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#')) || '';
    if (token === '在此粘贴你的ngrok-token') token = ''; // 还没替换占位符
  }
  if (!token) {
    console.error('\n⚠️  还没有 ngrok token，无法建立公网隧道。');
    console.error('   1) 免费注册并登录 https://dashboard.ngrok.com');
    console.error('   2) 打开 https://dashboard.ngrok.com/get-started/your-authtoken 复制那一串 token');
    console.error('   3) 把它粘贴到本文件夹的 ngrok-token.txt 里，保存后重新启动本程序。\n');
    return;
  }

  let ngrok;
  try {
    ngrok = require('@ngrok/ngrok');
  } catch (e) {
    console.error('\n⚠️  未安装 @ngrok/ngrok 模块，请在本文件夹执行: npm install @ngrok/ngrok\n');
    return;
  }

  console.log('正在建立公网隧道（ngrok，走 443）……请稍候几秒');
  const baseOpts = { addr: PORT, authtoken: token };

  const succeed = (listener) => {
    const url = listener.url();
    console.log('\n✅ 公网地址已生成:', url);
    console.log('   手机（任意网络/流量）扫描主持人大屏的二维码即可加入。\n');
    updateJoin(url + '/player');
    const kill = () => { try { ngrok.disconnect(); ngrok.kill(); } catch (_) {} };
    process.on('exit', kill);
    process.on('SIGINT', () => { kill(); process.exit(0); });
    process.on('SIGTERM', () => { kill(); process.exit(0); });
  };
  const fail = (m) => {
    console.error('\n⚠️  ngrok 隧道建立失败:', m);
    if (/authtoken|authentication|ERR_NGROK_105|invalid/i.test(m)) {
      console.error('   → token 可能无效/过期，请重新复制到 ngrok-token.txt 后重启。\n');
    } else if (/ERR_NGROK_108|simultaneous|already online/i.test(m)) {
      console.error('   → 该账号已有隧道在跑（免费版限 1 个），关掉其它 ngrok 后重试。\n');
    } else if (/tls handshake|handshake|certificate|x509|self.?signed/i.test(m)) {
      console.error('   → 仍是 TLS 握手失败。多半是公司代理拦截了 ngrok，且拦截证书不在系统信任库。');
      console.error('     可换用手机热点联网后重试，或联系网络管理员放行 *.ngrok-agent.com。\n');
    } else {
      console.error('   → 请确认电脑能访问外网(443)。\n');
    }
  };

  try {
    // 先按默认方式连
    succeed(await ngrok.forward(baseOpts));
  } catch (e1) {
    const m1 = String((e1 && e1.message) || e1);
    // 常见于公司 HTTPS 中间人拦截：改用系统证书库(含公司拦截根证书)重试
    if (/tls handshake|handshake|certificate|x509|self.?signed/i.test(m1)) {
      console.log('   检测到 TLS 拦截，改用本机系统证书库重试……');
      try {
        succeed(await ngrok.forward({ ...baseOpts, root_cas: 'host' }));
      } catch (e2) {
        fail(String((e2 && e2.message) || e2));
      }
    } else {
      fail(m1);
    }
  }
}

// ================= 游戏状态 =================
// 阶段: lobby(等待) | intro(播放题目视频) | answering(答题) | reveal(公布答案+片段+排名) | results(结算)
const game = {
  phase: 'lobby',
  questions: [],
  qIndex: -1,
  answerOpenAt: 0, // 选项开放时间戳(用于测速)
  answerTimer: null, // 限时自动结束定时器
  players: new Map(), // id -> {id, nickname, avatar, score, totalTime, answers:{qIndex:{option,timeMs,correct,gain}}, connected}
};

let hostSocket = null;

function genId() {
  return 'p' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// 计算某玩家的排名列表（分数降序，用时升序）
function rankedPlayers() {
  const arr = [...game.players.values()];
  arr.sort((a, b) => (b.score - a.score) || (a.totalTime - b.totalTime));
  return arr.map((p, i) => ({ ...p, rank: i + 1 }));
}

// 玩家精简信息（对外广播，不含内部结构）
// qForAnswered: 用哪一题判断“是否已作答”(答题/公布阶段=当前题)
// reveal: 是否透露对错与得分(仅公布/结果阶段)
function playerSummary(p, qForAnswered, reveal) {
  const cur = qForAnswered != null ? p.answers[qForAnswered] : null;
  return {
    id: p.id,
    rank: p.rank || 0,
    nickname: p.nickname,
    avatar: p.avatar,
    score: p.score,
    totalTime: p.totalTime,
    connected: p.connected,
    answered: cur != null,
    lastCorrect: reveal && cur ? cur.correct : null,
    lastGain: reveal && cur ? cur.gain : 0,
  };
}

// 当前题目对外视图（答题阶段隐藏正确答案）
function questionView(reveal) {
  if (game.qIndex < 0 || game.qIndex >= game.questions.length) return null;
  const q = game.questions[game.qIndex];
  return {
    index: game.qIndex,
    total: game.questions.length,
    prompt: q.prompt,
    questionVideo: q.questionVideo || '',
    timeLimit: q.timeLimit || 20,
    options: (q.options || []).map((o) => ({
      text: o.text,
      // 只有公布答案后才带上选项对应视频片段
      video: reveal ? (o.video || '') : '',
    })),
    correctIndex: reveal ? q.correctIndex : null,
  };
}

// 构建广播状态
function buildState(forHost) {
  const reveal = game.phase === 'reveal' || game.phase === 'results';
  const ranked = rankedPlayers();
  // 答题/公布阶段都按当前题判断“是否已作答”
  const answerQ = (game.phase === 'answering' || game.phase === 'reveal') ? game.qIndex : null;
  const state = {
    type: 'state',
    phase: game.phase,
    joinUrl: JOIN_URL,
    qr: qrDataUrl,
    question: questionView(reveal),
    totalQuestions: game.questions.length,
    ranking: ranked.map((p) => playerSummary(p, answerQ, reveal)),
    playerCount: game.players.size,
    serverNow: Date.now(), // 供客户端校准时钟做倒计时
  };
  // 答题阶段带上截止时间戳，客户端据此显示倒计时
  if (game.phase === 'answering' && game.qIndex >= 0 && game.qIndex < game.questions.length) {
    const q = game.questions[game.qIndex];
    state.answerDeadline = game.answerOpenAt + (q.timeLimit || 20) * 1000;
    state.timeLimit = q.timeLimit || 20;
  }
  if (game.phase === 'results') {
    // 结果页：所有题目 + 每个选项的视频片段
    state.allQuestions = game.questions.map((q, i) => ({
      index: i,
      prompt: q.prompt,
      questionVideo: q.questionVideo || '',
      correctIndex: q.correctIndex,
      options: (q.options || []).map((o) => ({ text: o.text, video: o.video || '' })),
    }));
  }
  return state;
}

function broadcast() {
  const hostState = JSON.stringify(buildState(true));
  const playerState = JSON.stringify(buildState(false));
  wss.clients.forEach((ws) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.role === 'host') ws.send(hostState);
    else ws.send(playerState);
  });
}

// 发给单个玩家其个人信息（含 playerId）
function sendSelf(ws, player) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'self', player: playerSummary(player, null), id: player.id }));
  }
}

// ---------- 游戏动作 ----------
function startGame() {
  game.questions = loadQuestions();
  game.qIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0;
    p.totalTime = 0;
    p.answers = {};
  }
  gotoQuestion(0);
}

function gotoQuestion(idx) {
  clearAnswerTimer();
  if (idx >= game.questions.length) {
    game.phase = 'results';
    broadcast();
    return;
  }
  game.qIndex = idx;
  game.phase = 'intro'; // 先播放题目视频
  broadcast();
}

function clearAnswerTimer() {
  if (game.answerTimer) { clearTimeout(game.answerTimer); game.answerTimer = null; }
}

function showOptions() {
  if (game.phase !== 'intro') return;
  game.phase = 'answering';
  game.answerOpenAt = Date.now();
  // 限时倒计时：到点自动结束答题（公布答案）
  const q = game.questions[game.qIndex];
  const ms = (q.timeLimit || 20) * 1000;
  clearAnswerTimer();
  const qIndexAtStart = game.qIndex;
  game.answerTimer = setTimeout(() => {
    if (game.phase === 'answering' && game.qIndex === qIndexAtStart) revealAnswer();
  }, ms);
  broadcast();
}

function revealAnswer() {
  if (game.phase !== 'answering' && game.phase !== 'intro') return;
  clearAnswerTimer();
  // 若还没开放选项直接公布，则视为无人作答
  game.phase = 'reveal';
  broadcast();
}

function nextQuestion() {
  if (game.qIndex + 1 >= game.questions.length) {
    game.phase = 'results';
    broadcast();
  } else {
    gotoQuestion(game.qIndex + 1);
  }
}

function resetGame() {
  clearAnswerTimer();
  game.phase = 'lobby';
  game.qIndex = -1;
  for (const p of game.players.values()) {
    p.score = 0;
    p.totalTime = 0;
    p.answers = {};
  }
  broadcast();
}

function handleAnswer(player, optionIndex) {
  if (game.phase !== 'answering') return;
  if (player.answers[game.qIndex] != null) return; // 已答
  const q = game.questions[game.qIndex];
  const timeLimit = (q.timeLimit || 20) * 1000;
  const timeMs = Math.max(0, Date.now() - game.answerOpenAt);
  const correct = optionIndex === q.correctIndex;
  let gain = 0;
  if (correct) {
    // 基础 500 + 速度奖励 500（越快越高），超时按满时长计
    const ratio = Math.min(1, timeMs / timeLimit);
    gain = Math.round(500 + 500 * (1 - ratio));
  }
  player.answers[game.qIndex] = { option: optionIndex, timeMs, correct, gain };
  player.score += gain;
  player.totalTime += timeMs;
  broadcast();
}

// ================= WebSocket =================
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.role = 'player';
  ws.playerId = null;

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    switch (msg.type) {
      case 'hostJoin': {
        ws.role = 'host';
        hostSocket = ws;
        ws.send(JSON.stringify(buildState(true)));
        break;
      }
      case 'playerJoin': {
        const id = genId();
        const player = {
          id,
          nickname: (msg.nickname || '玩家').toString().slice(0, 16),
          avatar: (msg.avatar || '🐼').toString().slice(0, 200),
          score: 0,
          totalTime: 0,
          answers: {},
          connected: true,
        };
        game.players.set(id, player);
        ws.role = 'player';
        ws.playerId = id;
        sendSelf(ws, player);
        broadcast();
        break;
      }
      case 'playerReconnect': {
        const player = game.players.get(msg.playerId);
        if (player) {
          player.connected = true;
          if (msg.nickname) player.nickname = msg.nickname.toString().slice(0, 16);
          if (msg.avatar) player.avatar = msg.avatar.toString().slice(0, 200);
          ws.role = 'player';
          ws.playerId = player.id;
          sendSelf(ws, player);
          broadcast();
        } else {
          // 旧 id 失效，让前端重新加入
          ws.send(JSON.stringify({ type: 'needRejoin' }));
        }
        break;
      }
      case 'playerUpdate': {
        // 仅在大厅（未开始答题）允许修改昵称/头像
        if (game.phase !== 'lobby') break;
        const player = game.players.get(ws.playerId);
        if (player) {
          if (typeof msg.nickname === 'string' && msg.nickname.trim()) {
            player.nickname = msg.nickname.trim().slice(0, 16);
          }
          if (typeof msg.avatar === 'string' && msg.avatar) {
            player.avatar = msg.avatar.slice(0, 200);
          }
          sendSelf(ws, player);
          broadcast();
        }
        break;
      }
      case 'answer': {
        const player = game.players.get(ws.playerId);
        if (player) handleAnswer(player, msg.optionIndex);
        break;
      }
      // ---- 主持人控制 ----
      case 'hostStart': if (ws.role === 'host') startGame(); break;
      case 'hostShowOptions': if (ws.role === 'host') showOptions(); break;
      case 'hostReveal': if (ws.role === 'host') revealAnswer(); break;
      case 'hostNext': if (ws.role === 'host') nextQuestion(); break;
      case 'hostResults': if (ws.role === 'host') { game.phase = 'results'; broadcast(); } break;
      case 'hostReset': if (ws.role === 'host') resetGame(); break;
      case 'hostKick': {
        if (ws.role === 'host' && msg.playerId) {
          game.players.delete(msg.playerId);
          broadcast();
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.role === 'host' && hostSocket === ws) hostSocket = null;
    if (ws.playerId) {
      const p = game.players.get(ws.playerId);
      if (p) { p.connected = false; broadcast(); }
    }
  });
});

server.listen(PORT, () => {
  console.log('\n=== 竞速答题服务器已启动 ===');
  console.log(`主持人大屏:  http://localhost:${PORT}/host`);
  console.log(`题目编辑页:  http://localhost:${PORT}/editor`);
  console.log(`玩家加入(手机扫码或输入): ${JOIN_URL}`);
  if (PUBLIC_URL) {
    // 云端部署：直接用公网地址，不需要本机隧道
    console.log(`\n✅ 云端公网地址: ${PUBLIC_URL}`);
    console.log(`   主持人打开 ${PUBLIC_URL}/host ，玩家扫码进 ${JOIN_URL}\n`);
  } else if (process.argv.includes('--ngrok') || process.env.NGROK) {
    startNgrok(); // ngrok 公网模式（走 443，适合封了 7844 的网络）
  } else if (process.argv.includes('--tunnel') || process.env.TUNNEL) {
    startTunnel(); // Cloudflare 公网模式：手机用流量即可加入
  } else {
    console.log('\n请确保手机与本电脑处于同一 WiFi/局域网。\n');
  }
});
