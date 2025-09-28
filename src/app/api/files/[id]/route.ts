import { NextResponse } from "next/server";
import { store, removeFile } from "@/lib/store";
import fs from "fs";

export const runtime = "nodejs";

function auth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !store.tokens.has(token)) return false;
  return true;
}

export async function DELETE(req: Request) {
  if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const match = url.pathname.match(/\/api\/files\/([^/]+)/);
  const id = match?.[1] || "";
  const item = store.files.get(id);
  if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  
  // Delete physical file if it exists
  if (item.path && item.storage !== "external") {
    try {
      await fs.promises.unlink(item.path);
    } catch (error) {
      console.warn(`Failed to delete file ${item.path}:`, error);
    }
  }
  
  // Remove from store (this also removes associated schedules)
  removeFile(id);
  return NextResponse.json({ ok: true });
}