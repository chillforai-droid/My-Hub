/**
 * TerminalPanel.tsx
 * ─────────────────────────────────────────────
 * Terminal panel for DevStudio right panel
 * Real execution via WebSocket → Render backend
 *
 * Backend deploy करने के बाद:
 *   VITE_DEVSTUDIO_WS_URL=wss://your-app.onrender.com/terminal
 * env में set करें।
 */

import React, { useRef, useEffect, useState, useCallback } from 'react';

interface TerminalPanelProps {
  log: string[];
  onCommand: (cmd: string) => void;
}

// Render backend URL — env से लो, नहीं तो prompt करो
const DEFAULT_WS_URL = import.meta.env.VITE_DEVSTUDIO_WS_URL || '';

// Common commands for quick access
const QUICK_CMDS = [
  'npm run dev',
  'npm install',
  'npm run build',
  'git status',
  'git log --oneline -5',
  'ls -la',
  'pwd',
  'clear',
];

type ConnStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function TerminalPanel({ log, onCommand }: TerminalPanelProps) {
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  // WebSocket state
  const [wsUrl, setWsUrl] = useState(DEFAULT_WS_URL);
  const [wsInput, setWsInput] = useState('');
  const [connStatus, setConnStatus] = useState<ConnStatus>('disconnected');
  const [wsOutput, setWsOutput] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log, wsOutput]);

  // ─── WebSocket Connect ────────────────────────────────────────────────────
  const connectWs = useCallback(() => {
    const url = wsUrl.trim() || wsInput.trim();
    if (!url) return;

    // Already connected?
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close();
    }

    setConnStatus('connecting');
    setWsOutput((p) => [...p, `\x1b[33m[Connecting to ${url}...]\x1b[0m`]);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnStatus('connected');
        setWsOutput((p) => [...p, '\x1b[32m[Connected ✓]\x1b[0m']);

        // Keep-alive ping
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'connected') {
            setSessionId(msg.sessionId || '');
            setWsOutput((p) => [...p, `\x1b[36m${msg.message || 'Terminal ready'}\x1b[0m`]);
          } else if (msg.type === 'output') {
            // ANSI output को lines में split करो
            const lines = msg.data.split(/\r?\n/);
            setWsOutput((p) => [...p, ...lines.filter(Boolean)]);
          } else if (msg.type === 'error') {
            setWsOutput((p) => [...p, `\x1b[31m[Error] ${msg.message}\x1b[0m`]);
          }
        } catch {
          // Plain text
          setWsOutput((p) => [...p, event.data]);
        }
      };

      ws.onerror = () => {
        setConnStatus('error');
        setWsOutput((p) => [...p, '\x1b[31m[Connection Error — URL check करें]\x1b[0m']);
      };

      ws.onclose = () => {
        setConnStatus('disconnected');
        setWsOutput((p) => [...p, '\x1b[33m[Disconnected]\x1b[0m']);
        if (pingRef.current) clearInterval(pingRef.current);
      };

    } catch (err: any) {
      setConnStatus('error');
      setWsOutput((p) => [...p, `\x1b[31m[Failed: ${err.message}]\x1b[0m`]);
    }
  }, [wsUrl, wsInput]);

  const disconnectWs = useCallback(() => {
    wsRef.current?.close();
    if (pingRef.current) clearInterval(pingRef.current);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, []);

  // ─── Send command via WebSocket ───────────────────────────────────────────
  const sendWsCommand = useCallback((cmd: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data: cmd + '\n' }));
    }
  }, []);

  // ─── Fallback (no WebSocket) ──────────────────────────────────────────────
  const run = (cmd?: string) => {
    const c = (cmd ?? input).trim();
    if (!c) return;
    setHistory((h) => [c, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');

    if (connStatus === 'connected') {
      sendWsCommand(c);
    } else {
      onCommand(c);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { run(); return; }
    if (e.key === 'ArrowUp') {
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] ?? '');
    }
    if (e.key === 'ArrowDown') {
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? '' : history[idx] ?? '');
    }
    // Ctrl+C
    if (e.ctrlKey && e.key === 'c') {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data: '\x03' }));
      }
    }
  };

  // ANSI color stripping for simple display
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[mGKHFABCDJ]/g, '');

  const getLineColor = (line: string) => {
    const clean = stripAnsi(line);
    if (line.includes('\x1b[32m') || clean.includes('✓') || clean.includes('ready')) return '#6ee7b7';
    if (line.includes('\x1b[31m') || clean.includes('Error') || clean.includes('error') || clean.includes('❌')) return '#f87171';
    if (line.includes('\x1b[33m') || clean.includes('⚠') || clean.includes('warn')) return '#fbbf24';
    if (line.includes('\x1b[36m') || clean.includes('[Connected') || clean.includes('[DevStudio')) return '#67e8f9';
    if (clean.startsWith('$')) return '#4ec9b0';
    return '#9ca3af';
  };

  const statusColor: Record<ConnStatus, string> = {
    disconnected: '#666',
    connecting: '#fbbf24',
    connected: '#6ee7b7',
    error: '#f87171',
  };

  const statusLabel: Record<ConnStatus, string> = {
    disconnected: '● Disconnected',
    connecting: '◌ Connecting...',
    connected: `● Connected${sessionId ? ` #${sessionId}` : ''}`,
    error: '● Error',
  };

  // Decide which output to show
  const displayLines = connStatus === 'connected' || wsOutput.length > 0 ? wsOutput : log;

  return (
    <div className="flex flex-col h-full bg-[#0c0c0c]">

      {/* ── Backend Connect Section ────────────────────────────────────────── */}
      <div className="p-2 border-b border-[#2a2a2a] bg-[#111] space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[9px] text-[#666] uppercase tracking-wider">Render Backend</span>
          <span className="text-[9px] font-mono" style={{ color: statusColor[connStatus] }}>
            {statusLabel[connStatus]}
          </span>
        </div>

        {connStatus !== 'connected' ? (
          <div className="flex gap-1">
            <input
              type="text"
              value={wsInput || wsUrl}
              onChange={(e) => setWsInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connectWs()}
              placeholder="wss://your-app.onrender.com/terminal"
              className="flex-1 bg-[#1e1e1e] text-[#ccc] text-[10px] px-2 py-1 rounded border border-[#333] outline-none focus:border-[#007acc] placeholder-[#444] font-mono"
            />
            <button
              onClick={connectWs}
              disabled={connStatus === 'connecting'}
              className="px-2.5 py-1 bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-40 text-white text-[10px] rounded transition-colors"
              style={{ minHeight: 'unset', minWidth: 'unset' }}
            >
              {connStatus === 'connecting' ? '⟳' : 'Connect'}
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-[#555] font-mono truncate">
              {wsUrl || wsInput}
            </span>
            <button
              onClick={disconnectWs}
              className="text-[9px] text-[#666] hover:text-[#f87171] transition-colors"
              style={{ minHeight: 'unset', minWidth: 'unset' }}
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Setup hint */}
        {connStatus === 'disconnected' && (
          <p className="text-[9px] text-[#444] leading-relaxed">
            💡 Backend deploy करें → URL paste करें → Connect
          </p>
        )}
      </div>

      {/* ── Quick commands ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1 p-2 border-b border-[#1a1a1a]">
        {QUICK_CMDS.map((cmd) => (
          <button
            key={cmd}
            onClick={() => run(cmd)}
            className="px-1.5 py-0.5 text-[9px] bg-[#1e1e1e] hover:bg-[#2a2a2a] text-[#4ec9b0] border border-[#2a2a2a] rounded transition-colors font-mono"
            style={{ minHeight: 'unset', minWidth: 'unset' }}
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* ── Terminal Output ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-5">
        {displayLines.map((line, i) => (
          <div
            key={i}
            className="whitespace-pre-wrap break-all"
            style={{ color: getLineColor(line) }}
          >
            {stripAnsi(line)}
          </div>
        ))}
        {displayLines.length === 0 && (
          <div className="text-[#333] text-center py-8 text-[11px]">
            Backend connect करें और commands run करें
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-[#1a1a1a] bg-[#111]">
        <span className="text-[#4ec9b0] text-[11px] font-mono flex-shrink-0">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder={
            connStatus === 'connected'
              ? 'command enter करें... (↑↓ history, Ctrl+C)'
              : 'Backend connect करें फिर commands चलाएं...'
          }
          className="flex-1 bg-transparent text-[#ccc] text-[11px] font-mono outline-none placeholder-[#333]"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          onClick={() => run()}
          className="text-[#4ec9b0] text-[11px] hover:text-white transition-colors"
          style={{ minHeight: 'unset', minWidth: 'unset' }}
          title="Run (Enter)"
        >
          ↵
        </button>
      </div>
    </div>
  );
}
