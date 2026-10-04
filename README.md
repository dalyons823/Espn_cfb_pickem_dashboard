# ESPN College Football Pick'em Live Matrix Dashboard

A real-time, responsive Next.js dashboard built for tracking private and public ESPN College Football Pick'em groups. The application merges live game scores, play clocks, user pick distributions, and confidence points into an interactive matrix with real-time leaderboard calculations.

---

## Features

- **Live Game Enrichment:** Continuously syncs live college football scores, quarters, game clocks, and completion statuses across all Division I FBS matchups.
- **Dynamic Weekly Slate:** Automatically detects the current scoring period and loads the official 10-game contest slate.
- **Strict Chronological Ordering:** Matchups sort ascending by scheduled kickoff time (early morning kickoffs at the top down to late-night games).
- **Local Device Timezone:** Automatically formats kickoff times to the viewer's local browser timezone without UTC hardcoding.
- **Pre-Game Privacy Guard:** Unstarted games keep team score boxes blank and respect ESPN's pre-kick pick lockout.
- **Dynamic Pick Pills:**
  - Distinct color hashing per team.
  - Displays selected team abbreviation and assigned confidence points.
  - **Live Status Borders:** Green border when leading/won; red border when trailing/lost.
  - **End-of-Game Badges:** Circular checkmark (`✓`) for winning picks and cross (`✕`) for losing picks once a game goes `Final`.
- **Sticky Matrix Navigation:** Fixed matchup and pinned-user columns ensure smooth horizontal scrolling across large league rosters on mobile and desktop.
- **Pinned Entrant Tracking:** Select and highlight your entry (`⭐ PosaParty`) in gold; selections persist across reloads via `localStorage`.
- **Multi-Metric Summary Rows:**
  - **Points Earned:** Finalized points secured.
  - **As It Stands:** Earned points plus live leading points (ties count as 0).
  - **Max Possible:** Maximum achievable score (55 minus points lost from finalized incorrect picks).
  - **Total (incl. Week):** Live cumulative season standing.
  - **Ranks:** Initial Rank (entering week), Live Rank (overall now), and Weekly Rank.
- **3-Column Standings Table:** Standalone parallel leaderboard comparing Initial Rank, Current Rank, and Weekly Rank with point totals.
- **Background Auto-Polling:** Silently fetches updated scores and picks every 45 seconds without triggering full-page reloads.
- **Data Export:** One-tap CSV download containing the entire matrix slate, user picks, and summary rows.

---

## Tech Stack & Architecture

- **Framework:** Next.js (App Router)
- **Language:** JavaScript (ES6+ / React 18+)
- **Styling:** Vanilla CSS-in-JS / Inline styles (zero external UI library dependencies)
- **Deployment:** Vercel (Continuous Deployment via GitHub)
- **Data Sources:** 
  - ESPN Gambit API (`https://gambit-api.fantasy.espn.com/apis/v1/challenges/...`)
  - ESPN Core Site CFB Scoreboard API (`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard`)

---

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
