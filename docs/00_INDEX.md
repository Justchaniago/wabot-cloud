# TELEGRAM REPORT BOT - MASTER INDEX & ROUTING TABLE

> **AGENT DIRECTIVE**: Read ONLY target context file for task. NO full file scan. Use line ranges.

---

## 🗺️ Agent Routing Table

| Subsystem / Task | Target Code | Context Doc |
| :--- | :--- | :--- |
| **Telegram Bot Multi-Branch** | `telegram-bot.js:1-1465` | [`docs/10_TELEGRAM_BOT.md`](file:///Users/f/Documents/wabot-cloud/docs/10_TELEGRAM_BOT.md) |
| **React Control Panel UI** | `panel/src/App.jsx:1-350` | [`docs/30_FRONTEND_PANEL.md`](file:///Users/f/Documents/wabot-cloud/docs/30_FRONTEND_PANEL.md) |
| **Control Panel API / Socket** | `panel-server.js:1-154` | [`docs/40_CONTROL_PANEL_SERVER.md`](file:///Users/f/Documents/wabot-cloud/docs/40_CONTROL_PANEL_SERVER.md) |
| **Firestore Schemas** | Firestore Collections | [`docs/60_FIRESTORE_DATA_SCHEMA.md`](file:///Users/f/Documents/wabot-cloud/docs/60_FIRESTORE_DATA_SCHEMA.md) |
| **Zero-Scan Token Rules** | Global Rules | [`docs/70_AGENT_COST_OPTIMIZATION_RULES.md`](file:///Users/f/Documents/wabot-cloud/docs/70_AGENT_COST_OPTIMIZATION_RULES.md) |

---

## ⚡ Tech Stack Overview

- **Core**: Node.js + Telegraf (`telegram-bot.js`).
- **Web Panel**: Express + Socket.io (`panel-server.js`), React + Vite (`panel/`).
- **Database**: Google Cloud Firestore (`token_usages`, `pending_inputs`).
- **AI**: `@google/genai` (Vertex AI / GEMINI API).
- **Integrations**: Google Sheets API v4.
