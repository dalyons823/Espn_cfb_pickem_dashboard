'use client';

import { useState, useEffect, useMemo } from 'react';

const ABBR_FALLBACKS = {
  'boise state': 'BSU',
  'western michigan': 'WMU',
  'michigan state': 'MSU',
  'james madison': 'JMU',
  'old dominion': 'ODU',
  'ole miss': 'MISS',
  'florida': 'FLA',
  'michigan': 'MICH',
  'iowa': 'IOWA',
  'texas': 'TEX',
  'tennessee': 'TENN',
  'nebraska': 'NEB',
  'oklahoma': 'OU',
  'georgia': 'UGA',
  'notre dame': 'ND',
  'purdue': 'PUR',
  'utah': 'UTAH',
  'iowa state': 'ISU',
  'houston': 'HOU',
  'georgia southern': 'GASO',
  'illinois': 'ILL',
  'ohio state': 'OSU',
  'sam houston': 'SHSU',
  'texas tech': 'TTU',
  'wake forest': 'WAKE',
  'louisville': 'LOU',
  'west virginia': 'WVU',
  'oklahoma state': 'OKST',
  'alabama': 'BAMA',
  'lsu': 'LSU',
  'oregon': 'ORE',
  'washington': 'WASH',
  'usc': 'USC',
  'ucla': 'UCLA',
  'penn state': 'PSU',
  'wisconsin': 'WISC',
  'clemson': 'CLEM',
  'florida state': 'FSU',
  'miami': 'MIA',
  'north carolina': 'UNC',
  'nc state': 'NCST',
  'duke': 'DUKE',
  'kansas': 'KU',
  'kansas state': 'KSU',
  'colorado': 'COLO',
  'arizona': 'ARIZ',
  'arizona state': 'ASU',
  'byu': 'BYU',
  'tcu': 'TCU',
  'baylor': 'BAY',
  'arkansas': 'ARK',
  'auburn': 'AUB',
  'mississippi state': 'MSST',
  'missouri': 'MIZ',
  'south carolina': 'SC',
  'kentucky': 'UK',
  'vanderbilt': 'VANDY',
  'texas a&m': 'TAMU',
};

function formatAbbr(name) {
  if (!name) return '—';
  const clean = String(name).trim().toLowerCase();
  return ABBR_FALLBACKS[clean] || name;
}

