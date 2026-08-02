# TELEGRAM BOT SUBSYSTEM CONTEXT & LINE MAP

> **Target File**: [`telegram-bot.js`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js)

---

## 📍 Line Map (DO NOT SCAN WHOLE FILE - VIEW SPECIFIC RANGE ONLY)

| Line Range | Function / Block | Purpose |
| :--- | :--- | :--- |
| [`L1-L38`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1-L38) | Config & Setup | Env vars, `@google/genai` init, Firestore init, `CANDIDATE_MODELS`. |
| [`L69-L148`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L69-L148) | `BRANCHES` | Branch tokens, spreadsheet IDs (TP, PM), morning templates. |
| [`L150-L173`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L150-L173) | `getSheetsClient()` | Google Sheets OAuth / gcloud ADC access token fetch. |
| [`L176-L284`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L176-L284) | Helpers | `parseJsonFromAi`, `getJakartaCalendarDate`, `getProductionWasteStatus`, `getDailySoStatus`, `colIndexToLetter`, `formatUptime`. |
| [`L289-L340`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L289-L340) | `/start`, `/help`, `/status` | Welcome menu, bot info, memory & uptime stats. |
| [`L343-L366`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L343-L366) | `/testsheet` | Google Sheets API connection test. |
| [`L369-L425`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L369-L425) | `/checkprodwaste` | Audit missing production/waste entries for current month. |
| [`L428-L484`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L428-L484) | `/checkdailyso` | Audit missing Daily SO entries for current month. |
| [`L486-L643`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L486-L643) | `processProduksiLogic` / `/produksi` | AI parsing & sheet write for daily production. Handles conflict prompt. |
| [`L644-L801`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L644-L801) | `processWasteLogic` / `/waste` | AI parsing & sheet write for waste items. |
| [`L803-L965`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L803-L965) | `processDailysoLogic` / `/dailyso` | AI parsing & column-based sheet write for stock opname. |
| [`L968-L1035`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L968-L1035) | `/morningbriefing`, `/closingbriefing` | AI shift briefing generator. |
| [`L1039-L1115`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1039-L1115) | `/ai`, `/model` | AI chat session mode & Gemini model picker. |
| [`L1118-L1210`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1118-L1210) | `/esc`, `/usage`, `/credit` | AI exit, token usage report, GCP credit info. |
| [`L1213-L1286`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1213-L1286) | `bot.on('text')` | Continuous text listener for 2-step inputs & AI mode. |
| [`L1289-L1322`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1289-L1322) | `bot.action(/overwrite_yes|no/)` | Overwrite confirmation callbacks. |
| [`L1328-L1367`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1328-L1367) | `writeProduksiItems()` | Batch write helper to Google Sheets. |
| [`L1375-L1426`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1375-L1426) | Express Dashboard | Web UI `/` route. |
| [`L1430-L1465`](file:///Users/f/Documents/wabot-cloud/telegram-bot.js#L1430-L1465) | `main()` | Launcher loop for TP & PM bots, HTTP listener on `server`. |

---

## ⚡ Key Rules

1. **Markdown**: Use `{ parse_mode: 'Markdown' }`. NEVER use `escapeMarkdown()` with MarkdownV2.
2. **Listener**: Start server with `server.listen(PORT)`, NOT `app.listen(PORT)`.
3. **Verify**: Always verify syntax with `node --check telegram-bot.js`.
