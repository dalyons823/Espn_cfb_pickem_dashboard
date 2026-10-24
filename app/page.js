'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const ABBR_FALLBACKS = {
  'alabama': 'BAMA', 'mississippi state': 'MSST', 'west virginia': 'WVU', 'iowa state': 'ISU',
  'michigan': 'MICH', 'minnesota': 'MINN', 'ohio state': 'OSU', 'iowa': 'IOWA', 'florida': 'FLA',
  'missouri': 'MIZ', 'virginia': 'UVA', 'florida state': 'FSU', 'kentucky': 'UK', 'south carolina': 'SC',
  'byu': 'BYU', 'tcu': 'TCU', 'baylor': 'BAY', 'arizona state': 'ASU', 'cincinnati': 'CIN',
  'arizona': 'ARIZ', 'texas': 'TEX', 'oklahoma': 'OU', 'georgia': 'UGA', 'tennessee': 'TENN',
  'penn state': 'PSU', 'usc': 'USC', 'boise state': 'BSU', 'fresno state': 'FRES',
  'north dakota state': 'NDSU', 'unlv': 'UNLV', 'wake forest': 'WAKE', 'nc state': 'NCST',
  'pittsburgh': 'PITT', 'north carolina': 'UNC', 'texas a&m': 'TA&M', 'houston': 'HOU', 'kansas state': 'KSU'
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

  const diff = initNum - liveNum;
  if (diff > 0) return { symbol: '▲', diff: `+${diff}`, color: '#22c55e' };
  if (diff < 0) return { symbol: '▼', diff: `${Math.abs(diff)}`, color: '#ef4444' };
  return { symbol: '•', diff: '0', color: '#64748b' };
}

function getColorForUser(entryId) {
  let hash = 0;
  for (let i = 0; i < entryId.length; i++) hash = entryId.charCodeAt(i) + ((hash << 5) - hash);
  const hues = [210, 150, 270, 25, 190, 340, 45, 120, 290];
  const hue = hues[Math.abs(hash) % hues.length];
  return `hsl(${hue}, 85%, 65%)`;
}

// Sparkline SVG Generator for Win Probability behind the Matchup Cell
function WinProbSparkline({ history }) {
  if (!history || history.length < 2) return null;
  const width = 210;
  const height = 75;
  const len = history.length;

  const points = history.map((val, idx) => {
    const x = (idx / (len - 1)) * width;
    const y = height - (val / 100) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polyPoints = `${points[0].split(',')[0]},${height} ` + points.join(' ') + ` ${points[points.length - 1].split(',')[0]},${height}`;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.22 }}>
      <polygon points={polyPoints} fill="#38bdf8" />
      <polyline fill="none" stroke="#38bdf8" strokeWidth="2" points={points.join(' ')} />
      {/* 50% neutral line */}
      <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="#64748b" strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
    </svg>
  );
}