export default function MatrixDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [pinnedUser, setPinnedUser] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [timeAgo, setTimeAgo] = useState('Just now');
  const [isOffline, setIsOffline] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(true);

  const fetchPicks = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await fetch('/api/picks');
      if (!res.ok) throw new Error('Failed to load picks');
      const json = await res.json();
      setData(json);
      setLastUpdated(Date.now());
      setIsOffline(false);

      const allMembers = [json.myUser, ...(json.otherUsers || [])].filter(Boolean);
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('cfb_pinned_user') : null;

      if (!isBackground) {
        if (savedUser && allMembers.includes(savedUser)) {
          setPinnedUser(savedUser);
        } else {
          setPinnedUser(json.myUser || allMembers[0] || '');
        }

        if (json.currentWeek !== undefined && json.currentWeek !== null) {
          setSelectedWeek(json.currentWeek);
        } else if (json.weekBlocks?.length) {
          setSelectedWeek(json.weekBlocks.length - 1);
        }
      }
    } catch (err) {
      if (!isBackground) {
        setError(err.message);
      } else {
        setIsOffline(true);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();
    const refreshInterval = setInterval(() => {
      fetchPicks(true);
    }, 45000);
    return () => clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    const ticker = setInterval(() => {
      if (!lastUpdated) return;
      const elapsedSec = Math.floor((Date.now() - lastUpdated) / 1000);
      if (elapsedSec < 10) setTimeAgo('Just now');
      else if (elapsedSec < 60) setTimeAgo(`${elapsedSec}s ago`);
      else setTimeAgo(`${Math.floor(elapsedSec / 60)}m ago`);
    }, 5000);
    return () => clearInterval(ticker);
  }, [lastUpdated]);

  const handlePinnedUserChange = (newUser) => {
    setPinnedUser(newUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cfb_pinned_user', newUser);
    }
  };

  const { weekBlocks = [], propMap = {}, pickMap = {}, userYearlyScores = {} } = data || {};
  const activeProps = weekBlocks[selectedWeek] || [];
  const allUsers = [data?.myUser, ...(data?.otherUsers || [])].filter(Boolean);
  const unpinnedUsers = allUsers.filter(u => u !== pinnedUser);

  const resolveTeamName = (pickObj, prId) => {
    const sId = String(prId || '');
    const propInfo = propMap[prId] || propMap[sId.slice(0, 7)] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

  // Group pick counts per game
  const gamePickStats = useMemo(() => {
    const stats = {};
    activeProps.forEach(prId => {
      let away = 0;
      let home = 0;
      allUsers.forEach(u => {
        const side = pickMap[u]?.[prId]?.side;
        if (side === 'away') away++;
        if (side === 'home') home++;
      });
      stats[prId] = {
        away,
        home,
        majority: away > home ? 'away' : (home > away ? 'home' : null)
      };
    });
    return stats;
  }, [activeProps, allUsers, pickMap]);

  // Identify the Game of the Week (highest group variance among unfinalized games)
  const hotGameId = useMemo(() => {
    let topScore = -1;
    let selectedId = null;

    activeProps.forEach(prId => {
      const sId = String(prId || '');
      const sc = propMap[prId]?.score || propMap[sId.slice(0, 7)]?.score;
      const isFinal = sc?.state === 'post';
      const { away, home } = gamePickStats[prId] || { away: 0, home: 0 };
      
      // Contention score: highest product of split
      const contention = Math.min(away, home) * (away + home);
      const scoreWeight = isFinal ? contention * 0.1 : contention;

      if (scoreWeight > topScore && (away > 0 || home > 0)) {
        topScore = scoreWeight;
        selectedId = prId;
      }
    });

    return selectedId;
  }, [activeProps, gamePickStats, propMap]);

  // Full Analytics Engine
  const userStats = useMemo(() => {
    const stats = {};
    let highestEarnedInLeague = 0;

    allUsers.forEach(u => {
      let earnedPts = 0;
      let liveLeadingPts = 0;
      let weekLostPts = 0;
      let decidedPts = 0;
      let gutPunchPts = 0;
      let roguePicks = 0;
      let consensusGames = 0;

      activeProps.forEach(prId => {
        const p = pickMap[u]?.[prId];
        const pts = p?.pts || 0;

        const sId = String(prId || '');
        const propInfo = propMap[prId] || propMap[sId.slice(0, 7)];
        const sc = propInfo?.score;
        const isFinal = sc?.state === 'post';
        const isLive = sc?.state === 'in';
        const leader = sc?.leader;

        // Maverick / Rogue tracking
        const gStat = gamePickStats[prId];
        if (gStat?.majority && p?.side) {
          consensusGames++;
          if (p.side !== gStat.majority) roguePicks++;
        }

        if (isFinal) {
          decidedPts += pts;
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            earnedPts += pts;
          } else {
            weekLostPts += pts;
            if (pts >= 8) gutPunchPts += pts; // 8, 9, or 10 pointer lost
          }
        } else if (isLive) {
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            liveLeadingPts += pts;
          }
        }
      });

      if (earnedPts > highestEarnedInLeague) {
        highestEarnedInLeague = earnedPts;
      }

      const asItStands = earnedPts + liveLeadingPts;
      const maxPossible = 55 - weekLostPts;
      const yearlyTotal = userYearlyScores?.[u] ?? 0;
      const totalWithWeek = yearlyTotal + asItStands;
      const accuracyRoi = decidedPts > 0 ? Math.round((earnedPts / decidedPts) * 100) : null;
      const roguePct = consensusGames > 0 ? Math.round((roguePicks / consensusGames) * 100) : 0;

      stats[u] = {
        earnedPts,
        asItStands,
        maxPossible,
        yearlyTotal,
        totalWithWeek,
        decidedPts,
        accuracyRoi,
        gutPunchPts,
        roguePct
      };
    });

    // Check for mathematical elimination
    allUsers.forEach(u => {
      stats[u].isEliminated = stats[u].maxPossible < highestEarnedInLeague;
    });

    return stats;
  }, [allUsers, activeProps, pickMap, propMap, userYearlyScores, gamePickStats]);

  const sortedUnpinnedUsers = useMemo(() => {
    return [...unpinnedUsers].sort((a, b) => {
      const statsA = userStats[a] || { yearlyTotal: 0, asItStands: 0 };
      const statsB = userStats[b] || { yearlyTotal: 0, asItStands: 0 };

      if (statsB.yearlyTotal !== statsA.yearlyTotal) {
        return statsB.yearlyTotal - statsA.yearlyTotal;
      }
      return statsB.asItStands - statsA.asItStands;
    });
  }, [unpinnedUsers, userStats]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b1120' }}>
        <div style={{ fontSize: '30px', marginBottom: '10px' }}>🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 600 }}>Calculating live analytics & matrix...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b1120', color: '#f87171' }}>
        Failed to load data: {error}
      </div>
    );
  }

  const getPillCustomStyle = (pickObj, prId) => {
    const team = resolveTeamName(pickObj, prId);
    if (!team || team === '—') {
      return { background: '#1e293b', color: '#64748b', border: '1px solid #334155' };
    }

    const sId = String(prId || '');
    const propInfo = propMap[prId] || propMap[sId.slice(0, 7)];
    const sc = propInfo?.score;
    const isFinished = sc?.state === 'post';
    const isLive = sc?.state === 'in';

    let border = '1px solid transparent';
    let opacity = '1';

    if (sc?.leader && pickObj?.side) {
      const isPickWinning = (sc.leader !== 'tie' && sc.leader === pickObj.side);
      if (isFinished) {
        if (isPickWinning) {
          border = '1px solid #22c55e';
        } else {
          border = '1px solid #ef444455';
          opacity = '0.55';
        }
      } else if (isLive) {
        if (isPickWinning) {
          border = '1px solid #22c55e88';
        }
      }
    }

    let hash = 0;
    for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
    const hues = [210, 150, 270, 25, 190, 340, 45, 120, 290];
    const hue = hues[Math.abs(hash) % hues.length];

    return {
      background: `hsl(${hue}, 40%, 16%)`,
      color: `hsl(${hue}, 85%, 75%)`,
      border: border !== '1px solid transparent' ? border : `1px solid hsl(${hue}, 50%, 25%)`,
      opacity
    };
  };

  const exportCSV = () => {
    const exportUsers = [pinnedUser, ...sortedUnpinnedUsers];
    let csv = 'Matchup,' + exportUsers.map(u => `"${u.replace(/"/g, '""')} (${userStats[u]?.yearlyTotal || 0} pts)"`).join(',') + '\n';

    activeProps.forEach((prId, gIdx) => {
      const sId = String(prId || '');
      const propInfo = propMap[prId] || propMap[sId.slice(0, 7)] || { title: `Game #${gIdx + 1}` };
      const row = [`"${propInfo.title.replace(/"/g, '""')}"`];

      exportUsers.forEach(u => {
        const p = pickMap[u]?.[prId];
        const team = resolveTeamName(p, prId);
        const isLoneWolf = p?.side && gamePickStats[prId]?.[p.side] === 1;
        const val = team !== '—' ? `${team}${p?.pts ? ` (${p.pts})` : ''}${isLoneWolf ? ' [🐺 Lone Wolf]' : ''}` : '—';
        row.push(`"${val.replace(/"/g, '""')}"`);
      });
      csv += row.join(',') + '\n';
    });

    const addRow = (title, keyFn) => {
      const r = [`"${title}"`];
      exportUsers.forEach(u => r.push(`"${keyFn(userStats[u])}"`));
      csv += r.join(',') + '\n';
    };

    addRow("Points Earned", s => s?.earnedPts || 0);
    addRow("As It Stands (Ties=0)", s => s?.asItStands || 0);
    addRow("Max Points Possible", s => s?.maxPossible || 0);
    addRow("Total (incl. Week)", s => s?.totalWithWeek || 0);
    addRow("Delta vs ⭐ Pinned", s => {
      const d = (s?.asItStands || 0) - (pinnedStats.asItStands || 0);
      return d > 0 ? `+${d}` : `${d}`;
    });
    addRow("Accuracy ROI", s => s?.accuracyRoi !== null ? `${s.accuracyRoi}% (${s.earnedPts}/${s.decidedPts})` : '—');
    addRow("Gut Punch (8+ Pts Lost)", s => `-${s?.gutPunchPts || 0} pts`);
    addRow("Maverick Index", s => `${s?.roguePct || 0}% Rogue`);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cfb_pickem_analytics_wk_${selectedWeek + 1}.csv`;
    link.click();
  };

  const pinnedStats = userStats[pinnedUser] || { earnedPts: 0, asItStands: 0, maxPossible: 55, totalWithWeek: 0, yearlyTotal: 0, accuracyRoi: null, gutPunchPts: 0, roguePct: 0 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .matrix-table {
          width: max-content;
          table-layout: fixed;
          border-collapse: separate;
          border-spacing: 0;
        }
        .col-match {
          position: sticky;
          left: 0;
          z-index: 20;
          width: 128px;
          min-width: 128px;
          max-width: 128px;
          box-sizing: border-box;
          box-shadow: 2px 0 6px rgba(0,0,0,0.35);
        }
        .col-pinned {
          position: sticky;
          left: 128px;
          z-index: 20;
          width: 88px;
          min-width: 88px;
          max-width: 88px;
          box-sizing: border-box;
          box-shadow: 2px 0 6px rgba(0,0,0,0.35);
        }
        .col-other {
          width: 84px;
          min-width: 84px;
          max-width: 84px;
          box-sizing: border-box;
        }
        .pill-box {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 2px;
          padding: 3px 5px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          max-width: 78px;
          white-space: nowrap;
          overflow: hidden;
        }
        .badge-pts {
          padding: 1px 3px;
          border-radius: 8px;
          font-size: 9px;
          font-weight: 800;
        }

        @media (min-width: 768px) {
          .col-match {
            width: 180px;
            min-width: 180px;
            max-width: 180px;
          }
          .col-pinned {
            left: 180px;
            width: 120px;
            min-width: 120px;
            max-width: 120px;
          }
          .col-other {
            min-width: 115px;
            width: 115px;
            max-width: 115px;
          }
          .pill-box {
            padding: 4px 8px;
            border-radius: 16px;
            font-size: 12px;
            max-width: 105px;
            gap: 4px;
          }
        }
      `}} />

      {/* Header Bar */}
      <div style={{ padding: '8px 10px', background: '#111827', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
          <span style={{ fontSize: '14px', fontWeight: 800 }}>🏈</span>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(Number(e.target.value))}
            style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #334155', borderRadius: '5px', padding: '3px 4px', fontSize: '11px', fontWeight: 700 }}
          >
            {weekBlocks.map((_, i) => (
              <option key={i} value={i}>Wk {i + 1}</option>
            ))}
          </select>
          <select
            value={pinnedUser}
            onChange={(e) => handlePinnedUserChange(e.target.value)}
            style={{ background: '#0f172a', color: '#f59e0b', border: '1px solid #d97706', borderRadius: '5px', padding: '3px 4px', fontSize: '11px', fontWeight: 700, maxWidth: '110px' }}
          >
            {allUsers.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          {/* Analytics Toggle Button */}
          <button
            onClick={() => setShowAnalytics(!showAnalytics)}
            style={{
              background: showAnalytics ? '#38bdf822' : '#1e293b',
              color: showAnalytics ? '#38bdf8' : '#94a3b8',
              border: `1px solid ${showAnalytics ? '#38bdf8' : '#334155'}`,
              borderRadius: '5px',
              padding: '3px 5px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            📊 {showAnalytics ? 'Stats On' : 'Stats'}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: isOffline ? '#ef4444' : '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {isOffline ? '⚠️ Offline' : timeAgo}
          </span>
          <button onClick={() => fetchPicks(false)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>🔄</button>
          <button onClick={exportCSV} style={{ background: '#334155', border: '1px solid #475569', color: '#fff', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>📥</button>
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0b1120' }}>
        <table className="matrix-table" style={{ fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 30 }}>
              <th className="col-match" style={{ padding: '8px 8px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', color: '#93c5fd', fontWeight: 700 }}>
                Score / Matchup
              </th>
              
              <th className="col-pinned" style={{ padding: '8px 4px', background: '#1e293b', borderBottom: '2px solid #f59e0b', borderRight: '2px solid #f59e0b', color: '#f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⭐ {pinnedUser}</div>
                <div style={{ fontSize: '10px', color: '#fcd34d', fontWeight: 700 }}>({pinnedStats.yearlyTotal} pts)</div>
                {pinnedStats.isEliminated && (
                  <div style={{ fontSize: '8px', color: '#ef4444', fontWeight: 800 }}>❌ ELIM</div>
                )}
              </th>

              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { yearlyTotal: 0, isEliminated: false };
                return (
                  <th key={u} className="col-other" style={{ padding: '8px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '76px' }}>{u}</div>
                    <div style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 600 }}>({st.yearlyTotal} pts)</div>
                    {st.isEliminated && (
                      <div style={{ fontSize: '8px', color: '#ef4444', fontWeight: 800 }}>❌ ELIM</div>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeProps.map((prId, gIdx) => {
              const sId = String(prId || '');
              const propInfo = propMap[prId] || propMap[sId.slice(0, 7)] || { away: 'Away', home: 'Home', title: 'Matchup', score: null };
              const rowBg = gIdx % 2 === 0 ? '#0b1120' : '#0e1626';

              const counts = gamePickStats[prId] || { away: 0, home: 0 };
              const pinnedPick = pickMap[pinnedUser]?.[prId];
              const pinnedTeam = resolveTeamName(pinnedPick, prId);
              const isPinnedLoneWolf = pinnedPick?.side && counts[pinnedPick.side] === 1;

              const sc = propInfo.score;
              const isLive = sc?.state === 'in';
              const isFinal = sc?.state === 'post';
              const isHotGame = (prId === hotGameId);

              const awayLabel = formatAbbr(propInfo.away);
              const homeLabel = formatAbbr(propInfo.home);

              return (
                <tr key={prId} style={{ background: rowBg }}>
                  {/* Column 1: Stacked Scoreboard & Hot Game Tag */}
                  <td className="col-match" style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1f2937', background: rowBg }}>
                    {isHotGame && (
                      <div style={{ fontSize: '8px', color: '#f59e0b', fontWeight: 800, textTransform: 'uppercase', marginBottom: '2px' }}>
                        🔥 Game of the Week
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'away' ? '#38bdf8' : '#e2e8f0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '82px' }}>{awayLabel}</span>
                      <span style={{ minWidth: '18px', textAlign: 'right' }}>{sc?.awayScore ?? ''}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'home' ? '#38bdf8' : '#e2e8f0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '82px' }}>@{homeLabel}</span>
                      <span style={{ minWidth: '18px', textAlign: 'right' }}>{sc?.homeScore ?? ''}</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', fontSize: '9px', fontWeight: 600 }}>
                      <span style={{ color: isLive ? '#ef4444' : (isFinal ? '#64748b' : '#38bdf8') }}>
                        {isLive && '🔴 '}{sc?.statusDetail || 'Upcoming'}
                      </span>
                      {(counts.away > 0 || counts.home > 0) ? (
                        <span style={{ color: '#94a3b8' }}>📊 {counts.away}-{counts.home}</span>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '8px' }}>🔒 At kick</span>
                      )}
                    </div>
                  </td>

                  {/* Column 2: Pinned User */}
                  <td className="col-pinned" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '2px solid #f59e0b', background: rowBg, textAlign: 'center' }}>
                    {pinnedTeam === '—' ? (
                      <span style={{ color: '#475569' }}>—</span>
                    ) : (
                      <div className="pill-box" style={getPillCustomStyle(pinnedPick, prId)}>
                        {isPinnedLoneWolf && <span title="Lone Wolf (Only picker)">🐺</span>}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pinnedTeam}</span>
                        {pinnedPick?.pts && (
                          <span className="badge-pts" style={{ background: 'rgba(255,255,255,0.22)' }}>{pinnedPick.pts}</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* Other Competitors */}
                  {sortedUnpinnedUsers.map(u => {
                    const pick = pickMap[u]?.[prId];
                    const team = resolveTeamName(pick, prId);
                    const isLoneWolf = pick?.side && counts[pick.side] === 1;

                    return (
                      <td key={u} className="col-other" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', textAlign: 'center', verticalAlign: 'middle' }}>
                        {team === '—' ? (
                          <span style={{ color: '#475569' }}>—</span>
                        ) : (
                          <div className="pill-box" style={getPillCustomStyle(pick, prId)}>
                            {isLoneWolf && <span title="Lone Wolf (Only picker)">🐺</span>}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{team}</span>
                            {pick?.pts && (
                              <span className="badge-pts" style={{ background: 'rgba(255,255,255,0.18)' }}>{pick.pts}</span>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Standard Summary Rows */}
            <tr style={{ background: '#111827', borderTop: '2px solid #374151' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px', lineHeight: 1.1 }}>Points Earned</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Finalized Won</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#38bdf8' }}>{pinnedStats.earnedPts}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#38bdf8' }}>{userStats[u]?.earnedPts || 0}</div>
                </td>
              ))}
            </tr>

            <tr style={{ background: '#0f172a' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#a78bfa', fontSize: '11px', lineHeight: 1.1 }}>As It Stands</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Ties = 0 pts</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#a78bfa' }}>{pinnedStats.asItStands}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#a78bfa' }}>{userStats[u]?.asItStands || 0}</div>
                </td>
              ))}
            </tr>

            <tr style={{ background: '#0b1120' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '11px', lineHeight: 1.1 }}>Max Possible</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Max Potential</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#f59e0b' }}>{pinnedStats.maxPossible}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#fbbf24' }}>{userStats[u]?.maxPossible || 0}</div>
                </td>
              ))}
            </tr>

            <tr style={{ background: '#111827', borderTop: '1px solid #374151' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: showAnalytics ? '1px solid #1f2937' : 'none', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#34d399', fontSize: '11px', lineHeight: 1.1 }}>Total (incl. Wk)</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Season + Live</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: showAnalytics ? '1px solid #1f2937' : 'none', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#34d399' }}>{pinnedStats.totalWithWeek}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: showAnalytics ? '1px solid #1f2937' : 'none', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#34d399' }}>{userStats[u]?.totalWithWeek || 0}</div>
                </td>
              ))}
            </tr>

            {/* Advanced Analytics Rows (Toggleable) */}
            {showAnalytics && (
              <>
                {/* Analytics Row 1: Delta vs. Pinned */}
                <tr style={{ background: '#0f172a' }}>
                  <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px', lineHeight: 1.1 }}>Delta vs ⭐</div>
                    <div style={{ fontSize: '8px', color: '#94a3b8' }}>Spread to Pinned</div>
                  </td>
                  <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontWeight: 700 }}>
                    0 (Self)
                  </td>
                  {sortedUnpinnedUsers.map(u => {
                    const delta = (userStats[u]?.asItStands || 0) - (pinnedStats.asItStands || 0);
                    const isAhead = delta > 0;
                    const isTied = delta === 0;
                    return (
                      <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 800, fontSize: '11px', color: isTied ? '#94a3b8' : (isAhead ? '#22c55e' : '#ef4444') }}>
                          {isTied ? 'E' : (isAhead ? `+${delta}` : `${delta}`)}
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Analytics Row 2: Accuracy / ROI */}
                <tr style={{ background: '#0b1120' }}>
                  <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 800, color: '#ec4899', fontSize: '11px', lineHeight: 1.1 }}>ROI / Accuracy</div>
                    <div style={{ fontSize: '8px', color: '#94a3b8' }}>Won / Decided Pts</div>
                  </td>
                  <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '11px', color: '#ec4899' }}>
                      {pinnedStats.accuracyRoi !== null ? `${pinnedStats.accuracyRoi}%` : '—'}
                    </div>
                  </td>
                  {sortedUnpinnedUsers.map(u => (
                    <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 700, fontSize: '11px', color: '#ec4899' }}>
                        {userStats[u]?.accuracyRoi !== null ? `${userStats[u].accuracyRoi}%` : '—'}
                      </div>
                    </td>
                  ))}
                </tr>

                {/* Analytics Row 3: Gut Punch */}
                <tr style={{ background: '#0f172a' }}>
                  <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 800, color: '#f87171', fontSize: '11px', lineHeight: 1.1 }}>Gut Punch</div>
                    <div style={{ fontSize: '8px', color: '#94a3b8' }}>8+ Pts Lost</div>
                  </td>
                  <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '11px', color: pinnedStats.gutPunchPts > 0 ? '#ef4444' : '#64748b' }}>
                      {pinnedStats.gutPunchPts > 0 ? `-${pinnedStats.gutPunchPts}` : '0'}
                    </div>
                  </td>
                  {sortedUnpinnedUsers.map(u => {
                    const gp = userStats[u]?.gutPunchPts || 0;
                    return (
                      <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                        <div style={{ fontWeight: 700, fontSize: '11px', color: gp > 0 ? '#ef4444' : '#64748b' }}>
                          {gp > 0 ? `-${gp}` : '0'}
                        </div>
                      </td>
                    );
                  })}
                </tr>

                {/* Analytics Row 4: Maverick Index */}
                <tr style={{ background: '#0b1120' }}>
                  <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937' }}>
                    <div style={{ fontWeight: 800, color: '#eab308', fontSize: '11px', lineHeight: 1.1 }}>Maverick Index</div>
                    <div style={{ fontSize: '8px', color: '#94a3b8' }}>% Against Chalk</div>
                  </td>
                  <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '2px solid #374151', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: '11px', color: '#eab308' }}>
                      {pinnedStats.roguePct}%
                    </div>
                  </td>
                  {sortedUnpinnedUsers.map(u => (
                    <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '2px solid #374151', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                      <div style={{ fontWeight: 700, fontSize: '11px', color: '#eab308' }}>
                        {userStats[u]?.roguePct || 0}%
                      </div>
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
