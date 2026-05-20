# DevStudio Backend — Render Deployment Guide

## क्या है यह?

Texly DevStudio के **Terminal panel** को working बनाने के लिए यह backend है।
यह **node-pty** (real shell) + **WebSocket** use करता है ताकि browser में real terminal मिले।

---

## 📦 Files

```
devstudio-backend/
├── server.js          ← Main backend (Express + WebSocket + PTY)
├── package.json       ← Dependencies
├── render.yaml        ← Render one-click deploy config
├── .env.example       ← Environment variables template
└── TerminalPanel.tsx  ← Updated frontend (अपने project में replace करें)
```

---

## 🚀 Step 1: GitHub पर upload करें

1. GitHub पर **नई repository** बनाएं: `devstudio-backend`
2. इन तीनों files upload करें:
   - `server.js`
   - `package.json`
   - `render.yaml`

---

## 🌐 Step 2: Render पर Deploy करें

1. [render.com](https://render.com) पर account बनाएं (free है)
2. **New → Web Service** click करें
3. अपनी GitHub repo connect करें
4. Settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. **Environment Variables** add करें:
   ```
   ALLOWED_ORIGIN = https://www.texlyonline.in,https://texlyonline.in
   ```
6. Deploy होने का wait करें (~2 minutes)
7. आपको URL मिलेगा: `https://devstudio-backend-xxxx.onrender.com`

---

## ⚙️ Step 3: Frontend Update करें

### Option A — TerminalPanel.tsx replace करें (recommended)
`Texly-final/src/components/DevStudio/TerminalPanel.tsx` को नई file से replace करें।

### Option B — .env में URL add करें
```env
VITE_DEVSTUDIO_WS_URL=wss://devstudio-backend-xxxx.onrender.com/terminal
```

> **Note:** `https://` → `wss://` और `http://` → `ws://` लिखें

---

## ✅ Test करें

Terminal panel खोलें और यह URL paste करें:
```
wss://devstudio-backend-xxxx.onrender.com/terminal
```
`Connect` click करें → `npm run dev` type करें → Enter दबाएं

---

## 🔧 Render Free Tier Notes

- Free tier पर server 15 minutes बाद **sleep** हो जाता है
- पहली request पर ~30 seconds लगते हैं wake up में
- Terminal में "Connecting..." दिखेगा — wait करें, connect हो जाएगा

---

## 🛡️ Security

- CORS सिर्फ आपकी site से connections allow करता है
- हर WebSocket connection को एक unique session ID मिलता है
- Connection close होने पर process automatically kill हो जाती है

---

## WebSocket Protocol

```json
// Frontend → Backend (input)
{ "type": "input", "data": "npm run dev\n" }

// Frontend → Backend (terminal resize)
{ "type": "resize", "cols": 120, "rows": 30 }

// Backend → Frontend (output)  
{ "type": "output", "data": "..terminal output.." }

// Backend → Frontend (on connect)
{ "type": "connected", "sessionId": "abc123", "message": "Terminal ready" }
```
