# 🪨🏈 The Rock Man Got'Em: Live CFB Pick'em Matrix

A real-time, fully automated Next.js dashboard for ESPN College Football Pick'em (Confidence format). This application directly integrates with ESPN's Gambit and Scoreboard APIs to generate a live, interactive matrix of group picks, real-time scores, Vegas odds, dynamic standings, and interactive historical trends without requiring weekly manual slate updates.

## ✨ Features & Architecture

The application is split into a sleek **3-Tab Viewport** to eliminate scroll fatigue and provide a polished analytics experience.

### 🏈 Tab 1: Live Matchups Matrix
* **Automated Weekly Slates:** Dynamically fetches the official 10-game Confidence slate using ESPN's `scoringFormatIds: [2]` filter, automatically ignoring legacy games and alternate Pick'em variants.
* **Real-Time Telemetry:** Connects to the ESPN FBS Scoreboard to pull live quarter/clock status, real-time scores, and Vegas consensus lines.
* **Clickable Matchups & Logos:** Displays official high-res team logos. Matchup cells route directly to the live ESPN Gamecast tab for that specific game.
* **Frosted Glass Concealment:** Pre-kickoff picks from competitors are hidden behind a CSS frosted-glass padlock (`🔒 Hidden`) to respect ESPN's pre-game lock rules.
* **Post-Game Badges:** 
  * 🔥 **Upset Hit:** Correctly picking a Vegas underdog.
  * 💔 **Bad Beat:** Losing a matchup by a margin of 3 points or less.
  * ✓ / ✕: Standard win/loss indicators.

### 🏆 Tab 2: Standings Leaderboard
* **Dynamic Calculations:** Calculates "Points Earned", "As It Stands" (live projections), "Max Possible", and "Total" season points in real-time.
* **Rank Trend Indicators:** Tracks intra-week rank movement (e.g., `▲ +2`, `▼ -1`) comparing initial pre-week rank to live rank.

### 📈 Tab 3: Interactive Season Trends
* **Cumulative History:** Extracts deeply-nested historical data (`scoreByPeriod`) from ESPN's backend to map out the entire season's trajectory.
* **Rank vs. Points Toggle:** View the graph as a traditional "Points" climb, or switch to the dynamic "Rank" race (which reverses the Y-axis so #1 is at the top).
* **Interactive Highlighting:** Hovering over a user's name in the custom legend isolates their line on the chart, dimming all competitors.
* **ID-Based Indexing:** Graph logic utilizes ESPN `entryId` hashes under the hood to ensure accurate tracking even if multiple entries share the same display name.

## 🛠 Tech Stack
* **Framework:** Next.js (App Router)
* **Charting:** Recharts (Responsive, animated SVG charting)
* **Styling:** Vanilla CSS-in-JS & Inline Styles (Zero heavy external CSS frameworks)
* **Hosting:** Vercel (Optimized for edge caching and fast redeploys)

## 📡 API Data Pipeline
ESPN separates fantasy challenge logic from core sports telemetry. This app bridges them via a three-stage server-side pipeline (`app/api/picks/route.js`):

1. **Ingest Propositions (Gambit API):** Queries `chui_pagetype_make_picks` to grab the active period, filtering strictly for `scoringFormatIds` containing `2` (Confidence games) to isolate the exact 10 matchups.
2. **Cross-Reference Live Telemetry (Scoreboard API):** Queries the Division I-A/FBS scoreboard (`groups=80`) and joins events to Gambit propositions via team keyword matching and Event IDs.
3. **Map Group Picks:** Fetches individual entry selections via `mScoreboard` view, indexes them by unique `entryId`, and maps them to the joined matrix.

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
