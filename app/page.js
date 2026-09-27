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
          setSelectedWeek(0);
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

  // Calculate live statistics
  const userStats = useMemo(() => {
    const stats = {};
    allUsers.forEach(u => {
      let weekWonPts = 0;
      let weekLiveLeadingPts = 0;
      let weekLostPts = 0;

      activeProps.forEach(prId => {
        const p = pickMap[u]?.[prId];
        const pts = p?.pts || 0;

        const propInfo = propMap[prId] || propMap[prId.slice(0, 7)];
        const sc = propInfo?.score;
        const isFinal = sc?.state === 'post';
        const isLive = sc?.state === 'in';
        const leader = sc?.leader;

        if (isFinal) {
          if (p?.side && leader && p.side === leader) {
            weekWonPts += pts;
          } else {
            weekLostPts += pts;
          }
        } else if (isLive) {
          if (p?.side && leader && p.side === leader) {
            weekLiveLeadingPts += pts;
          }
        }
      });

      const weekLiveTotal = weekWonPts + weekLiveLeadingPts;
      const maxPotential = 55 - weekLostPts;
      const yearlyTotal = userYearlyScores?.[u] ?? 0;

      stats[u] = {
        weekWonPts,
        weekLiveLeadingPts,
        weekLiveTotal,
        maxPotential,
        yearlyTotal
      };
    });
    return stats;
  }, [allUsers, activeProps, pickMap, propMap, userYearlyScores]);

  // Sort competitors by overall yearly standings
  const sortedUnpinnedUsers = useMemo(() => {
    return [...unpinnedUsers].sort((a, b) => {
      const statsA = userStats[a] || { yearlyTotal: 0, weekLiveTotal: 0 };
      const statsB = userStats[b] || { yearlyTotal: 0, weekLiveTotal: 0 };

      if (statsB.yearlyTotal !== statsA.yearlyTotal) {
        return statsB.yearlyTotal - statsA.yearlyTotal;
      }
      return statsB.weekLiveTotal - statsA.weekLiveTotal;
    });
  }, [unpinnedUsers, userStats]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b1120' }}>
        <div style={{ fontSize: '30px', marginBottom: '10px' }}>🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 600 }}>Syncing schedule & picks...</div>
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
      const isPickWinning = (sc.leader === pickObj.side);
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

    const totalRow = ['"Week Total"'];
    exportUsers.forEach(u => {
      totalRow.push(`"${userStats[u]?.weekLiveTotal || 0}"`);
    });
    csv += totalRow.join(',') + '\n';

    const maxRow = ['"Max Potential"'];
    exportUsers.forEach(u => {
      maxRow.push(`"${userStats[u]?.maxPotential || 0}"`);
    });
    csv += maxRow.join(',') + '\n';

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cfb_pickem_week_${selectedWeek + 1}.csv`;
    link.click();
  };

  const pinnedStats = userStats[pinnedUser] || { yearlyTotal: 0, weekLiveTotal: 0, maxPotential: 55, weekLiveLeadingPts: 0 };

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
                  {/* Column 1: Matchup / Live Score / Kickoff Time */}
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
                        {isLive && '🔴 '}{sc?.statusDetail || propInfo.gameTime || 'Upcoming'}
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
                    return (
                      <td key={u} className="col-other" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', textAlign: 'center', verticalAlign: 'middle' }}>
                        {team === '—' ? (
                          <span style={{ color: '#475569' }}>—</span>
                        ) : (
                          <div className="pill-box" style={getPillCustomStyle(pick, prId)}>
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

            {/* Bottom Row 1: Week Total */}
            <tr style={{ background: '#111827', borderTop: '2px solid #374151' }}>
              <td className="col-match" style={{ padding: '8px 8px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px' }}>Week Total</div>
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>Live / Won Pts</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#38bdf8' }}>{pinnedStats.weekLiveTotal}</div>
                {pinnedStats.weekLiveLeadingPts > 0 && (
                  <div style={{ fontSize: '8px', color: '#22c55e' }}>+{pinnedStats.weekLiveLeadingPts} live</div>
                )}
              </td>
              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { weekLiveTotal: 0, weekLiveLeadingPts: 0 };
                return (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#38bdf8' }}>{st.weekLiveTotal}</div>
                    {st.weekLiveLeadingPts > 0 && (
                      <div style={{ fontSize: '8px', color: '#22c55e' }}>+{st.weekLiveLeadingPts} live</div>
                    )}
                  </td>
                );
              })}
            </tr>

            {/* Bottom Row 2: Max Potential */}
            <tr style={{ background: '#0b1120' }}>
              <td className="col-match" style={{ padding: '8px 8px', background: '#0b1120', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937' }}>
                <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '11px' }}>Max Potential</div>
                <div style={{ fontSize: '9px', color: '#94a3b8' }}>Max Possible Pts</div>
              </td>
              <td className="col-pinned" style={{ padding: '6px 4px', background: '#1e293b', borderBottom: '2px solid #374151', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '13px', color: '#f59e0b' }}>{pinnedStats.maxPotential}</div>
              </td>
              {sortedUnpinnedUsers.map(u => {
                const st = userStats[u] || { maxPotential: 55 };
                return (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#fbbf24' }}>{st.maxPotential}</div>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
