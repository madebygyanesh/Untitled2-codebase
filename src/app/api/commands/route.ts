export const runtime = "edge";

const g = globalThis as unknown as {
  __COMMANDS__?: Array<{ ts: number; payload: any }>
}
if (!g.__COMMANDS__) g.__COMMANDS__ = []
const commands = g.__COMMANDS__!

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const payload = body && typeof body === 'object' && 'data' in body ? (body as any).data : body
    const ts = Date.now()
    commands.push({ ts, payload })
    // trim to last 200 commands to bound memory
    if (commands.length > 200) commands.splice(0, commands.length - 200)
    return Response.json({ ok: true, ts })
  } catch (e) {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 })
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const sinceStr = url.searchParams.get('since')
  const since = sinceStr ? Number(sinceStr) : 0
  const list = since > 0 ? commands.filter(c => c.ts > since) : commands.slice(-20)
  return Response.json({ ok: true, commands: list })
}