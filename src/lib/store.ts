// Simple in-memory store for files and schedules with disk persistence for local dev
import fs from "fs";
import path from "path";

export type FileItem = {
  id: string;
  name: string;
  mime: string;
  size: number;
  storage: "public" | "tmp" | "external";
  path: string; // absolute path on disk
  url: string; // public URL to access
  uploadedAt: number;
  durationSeconds?: number; // optional duration for videos/links
};

export type ScheduleItem = {
  id: string;
  fileId: string;
  startAt: number; // epoch ms
  endAt: number; // epoch ms
  order: number;
  // Optional day-based scheduling
  days?: number[]; // 0-6 (Sun-Sat)
  startTime?: string; // "HH:mm"
  endTime?: string;   // "HH:mm"
  // Optional per-item duration in seconds (images/links use this; videos fall back to natural length when omitted)
  durationSeconds?: number;
// Remove per-item muted option due to browser policy limitations
};

export type PlayerSettings = {
  brightness: number;
  orientation: "landscape" | "portrait";
  autoStart: boolean;
  defaultImageDuration: number;
  defaultLinkDuration: number;
};

type Store = {
  files: Map<string, FileItem>;
  schedules: Map<string, ScheduleItem>;
  tokens: Set<string>; // simple auth tokens
  adminPassword: string; // mutable in-memory admin password
  playerSettings: PlayerSettings;
};

const g = globalThis as unknown as { __SIGNAGE_STORE?: Store };

// Default player settings (volume/mute removed due to browser policies)
const defaultPlayerSettings: PlayerSettings = {
  brightness: 100,
  orientation: "landscape",
  autoStart: true,
  defaultImageDuration: 10,
  defaultLinkDuration: 30,
};

if (!g.__SIGNAGE_STORE) {
  g.__SIGNAGE_STORE = {
    files: new Map(),
    schedules: new Map(),
    tokens: new Set(),
    adminPassword: process.env.ADMIN_PASSWORD || "aiarkp@123",
    playerSettings: { ...defaultPlayerSettings },
  };
}

export const store = g.__SIGNAGE_STORE!;

// Cross-platform data directory paths
function getDataDir(): string {
  const isLinux = process.platform === "linux";
  const isWindows = process.platform === "win32";
  
  if (process.env.SIGNAGE_DATA_DIR) {
    return process.env.SIGNAGE_DATA_DIR;
  }
  
  if (isLinux) {
    // Use /var/lib/signage for Linux systems
    return "/var/lib/signage";
  } else if (isWindows) {
    // Use AppData on Windows
    const appData = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
    return path.join(appData, "signage");
  } else {
    // Default for other platforms
    return path.join(process.cwd(), "data");
  }
}

function getPersistencePath(): string {
  return path.join(getDataDir(), "store.json");
}

function getUploadsDir(): string {
  return path.join(getDataDir(), "uploads");
}

// Enhanced directory creation with proper permissions for Linux
export function ensureUploadDirs() {
  try {
    // Create data directory
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
    }

    // Create uploads directory
    const uploadsDir = getUploadsDir();
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o755 });
    }

    // Legacy directories for backwards compatibility
    const localUploads = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(localUploads)) {
      fs.mkdirSync(localUploads, { recursive: true });
    }
  } catch (error) {
    console.warn("Failed to create upload directories:", error);
  }
  
  try {
    const tmpUploads = path.join("/tmp", "uploads");
    if (!fs.existsSync(tmpUploads)) {
      fs.mkdirSync(tmpUploads, { recursive: true });
    }
  } catch (error) {
    // Ignore tmp creation errors on Windows
    if (process.platform !== "win32") {
      console.warn("Failed to create tmp uploads directory:", error);
    }
  }
}

// Save store data to disk
export async function saveStoreToDisk(): Promise<void> {
  try {
    ensureUploadDirs();
    
    const data = {
      files: Array.from(store.files.entries()),
      schedules: Array.from(store.schedules.entries()),
      playerSettings: store.playerSettings,
      savedAt: Date.now(),
    };
    
    const persistencePath = getPersistencePath();
    await fs.promises.writeFile(persistencePath, JSON.stringify(data, null, 2), { mode: 0o644 });
    console.log("Store saved to:", persistencePath);
  } catch (error) {
    console.error("Failed to save store to disk:", error);
  }
}

