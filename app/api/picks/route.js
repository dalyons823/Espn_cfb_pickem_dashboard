import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 30; // 30-second server cache on Vercel

const GROUP_ID = 'c57ecf8d-d7fd-3702-8bd3-29159f25ece2';
const SEASON = '2026';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week') || '5';

  try {
    // 1. Fetch live scoreboard from ESPN Core API
    const scoreboardRes = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=100&week=${week}&seasontype=2`,
      { next: { revalidate: 30 } }
    );
    const scoreboardData = await scoreboardRes.json();

    const gamesById = {};
    const gamesByMatchup = {};

    (scoreboardData.events || []).forEach(event => {
      const comp = event.competitions?.[0];
      if (!comp) return;

      const home = comp.competitors?.find(c => c.homeAway === 'home');
      const away = comp.competitors?.find(c => c.homeAway === 'away');

      const isLive = comp.status?.type?.state === 'in';
      const isFinal = comp.status?.type?.state === 'post';

      const gameObj = {
        eventId: event.id,
        awayTeam: away?.team?.abbreviation || 'AWAY',
        homeTeam: home?.team?.abbreviation || 'HOME',
        awayTeamId: away?.team?.id,
        homeTeamId: home?.team?.id,
        awayScore: (isLive || isFinal) ? away?.score : null,
        homeScore: (isLive || isFinal) ? home?.score : null,
        statusText: isLive
          ? `${comp.status?.displayClock} - ${comp.status?.period}Q`
          : (isFinal ? 'Final' : comp.status?.type?.shortDetail || 'Scheduled'),
        isLive,
        isFinal,
        started: isLive || isFinal
      };

      gamesById[event.id] = gameObj;
      gamesByMatchup[`${gameObj.awayTeam}@${gameObj.homeTeam}`.toUpperCase()] = gameObj;
    });

    // 2. Fetch Public Group Picks & Entries from ESPN Fantasy API
    const groupUrl = `https://fantasy.espn.com/apis/v3/games/college-football-pickem/seasons/${SEASON}/segments/0/groups/${GROUP_ID}?view=mGroupPicks&view=mGroupMembers&view=mSettings&scoringPeriodId=${week}`;
    
    const groupRes = await fetch(groupUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      next: { revalidate: 30 }
    });

    if (!groupRes.ok) {
      throw new Error(`ESPN Pick'em API error: ${groupRes.status}`);
    }

    const groupData = await groupRes.json();

    // 3. Normalize Members / Entries
    const members = [];
    const rawEntries = groupData.entries || groupData.members || [];

    rawEntries.forEach(entry => {
      const entryName = entry.name || entry.entryName || entry.displayName || `Entry ${entry.id}`;
      const isUser = entryName.toLowerCase().includes('posa party');
      members.push({
        id: String(entry.id || entry.memberId),
        entryName,
        isUser,
        rawPicks: entry.picks || []
      });
    });

    // Lock "Posa Party" to the first column
    members.sort((a, b) => (b.isUser ? 1 : 0) - (a.isUser ? 1 : 0));

    // 4. Build Matchups & Attached Selections
    const rawMatchups = groupData.settings?.matchups || groupData.matchups || [];
    const matchups = [];

    // If ESPN returns defined matchups for the scoring period, use them; otherwise pull from scoreboard
    if (rawMatchups.length > 0) {
      rawMatchups.forEach(m => {
        const liveInfo = gamesById[m.id] || 
          gamesByMatchup[`${m.awayTeam?.abbreviation}@${m.homeTeam?.abbreviation}`.toUpperCase()] || {
            awayTeam: m.awayTeam?.abbreviation || 'AWAY',
            homeTeam: m.homeTeam?.abbreviation || 'HOME',
            awayScore: null,
            homeScore: null,
            statusText: m.kickoffTime ? new Date(m.kickoffTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Scheduled',
            isLive: false,
            isFinal: false,
            started: false
          };

        const picks = {};
        members.forEach(member => {
          const userPick = (member.rawPicks || []).find(p => String(p.matchupId || p.gameId) === String(m.id))
            || (groupData.picks || []).find(p => String(p.memberId || p.entryId) === member.id && String(p.gameId) === String(m.id));

          let pickedTeam = null;
          if (userPick?.teamId) {
            pickedTeam = String(userPick.teamId) === String(liveInfo.awayTeamId) ? liveInfo.awayTeam : liveInfo.homeTeam;
          } else if (userPick?.teamAbbr) {
            pickedTeam = userPick.teamAbbr;
          }

          picks[member.id] = {
            pickedTeam: pickedTeam || null,
            confidence: userPick?.points || userPick?.confidence || null,
            isCorrect: userPick?.isCorrect ?? null
          };
        });

        matchups.push({
          id: m.id,
          ...liveInfo,
          picks
        });
      });
    } else {
      // Fallback: Populate active events directly from ESPN Scoreboard
      Object.values(gamesById).forEach(liveGame => {
        const picks = {};
        members.forEach(member => {
          const userPick = (member.rawPicks || []).find(p => String(p.gameId) === String(liveGame.eventId));
          picks[member.id] = {
            pickedTeam: userPick?.teamAbbr || null,
            confidence: userPick?.points || null,
            isCorrect: userPick?.isCorrect ?? null
          };
        });

        matchups.push({
          id: liveGame.eventId,
          ...liveGame,
          picks
        });
      });
    }

    return NextResponse.json({
      week: parseInt(week, 10),
      lastSynced: new Date().toISOString(),
      members: members.map(({ id, entryName, isUser }) => ({ id, entryName, isUser })),
      matchups
    });

  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
