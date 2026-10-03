'use client';
import { useState, useEffect, useMemo } from 'react';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(5);
  const [loading, setLoading] = useState(true);

  const loadData = async (week) => {
    try {
      const res = await fetch(`/api/picks?week=${week}`);
      const json = await res.json();
      if (!json.error) {
        setData(json);
      }
    } catch (err) {
      console.error('Failed to load picks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    loadData(selectedWeek);
    const interval = setInterval(() => loadData(selectedWeek), 30000);
    return () => clearInterval(interval);
  }, [selectedWeek]);

  // Derived Calculations for Bottom Summary Rows & Standings
  const summaryStats = useMemo(() => {
    if (!data?.members || !data?.matchups) return {};

    const stats = {};
    data.members.forEach((m) => {
      let earned = 0;
      let livePending = 0;
      let maxPossible = 0;

      data.matchups.forEach((game) => {
        const pick = game.picks?.[m.id];
        if (!pick?.pickedTeam) return;

        const conf = parseInt(pick.confidence || 0, 10);
        const awayScore = game.awayScore ?? 0;
        const homeScore = game.homeScore ?? 0;
        const isLeading =
          (pick.pickedTeam === game.awayTeam && awayScore > homeScore) ||
          (pick.pickedTeam === game.homeTeam && homeScore > awayScore);
        const isTied = awayScore === homeScore;

        if (game.isFinal) {
          if (isLeading) {
            earned += conf;
            maxPossible += conf;
          }
        } else if (game.isLive) {
          maxPossible += conf;
          if (isLeading && !isTied) {
            livePending += conf;
          }
        } else {
          // Scheduled
          maxPossible += conf;
        }
      });

      const asItStands = earned + livePending;
      const priorTotal = m.totalPoints || 0;
      const totalOverall = priorTotal + asItStands;

      stats[m.id] = {
        earned,
        asItStands,
        maxPossible,
        totalOverall,
        priorTotal
      };
    });

    return stats;
  }, [data]);

  // Standings rankings calculation
  const standings = useMemo(() => {
    if (!data?.members || Object.keys(summaryStats).length === 0) return [];

    const list = data.members.map((m) => ({
      ...m,
      stats: summaryStats[m.id]
    }));

    // Weekly rank sort
    const weeklySorted = [...list].sort((a, b) => b.stats.asItStands - a.stats.asItStands);
    const weeklyRanks = {};
    weeklySorted.forEach((item, idx) => {
      weeklyRanks[item.id] = idx + 1;
    });

    // Current overall rank sort
    const overallSorted = [...list].sort((a, b) => b.stats.totalOverall - a.stats.totalOverall);
    return overallSorted.map((item, idx) => ({
      ...item,
      currentRank: idx + 1,
      weeklyRank: weeklyRanks[item.id]
    }));
  }, [data, summaryStats]);

  const userMember = data?.members?.find((m) => m.isUser);
  const userStats = userMember ? summaryStats[userMember.id] : null;

  if (loading && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070b14] text-slate-400">
        Loading Week {selectedWeek} Pick&apos;em...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 font-sans pb-16">
      {/* Top Header Controls */}
      <header className="sticky top-0 z-30 bg-[#0b132b]/95 backdrop-blur border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🏈</span>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              className="bg-[#1c2541] border border-slate-700 text-amber-400 font-bold px-3 py-1.5 rounded text-sm focus:outline-none focus:ring-1 focus:ring-amber-400"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((w) => (
                <option key={w} value={w}>
                  Week {w}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <div className="bg-[#1c2541] border border-amber-500/50 text-amber-400 font-semibold px-3 py-1.5 rounded text-xs flex items-center gap-1.5">
              <span>⭐ {userMember?.entryName || 'PosaParty'}</span>
              <span className="text-slate-400 font-normal">
                ({userStats?.totalOverall || userMember?.totalPoints || 0} pts)
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-2 sm:p-4 space-y-6">
        {/* Main Pick Table */}
        <div className="relative overflow-x-auto rounded-lg border border-slate-800 bg-[#0d162a] shadow-xl">
          <table className="w-full border-collapse text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-[#0b132b] text-slate-400">
                <th className="sticky left-0 z-20 bg-[#0b132b] p-3 min-w-[145px] sm:min-w-[180px] font-semibold text-slate-300 shadow-[1px_0_0_0_#1e293b]">
                  Score / Matchup
                </th>
                {data?.members?.map((m) => (
                  <th
                    key={m.id}
                    className={`p-3 text-center whitespace-nowrap min-w-[125px] font-semibold ${
                      m.isUser
                        ? 'sticky left-[145px] sm:left-[180px] z-20 bg-[#16223f] text-amber-400 shadow-[1px_0_0_0_#1e293b]'
                        : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-center gap-1">
                      {m.isUser && <span>⭐</span>}
                      <span>{m.entryName}</span>
                    </div>
                    <div className="text-[11px] font-normal text-slate-400">
                      ({summaryStats[m.id]?.totalOverall ?? m.totalPoints} pts)
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {data?.matchups?.map((game) => (
                <tr key={game.id} className="hover:bg-slate-800/20 transition-colors">
                  {/* Left Column: Matchup & Live Score */}
                  <td className="sticky left-0 z-10 bg-[#0d162a] p-2.5 sm:p-3 shadow-[1px_0_0_0_#1e293b]">
                    <div className="flex items-center justify-between font-bold text-slate-200">
                      <span className="truncate">{game.awayTeam}</span>
                      <span className="font-mono">{game.awayScore ?? ''}</span>
                    </div>
                    <div className="flex items-center justify-between font-bold text-slate-200">
                      <span className="truncate">@{game.homeTeam}</span>
                      <span className="font-mono">{game.homeScore ?? ''}</span>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px]">
                      <span
                        className={`flex items-center gap-1 ${
                          game.isLive
                            ? 'text-rose-400 font-semibold animate-pulse'
                            : game.isFinal
                            ? 'text-slate-400'
                            : 'text-slate-500'
                        }`}
                      >
                        {game.isLive && <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />}
                        {game.statusText}
                      </span>
                      <span className="text-[10px] text-slate-400 bg-slate-800/80 px-1.5 py-0.5 rounded font-mono">
                        📊 {game.analytics}
                      </span>
                    </div>
                  </td>

                  {/* Pick Columns */}
                  {data?.members?.map((m) => {
                    const pick = game.picks?.[m.id];
                    if (!pick?.pickedTeam) {
                      return (
                        <td
                          key={m.id}
                          className={`p-3 text-center text-slate-600 ${
                            m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#101b33] shadow-[1px_0_0_0_#1e293b]' : ''
                          }`}
                        >
                          —
                        </td>
                      );
                    }

                    const isAway = pick.pickedTeam === game.awayTeam;
                    const isHome = pick.pickedTeam === game.homeTeam;
                    const awayScore = game.awayScore ?? 0;
                    const homeScore = game.homeScore ?? 0;
                    const isLeading = (isAway && awayScore > homeScore) || (isHome && homeScore > awayScore);
                    const isTrailing = (isAway && awayScore < homeScore) || (isHome && homeScore < awayScore);

                    // Dynamic Pill Styling
                    let pillStyle = 'border-slate-700 bg-slate-800/80 text-slate-300';
                    let icon = null;

                    if (game.isFinal) {
                      if (isLeading) {
                        pillStyle = 'border-emerald-500/80 bg-emerald-950/40 text-emerald-300';
                        icon = <span className="text-emerald-400 text-xs">✓</span>;
                      } else {
                        pillStyle = 'border-rose-500/80 bg-rose-950/40 text-rose-300';
                        icon = <span className="text-rose-400 text-xs">✕</span>;
                      }
                    } else if (game.isLive) {
                      if (isLeading) {
                        pillStyle = 'border-emerald-500 bg-emerald-950/40 text-emerald-200 ring-1 ring-emerald-500/50';
                      } else if (isTrailing) {
                        pillStyle = 'border-rose-500 bg-rose-950/40 text-rose-200 ring-1 ring-rose-500/50';
                      } else {
                        pillStyle = 'border-amber-500 bg-amber-950/40 text-amber-200';
                      }
                    }

                    return (
                      <td
                        key={m.id}
                        className={`p-3 text-center whitespace-nowrap ${
                          m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#101b33] shadow-[1px_0_0_0_#1e293b]' : ''
                        }`}
                      >
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-bold transition-all shadow-sm ${pillStyle}`}
                        >
                          {icon}
                          <span>{pick.pickedTeam}</span>
                          <span className="w-4 h-4 rounded-full bg-slate-900/80 flex items-center justify-center text-[10px] text-slate-300 font-mono">
                            {pick.confidence}
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}

              {/* Four Bottom Summary Rows */}
              {/* Row 1: Current Points Earned */}
              <tr className="border-t-2 border-slate-700 bg-[#0b132b]/80 font-semibold text-xs">
                <td className="sticky left-0 z-10 bg-[#0b132b] p-2.5 text-slate-400 shadow-[1px_0_0_0_#1e293b]">
                  Current Points Earned
                </td>
                {data?.members?.map((m) => (
                  <td
                    key={m.id}
                    className={`p-2.5 text-center font-mono ${
                      m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#131e38] text-amber-400 shadow-[1px_0_0_0_#1e293b]' : 'text-slate-300'
                    }`}
                  >
                    {summaryStats[m.id]?.earned ?? 0}
                  </td>
                ))}
              </tr>

              {/* Row 2: Current Points As-It-Stands */}
              <tr className="border-t border-slate-800 bg-[#0b132b]/60 font-semibold text-xs">
                <td className="sticky left-0 z-10 bg-[#0b132b] p-2.5 text-slate-400 shadow-[1px_0_0_0_#1e293b]">
                  Current (As-It-Stands)
                </td>
                {data?.members?.map((m) => (
                  <td
                    key={m.id}
                    className={`p-2.5 text-center font-mono text-emerald-400 ${
                      m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#131e38] shadow-[1px_0_0_0_#1e293b]' : ''
                    }`}
                  >
                    {summaryStats[m.id]?.asItStands ?? 0}
                  </td>
                ))}
              </tr>

              {/* Row 3: Max Points Possible */}
              <tr className="border-t border-slate-800 bg-[#0b132b]/40 font-semibold text-xs">
                <td className="sticky left-0 z-10 bg-[#0b132b] p-2.5 text-slate-400 shadow-[1px_0_0_0_#1e293b]">
                  Max Points Possible
                </td>
                {data?.members?.map((m) => (
                  <td
                    key={m.id}
                    className={`p-2.5 text-center font-mono text-sky-400 ${
                      m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#131e38] shadow-[1px_0_0_0_#1e293b]' : ''
                    }`}
                  >
                    {summaryStats[m.id]?.maxPossible ?? 0}
                  </td>
                ))}
              </tr>

              {/* Row 4: Total (Including Current Week) */}
              <tr className="border-t-2 border-slate-700 bg-[#0b132b] font-bold text-xs sm:text-sm">
                <td className="sticky left-0 z-10 bg-[#0b132b] p-3 text-amber-400 shadow-[1px_0_0_0_#1e293b]">
                  Total (w/ Current Week)
                </td>
                {data?.members?.map((m) => (
                  <td
                    key={m.id}
                    className={`p-3 text-center font-mono text-amber-400 ${
                      m.isUser ? 'sticky left-[145px] sm:left-[180px] z-10 bg-[#131e38] shadow-[1px_0_0_0_#1e293b]' : ''
                    }`}
                  >
                    {summaryStats[m.id]?.totalOverall ?? 0}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Standings Table */}
        <div className="rounded-lg border border-slate-800 bg-[#0d162a] p-4 shadow-xl">
          <h2 className="text-base font-bold text-slate-200 mb-3 flex items-center gap-2">
            <span>🏆</span> League Standings
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-2.5">Current Rank</th>
                  <th className="p-2.5">Initial Rank</th>
                  <th className="p-2.5">Weekly Rank</th>
                  <th className="p-2.5">Entry Name</th>
                  <th className="p-2.5 text-center">Week Points (Live)</th>
                  <th className="p-2.5 text-center">Max Potential</th>
                  <th className="p-2.5 text-right">Total Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {standings.map((st) => (
                  <tr
                    key={st.id}
                    className={`hover:bg-slate-800/20 ${
                      st.isUser ? 'bg-amber-500/10 font-bold text-amber-300' : 'text-slate-300'
                    }`}
                  >
                    <td className="p-2.5 font-mono">#{st.currentRank}</td>
                    <td className="p-2.5 font-mono text-slate-500">#{st.initialRank}</td>
                    <td className="p-2.5 font-mono text-slate-400">#{st.weeklyRank}</td>
                    <td className="p-2.5 flex items-center gap-1.5">
                      {st.isUser && <span>⭐</span>}
                      <span>{st.entryName}</span>
                    </td>
                    <td className="p-2.5 text-center font-mono">
                      {st.stats.earned}{' '}
                      <span className="text-emerald-400 font-normal">({st.stats.asItStands})</span>
                    </td>
                    <td className="p-2.5 text-center font-mono text-sky-400">{st.stats.maxPossible}</td>
                    <td className="p-2.5 text-right font-mono text-amber-400 font-bold">{st.stats.totalOverall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
