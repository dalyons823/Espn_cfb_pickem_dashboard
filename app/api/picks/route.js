import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    let activeWeek = 6;
    let challengeId = null;

    // 1. Fetch group metadata FIRST to get the NUMERIC challenge ID
    let groupUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup&view=mSettings&_=${Date.now()}`;
    let groupRes = await fetch(groupUrl, { cache: 'no-store' });

    if (!groupRes.ok) {
      groupUrl = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/college-football-pickem/groups/${GROUP_ID}?view=mGroup&view=mSettings&_=${Date.now()}`;
      groupRes = await fetch(groupUrl, { cache: 'no-store' });
    }

    const gData = groupRes.ok ? await groupRes.json() : {};
    challengeId = gData.challengeId || gData.challenge?.id || null;
    activeWeek = gData.currentScoringPeriod?.id || 6;

    // 2. Fetch actual live propositions using the numeric challenge ID
    let activeProps = [];
    const propTarget = challengeId ? challengeId : CHALLENGE_SLUG;

    try {
      const propRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/propositions?challengeId=${propTarget}&scoringPeriodId=${activeWeek}&view=propositions_scoring&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (propRes.ok) {
        const propData = await propRes.json();
        activeProps = Array.isArray(propData) ? propData : (propData.propositions || propData.items || []);
      }
    } catch (e) {
      console.error("Propositions API error:", e);
    }

    // WE ABSOLUTELY DO NOT FALL BACK TO THE /challenges/ ENDPOINT HERE.
    // That endpoint is what was serving the cached 2024 template (Notre Dame, Nebraska, etc.).

    // 3. Fetch live scoreboard
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${activeWeek}&dates=2026&_=${Date.now()}`,
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

          const oddsObj = comp.odds?.[0] || null;
          const lineDetails = oddsObj?.details || '';
          
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
            awayAbbr: away?.team?.abbreviation || away?.team?.shortDisplayName || '',
            homeAbbr: home?.team?.abbreviation || home?.team?.shortDisplayName || '',
            lineDetails,
            awayNames: collectNames(away?.team),
            homeNames: collectNames(home?.team),
            scoreInfo: {
              awayScore: !isPre && aScore !== null ? String(aScore) : '',
              homeScore: !isPre && hScore !== null ? String(hScore) : '',
              statusDetail: ev.status?.type?.shortDetail || '',
              state,
              leader
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

    // 4. Map active props
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
          leader: winner
        };
      }

      const away = matchedEvent?.awayAbbr || rawAway;
      const home = matchedEvent?.homeAbbr || rawHome;
      const eventDate = matchedEvent?.date || rawProp.date || rawProp.startTime || rawProp.lockDate;

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
        away,
        home,
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

    // 5. Fetch group entries
    const entries = gData.entries || [];
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

      const fetchSlug = challengeId ? challengeId : CHALLENGE_SLUG;
      const eRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${fetchSlug}/entries/${e.id}?_=${Date.now()}`,
        { cache: 'no-store' }
      );
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

    const buildHash = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'no-nd-fix').slice(0, 7);

    return NextResponse.json({
      myUser,
      otherUsers,
      weekNumber: activeWeek,
      activeProps: contestPropIds.slice(0, 10), // Limit to 10 max
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
