# FIRESTORE DATABASE SCHEMAS

> **Backend Database**: Google Cloud Firestore (`@google-cloud/firestore`)

---

## 📊 Collections & Document Structure

### 1. `pending_inputs`
Stores user conflict confirmation items when production input overlaps existing sheet data.

```json
{
  "type": "produksi | waste | dailyso",
  "tabName": "30 - 2026",
  "dateRaw": "30.7.26",
  "items": [{ "typed": "bt lokal 250", "matchedName": "BLACK TEA LOKAL", "quantity": 250 }],
  "productionProducts": [{ "name": "BLACK TEA LOKAL", "rowIndex": 12, "existingQty": "200" }],
  "spreadsheetId": "1673K8akr2mXuTEPLPPnL9X5TiA4GEVDi1hbgMLThvo4",
  "userNickname": "StaffName",
  "createdAt": "2026-08-03T00:00:00.000Z"
}
```

### 2. `token_usages`
Logs real-time Gemini AI token metrics for cost reporting (`/usage`).

```json
{
  "userId": "12345678",
  "command": "produksi | waste | dailyso | ai",
  "promptTokens": 450,
  "candidateTokens": 120,
  "totalTokens": 570,
  "timestamp": "2026-08-03T00:00:00.000Z"
}
```

### 3. `telegram_chats`
Stores automatically captured Telegram group/supergroup Chat IDs for dynamic reminder delivery. Document ID is the branch code (`TP` or `PM`).

```json
{
  "chatId": -1001234567890,
  "title": "Cabang TP - GC-TP6",
  "updatedAt": "2026-08-03T00:00:00.000Z"
}
```
