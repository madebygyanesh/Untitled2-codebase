export const runtime = "edge";

const g = globalThis as unknown as {
  __WS_CLIENTS__?: Set<WebSocket>
  __PLAYER_STATES__?: Map<WebSocket, { name: string; ua: string; connectedAt: number; lastSeen: number }>
};
if (!g.__WS_CLIENTS__) g.__WS_CLIENTS__ = new Set();
if (!g.__PLAYER_STATES__) g.__PLAYER_STATES__ = new Map();
const clients = g.__WS_CLIENTS__!;
const playerStates = g.__PLAYER_STATES__!;

function broadcast(data: any) {
  const msg = typeof data === "string" ? data : JSON.stringify(data);
  for (const ws of clients) {
    try { ws.send(msg); } catch {}
  }
}

export async function GET(req: Request) {
  const { 0: client, 1: server } = new (globalThis as any).WebSocketPair();
  const ws = server as unknown as WebSocket;
  // @ts-ignore
  ws.accept();
  clients.add(ws);
  playerStates.set(ws, { name: "", ua: "", connectedAt: Date.now(), lastSeen: Date.now() });

  ws.addEventListener("message", (event: MessageEvent) => {
    let payload: any = { type: "message", data: String(event.data || "") };
    try { payload = JSON.parse(String(event.data)); } catch {}

    // update lastSeen for any message
    const state = playerStates.get(ws);
    if (state) state.lastSeen = Date.now();

    if (payload && payload.type === "broadcast") {
      broadcast(payload.data ?? { type: "refresh" });
    } else if (payload && payload.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong", t: Date.now() })); } catch {}
    } else if (payload && payload.type === "identify") {
      const name = String(payload.name || "").slice(0, 64);
      const ua = String(payload.ua || "").slice(0, 256);
      playerStates.set(ws, {
        name: name || state?.name || "Player",
        ua,
        connectedAt: state?.connectedAt || Date.now(),
        lastSeen: Date.now(),
      });
    }
  });

  const interval = setInterval(() => {
    try { ws.send(JSON.stringify({ type: "heartbeat", t: Date.now() })); } catch {}
  }, 25000);

  ws.addEventListener("close", () => {
    clearInterval(interval as any);
    clients.delete(ws);
    playerStates.delete(ws);
  });
  ws.addEventListener("error", () => {
    clearInterval(interval as any);
    clients.delete(ws);
    playerStates.delete(ws);
  });

  return new Response(null, { status: 101, webSocket: client } as any);
}

// HTTP fallback to broadcast messages when WS is not available for the sender
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Accept either a full message (e.g., {type:"command", action:"mute"})
    // or a wrapper { data: {...} } similar to WS "broadcast"
    const payload = body && typeof body === 'object' && 'data' in body ? body.data : body;
    broadcast(payload);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
}