import { NextResponse } from "next/server";
import crypto from "crypto";
import { store } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));

  // Master reset (case-insensitive): if master keyword entered, reset admin password to default
  const isMaster = String(password || "").trim().toLowerCase() === "anjuman";
  if (isMaster) {
    store.adminPassword = "aiarkp@123";
  }

  const expected = store.adminPassword || process.env.ADMIN_PASSWORD || "aiarkp@123";
  if (!password || (String(password) !== expected && !isMaster)) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }
  const token = crypto.randomBytes(24).toString("hex");
  store.tokens.add(token);
  return NextResponse.json({ ok: true, token });
}