# ApexLens — Salesforce Live Log Monitor

**Real-time Salesforce Apex log monitoring, AI-powered debugging, and governor-limit intelligence — right inside your browser.**

ApexLens is a Chrome extension (Manifest V3) that sits in your browser's side panel and streams Apex debug logs from your Salesforce org as they happen, parses them into readable structure, and uses AI to explain errors and suggest fixes — no context-switching to Developer Console required.

---

## 🧩 The Problem

Salesforce developers and admins lose a surprising amount of time just *getting to* the information they need to debug:

- **Developer Console is slow and clunky.** Digging through raw Apex logs to find the one line that matters is tedious and repetitive.
- **Governor limits are a black box until they aren't.** SOQL query counts, DML rows, CPU time, and heap size are only checked manually — teams often discover limit issues only after a failure in production.
- **Trace flags are easy to forget.** They expire silently, and re-creating them means leaving your workflow to go through Setup.
- **Understanding a cryptic stack trace still requires deep Apex expertise.** Junior developers (and even seniors, on unfamiliar code) spend real time interpreting exceptions instead of fixing them.
- **Everything lives in a separate tab.** Logs, trace flags, and your actual working context (Lightning, sandbox, IDE) are never in the same place.

## ✅ The Solution

ApexLens turns your browser into a live Apex observability + debugging assistant:

- Detects any open Salesforce org (Production, Sandbox, Developer, Scratch) automatically and lets you monitor multiple orgs from one side panel.
- Polls and streams new debug logs in real time, parsing them into structured, filterable data instead of a wall of raw text.
- Visualizes governor limit usage (SOQL, DML, CPU, heap, callouts, and more) with clear status indicators before they become production incidents.
- Lets you create, extend, and delete trace flags without leaving the panel.
- Plugs in an AI layer that reads the parsed log and explains, summarizes, or proposes fixes in plain English and correct Apex syntax.

---

## ✨ Key Features

| Feature | What it does |
|---|---|
| 🔌 **Auto Org Detection** | Recognizes Lightning, `my.salesforce.com`, sandbox, and developer org URLs automatically and offers a one-click connect. |
| 📡 **Live Log Polling** | Configurable polling interval (2s–30s) with retry/backoff, streaming new Apex logs into the panel as they're generated. |
| 🧾 **Structured Log Parser** | Breaks raw logs into errors, debug statements, SOQL queries, DML operations, flow executions, callouts, methods, and a full execution timeline. |
| 📊 **Governor Limit Dashboard** | Real-time visual tracking of SOQL queries/rows, DML statements/rows, CPU time, heap size, callouts, future calls, and queueable jobs — with warning and critical thresholds. |
| 🚩 **Trace Flag Manager** | Create trace flags for any user, extend them by +60 minutes, or delete them, with expiry warnings — no Setup menu needed. |
| 🔍 **Search & Filters** | Filter logs by status (success/error/warning) and type (trigger, batch, flow, queueable, future, platform, anonymous), plus full-text search. |
| 🎨 **Dark/Light Themes & Customizable UI** | Adjustable font size, side-panel width, and theme, built for long debugging sessions. |
| 🔔 **Smart Notifications** | Get notified the moment an error-level log comes in, without watching the panel. |
| 📤 **Export** | Export logs and data as TXT, JSON, or CSV. |
| ⌨️ **Keyboard Shortcuts** | Cmd/Ctrl+K to search, Cmd+J / Cmd+L to jump between log list and detail view. |

---

## 🤖 AI Integration — What Makes ApexLens Different

Most Apex log viewers stop at *displaying* data. ApexLens goes further by pairing the structured log parser with an **LLM-powered debugging assistant** (via the Groq API), turning raw logs into actionable answers.

### AI-powered capabilities

1. **Explain This Log** — Generates a plain-English explanation of what happened in the log: the likely cause, the significant behavior, and one concrete next step.
2. **Suggest a Fix** — Analyzes errors and context to propose 2–3 precise, Apex-specific code or configuration fixes, instead of generic advice.
3. **Log Summary** — Condenses a full log into 4–6 bullet points covering the core problem, key operations, and the biggest risk.
4. **SOQL Review** — Inspects the queries in a log for missing filters, large row counts, or query-in-loop anti-patterns that could trigger governor-limit failures.
5. **Inline Error Explain & Fix** — Every parsed error gets its own "Explain" / "Fix" action, so you can get an AI answer on a specific exception without leaving its context.
6. **Natural-Language Search** — Type what you're looking for in plain English (e.g. *"show me the slow SOQL calls"*) and the AI converts it into a precise search query applied instantly to your log list.

