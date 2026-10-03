'use client';
import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(5);
  const [liveScores, setLiveScores] = useState({});

  // 1. Load Scraped Data (Prefer localStorage to survive serverless restarts)
  useEffect(() => {
    const local = localStorage.getItem(`espn_pickem_week_${selectedWeek}`);
    if (local) {
      try {
        setData(JSON.parse(local));
      } catch (e) {
        console.error("Failed parsing localStorage", e);
      }
    }

    // Also fetch from API route
    fetch(`/api/picks?week=${selectedWeek}`)
      .then(res => res.json())
      .then(apiData => {
        if (apiData && apiData.matchups && apiData.matchups.length > 0) {
          // Verify it's not the stale fallback with VAN @ UGA
          const isStale = apiData.matchups.some(m => 
            (m.awayTeam === 'VAN' && m.homeTeam === 'UGA') ||
            (m.awayTeam === 'BC' && m.homeTeam === 'SMU')
          );
          if (!isStale || !local) {
            setData(apiData);
          }
        }
      })
      .catch(err => console.error("API load failed", err));
  }, [selectedWeek]);

  // 2. Fetch Live Scores from ESPN API
  useEffect(() => {
    async function updateScores() {
      try {
        // Fetch current FBS scoreboard
        const res = await fetch(
          'https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100'
        );
        const json = await res.json();
        const events = json.events || [];

        const scoreMap = {};
        events.forEach(event => {
          const comp = event.competitions?.[0];
          if (!comp) return;

          const home = comp.competitors.find(c => c.homeAway === 'home');
          const away = comp.competitors.find(c => c.homeAway === 'away');

          const statusType = comp.status?.type?.name; // STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL
          const clock = comp.status?.displayClock;
          const period = comp.status?.period;
          const isLive = comp.status?.type?.state === 'in';
          const isFinal = comp.status?.type?.state === 'post';

          const key = `${away?.team?.abbreviation}@${home?.team?.abbreviation}`.toUpperCase();

          scoreMap[key] = {
            awayScore: isLive || isFinal ? away?.score : null,
            homeScore: isLive || isFinal ? home?.score : null,
            statusText: isLive ? `${clock} - ${period}Q` : (isFinal ? 'Final' : comp.status?.type?.shortDetail),
            isLive,
            isFinal,
            started: isLive || isFinal
          };
        });

        setLiveScores(scoreMap);
      } catch (err) {
        console.error("ESPN live score fetch failed", err);
      }
    }

    updateScores();
    const interval = setInterval(updateScores, 30000);
    return () => clearInterval(interval);
  }, [selectedWeek]);

  // Helper to safely render score
  const getGameDisplay = (matchup) => {
    const key = `${matchup.awayTeam}@${matchup.homeTeam}`.toUpperCase();
    const live = liveScores[key];

    if (!live || !live.started) {
      return {
        awayScore: '—',
        homeScore: '—',
        status: matchup.kickoffTime || 'Scheduled',
        isLive: false,
        isFinal: false
      };
    }

    return {
      awayScore: live.awayScore ?? '0',
      homeScore: live.homeScore ?? '0',
      status: live.statusText,
      isLive: live.isLive,
      isFinal: live.isFinal
    };
  };

  // ... render table using getGameDisplay(matchup)
  return <div>{/* Dashboard UI */}</div>;
}
