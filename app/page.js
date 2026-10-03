'use client';
import { useState, useEffect } from 'react';

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
    const interval = setInterval(() => loadData(selectedWeek), 30000); // 30-sec live poll
    return () => clearInterval(interval);
  }, [selectedWeek]);

  if (loading && !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-400">
        Loading live picks...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 font-sans">
      {/* Week Selector */}
      <div className="flex items-center justify-between mb-4">
        <select
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(Number(e.target.value))}
          className="bg-slate-900 border border-slate-700 text-white rounded px-3 py-1.5 font-medium"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((w) => (
            <option key={w} value={w}>Week {w}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          Auto-synced: {data?.lastSynced ? new Date(data.lastSynced).toLocaleTimeString() : '—'}
        </span>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-slate-900 text-slate-400 uppercase text-xs">
            <tr>
              <th className="p-3">Score / Matchup</th>
              {data?.members?.map((m) => (
                <th
                  key={m.id}
                  className={`p-3 text-center whitespace-nowrap ${
                    m.isUser ? 'text-amber-400 font-bold bg-slate-800/60' : ''
                  }`}
                >
                  {m.entryName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-slate-950">
            {data?.matchups?.map((game) => (
              <tr key={game.id} className="hover:bg-slate-900/40">
                <td className="p-3 whitespace-nowrap">
                  <div className="flex justify-between font-semibold">
                    <span>{game.awayTeam}</span>
                    <span>{game.awayScore ?? '—'}</span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>@{game.homeTeam}</span>
                    <span>{game.homeScore ?? '—'}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{game.statusText}</div>
                </td>
                {data?.members?.map((m) => {
                  const pick = game.picks[m.id];
                  if (!pick?.pickedTeam) {
                    return <td key={m.id} className="p-3 text-center text-slate-600">—</td>;
                  }
                  return (
                    <td
                      key={m.id}
                      className={`p-3 text-center ${m.isUser ? 'bg-slate-800/30' : ''}`}
                    >
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${
                        game.isFinal
                          ? pick.isCorrect
                            ? 'border-emerald-500 text-emerald-400 bg-emerald-950/40'
                            : 'border-rose-500 text-rose-400 bg-rose-950/40'
                          : 'border-slate-700 text-slate-200 bg-slate-900'
                      }`}>
                        {pick.pickedTeam}
                        <span className="opacity-60 text-[10px]">{pick.confidence}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
