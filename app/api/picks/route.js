import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const CHALLENGE_ID = 289;
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch live scoreboard across weeks 1 through 6
    let allEvents = [];
    let curWeek = 5;
    try {
      const baseSbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300', {
        next: { revalidate: 30 }
      });
      if (baseSbRes.ok) {
        const baseSbData = await baseSbRes.json();
        allEvents = baseSbData.events || [];
        curWeek = baseSbData.week?.number || 5;

        const maxSbWeek = Math.max(curWeek + 1, 6);
        const weekFetches = [];
        for (let w = 1; w <= maxSbWeek; w++) {
          weekFetches.push(
            fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${w}`, {
              next: { revalidate: w >= curWeek ? 30 : 86400 }
            })
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
          );
        }

        const pastResults = await Promise.all(weekFetches);
        const seenIds = new Set(allEvents.map(e => e.id));
        pastResults.forEach(data => {
          (data?.events || []).forEach(ev => {
            if (!seenIds.has(ev.id)) {
              seenIds.add(ev.id);
              allEvents.push(ev);
            }
          });
        });
      }
    } catch (e) {
      console.error("Scoreboard fetch error:", e);
    }

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

    // 2. Fetch challenge propositions directly from ESPN's primary endpoints
    const propMap = {};
    const periodMap = {};
    const activeChalPropIds = [];

    function registerProp(p, forceWeek = null) {
      if (!p || !p.id) return;
      const idStr = String(p.id);
      const outcomes = p.possibleOutcomes || p.outcomes || [];
      const rawAway = outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || outcomes[0]?.name || outcomes[0]?.caption || 'Away';
      const rawHome = outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || outcomes[1]?.name || outcomes[1]?.caption || 'Home';
      const outcomeAwayId = outcomes[0]?.id ? String(outcomes[0].id) : null;
      const outcomeHomeId = outcomes[1]?.id ? String(outcomes[1].id) : null;

      let winner = null;
      if (outcomes[0]?.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeAwayId)) {
        winner = 'away';
      } else if (outcomes[1]?.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeHomeId)) {
        winner = 'home';
      }

      let matchedEvent = null;
      for (const ev of parsedEvents) {
        const awayMatches = matchTeam(rawAway, ev.awayNames) || matchTeam(rawAway, ev.homeNames);
        const homeMatches = matchTeam(rawHome, ev.homeNames) || matchTeam(rawHome, ev.awayNames);
        if (awayMatches && homeMatches) {
          matchedEvent = ev;
          break;
        }
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
      const sp = forceWeek || p.scoringPeriodId || p.scoringPeriod || null;

      const propObj = {
        id: idStr,
        away,
        home,
        title: `${away} @ ${home}`,
        score,
        outcomeAwayId,
        outcomeHomeId,
        scoringPeriodId: sp
      };

      propMap[idStr] = propObj;
      if (idStr.length >= 7) {
        propMap[idStr.slice(0, 7)] = propObj;
      }

      if (sp) {
        const spNum = Number(sp);
        if (!periodMap[spNum]) periodMap[spNum] = [];
        if (!periodMap[spNum].includes(idStr)) {
          periodMap[spNum].push(idStr);
        }
      }
    }

    // Direct endpoints containing official propositions
    const propFetches = [
      fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_ID}`, { next: { revalidate: 60 } })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(`https://gambit-api.fantasy.espn.com/apis/v1/propositions?challengeId=${CHALLENGE_ID}&limit=250`, { next: { revalidate: 300 } })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null),
      fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}`, { next: { revalidate: 60 } })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
    ];

    const propResults = await Promise.all(propFetches);
    
    // Register active challenge propositions first
    if (propResults[0]?.propositions) {
      propResults[0].propositions.forEach(p => {
        registerProp(p, curWeek);
        if (p.id) activeChalPropIds.push(String(p.id));
      });
    }

    propResults.forEach(res => {
      if (!res) return;
      const list = Array.isArray(res) ? res : (res.propositions || []);
      list.forEach(p => registerProp(p));
    });

    // 3. Fetch Group Leaderboard
    const groupRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`, {
      next: { revalidate: 60 }
    });
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // 4. Fetch Each Entry's Picks
    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const allPickPropIds = [];
    const userYearlyScores = {};
    const userPeriodScores = {};

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
        const propId = String(p.propositionId || '');
        if (propId && !allPickPropIds.includes(propId)) {
          allPickPropIds.push(propId);
        }

        const propInfo = propMap[propId] || propMap[propId.slice(0, 7)];
        const rawOutcome = String(p.outcomesPicked?.[0]?.outcomeId || p.outcomeId || p.outcome?.id || '');
        const clean = rawOutcome.toLowerCase().replace(/[^a-z0-9]/gi, '');

        let side = null;
        if (propInfo?.outcomeAwayId && (String(propInfo.outcomeAwayId) === rawOutcome || rawOutcome.includes(String(propInfo.outcomeAwayId)))) {
          side = 'away';
        } else if (propInfo?.outcomeHomeId && (String(propInfo.outcomeHomeId) === rawOutcome || rawOutcome.includes(String(propInfo.outcomeHomeId)))) {
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

    // 5. Build weekly blocks guaranteeing all 10 matchups exist per week
    const maxWeek = Math.max(
      curWeek,
      5,
      ...Object.keys(periodMap).map(Number),
      Math.ceil(allPickPropIds.length / 10)
    );

    const weekBlocks = [];
    for (let w = 1; w <= maxWeek; w++) {
      let block = [];
      if (periodMap[w] && periodMap[w].length >= 10) {
        block = periodMap[w].slice(0, 10);
      } else {
        const start = (w - 1) * 10;
        block = allPickPropIds.slice(start, start + 10);

        // If this active week has fewer than 10 games from picks (e.g. upcoming games haven't kicked off yet),
        // pull the remaining scheduled matchups directly from the active challenge propositions
        if (w === curWeek && activeChalPropIds.length > 0) {
          activeChalPropIds.forEach(id => {
            if (!block.includes(id) && block.length < 10) {
              block.push(id);
            }
          });
        }
      }

      if (block.length > 0) {
        weekBlocks.push(block);
      }
    }

    if (!weekBlocks.length) {
      weekBlocks.push(allPickPropIds.slice(0, 10));
    }

    return NextResponse.json({
      myUser,
      otherUsers,
      weekBlocks,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores,
      currentWeek: weekBlocks.length - 1
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
