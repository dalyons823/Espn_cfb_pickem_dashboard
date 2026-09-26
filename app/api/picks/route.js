import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const CHALLENGE_ID = 289;
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    // 1. Fetch live scoreboard + full week slate
    let allEvents = [];
    try {
      const sbRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300', {
        next: { revalidate: 30 }
      });
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        allEvents = sbData.events || [];

        const weekNum = sbData.week?.number;
        if (weekNum) {
          const weekRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${weekNum}`, {
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

    // 2. Fetch propositions
    const propMap = {};
    try {
      const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_ID}`, {
        next: { revalidate: 300 }
      });
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        (chalData.propositions || []).forEach(p => {
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

          const propObj = {
            away,
            home,
            title: `${away} @ ${home}`,
            score
          };
          propMap[p.id] = propObj;
          propMap[p.id.slice(0, 7)] = propObj;
        });
      }
    } catch (e) {}

    // 3. Fetch Group
    const groupRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`, {
      next: { revalidate: 60 }
    });
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    // 4. Fetch Picks & Capture Season Standings
    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const allPropIds = [];
    const userOverallScores = {};

    const entryPromises = entries.map(async (e) => {
      const userName = e.name || e.member?.displayName || `Entry ${e.id.slice(0, 6)}`;
      let scoreVal = null;
      if (typeof e.score === 'number') scoreVal = e.score;
      else if (e.score?.value !== undefined) scoreVal = e.score.value;
      else if (typeof e.points === 'number') scoreVal = e.points;
      else if (typeof e.overallScore === 'number') scoreVal = e.overallScore;

      const eRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/entries/${e.id}`, {
        next: { revalidate: 60 }
      });
      if (!eRes.ok) return { userName, picks: [], scoreVal };
      const eData = await eRes.json();
      if (scoreVal === null) {
        if (typeof eData.score === 'number') scoreVal = eData.score;
        else if (eData.score?.value !== undefined) scoreVal = eData.score.value;
        else if (typeof eData.overallScore === 'number') scoreVal = eData.overallScore;
        else if (typeof eData.points === 'number') scoreVal = eData.points;
      }
      return { userName, picks: eData.picks || [], scoreVal };
    });

    const settled = await Promise.all(entryPromises);

    settled.forEach(({ userName, picks, scoreVal }) => {
      userOverallScores[userName] = scoreVal;
      if (userName.toLowerCase().replace(/\s+/g, '').includes('posaparty')) {
        myUser = userName;
      } else {
        otherUsers.push(userName);
      }
      users.push(userName);
      pickMap[userName] = {};

      picks.forEach(p => {
        const propId = p.propositionId;
        if (!allPropIds.includes(propId)) {
          allPropIds.push(propId);
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

    const weekBlocks = [];
    for (let i = 0; i < allPropIds.length; i += 10) {
      weekBlocks.push(allPropIds.slice(i, i + 10));
    }

    return NextResponse.json({
      myUser,
      otherUsers,
      weekBlocks,
      propMap,
      pickMap,
      userOverallScores
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
