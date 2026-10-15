import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    let activeWeek = 6;
    let activeProps = [];

    // 1. Fetch challenge definitions using the authenticated make_picks view
    const chalRes = await fetch(
      `https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}?view=chui_pagetype_make_picks&_=${Date.now()}`,
      { cache: 'no-store' }
    );

    if (chalRes.ok) {
      const chalData = await chalRes.json();
      activeWeek = chalData.currentScoringPeriod?.id || 6;
      
      const allProps = chalData.propositions || [];
      
      // Filter exclusively for active week Confidence format games (ID 2)
      activeProps = allProps.filter(p => {
        const spId = p.scoringPeriodId || p.scoringPeriod?.id || p.scoringPeriod;
        if (Number(spId) !== Number(activeWeek)) return false;

        if (p.scoringFormatIds && Array.isArray(p.scoringFormatIds)) {
          return p.scoringFormatIds.includes(2) || p.scoringFormatIds.includes("2");
        }
        return false;
      });
    }

    // 2. Fetch live scoreboard across all FBS games (groups=80, limit=300) with team logos and event URLs
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
          const awayLogo = away?.team?.logo || away?.team?.logos?.[0]?.href || '';
          const homeLogo = home?.team?.logo || home?.team?.logos?.[0]?.href || '';

          const oddsObj = comp.odds?.[0] || null;
          const lineDetails = oddsObj?.details || '';
          const overUnder = oddsObj?.overUnder ? `O/U ${oddsObj.overUnder}` : '';

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
      const awayLogo = matchedEvent?.awayLogo || '';
      const homeLogo = matchedEvent?.homeLogo || '';
      const eventDate = matchedEvent?.date || rawProp.date || rawProp.startTime || rawProp.lockDate;
      const eventId = matchedEvent?.id || rawProp.eventId || outcomes[0]?.eventId || outcomes[1]?.eventId || '';
      const espnUrl = matchedEvent?.espnUrl || (eventId ? `https://www.espn.com/college-football/game/_/gameId/${eventId}` : 'https://www.espn.com/college-football/scoreboard');

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
        eventId,
        espnUrl,
        away,
        home,
        awayLogo,
        homeLogo,
        title: `${away} @${home}`,
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

    // 4. Fetch group entries, attaching the mScoreboard view flag to force history extraction
    let groupRes = await fetch(
      `
