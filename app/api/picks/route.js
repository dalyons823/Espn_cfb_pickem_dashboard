import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const CHALLENGE_ID = 289;
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch live scoreboard + ALL past weeks' archives in parallel
    let allEvents = [];
    let currentWeekNum = 4;
    try {
      const baseSbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300', {
        next: { revalidate: 30 }
      });
      if (baseSbRes.ok) {
        const baseSbData = await baseSbRes.json();
        allEvents = baseSbData.events || [];
        currentWeekNum = baseSbData.week?.number || 4;

        // Fetch weeks 1 through (currentWeekNum - 1) in parallel
        const pastWeekFetches = [];
        for (let w = 1; w < currentWeekNum; w++) {
          pastWeekFetches.push(
            fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${w}`, {
              next: { revalidate: 86400 } // Past weeks never change; cache for 24h
            })
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
          );
        }

        const pastResults = await Promise.all(pastWeekFetches);
        pastResults.forEach(data => {
          if (data?.events) {
            allEvents = allEvents.concat(data.events);
          }
        });
      }
    } catch (e) {
      console.error("Scoreboard fetch error:", e);
    }

    // Process all events across all weeks
    const parsedEvents = allEvents.map(ev => {
      const comp = ev.competitions?.[0];
      if (!comp) return null;
      const away = comp.competitors?.find(c => c.homeAway === 'away');
      const home = comp.competitors?.find(c => c.homeAway === 'home');

      const aScore = away?.score !== undefined && away?.score !== '' ? parseInt(away.score, 10) : null;
      const hScore = home?.score !== undefined && home?.score !== '' ? parseInt(home.score, 10) : null;
      const state = ev.status?.type?.state || 'pre';

      let leader = null;
      if (aScore !== null && hScore !== null) {
        if (aScore > hScore) leader = 'away';
        else if (hScore > aScore) leader = 'home';
        else leader = 'tie';
      }

      const awayAbbr = away?.team?.abbreviation || away?.team?.shortDisplayName || '';
      const homeAbbr = home?.team?.abbreviation || home?.team?.shortDisplayName || '';
      const eventWeek = ev.week?.number || comp.week || null;

      const collectNames = (teamObj) => {
        if (!teamObj) return [];
        return [
          teamObj.abbreviation,
          teamObj.shortDisplayName,
          teamObj.displayName,
          teamObj.name,
          teamObj.location,
          teamObj.nickname
        ].filter(Boolean);
      };

      return {
        eventWeek,
        awayAbbr,
        homeAbbr,
        awayNames: collectNames(away?.team),
        homeNames: collectNames(home?.team),
        scoreInfo: {
          awayScore: away?.score ?? '',
          homeScore: home?.score ?? '',
          statusDetail: ev.status?.type?.shortDetail || '',
          state,
          leader,
          awayAbbr,
          homeAbbr
        }
      };
    }).filter(Boolean);

    function cleanName(n) {
      return String(n || '')
        .toLowerCase()
        .replace(/\bstate\b/g, 'st')
        .replace(/[^a-z0-9]/g, '');
    }

    function matchTeam(propName, eventTeamNames) {
      const cProp = cleanName(propName);
      if (!cProp) return false;
      return eventTeamNames.some(tn => {
        const cEvent = cleanName(tn);
        return cEvent === cProp || cEvent.includes(cProp) || cProp.includes(cEvent);
      });
    }

    // 2. Fetch challenge propositions
    let officialProps = [];
    try {
      const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_group_picks`, {
        next: { revalidate: 300 }
      });
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        officialProps = chalData.propositions || [];
      }
    } catch (e) {}

    if (!officialProps.length) {
      try {
        const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_ID}`, {
          next: { revalidate: 300 }
        });
        if (chalRes.ok) {
          const chalData = await chalRes.json();
          officialProps = chalData.propositions || [];
        }
      } catch (e) {}
    }

    const propMap = {};
    officialProps.forEach(p => {
      const outcomes = p.possibleOutcomes || p.outcomes || [];
      const rawAway = outcomes[0]?.name || outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || 'Away';
      const rawHome = outcomes[1]?.name || outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || 'Home';
      const propWeek = p.scoringPeriodId || p.scoringPeriod || null;

      // Match against scoreboard with week awareness to prevent cross-week collisions
      let matchedEvent = null;
      for (const ev of parsedEvents) {
        const awayMatches = matchTeam(rawAway, ev.awayNames) || matchTeam(rawAway, ev.homeNames);
        const homeMatches = matchTeam(rawHome, ev.homeNames) || matchTeam(rawHome, ev.awayNames);
        if (awayMatches && homeMatches) {
          if (!propWeek || ev.eventWeek === propWeek) {
            matchedEvent = ev;
            break;
          }
          if (!matchedEvent) matchedEvent = ev;
        }
      }

      // Fallback to ESPN Gambit outcome winner if older game is archived
      let score = matchedEvent?.scoreInfo || null;
      if (!score && outcomes.length === 2) {
        const awayOutcome = outcomes[0];
        const homeOutcome = outcomes[1];
        if (awayOutcome?.winner || p.correctOutcomeId === awayOutcome?.id) {
          score = { awayScore: '', homeScore: '', statusDetail: 'Final', state: 'post', leader: 'away', awayAbbr: rawAway, homeAbbr: rawHome };
        } else if (homeOutcome?.winner || p.correctOutcomeId === homeOutcome?.id) {
          score = { awayScore: '', homeScore: '', statusDetail: 'Final', state: 'post', leader: 'home', awayAbbr: rawAway, homeAbbr: rawHome };
        }
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;

      const propObj = {
        id: p.id,
        away,
        home,
        title: `${away} @ ${home}`,
        score,
        scoringPeriodId: propWeek
      };
      propMap[p.id] = propObj;
      if (typeof p.id === 'string' && p.id.length >= 7) {
        propMap[p.id.slice(0, 7)] = propObj;
      }
    });

    // 3. Fetch Group Leaderboard
    const groupRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`, {
      next: { revalidate: 60 }
    });
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // 4. Fetch Picks & Extract Overall & Period Scores
    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const userYearlyScores = {};
    const userPeriodScores = {};
    const weekMap = {}; // { [weekNum]: Set of propIds }

    function extractScore(obj) {
      if (!obj) return null;
      if (typeof obj === 'number') return obj;
      if (typeof obj.value === 'number') return obj.value;
      if (typeof obj.score === 'number') return obj.score;
      if (typeof obj.points === 'number') return obj.points;
      if (typeof obj.overallScore === 'number') return obj.overallScore;
      if (typeof obj.totalPoints === 'number') return obj.totalPoints;
      return null;
    }

    const entryPromises = entries.map(async (e) => {
      const userName = e.name || e.member?.displayName || `Entry ${e.id.slice(0, 6)}`;
      let scoreVal = extractScore(e.score) ?? extractScore(e.points) ?? extractScore(e.overallScore) ?? extractScore(e);

      const eRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/entries/${e.id}`, {
        next: { revalidate: 60 }
      });
      if (!eRes.ok) return { userName, picks: [], scoreVal: scoreVal || 0, periodScores: {} };
      const eData = await eRes.json();

      if (scoreVal === null) {
        scoreVal = extractScore(eData.score) ?? extractScore(eData.points) ?? extractScore(eData.overallScore) ?? extractScore(eData) ?? 0;
      }

      const periodScores = {};
      const sources = [eData.scores, eData.scoresByScoringPeriod, e.scores, e.scoresByScoringPeriod];
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
        const propId = p.propositionId;
        const sp = p.scoringPeriodId || propMap[propId]?.scoringPeriodId || null;

        // Group games strictly by their verified scoring period
        if (sp) {
          const spNum = Number(sp);
          if (!weekMap[spNum]) weekMap[spNum] = [];
          if (!weekMap[spNum].includes(propId)) {
            weekMap[spNum].push(propId);
          }
        }

        const rawOutcome = String(p.outcomesPicked?.[0]?.outcomeId || p.outcomeId || '').toLowerCase();
        const clean = rawOutcome.replace(/[^a-z0-9]/gi, '');

        let side = null;
        if (clean.length >= 8) {
          const char = clean.charAt(7);
          if (char === '1') side = 'away';
          if (char === '2') side = 'home';
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

    // 5. Partition weeks chronologically
    const sortedWeeks = Object.keys(weekMap).map(Number).sort((a, b) => a - b);
    let weekBlocks = sortedWeeks.map(w => weekMap[w]);
    let weekNumbers = sortedWeeks;

    // Fallback if weekMap was empty
    if (!weekBlocks.length) {
      weekBlocks = [[]];
      weekNumbers = [1];
    }

    // Default to the current active week
    let currentWeekIdx = weekNumbers.indexOf(currentWeekNum);
    if (currentWeekIdx === -1) currentWeekIdx = weekBlocks.length - 1;

    return NextResponse.json({
      myUser,
      otherUsers,
      weekBlocks,
      weekNumbers,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores,
      currentWeek: currentWeekIdx
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
