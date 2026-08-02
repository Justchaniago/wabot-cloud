# CONTROL PANEL API SERVER CONTEXT & LINE MAP

> **Target File**: [`panel-server.js`](file:///Users/f/Documents/wabot-cloud/panel-server.js)

---

## 📍 Line Map

| Line Range | Handler / Function | Purpose |
| :--- | :--- | :--- |
| [`L1-L7`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L1-L7) | Setup | Imports (`express`, `http`, `socket.io`, `@google/genai`). |
| [`L8-L16`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L8-L16) | Static Assets | Serves `/panel` from `panel/dist`. |
| [`L18-L26`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L18-L26) | `broadcastLog`, `broadcastBotStatus` | Helper functions emitting WebSocket logs/status. |
| [`L28-L38`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L28-L38) | Stats Loop | Emits `server:stats` (uptime, RAM, CPU) every 3 seconds. |
| [`L40-L46`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L40-L46) | `POST /api/panel/restart-bot` | Triggers `global.restartBotHandler()`. |
| [`L48-L63`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L48-L63) | `POST /api/panel/exec-command` | Executes shell command via `child_process.exec` (10s limit). |
| [`L65-L144`](file:///Users/f/Documents/wabot-cloud/panel-server.js#L65-L144) | `POST /api/panel/test-ai` | AI DevOps Assistant prompt with server stats context. |

---

## ⚡ Socket.io Event Schemas

```json
// Event: "server:stats"
{ "uptime": 1234, "memory": "256 MB", "cpu": "12%" }

// Event: "log:stream"
{ "type": "INFO" | "WARN" | "ERROR" | "SUCCESS", "message": "Log string" }
```
