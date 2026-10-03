import { NextResponse } from 'next/server';

// In-memory fallback cache
let weekCache = {};

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const week = searchParams.get('week') || '5';

  if (weekCache[week]) {
    return NextResponse.json(weekCache[week]);
  }

  // Return empty structure instead of outdated mock data
  return NextResponse.json({
    week: parseInt(week, 10),
    matchups: [],
    picks: []
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const week = body.week || 5;

    // Reject payloads containing legacy test matchups
    const cleanMatchups = (body.matchups || []).filter(
      m => !(m.awayTeam === 'VAN' && m.homeTeam === 'UGA')
    );

    weekCache[week] = {
      ...body,
      matchups: cleanMatchups,
      updatedAt: new Date().toISOString()
    };

    return NextResponse.json({ success: true, count: cleanMatchups.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
