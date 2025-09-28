import { NextResponse } from "next/server";
import { store, updatePlayerSettings, PlayerSettings } from "@/lib/store";

export const runtime = "nodejs";

function auth(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !store.tokens.has(token)) return false;
  return true;
}

export async function GET() {
  return NextResponse.json({ ok: true, settings: store.playerSettings });
}

export async function POST(req: Request) {
  if (!auth(req)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  
  try {
    const body = await req.json();
    const validFields: (keyof PlayerSettings)[] = [
      'brightness', 'orientation', 
      'autoStart', 'defaultImageDuration', 'defaultLinkDuration'
    ];
    
    const updates: Partial<PlayerSettings> = {};
    
    for (const field of validFields) {
      if (field in body) {
        const value = body[field];
        
        // Validate field types and ranges
        switch (field) {
          case 'autoStart':
            if (typeof value === 'boolean') updates[field] = value;
            break;
          case 'brightness':
            if (typeof value === 'number' && value >= 0 && value <= 200) {
              updates[field] = Math.round(value);
            }
            break;
          case 'orientation':
            if (value === 'landscape' || value === 'portrait') {
              updates[field] = value;
            }
            break;
          case 'defaultImageDuration':
          case 'defaultLinkDuration':
            if (typeof value === 'number' && value >= 1 && value <= 3600) {
              updates[field] = Math.round(value);
            }
            break;
        }
      }
    }
    
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ ok: false, error: "No valid updates provided" }, { status: 400 });
    }
    
    updatePlayerSettings(updates);
    
    return NextResponse.json({ ok: true, settings: store.playerSettings });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }
}