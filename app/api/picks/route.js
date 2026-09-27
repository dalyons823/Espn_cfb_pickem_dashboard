import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const CHALLENGE_ID = 289;
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch live scoreboard + full week slate
    let allEvents = [];
    let scoreboardWeek = null;
    try {
      const sbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300', {
        next: { revalidate: 30 }
      });
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        allEvents = sbData.events || [];
        scoreboardWeek = sbData.week?.number;

        if (scoreboardWeek) {
          const weekRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${scoreboardWeek}`, {
            next: { revalidate: 30 }
          });
          if (weekRes.ok) {
            const weekData = await weekRes.json();
            const existingIds = new Set(allEvents.map(e => e.id));
            (weekData.events || []).forEach(ev => {
              if (!existingIds.has(ev.id)) allEvents.push(ev);
            });
          }
        }
      }
    } catch (e) {
      console.error("Scoreboard fetch error:", e);
    }

    // Process scoreboard events
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

    function formatTime(dateStr) {
      if (!dateStr) return null;
      try {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      } catch (e) {
        return null;
      }
    }

    // 2. Fetch master schedule of propositions directly from ESPN Challenge API
    let allChallengeProps = [];
    try {
      const pRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/propositions?challengeId=${CHALLENGE_ID}`, {
        next: { revalidate: 300 }
      });
      if (pRes.ok) {
        const pData = await pRes.json();
        allChallengeProps = Array.isArray(pData) ? pData : (pData.propositions || []);
      }
    } catch (e) {}

    if (!allChallengeProps.length) {
      try {
        const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_ID}`, {
          next: { revalidate: 300 }
        });
        if (chalRes.ok) {
          const chalData = await chalRes.json();
          allChallengeProps = chalData.propositions || [];
        }
      } catch (e) {}
    }

    if (!allChallengeProps.length) {
      try {
        const slugRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=allon`, {
          next: { revalidate: 300 }
        });
        if (slugRes.ok) {
          const slugData = await slugRes.json();
          allChallengeProps = slugData.propositions || [];
        }
      } catch (e) {}
    }

    // 3. Map propositions and pair with scoreboard data
    const propMap = {};
    allChallengeProps.forEach(p => {
      const outcomes = p.possibleOutcomes || p.outcomes || [];
      const rawAway = outcomes[0]?.name || outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || 'Away';
      const rawHome = outcomes[1]?.name || outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || 'Home';

      let matchedEvent = null;
      for (const ev of parsedEvents) {
        const awayMatches = matchTeam(rawAway, ev.awayNames) || matchTeam(rawAway, ev.homeNames);
        const homeMatches = matchTeam(rawHome, ev.homeNames) || matchTeam(rawHome, ev.awayNames);
        if (awayMatches && homeMatches) {
          matchedEvent = ev;
          break;
        }
      }

      if (!matchedEvent) {
        for (const ev of parsedEvents) {
          if (matchTeam(rawAway, ev.awayNames) || matchTeam(rawHome, ev.homeNames)) {
            matchedEvent = ev;
            break;
          }
        }
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;
      const score = matchedEvent?.scoreInfo || null;
      const gameTime = formatTime(p.date || p.startTime || p.lockDate);

      const propObj = {
        id: p.id,
        away,
        home,
        title: `${away} @ ${home}`,
        score,
        gameTime
      };
      propMap[p.id] = propObj;
      if (typeof p.id === 'string' && p.id.length >= 7) {
        propMap[p.id.slice(0, 7)] = propObj;
      }
    });

    // 4. Fetch Group Leaderboard
    const groupRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`, {
      next: { revalidate: 60 }
    });
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // 5. Fetch Picks
    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const userYearlyScores = {};

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
      if (!eRes.ok) return { userName, picks: [], scoreVal: scoreVal || 0 };
      const eData = await eRes.json();
      
      if (scoreVal === null) {
        scoreVal = extractScore(eData.score) ?? extractScore(eData.points) ?? extractScore(eData.overallScore) ?? extractScore(eData) ?? 0;
      }

      return { userName, picks: eData.picks || [], scoreVal: scoreVal || 0 };
    });

    const settled = await Promise.all(entryPromises);

    settled.forEach(({ userName, picks, scoreVal }) => {
      userYearlyScores[userName] = scoreVal;
      if (userName.toLowerCase().replace(/\s+/g, '').includes('posaparty')) {
        myUser = userName;
      } else {
        otherUsers.push(userName);
      }
      users.push(userName);
      pickMap[userName] = {};

      picks.forEach(p => {
        const propId = p.propositionId;
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

    // 6. Partition ALL propositions into 10-game weekly blocks
    const periodMap = {};
    allChallengeProps.forEach(p => {
      const sp = p.scoringPeriodId || p.scoringPeriod;
      if (sp !== undefined && sp !== null) {
        if (!periodMap[sp]) periodMap[sp] = [];
        periodMap[sp].push(p.id);
      }
    });

    let weekBlocks = [];
    const periodKeys = Object.keys(periodMap);
    if (periodKeys.length > 0) {
      periodKeys.sort((a, b) => Number(a) - Number(b));
      weekBlocks = periodKeys.map(k => periodMap[k]);
    } else {
      const allIds = allChallengeProps.map(p => p.id);
      for (let i = 0; i < allIds.length; i += 10) {
        weekBlocks.push(allIds.slice(i, i + 10));
      }
    }

    // Determine current active week index
    let currentWeek = 0;
    if (scoreboardWeek && scoreboardWeek >= 1 && scoreboardWeek <= weekBlocks.length) {
      currentWeek = scoreboardWeek - 1;
    } else {
      for (let w = 0; w < weekBlocks.length; w++) {
        const hasLiveOrUpcoming = weekBlocks[w].some(prId => {
          const state = propMap[prId]?.score?.state;
          return state === 'in' || state === 'pre';
        });
        if (hasLiveOrUpcoming) {
          currentWeek = w;
          break;
        }
      }
    }

    return NextResponse.json({
      myUser,
      otherUsers,
      weekBlocks,
      propMap,
      pickMap,
      userYearlyScores,
      currentWeek
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
