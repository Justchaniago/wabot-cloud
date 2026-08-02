# REACT CONTROL PANEL UI CONTEXT & LINE MAP

> **Target Directory**: [`panel/`](file:///Users/f/Documents/wabot-cloud/panel)

---

## 📍 Line Map & Key Files

| Line Range / File | Component / Config | Purpose |
| :--- | :--- | :--- |
| [`panel/src/App.jsx:1-40`](file:///Users/f/Documents/wabot-cloud/panel/src/App.jsx#L1-L40) | Imports & State | React state (`logs`, `stats`, `botStatus`, `terminalCmd`, `aiPrompt`, `aiReply`). |
| [`panel/src/App.jsx:42-95`](file:///Users/f/Documents/wabot-cloud/panel/src/App.jsx#L42-L95) | `useEffect` Socket Listeners | Listens to `log:stream`, `server:stats`, `bot:status`. Auto-scroll log window. |
| [`panel/src/App.jsx:97-155`](file:///Users/f/Documents/wabot-cloud/panel/src/App.jsx#L97-L155) | API Handlers | `handleRestart`, `handleExecCommand`, `handleTestAi`. |
| [`panel/src/App.jsx:157-350`](file:///Users/f/Documents/wabot-cloud/panel/src/App.jsx#L157-L350) | JSX Layout | Telemetry grid cards, terminal input, real-time log window, AI DevOps panel. |
| [`panel/src/App.css`](file:///Users/f/Documents/wabot-cloud/panel/src/App.css) | Styles | Dark mode CSS token design system. |
| [`panel/vite.config.js`](file:///Users/f/Documents/wabot-cloud/panel/vite.config.js) | Vite Config | Build & dev server options. Output to `panel/dist`. |

---

## ⚡ Build & Run Commands

```bash
cd panel && npm run build  # Builds production assets to panel/dist
cd panel && npm run dev    # Starts Vite dev server
```
