import { NextResponse } from "next/server";
import { store } from "@/lib/store";

export const runtime = "nodejs";

function auth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !store.tokens.has(token)) return false;
  return true;
}

// POST: change or reset admin password
// Body: { oldPassword: string, newPassword?: string }
export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const { oldPassword = "", newPassword = "" } = await req.json().catch(() => ({ oldPassword: "", newPassword: "" }));

  // Master reset: entering "anjuman" resets to default password (case-insensitive)
  if (String(oldPassword).trim().toLowerCase() === "anjuman") {
    store.adminPassword = "aiarkp@123";
    return NextResponse.json({ ok: true, reset: true, password: "aiarkp@123" });
  }

  const current = store.adminPassword || process.env.ADMIN_PASSWORD || "aiarkp@123";
  if (!oldPassword || oldPassword !== current) {
    return NextResponse.json({ ok: false, error: "Invalid current password" }, { status: 400 });
  }
  if (!newPassword || newPassword.length < 4) {
    return NextResponse.json({ ok: false, error: "New password too short" }, { status: 400 });
  }

  store.adminPassword = newPassword;
  return NextResponse.json({ ok: true });
}