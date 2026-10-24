import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CHALLENGE_SLUG = process.env.NEXT_PUBLIC_ESPN_CHALLENGE_SLUG || "college-football-pickem-2026";
const GROUP_ID = process.env.NEXT_PUBLIC_ESPN_GROUP_ID || "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedWeek = searchParams.get('week');
    
    let activeWeek = 6;
    let currentWeek = 6;
    let activeProps = [];

    // 1. Fetch current challenge definitions to find the true current week
    const chalResCurrent = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks&_=${Date.now()}`,
      { cache: 'no-store' }
    );

    if (chalResCurrent.ok) {
      const chalDataCurrent = await chalResCurrent.json();
      currentWeek = chalDataCurrent.currentScoringPeriod?.id || 6;
      activeWeek = requestedWeek ? Number(requestedWeek) : currentWeek;
      
      let allProps = [];

      if (activeWeek === currentWeek) {
        allProps = chalDataCurrent.propositions || [];
      } else {
        const chalResPast = await fetch(
          `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks&scoringPeriodId=${activeWeek}&_=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (chalResPast.ok) {
          const pastData = await chalResPast.json();
          allProps = pastData.propositions || [];
        }
      }
      
      activeProps = allProps.filter(p => {
        const spId = p.scoringPeriodId || p.scoringPeriod?.id || p.scoringPeriod;
        if (Number(spId) !== Number(activeWeek)) return false;
        if (p.scoringFormatIds && Array.isArray(p.scoringFormatIds)) {
          return p.scoringFormatIds.includes(2) || p.scoringFormatIds.includes("2");
        }
        return false;
      });
    }

    // 2. Fetch live scoreboard across all FBS games (groups=80, limit=300) for the target week
    let scoreboardEvents = [];
    try {
      const sbRes = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80&limit=300&week=${activeWeek}&_=${Date.now()}`,
        { cache: 'no-store' }
      );
      if (sbRes.ok) {
        const sbData = await sbRes.json();
        scoreboardEvents = (sbData.events || []).map(ev => {
          const comp = ev.competitions?.[0];
          if (!comp) return null;
          const away = comp.competitors?.find(c => c.homeAway === 'away');
          const home = comp.competitors?.find(c => c.homeAway === 'home');
          const situation = comp.situation || null;

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

          const awayTeamId = String(away?.team?.id || away?.id || '');
          const homeTeamId = String(home?.team?.id || home?.id || '');

          // Extract strictly possession, down/distance, and yard line
          let possession = null;
          let situationSummary = '';

          if (situation) {
            const possId = String(situation.possession || '');
            if (possId && awayTeamId && possId === awayTeamId) possession = 'away';
            else if (possId && homeTeamId && possId === homeTeamId) possession = 'home';

            const shortDown = situation.shortDownDistanceText || '';
            const fullDown = situation.downDistanceText || '';
            const yardLine = situation.possessionText || '';

            if (shortDown && yardLine) {
              situationSummary = `${shortDown} • ${yardLine}`;
            } else if (fullDown) {
              situationSummary = fullDown;
            } else if (shortDown) {
              situationSummary = shortDown;
            } else if (yardLine) {
              situationSummary = yardLine;
            }
          }

          const awayAbbr = away?.team?.abbreviation || away?.team?.shortDisplayName || '';
          const homeAbbr = home?.team?.abbreviation || home?.team?.shortDisplayName || '';
          const awayLogo = away?.team?.logo || away?.team?.logos?.[0]?.href || '';
          const homeLogo = home?.team?.logo || home?.team?.logos?.[0]?.href || '';

          const oddsObj = comp.odds?.[0] || null;
          const lineDetails = oddsObj?.details || '';
          const overUnder = oddsObj?.overUnder ? `O/U ${oddsObj.overUnder}` : '';

          // Check all 3 ESPN broadcast paths
          let tvNetwork = '';
          if (typeof comp.broadcast === 'string' && comp.broadcast.trim()) {
            tvNetwork = comp.broadcast.trim();
          } else if (Array.isArray(comp.broadcasts) && comp.broadcasts.length > 0) {
            const names = comp.broadcasts.flatMap(b => b.names || []).filter(Boolean);
            if (names.length > 0) tvNetwork = names[0];
          } else if (Array.isArray(comp.geoBroadcasts) && comp.geoBroadcasts.length > 0) {
            const mediaName = comp.geoBroadcasts.map(g => g.media?.shortName).filter(Boolean);
            if (mediaName.length > 0) tvNetwork = mediaName[0];
          }

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
            id: String(ev.id),
            date: ev.date || comp.date || null,
            awayAbbr,
            homeAbbr,
            awayLogo,
            homeLogo,
            lineDetails,
            overUnder,
            tv: tvNetwork,
            awayNames: collectNames(away?.team),
            homeNames: collectNames(home?.team),
            espnUrl: `https://www.espn.com/college-football/game/_/gameId/${ev.id}`,
            scoreInfo: {
              awayScore: !isPre && aScore !== null ? String(aScore) : '',
              homeScore: !isPre && hScore !== null ? String(hScore) : '',
              statusDetail: ev.status?.type?.shortDetail || '',
              state,
              leader,
              awayAbbr,
              homeAbbr,
              possession,
              situationSummary
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

    // 3. Register propositions, logos, links, and Vegas lines
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
