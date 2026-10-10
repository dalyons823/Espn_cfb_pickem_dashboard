# 🪨🏈 The Rock Man Got'Em: Live CFB Pick'em Matrix

A real-time, fully automated Next.js dashboard for ESPN College Football Pick'em (Confidence format). This application directly integrates with ESPN's Gambit and Scoreboard APIs to generate a live, interactive matrix of group picks, real-time scores, Vegas odds, and dynamic standings without requiring weekly manual slate updates.

## ✨ Features

### 📊 Live Matrix & Leaderboard
* **Automated Weekly Slates:** Dynamically fetches the official 10-game Confidence slate using ESPN's `scoringFormatIds: [2]` filter, automatically ignoring legacy games and alternate Pick'em variants.
* **Real-Time Telemetry:** Connects to the ESPN FBS Scoreboard to pull live quarter/clock status, real-time scores, and Vegas consensus lines.
* **Dynamic Standings:** Calculates "Points Earned", "As It Stands" (live projections), "Max Possible", and "Total" season points in real-time.
* **Rank Trend Indicators:** Tracks intra-week rank movement (e.g., `▲ +2`, `▼ -1`) comparing initial pre-week rank to live rank.

### 🎨 UI & UX Enhancements
* **Clickable Matchups & Logos:** Displays official high-res team logos for all picks. Matchup cells are clickable and route directly to the live ESPN Gamecast tab for that specific game.
* **Frosted Glass Concealment:** Pre-kickoff picks from competitors are hidden behind a CSS frosted-glass padlock (`🔒 Hidden`) to respect ESPN's pre-game lock rules and build anticipation.
* **Post-Game Badges:** 
  * 🔥 **Upset Hit:** Correctly picking a Vegas underdog.
  * 💔 **Bad Beat:** Losing a matchup by a margin of 3 points or less.
  * ✓ / ✕: Standard win/loss indicators.
* **Sticky Navigation:** Matrix headers and the pinned user column stay fixed during horizontal and vertical scrolling.
* **Version Tracking:** Displays the active Vercel Git commit hash (`#commit`) in the header for instant deployment verification.

## 📡 API Architecture & Data Pipeline
ESPN separates fantasy challenge logic from core sports telemetry. This app bridges them via a three-stage server-side pipeline (`app/api/picks/route.js`):

1. **Ingest Propositions (Gambit API):** Queries `chui_pagetype_make_picks` to grab the active period, filtering strictly for `scoringFormatIds` containing `2` (Confidence games) to isolate the exact 10 matchups.
2. **Cross-Reference Live Telemetry (Scoreboard API):** Queries the Division I-A/FBS scoreboard (`groups=80`) and joins events to Gambit propositions via team keyword matching and Event IDs to attach live clocks, Vegas odds, team logos, and Gamecast URLs.
3. **Map Group Picks:** Fetches individual entry selections for the specific `GROUP_ID` and maps them to the joined proposition matrix.

---

## 🚀 Getting Started & Dependency Installation

### Prerequisites
* Node.js (v18.17 or newer)
* Git

### Local Setup
1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd cfb-pickem-dashboard

## Project Structure

```text
cfb-pickem-dashboard/
├── app/
│   ├── api/
│   │   └── picks/
│   │       └── route.js     # Serverless route syncing ESPN Gambit and Scoreboard APIs
│   ├── globals.css          # Global CSS resets
│   ├── layout.js            # Root HTML layout and viewport setup
│   └── page.js              # Client dashboard, sticky matrix, and standings component
├── package.json
└── README.md
