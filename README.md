# Log Watch

Live Demo : https://vimeo.com/1178584580?share=copy&fl=sv&fe=ci

A real-time API observability tool with a zero-trace architecture.

Most monitoring tools store your request data — IPs, payloads, auth headers — on a third-party server. GhostLog doesn't. The server never writes a log to disk or a database. Once a request is broadcast over WebSocket, it's gone from memory. All history lives in the browser.

Log Watch Ping Test Image
<img width="948" height="412" alt="image" src="https://github.com/user-attachments/assets/9e1b6d9c-dc21-4cc2-8fe0-8cd9effccfa0" />

Log Watch Dashboard Image
<img width="1600" height="706" alt="image" src="https://github.com/user-attachments/assets/a44e4614-d5bf-40e2-81bf-170e8e10a872" />



---

## How it works

```
Browser (dashboard)                  Your Express server
───────────────────                  ──────────────────
GET /__ghostlog__/handshake ───────→ returns x-logwatch-acknowledge: true
                                     (404 if middleware not installed)

ws://.../__ghostlog__/stream ──────→ WebSocket opened
                            ←─────── { type: 'challenge' }
{ type: 'auth', pin: '...' } ──────→ PIN checked against .env
                            ←─────── { type: 'auth_ok' } or close(1008)

Every incoming request to your API:
                            ←─────── { type: 'log', data: { ... } }
```

**Permission-first.** The dashboard cannot connect to a server that hasn't installed the middleware. No handshake header, no connection.

**Zero-trace.** The middleware never writes to disk or a database. Once a log packet is broadcast over WebSocket, it is deleted from server memory.

**Client-side storage.** All log history is persisted in the browser via IndexedDB — queryable, exportable as CSV, and completely under your control.

---

## Middleware

Drop `logwatch.js` into any Express project.

**Install the one dependency:**
```bash
npm install ws
```

**Add your PIN to `.env`:**
```
MONITOR_PIN=yourpin
```

**Mount in your server:**
```js
require('dotenv').config();
const http    = require('http');
const express = require('express');
const { createLogWatchServer } = require('./logwatch');

const app    = express();
const server = http.createServer(app);

app.use(express.json());

const ghostlog = createLogWatchServer(server, app);
app.use(ghostlog.middleware);

// ...your routes...

app.use(ghostlog.errorHandler); // after routes — captures error messages in logs

server.listen(3000);
```

> **Note:** Pass `server` (the `http.Server` instance), not `app`. GhostLog attaches a WebSocket server to the same port. If you use `app.listen()`, switch to `http.createServer(app)` + `server.listen()`.

---

## Log packet shape

Every intercepted request produces:

```json
{
  "timestamp": "2025-03-29T14:22:01.123Z",
  "method":    "POST",
  "endpoint":  "/api/auth/login",
  "status":    401,
  "success":   false,
  "latency":   43,
  "ip":        "192.168.1.1",
  "error_log": "Invalid credentials",
  "headers":   { "authorization": "[REDACTED]" },
  "body":      { "email": "joe@example.com", "password": "[REDACTED]" },
  "query":     null
}
```

Sensitive keys (`password`, `token`, `secret`, `authorization`, `cookie`, `x-api-key`, etc.) are redacted at all nesting depths before the packet is broadcast. Extra keys can be added via the `redactKeys` option.

---

## Dashboard

Open `dashboard/index.html` in any browser — no build step, no dependencies.

- Enter your server URL and click **Verify & Connect**
- The dashboard hits `/__ghostlog__/handshake` to confirm the middleware is installed
- If confirmed, a WebSocket is opened and you are prompted for your PIN
- Wrong PIN → connection closed immediately. Correct PIN → logs stream in real time.

**Features:**
- Live request feed with method, endpoint, status, IP, and latency
- Click any row to inspect headers, body, and error messages
- Stats bar: total requests, success rate, error count, avg latency
- 60-second rolling request volume sparkline
- Analytics tab: top endpoints + status code distribution
- History tab: IndexedDB-backed log persistence across sessions
- CSV export — client-side only, no server involved
- Auto-reconnect on dropped connection

---

## Demo server

The `demo/` folder contains a standalone Express server with fake routes for testing GhostLog end-to-end.

**Run locally:**
```bash
cd demo
npm install
cp .env.example .env    # set MONITOR_PIN
node server.js
```

Open `http://localhost:3000` for the test client — a request firing panel with every route available as a button, plus an auto-ping mode that fires random requests on a configurable interval (200ms–5s) and a flood mode (3 req / 150ms) for stress testing.

Open `dashboard/index.html` and connect to `http://localhost:3000` to see the logs stream in real time.

---

## Security notes

- PIN is read from `process.env.MONITOR_PIN` on every authentication attempt. Change it in `.env` and restart — old connections are immediately invalidated.
- Unauthenticated WebSocket connections receive a challenge and are closed on a wrong PIN with no retry surface exposed.
- The handshake route (`/__ghostlog__/handshake`) only responds if the middleware is installed — preventing the dashboard from being used against servers that didn't opt in.
- Sensitive fields are stripped server-side before broadcast, not client-side after receipt.

---

## Options

```js
createLogWatchServer(server, app, {
  pin:        'yourpin', // override MONITOR_PIN (use .env instead)
  throttle:   10,        // sample 1-in-N logs under heavy load (0 = off)
  redactKeys: ['otp'],   // additional keys to redact from headers + body
});
```

---

## Stack

- **Runtime:** Node.js + Express
- **Transport:** WebSocket (`ws` package)
- **Dashboard:** Vanilla HTML/CSS/JS — no framework, no build step
- **Client storage:** IndexedDB
- **Deployment:** Any Node host (Render, Railway, Fly.io)
