'use client';

import { useState, useEffect } from 'react';

export default function MatrixDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedWeek, setSelectedWeek] = useState(0);
  const [pinnedUser, setPinnedUser] = useState('');

  const fetchPicks = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/picks');
      if (!res.ok) throw new Error('Failed to load picks');
      const json = await res.json();
      setData(json);

      const allMembers = [json.myUser, ...(json.otherUsers || [])].filter(Boolean);
      const savedUser = typeof window !== 'undefined' ? localStorage.getItem('cfb_pinned_user') : null;

      if (savedUser && allMembers.includes(savedUser)) {
        setPinnedUser(savedUser);
      } else {
        setPinnedUser(json.myUser || allMembers[0] || '');
      }

      if (json.weekBlocks?.length) {
        setSelectedWeek(json.weekBlocks.length - 1);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();
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
        <div style={{ fontSize: '32px', marginBottom: '12px' }}>🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '15px', fontWeight: 600 }}>Loading live pick matrix...</div>
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

  const getPillStyle = (team) => {
    if (!team || team === '—') return { background: '#1e293b', color: '#64748b', border: '1px solid #334155' };
    let hash = 0;
    for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
    const hues = [210, 150, 270, 25, 190, 340, 45, 120, 290];
    const hue = hues[Math.abs(hash) % hues.length];
    return {
      background: `hsl(${hue}, 40%, 16%)`,
      color: `hsl(${hue}, 85%, 75%)`,
      border: `1px solid hsl(${hue}, 50%, 25%)`
    };
  };

  const resolveTeamName = (pickObj, prId, gIdx) => {
    const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    return pickObj.side === 'away' ? propInfo.away : propInfo.home;
  };

  const exportCSV = () => {
    const exportUsers = [pinnedUser, ...unpinnedUsers];
    let csv = 'Matchup,' + exportUsers.map(u => `"${u.replace(/"/g, '""')}"`).join(',') + '\n';

    activeProps.forEach((prId, gIdx) => {
      const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { title: `Game #${gIdx + 1}` };
      const row = [`"${propInfo.title.replace(/"/g, '""')}"`];

      exportUsers.forEach(u => {
        const p = pickMap[u]?.[prId];
        const team = resolveTeamName(p, prId, gIdx);
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
      <div style={{ padding: '12px 18px', background: '#111827', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: '17px', fontWeight: 800, color: '#f8fafc' }}>🏈 CFB Matrix</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Week:</span>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
              style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #334155', borderRadius: '6px', padding: '5px 8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              {weekBlocks.map((_, i) => (
                <option key={i} value={i} style={{ background: '#0f172a', color: '#fff' }}>Week {i + 1}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 600 }}>Pin Team:</span>
            <select
              value={pinnedUser}
              onChange={(e) => handlePinnedUserChange(e.target.value)}
              style={{ background: '#0f172a', color: '#f59e0b', border: '1px solid #d97706', borderRadius: '6px', padding: '5px 8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', maxWidth: '160px' }}
            >
              {allUsers.map(u => (
                <option key={u} value={u} style={{ background: '#0f172a', color: '#fff' }}>{u}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchPicks} style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>🔄 Refresh</button>
          <button onClick={exportCSV} style={{ background: '#334155', border: '1px solid #475569', color: '#fff', borderRadius: '8px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>📥 CSV</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', background: '#0b1120' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, fontSize: '13px', textAlign: 'left' }}>
          <thead>
            <tr style={{ position: 'sticky', top: 0, zIndex: 30 }}>
              <th style={{ padding: '12px 16px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', position: 'sticky', left: 0, zIndex: 40, width: '220px', minWidth: '220px', color: '#93c5fd', fontWeight: 700 }}>
                Matchup & Split
              </th>
              <th style={{ padding: '12px 14px', background: '#1e293b', borderBottom: '2px solid #f59e0b', borderRight: '2px solid #f59e0b', position: 'sticky', left: '220px', zIndex: 40, width: '140px', minWidth: '140px', color: '#f59e0b', fontWeight: 700, textAlign: 'center' }}>
                ⭐ {pinnedUser}
              </th>
              {unpinnedUsers.map(u => (
                <th key={u} style={{ padding: '12px 14px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', fontWeight: 600, textAlign: 'center', minWidth: '130px' }}>
                  {u}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeProps.map((prId, gIdx) => {
              const propInfo = propMap[prId] || propMap[prId.slice(0, 7)] || { title: `Game #${gIdx + 1}` };
              const rowBg = gIdx % 2 === 0 ? '#0b1120' : '#0e1626';

              const counts = {};
              allUsers.forEach(u => {
                const p = pickMap[u]?.[prId];
                const team = resolveTeamName(p, prId, gIdx);
                if (team !== '—') counts[team] = (counts[team] || 0) + 1;
              });
              const splitText = Object.keys(counts).map(k => `${k}: ${counts[k]}`).join(' vs ') || 'No picks';

              const pinnedPick = pickMap[pinnedUser]?.[prId];
              const pinnedTeam = resolveTeamName(pinnedPick, prId, gIdx);

              return (
                <tr key={prId} style={{ background: rowBg }}>
                  <td style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1f2937', position: 'sticky', left: 0, background: rowBg, zIndex: 20, width: '220px', minWidth: '220px' }}>
                    <div style={{ fontWeight: 600, color: '#f1f5f9', marginBottom: '3px' }}>{propInfo.title}</div>
                    <div style={{ fontSize: '11px', color: '#38bdf8', fontWeight: 500 }}>📊 {splitText}</div>
                  </td>
                  <td style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', borderRight: '2px solid #f59e0b', position: 'sticky', left: '220px', background: rowBg, zIndex: 20, textAlign: 'center', width: '140px', minWidth: '140px' }}>
                    {pinnedTeam === '—' ? (
                      <span style={{ color: '#475569' }}>—</span>
                    ) : (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 700, ...getPillStyle(pinnedTeam) }}>
                        <span>{pinnedTeam}</span>
                        {pinnedPick?.pts && (
                          <span style={{ background: 'rgba(255,255,255,0.22)', padding: '1px 5px', borderRadius: '10px', fontSize: '10px' }}>{pinnedPick.pts}</span>
                        )}
                      </div>
                    )}
                  </td>
                  {unpinnedUsers.map(u => {
                    const pick = pickMap[u]?.[prId];
                    const team = resolveTeamName(pick, prId, gIdx);
                    return (
                      <td key={u} style={{ padding: '8px 12px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', textAlign: 'center', verticalAlign: 'middle' }}>
                        {team === '—' ? (
                          <span style={{ color: '#475569' }}>—</span>
                        ) : (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 600, ...getPillStyle(team) }}>
                            <span>{team}</span>
                            {pick?.pts && (
                              <span style={{ background: 'rgba(255,255,255,0.18)', padding: '1px 5px', borderRadius: '10px', fontSize: '10px' }}>{pick.pts}</span>
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
              
