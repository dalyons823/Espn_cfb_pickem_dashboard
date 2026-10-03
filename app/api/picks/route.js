import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch live scoreboard across weeks 1 through 6
    let curWeek = 5;
    const eventsByWeek = {};

    try {
      const baseSbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300', {
        next: { revalidate: 30 }
      });
      if (baseSbRes.ok) {
        const baseSbData = await baseSbRes.json();
        curWeek = baseSbData.week?.number || 5;

        const maxSbWeek = Math.max(curWeek + 1, 6);
        const weekFetches = [];
        for (let w = 1; w <= maxSbWeek; w++) {
          weekFetches.push(
            fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${w}`, {
              next: { revalidate: w >= curWeek ? 30 : 86400 }
            })
            .then(res => res.ok ? res.json() : null)
            .then(data => ({ data, week: w }))
            .catch(() => ({ data: null, week: w }))
          );
        }

        const sbResults = await Promise.all(weekFetches);
        sbResults.forEach(({ data, week }) => {
          if (!data?.events) return;
          eventsByWeek[week] = data.events.map(ev => {
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
              date: ev.date || comp.date || null,
              awayAbbr,
              homeAbbr,
              awayNames: collectNames(away?.team),
              homeNames: collectNames(home?.team),
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
        });
      }
    } catch (e) {
      console.error("Scoreboard fetch error:", e);
    }

    function normalize(str) {
      return String(str || '')
        .toLowerCase()
        .replace(/\b(state|st|the|university|college|tech)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
    }

    function teamMatches(propTeamName, eventTeamNames) {
      if (!propTeamName) return false;
      const pRaw = String(propTeamName).trim().toLowerCase();
      const pNorm = normalize(propTeamName);

      for (const e of eventTeamNames) {
        if (!e) continue;
        const eRaw = String(e).trim().toLowerCase();
        if (pRaw === eRaw) return true;
        if (pNorm.length >= 3) {
          const eNorm = normalize(e);
          if (eNorm.length >= 3 && (pNorm === eNorm || pNorm.includes(eNorm) || eNorm.includes(pNorm))) {
            return true;
          }
        }
      }
      return false;
    }

    // 2. Fetch challenge metadata and propositions strictly from college-football-pickem-2026
    let chalId = null;
    let challengeProps = [];
    try {
      const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_group_picks`, {
        next: { revalidate: 60 }
      });
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        chalId = chalData.id;
        challengeProps = chalData.propositions || [];
      }
    } catch (e) {}

    let allCatalogProps = [...challengeProps];
    if (chalId) {
      try {
        const pRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/propositions?challengeId=${chalId}&limit=500`, {
          next: { revalidate: 180 }
        });
        if (pRes.ok) {
          const pData = await pRes.json();
          const pList = Array.isArray(pData) ? pData : (pData.propositions || []);
          const seen = new Set(allCatalogProps.map(p => String(p.id)));
          pList.forEach(p => {
            if (!seen.has(String(p.id))) {
              seen.add(String(p.id));
              allCatalogProps.push(p);
            }
          });
        }
      } catch (e) {}
    }

    const propMap = {};
    const weekPropMap = {};

    function registerProp(p, explicitWeek = null) {
      if (!p || !p.id) return;
      const idStr = String(p.id);
      const outcomes = p.possibleOutcomes || p.outcomes || [];
      const rawAway = outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || outcomes[0]?.name || outcomes[0]?.caption || 'Away';
      const rawHome = outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || outcomes[1]?.name || outcomes[1]?.caption || 'Home';
      const outcomeAwayId = outcomes[0]?.id ? String(outcomes[0].id) : null;
      const outcomeHomeId = outcomes[1]?.id ? String(outcomes[1].id) : null;

      const sp = explicitWeek || p.scoringPeriodId || p.scoringPeriod || curWeek;
      const spNum = Number(sp);

      // Scoreboard match strictly constrained to the same week
      const targetEvents = eventsByWeek[spNum] || [];
      let matchedEvent = null;
      for (const ev of targetEvents) {
        const awayMatches = teamMatches(rawAway, ev.awayNames) || teamMatches(rawAway, ev.homeNames);
        const homeMatches = teamMatches(rawHome, ev.homeNames) || teamMatches(rawHome, ev.awayNames);
        if (awayMatches && homeMatches) {
          matchedEvent = ev;
          break;
        }
      }

      let score = matchedEvent?.scoreInfo || null;
      if (!score && outcomes.length === 2) {
        let winner = null;
        if (outcomes[0]?.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeAwayId)) {
          winner = 'away';
        } else if (outcomes[1]?.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeHomeId)) {
          winner = 'home';
        }
        if (winner) {
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
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;

      const eventDate = matchedEvent?.date || p.date || p.startTime || p.lockDate;
      let kickoffTime = 0;
      if (eventDate) {
        try {
          kickoffTime = new Date(eventDate).getTime();
        } catch (e) {}
      }

      const propObj = {
        id: idStr,
        away,
        home,
        title: `${away} @ ${home}`,
        score,
        outcomeAwayId,
        outcomeHomeId,
        scoringPeriodId: spNum,
        kickoffDate: eventDate || null,
        kickoffTime
      };

      propMap[idStr] = propObj;
      if (idStr.length >= 7) {
        propMap[idStr.slice(0, 7)] = propObj;
      }

      if (!weekPropMap[spNum]) weekPropMap[spNum] = [];
      if (!weekPropMap[spNum].some(item => item.id === idStr)) {
        weekPropMap[spNum].push(propObj);
      }
    }

    allCatalogProps.forEach(p => registerProp(p));

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
        const sp = p.scoringPeriodId || p.scoringPeriod || propMap[propId]?.scoringPeriodId;
        if (sp && propId) {
          const spNum = Number(sp);
          if (!weekPropMap[spNum]) weekPropMap[spNum] = [];
          if (!weekPropMap[spNum].some(item => item.id === propId)) {
            const registered = propMap[propId] || { id: propId, kickoffTime: 0, title: '' };
            weekPropMap[spNum].push(registered);
          }
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

    // 5. Build weekly blocks sorted chronologically by kickoff time
    const maxWeek = Math.max(curWeek, 5, ...Object.keys(weekPropMap).map(Number));
    const weekBlocks = [];

    for (let w = 1; w <= maxWeek; w++) {
      const weekProps = weekPropMap[w] || [];

      // Sort: 12:00 PM -> 3:30 PM -> 4:15 PM -> 7:30 PM -> 10:30 PM
      weekProps.sort((a, b) => {
        const tA = a.kickoffTime || 0;
        const tB = b.kickoffTime || 0;
        if (tA && tB && tA !== tB) return tA - tB;
        if (tA && !tB) return -1;
        if (!tA && tB) return 1;
        return (a.title || '').localeCompare(b.title || '');
      });

      if (weekProps.length > 0) {
        weekBlocks.push(weekProps.map(p => p.id).slice(0, 10));
      }
    }

    if (!weekBlocks.length) {
      weekBlocks.push([]);
    }

    const currentWeekIdx = Math.min(curWeek - 1, weekBlocks.length - 1);

    return NextResponse.json({
      myUser,
      otherUsers,
      weekBlocks,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores,
      currentWeek: currentWeekIdx >= 0 ? currentWeekIdx : 0
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
