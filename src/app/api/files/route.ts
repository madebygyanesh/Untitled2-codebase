import { NextResponse } from "next/server";
import { store, ensureUploadDirs, resolveStorage, publicUrlFor, diskPathFor, addFile } from "@/lib/store";
import fs from "fs";

export const runtime = "nodejs";

function auth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !store.tokens.has(token)) return false;
  return true;
}

export async function GET() {
  const files = Array.from(store.files.values()).sort((a,b)=>b.uploadedAt-a.uploadedAt);
  return NextResponse.json({ ok: true, files });
}

export async function POST(req: Request) {
  try {
    if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    ensureUploadDirs();

    // Try to detect JSON body for external link creation
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const body = await req.json();
        const url: string | undefined = body?.url;
        const nameInput: string | undefined = body?.name;
        if (!url || typeof url !== "string") {
          return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });
        }
        if (!/^https?:\/\//i.test(url)) {
          return NextResponse.json({ ok: false, error: "Only http(s) URLs are allowed" }, { status: 400 });
        }
        // Optional: per-link default duration
        const dur = Number((body as any)?.durationSeconds);
        const hasDuration = Number.isFinite(dur) && dur > 0;

        const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const fileName = nameInput?.trim() || url;
        const item = {
          id,
          name: fileName,
          mime: "link/external",
          size: 0,
          storage: "external" as const,
          path: "",
          url,
          uploadedAt: Date.now(),
          ...(hasDuration ? { durationSeconds: dur } : {}),
        };
        addFile(item);
        // Notify players/admins to refresh lists (best-effort, non-blocking)
        fetch('/api/ws', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'refresh' }) }).catch(() => {});
        return NextResponse.json({ ok: true, file: item });
      } catch (e) {
        return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
      }
    }

    // Default: handle multipart file upload (images/videos)
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid multipart form data" }, { status: 400 });
    }

    // Support external link via multipart as well
    const urlField = form.get("url");
    if (typeof urlField === "string" && urlField) {
      const url = urlField;
      const nameInput = form.get("name");
      if (!/^https?:\/\//i.test(url)) {
        return NextResponse.json({ ok: false, error: "Only http(s) URLs are allowed" }, { status: 400 });
      }
      // Optional: per-link default duration (multipart)
      const durField = form.get("durationSeconds");
      const dur = typeof durField === 'string' ? Number(durField) : Number((durField as any)?.toString?.() || NaN);
      const hasDuration = Number.isFinite(dur) && dur > 0;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const fileName = (typeof nameInput === "string" && nameInput.trim()) ? nameInput.trim() : url;
      const item = {
        id,
        name: fileName,
        mime: "link/external",
        size: 0,
        storage: "external" as const,
        path: "",
        url,
        uploadedAt: Date.now(),
        ...(hasDuration ? { durationSeconds: dur } : {}),
      };
      addFile(item);
      // Notify players/admins
      fetch('/api/ws', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'refresh' }) }).catch(() => {});
      return NextResponse.json({ ok: true, file: item });
    }

    const blob = form.get("file");
    if (!blob || typeof blob === "string") {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }
    // @ts-ignore
    const file = blob as File;
    const size = file.size;
    const type = file.type || "application/octet-stream";
    if (size > 100 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "File too large (max 100MB)" }, { status: 400 });
    }
    const allowed = ["image/", "video/"];
    if (!allowed.some((p) => type.startsWith(p))) {
      return NextResponse.json({ ok: false, error: "Only images and videos are allowed" }, { status: 400 });
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch {
      return NextResponse.json({ ok: false, error: "Unable to read file" }, { status: 400 });
    }

    const fileName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const storage = resolveStorage();
    const diskPath = diskPathFor(fileName, storage);

    try {
      await fs.promises.writeFile(diskPath, Buffer.from(arrayBuffer));
    } catch {
      return NextResponse.json({ ok: false, error: "Failed to save file" }, { status: 500 });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = {
      id,
      name: fileName,
      mime: type,
      size,
      storage,
      path: diskPath,
      url: publicUrlFor(fileName, storage, id),
      uploadedAt: Date.now(),
    };
    addFile(item);
    // Best-effort broadcast to connected players to refresh
    fetch('/api/ws', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'refresh' }) }).catch(() => {});
    return NextResponse.json({ ok: true, file: item });
  } catch (err) {
    // Ensure we never leak an HTML error page to clients expecting JSON
    return NextResponse.json({ ok: false, error: 'Upload failed unexpectedly' }, { status: 500 });
  }
}