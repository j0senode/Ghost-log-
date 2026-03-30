'use strict';

const { WebSocketServer } = require('ws');

const HANDSHAKE_HEADER = 'x-logwatch-acknowledge';
const HANDSHAKE_PATH   = '/__logwatch__/handshake';
const WS_PATH          = '/__logwatch__/stream';
const REDACT_KEYS      = ['password', 'token', 'secret', 'authorization', 'cookie', 'x-api-key', 'api_key', 'apikey', 'credit_card', 'cvv', 'ssn'];
const MAX_BODY_SIZE    = 4096;
const LOG_QUEUE_LIMIT  = 500;

function redact(obj, depth = 0) {
  if (depth > 6 || obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(v => redact(v, depth + 1));
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    out[key] = REDACT_KEYS.some(k => key.toLowerCase().includes(k)) ? '[REDACTED]' : redact(val, depth + 1);
  }
  return out;
}

function parseBody(raw) {
  if (!raw) return null;
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_SIZE) return { _note: `[body truncated — exceeded ${MAX_BODY_SIZE}b]` };
  try { return JSON.parse(raw); } catch { return { _raw: raw.slice(0, 200) }; }
}

function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function buildPacket(req, res, rawBody, startTime) {
  const status   = res.statusCode;
  const success  = status >= 200 && status < 300;
  return {
    timestamp : new Date().toISOString(),
    method    : req.method,
    endpoint  : req.path || req.url,
    url       : req.originalUrl || req.url,
    status,
    success,
    latency   : Date.now() - startTime,
    ip        : getIP(req),
    error_log : res.__logwatch_error || null,
    headers   : redact({ ...req.headers }),
    body      : rawBody ? redact(parseBody(rawBody)) : null,
    query     : Object.keys(req.query || {}).length ? redact(req.query) : null,
  };
}

function createLogWatchServer(httpServer, app, options = {}) {
  const PIN     = options.pin || process.env.MONITOR_PIN;
  const throttle = options.throttle ?? 0;

  if (!PIN) console.warn('[LogWatch] ⚠  MONITOR_PIN not set — all PIN attempts will fail.');

  const clients  = new Set();
  const logQueue = [];
  let   throttleTick = 0;

  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on('connection', (ws, req) => {
    let authenticated = false;
    const origin = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';

    console.log(`[LogWatch] New WS connection from ${origin}`);
    ws.send(JSON.stringify({ type: 'challenge', message: 'Provide PIN to authenticate.' }));

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return ws.close(1008, 'Bad message'); }

      if (msg.type === 'auth') {
        if (!PIN || String(msg.pin || '').trim() !== PIN) {
          console.warn(`[LogWatch] Failed PIN attempt from ${origin}`);
          ws.send(JSON.stringify({ type: 'auth_fail', message: 'Incorrect PIN. Connection terminated.' }));
          return ws.close(1008, 'Auth failed');
        }
        authenticated = true;
        clients.add(ws);
        console.log(`[LogWatch] Authenticated from ${origin} (${clients.size} active)`);
        ws.send(JSON.stringify({ type: 'auth_ok', message: 'Authenticated. Streaming logs.' }));
        const replay = logQueue.slice(-50);
        if (replay.length) ws.send(JSON.stringify({ type: 'replay', logs: replay }));
        return;
      }

      if (!authenticated) return ws.close(1008, 'Not authenticated');
      if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    });

    ws.on('close', () => { clients.delete(ws); console.log(`[LogWatch] Disconnected from ${origin} (${clients.size} active)`); });
    ws.on('error', (err) => { console.error(`[LogWatch] WS error:`, err.message); clients.delete(ws); });
  });

  // Handshake route — registered before user routes
  app.get(HANDSHAKE_PATH, (_req, res) => {
    res.set(HANDSHAKE_HEADER, 'true');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Expose-Headers', HANDSHAKE_HEADER);
    res.status(200).json({ logwatch: true, version: '1.0.0' });
  });

  function broadcast(packet) {
    const payload = JSON.stringify({ type: 'log', data: packet });
    for (const client of clients) {
      if (client.readyState === 1) {
        try { client.send(payload); } catch { clients.delete(client); }
      }
    }
  }

  function middleware(req, res, next) {
    if (req.path === HANDSHAKE_PATH || req.url?.startsWith(WS_PATH)) return next();
    const startTime = Date.now();
    let rawBody = null;
    if (req.body && typeof req.body === 'object') {
      try { rawBody = JSON.stringify(req.body); } catch {}
    }
    const originalEnd = res.end.bind(res);
    res.end = function (chunk, encoding, callback) {
      if (throttle > 0 && ++throttleTick % throttle !== 0) return originalEnd(chunk, encoding, callback);
      const packet = buildPacket(req, res, rawBody, startTime);
      logQueue.push(packet);
      if (logQueue.length > LOG_QUEUE_LIMIT) logQueue.shift();
      setImmediate(() => broadcast(packet));
      return originalEnd(chunk, encoding, callback);
    };
    next();
  }

  function errorHandler(err, req, res, next) {
    res.__logwatch_error = err?.message || String(err);
    next(err);
  }

  function close() {
    for (const client of clients) { try { client.close(); } catch {} }
    wss.close();
  }

  console.log(`[LogWatch] ✓ Active — WS: ${WS_PATH} | Handshake: ${HANDSHAKE_PATH}`);
  return { middleware, errorHandler, close };
}

module.exports = { createLogWatchServer };
