/**
 * DevStudio Backend — Render के लिए
 * ===================================
 * Features:
 *  1. WebSocket Terminal — real shell commands execute करता है (pty)
 *  2. REST API — file read/write, project info
 *  3. CORS — Texly frontend से connect होने के लिए
 *
 * Deploy: Render → New Web Service → इस repo को connect करें
 * Environment Variables (Render Dashboard में set करें):
 *   ALLOWED_ORIGIN=https://www.texlyonline.in
 *   PORT=10000  (Render auto-set करता है)
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'node-pty';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 10000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? '*' : (origin, cb) => {
    const allowed = ALLOWED_ORIGIN.split(',').map(o => o.trim());
    if (!origin || allowed.some(o => origin.includes(o.replace('https://', '').replace('http://', '')))) {
      cb(null, true);
    } else {
      cb(new Error('CORS blocked'));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'DevStudio Backend',
    version: '1.0.0',
    features: ['websocket-terminal', 'file-api'],
    uptime: Math.floor(process.uptime()),
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ─── HTTP Server ───────────────────────────────────────────────────────────────
const httpServer = createServer(app);

// ─── WebSocket Server (Terminal) ──────────────────────────────────────────────
const wss = new WebSocketServer({
  server: httpServer,
  path: '/terminal',
});

// Active sessions track करने के लिए
const sessions = new Map();

wss.on('connection', (ws, req) => {
  const sessionId = Math.random().toString(36).slice(2, 10);
  console.log(`[WS] New terminal session: ${sessionId} from ${req.socket.remoteAddress}`);

  let pty = null;

  // PTY (pseudo-terminal) spawn करो
  try {
    pty = spawn('bash', [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.env.HOME || '/tmp',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        LANG: 'en_US.UTF-8',
      },
    });

    sessions.set(sessionId, { ws, pty });

    // PTY output → WebSocket
    pty.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data }));
      }
    });

    pty.onExit(({ exitCode }) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n[Process exited with code ${exitCode}]\r\n`
        }));
      }
      sessions.delete(sessionId);
    });

    // Connected message भेजो
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'DevStudio Terminal Connected ✓',
    }));

  } catch (err) {
    console.error('[PTY] Failed to spawn:', err.message);
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Terminal spawn failed: ' + err.message,
    }));
    ws.close();
    return;
  }

  // WebSocket message → PTY input
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'input' && pty) {
        pty.write(msg.data);
      }

      if (msg.type === 'resize' && pty) {
        pty.resize(
          Math.max(10, Math.min(250, msg.cols || 120)),
          Math.max(5, Math.min(100, msg.rows || 30))
        );
      }

      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }

    } catch (e) {
      // raw string command (backward compat)
      if (pty) pty.write(raw.toString() + '\n');
    }
  });

  // Cleanup on disconnect
  ws.on('close', () => {
    console.log(`[WS] Session closed: ${sessionId}`);
    if (pty) {
      try { pty.kill(); } catch {}
    }
    sessions.delete(sessionId);
  });

  ws.on('error', (err) => {
    console.error(`[WS] Session ${sessionId} error:`, err.message);
  });
});

// ─── Cleanup on server shutdown ────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received, cleaning up...');
  sessions.forEach(({ ws, pty }) => {
    try { pty.kill(); } catch {}
    try { ws.close(); } catch {}
  });
  process.exit(0);
});

// ─── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════╗
║     DevStudio Backend — Running ✓        ║
╠══════════════════════════════════════════╣
║  HTTP  : http://0.0.0.0:${PORT}             ║
║  WS    : ws://0.0.0.0:${PORT}/terminal      ║
║  CORS  : ${ALLOWED_ORIGIN.slice(0, 30).padEnd(30)} ║
╚══════════════════════════════════════════╝
  `);
});
