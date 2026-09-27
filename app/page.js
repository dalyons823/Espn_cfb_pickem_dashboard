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
    const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

  // Four-Row Calculation Engine
  const userStats = useMemo(() => {
    const stats = {};
    allUsers.forEach(u => {
      let earnedPts = 0;       // Row 1: Current points earned (Final only)
      let liveLeadingPts = 0;  // Points currently leading in live games
      let weekLostPts = 0;     // Points lost from finalized games

      activeProps.forEach(prId => {
        const p = pickMap[u]?.[prId];
        const pts = p?.pts || 0;

        const propInfo = propMap[prId] || propMap[prId.slice(0, 7)];
        const sc = propInfo?.score;
        const isFinal = sc?.state === 'post';
        const isLive = sc?.state === 'in';
        const leader = sc?.leader; // 'away', 'home', or 'tie'

        if (isFinal) {
          // If tie or pick incorrect, points are lost
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            earnedPts += pts;
          } else {
            weekLostPts += pts;
          }
        } else if (isLive) {
          // Live game: ties go to no one
          if (p?.side && leader && leader !== 'tie' && p.side === leader) {
            liveLeadingPts += pts;
          }
        }
      });

      // Row 2: As It Stands (Final won + Live leading; ties go to no one)
      const asItStands = earnedPts + liveLeadingPts;

      // Row 3: Max Possible (55 max minus lost games)
      const maxPossible = 55 - weekLostPts;

      // Row 4: Total Points including current week (Yearly overall + As It Stands)
      const yearlyTotal = userYearlyScores?.[u] ?? 0;
      const totalWithWeek = yearlyTotal + asItStands;

      stats[u] = {
        earnedPts,
        asItStands,
        maxPossible,
        yearlyTotal,
        totalWithWeek,
        liveLeadingPts
      };
    });
    return stats;
  }, [allUsers, activeProps, pickMap, propMap, userYearlyScores]);

  // Sort competitors by overall standings
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

  const getPillCustomStyle = (pickObj, prId) => {
    const team = resolveTeamName(pickObj, prId);
    if (!team || team === '—') {
      return { background: '#1e293b', color: '#64748b', border: '1px solid #334155' };
    }

    const propInfo = propMap[prId] || propMap[prId.slice(0, 7)];
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
      const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { title: `Game #${gIdx + 1}` };
      const row = [`"${propInfo.title.replace(/"/g, '""')}"`];

      exportUsers.forEach(u => {
        const p = pickMap[u]?.[prId];
        const team = resolveTeamName(p, prId);
        const val = team !== '—' ? `${team}${p?.pts ? ` (${p.pts})` : ''}` : '—';
        row.push(`"${val.replace(/"/g, '""')}"`);
      });
      csv += row.join(',') + '\n';
    });

    // 4 Summary rows in CSV
    const row1 = ['"Current Points Earned"'];
    exportUsers.forEach(u => row1.push(`"${userStats[u]?.earnedPts || 0}"`));
    csv += row1.join(',') + '\n';

    const row2 = ['"As It Stands (Ties=0)"'];
    exportUsers.forEach(u => row2.push(`"${userStats[u]?.asItStands || 0}"`));
    csv += row2.join(',') + '\n';

    const row3 = ['"Max Points Possible"'];
    exportUsers.forEach(u => row3.push(`"${userStats[u]?.maxPossible || 0}"`));
    csv += row3.join(',') + '\n';

    const row4 = ['"Total (incl. Week)"'];
    exportUsers.forEach(u => row4.push(`"${userStats[u]?.totalWithWeek || 0}"`));
    csv += row4.join(',') + '\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cfb_pickem_week_${selectedWeek + 1}.csv`;
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
          overflow: hidden;
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
              <option key={i} value={i}>Wk {i + 1}</option>
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
              </th>

              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { yearlyTotal: 0 };
                return (
                  <th key={u} className="col-other" style={{ padding: '8px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '76px' }}>{u}</div>
                    <div style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 600 }}>({st.yearlyTotal} pts)</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {activeProps.map((prId, gIdx) => {
              const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { away: 'Away', home: 'Home', title: 'Matchup', score: null };
              const rowBg = gIdx % 2 === 0 ? '#0b1120' : '#0e1626';

              const counts = { away: 0, home: 0 };
              allUsers.forEach(u => {
                const p = pickMap[u]?.[prId];
                if (p?.side === 'away') counts.away++;
                if (p?.side === 'home') counts.home++;
              });

              const pinnedPick = pickMap[pinnedUser]?.[prId];
              const pinnedTeam = resolveTeamName(pinnedPick, prId);

              const sc = propInfo.score;
              const isLive = sc?.state === 'in';
              const isFinal = sc?.state === 'post';

              const awayLabel = formatAbbr(propInfo.away);
              const homeLabel = formatAbbr(propInfo.home);

              return (
                <tr key={prId} style={{ background: rowBg }}>
                  {/* Column 1: Stacked Scoreboard */}
                  <td className="col-match" style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1f2937', background: rowBg }}>
                    {/* Away Team */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'away' ? '#38bdf8' : '#e2e8f0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '82px' }}>{awayLabel}</span>
                      <span style={{ minWidth: '18px', textAlign: 'right' }}>{sc?.awayScore ?? ''}</span>
                    </div>

                    {/* Home Team */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'home' ? '#38bdf8' : '#e2e8f0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '82px' }}>@{homeLabel}</span>
                      <span style={{ minWidth: '18px', textAlign: 'right' }}>{sc?.homeScore ?? ''}</span>
                    </div>

                    {/* Clock & Split Ratio */}
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
    
