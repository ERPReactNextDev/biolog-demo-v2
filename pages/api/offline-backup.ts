// pages/api/offline-backup.ts
//
// Server-side JSON file backup for offline pending logs.
// Acts as a second durability layer behind IndexedDB — if the browser clears
// IndexedDB the data survives here and gets re-enqueued on the next sync.
//
// Routes:
//   POST   /api/offline-backup         — upsert a PendingLog into the backup
//   DELETE /api/offline-backup?id=xxx  — remove a synced log from the backup
//   GET    /api/offline-backup?ref=xxx — return all backup logs for a user

import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import path from "path";

// Store backups outside of .next so they survive dev restarts
const BACKUP_DIR = path.join(process.cwd(), "data", "offline-backups");

function ensureDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function backupFilePath(referenceId: string): string {
  // Sanitise — only allow alphanumeric + dash/underscore in filenames
  const safe = referenceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(BACKUP_DIR, `${safe}.json`);
}

function readBackup(referenceId: string): Record<string, unknown>[] {
  const file = backupFilePath(referenceId);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBackup(referenceId: string, logs: Record<string, unknown>[]) {
  ensureDir();
  fs.writeFileSync(backupFilePath(referenceId), JSON.stringify(logs, null, 2), "utf-8");
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    ensureDir();

    // -- GET: fetch all backup logs for a user ------------------------------
    if (req.method === "GET") {
      const ref = req.query.ref as string | undefined;
      if (!ref) return res.status(400).json({ error: "Missing ref" });
      const logs = readBackup(ref);
      return res.status(200).json({ logs });
    }

    // -- POST: upsert a pending log -----------------------------------------
    if (req.method === "POST") {
      const { id, referenceId, payload, createdAt, retries } = req.body ?? {};
      if (!id || !referenceId) {
        return res.status(400).json({ error: "Missing id or referenceId" });
      }

      const logs = readBackup(referenceId);
      const idx = logs.findIndex((l: any) => l.id === id);
      const entry = { id, referenceId, payload, createdAt, retries: retries ?? 0 };

      if (idx >= 0) {
        logs[idx] = entry; // update existing
      } else {
        logs.push(entry);  // add new
      }

      writeBackup(referenceId, logs);
      return res.status(200).json({ ok: true });
    }

    // -- DELETE: remove a synced log ----------------------------------------
    if (req.method === "DELETE") {
      const id = req.query.id as string | undefined;
      const ref = req.query.ref as string | undefined;
      if (!id || !ref) return res.status(400).json({ error: "Missing id or ref" });

      const logs = readBackup(ref);
      const filtered = logs.filter((l: any) => l.id !== id);
      writeBackup(ref, filtered);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", ["GET", "POST", "DELETE"]);
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error("[offline-backup] Error:", err);
    return res.status(500).json({ error: err?.message || "Internal error" });
  }
}
