import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";
const CURRENT_WEEK = 5;

export async function GET() {
  try {
    // 1. Fetch live scoreboard across all FBS games (groups=80, limit=300)
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${CURRENT_WEEK}`,
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

    // Comprehensive team matching for all FBS teams
    const ABBR_MAP = {
      'uk': 'kentucky',
      'sc': 'south carolina',
      'ala': 'alabama',
      'bama': 'alabama',
      'msst': 'mississippi state',
      'mich': 'michigan',
      'minn': 'minnesota',
      'wvu': 'west virginia',
      'isu': 'iowa state',
      'osu': 'ohio state',
      'iowa': 'iowa',
      'uva': 'virginia',
      'fsu': 'florida state',
      'fla': 'florida',
      'miz': 'missouri',
      'clem': 'clemson',
      'mia': 'miami',
      'iu': 'indiana',
      'rutg': 'rutgers',
      'bay': 'baylor',
      'asu': 'arizona state',
      'cin': 'cincinnati',
      'ariz': 'arizona'
    };

    function isTeamMatch(propTeamName, eventTeamNames) {
      if (!propTeamName) return false;
      const raw = String(propTeamName).trim().toLowerCase();
      if (eventTeamNames.includes(raw)) return true;

      const mapped = ABBR_MAP[raw];
      if (mapped && eventTeamNames.some(n => n.includes(mapped) || mapped.includes(n))) {
        return true;
      }

      const cleanTokens = raw.replace(/[^a-z0-9]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !['state', 'the', 'university', 'college'].includes(t));
      if (cleanTokens.length > 0) {
        return eventTeamNames.some(n => cleanTokens.every(token => n.includes(token)));
      }
      return false;
    }

    // 2. Fetch Group Leaderboard
    const groupRes = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`,
      { next: { revalidate: 60 } }
    );
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // 3. Fetch each entrant's submitted picks
    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const userYearlyScores = {};
    const userPeriodScores = {};
    const rawPropsMap = {};
    const propPickFrequency = {};

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

      const eRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/entries/${e.id}`,
        { next: { revalidate: 60 } }
      );
      if (!eRes.ok) return { userName, picks: [], scoreVal: scoreVal || 0, periodScores: {}, entryProps: [] };
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

      return {
        userName,
        picks: eData.picks || [],
        scoreVal: scoreVal || 0,
        periodScores,
        entryProps: eData.propositions || []
      };
    });

    const settled = await Promise.all(entryPromises);

    // Index all proposition metadata returned by entries
    settled.forEach(({ entryProps, picks }) => {
      (entryProps || []).forEach(p => {
        if (p && p.id) rawPropsMap[String(p.id)] = p;
      });
      picks.forEach(p => {
        if (p.proposition && p.proposition.id) {
          rawPropsMap[String(p.proposition.id)] = p.proposition;
        }
      });
    });

    // Also fetch challenge propositions to ensure full metadata for Week 5
    try {
      const chalRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}`,
        { next: { revalidate: 60 } }
      );
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        (chalData.propositions || []).forEach(p => {
          if (p && p.id) rawPropsMap[String(p.id)] = p;
        });
      }
    } catch (e) {}

    // Process user picks strictly for Week 5
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
        const sp = Number(p.scoringPeriodId || p.scoringPeriod || 0);

        // Count frequency of picks for Week 5
        if (sp === CURRENT_WEEK || sp === 0) {
          propPickFrequency[propId] = (propPickFrequency[propId] || 0) + 1;
        }

        const rawProp = rawPropsMap[propId];
        const outcomes = rawProp?.possibleOutcomes || rawProp?.outcomes || [];
        const outcomeAwayId = outcomes[0]?.id ? String(outcomes[0].id) : null;
        const outcomeHomeId = outcomes[1]?.id ? String(outcomes[1].id) : null;

        const rawOutcome = String(p.outcomesPicked?.[0]?.outcomeId || p.outcomeId || p.outcome?.id || '');
        const clean = rawOutcome.toLowerCase().replace(/[^a-z0-9]/gi, '');

        let side = null;
        if (outcomeAwayId && (String(outcomeAwayId) === rawOutcome || rawOutcome.includes(String(outcomeAwayId)))) {
          side = 'away';
        } else if (outcomeHomeId && (String(outcomeHomeId) === rawOutcome || rawOutcome.includes(String(outcomeHomeId)))) {
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

    // 4. Derive the exact 10 contest matchups from what the league members actually picked
    // This mathematically excludes any non-contest games (0 picks in group)
    const sortedContestPropIds = Object.keys(propPickFrequency)
      .filter(id => propPickFrequency[id] > 0)
      .sort((a, b) => propPickFrequency[b] - propPickFrequency[a])
      .slice(0, 10);

    const propMap = {};

    sortedContestPropIds.forEach(idStr => {
      const rawProp = rawPropsMap[idStr] || {};
      const outcomes = rawProp.possibleOutcomes || rawProp.outcomes || [];
      const rawAway = outcomes[0]?.shortDisplayName || outcomes[0]?.abbreviation || outcomes[0]?.name || outcomes[0]?.caption || 'Away';
      const rawHome = outcomes[1]?.shortDisplayName || outcomes[1]?.abbreviation || outcomes[1]?.name || outcomes[1]?.caption || 'Home';
      const outcomeAwayId = outcomes[0]?.id ? String(outcomes[0].id) : null;
      const outcomeHomeId = outcomes[1]?.id ? String(outcomes[1].id) : null;

      // Match against the Week 5 scoreboard feed
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

      const propObj = {
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

      propMap[idStr] = propObj;
    });

    // 5. Sort the 10 official contest games strictly by kickoff time ascending
    sortedContestPropIds.sort((a, b) => {
      const tA = propMap[a]?.kickoffTime || 0;
      const tB = propMap[b]?.kickoffTime || 0;
      if (tA && tB && tA !== tB) return tA - tB;
      if (tA && !tB) return -1;
      if (!tA && tB) return 1;
      return (propMap[a]?.title || '').localeCompare(propMap[b]?.title || '');
    });

    return NextResponse.json({
      myUser,
      otherUsers,
      weekNumber: CURRENT_WEEK,
      activeProps: sortedContestPropIds,
      propMap,
      pickMap,
      userYearlyScores,
      userPeriodScores
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
