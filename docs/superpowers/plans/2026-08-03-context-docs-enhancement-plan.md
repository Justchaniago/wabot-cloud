# Documentation & Context Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the `docs/` folder with precise line maps, subsystem schemas, frontend panel context, and routing tables so AI agents can execute tasks with surgical accuracy and zero unnecessary file screening.

**Architecture:** A modular, line-mapped documentation framework where `docs/00_INDEX.md` acts as a master routing table directing agents to section-specific `.md` files containing exact line ranges, function signatures, data payloads, and CLI verification commands.

**Tech Stack:** Node.js (v25.x), Telegraf v4, Express v4, Socket.io v4, React v19, Vite v6, Google GenAI (`@google/genai`), Google Cloud Firestore.

## Global Constraints

- Every subsystem documentation file must include an explicit **Line Map** pointing to exact line ranges in source files.
- All code symbols, filenames, and line numbers must be clickable markdown links using the `file://` URL scheme.
- No broad or whole-file reading directives; agents must be instructed to read only targeted line ranges.

---

### Task 1: Enhance `docs/10_TELEGRAM_BOT.md` with Precise Line Maps & Signatures

**Files:**
- Modify: `docs/10_TELEGRAM_BOT.md`
- Target Reference: `telegram-bot.js:1-1466`

**Interfaces:**
- Consumes: `telegram-bot.js` line locations and handler signatures.
- Produces: Line-mapped documentation for all Telegram commands, AI parsing loops, and Sheets write helpers.

- [x] **Step 1: Audit current line numbers in `telegram-bot.js`**
- [x] **Step 2: Update `docs/10_TELEGRAM_BOT.md` with exact line range mappings**
- [x] **Step 3: Verify markdown formatting & file links**
- [x] **Step 4: Commit changes**

---

### Task 2: Create `docs/30_FRONTEND_PANEL.md` for React Control Panel UI

**Files:**
- Create: `docs/30_FRONTEND_PANEL.md`
- Target References: `panel/src/App.jsx`, `panel/src/App.css`, `panel/vite.config.js`

**Interfaces:**
- Consumes: React component state and Socket.io client events.
- Produces: Frontend documentation covering UI layout, real-time log streaming, telemetry cards, and Vite build pipeline.

- [x] **Step 1: Audit `panel/src/App.jsx` structure**
- [x] **Step 2: Create `docs/30_FRONTEND_PANEL.md`**
- [x] **Step 3: Verify document format and links**
- [x] **Step 4: Commit changes**

---

### Task 3: Enhance `docs/40_CONTROL_PANEL_SERVER.md` with Line Maps & Payload Schemas

**Files:**
- Modify: `docs/40_CONTROL_PANEL_SERVER.md`
- Target Reference: `panel-server.js:1-154`

**Interfaces:**
- Consumes: Express server routes and Socket.io broadcast methods.
- Produces: Line map and payload specification for backend control panel server.

- [x] **Step 1: Audit `panel-server.js` line ranges**
- [x] **Step 2: Update `docs/40_CONTROL_PANEL_SERVER.md`**
- [x] **Step 3: Verify file syntax & links**
- [x] **Step 4: Commit changes**

---

### Task 4: Enhance `docs/60_FIRESTORE_DATA_SCHEMA.md` with Document Samples

**Files:**
- Modify: `docs/60_FIRESTORE_DATA_SCHEMA.md`
- Target References: `telegram-bot.js:55`, `telegram-bot.js:586`

**Interfaces:**
- Consumes: Firestore collection usage in `telegram-bot.js`.
- Produces: Schema documentation with JSON document examples and querying rules.

- [x] **Step 1: Inspect Firestore operations in `telegram-bot.js`**
- [x] **Step 2: Update `docs/60_FIRESTORE_DATA_SCHEMA.md`**
- [x] **Step 3: Commit changes**

---

### Task 5: Update Master Index `docs/00_INDEX.md` & Agent Rules `docs/70_AGENT_COST_OPTIMIZATION_RULES.md`

**Files:**
- Modify: `docs/00_INDEX.md`
- Modify: `docs/70_AGENT_COST_OPTIMIZATION_RULES.md`

**Interfaces:**
- Consumes: All updated subsystem context docs.
- Produces: Final master routing table and zero-screening enforcement rules.

- [x] **Step 1: Update `docs/00_INDEX.md`**
- [x] **Step 2: Update `docs/70_AGENT_COST_OPTIMIZATION_RULES.md`**
- [x] **Step 3: Commit changes**