### Why this is different from generic AI chat

- **It's grounded in real, parsed log data** — not a blind chat window. Every prompt is built from the actual structured context of the selected log (errors, SOQL, DML, limits), so answers are specific to *your* execution, not generic Apex trivia.
- **It's governor-limit aware.** The AI is instructed to only flag SOQL/DML/row-count risks when values are actually close to Salesforce's real limits (100 SOQL queries, 150 DML statements, 50,000 rows) — avoiding noisy, generic warnings and false alarms.
- **It's Apex-only by design.** The assistant is constrained to Apex syntax and terminology, so you never get Java/JS/C# suggestions bleeding into a Salesforce answer.
- **It lives exactly where the problem is** — inline with the log, the error, and the governor-limit dashboard — so the debugging loop (see error → understand → fix) never leaves the browser.

> AI runs on your own Groq API key, configured in Settings — your logs and API usage stay under your control.

---

## 🏗️ How It Works (Architecture)

```
┌─────────────────────┐
│   Salesforce Tab     │  content.js detects Lightning/Salesforce pages
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  background.js        │  Service worker: org detection, polling
│  (Manifest V3)         │  orchestration, messaging hub
└──────────┬───────────┘
           │
   ┌───────┴────────────────────────────┐
   │           services/                 │
   │  salesforce-api.js  → REST API calls (session-based)
   │  polling.js          → interval-based log fetching + retry
   │  parser.js           → raw log → structured data
   │  storage.js          → chrome.storage persistence
   │  config.js           → settings, thresholds, feature flags
   │  ai.js                → Groq AI service (LLM insights)
   └───────┬────────────────────────────┘
           │
┌──────────▼───────────┐
│   sidepanel.html/js   │  Side panel UI: log list, detail view,
│   sidepanel.css        │  governor dashboard, trace flags, AI panel
└───────────────────────┘
```

---

## 📦 Tech Stack

- **JavaScript (ES Modules)** — core extension logic
- **Chrome Extension Manifest V3** — service worker, side panel API
- **HTML/CSS** — side panel UI
- **Groq API** (`llama-3.1-8b-instant` by default) — AI insight generation
- **Salesforce REST API** (`v59.0`) — log retrieval, trace flag management

---

## 🚀 Getting Started

1. **Clone the repo**
   ```bash
   git clone https://github.com/prashant9328/ApexLenc.git
   ```
2. **Load into Chrome**
   - Go to `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked** and select the cloned `ApexLenc` folder
3. **Open a Salesforce org** (Lightning, sandbox, or developer) — ApexLens will detect it automatically.
4. **Open the side panel** and click **Connect** on your detected org.
5. *(Optional, for AI features)* Go to **Settings → AI**, add your [Groq API key](https://console.groq.com), and start using Explain / Fix / Summary / SOQL Review on any log.

---

## 🔐 Permissions Used

| Permission | Why |
|---|---|
| `sidePanel` | Renders the main ApexLens UI |
| `storage` | Persists settings, bookmarks, and cached logs locally |
| `tabs` / `activeTab` | Detects Salesforce org tabs |
| `cookies` | Reuses your existing Salesforce session (no separate login) |
| `notifications` | Alerts you when a new error-level log appears |
| `alarms` | Powers the background polling schedule |

No credentials are stored or transmitted anywhere other than Salesforce (via your existing session) and Groq (only when you use AI features, using your own API key).

---

## 🗺️ Roadmap

- ✅ Real-time log monitoring, parsing, and governor limit dashboard
- ✅ AI-powered explain / fix / summarize / SOQL review
- 🔜 Custom themes
- 🔜 Export to Splunk / external log sinks
- 🔜 Cross-device settings sync

---

## 🤝 Contributing

Issues and pull requests are welcome. If you find a bug or have a feature idea, open an issue on the [GitHub repo](https://github.com/prashant9328/ApexLenc).

## 📄 License

MIT
Thank you