import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    let activeWeek = 6;
    let activeProps = [];

    // 1. Fetch challenge definitions using the make_picks view
    const chalRes = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks&_=${Date.now()}`,
      { cache: 'no-store' }
    );

    if (chalRes.ok) {
      const chalData = await chalRes.json();
      activeWeek = chalData.currentScoringPeriod?.id || 6;
      const allProps = chalData.propositions || [];
      
      activeProps = allProps.filter(p => {
        const spId = p.scoringPeriodId || p.scoringPeriod?.id || p.scoringPeriod;
        if (Number(spId) !== Number(activeWeek)) return false;
        if (p.scoringFormatIds && Array.isArray(p.scoringFormatIds)) {
          return p.scoringFormatIds.includes(2) || p.scoringFormatIds.includes("2");
        }
        return false;
      });
    }

    // 2. Fetch live scoreboard across all FBS games (groups=80, limit=300)
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${activeWeek}&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        scoreboardEvents = (sbData.events || []).map(ev => {
          const comp = ev.competitions?.[0];
          if (!comp) return null;
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          const home = comp.competitors?.find(c => c.homeAway === 'home');

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

          const awayAbbr = away?.team?.abbreviation || away?.team?.shortDisplayName || '';
          const homeAbbr = home?.team?.abbreviation || home?.team?.shortDisplayName || '';
          const awayLogo = away?.team?.logo || away?.team?.logos?.[0]?.href || '';
          const homeLogo = home?.team?.logo || home?.team?.logos?.[0]?.href || '';

          const oddsObj = comp.odds?.[0] || null;
          const lineDetails = oddsObj?.details || '';
          const overUnder = oddsObj?.overUnder ? `O/U ${oddsObj.overUnder}` : '';

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
              homeAbbr
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

    // 3. Register propositions, logos, links, and Vegas lines
    const propMap = {};
    const contestPropIds = [];

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
          homeAbbr: rawHome
        };
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;
      const awayLogo = matchedEvent?.awayLogo || '';
      const homeLogo = matchedEvent?.homeLogo || '';
      const eventDate = matchedEvent?.date || rawProp.date || rawProp.startTime || rawProp.lockDate;
      const eventId = matchedEvent?.id || rawProp.eventId || outcomes[0]?.eventId || outcomes[1]?.eventId || '';
      const espnUrl = matchedEvent?.espnUrl || (eventId ? `https://www.espn.com/college-football/game/_/gameId/${eventId}` : 'https://www.espn.com/college-football/scoreboard');

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
        outcomeAwayId,
        outcomeHomeId,
        kickoffDate: eventDate || null,
        kickoffTime
      };
    });

    contestPropIds.sort((a, b) => {
      const tA = propMap[a]?.kickoffTime || 0;
      const tB = propMap[b]?.kickoffTime || 0;
      if (tA && tB && tA !== tB) return tA - tB;
      if (tA && !tB) return -1;
      if (!tA && tB) return 1;
      return (propMap[a]?.title || '').localeCompare(propMap[b]?.title || '');
    });

    // 4. Fetch group entries and history
    const groupUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup&view=mSettings&view=mScoreboard&_=${Date.now()}`;
    const groupRes = await fetch(groupUrl, { cache: 'no-store' });
    const gData = groupRes.ok ? await groupRes.json() : {};
    const entries = gData.entries || [];
    const challengeId = gData.challengeId || gData.challenge?.id || CHALLENGE_SLUG;

    const users = [];
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
      const userName = e.name || e.member?.displayName || `Entry ${String(e.id || '').slice(0, 6)}`;
      let scoreVal = extractScore(e.score) ?? extractScore(e.points) ?? extractScore(e.overallScore) ?? extractScore(e);

      const fetchSlug = challengeId ? challengeId : CHALLENGE_SLUG;
      const entryUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${fetchSlug}/entries/${e.id}?view=mScoreboard&_=${Date.now()}`;
      const eRes = await fetch(entryUrl, { cache: 'no-store' });
      if (!eRes.ok) return { userName, picks: [], scoreVal: scoreVal || 0, periodScores: {} };
      const eData = await eRes.json();

      if (scoreVal === null) {
        scoreVal = extractScore(eData.score) ?? extractScore(eData.points) ?? extractScore(eData.overallScore) ?? extractScore(eData) ?? 0;
      }

      const periodScores = {};
      
      // THE FIX: Added your precise "scoreByPeriod" payload path to the hunter array
      const sources = [
        eData.scoreByPeriod,              // <--- The exact key you found
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

      return { userName, picks: eData.picks || [], scoreVal: scoreVal || 0, periodScores };
    });

    const settled = await Promise.all(entryPromises);

    settled.forEach(({ userName, picks, scoreVal, periodScores }) => {
      userYearlyScores[userName] = scoreVal;
      userPeriodScores[userName] = periodScores || {};

      if (userName.toLowerCase().replace(/\s+/g, '').includes('posaparty')) {
        myUser = userName;
      } else {
        otherUsers.push(userName);
      }
      users.push(userName);
      pickMap[userName] = {};

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

        pickMap[userName][propId] = {
          side,
          pts: p.confidenceScore || null
        };
      });
    });

    if (!myUser) myUser = "PosaParty";

    const buildHash = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'graph-history-fixed').slice(0, 7);

    return NextResponse.json({
      myUser,
      otherUsers,
      weekNumber: activeWeek,
      activeProps: contestPropIds,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores,
      buildHash
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
