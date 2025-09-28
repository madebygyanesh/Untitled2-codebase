export const runtime = "edge";

// Keep a global map of player states populated by /api/ws
const g = globalThis as unknown as {
  __PLAYER_STATES__?: Map<WebSocket, { name: string; ua: string; connectedAt: number; lastSeen: number }>
  __HTTP_PLAYERS__?: Map<string, { key: string; name: string; ua: string; connectedAt: number; lastSeen: number }>
};

// initialize HTTP fallback map
if (!g.__HTTP_PLAYERS__) g.__HTTP_PLAYERS__ = new Map();

export async function GET() {
  const states = g.__PLAYER_STATES__;
  const httpStates = g.__HTTP_PLAYERS__!;
  const now = Date.now();
  const ACTIVE_WINDOW = 40_000; // 40s since lastSeen

  const wsPlayers = states
    ? Array.from(states.values())
        .filter((s) => now - s.lastSeen <= ACTIVE_WINDOW && !!s.name && s.name.trim().toLowerCase() !== "player")
        .map((s) => ({
          name: s.name.trim(),
          ua: s.ua || "",
          connectedAt: s.connectedAt,
          lastSeen: s.lastSeen,
        }))
    : [];

  const httpPlayers = Array.from(httpStates.values())
    .filter((s) => now - s.lastSeen <= ACTIVE_WINDOW && !!s.name && s.name.trim().toLowerCase() !== "player")
    .map((s) => ({
      name: s.name.trim(),
      ua: s.ua || "",
      connectedAt: s.connectedAt,
      lastSeen: s.lastSeen,
    }));

  const players = [...wsPlayers, ...httpPlayers].sort((a, b) => b.lastSeen - a.lastSeen);

  return Response.json({ ok: true, players });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawName = body?.name;
    const name = typeof rawName === "string" ? String(rawName).slice(0, 64) : "";
    const nameTrim = name.trim();
    const ua = String(body?.ua || "").slice(0, 256);

    // Ignore unknown/placeholder player names entirely
    if (!nameTrim || nameTrim.toLowerCase() === "player") {
      return Response.json({ ok: true });
    }

    const key = `${nameTrim}|${ua}`;

    const httpStates = g.__HTTP_PLAYERS__!;
    const prev = httpStates.get(key);
    const now = Date.now();
    if (prev) {
      prev.lastSeen = now;
      httpStates.set(key, prev);
    } else {
      httpStates.set(key, { key, name: nameTrim, ua, connectedAt: now, lastSeen: now });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}