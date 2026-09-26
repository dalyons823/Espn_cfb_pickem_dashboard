'use client';

import { useState, useEffect } from 'react';

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

  const fetchPicks = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await fetch('/api/picks');
      if (!res.ok) throw new Error('Failed to load picks');
      const json = await res.json();
      setData(json);

      const allMembers = [json.myUser, ...(json.otherUsers || [])].filter(Boolean);
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('cfb_pinned_user') : null;

      if (!isBackground) {
        if (savedUser && allMembers.includes(savedUser)) {
          setPinnedUser(savedUser);
        } else {
          setPinnedUser(json.myUser || allMembers[0] || '');
        }

        if (json.weekBlocks?.length) {
          setSelectedWeek(json.weekBlocks.length - 1);
        }
      }
    } catch (err) {
      if (!isBackground) setError(err.message);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();
    const interval = setInterval(() => {
      fetchPicks(true);
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  const handlePinnedUserChange = (newUser) => {
    setPinnedUser(newUser);
    if (typeof window !== 'undefined') {
      localStorage.setItem('cfb_pinned_user', newUser);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0b1120' }}>
        <div style={{ fontSize: '30px', marginBottom: '10px' }}>🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 600 }}>Syncing scores & picks...</div>
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

  const { weekBlocks, propMap, pickMap } = data;
  const allUsers = [data.myUser, ...(data.otherUsers || [])].filter(Boolean);
  const unpinnedUsers = allUsers.filter(u => u !== pinnedUser);
  const activeProps = weekBlocks[selectedWeek] || [];

  const resolveTeamName = (pickObj, prId) => {
    const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

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
    const exportUsers = [pinnedUser, ...unpinnedUsers];
    let csv = 'Matchup,' + exportUsers.map(u => `"${u.replace(/"/g, '""')}"`).join(',') + '\n';

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

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `cfb_pickem_week_${selectedWeek + 1}.csv`;
    link.click();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        .col-match {
          position: sticky;
          left: 0;
          z-index: 20;
          width: 118px;
          min-width: 118px;
          max-width: 118px;
        }
        .col-pinned {
          position: sticky;
          left: 118px;
          z-index: 20;
          width: 84px;
          min-width: 84px;
          max-width: 84px;
        }
        .col-other {
          min-width: 80px;
          width: 80px;
        }
        .pill-box {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 3px;
          padding: 3px 6px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          max-width: 76px;
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
            width: 175px;
            min-width: 175px;
            max-width: 175px;
          }
          .col-pinned {
            left: 175px;
            width: 115px;
            min-width: 115px;
            max-width: 115px;
          }
          .col-other {
            min-width: 110px;
            width: 110px;
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
      <div style={{ padding: '8px 12px', background: '#111827', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{ fontSize: '15px', fontWeight: 800 }}>🏈 Pick'em</span>
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
            style={{ background: '#0f172a', color: '#f59e0b', border: '1px solid #d97706', borderRadius: '5px', padding: '3px 6px', fontSize: '11px', fontWeight: 700, maxWidth: '115px' }}
          >
            {allUsers.map(u => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={() => fetchPicks(false)} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>🔄</button>
          <button onClick={exportCSV} style={{ background: '#334155', border: '1px solid #475569', color: '#fff', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>📥 CSV</button>
        </div>
      </div>

      {/* Main Grid */}
      <div style={{ flex: 1, overflow: 'auto', background: '#0b1120' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '12px', textAlign: 'left' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 30 }}>
              <th className="col-match" style={{ padding: '8px 10px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', color: '#93c5fd', fontWeight: 700 }}>
                Score / Matchup
              </th>
              <th className="col-pinned" style={{ padding: '8px 4px', background: '#1e293b', borderBottom: '2px solid #f59e0b', borderRight: '2px solid #f59e0b', color: '#f59e0b', fontWeight: 700, textAlign: 'center' }}>
                ⭐ {pinnedUser}
              </th>
              {unpinnedUsers.map(u => (
                <th key={u} className="col-other" style={{ padding: '8px 6px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', fontWeight: 600, textAlign: 'center' }}>
                  {u}
                </th>
              ))}
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
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '78px' }}>{awayLabel}</span>
                      <span>{sc?.awayScore ?? ''}</span>
                    </div>

                    {/* Home Team */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'home' ? '#38bdf8' : '#e2e8f0' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '78px' }}>@{homeLabel}</span>
                      <span>{sc?.homeScore ?? ''}</span>
                    </div>

                    {/* Clock & Split Ratio */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '3px', fontSize: '9px', fontWeight: 600 }}>
                      <span style={{ color: isLive ? '#ef4444' : (isFinal ? '#64748b' : '#38bdf8') }}>
                        {isLive && '🔴 '}{sc?.statusDetail || 'Upcoming'}
                      </span>
                      {(counts.away > 0 || counts.home > 0) && (
                        <span style={{ color: '#94a3b8' }}>📊 {counts.away}-{counts.home}</span>
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
                  {unpinnedUsers.map(u => {
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
