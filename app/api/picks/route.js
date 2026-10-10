import { NextResponse } from 'next/server';

const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch group metadata first to resolve the authentic live challenge definition & season
    let groupRes = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/college-football-pickem-2026/groups/${GROUP_ID}?view=mGroup&view=mSettings`,
      { next: { revalidate: 30 } }
    );

    let challengeSlug = "college-football-pickem-2026";

    if (!groupRes.ok) {
      // Fallback to base challenge slug with explicit group lookup
      groupRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/college-football-pickem/groups/${GROUP_ID}?view=mGroup&view=mSettings`,
        { next: { revalidate: 30 } }
      );
      challengeSlug = "college-football-pickem";
    }

    if (!groupRes.ok) throw new Error("Could not fetch group data from ESPN");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // Dynamically resolve challenge ID and current scoring period from group definition
    const challengeId = gData.challengeId || gData.challenge?.id;
    let activeWeek = gData.currentScoringPeriod?.id || 6;

    // 2. Fetch challenge definition using the resolved challenge ID / slug
    let chalUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeSlug}?view=chui_pagetype_group_picks`;
    if (challengeId) {
      chalUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeId}?view=chui_pagetype_group_picks`;
    }

    const chalRes = await fetch(chalUrl, { next: { revalidate: 30 } });
    const chalData = chalRes.ok ? await chalRes.json() : {};

    if (chalData.currentScoringPeriod?.id) {
      activeWeek = chalData.currentScoringPeriod.id;
    }

    // Explicitly fetch propositions for the current scoring period
    let officialProps = chalData.propositions || [];
    try {
      const spUrl = challengeId
        ? `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeId}?scoringPeriodId=${activeWeek}`
        : `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeSlug}?scoringPeriodId=${activeWeek}`;
      const spRes = await fetch(spUrl, { next: { revalidate: 30 } });
      if (spRes.ok) {
        const spData = await spRes.json();
        if (spData.propositions && spData.propositions.length > 0) {
          officialProps = spData.propositions;
        }
      }
    } catch (e) {}

    // 3. Fetch live 2026 scoreboard across FBS games (groups=80, limit=300) for active week
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${activeWeek}&dates=2026`,
        { next: { revalidate: 30 } }
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

    // 4. Register all 10 propositions before kick
    const propMap = {};
    const contestPropIds = [];

    officialProps.forEach(rawProp => {
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
      const eventDate = matchedEvent?.date || rawProp.date || rawProp.startTime || rawProp.lockDate;

      let kickoffTime = 0;
      if (eventDate) {
        try {
          kickoffTime = new Date(eventDate).getTime();
        } catch (e) {}
      }

      propMap[idStr] = {
        id: idStr,
        away,
        home,
        title: `${away} @ ${home}`,
        score,
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

    // 5. Fetch each entrant's picks using the resolved challenge slug / ID
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

      const entryFetchUrl = challengeId
        ? `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeId}/entries/${e.id}`
        : `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${challengeSlug}/entries/${e.id}`;

      const eRes = await fetch(entryFetchUrl, { next: { revalidate: 30 } });
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

    return NextResponse.json({
      myUser,
      otherUsers,
      weekNumber: activeWeek,
      activeProps: contestPropIds.slice(0, 10),
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
