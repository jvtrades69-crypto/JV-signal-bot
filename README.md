# JV Trades – Discord Trade Signal Bot

A clean, automated signals bot that:
- Posts signals **as your identity** (webhook with your name + avatar).
- Gives you a **private, owner-only control panel** to update status (TP1/2/3, Running/BE, Stopped, Delete).
- Maintains a **single up-to-date message** in your `Current Active Trades` channel.

---

## 1) Files

- `index.js` – main bot logic (commands, events, threads, webhooks, buttons)
- `store.js` – simple JSON persistence for signals & ids
  - `saveSignal(signal)`
  - `getSignal(id)`
  - `updateSignal(id, patch)`
  - `deleteSignal(id)`
  - `listActive()`
  - `getSummaryMessageId()` / `setSummaryMessageId(messageId)`
  - `getOwnerPanelMessageId()` / `setOwnerPanelMessageId(id, messageId)`
- `embeds.js` – embed formatting
  - `renderSignalEmbed(signal)`
  - `renderSummaryEmbed(trades, title)`
- `config.js` – fill your IDs & token here
- `signals.json` – local DB (auto-managed)
- `package.json` – dependencies & start script

> Exactly matches your requested structure (plus `package.json` + this README for convenience).

---

## 2) Setup

1. Create a **Discord Bot** in the Developer Portal. Invite it to your server with the following perms:
   - `Send Messages`, `Manage Messages`, `Manage Threads`, `Create Public Threads`, `Create Private Threads`,
   - `Read Message History`, `Use Slash Commands`, `Manage Webhooks`, `Embed Links`.
   - (Admin is simplest while testing.)

2. In `config.js`, fill:
   - `token`: your bot token
   - `guildId`: your server ID
   - `currentTradesChannelId`: channel ID for **Current Active Trades**
   - `mentionRoleId`: default role to ping on each signal (or `""` to disable)
   - `ownerUserId`: **your** user ID (only you can create signals & press buttons)

3. Install & run:
   ```bash
   npm i
   npm start
   ```

4. On startup, the bot **registers `/signal`** in your guild automatically.

---

## 3) Usage

### `/signal`
- Options:
  - `asset`: BTC / ETH / SOL / Other
  - `asset_custom`: used when `asset=Other`
  - `direction`: Long / Short
  - `entry` (required)
  - `sl` (required)
  - `tp1`, `tp1_note` (optional)
  - `tp2`, `tp2_note` (optional)
  - `tp3`, `tp3_note` (optional)
  - `reason` (optional, multiline OK)
  - `extra_role` (optional, paste @Role or ID)
- Posts an embed **as you** via webhook + pings role(s).
- Creates an **owner-only private thread** with control buttons.
- Updates the **Current Active Trades** message automatically.

### Owner Control Buttons
- 🎯 TP1 Hit / TP2 Hit / TP3 Hit
- 🟩 Running (Valid)
- 🟫 Running (BE)
- 🔴 Stopped Out
- 🟥 Stopped BE
- ❌ Delete

> All updates **edit the original signal** (no duplicates) and **sync the summary**.

---

## 4) Notes

- Webhook identity uses your **guild display name + avatar** for both signal and summary.
- Summary is **one message only** – re-used/edited every time.
- Deleting a signal removes it from the summary and deletes the private control thread.
- TP lines append `✅` when hit.
- “Valid for re-entry” is **Yes** for Running (Valid), **No** for Running (BE)/Stopped.

If you want me to add multi-asset presets, per-asset emoji, or extra admin overrides, say the word.