export default function MatrixDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pinnedUser, setPinnedUser] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [timeAgo, setTimeAgo] = useState('Just now');
  const [isOffline, setIsOffline] = useState(false);
  
  const [activeTab, setActiveTab] = useState('matchups');
  const [hoveredUser, setHoveredUser] = useState(null);
  const [chartMode, setChartMode] = useState('rank');

  const [selectedWeekParam, setSelectedWeekParam] = useState(null);

  const fetchPicks = async (isBackground = false, targetWeek = null) => {
    try {
      if (!isBackground) setLoading(true);
      const url = `/api/picks?_=${Date.now()}${targetWeek ? `&week=${targetWeek}` : ''}`;
      const res = await fetch(url);
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
      if (!isBackground) setError(err.message);
      else setIsOffline(true);
    } finally {
      if (!isBackground) setLoading(false);
    }
  };

  useEffect(() => {
    fetchPicks();
  }, []);

  const weekRef = useRef(selectedWeekParam);
  useEffect(() => {
    weekRef.current = selectedWeekParam;
  }, [selectedWeekParam]);

  useEffect(() => {
    const refreshInterval = setInterval(() => {
      fetchPicks(true, weekRef.current);
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
    if (typeof window !== 'undefined') localStorage.setItem('cfb_pinned_user', newUser);
  };

  const handleWeekChange = (w) => {
    setSelectedWeekParam(w);
    fetchPicks(false, w);
  };

  const { 
    activeProps = [], propMap = {}, pickMap = {}, 
    userPeriodScores = {}, userNames = {}, 
    weekNumber = 6, currentWeek = 6, buildHash = 'live' 
  } = data || {};
  
  const allUsers = [data?.myUser, ...(data?.otherUsers || [])].filter(Boolean);
  const unpinnedUsers = allUsers.filter(u => u !== pinnedUser);

  const resolveTeamName = (pickObj, prId) => {
    const propInfo = propMap[prId] || { away: 'Away', home: 'Home' };
    if (!pickObj || !pickObj.side) return '—';
    const raw = pickObj.side === 'away' ? propInfo.away : propInfo.home;
    return formatAbbr(raw);
  };

  const hasLiveGames = activeProps.some(prId => propMap[prId]?.score?.state === 'in');
  const hasUpcomingGames = activeProps.some(prId => !propMap[prId]?.score?.state || propMap[prId]?.score?.state === 'pre');
  const isWeekOver = activeProps.length > 0 && !hasLiveGames && !hasUpcomingGames;

  const formatDeviceTime = (propInfo) => {
    const dateVal = propInfo?.kickoffDate || propInfo?.kickoffTime;
    if (!dateVal) return 'Upcoming';
    try {
      const d = new Date(dateVal);
      if (isNaN(d.getTime())) return 'Upcoming';
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return 'Upcoming'; }
  };

  const userStats = useMemo(() => {
    const stats = {};
    allUsers.forEach(u => {
      let earnedPts = 0, liveLeadingPts = 0, weekLostPts = 0;
      activeProps.forEach(prId => {
        const p = pickMap[u]?.[prId];
        const pts = p?.pts || 0;
        const sc = propMap[prId]?.score;
        const isFinal = sc?.state === 'post', isLive = sc?.state === 'in', leader = sc?.leader;

        if (isFinal) {
          if (p?.side && leader && leader !== 'tie' && p.side === leader) earnedPts += pts;
          else weekLostPts += pts;
        } else if (isLive && p?.side && leader && leader !== 'tie' && p.side === leader) {
          liveLeadingPts += pts;
        }
      });

      const asItStands = earnedPts + liveLeadingPts;
      const maxPossible = 55 - weekLostPts;
      
      let pastTotal = 0;
      for (let w = 1; w < weekNumber; w++) {
        pastTotal += (userPeriodScores[u]?.[w] || 0);
      }

      const initialPoints = pastTotal;
      const totalWithWeek = pastTotal + asItStands;

      stats[u] = { earnedPts, asItStands, maxPossible, initialPoints, totalWithWeek, liveLeadingPts };
    });
    return stats;
  }, [allUsers, activeProps, pickMap, propMap, userPeriodScores, weekNumber]);

  const { initialRanks, liveRanks, weeklyRanks } = useMemo(() => {
    const initScores = {}, liveScores = {}, weekScores = {};
    allUsers.forEach(u => {
      initScores[u] = userStats[u]?.initialPoints ?? 0;
      liveScores[u] = userStats[u]?.totalWithWeek ?? 0;
      weekScores[u] = userStats[u]?.asItStands ?? 0;
    });
    return { initialRanks: calculateRanks(initScores), liveRanks: calculateRanks(liveScores), weeklyRanks: calculateRanks(weekScores) };
  }, [allUsers, userStats]);

  const sortedByInitial = useMemo(() => [...allUsers].sort((a, b) => (userStats[b]?.initialPoints ?? 0) - (userStats[a]?.initialPoints ?? 0)), [allUsers, userStats]);
  const sortedByLive = useMemo(() => [...allUsers].sort((a, b) => (userStats[b]?.totalWithWeek ?? 0) - (userStats[a]?.totalWithWeek ?? 0)), [allUsers, userStats]);
  const sortedByWeekly = useMemo(() => [...allUsers].sort((a, b) => (userStats[b]?.asItStands ?? 0) - (userStats[a]?.asItStands ?? 0)), [allUsers, userStats]);
  const sortedUnpinnedUsers = useMemo(() => [...unpinnedUsers].sort((a, b) => (userStats[b]?.totalWithWeek || 0) - (userStats[a]?.totalWithWeek || 0) || (userStats[b]?.asItStands || 0) - (userStats[a]?.asItStands || 0)), [unpinnedUsers, userStats]);

  const chartData = useMemo(() => {
    if (!allUsers.length) return [];
    const maxWeek = currentWeek; 
    const history = [];
    const cumulative = {};
    allUsers.forEach(u => cumulative[u] = 0);

    for (let w = 1; w <= maxWeek; w++) {
      const weekData = { name: `Wk ${w}` };
      const weekScores = {};

      allUsers.forEach(u => {
        const ptsThisWeek = userPeriodScores[u]?.[w] || 0;
        cumulative[u] += ptsThisWeek;
        if (w === currentWeek && weekNumber === currentWeek) {
           weekScores[u] = userStats[u]?.totalWithWeek || cumulative[u];
        } else {
           weekScores[u] = cumulative[u];
        }
      });

      if (chartMode === 'points') {
        allUsers.forEach(u => { weekData[u] = weekScores[u]; });
      } else {
        const sortedEntries = Object.entries(weekScores).sort((a, b) => b[1] - a[1]);
        allUsers.forEach(u => {
          const myScore = weekScores[u];
          const firstIdx = sortedEntries.findIndex(e => e[1] === myScore);
          weekData[u] = firstIdx + 1;
        });
      }
      history.push(weekData);
    }
    return history;
  }, [allUsers, userPeriodScores, weekNumber, currentWeek, userStats, chartMode]);

  const groupStatsData = useMemo(() => {
    if (!allUsers.length) return [];
    const stats = [];
    const maxWeek = currentWeek;

    for (let w = 1; w <= maxWeek; w++) {
      let scoresThisWeek = allUsers.map(u => {
        if (w === currentWeek && weekNumber === currentWeek) return userStats[u]?.asItStands || 0;
        return userPeriodScores[u]?.[w] || 0;
      });

      let pinnedScore = 0;
      if (pinnedUser) {
        if (w === currentWeek && weekNumber === currentWeek) {
          pinnedScore = userStats[pinnedUser]?.asItStands || 0;
        } else {
          pinnedScore = userPeriodScores[pinnedUser]?.[w] || 0;
        }
      }

      scoresThisWeek = scoresThisWeek.filter(score => score > 0);

      if (scoresThisWeek.length === 0) {
        stats.push({ week: w, name: `Wk ${w}`, max: 0, mean: 0, median: 0, min: 0, pinnedScore });
        continue;
      }

      const max = Math.max(...scoresThisWeek);
      const min = Math.min(...scoresThisWeek);
      
      const sum = scoresThisWeek.reduce((acc, val) => acc + val, 0);
      const mean = sum / scoresThisWeek.length;
      
      const sortedScores = [...scoresThisWeek].sort((a, b) => a - b);
      const mid = Math.floor(sortedScores.length / 2);
      const median = sortedScores.length % 2 !== 0 ? sortedScores[mid] : (sortedScores[mid - 1] + sortedScores[mid]) / 2;

      stats.push({
        week: w,
        name: `Wk ${w}`,
        max: parseFloat(max.toFixed(1)),
        mean: parseFloat(mean.toFixed(1)),
        median: parseFloat(median.toFixed(1)),
        min: parseFloat(min.toFixed(1)),
        pinnedScore: parseFloat(pinnedScore.toFixed(1))
      });
    }
    return stats;
  }, [allUsers, userPeriodScores, currentWeek, weekNumber, userStats, pinnedUser]);

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#090d16' }}>
        <div style={{ fontSize: '32px', marginBottom: '10px' }}>🪨🏈</div>
        <div style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 700, letterSpacing: '0.05em' }}>THE ROCK MAN GOT&apos;EM</div>
        <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px' }}>Loading historical matrix...</div>
      </div>
    );
  }

  if (error || !data) {
    return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#f87171' }}>Failed to load data: {error}</div>;
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

    if (!pickObj || !pickObj.side || team === '—') {
      if (isPreGame) return <div className="frosted-hidden-pill" title="Pick concealed until kickoff"><span style={{ fontSize: '8px', opacity: 0.8 }}>🔒</span><span>Hidden</span></div>;
      return <span style={{ color: '#475569' }}>—</span>;
    }

    const isWinning = Boolean(!isPreGame && sc && leader && leader !== 'tie' && pickObj?.side === leader);
    const isLosing = Boolean(!isPreGame && sc && leader && leader !== 'tie' && pickObj?.side !== leader);

    const aScoreNum = parseInt(sc?.awayScore || '0', 10);
    const hScoreNum = parseInt(sc?.homeScore || '0', 10);
    const scoreDiff = Math.abs(aScoreNum - hScoreNum);
    const isBadBeat = isFinished && isLosing && scoreDiff <= 3;
    const isUnderdogPick = Boolean(propInfo.odds?.favoriteSide && pickObj?.side && pickObj.side !== propInfo.odds.favoriteSide);
    const isUpsetHit = isFinished && isWinning && isUnderdogPick;

    let border = '1px solid transparent', opacity = '1';
    if (isLive || isFinished) {
      if (isWinning) border = isUpsetHit ? '1.5px solid #f59e0b' : '1.5px solid #22c55e';
      else if (isLosing) {
        border = isBadBeat ? '1.5px solid #ec4899' : '1.5px solid #ef4444';
        if (isFinished) opacity = '0.65';
      }
    }

    let hash = 0;
    for (let i = 0; i < team.length; i++) hash = team.charCodeAt(i) + ((hash << 5) - hash);
    const hues = [210, 150, 270, 25, 190, 340, 45, 120, 290];
    const hue = hues[Math.abs(hash) % hues.length];

    const pillStyle = { background: `hsl(${hue}, 40%, 16%)`, color: `hsl(${hue}, 85%, 75%)`, border: border !== '1px solid transparent' ? border : `1px solid hsl(${hue}, 50%, 25%)`, opacity };

    return (
      <div className="pill-box" style={pillStyle} title={`${team} (${pickObj.pts || 0} pts)`}>
        {pickedLogo ? (
          <img src={pickedLogo} alt={team} className="pick-logo-img" onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline'; }} />
        ) : null}
        <span style={{ display: pickedLogo ? 'none' : 'inline', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: '11px', fontWeight: 800 }}>{team}</span>
        {pickObj?.pts && <span className="badge-pts" style={{ background: isUpsetHit ? 'rgba(245, 158, 11, 0.45)' : 'rgba(255,255,255,0.22)' }}>{pickObj.pts}</span>}
        {isFinished && isWinning && !isUpsetHit && <span className="pill-badge" style={{ background: '#22c55e', color: '#fff' }}>✓</span>}
        {isFinished && isUpsetHit && <span className="pill-badge" style={{ background: '#f59e0b', color: '#fff' }} title="Underdog Upset Pick!">🔥</span>}
        {isFinished && isLosing && !isBadBeat && <span className="pill-badge" style={{ background: '#ef4444', color: '#fff' }}>✕</span>}
        {isFinished && isBadBeat && <span className="pill-badge" style={{ background: '#ec4899', color: '#fff' }} title="Bad Beat: Lost by 3 or less">💔</span>}
      </div>
    );
  };

  const exportCSV = () => {
    const exportUsers = [pinnedUser, ...sortedUnpinnedUsers];
    let csv = `Matchup (Wk ${weekNumber}),` + exportUsers.map(u => `"${(userNames[u] || u).replace(/"/g, '""')} (${userStats[u]?.totalWithWeek || 0} pts)"`).join(',') + '\n';
    activeProps.forEach((prId, gIdx) => {
      const propInfo = propMap[prId] || { title: `Game #${gIdx + 1}` };
      const row = [`"${propInfo.title.replace(/"/g, '""')}"`];
      exportUsers.forEach(u => {
        const p = pickMap[u]?.[prId], team = resolveTeamName(p, prId);
        row.push(`"${team !== '—' ? `${team}${p?.pts ? ` (${p.pts})` : ''}` : '—'}"`);
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

  const pinnedStats = userStats[pinnedUser] || { earnedPts: 0, asItStands: 0, maxPossible: 55, totalWithWeek: 0, initialPoints: 0 };
  const pinnedTrend = getRankTrend(initialRanks[pinnedUser], liveRanks[pinnedUser]);
  const pinnedColor = '#facc15';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#080c14', position: 'relative' }}>
      <div aria-hidden="true" style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, opacity: 0.038,
        backgroundImage: `radial-gradient(circle at 50% 30%, #38bdf8 0%, transparent 65%), radial-gradient(circle at 80% 80%, #f59e0b 0%, transparent 55%), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cpath fill='%23ffffff' d='M20 40 L60 20 L90 50 L50 80 Z M110 30 L150 60 L130 110 L80 90 Z M30 110 L70 90 L85 140 L35 150 Z' fill-opacity='0.6'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'repeat'
      }} />

      <style dangerouslySetInnerHTML={{ __html: `
        .matrix-table { width: max-content; table-layout: fixed; border-collapse: separate; border-spacing: 0; position: relative; z-index: 1; }
        .col-match { position: sticky; left: 0; z-index: 20; width: 155px; min-width: 155px; max-width: 155px; box-sizing: border-box; box-shadow: 2px 0 6px rgba(0,0,0,0.5); }
        .col-pinned { position: sticky; left: 155px; z-index: 20; width: 88px; min-width: 88px; max-width: 88px; box-sizing: border-box; box-shadow: 2px 0 6px rgba(0,0,0,0.5); }
        .col-other { width: 84px; min-width: 84px; max-width: 84px; box-sizing: border-box; }
        .matchup-link { text-decoration: none; color: inherit; display: block; cursor: pointer; border-radius: 4px; transition: opacity 0.15s ease, filter 0.15s ease; position: relative; overflow: hidden; }
        .matchup-link:hover { filter: brightness(1.15); }
        .pill-box { position: relative; display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 2px 6px; min-height: 28px; border-radius: 14px; font-size: 11px; font-weight: 700; max-width: 80px; white-space: nowrap; box-sizing: border-box; transition: transform 0.15s ease; }
        .pick-logo-img { width: 21px; height: 21px; object-fit: contain; flex-shrink: 0; }
        .pill-badge { position: absolute; bottom: -3px; left: -3px; width: 12px; height: 12px; border-radius: 50%; font-size: 8px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 4px rgba(0,0,0,0.8); line-height: 1; }
        .frosted-hidden-pill { display: inline-flex; align-items: center; justify-content: center; padding: 3px 6px; border-radius: 10px; background: rgba(255, 255, 255, 0.05); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid rgba(255, 255, 255, 0.12); color: #94a3b8; font-size: 9px; font-weight: 700; gap: 3px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08); letter-spacing: 0.02em; }
        .badge-pts { padding: 1px 4px; border-radius: 8px; font-size: 10px; font-weight: 800; line-height: 1.1; }
        .team-logo { width: 14px; height: 14px; object-fit: contain; margin-right: 4px; vertical-align: -2px; }
        .recharts-tooltip-cursor { fill: rgba(255, 255, 255, 0.05); }

        @media (min-width: 768px) {
          .col-match { width: 210px; min-width: 210px; max-width: 210px; }
          .col-pinned { left: 210px; width: 120px; min-width: 120px; max-width: 120px; }
          .col-other { min-width: 115px; width: 115px; max-width: 115px; }
          .pill-box { padding: 3px 8px; min-height: 32px; border-radius: 16px; font-size: 12px; max-width: 105px; gap: 6px; }
          .pick-logo-img { width: 24px; height: 24px; }
          .team-logo { width: 16px; height: 16px; }
        }
      `}} />

      {/* Header Bar */}
      <div style={{ padding: '8px 12px', background: 'linear-gradient(180deg, #111827 0%, #0c121e 100%)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', zIndex: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{ fontSize: '15px' }}>🪨</span>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <span style={{ fontSize: '12px', fontWeight: 900, letterSpacing: '0.04em', color: '#f8fafc', whiteSpace: 'nowrap' }}>THE ROCK MAN GOT&apos;EM</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px' }}>
              <span style={{ fontSize: '8px', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.08em' }}>CFB PICK&apos;EM</span>
              <span style={{ fontSize: '8px', fontFamily: 'monospace', color: '#64748b' }}>#{buildHash}</span>
            </div>
          </div>
          
          <select 
            value={weekNumber} 
            onChange={(e) => handleWeekChange(e.target.value)} 
            style={{ background: '#1e293b', color: '#f59e0b', border: '1px solid #78350f', borderRadius: '5px', padding: '2px 6px', fontSize: '11px', fontWeight: 800, cursor: 'pointer' }}
          >
            {Array.from({ length: currentWeek }, (_, i) => i + 1).map(w => (
              <option key={w} value={w}>Wk {w}</option>
            ))}
          </select>

          <select value={pinnedUser} onChange={(e) => handlePinnedUserChange(e.target.value)} style={{ background: '#0f172a', color: '#f59e0b', border: '1px solid #d97706', borderRadius: '5px', padding: '3px 6px', fontSize: '11px', fontWeight: 700, maxWidth: '120px' }}>
            {allUsers.map(u => <option key={u} value={u}>{userNames[u] || u}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '9px', color: isOffline ? '#ef4444' : '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>{isOffline ? '⚠️ Offline' : timeAgo}</span>
          <button onClick={() => fetchPicks(false, weekNumber)} title="Refresh" style={{ background: '#1e293b', border: '1px solid #334155', color: '#94a3b8', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>🔄</button>
          <button onClick={exportCSV} title="Export CSV" style={{ background: '#334155', border: '1px solid #475569', color: '#fff', borderRadius: '6px', padding: '4px 6px', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>📥</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#0f172a', borderBottom: '1px solid #1f2937', zIndex: 10 }}>
        {[
          { id: 'matchups', icon: '🏈', label: 'Matchups' },
          { id: 'leaderboard', icon: '🏆', label: 'Leaderboard' },
          { id: 'trends', icon: '📈', label: 'Trends' },
          { id: 'stats', icon: '📊', label: 'Stats' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '10px 0', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em',
              color: activeTab === tab.id ? '#38bdf8' : '#64748b',
              borderBottom: activeTab === tab.id ? '2px solid #38bdf8' : '2px solid transparent',
              background: activeTab === tab.id ? 'rgba(56, 189, 248, 0.05)' : 'transparent', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', borderTop: 'none', borderLeft: 'none', borderRight: 'none'
            }}
          >
            <span style={{ fontSize: '14px' }}>{tab.icon}</span> <span className="tab-label">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Viewport content */}
      <div style={{ flex: 1, overflow: 'auto', background: 'transparent', zIndex: 1 }}>
        
        {/* TAB 1: MATCHUPS MATRIX */}
        {activeTab === 'matchups' && (
          <table className="matrix-table" style={{ fontSize: '12px', textAlign: 'left', paddingBottom: '40px' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 30 }}>
                <th className="col-match" style={{ padding: '8px 8px', background: '#0f172a', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', color: '#93c5fd', fontWeight: 700 }}>Score / Matchup</th>
                <th className="col-pinned" style={{ padding: '8px 4px', background: '#1a2234', borderBottom: '2px solid #f59e0b', borderRight: '2px solid #f59e0b', color: '#f59e0b', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>⭐ {userNames[pinnedUser] || pinnedUser}</div>
                  <div style={{ fontSize: '10px', color: '#fcd34d', fontWeight: 700 }}>({pinnedStats.totalWithWeek} pts)</div>
                </th>
                {sortedUnpinnedUsers.map(u => (
                  <th key={u} className="col-other" style={{ padding: '8px 4px', background: '#0f172a', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', color: '#e2e8f0', textAlign: 'center' }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '76px' }}>{userNames[u] || u}</div>
                    <div style={{ fontSize: '10px', color: '#93c5fd', fontWeight: 600 }}>({(userStats[u]?.totalWithWeek || 0)} pts)</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeProps.map((prId, gIdx) => {
                const propInfo = propMap[prId] || { away: 'Away', home: 'Home', title: 'Matchup', score: null, odds: null };
                const rowBg = gIdx % 2 === 0 ? 'rgba(11, 17, 32, 0.85)' : 'rgba(14, 22, 38, 0.85)';
                const counts = { away: 0, home: 0 };
                allUsers.forEach(u => { const p = pickMap[u]?.[prId]; if (p?.side === 'away') counts.away++; if (p?.side === 'home') counts.home++; });

                const sc = propInfo.score;
                const isPreGame = !sc || sc.state === 'pre', isLive = sc?.state === 'in', isFinal = sc?.state === 'post';
                const awayLabel = formatAbbr(propInfo.away), homeLabel = formatAbbr(propInfo.home);
                const isAwayFav = propInfo.odds?.favoriteSide === 'away', isHomeFav = propInfo.odds?.favoriteSide === 'home', lineSpread = propInfo.odds?.lineSpread || '';

                return (
                  <tr key={prId} style={{ background: rowBg }}>
                    <td className="col-match" style={{ padding: '6px 8px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1f2937', background: gIdx % 2 === 0 ? '#0b1120' : '#0e1626' }}>
                      <a href={propInfo.espnUrl || 'https://www.espn.com/college-football/scoreboard'} target="_blank" rel="noopener noreferrer" className="matchup-link" title={`Open ${propInfo.title} on ESPN`}>
                        
                        {/* EMBEDDED WIN PROBABILITY SPARKLINE GRAPH BEHIND THE TEXT */}
                        <WinProbSparkline history={sc?.winProbHistory} />

                        {/* Away Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'away' ? '#38bdf8' : '#e2e8f0', position: 'relative', zIndex: 1 }}>
                          <span style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                            {propInfo.awayLogo && <img src={propInfo.awayLogo} alt="" className="team-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                            <span>{awayLabel}</span>
                            {isLive && sc?.possession === 'away' && <span style={{ fontSize: '9px', marginLeft: '4px' }} title="Possession">🏈</span>}
                            {isAwayFav && <span style={{ color: '#fef08a', fontSize: '9px', fontWeight: 800, marginLeft: '4px' }}>{lineSpread}</span>}
                          </span>
                          <span style={{ minWidth: '18px', textAlign: 'right' }}>{isPreGame ? '' : (sc?.awayScore ?? '')}</span>
                        </div>
                        
                        {/* Home Row */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px', fontWeight: 700, color: sc?.leader === 'home' ? '#38bdf8' : '#e2e8f0', marginTop: '1px', position: 'relative', zIndex: 1 }}>
                          <span style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                            {propInfo.homeLogo && <img src={propInfo.homeLogo} alt="" className="team-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                            <span>@{homeLabel}</span>
                            {isLive && sc?.possession === 'home' && <span style={{ fontSize: '9px', marginLeft: '4px' }} title="Possession">🏈</span>}
                            {isHomeFav && <span style={{ color: '#fef08a', fontSize: '9px', fontWeight: 800, marginLeft: '4px' }}>{lineSpread}</span>}
                          </span>
                          <span style={{ minWidth: '18px', textAlign: 'right' }}>{isPreGame ? '' : (sc?.homeScore ?? '')}</span>
                        </div>
                        
                        {/* Status Row (Clock, TV, Clean Down & Distance) */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', marginTop: '3px', position: 'relative', zIndex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '9px', fontWeight: 600 }}>
                            <span style={{ color: isLive ? '#ef4444' : (isFinal ? '#64748b' : '#38bdf8'), display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                              <span>{isLive ? '🔴 ' + sc.statusDetail : (isFinal ? (sc.statusDetail || 'Final') : formatDeviceTime(propInfo))}</span>
                              {propInfo.tv && <span style={{ color: '#cbd5e1', fontSize: '8px', background: 'rgba(255,255,255,0.1)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700 }}>📺 {propInfo.tv}</span>}
                            </span>
                            {(counts.away > 0 || counts.home > 0) ? <span style={{ color: '#94a3b8', flexShrink: 0 }}>📊 {counts.away}-{counts.home}</span> : <span style={{ color: '#64748b', fontSize: '8px' }}>🔒 At kick</span>}
                          </div>
                          
                          {/* Clean Down & Distance / Yard Line */}
                          {isLive && sc?.situationSummary && (
                            <div style={{ fontSize: '8.5px', fontWeight: 600, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {sc.situationSummary}
                            </div>
                          )}
                        </div>

                      </a>
                    </td>
                    <td className="col-pinned" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '2px solid #f59e0b', background: gIdx % 2 === 0 ? '#111927' : '#141d2e', textAlign: 'center' }}>
                      {renderPickPill(pickMap[pinnedUser]?.[prId], prId)}
                    </td>
                    {sortedUnpinnedUsers.map(u => (
                      <td key={u} className="col-other" style={{ padding: '4px 2px', borderBottom: '1px solid #1e293b', borderRight: '1px solid #1e293b', textAlign: 'center', verticalAlign: 'middle' }}>
                        {renderPickPill(pickMap[u]?.[prId], prId)}
                      </td>
                    ))}
                  </tr>
                );
              })}

              {/* Matrix Summary Rows */}
              <tr style={{ background: '#111827', borderTop: '2px solid #374151' }}>
                <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px', lineHeight: 1.1 }}>Points Earned</div>
                  <div style={{ fontSize: '8px', color: '#94a3b8' }}>Finalized Won</div>
                </td>
                <td className="col-pinned" style={{ padding: '6px 4px', background: '#1a2234', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '13px', color: '#38bdf8' }}>{pinnedStats.earnedPts}</div>
                </td>
                {sortedUnpinnedUsers.map(u => (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#38bdf8' }}>{userStats[u]?.earnedPts || 0}</div>
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#0f172a' }}>
                <td className="col-match" style={{ padding: '6px 8px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 800, color: '#a78bfa', fontSize: '11px', lineHeight: 1.1 }}>As It Stands</div>
                  <div style={{ fontSize: '8px', color: '#94a3b8' }}>Ties = 0 pts</div>
                </td>
                <td className="col-pinned" style={{ padding: '6px 4px', background: '#1a2234', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '13px', color: '#a78bfa' }}>{pinnedStats.asItStands}</div>
                  {pinnedStats.liveLeadingPts > 0 && <div style={{ fontSize: '8px', color: '#22c55e' }}>+{pinnedStats.liveLeadingPts} live</div>}
                </td>
                {sortedUnpinnedUsers.map(u => {
                  const st = userStats[u] || { asItStands: 0, liveLeadingPts: 0 };
                  return (
                    <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0f172a', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center' }}>
                      <div style={{ fontWeight: 700, fontSize: '12px', color: '#a78bfa' }}>{st.asItStands}</div>
                      {st.liveLeadingPts > 0 && <div style={{ fontSize: '8px', color: '#22c55e' }}>+{st.liveLeadingPts} live</div>}
                    </td>
                  );
                })}
              </tr>
              <tr style={{ background: '#0b1120' }}>
                <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '11px', lineHeight: 1.1 }}>Max Possible</div>
                  <div style={{ fontSize: '8px', color: '#94a3b8' }}>Max Potential</div>
                </td>
                <td className="col-pinned" style={{ padding: '6px 4px', background: '#1a2234', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '13px', color: '#f59e0b' }}>{pinnedStats.maxPossible}</div>
                </td>
                {sortedUnpinnedUsers.map(u => (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#fbbf24' }}>{userStats[u]?.maxPossible || 0}</div>
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#111827', borderTop: '2px solid #374151' }}>
                <td className="col-match" style={{ padding: '6px 8px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 800, color: '#34d399', fontSize: '11px', lineHeight: 1.1 }}>Total (incl. Wk)</div>
                  <div style={{ fontSize: '8px', color: '#94a3b8' }}>Season Standings</div>
                </td>
                <td className="col-pinned" style={{ padding: '6px 4px', background: '#1a2234', borderBottom: '2px solid #374151', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                  <div style={{ fontWeight: 800, fontSize: '13px', color: '#34d399' }}>{pinnedStats.totalWithWeek}</div>
                </td>
                {sortedUnpinnedUsers.map(u => (
                  <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#111827', borderBottom: '2px solid #374151', borderRight: '1px solid #1e2937', textAlign: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '12px', color: '#34d399' }}>{userStats[u]?.totalWithWeek || 0}</div>
                  </td>
                ))}
              </tr>
              <tr style={{ background: '#0b1120' }}>
                <td className="col-match" style={{ padding: '6px 8px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1f2937' }}>
                  <div style={{ fontWeight: 800, color: '#38bdf8', fontSize: '11px', lineHeight: 1.1 }}>Live Rank</div>
                  <div style={{ fontSize: '8px', color: '#64748b' }}>Overall Now</div>
                </td>
                <td className="col-pinned" style={{ padding: '6px 4px', background: '#1a2234', borderBottom: '1px solid #1f2937', borderRight: '2px solid #f59e0b', textAlign: 'center' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                    <span style={{ fontWeight: 800, fontSize: '12px', color: '#38bdf8' }}>{liveRanks[pinnedUser] ? `#${liveRanks[pinnedUser]}` : '—'}</span>
                    {pinnedTrend && <span style={{ fontSize: '8px', fontWeight: 800, color: pinnedTrend.color }}>{pinnedTrend.symbol}</span>}
                  </div>
                </td>
                {sortedUnpinnedUsers.map(u => {
                  const tr = getRankTrend(initialRanks[u], liveRanks[u]);
                  return (
                    <td key={u} className="col-other" style={{ padding: '6px 4px', background: '#0b1120', borderBottom: '1px solid #1f2937', borderRight: '1px solid #1e2937', textAlign: 'center' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <span style={{ fontWeight: 700, fontSize: '11px', color: '#38bdf8' }}>{liveRanks[u] ? `#${liveRanks[u]}` : '—'}</span>
                        {tr && <span style={{ fontSize: '8px', fontWeight: 800, color: tr.color }}>{tr.symbol}</span>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        )}

        {/* TAB 2: LEADERBOARD TABLE */}
        {activeTab === 'leaderboard' && (
          <div style={{ padding: '24px 16px 48px 16px', maxWidth: '620px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '15px', fontWeight: 900, color: '#f8fafc', letterSpacing: '0.04em' }}>LEADERBOARD</span>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>As of Week {weekNumber}</span>
            </div>
            <div style={{ background: '#0e1626', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'fixed' }}>
                <thead>
                  <tr style={{ background: '#1a2234', borderBottom: '2px solid #374151' }}>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#94a3b8', fontWeight: 700, width: '33.33%', borderRight: '1px solid #1f2937' }}>Initial Rank</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#38bdf8', fontWeight: 700, width: '33.33%', borderRight: '1px solid #1f2937' }}>Current Rank (Trend)</th>
                    <th style={{ padding: '10px 8px', textAlign: 'left', color: '#f472b6', fontWeight: 700, width: '33.33%' }}>Weekly Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers.map((_, idx) => {
                    const uInit = sortedByInitial[idx], uLive = sortedByLive[idx], uWeek = sortedByWeekly[idx];
                    const initRank = uInit ? (initialRanks[uInit] || (idx + 1)) : '—';
                    const liveRank = uLive ? (liveRanks[uLive] || (idx + 1)) : '—';
                    const weekRank = uWeek ? (weeklyRanks[uWeek] || (idx + 1)) : '—';
                    const trend = uLive ? getRankTrend(initialRanks[uLive], liveRanks[uLive]) : null;
                    const rowBg = idx % 2 === 0 ? 'rgba(11, 17, 32, 0.7)' : 'rgba(14, 22, 38, 0.7)';

                    return (
                      <tr key={idx} style={{ background: rowBg, borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {uInit ? (
                            <>
                              <span style={{ color: '#64748b', fontWeight: 700, fontSize: '11px', marginRight: '4px' }}>{initRank}.</span>
                              <span style={{ fontWeight: uInit === pinnedUser ? 800 : 600, color: uInit === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>{uInit === pinnedUser ? '⭐ ' : ''}{userNames[uInit] || uInit}</span>
                              <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>({userStats[uInit]?.initialPoints ?? 0})</span>
                            </>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {uLive ? (
                            <>
                              <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: '11px', marginRight: '4px' }}>{liveRank}.</span>
                              <span style={{ fontWeight: uLive === pinnedUser ? 800 : 600, color: uLive === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>{uLive === pinnedUser ? '⭐ ' : ''}{userNames[uLive] || uLive}</span>
                              {trend && <span style={{ fontSize: '10px', fontWeight: 800, color: trend.color, marginLeft: '4px' }}>{trend.symbol} {trend.diff}</span>}
                              <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>({userStats[uLive]?.totalWithWeek ?? 0})</span>
                            </>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '8px 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {uWeek ? (
                            <>
                              <span style={{ color: '#f472b6', fontWeight: 700, fontSize: '11px', marginRight: '4px' }}>{weekRank}.</span>
                              <span style={{ fontWeight: uWeek === pinnedUser ? 800 : 600, color: uWeek === pinnedUser ? '#f59e0b' : '#e2e8f0' }}>{uWeek === pinnedUser ? '⭐ ' : ''}{userNames[uWeek] || uWeek}</span>
                              <span style={{ color: '#94a3b8', fontSize: '10px', marginLeft: '3px' }}>({userStats[uWeek]?.asItStands ?? 0})</span>
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
        )}

        {/* TAB 3: TRENDS CHART */}
        {activeTab === 'trends' && (
          <div style={{ padding: '24px 16px 48px 16px', maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column' }}>
             <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 900, color: '#f8fafc', letterSpacing: '0.04em' }}>SEASON TRENDS</span>
              <div style={{ display: 'flex', gap: '4px', background: 'rgba(30,41,59,0.5)', padding: '4px', borderRadius: '8px', border: '1px solid #1f2937' }}>
                <button 
                  onClick={() => setChartMode('rank')}
                  style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 800, borderRadius: '4px', background: chartMode === 'rank' ? '#38bdf8' : 'transparent', color: chartMode === 'rank' ? '#0f172a' : '#94a3b8', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  Rank
                </button>
                <button 
                  onClick={() => setChartMode('points')}
                  style={{ padding: '4px 12px', fontSize: '11px', fontWeight: 800, borderRadius: '4px', background: chartMode === 'points' ? '#38bdf8' : 'transparent', color: chartMode === 'points' ? '#0f172a' : '#94a3b8', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                >
                  Points
                </button>
              </div>
            </div>
            
            <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px 10px 10px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <div style={{ width: '100%', height: '400px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="name" stroke="#64748b" tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 600}} tickLine={false} axisLine={false} dy={10} />
                    <YAxis 
                      stroke="#64748b" 
                      tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 600}} 
                      tickLine={false} 
                      axisLine={false}
                      reversed={chartMode === 'rank'}
                      domain={chartMode === 'rank' ? [1, allUsers.length] : ['auto', 'auto']}
                      tickFormatter={(val) => chartMode === 'rank' ? `#${val}` : val}
                      interval="preserveStartEnd"
                      minTickGap={10}
                    />
                    <Tooltip 
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', boxShadow: '0 8px 16px rgba(0,0,0,0.8)' }}
                      itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', fontWeight: 800 }}
                      cursor={{ stroke: 'rgba(255,255,255,0.05)', strokeWidth: 2 }}
                      formatter={(value) => [chartMode === 'rank' ? `#${value}` : `${value} pts`, undefined]}
                    />
                    {allUsers.map(u => {
                      const isHovered = hoveredUser === u;
                      const isDimmed = hoveredUser && hoveredUser !== u;
                      const isPinned = u === pinnedUser;
                      return (
                        <Line
                          key={u}
                          type="monotone"
                          dataKey={u}
                          name={userNames[u] || u}
                          stroke={getColorForUser(u)}
                          strokeWidth={isHovered ? 4 : (isPinned ? 3 : 2)}
                          opacity={isDimmed ? 0.15 : 1}
                          dot={isHovered || isPinned ? { r: 5, strokeWidth: 0, fill: getColorForUser(u) } : false}
                          activeDot={{ r: 7, strokeWidth: 0, fill: '#fff' }}
                          animationDuration={500}
                        />
                      );
                    })}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '20px', padding: '0 10px', justifyContent: 'center' }}>
                {allUsers.map(u => {
                   const color = getColorForUser(u);
                   const isDimmed = hoveredUser && hoveredUser !== u;
                   return (
                     <div
                       key={u}
                       onMouseEnter={() => setHoveredUser(u)}
                       onMouseLeave={() => setHoveredUser(null)}
                       style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          background: hoveredUser === u || pinnedUser === u ? `${color}22` : 'rgba(30, 41, 59, 0.5)',
                          border: `1px solid ${hoveredUser === u || pinnedUser === u ? color : '#334155'}`,
                          color: hoveredUser === u || pinnedUser === u ? '#fff' : '#cbd5e1',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          opacity: isDimmed ? 0.35 : 1,
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px'
                       }}
                     >
                       <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: color }}></span>
                       {u === pinnedUser ? '⭐ ' : ''}{userNames[u] || u}
                     </div>
                   );
                })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: GROUP ANALYTICS */}
        {activeTab === 'stats' && (
          <div style={{ padding: '24px 16px 48px 16px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ fontSize: '15px', fontWeight: 900, color: '#f8fafc', letterSpacing: '0.04em' }}>GROUP ANALYTICS</span>
              <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Weekly Math</span>
            </div>

            <div style={{ background: '#0e1626', border: '1px solid #1f2937', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.5)', marginBottom: '32px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'center' }}>
                <thead>
                  <tr style={{ background: '#1a2234', borderBottom: '2px solid #374151' }}>
                    <th style={{ padding: '10px 8px', color: '#94a3b8', fontWeight: 700, borderRight: '1px solid #1f2937' }}>Week</th>
                    <th style={{ padding: '10px 8px', color: pinnedColor, fontWeight: 700, borderRight: '1px solid #1f2937' }}>{userNames[pinnedUser] || 'Selected'}</th>
                    <th style={{ padding: '10px 8px', color: '#22c55e', fontWeight: 700, borderRight: '1px solid #1f2937' }}>Max</th>
                    <th style={{ padding: '10px 8px', color: '#38bdf8', fontWeight: 700, borderRight: '1px solid #1f2937' }}>Mean</th>
                    <th style={{ padding: '10px 8px', color: '#a78bfa', fontWeight: 700, borderRight: '1px solid #1f2937' }}>Median</th>
                    <th style={{ padding: '10px 8px', color: '#ef4444', fontWeight: 700 }}>Min</th>
                  </tr>
                </thead>
                <tbody>
                  {[...groupStatsData].reverse().map((stat, idx) => {
                    const rowBg = idx % 2 === 0 ? 'rgba(11, 17, 32, 0.7)' : 'rgba(14, 22, 38, 0.7)';
                    return (
                      <tr key={stat.week} style={{ background: rowBg, borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', color: '#e2e8f0', fontWeight: 700 }}>{stat.week}</td>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', color: pinnedColor, fontWeight: 800 }}>{stat.pinnedScore}</td>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', color: '#22c55e', fontWeight: 800 }}>{stat.max}</td>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', color: '#38bdf8', fontWeight: 800 }}>{stat.mean}</td>
                        <td style={{ padding: '8px 8px', borderRight: '1px solid #1f2937', color: '#a78bfa', fontWeight: 800 }}>{stat.median}</td>
                        <td style={{ padding: '8px 8px', color: '#ef4444', fontWeight: 800 }}>{stat.min}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ background: 'rgba(15, 23, 42, 0.6)', border: '1px solid #1f2937', borderRadius: '12px', padding: '20px 10px 10px 0', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={groupStatsData} margin={{ top: 10, right: 20, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
                    <XAxis dataKey="name" stroke="#64748b" tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 600}} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="#64748b" tick={{fill: '#94a3b8', fontSize: 11, fontWeight: 600}} tickLine={false} axisLine={false} />
                    <Tooltip 
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '8px', boxShadow: '0 8px 16px rgba(0,0,0,0.8)' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '11px', marginBottom: '4px', fontWeight: 800 }}
                      cursor={{ stroke: 'rgba(255,255,255,0.05)' }}
                    />
                    <Line type="monotone" dataKey="pinnedScore" stroke={pinnedColor} strokeWidth={4} name={userNames[pinnedUser] || pinnedUser} dot={{ r: 5, fill: pinnedColor, strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="max" stroke="#22c55e" strokeWidth={2} name="Max Score" dot={{ r: 3, fill: '#22c55e', strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="mean" stroke="#38bdf8" strokeWidth={2} name="Mean Average" dot={{ r: 3, fill: '#38bdf8', strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="median" stroke="#a78bfa" strokeWidth={2} name="Median" strokeDasharray="5 5" dot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }} />
                    <Line type="monotone" dataKey="min" stroke="#ef4444" strokeWidth={2} name="Min Score" dot={{ r: 3, fill: '#ef4444', strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div style={{ textAlign: 'center', marginTop: '16px', fontSize: '11px', color: '#94a3b8', fontWeight: 600, display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: pinnedColor, borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }}></span>⭐ {userNames[pinnedUser] || pinnedUser}</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#22c55e', borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }}></span>Max</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#38bdf8', borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }}></span>Mean</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#a78bfa', borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }}></span>Median</span>
                <span><span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#ef4444', borderRadius: '50%', marginRight: '6px', verticalAlign: '-1px' }}></span>Min</span>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
