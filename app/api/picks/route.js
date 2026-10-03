import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30;

const GROUP_ID = 'c57ecf8d-d7fd-3702-8bd3-29159f25ece2';

// In-memory cache for manual POST payloads if ever pushed
let manualPicksCache = {};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week') || '5';
  const season = '2026';

  try {
    // 1. Fetch Live FBS Scoreboard from ESPN Core API
    const scoreboardRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100&week=${week}&seasontype=2`,
      { next: { revalidate: 30 } }
    );
    const scoreboardData = await scoreboardRes.json();

    const liveGames = {};
    (scoreboardData.events || []).forEach((event) => {
      const comp = event.competitions?.[0];
      if (!comp) return;

      const home = comp.competitors?.find((c) => c.homeAway === 'home');
      const away = comp.competitors?.find((c) => c.homeAway === 'away');

      const isLive = comp.status?.type?.state === 'in';
      const isFinal = comp.status?.type?.state === 'post';

      const gameObj = {
        eventId: event.id,
        awayTeam: away?.team?.abbreviation || 'AWAY',
        homeTeam: home?.team?.abbreviation || 'HOME',
        awayScore: isLive || isFinal ? parseInt(away?.score || '0', 10) : null,
        homeScore: isLive || isFinal ? parseInt(home?.score || '0', 10) : null,
        statusText: isLive
          ? `${comp.status?.displayClock} - ${comp.status?.period}Q`
          : isFinal
          ? 'Final'
          : comp.status?.type?.shortDetail || 'Scheduled',
        isLive,
        isFinal,
        started: isLive || isFinal,
        date: event.date
      };

      liveGames[event.id] = gameObj;
      liveGames[`${gameObj.awayTeam}@${gameObj.homeTeam}`.toUpperCase()] = gameObj;
    });

    // 2. Fetch Public ESPN Pick'em Group Data
    const groupUrl = `https://fantasy.espn.com/apis/v3/games/college-football-pickem/seasons/${season}/segments/0/groups/${GROUP_ID}?view=mGroupPicks&view=mGroupMembers&view=mSettings&scoringPeriodId=${week}`;
    const groupRes = await fetch(groupUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      next: { revalidate: 30 }
    });

    let groupData = null;
    if (groupRes.ok) {
      groupData = await groupRes.json();
    } else if (manualPicksCache[week]) {
      groupData = manualPicksCache[week];
    }

    // 3. Build Members List & Pin Posa Party to Left
    const members = [];
    const rawMembers = groupData?.members || groupData?.entries || [];

    rawMembers.forEach((m) => {
      const entryName = m.entryName || m.name || m.displayName || `Entry ${m.id}`;
      const isUser = entryName.toLowerCase().includes('posa party') || entryName.toLowerCase().includes('posaparty');
      members.push({
        id: String(m.id || m.memberId || entryName),
        entryName,
        isUser,
        initialRank: m.initialRank || m.rank || 1,
        totalPoints: m.totalPoints || m.score || 0
      });
    });

    // Posa Party locked into the first index
    members.sort((a, b) => (b.isUser ? 1 : 0) - (a.isUser ? 1 : 0));

    // 4. Extract Real Matchups & Selections (No hardcoded mock fallbacks)
    const rawMatchups = groupData?.settings?.matchups || groupData?.matchups || [];
    const matchups = [];

    rawMatchups.forEach((gm) => {
      const awayAbbr = (gm.awayTeam?.abbreviation || 'AWAY').toUpperCase();
      const homeAbbr = (gm.homeTeam?.abbreviation || 'HOME').toUpperCase();
      const lookupKey = `${awayAbbr}@${homeAbbr}`;

      const live = liveGames[gm.id] || liveGames[lookupKey] || {
        awayTeam: awayAbbr,
        homeTeam: homeAbbr,
        awayScore: null,
        homeScore: null,
        statusText: gm.kickoffTime
          ? new Date(gm.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : 'Scheduled',
        isLive: false,
        isFinal: false,
        started: false
      };

      const picks = {};
      members.forEach((mem) => {
        const userPick = (groupData.picks || []).find(
          (p) => String(p.memberId || p.entryId) === mem.id && String(p.gameId || p.matchupId) === String(gm.id)
        );

        let pickedTeam = userPick?.teamAbbr || null;
        if (!pickedTeam && userPick?.teamId) {
          pickedTeam = String(userPick.teamId) === String(gm.awayTeam?.id) ? awayAbbr : homeAbbr;
        }

        picks[mem.id] = {
          pickedTeam: pickedTeam || null,
          confidence: userPick?.points || userPick?.confidence || 0
        };
      });

      // Calculate pick spread analytics
      let awayPickCount = 0;
      let homePickCount = 0;
      Object.values(picks).forEach((p) => {
        if (p.pickedTeam === awayAbbr) awayPickCount++;
        if (p.pickedTeam === homeAbbr) homePickCount++;
      });

      matchups.push({
        id: gm.id,
        awayTeam: awayAbbr,
        homeTeam: homeAbbr,
        awayScore: live.awayScore,
        homeScore: live.homeScore,
        statusText: live.statusText,
        isLive: live.isLive,
        isFinal: live.isFinal,
        started: live.started,
        analytics: `${awayPickCount}-${homePickCount}`,
        picks
      });
    });

    return NextResponse.json({
      week: parseInt(week, 10),
      lastSynced: new Date().toISOString(),
      members,
      matchups
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const week = body.week || 5;
    manualPicksCache[week] = body;
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
