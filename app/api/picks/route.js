import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = process.env.NEXT_PUBLIC_ESPN_CHALLENGE_SLUG || "college-football-pickem-2026";
const GROUP_ID = process.env.NEXT_PUBLIC_ESPN_GROUP_ID || "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

// Persistent in-memory caches across warm Fluid Compute invocations
const responseCache = new Map(); // weekKey -> { timestamp, payload }
const finalWinProbCache = new Map(); // eventId -> number[]
let cachedCurrentWeek = { week: 6, timestamp: 0, propsByWeek: new Map() };

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedWeek = searchParams.get('week');
    const forceRefresh = searchParams.get('force') === '1';
    const now = Date.now();

    // 1. Check in-memory response cache first (protects CPU even if query params vary)
    const cacheKey = requestedWeek ? `wk_${requestedWeek}` : 'wk_current';
    const cached = responseCache.get(cacheKey);
    const isPastWeekRequest = requestedWeek && cachedCurrentWeek.week && Number(requestedWeek) < cachedCurrentWeek.week;
    const ttl = isPastWeekRequest ? 600_000 : 30_000; // 10 min for past weeks, 30s for active week

    if (!forceRefresh && cached && (now - cached.timestamp < ttl)) {
      return NextResponse.json(cached.payload, {
        headers: {
          'Cache-Control': isPastWeekRequest
            ? 'public, s-maxage=600, stale-while-revalidate=1200'
            : 'public, s-maxage=30, stale-while-revalidate=30'
        }
      });
    }

    let activeWeek = 6;
    let currentWeek = cachedCurrentWeek.week || 6;
    let activeProps = [];

    // 2. Fetch challenge propositions (cached for 10 minutes since slates don't change mid-week)
    if (now - cachedCurrentWeek.timestamp > 600_000 || !cachedCurrentWeek.propsByWeek.size) {
      const chalResCurrent = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks`,
        { next: { revalidate: 600 } }
      );
      if (chalResCurrent.ok) {
        const chalDataCurrent = await chalResCurrent.json();
        currentWeek = chalDataCurrent.currentScoringPeriod?.id || 6;
        cachedCurrentWeek.week = currentWeek;
        cachedCurrentWeek.timestamp = now;
        cachedCurrentWeek.propsByWeek.set(currentWeek, chalDataCurrent.propositions || []);
      }
    }

    activeWeek = requestedWeek ? Number(requestedWeek) : currentWeek;

    if (!cachedCurrentWeek.propsByWeek.has(activeWeek)) {
      const chalResPast = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks&scoringPeriodId=${activeWeek}`,
        { next: { revalidate: 3600 } }
      );
      if (chalResPast.ok) {
        const pastData = await chalResPast.json();
        cachedCurrentWeek.propsByWeek.set(activeWeek, pastData.propositions || []);
      }
    }

    const allProps = cachedCurrentWeek.propsByWeek.get(activeWeek) || [];
    activeProps = allProps.filter(p => {
      const spId = p.scoringPeriodId || p.scoringPeriod?.id || p.scoringPeriod;
      if (Number(spId) !== Number(activeWeek)) return false;
      if (p.scoringFormatIds && Array.isArray(p.scoringFormatIds)) {
        return p.scoringFormatIds.includes(2) || p.scoringFormatIds.includes("2");
      }
      return false;
    });

    // 3. Fetch FBS Scoreboard (WITHOUT fetching 80 summary endpoints yet!)
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${activeWeek}`,
        { next: { revalidate: 30 } }
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        scoreboardEvents = (sbData.events || []).map((ev) => {
          const comp = ev.competitions?.[0];
          if (!comp) return null;
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const situation = comp.situation || null;

          const state = ev.status?.type?.state || 'pre';
          const isPre = state === 'pre';

          const aScore = !isPre && away?.score !== undefined && away?.score !== '' ? parseInt(away.score, 10) : null;
          const hScore = !isPre && home?.score !== undefined && home?.score !== '' ? parseInt(home.score, 10) : null;

          let leader = null;
          if (!isPre && aScore !== null && hScore !== null) {
            if (aScore > hScore) leader = 'away';
            else if (hScore > aScore) leader = 'home';
            else leader = 'tie';
          }

          const awayTeamId = String(away?.team?.id || away?.id || '');
          const homeTeamId = String(home?.team?.id || home?.id || '');

          let possession = null;
          let situationSummary = '';

          if (situation) {
            const endState = situation.lastPlay?.end || {};
            const startState = situation.lastPlay?.start || {};

            const possId = String(
              situation.possession ||
              endState.team?.id ||
              situation.lastPlay?.team?.id ||
              ''
            );
            if (possId && awayTeamId && possId === awayTeamId) possession = 'away';
            else if (possId && homeTeamId && possId === homeTeamId) possession = 'home';

            let shortDown = situation.shortDownDistanceText || endState.shortDownDistanceText || '';
            if (!shortDown) {
              const rawDown = situation.down ?? endState.down;
              const rawDist = situation.distance ?? endState.distance;
              const ordinals = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
              if (ordinals[rawDown] && rawDist !== undefined && rawDist > 0) {
                shortDown = `${ordinals[rawDown]} & ${rawDist}`;
              }
            }

            let yardLine = situation.possessionText || endState.possessionText || startState.possessionText || '';
            const fullDown = situation.downDistanceText || endState.downDistanceText || '';
            if (!yardLine && fullDown.includes(' at ')) {
              yardLine = fullDown.split(' at ')[1]?.trim() || '';
            }
            if (!yardLine) {
              const rawYd = situation.yardLine ?? endState.yardLine;
              if (typeof rawYd === 'number' && rawYd > 0 && rawYd < 100) {
                yardLine = `${rawYd} yd line`;
              }
            }

            if (shortDown && yardLine) {
              situationSummary = `${shortDown} • ${yardLine}`;
            } else if (fullDown) {
              situationSummary = fullDown.replace(' at ', ' • ');
            } else if (shortDown) {
              situationSummary = shortDown;
            } else if (yardLine) {
              situationSummary = `Ball on ${yardLine}`;
            } else if (state === 'in') {
              const playType = (situation.lastPlay?.type?.text || '').toLowerCase();
              if (playType.includes('touchdown') || playType.includes('field goal') || playType.includes('pat') || playType.includes('extra point')) {
                situationSummary = 'Kickoff Pending';
              } else if (playType.includes('kickoff')) {
                situationSummary = '1st & 10 Pending';
              } else if (playType.includes('timeout')) {
                situationSummary = 'Timeout';
              }
            }
          }

          const awayAbbr = away?.team?.abbreviation || away?.team?.shortDisplayName || '';
          const homeAbbr = home?.team?.abbreviation || home?.team?.shortDisplayName || '';
          const awayLogo = away?.team?.logo || away?.team?.logos?.[0]?.href || '';
          const homeLogo = home?.team?.logo || home?.team?.logos?.[0]?.href || '';

          const oddsObj = comp.odds?.[0] || null;
          const lineDetails = oddsObj?.details || '';
          const overUnder = oddsObj?.overUnder ? `O/U ${oddsObj.overUnder}` : '';

          let tvNetwork = '';
          if (typeof comp.broadcast === 'string' && comp.broadcast.trim()) {
            tvNetwork = comp.broadcast.trim();
          } else if (Array.isArray(comp.broadcasts) && comp.broadcasts.length > 0) {
            const names = comp.broadcasts.flatMap(b => b.names || []).filter(Boolean);
            if (names.length > 0) tvNetwork = names[0];
          } else if (Array.isArray(comp.geoBroadcasts) && comp.geoBroadcasts.length > 0) {
            const mediaName = comp.geoBroadcasts.map(g => g.media?.shortName).filter(Boolean);
            if (mediaName.length > 0) tvNetwork = mediaName[0];
          }

          const collectNames = (teamObj) => {
            if (!teamObj) return [];
            return [
              teamObj.abbreviation,
              teamObj.shortDisplayName,
              teamObj.displayName,
              teamObj.name,
              teamObj.location,
              teamObj.nickname
            ].filter(Boolean).map(s => String(s).toLowerCase());
          };

          return {
            id: String(ev.id),
            date: ev.date || comp.date || null,
            awayAbbr,
            homeAbbr,
            awayLogo,
            homeLogo,
            lineDetails,
            overUnder,
            tv: tvNetwork,
            awayNames: collectNames(away?.team),
            homeNames: collectNames(home?.team),
            espnUrl: `https://www.espn.com/college-football/game/_/gameId/${ev.id}`,
            scoreInfo: {
              awayScore: !isPre && aScore !== null ? String(aScore) : '',
              homeScore: !isPre && hScore !== null ? String(hScore) : '',
              statusDetail: ev.status?.type?.shortDetail || '',
              state,
              leader,
              awayAbbr,
              homeAbbr,
              possession,
              situationSummary,
              winProbHistory: []
            }
          };
        }).filter(Boolean);
      }
    } catch (e) {
      console.error("Scoreboard fetch error:", e);
    }

    function isTeamMatch(propTeamName, eventTeamNames) {
      if (!propTeamName) return false;
      const raw = String(propTeamName).trim().toLowerCase();
      if (eventTeamNames.includes(raw)) return true;
      const cleanTokens = raw.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['state', 'the', 'university', 'college'].includes(t));
      if (cleanTokens.length > 0) {
        return eventTeamNames.some(n => cleanTokens.every(token => n.includes(token)));
      }
      return false;
    }

    // 4. Match ONLY the 10 Pick'em games first
    const propMap = {};
    const contestPropIds = [];
    const matchedEventsToFetchSummary = [];

    activeProps.forEach(rawProp => {
      if (!rawProp || !rawProp.id) return;
      const idStr = String(rawProp.id);
      contestPropIds.push(idStr);

      const outcomes = rawProp.possibleOutcomes || rawProp.outcomes || [];
      const rawAway = outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || outcomes[0]?.name || outcomes[0]?.caption || 'Away';
      const rawHome = outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || outcomes[1]?.name || outcomes[1]?.caption || 'Home';
      const outcomeAwayId = outcomes[0]?.id ? String(outcomes[0].id) : null;
      const outcomeHomeId = outcomes[1]?.id ? String(outcomes[1].id) : null;

      let matchedEvent = null;
      for (const ev of scoreboardEvents) {
        const awayMatches = isTeamMatch(rawAway, ev.awayNames) || isTeamMatch(rawAway, ev.homeNames);
        const homeMatches = isTeamMatch(rawHome, ev.homeNames) || isTeamMatch(rawHome, ev.awayNames);
        if (awayMatches && homeMatches) {
          matchedEvent = ev;
          break;
        }
      }

      if (matchedEvent && matchedEvent.scoreInfo.state !== 'pre') {
        matchedEventsToFetchSummary.push(matchedEvent);
      }

      let winner = null;
      if (outcomes[0]?.winner || (rawProp.correctOutcomeId && String(rawProp.correctOutcomeId) === outcomeAwayId)) {
        winner = 'away';
      } else if (outcomes[1]?.winner || (rawProp.correctOutcomeId && String(rawProp.correctOutcomeId) === outcomeHomeId)) {
        winner = 'home';
      }

      let score = matchedEvent?.scoreInfo || null;
      if (!score && winner) {
        score = {
          awayScore: '',
          homeScore: '',
          statusDetail: 'Final',
          state: 'post',
          leader: winner,
          awayAbbr: rawAway,
          homeAbbr: rawHome,
          winProbHistory: [100]
        };
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;
      const awayLogo = matchedEvent?.awayLogo || '';
      const homeLogo = matchedEvent?.homeLogo || '';
      const eventDate = matchedEvent?.date || rawProp.date || rawProp.startTime || rawProp.lockDate;
      const eventId = matchedEvent?.id || rawProp.eventId || outcomes[0]?.eventId || outcomes[1]?.eventId || '';
      const espnUrl = matchedEvent?.espnUrl || (eventId ? `https://www.espn.com/college-football/game/_/gameId/${eventId}` : 'https://www.espn.com/college-football/scoreboard');
      const tv = matchedEvent?.tv || '';

      let odds = null;
      if (matchedEvent?.lineDetails) {
        const line = matchedEvent.lineDetails.trim();
        let favoriteSide = null;
        let lineSpread = '';

        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const favText = parts[0].toLowerCase();
          lineSpread = parts.slice(1).join(' ');

          if (matchedEvent.awayNames.some(n => n.includes(favText) || favText.includes(n)) || away.toLowerCase().includes(favText)) {
            favoriteSide = 'away';
          } else if (matchedEvent.homeNames.some(n => n.includes(favText) || favText.includes(n)) || home.toLowerCase().includes(favText)) {
            favoriteSide = 'home';
          }
        }

        odds = { rawLine: line, favoriteSide, lineSpread };
      }

      let kickoffTime = 0;
      if (eventDate) {
        try {
          kickoffTime = new Date(eventDate).getTime();
        } catch (e) {}
      }

      propMap[idStr] = {
        id: idStr,
        eventId,
        espnUrl,
        away,
        home,
        awayLogo,
        homeLogo,
        title: `${away} @ ${home}`,
        score,
        odds,
        tv,
        outcomeAwayId,
        outcomeHomeId,
        kickoffDate: eventDate || null,
        kickoffTime
      };
    });

    // 5. Fetch Win Probability ONLY for the <=10 matched Pick'em games (and cache finished games permanently!)
    await Promise.all(matchedEventsToFetchSummary.map(async (ev) => {
      if (finalWinProbCache.has(ev.id)) {
        ev.scoreInfo.winProbHistory = finalWinProbCache.get(ev.id);
        return;
      }
      try {
        const sumRes = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/football/college-football/summary?event=${ev.id}`,
          { next: { revalidate: ev.scoreInfo.state === 'post' ? 86400 : 30 } }
        );
        if (sumRes.ok) {
          const sumData = await sumRes.json();
          const wpArray = sumData.winprobability || [];
          // Downsample to max ~40 points to save JSON payload & SVG math
          const step = Math.max(1, Math.floor(wpArray.length / 40));
          const history = wpArray
            .filter((_, idx) => idx % step === 0 || idx === wpArray.length - 1)
            .map(wp => typeof wp.homeWinPercentage === 'number' ? Math.round(wp.homeWinPercentage * 100) : 50);

          ev.scoreInfo.winProbHistory = history;
          if (ev.scoreInfo.state === 'post' && history.length > 1) {
            finalWinProbCache.set(ev.id, history);
          }
        }
      } catch (e) {}
    }));

    contestPropIds.sort((a, b) => {
      const tA = propMap[a]?.kickoffTime || 0;
      const tB = propMap[b]?.kickoffTime || 0;
      if (tA && tB && tA !== tB) return tA - tB;
      if (tA && !tB) return -1;
      if (!tA && tB) return 1;
      return (propMap[a]?.title || '').localeCompare(propMap[b]?.title || '');
    });

    // 6. Fetch group entries (revalidates every 30s instead of uncached on every hit)
    const groupUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup&view=mSettings&view=mScoreboard&scoringPeriodId=${activeWeek}`;
    const groupRes = await fetch(groupUrl, { next: { revalidate: 30 } });
    const gData = groupRes.ok ? await groupRes.json() : {};
    const entries = gData.entries || [];
    const challengeId = gData.challengeId || gData.challenge?.id || CHALLENGE_SLUG;

    const users = []; 
    const userNames = {}; 
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const userYearlyScores = {};
    const userPeriodScores = {};

    function extractScore(obj) {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'number') return obj;
      if (typeof obj.value === 'number') return obj.value;
      if (typeof obj.score === 'number') return obj.score;
      if (typeof obj.points === 'number') return obj.points;
      if (typeof obj.overallScore === 'number') return obj.overallScore;
      if (typeof obj.totalPoints === 'number') return obj.totalPoints;
      if (typeof obj === 'string') {
        const parsed = parseFloat(obj);
        if (!isNaN(parsed)) return parsed;
      }
      return null;
    }

    const entryPromises = entries.map(async (e) => {
      const entryId = String(e.id);
      const userName = e.name || e.member?.displayName || `Entry ${entryId.slice(0, 6)}`;
      let scoreVal = extractScore(e.score) ?? extractScore(e.points) ?? extractScore(e.overallScore) ?? extractScore(e);

      const fetchSlug = challengeId ? challengeId : CHALLENGE_SLUG;
      const entryUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${fetchSlug}/entries/${e.id}?view=mScoreboard&scoringPeriodId=${activeWeek}`;
      const eRes = await fetch(entryUrl, { next: { revalidate: 60 } });
      if (!eRes.ok) return { entryId, userName, picks: [], scoreVal: scoreVal || 0, periodScores: {} };
      const eData = await eRes.json();

      if (scoreVal === null) {
        scoreVal = extractScore(eData.score) ?? extractScore(eData.points) ?? extractScore(eData.overallScore) ?? extractScore(eData) ?? 0;
      }

      const periodScores = {};
      const sources = [
        eData.scoreByPeriod,              
        e.scoreByPeriod,
        eData.score?.scoreByPeriod, 
        eData.scores,
        eData.score?.scoresByScoringPeriod,
        eData.scoresByScoringPeriod,
        e.scores,
        e.score?.scoresByScoringPeriod,
        e.scoresByScoringPeriod,
        eData.periodPoints,
        e.periodPoints
      ];

      for (const src of sources) {
        if (!src) continue;
        if (Array.isArray(src)) {
          src.forEach(item => {
            const pId = item?.scoringPeriodId ?? item?.periodId ?? item?.period;
            const val = extractScore(item);
            if (pId !== undefined && val !== null) periodScores[Number(pId)] = val;
          });
        } else if (typeof src === 'object') {
          Object.entries(src).forEach(([k, item]) => {
            const val = extractScore(item);
            if (val !== null) periodScores[Number(k)] = val;
          });
        }
      }

      return { entryId, userName, picks: eData.picks || [], scoreVal: scoreVal || 0, periodScores };
    });

    const settled = await Promise.all(entryPromises);

    settled.forEach(({ entryId, userName, picks, scoreVal, periodScores }) => {
      userNames[entryId] = userName; 
      userYearlyScores[entryId] = scoreVal;
      userPeriodScores[entryId] = periodScores || {};

      if (userName.toLowerCase().replace(/\s+/g, '').includes('posaparty')) {
        myUser = entryId;
      } else {
        otherUsers.push(entryId);
      }
      users.push(entryId);
      pickMap[entryId] = {};

      picks.forEach(p => {
        const propId = String(p.propositionId || '');
        const propInfo = propMap[propId];
        if (!propInfo) return;

        const rawOutcome = String(p.outcomesPicked?.[0]?.outcomeId || p.outcomeId || p.outcome?.id || '');
        const clean = rawOutcome.toLowerCase().replace(/[^a-z0-9]/gi, '');

        let side = null;
        if (propInfo.outcomeAwayId && (String(propInfo.outcomeAwayId) === rawOutcome || rawOutcome.includes(String(propInfo.outcomeAwayId)))) {
          side = 'away';
        } else if (propInfo.outcomeHomeId && (String(propInfo.outcomeHomeId) === rawOutcome || rawOutcome.includes(String(propInfo.outcomeHomeId)))) {
          side = 'home';
        }

        if (!side) {
          if (clean.length >= 8) {
            const char = clean.charAt(7);
            if (char === '1') side = 'away';
            if (char === '2') side = 'home';
          }
        }
        if (!side) {
          if (clean.endsWith('1')) side = 'away';
          else if (clean.endsWith('2')) side = 'home';
        }

        pickMap[entryId][propId] = {
          side,
          pts: p.confidenceScore || null
        };
      });
    });

    if (!myUser && otherUsers.length > 0) {
      myUser = otherUsers[0];
    }

    const rawSha = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'live').slice(0, 7);
    const buildHash = `${rawSha}-v17-opt`;

    const payload = {
      myUser,
      otherUsers,
      userNames, 
      weekNumber: activeWeek,
      currentWeek: currentWeek, 
      activeProps: contestPropIds,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores,
      buildHash
    };

    responseCache.set(cacheKey, { timestamp: Date.now(), payload });

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': isPastWeekRequest
          ? 'public, s-maxage=600, stale-while-revalidate=1200'
          : 'public, s-maxage=30, stale-while-revalidate=30'
      }
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
