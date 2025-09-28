import { NextResponse } from "next/server";
import { store } from "@/lib/store";
import fs from "fs";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url)
  const parts = url.pathname.split("/")
  const id = parts[parts.length - 1]

  const item = store.files.get(id);
  if (!item) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const stat = await fs.promises.stat(item.path).catch(() => null);
  if (!stat) return NextResponse.json({ ok: false, error: "Missing file" }, { status: 404 });

  const fileSize = stat.size;
  const range = req.headers.get("range");

  // Support HTTP Range requests for instant start and seeking
  if (range) {
    // Example: bytes=0- or bytes=1000-2000
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = fileSize - 1;
    if (match) {
      if (match[1] !== "") start = Math.min(parseInt(match[1], 10), end);
      if (match[2] !== "") end = Math.min(parseInt(match[2], 10), end);
    }
    if (start > end || start < 0 || end >= fileSize) {
      // Invalid range
      return new NextResponse(null, {
        status: 416,
        headers: {
          "Content-Range": `bytes */${fileSize}`,
        },
      });
    }

    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(item.path, { start, end });

    return new NextResponse(stream as any, {
      status: 206,
      headers: {
        "Content-Type": item.mime,
        "Content-Length": String(chunkSize),
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // No range header: return full file
  const stream = fs.createReadStream(item.path);
  return new NextResponse(stream as any, {
    status: 200,
    headers: {
      "Content-Type": item.mime,
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}