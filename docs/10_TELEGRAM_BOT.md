# TELEGRAM BOT SUBSYSTEM CONTEXT & LINE MAP

> **Target File**: [`telegram-bot.js`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js)

---

## 📍 Line Map (DO NOT SCAN WHOLE FILE - VIEW SPECIFIC RANGE ONLY)

| Line Range | Function / Block | Purpose |
| :--- | :--- | :--- |
| [`L1-L68`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1-L68) | Config & Setup | Env vars, `@google/genai` init, Firestore init, `CANDIDATE_MODELS`. |
| [`L69-L149`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L69-L149) | `BRANCHES` | Branch tokens, spreadsheet IDs (TP, PM), morning templates. |
| [`L150-L173`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L150-L173) | `getSheetsClient()` | Google Sheets OAuth / gcloud ADC access token fetch. |
| [`L176-L320`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L176-L320) | Helpers | `parseJsonFromAi`, `getJakartaCalendarDate`, `getProductionWasteStatus`, `getDailySoStatus`, `colIndexToLetter`, `formatUptime`. |
| [`L321-L393`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L321-L393) | Interceptor | Global anti-emoticon and group chat ID auto-capture middleware. |
| [`L394-L420`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L394-L420) | `/start`, `/help` | Welcome menu and active command list. |
| [`L421-L442`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L421-L442) | `/status` | Bot info, server RAM & uptime stats. |
| [`L443-L467`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L443-L467) | `/testsheet` | Google Sheets API connection test. |
| [`L468-L526`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L468-L526) | `/checkprodwaste` | Audit missing production/waste entries for current month. |
| [`L527-L585`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L527-L585) | `/checkdailyso` | Audit missing Daily SO entries for current month. |
| [`L586-L764`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L586-L764) | `processProduksiLogic` / `/produksi` | AI parsing & sheet write for daily production. Handles conflict prompt. |
| [`L765-L949`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L765-L949) | `processWasteLogic` / `/waste` | AI parsing & sheet write for waste items. |
| [`L950-L1147`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L950-L1147) | `processDailysoLogic` / `/dailyso` | AI parsing & column-based sheet write for stock opname. |
| [`L1148-L1212`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1148-L1212) | `/morningbriefing`, `/closingbriefing` | AI shift briefing generator. |
| [`L1213-L1311`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1213-L1311) | `/ai`, `/model` | AI chat session mode & Gemini model picker. |
| [`L1312-L1382`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1312-L1382) | `/esc`, `/usage` | AI exit and token usage report. |
| [`L1383-L1406`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1383-L1406) | `/credit` | Precise GCP credit info console checker. |
| [`L1407-L1481`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1407-L1481) | `bot.on('text')` | Continuous text listener for 2-step inputs & AI mode. |
| [`L1482-L1519`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1482-L1519) | `bot.action(/overwrite_yes|no/)` | Overwrite confirmation callbacks. |
| [`L1520-L1563`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1520-L1563) | `writeProduksiItems()` | Batch write helper to Google Sheets. |
| [`L1564-L1573`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1564-L1573) | Escape & Format | Emoticon cleanup and uptime text formatter. |
| [`L1574-L1650`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1574-L1650) | Express Dashboard | Web UI `/` route. |
| [`L1651-L1886`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1651-L1886) | Scheduler | Telegram background reminders (soft remind @ 21:45 & hard alert @ 22:00 WIB). |
| [`L1887-L1938`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1887-L1938) | `main()` / Error Handler | Launcher loop, web server listener, and global error catchers. |

---

## ⚡ Key Rules

1. **Markdown**: Use `{ parse_mode: 'Markdown' }`. NEVER use `escapeMarkdown()` with MarkdownV2.
2. **Listener**: Start server with `server.listen(PORT)`, NOT `app.listen(PORT)`.
3. **Verify**: Always verify syntax with `node --check telegram-bot.js`.