// Load store data from disk
export async function loadStoreFromDisk(): Promise<void> {
  try {
    const persistencePath = getPersistencePath();
    
    if (!fs.existsSync(persistencePath)) {
      console.log("No existing store file found. Starting with empty store.");
      return;
    }
    
    const data = JSON.parse(await fs.promises.readFile(persistencePath, "utf-8"));
    
    // Restore files
    if (data.files && Array.isArray(data.files)) {
      store.files.clear();
      for (const [id, fileItem] of data.files) {
        // Verify file still exists on disk before adding to store
        if (fileItem.storage !== "external" && fileItem.path && fs.existsSync(fileItem.path)) {
          store.files.set(id, fileItem);
        } else if (fileItem.storage === "external") {
          // External links don't have files on disk
          store.files.set(id, fileItem);
        }
      }
    }
    
    // Restore schedules
    if (data.schedules && Array.isArray(data.schedules)) {
      store.schedules.clear();
      for (const [id, scheduleItem] of data.schedules) {
        // Only restore schedules for files that still exist
        if (store.files.has(scheduleItem.fileId)) {
          store.schedules.set(id, scheduleItem);
        }
      }
    }
    
    // Restore player settings
    if (data.playerSettings) {
      store.playerSettings = { ...defaultPlayerSettings, ...data.playerSettings };
    }
    
    console.log(`Store loaded: ${store.files.size} files, ${store.schedules.size} schedules`);
  } catch (error) {
    console.error("Failed to load store from disk:", error);
  }
}

// Auto-save store when data changes
let saveTimeout: NodeJS.Timeout | null = null;
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    saveStoreToDisk().catch(console.error);
  }, 2000); // Save 2 seconds after last change
}

// Enhanced store operations with auto-save
export function addFile(file: FileItem): void {
  store.files.set(file.id, file);
  scheduleSave();
}

export function removeFile(id: string): boolean {
  const result = store.files.delete(id);
  if (result) {
    // Also remove associated schedules
    for (const [scheduleId, schedule] of store.schedules.entries()) {
      if (schedule.fileId === id) {
        store.schedules.delete(scheduleId);
      }
    }
    scheduleSave();
  }
  return result;
}

export function addSchedule(schedule: ScheduleItem): void {
  store.schedules.set(schedule.id, schedule);
  scheduleSave();
}

export function removeSchedule(id: string): boolean {
  const result = store.schedules.delete(id);
  if (result) scheduleSave();
  return result;
}

export function updatePlayerSettings(settings: Partial<PlayerSettings>): void {
  store.playerSettings = { ...store.playerSettings, ...settings };
  scheduleSave();
}

export function resolveStorage() {
  const isVercel = !!process.env.VERCEL;
  return isVercel ? ("tmp" as const) : ("public" as const);
}

export function publicUrlFor(fileName: string, storage: "public" | "tmp" | "external", id: string) {
  if (storage === "external") {
    return ""; // External URLs are stored directly in the FileItem.url
  }
  if (storage === "public") {
    return `/uploads/${encodeURIComponent(fileName)}`;
  }
  // tmp needs streaming through API
  return `/api/files/stream/${id}`;
}

export function diskPathFor(fileName: string, storage: "public" | "tmp" | "external") {
  if (storage === "external") {
    return ""; // External links don't have disk paths
  }
  
  if (storage === "public") {
    // Use persistent uploads directory
    return path.join(getUploadsDir(), fileName);
  }
  
  // tmp storage
  return path.join("/tmp", "uploads", fileName);
}

// Initialize store on module load
if (typeof window === "undefined") {
  // Only run on server side
  loadStoreFromDisk().catch(console.error);
  
  // Save store on process exit
  process.on("SIGINT", () => {
    console.log("Saving store before exit...");
    saveStoreToDisk().then(() => process.exit(0)).catch(() => process.exit(1));
  });
  
  process.on("SIGTERM", () => {
    console.log("Saving store before termination...");
    saveStoreToDisk().then(() => process.exit(0)).catch(() => process.exit(1));
  });
}