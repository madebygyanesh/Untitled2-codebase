import { NextResponse } from "next/server";
import { store, ScheduleItem, addSchedule, removeSchedule } from "@/lib/store";

export const runtime = "nodejs";

function auth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !store.tokens.has(token)) return false;
  return true;
}

export async function GET() {
  const schedules = Array.from(store.schedules.values()).sort((a, b) => a.order - b.order);
  return NextResponse.json({ ok: true, schedules });
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { id, fileId, startAt, endAt, order } = body as Partial<ScheduleItem> & { fileId: string };
  if (!fileId || !store.files.get(fileId)) {
    return NextResponse.json({ ok: false, error: "Invalid fileId" }, { status: 400 });
  }
  const start = typeof startAt === "number" ? startAt : Date.now();
  const end = typeof endAt === "number" ? endAt : start + 3600_000;
  const ord = typeof order === "number" ? order : 0;

  // Optional day/time window fields
  const days = Array.isArray((body as any).days) ? (body as any).days.map((n: any) => Number(n)).filter((n: number) => n >= 0 && n <= 6) : undefined;
  const startTime = typeof (body as any).startTime === "string" ? (body as any).startTime : undefined;
  const endTime = typeof (body as any).endTime === "string" ? (body as any).endTime : undefined;
  const durationSeconds = Number((body as any).durationSeconds);
  const hasMuted = typeof (body as any).muted === "boolean";
  const muted = hasMuted ? Boolean((body as any).muted) : undefined;

  // Enforce default duration for links when missing/invalid
  const file = store.files.get(fileId);
  const isLink = !!file?.mime?.startsWith("link/");
  const providedDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : undefined;
  const effectiveDuration = isLink ? (providedDuration ?? 10) : providedDuration;

  const item: ScheduleItem = {
    id: id || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fileId,
    startAt: start,
    endAt: end,
    order: ord,
    ...(days && days.length ? { days } : {}),
    ...(startTime ? { startTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(typeof effectiveDuration === 'number' ? { durationSeconds: effectiveDuration } : {}),
    ...(hasMuted ? { muted } : {}),
  };
  addSchedule(item);
  return NextResponse.json({ ok: true, schedule: item });
}

export async function DELETE(req: Request) {
  if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  const removed = removeSchedule(id);
  if (!removed) return NextResponse.json({ ok: false, error: "Schedule not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}