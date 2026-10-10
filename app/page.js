'use client';

import { useState, useEffect, useMemo } from 'react';

const ABBR_FALLBACKS = {
  'alabama': 'BAMA',
  'mississippi state': 'MSST',
  'west virginia': 'WVU',
  'iowa state': 'ISU',
  'michigan': 'MICH',
  'minnesota': 'MINN',
  'ohio state': 'OSU',
  'iowa': 'IOWA',
  'florida': 'FLA',
  'missouri': 'MIZ',
  'virginia': 'UVA',
  'florida state': 'FSU',
  'kentucky': 'UK',
  'south carolina': 'SC',
  'byu': 'BYU',
  'tcu': 'TCU',
  'baylor': 'BAY',
  'arizona state': 'ASU',
  'cincinnati': 'CIN',
  'arizona': 'ARIZ',
  'texas': 'TEX',
  'oklahoma': 'OU',
  'georgia': 'UGA',
  'tennessee': 'TENN',
  'penn state': 'PSU',
  'usc': 'USC',
  'boise state': 'BSU',
  'fresno state': 'FRES',
  'north dakota state': 'NDSU',
  'unlv': 'UNLV',
  'wake forest': 'WAKE',
  'nc state': 'NCST',
  'pittsburgh': 'PITT',
  'north carolina': 'UNC',
  'texas a&m': 'TA&M',
  'houston': 'HOU',
  'kansas state': 'KSU'
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

function getRankTrend(initStr, liveStr) {
  if (!initStr || !liveStr || initStr === '—' || liveStr === '—') return null;
  const initNum = parseInt(String(initStr).replace(/[^0-9]/g, ''), 10);
  const liveNum = parseInt(String(liveStr).replace(/[^0-9]/g, ''), 10);
  if (isNaN(initNum) || isNaN(liveNum)) return null;

  const diff = initNum - liveNum; // Positive means rank improved (e.g. #4 -> #2 = +2)
  if (diff > 0) return { symbol: '▲', diff: `+${diff}`, color: '#22c55e' };
  if (diff < 0) return { symbol: '▼', diff: `${diff}`, color: '#ef4444' };
  return { symbol: '•', diff: '0', color: '#64748b' };
}

export default function MatrixDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pinnedUser, setPinnedUser] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [timeAgo, setTimeAgo] = useState('Just now');
  const [isOffline, setIsOffline] = useState(false);

  const fetchPicks = async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const res = await fetch(`/api/picks?_=${Date.now()}`);
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

  const { activeProps = [], propMap = {}, pickMap = {}, userYearlyScores = {}, userPeriodScores = {}, weekNumber = 6, buildHash = 'live' } = data || {};
  const allUsers = [data?.myUser, ...(data?.otherUsers || [])].filter(Boolean);
  const unpinnedUsers = allUsers.filter(u => u !== pinnedUser);

  const resolveTeamName = (pickObj, prId) => {
    const propInfo = propMap[prId] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

  const hasLiveGames = activeProps.some(prId => propMap[prId]?.score?.state === 'in');
  const hasUpcomingGames = activeProps.some(prId => {
    const st = propMap[prId]?.score?.state;
    return !st || st === 'pre';
  });
  const isWeekOver = activeProps.length > 0 && !hasLiveGames && !hasUpcomingGames;

  const formatDeviceTime = (propInfo) => {
    const dateVal = propInfo?.kickoffDate || propInfo?.kickoffTime;
    if (!dateVal) return 'Upcoming';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return 'Upcoming';
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) {
      return 'Upcoming';
    }
  };

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

        const propInfo = propMap[prId];
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
      if (userPeriodScores?.[u]?.[weekNumber] !== undefined) {
        alreadyCredited = userPeriodScores[u][weekNumber];
      } else if (isWeekOver) {
        alreadyCredited = earnedPts;
      }

      const initialPoints = Math.max(0, yearlyTotal - alreadyCredited);
      const pendingPoints = Math.max(0, asItStands - alreadyCredited);
      const totalWithWeek = yearlyTotal + pendingPoints;

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
  }, [allUsers, activeProps, pickMap, propMap, userYearlyScores, userPeriodScores, weekNumber, isWeekOver]);

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
      initialRanks: calculateRanks(initScores),
      liveRanks: calculateRanks(liveScores),
      weeklyRanks: calculateRanks(weekScores)
    };
  }, [allUsers, userStats]);

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
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#090d16' }}>
        <div style={{ fontSize: '32px', marginBottom: '10px' }}>🪨🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}>
          THE ROCK MAN GOT&apos;EM
        </div>
        <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>Loading live Week {weekNumber} slate...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#f87171' }}>
        Failed to load data: {error}
      </div>
    );
  }

  const renderPickPill = (pickObj, prId) => {
    const propInfo = propMap[prId] || {};
    const sc = propInfo.score;
    const isPreGame = !sc || sc.state === 'pre';
    const isFinished = sc?.state === 'post';
    const isLive = sc?.state === 'in';
    const leader = sc?.leader;

    const team = resolveTeamName(pickObj, prId);
    const pickedLogo = pickObj?.side === 'away' ? propInfo.awayLogo : (pickObj?.side === 'home' ? propInfo.homeLogo : '');

    // Frosted glass lock pill for hidden pre-game picks
    if (!pickObj || !pickObj.side || team === '—') {
      if (isPreGame) {
        return (
          <div className="frosted-hidden-pill" title="Pick concealed until kickoff">
            <span style={{ fontSize: '8px', opacity: 0.8 }}>🔒</span>
            <span>Hidden</span>
          </div>
        );
      }
      return <span style={{ color: '#475569' }}>—</span>;
    }

    const isWinning = Boolean(!isPreGame && sc && leader && leader !== 'tie' && pickObj?.side === leader);
    const isLosing = Boolean(!isPreGame && sc && leader && leader !== 'tie' && pickObj?.side !== leader);

    // Bad Beat and Upset calculation
    const aScoreNum = parseInt(sc?.awayScore || '0', 10);
    const hScoreNum = parseInt(sc?.homeScore || '0', 10);
    const scoreDiff = Math.abs(aScoreNum - hScoreNum);
    const isBadBeat = isFinished && isLosing && scoreDiff <= 3;
    const isUnderdogPick = Boolean(propInfo.odds?.favoriteSide && pickObj?.side && pickObj.side !== propInfo.odds.favoriteSide);
    const isUpsetHit = isFinished && isWinning && isUnderdogPick;

    let border = '1px solid transparent';
    let opacity = '1';

    if (isLive || isFinished) {
      if (isWinning) {
        border = isUpsetHit ? '1.5px solid #f59e0b' : '1.5px solid #22c55e';
      } else if (isLosing) {
        border = isBadBeat ? '1.5px solid #ec4899' : '1.5px solid #ef4444';
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
      <div className="pill-box" style={pillStyle} title={`${team} (${pickObj.pts || 0} pts)`}>
        {pickedLogo ? (
          <img
            src={pickedLogo}
            alt={team}
            className="pick-logo-img"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              if (e.currentTarget.nextSibling) {
                e.currentTarget.nextSibling.style.display = 'inline';
              }
            }}
          />
        ) : null}
        <span style={{ display: pickedLogo ? 'none' : 'inline', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', fontWeight: 800 }}>
          {team}
        </span>
        {pickObj?.pts && (
          <span className="badge-pts" style={{ background: isUpsetHit ? 'rgba(245, 158, 11, 0.45)' : 'rgba(255,255,255,0.22)' }}>
            {pickObj.pts}
          </span>
        )}

        {/* Status Badges */}
        {isFinished && isWinning && !isUpsetHit && (
          <span className="pill-badge" style={{ background: '#22c55e', color: '#fff' }}>✓</span>
        )}
        {isFinished && isUpsetHit && (
          <span className="pill-badge" style={{ background: '#f59e0b', color: '#fff' }} title="Underdog Upset Pick!">🔥</span>
        )}
        {isFinished && isLosing && !isBadBeat && (
          <span className="pill-badge" style={{ background: '#ef4444', color: '#fff' }}>✕</span>
        )}
        {isFinished && isBadBeat && (
          <span className="pill-badge" style={{ background: '#ec4899', color: '#fff' }} title="Bad Beat: Lost by 3 or less">💔</span>
        )}
      </div>
    );
  };

  const exportCSV = () => {
    const exportUsers = [pinnedUser, ...sortedUnpinnedUsers];
    let csv = 'Matchup,' + exportUsers.map(u => `"${u.replace(/"/g, '""')} (${userStats[u]?.totalWithWeek || 0} pts)"`).join(',') + '\n';

    activeProps.forEach((prId, gIdx) => {
      const propInfo = propMap[prId] || { title: `Game #${gIdx + 1}` };
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
    link.download = `rockman_got_em_week_${weekNumber}.csv`;
    link.click();
  };

  const pinnedStats = userStats[pinnedUser] || { earnedPts: 0, asItStands: 0, maxPossible: 55, totalWithWeek: 0, yearlyTotal: 0 };
  const pinnedTrend = getRankTrend(initialRanks[pinnedUser], liveRanks[pinnedUser]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#080c14', position: 'relative' }}>
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 0,
          opacity: 0.038,
          backgroundImage: `radial-gradient(circle at 50% 30%, #38bdf8 0%, transparent 65%),
            radial-gradient(circle at 80% 80%, #f59e0b 0%, transparent 55%),
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cpath fill='%23ffffff' d='M20 40 L60 20 L90 50 L50 80 Z M110 30 L150 60 L130 110 L80 90 Z M30 110 L70 90 L85 140 L35 150 Z' fill-opacity='0.6'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat'
        }}
      />

      <style dangerouslySetInnerHTML={{ __html: `
        .matrix-table {
          width: max-content;
          table-layout: fixed;
          border-collapse: separate;
          border-spacing: 0;
          position: relative;
          z-index: 1;
        }
        .col-match {
          position: sticky;
          left: 0;
          z-index: 20;
          width: 145px;
          min-width: 145px;
          max-width: 145px;
          box-sizing: border-box;
          box-shadow: 2px 0 6px rgba(0,0,0,0.5);
        }
        .col-pinned {
          position: sticky;
          left: 145px;
          z-index: 20;
          width: 88px;
          min-width: 88px;
          max-width: 88px;
          box-sizing: border-box;
          box-shadow: 2px 0 6px rgba(0,0,0,0.5);
        }
        .col-other {
          width: 84px;
          min-width: 84px;
          max-width: 84px;
          box-sizing: border-box;
        }
        .matchup-link {
          text-decoration: none;
          color: inherit;
          display: block;
          cursor: pointer;
          border-radius: 4px;
          transition: opacity 0.15s ease, filter 0.15s ease;
        }
        .matchup-link:hover {
          filter: brightness(1.15);
        }
        .pill-box {
          position: relative;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          padding: 2px 6px;
          min-height: 28px;
          border-radius: 14px;
          font-size: 11px;
          font-weight: 700;
          max-width: 80px;
          white-space: nowrap;
          box-sizing: border-box;
          transition: transform 0.15s ease;
        }
        .pick-logo-img {
          width: 21px;
          height: 21px;
