// 智械危机征召令 · 一体化服务器：同时提供网页和模型中转，key 只留在服务器上。
//
// 需要 Node 18 及以上（node -v 查看），不需要安装任何包。
//
// 启动：
//   LLM_API_KEY=你的key INVITE_CODE=随便一串邀请码 node app.js
// 然后把这个链接发给同学：
//   http://服务器公网IP:8787/#i=邀请码
//
// 可选环境变量：
//   LLM_BASE_URL  兼容 OpenAI chat/completions 的接口，默认 https://v2-as.pincc.ai/v1
//   LLM_MODEL     模型名，可以用逗号写多个，按顺序备用：前一个返回 5xx 或限流时自动换下一个，
//                 出过错的模型 60 秒内跳过。默认 gpt-5.6-terra,gpt-5.6-sol,gpt-5.6,gpt-6-sol
//   PORT          默认 8787（记得在腾讯云安全组里放行这个端口）
//   INVITE_CODE   设了以后，只有用带 #i=邀请码 的链接打开的人能调用模型；不设则所有人都能用
//   DAILY_CAP     全站每天最多调用模型多少次，默认 3000（完整玩一遍约 17 次）
//   IP_PER_MIN    每个 IP 每分钟最多调用多少次，默认 30
//   IP_PER_DAY    每个 IP 每天最多调用多少次，默认 200
//   SITE          印在海报角落的网址，默认用访问时的地址
//
// 超过限额、邀请码不对或模型出错时，网页会自动改用内置模板出题，照样能玩完。

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const KEY = process.env.LLM_API_KEY;
const BASE = (process.env.LLM_BASE_URL || 'https://v2-as.pincc.ai/v1').replace(/\/+$/, '');
const MODELS = (process.env.LLM_MODEL || 'gpt-5.6-terra,gpt-5.6-sol,gpt-5.6,gpt-6-sol').split(',').map(s => s.trim()).filter(Boolean);
const MODEL = MODELS[0];
const downUntil = new Map(); // 模型 -> 在这个时间点之前先跳过它
const PORT = Number(process.env.PORT) || 8787;
const INVITE = process.env.INVITE_CODE || '';
const DAILY_CAP = Number(process.env.DAILY_CAP) || 3000;
const IP_PER_MIN = Number(process.env.IP_PER_MIN) || 30;
const IP_PER_DAY = Number(process.env.IP_PER_DAY) || 200;
const SITE = process.env.SITE || '';

if (!KEY) { console.error('缺少 LLM_API_KEY。用法：LLM_API_KEY=你的key node app.js'); process.exit(1); }

const PAGE = fs.readFileSync(path.join(__dirname, 'index.html'));

// ---------- 限流：每个 IP 每分钟、每天，以及全站每天 ----------
let day = new Date().toDateString(), used = 0;
const perIp = new Map(); // ip -> {min:[时间戳], day:次数}
function allow(ip) {
  const today = new Date().toDateString();
  if (today !== day) { day = today; used = 0; perIp.clear(); }
  if (used >= DAILY_CAP) return false;
  const now = Date.now(), r = perIp.get(ip) || { min: [], day: 0 };
  r.min = r.min.filter(t => now - t < 60000);
  if (r.min.length >= IP_PER_MIN || r.day >= IP_PER_DAY) { perIp.set(ip, r); return false; }
  r.min.push(now); r.day++; perIp.set(ip, r); used++;
  return true;
}

function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));

// ---------- 模型中转：只转发这个游戏的请求，模型固定，key 在服务器端补上 ----------
async function relay(req, res, raw) {
  const ip = req.socket.remoteAddress || '';
  if (INVITE && req.headers['x-invite'] !== INVITE) return json(res, 403, { error: 'bad_invite' });
  let body;
  try { body = JSON.parse(raw); } catch (_) { return json(res, 400, { error: 'bad_json' }); }
  const msgs = body && body.messages;
  const ok = Array.isArray(msgs) && msgs.length === 1 && msgs[0].role === 'user' &&
    typeof msgs[0].content === 'string' && msgs[0].content.length <= 16000 && msgs[0].content.includes('智械危机');
  if (!ok) return json(res, 400, { error: 'not_this_game' });
  if (!allow(ip)) return json(res, 429, { error: 'busy' });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  res.on('close', () => ctl.abort());
  try {
    // 按顺序试模型：5xx、限流或连不上就换下一个；出错的模型 60 秒内先跳过
    const now = Date.now();
    let order = MODELS.filter(m => !(downUntil.get(m) > now));
    if (!order.length) order = MODELS;
    let up = null;
    for (const m of order) {
      try {
        up = await fetch(BASE + '/chat/completions', {
          method: 'POST',
          signal: ctl.signal,
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
          body: JSON.stringify({ model: m, messages: msgs, stream: !!body.stream }),
        });
      } catch (e) {
        if (ctl.signal.aborted) throw e;
        up = null;
      }
      if (up && up.status < 500 && up.status !== 429) break;
      console.error(new Date().toISOString(), 'model', m, up ? up.status : 'unreachable', '-> next');
      downUntil.set(m, Date.now() + 60000);
      if (up && up.body) { try { await up.body.cancel(); } catch (_) {} }
      up = null;
    }
    if (!up) return json(res, 502, { error: 'all_models_failed' });
    res.writeHead(up.status, {
      'Content-Type': up.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    });
    if (!up.body) return res.end();
    Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
    if (!up.ok) console.error(new Date().toISOString(), 'upstream', up.status);
  } catch (e) {
    if (!res.headersSent) json(res, 502, { error: 'upstream' });
    else res.end();
    if (e.name !== 'AbortError') console.error(new Date().toISOString(), e.message);
  } finally {
    clearTimeout(timer);
  }
}

http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/index.html')) return send(res, 200, 'text/html; charset=utf-8', PAGE);
  if (req.method === 'GET' && url === '/config.js') {
    const cfg = { base: '/v1', model: MODEL, proxy: true, site: SITE || req.headers.host || '' };
    return send(res, 200, 'text/javascript; charset=utf-8', `window.ZX_CONFIG=${JSON.stringify(cfg)};`);
  }
  if (req.method === 'POST' && url === '/v1/chat/completions') {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 64000) req.destroy(); });
    req.on('end', () => relay(req, res, raw));
    return;
  }
  send(res, 404, 'text/plain; charset=utf-8', 'not found');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`智械危机征召令已启动：http://0.0.0.0:${PORT}  模型 ${MODELS.join(' → ')}  ${INVITE ? '已开启邀请码' : '未设邀请码，所有人都能调用模型'}`);
});
