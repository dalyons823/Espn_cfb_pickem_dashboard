import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";
const ACTIVE_WEEK = 6;
const TARGET_DATE = "20261010"; // Saturday, October 10, 2026

export async function GET() {
  try {
    // 1. Ingest Weekly Propositions via dedicated Gambit propositions endpoint
    let rawProps = [];
    try {
      const propRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/propositions?challengeId=${CHALLENGE_SLUG}&scoringPeriodId=${ACTIVE_WEEK}&view=propositions_scoring&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (propRes.ok) {
        const propData = await propRes.json();
        rawProps = Array.isArray(propData) ? propData : (propData.propositions || propData.items || []);
      }
    } catch (e) {
      console.error("Propositions API error:", e);
    }

    // 2. Fetch live ESPN Core Scoreboard (groups=80 for FBS, limit=100)
    const scoreboardByEventId = {};
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${TARGET_DATE}&groups=80&limit=100&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        (sbData.events || []).forEach(ev => {
          const comp = ev.competitions?.[0];
          if (!comp) return;

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
          const overUnder = oddsObj?.overUnder ? `O/U ${oddsObj.overUnder}` : '';
          const broadcast = comp.broadcasts?.[0]?.names?.[0] || '';

          scoreboardByEventId[String(ev.id)] = {
            eventId: String(ev.id),
            date: ev.date || comp.date || null,
            broadcast,
            lineDetails,
            overUnder,
            scoreInfo: {
              awayScore: !isPre && aScore !== null ? String(aScore) : '',
              homeScore: !isPre && hScore !== null ? String(hScore) : '',
              statusDetail: ev.status?.type?.shortDetail || '',
              state,
              leader,
              awayAbbr: away?.team?.abbreviation || '',
              homeAbbr: home?.team?.abbreviation || ''
            }
          };
        });
      }
    } catch (e) {
      console.error("Scoreboard API error:", e);
    }

    // 3. Assemble Joined Slate Matrix
    const propMap = {};
    const contestPropIds = [];

    rawProps.forEach(p => {
      if (!p || !p.id) return;
      const propId = String(p.id);
      contestPropIds.push(propId);

      const outcomes = p.possibleOutcomes || p.outcomes || [];
      const awayOut = outcomes[0] || {};
      const homeOut = outcomes[1] || {};

      const away = awayOut.shortDisplayName || awayOut.abbreviation || awayOut.name || 'Away';
      const home = homeOut.shortDisplayName || homeOut.abbreviation || homeOut.name || 'Home';
      const outcomeAwayId = awayOut.id ? String(awayOut.id) : null;
      const outcomeHomeId = homeOut.id ? String(homeOut.id) : null;

      // Direct Event ID Join
      const eventId = String(awayOut.eventId || homeOut.eventId || p.eventId || '');
      const sbEvent = scoreboardByEventId[eventId] || null;

      let winner = null;
      if (awayOut.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeAwayId)) {
        winner = 'away';
      } else if (homeOut.winner || (p.correctOutcomeId && String(p.correctOutcomeId) === outcomeHomeId)) {
        winner = 'home';
      }

      let score = sbEvent?.scoreInfo || null;
      if (!score && winner) {
        score = {
          awayScore: '',
          homeScore: '',
          statusDetail: 'Final',
          state: 'post',
          leader: winner,
          awayAbbr: away,
          homeAbbr: home
        };
      }

      // Vegas Line & Favorite Resolution
      let odds = null;
      const lineStr = sbEvent?.lineDetails || '';
      if (lineStr) {
        let favoriteSide = null;
        let lineSpread = '';
        const parts = lineStr.trim().split(/\s+/);
        if (parts.length >= 2) {
          const favToken = parts[0].toLowerCase();
          lineSpread = parts.slice(1).join(' ');

          if (away.toLowerCase().includes(favToken) || favToken.includes(away.toLowerCase())) {
            favoriteSide = 'away';
          } else if (home.toLowerCase().includes(favToken) || favToken.includes(home.toLowerCase())) {
            favoriteSide = 'home';
          }
        }

        odds = {
          rawLine: lineStr,
          favoriteSide,
          lineSpread,
          overUnder: sbEvent?.overUnder || ''
        };
      }

      const eventDate = sbEvent?.date || p.lockDate || p.date || null;
      let kickoffTime = 0;
      if (eventDate) {
        try {
          kickoffTime = new Date(eventDate).getTime();
        } catch (e) {}
      }

      propMap[propId] = {
        id: propId,
        eventId,
        away,
        home,
        broadcast: sbEvent?.broadcast || '',
        title: `${away} @ ${home}`,
        score,
        odds,
        outcomeAwayId,
        outcomeHomeId,
        kickoffDate: eventDate,
        kickoffTime
      };
    });

    // Chronological Sort (UTC Ascending)
    contestPropIds.sort((a, b) => {
      const tA = propMap[a]?.kickoffTime || 0;
      const tB = propMap[b]?.kickoffTime || 0;
      if (tA && tB && tA !== tB) return tA - tB;
      if (tA && !tB) return -1;
      if (!tA && tB) return 1;
      return (propMap[a]?.title || '').localeCompare(propMap[b]?.title || '');
    });

    // 4. Query League Group & Member Entry Selections
    let groupRes = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup&view=mSettings&_=${Date.now()}`,
      { cache: 'no-store' }
    );
    const gData = groupRes.ok ? await groupRes.json() : {};
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

      const eRes = await fetch(
        `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/entries/${e.id}?_=${Date.now()}`,
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

    const buildHash = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || 'propositions-feed').slice(0, 7);

    return NextResponse.json({
      myUser,
      otherUsers,
      weekNumber: ACTIVE_WEEK,
      activeProps: contestPropIds.slice(0, 10),
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
