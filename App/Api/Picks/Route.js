import { NextResponse } from 'next/server';

const CHALLENGE_SLUG = "college-football-pickem-2026";
const CHALLENGE_ID = 289;
const GROUP_ID = "c57ecf8d-d7fd-3702-8bd3-29159f25ece2";

export async function GET() {
  try {
    const propMap = {};
    try {
      const chalRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_ID}`, {
        next: { revalidate: 300 }
      });
      if (chalRes.ok) {
        const chalData = await chalRes.json();
        (chalData.propositions || []).forEach(p => {
          const outcomes = p.possibleOutcomes || p.outcomes || [];
          const away = outcomes[0]?.name || outcomes[0]?.abbreviation || outcomes[0]?.caption || 'Away';
          const home = outcomes[1]?.name || outcomes[1]?.abbreviation || outcomes[1]?.caption || 'Home';
          const title = p.description || p.name || `${away} @ ${home}`;
          propMap[p.id] = { title, away, home };
          propMap[p.id.slice(0, 7)] = { title, away, home };
        });
      }
    } catch (e) {}

    const groupRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/groups/${GROUP_ID}?view=mGroup`, {
      next: { revalidate: 60 }
    });
    if (!groupRes.ok) throw new Error("Could not fetch group data");
    const gData = await groupRes.json();
    const entries = gData.entries || [];

    const users = [];
    let myUser = null;
    const otherUsers = [];
    const pickMap = {};
    const allPropIds = [];

    const entryPromises = entries.map(async (e) => {
      const userName = e.name || e.member?.displayName || `Entry ${e.id.slice(0, 6)}`;
      const eRes = await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/${CHALLENGE_SLUG}/entries/${e.id}`, {
        next: { revalidate: 60 }
      });
      if (!eRes.ok) return { userName, picks: [] };
      const eData = await eRes.json();
      return { userName, picks: eData.picks || [] };
    });

    const settledEntries = await Promise.all(entryPromises);

    settledEntries.forEach(({ userName, picks }) => {
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
      pickMap
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
