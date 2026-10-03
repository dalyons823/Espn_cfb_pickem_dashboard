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
  const clean = name.trim().toLowerCase();
  return ABBR_FALLBACKS[clean] || name;
}

function calculateRanks(scoreMap) {
  const entries = Object.entries(scoreMap).sort((a, b) => b[1] - a[1]);
  const ranks = {};
  entries.forEach(([user, score]) => {
    const tiedCount = entries.filter(e => e[1] === score).length;
    const firstIdx = entries.findIndex(e => e[1] === score);
    ranks[user] = tiedCount > 1 ? `T-${firstIdx + 1}` : `${firstIdx + 1}`;
  });
  return ranks;
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

        if (json.currentWeek !== undefined && json.currentWeek !== null && json.currentWeek < (json.weekBlocks?.length || 0)) {
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

  const { weekBlocks = [], propMap = {}, pickMap = {}, userYearlyScores = {}, userPeriodScores = {} } = data || {};
  const activeProps = weekBlocks[selectedWeek] || [];
  const currentWeekNumber = selectedWeek + 1;
  const isLatestWeek = selectedWeek === (weekBlocks.length - 1);
  const allUsers = [data?.myUser, ...(data?.otherUsers || [])].filter(Boolean);
  const unpinnedUsers = allUsers.filter(u => u !== pinnedUser);

  const resolveTeamName = (pickObj, prId) => {
    const propInfo = propMap[prId] || propMap[String(prId)] || propMap[String(prId).slice(0, 7)] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

  const hasLiveGames = activeProps.some(prId => {
    const st = propMap[prId]?.score?.state || propMap[String(prId).slice(0, 7)]?.score?.state;
    return st === 'in';
  });
  const hasUpcomingGames = activeProps.some(prId => {
    const st = propMap[prId]?.score?.state || propMap[String(prId).slice(0, 7)]?.score?.state;
    return !st || st === 'pre';
  });
  const isWeekOver = activeProps.length > 0 && !hasLiveGames && !hasUpcomingGames;

  // Base Point Calculations
  const userStats = useMemo(() => {
    const stats = {};

    allUsers.forEach(u => {
      let earnedPts = 0;
      let liveLeadingPts = 0;
      let weekLostPts = 0;

      activeProps.forEach(prId => {
        const p = pickMap[u]?.[prId];
        const pts = p?.pts || 0;

        const propInfo = propMap[prId] || propMap[String(prId)] || propMap[String(prId).slice(0, 7)];
        const sc = propInfo?.score;
        const isFinal = sc?.state === 'post';
        const isLive = sc?.state === 'in';
        const leader = sc?.leader;

        if (isFinal) {
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            earnedPts += pts;
          } else {
            weekLostPts += pts;
          }
        } else if (isLive) {
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            liveLeadingPts += pts;
          }
        }
      });

      const asItStands = earnedPts + liveLeadingPts;
      const maxPossible = 55 - weekLostPts;
      const yearlyTotal = userYearlyScores?.[u] ?? 0;

      let alreadyCredited = 0;
      if (userPeriodScores?.[u]?.[currentWeekNumber] !== undefined) {
        alreadyCredited = userPeriodScores[u][currentWeekNumber];
      } else if (isWeekOver) {
        alreadyCredited = earnedPts;
      }

      const initialPoints = Math.max(0, yearlyTotal - alreadyCredited);

      let totalWithWeek = yearlyTotal;
      if (isLatestWeek) {
        const pendingPoints = Math.max(0, asItStands - alreadyCredited);
        totalWithWeek = yearlyTotal + pendingPoints;
      }

      stats[u] = {
        earnedPts,
        asItStands,
        maxPossible,
        yearlyTotal,
        initialPoints,
        totalWithWeek,
        liveLeadingPts
      };
    });
    return stats;
  }, [allUsers, activeProps, pickMap, propMap, userYearlyScores, userPeriodScores, currentWeekNumber, isWeekOver, isLatestWeek]);

  // Rank Calculation Maps
  const { initialRanks, liveRanks, weeklyRanks } = useMemo(() => {
    const initScores = {};
    const liveScores = {};
    const weekScores = {};

    allUsers.forEach(u => {
      initScores[u] = userStats[u]?.initialPoints ?? 0;
      liveScores[u] = userStats[u]?.totalWithWeek ?? 0;
      weekScores[u] = userStats[u]?.asItStands ?? 0;
    });

    return {
      initialRanks: selectedWeek === 0 ? {} : calculateRanks(initScores),
      liveRanks: calculateRanks(liveScores),
      weeklyRanks: calculateRanks(weekScores)
    };
  }, [allUsers, userStats, selectedWeek]);

  const sortedByInitial = useMemo(() => {
    return [...allUsers].sort((a, b) => (userStats[b]?.initialPoints ?? 0) - (userStats[a]?.initialPoints ?? 0));
  }, [allUsers, userStats]);

  const sortedByLive = useMemo(() => {
    return [...allUsers].sort((a, b) => (userStats[b]?.totalWithWeek ?? 0) - (userStats[a]?.totalWithWeek ?? 0));
  }, [allUsers, userStats]);

  const sortedByWeekly = useMemo(() => {
    return [...allUsers].sort((a, b) => (userStats[b]?.asItStands ?? 0) - (userStats[a]?.asItStands ?? 0));
  }, [allUsers, userStats]);

  const sortedUnpinnedUsers = useMemo(() => {
    return [...unpinnedUsers].sort((a, b) => {
      const statsA = userStats[a] || { totalWithWeek: 0, asItStands: 0 };
      const statsB = userStats[b] || { totalWithWeek: 0, asItStands: 0 };

      if (statsB.totalWithWeek !== statsA.totalWithWeek) {
        return statsB.totalWithWeek - statsA.totalWithWeek;
      }
      return statsB.asItStands - statsA.asItStands;
    });
  }, [unpinnedUsers, userStats]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b1120' }}>
        <div style={{ fontSize: '30px', marginBottom: '10px' }}>🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 600 }}>Syncing scores & standings...</div>
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

  const renderPickPill = (pickObj, prId) => {
    const team = resolveTeamName(pickObj, prId);
    if (!pickObj || !pickObj.side || team === '—') {
      return <span style={{ color: '#475569' }}>—</span>;
    }

    const propInfo = propMap[prId] || propMap[String(prId)] || propMap[String(prId).slice(0, 7)];
    const sc = propInfo?.score;
    const isFinished = sc?.state === 'post';
    const isLive = sc?.state === 'in';
    const leader = sc?.leader;

    const isWinning = Boolean(sc && leader && leader !== 'tie' && pickObj?.side === leader);
    const isLosing = Boolean(sc && leader && leader !== 'tie' && pickObj?.side !== leader);

    let border = '1px solid transparent';
    let opacity = '1';

    if (isLive || isFinished) {
      if (isWinning) {
        border = '1.5px solid #22c55e';
      } else if (isLosing) {
        border = '1.5px solid #ef4444';
        if (isFinished) opacity = '0.65';
      }
    }

    let hash = 0;
    for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
    const hues = [210, 150, 270, 25, 190, 340, 45, 120, 290];
    const hue = hues[Math.abs(hash) % hues.length];

    const pillStyle = {
      background: `hsl(${hue}, 40%, 16%)`,
      color: `hsl(${hue}, 85%, 75%)`,
      border: border !== '1px solid transparent' ? border : `1px solid hsl(${hue}, 50%, 25%)`,
      opacity
    };

    return (
      <div className="pill-box" style={pillStyle}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{team}</span>
        {pickObj?.pts && (
          <span className="badge-pts" style={{ background: 'rgba(255,255,255,0.22)' }}>{pickObj.pts}</span>
        )}

        {isFinished && isWinning && (
          <span
            style={{
              position: 'absolute',
              bottom: '-3px',
              left: '-3px',
              width: '12px',
              height: '12px',
              background: '#22c55e',
              color: '#ffffff',
              borderRadius: '50%',
              fontSize: '8px',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 4px rgba(0,0,0,0.8)',
              lineHeight: 1
            }}
          >
            ✓
          </span>
        )}
        {isFinished && isLosing && (
          <span
            style={{
              position: 'absolute',
              bottom: '-3px',
              left: '-3px',
              width: '12px',
              height: '12px',
              background: '#ef4444',
              color: '#ffffff',
              borderRadius: '50%',
              fontSize: '8px',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 4px rgba(0,0,0,0.8)',
              lineHeight: 1
            }}
          >
            ✕
          </span>
        )}
      </div>
    );
  };

  const exportCSV = () => {
    const exportUsers = [pinnedUser, ...sortedUnpinnedUsers];
    let csv = 'Matchup,' + exportUsers.map(u => `"${u.replace(/"/g, '""')} (${userStats[u]?.totalWithWeek || 0} pts)"`).join(',') + '\n';

    activeProps.forEach((prId, gIdx) => {
      const propInfo = propMap[prId] || propMap[String(prId)] || propMap[String(prId).slice(0, 7)] || { title: `Game #${gIdx + 1}` };
      const row = [`"${propInfo.title.replace(/"/g, '""')}"`];

      exportUsers.forEach(u => {
        const p = pickMap[u]?.[prId];
        const team = resolveTeamName(p, prId);
        const val = team !== '—' ? `${team}${p?.pts ? ` (${p.pts})` : ''}` : '—';
        row.push(`"${val.replace(/"/g, '""')}"`);
      });
      csv += row.join(',') + '\n';
    });

    const rows = [
      ['"Points Earned (Finalized)"', ...exportUsers.map(u => `"${userStats[u]?.earnedPts || 0}"`)],
      ['"As It Stands (Ties=0)"', ...exportUsers.map(u => `"${userStats[u]?.asItStands || 0}"`)],
      ['"Max Points Possible"', ...exportUsers.map(u => `"${userStats[u]?.maxPossible || 0}"`)],
      ['"Total (incl. Week)"', ...exportUsers.map(u => `"${userStats[u]?.totalWithWeek || 0}"`)],
      ['"Initial Rank"', ...exportUsers.map(u => `"${initialRanks[u] || '—'}"`)],
      ['"Live Rank"', ...exportUsers.map(u => `"${liveRanks[u] || '—'}"`)],
      ['"Weekly Rank"', ...exportUsers.map(u => `"${weeklyRanks[u] || '—'}"`)]
    ];

    rows.forEach(r => { csv += r.join(',') + '\n'; });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cfb_pickem_week_${currentWeekNumber}.csv`;
    link.click();
  };

  const pinnedStats = userStats[pinnedUser] || { earnedPts: 0, asItStands: 0, maxPossible: 55, totalWithWeek: 0, yearlyTotal: 0 };

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
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 3px;
          padding: 3px 5px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          max-width: 78px;
          white-space: nowrap;
        }
        .badge-pts {
          padding: 1px 4px;
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
            style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #334155', borderRadius: '5px', padding: '3px 6px', fontSize: '11px', fontWeight: 700 }}
          >
            {weekBlocks.map((_, i) => (
              <option key={i} value={i}>Week {i + 1}</option>
            ))}
          </select>
          <select
            value={pinnedUser}
            onChange={(e) => handlePinnedUserChange(e.target.value)}
            style={{ background: '#0f172a', color: '#f59e0b', border: '1px solid #d97706', borderRadius: '5px', padding: '3px 6px', fontSize: '11px', fontWeight: 700, maxWidth: '120px' }}
          >
            {allUsers.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: isOffline ? '#ef4444' : '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
            {isOffline ? '⚠️ Offline' : timeAgo}
          </span>
          <button onClick={() => fetchPicks(false)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>🔄</button>
          <button onClick={exportCSV} style={{ background: '#334155', border: '1px solid #475569', color: '#fff', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>📥</button>
        </div>
      </div>

      {/* Main Table Viewport */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0b1120' }}>
        <table className="matrix-table" style={{ fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 30 }}>
              <th className="col-match" style={{ padding: '8px 8px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', color: '#93c5fd', fontWeight: 700 }}>
                Score / Matchup
              </th>
              
              <th className="col-pinned" style={{ padding: '8px 4px', background: '#1e293b', borderBottom: '2px solid #f59e0b', borderRight: '2px solid #f59e0b', color: '#f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⭐ {pinnedUser}</div>
                <div style={{ fontSize: '10px', color: '#fcd34d', fontWeight: 700 }}>({pinnedStats.totalWithWeek} pts)</div>
              </th>

              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { totalWithWeek: 0 };
                return (
                  <th key={u} className="col-other" style={{ padding: '8px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '76px' }}>{u}</div>
                    <div style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 600 }}>({st.totalWithWeek} pts)</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeProps.map((prId, gIdx) => {
              const propInfo = propMap[prId] || propMap[String(prId)] || propMap[String(prId).slice(0, 7)] || { away: 'Away', home: 'Home', title: 'Matchup', score: null };
              const rowBg = gIdx % 2 === 0 ? '#0b1120' : '#0e1626';

              const counts = { away: 0, home: 0 };
              allUsers.forEach(u => {
                const p = pickMap[u]?.[prId];
                if (p?.side === 'away') counts.away++;
                if (p?.side === 'home') counts.home++;
              });

              const pinnedPick = pickMap[pinnedUser]?.[prId];

              const sc = propInfo.score;
              const isLive = sc?.state === 'in';
              const isFinal = sc?.state === 'post';

              const awayLabel = formatAbbr(propInfo.away);
              const homeLabel = formatAbbr(propInfo.home);

              return (
                <tr key={prId} style={{ background: rowBg }}>
                  <td className="col-match" style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1f2937', background: rowBg }}>
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

                  {/* Pinned User Column */}
                  <td className="col-pinned" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '2px solid #f59e0b', background: rowBg, textAlign: 'center' }}>
                    {renderPickPill(pinnedPick, prId)}
                  </td>

                  {/* Other Competitors */}
                  {sortedUnpinnedUsers.map(u => {
                    const pick = pickMap[u]?.[prId];
                    return (
                      <td key={u} className="col-other" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', textAlign: 'center', verticalAlign: 'middle' }}>
                        {renderPickPill(pick, prId)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/* Bottom Row 1: Points Earned */}
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

            {/* Bottom Row 2: As It Stands */}
            <tr style={{ background: '#0f172a' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#a78bfa', fontSize: '11px', lineHeight: 1.1 }}>As It Stands</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Ties = 0 pts</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#a78bfa' }}>{pinnedStats.asItStands}</div>
                {pinnedStats.liveLeadingPts > 0 && (
                  <div style={{ fontSize: '8px', color: '#22c55e' }}>+{pinnedStats.liveLeadingPts} live</div>
                )}
              </td>
              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { asItStands: 0, liveLeadingPts: 0 };
                return (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#a78bfa' }}>{st.asItStands}</div>
                    {st.liveLeadingPts > 0 && (
                      <div style={{ fontSize: '8px', color: '#22c55e' }}>+{st.liveLeadingPts} live</div>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Bottom Row 3: Max Possible */}
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

            {/* Bottom Row 4: Total (incl. Week) */}
            <tr style={{ background: '#111827', borderTop: '2px solid #374151' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#34d399', fontSize: '11px', lineHeight: 1.1 }}>Total (incl. Wk)</div>
                <div style={{ fontSize: '8px', color: '#94a3b8' }}>Season Standings</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '2px solid #374151', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#34d399' }}>{pinnedStats.totalWithWeek}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '12px', color: '#34d399' }}>{userStats[u]?.totalWithWeek || 0}</div>
                </td>
              ))}
            </tr>

            {/* Bottom Row 5: Initial Rank */}
            <tr style={{ background: '#0f172a' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#94a3b8', fontSize: '11px', lineHeight: 1.1 }}>Initial Rank</div>
                <div style={{ fontSize: '8px', color: '#64748b' }}>Entering Wk</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '12px', color: '#94a3b8' }}>{initialRanks[pinnedUser] ? `#${initialRanks[pinnedUser]}` : '—'}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '11px', color: '#94a3b8' }}>{initialRanks[u] ? `#${initialRanks[u]}` : '—'}</div>
                </td>
              ))}
            </tr>

            {/* Bottom Row 6: Live Rank */}
            <tr style={{ background: '#0b1120' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px', lineHeight: 1.1 }}>Live Rank</div>
                <div style={{ fontSize: '8px', color: '#64748b' }}>Overall Now</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '12px', color: '#38bdf8' }}>{liveRanks[pinnedUser] ? `#${liveRanks[pinnedUser]}` : '—'}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '11px', color: '#38bdf8' }}>{liveRanks[u] ? `#${liveRanks[u]}` : '—'}</div>
                </td>
              ))}
            </tr>

            {/* Bottom Row 7: Weekly Rank */}
            <tr style={{ background: '#111827', borderBottom: '2px solid #374151' }}>
              <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#f472b6', fontSize: '11px', lineHeight: 1.1 }}>Weekly Rank</div>
                <div style={{ fontSize: '8px', color: '#64748b' }}>This Week</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '2px solid #374151', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '12px', color: '#f472b6' }}>{weeklyRanks[pinnedUser] ? `#${weeklyRanks[pinnedUser]}` : '—'}</div>
              </td>
              {sortedUnpinnedUsers.map(u => (
                <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                  <div style={{ fontWeight: 700, fontSize: '11px', color: '#f472b6' }}>{weeklyRanks[u] ? `#${weeklyRanks[u]}` : '—'}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        {/* 3-Column Standings Leaderboard */}
        <div style={{ padding: '16px 10px 48px 10px', maxWidth: '620px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 800, color: '#f8fafc' }}>🏆 Leaderboard & Rankings</span>
            <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>Week {currentWeekNumber}</span>
          </div>

          <div style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' }}>
              <thead>
                <tr style={{ background: '#1e293b', borderBottom: '2px solid #374151' }}>
                  <th style={{ padding: '8px 6px', textAlign: 'left', color: '#94a3b8', fontWeight: 700, width: '33.33%', borderRight: '1px solid #1f2937' }}>
                    Initial Rank
                  </th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', color: '#38bdf8', fontWeight: 700, width: '33.33%', borderRight: '1px solid #1f2937' }}>
                    Current Rank
                  </th>
                  <th style={{ padding: '8px 6px', textAlign: 'left', color: '#f472b6', fontWeight: 700, width: '33.33%' }}>
                    Weekly Rank
                  </th>
                </tr>
              </thead>
              <tbody>
                {allUsers.map((_, idx) => {
                  const uInit = sortedByInitial[idx];
                  const uLive = sortedByLive[idx];
                  const uWeek = sortedByWeekly[idx];

                  const initRank = uInit ? (initialRanks[uInit] || (idx + 1)) : '—';
                  const liveRank = uLive ? (liveRanks[uLive] || (idx + 1)) : '—';
                  const weekRank = uWeek ? (weeklyRanks[uWeek] || (idx + 1)) : '—';

                  const rowBg = idx % 2 === 0 ? '#0b1120' : '#0e1626';

                  return (
                    <tr key={idx} style={{ background: rowBg, borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '6px 6px', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uInit ? (
                          <>
                            <span style={{ color: '#64748b', fontWeight: 700, fontSize: '10px', marginRight: '4px' }}>
                              {initRank}.
                            </span>
                            <span style={{ fontWeight: uInit === pinnedUser ? 800 : 600, color: uInit === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>
                              {uInit === pinnedUser ? '⭐ ' : ''}{uInit}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>
                              ({userStats[uInit]?.initialPoints ?? 0})
                            </span>
                          </>
                        ) : '—'}
                      </td>

                      <td style={{ padding: '6px 6px', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uLive ? (
                          <>
                            <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '10px', marginRight: '4px' }}>
                              {liveRank}.
                            </span>
                            <span style={{ fontWeight: uLive === pinnedUser ? 800 : 600, color: uLive === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>
                              {uLive === pinnedUser ? '⭐ ' : ''}{uLive}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>
                              ({userStats[uLive]?.totalWithWeek ?? 0})
                            </span>
                          </>
                        ) : '—'}
                      </td>

                      <td style={{ padding: '6px 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {uWeek ? (
                          <>
                            <span style={{ color: '#f472b6', fontWeight: 700, fontSize: '10px', marginRight: '4px' }}>
                              {weekRank}.
                            </span>
                            <span style={{ fontWeight: uWeek === pinnedUser ? 800 : 600, color: uWeek === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>
                              {uWeek === pinnedUser ? '⭐ ' : ''}{uWeek}
                            </span>
                            <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>
                              ({userStats[uWeek]?.asItStands ?? 0})
                            </span>
                          </>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
