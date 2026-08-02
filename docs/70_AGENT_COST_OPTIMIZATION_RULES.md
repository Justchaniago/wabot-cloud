# AGENT COST OPTIMIZATION RULES (ZERO-SCAN / EXTREME TOKEN SAVING)

> **MANDATORY RULES FOR ALL AI AGENTS**

---

## ⚡ Core Rules for Token Saving

1. **NO WHOLE FILE READS**: Never view full files (`telegram-bot.js`, `panel-server.js`). Check Line Maps in [`docs/10_TELEGRAM_BOT.md`](file:///Users/f/Documents/wabot-cloud/docs/10_TELEGRAM_BOT.md) & [`docs/40_CONTROL_PANEL_SERVER.md`](file:///Users/f/Documents/wabot-cloud/docs/40_CONTROL_PANEL_SERVER.md), then read ONLY targeted line ranges using `StartLine` and `EndLine`.
2. **NO BULK DOC READS**: Read ONLY the single context `.md` file required for your current task from [`docs/00_INDEX.md`](file:///Users/f/Documents/wabot-cloud/docs/00_INDEX.md).
3. **SURGICAL EDITS**: Use `replace_file_content` or `multi_replace_file_content` for code modifications. Never rewrite whole large files.
4. **CLI VERIFICATION**: Run `node --check <file.js>` to verify syntax. Do not guess or output unverified assumptions.

---

## 📋 Agent Action Checklist

```
[ ] 1. Open docs/00_INDEX.md -> Pick targeted doc.
[ ] 2. Open targeted doc -> Get exact Line Range.
[ ] 3. Call view_file with StartLine & EndLine ONLY.
[ ] 4. Edit with replace_file_content.
[ ] 5. Run node --check <file.js>.
```
