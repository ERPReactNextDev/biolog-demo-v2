// lib/offline-store.ts
// IndexedDB-based offline queue for activity logs
// + server-side JSON file backup as second durability layer

const DB_NAME    = "acculog-offline";
const DB_VERSION = 2;
const STORE_NAME = "pending-logs";

// -- Global sync lock ----------------------------------------------------------
let _globalSyncLocked = false;

export function acquireSyncLock(): boolean {
  if (_globalSyncLocked) return false;
  _globalSyncLocked = true;
  return true;
}
export function releaseSyncLock(): void { _globalSyncLocked = false; }
export function isSyncLocked(): boolean { return _globalSyncLocked; }
/** @internal test use only */
export function resetSyncLock(): void { _globalSyncLocked = false; }

export interface PendingLog {
  id: string;
  payload: Record<string, unknown>;
  createdAt: number;
  retries: number;
}

// -- Generic CRUD record shape -------------------------------------------------
export interface StoreRecord<T> {
  _key: string;
  _value: T;
  _version: number;
  _createdAt: number;
  _expiresAt: number | null;
}

// -- DB helper -----------------------------------------------------------------
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("cached-api-responses")) {
        db.createObjectStore("cached-api-responses", { keyPath: "_key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}

// -- Backup helpers ------------------------------------------------------------
// Extract ReferenceID from a log payload for per-user backup files.
function getReferenceId(payload: Record<string, unknown>): string | null {
  const ref = payload.ReferenceID;
  return typeof ref === "string" && ref.trim() ? ref.trim() : null;
}

/** Fire-and-forget: write a log entry to the server-side JSON backup. */
function backupToServer(entry: PendingLog): void {
  const ref = getReferenceId(entry.payload);
  if (!ref) return;

  fetch("/api/offline-backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id:          entry.id,
      referenceId: ref,
      payload:     entry.payload,
      createdAt:   entry.createdAt,
      retries:     entry.retries,
    }),
  }).catch(() => {
    // Non-critical - IndexedDB remains the primary store.
    // If the server is unreachable (truly offline) this is expected.
  });
}

/** Fire-and-forget: remove a synced log from the server-side JSON backup. */
function removeBackup(id: string, payload: Record<string, unknown>): void {
  const ref = getReferenceId(payload);
  if (!ref) return;

  fetch(`/api/offline-backup?id=${encodeURIComponent(id)}&ref=${encodeURIComponent(ref)}`, {
    method: "DELETE",
  }).catch(() => { /* non-critical */ });
}

// -- Public API ----------------------------------------------------------------

/** Add a log payload to the offline queue. Returns the generated id. */
export async function enqueuePendingLog(
  payload: Record<string, unknown>
): Promise<string> {
  const db  = await openDB();
  const id  = `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();

  const stampedPayload = {
    ...payload,
    date_created: payload.date_created ?? new Date(now).toISOString(),
  };

  const entry: PendingLog = { id, payload: stampedPayload, createdAt: now, retries: 0 };

  await new Promise<void>((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.add(entry);

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });

  // Second layer: also write to server-side JSON backup
  backupToServer(entry);

  return id;
}

/** Return all queued logs sorted oldest-first. */
export async function getAllPendingLogs(): Promise<PendingLog[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.getAll();

    tx.oncomplete = () => db.close();
    req.onsuccess = () => {
      resolve(
        (req.result as PendingLog[]).sort((a, b) => a.createdAt - b.createdAt)
      );
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

/** Remove a successfully-synced log from both IndexedDB and the server backup. */
export async function removePendingLog(id: string): Promise<void> {
  // We need the payload to know the referenceId for backup removal.
  // Read first, then delete.
  let payload: Record<string, unknown> | null = null;
  try {
    const db = await openDB();
    payload = await new Promise<Record<string, unknown> | null>((resolve) => {
      const tx    = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req   = store.get(id);
      req.onsuccess = () => {
        db.close();
        const entry = req.result as PendingLog | undefined;
        resolve(entry?.payload ?? null);
      };
      req.onerror = () => { db.close(); resolve(null); };
    });
  } catch { /* continue to delete even if read fails */ }

  // Delete from IndexedDB
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.delete(id);

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });

  // Remove from server backup (fire-and-forget)
  if (payload) removeBackup(id, payload);
}

/** Bump the retry counter for a failed log. */
export async function incrementRetry(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx     = db.transaction(STORE_NAME, "readwrite");
    const store  = tx.objectStore(STORE_NAME);
    const getReq = store.get(id);

    getReq.onsuccess = () => {
      const entry = getReq.result as PendingLog | undefined;
      if (!entry) { resolve(); return; }
      entry.retries += 1;
      const putReq = store.put(entry);
      putReq.onerror = () => reject(putReq.error);
    };

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    getReq.onerror = () => reject(getReq.error);
  });
}

/** Return the count of queued logs without loading them all. */
export async function getPendingCount(): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.count();

    tx.oncomplete = () => db.close();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => { db.close(); reject(req.error); };
  });
}

/** Clear all pending logs from the queue (does NOT clear server backup). */
export async function clearAllPendingLogs(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req   = store.clear();

    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror    = () => { db.close(); reject(tx.error); };
    req.onerror   = () => reject(req.error);
  });
}

/**
 * Reconcile IndexedDB with the server-side JSON backup.
 * Fetches the backup for a given user and re-enqueues any logs that are
 * missing from IndexedDB (e.g. after browser cleared site data).
 * Returns the number of logs recovered.
 */
export async function reconcileFromBackup(referenceId: string): Promise<number> {
  if (!referenceId) return 0;

  let backupLogs: PendingLog[] = [];
  try {
    const res = await fetch(`/api/offline-backup?ref=${encodeURIComponent(referenceId)}`);
    if (!res.ok) return 0;
    const json = await res.json();
    backupLogs = Array.isArray(json.logs) ? json.logs : [];
  } catch {
    return 0;
  }

  if (backupLogs.length === 0) return 0;

  // Get current IDB ids
  let idbLogs: PendingLog[] = [];
  try {
    idbLogs = await getAllPendingLogs();
  } catch { /* IDB unavailable */ }

  const idbIds = new Set(idbLogs.map((l) => l.id));

  let recovered = 0;
  for (const backupEntry of backupLogs) {
    if (idbIds.has(backupEntry.id)) continue; // already in IDB

    // Re-insert the missing entry into IndexedDB
    try {
      const db = await openDB();
      await new Promise<void>((resolve) => {
        const tx    = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        // Use put (not add) to avoid duplicate key errors on concurrent calls
        store.put({
          id:        backupEntry.id,
          payload:   backupEntry.payload,
          createdAt: backupEntry.createdAt ?? Date.now(),
          retries:   backupEntry.retries ?? 0,
        });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror    = () => { db.close(); resolve(); };
      });
      recovered++;
      console.log(`[offline-store] Recovered log ${backupEntry.id} from server backup`);
    } catch { /* skip individual failures */ }
  }

  return recovered;
}

// -- Generic getItem / setItem -------------------------------------------------

export async function getItem<T>(store: string, key: string): Promise<T | null> {
  try {
    const db = await openDB();

    return new Promise<T | null>((resolve) => {
      const tx       = db.transaction(store, "readonly");
      const objStore = tx.objectStore(store);
      const req      = objStore.get(key);

      req.onsuccess = () => {
        db.close();
        const record = req.result as StoreRecord<T> | undefined;
        if (!record) { resolve(null); return; }
        if (record._expiresAt !== null && record._expiresAt <= Date.now()) {
          resolve(null);
          return;
        }
        resolve(record._value);
      };

      req.onerror = () => { db.close(); resolve(null); };
      tx.onerror  = () => { db.close(); resolve(null); };
    });
  } catch {
    return null;
  }
}

export async function setItem<T>(
  store: string,
  key: string,
  value: T,
  ttlMs?: number
): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      const readTx    = db.transaction(store, "readonly");
      const readStore = readTx.objectStore(store);
      const readReq   = readStore.get(key);

      readReq.onsuccess = () => {
        const existing    = readReq.result as StoreRecord<T> | undefined;
        const nextVersion = (existing?._version ?? 0) + 1;
        const now         = Date.now();

        const record: StoreRecord<T> = {
          _key:       key,
          _value:     value,
          _version:   nextVersion,
          _createdAt: now,
          _expiresAt: ttlMs != null ? now + ttlMs : null,
        };

        const writeTx    = db.transaction(store, "readwrite");
        const writeStore = writeTx.objectStore(store);
        writeStore.put(record);

        writeTx.oncomplete = () => { db.close(); resolve(); };
        writeTx.onerror    = () => { db.close(); resolve(); };
      };

      readTx.onerror = () => { db.close(); resolve(); };
    });
  } catch { /* silent no-op */ }
}

export async function deleteItem(store: string, key: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      const tx       = db.transaction(store, "readwrite");
      const objStore = tx.objectStore(store);
      objStore.delete(key);

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); };
    });
  } catch { /* silent no-op */ }
}

export async function getAllItems<T>(store: string): Promise<T[]> {
  try {
    const db = await openDB();

    return new Promise<T[]>((resolve) => {
      const tx       = db.transaction(store, "readonly");
      const objStore = tx.objectStore(store);
      const req      = objStore.getAll();

      req.onsuccess = () => {
        db.close();
        const now = Date.now();
        const records = req.result as StoreRecord<T>[];
        resolve(
          records
            .filter((r) => r._expiresAt === null || r._expiresAt > now)
            .map((r) => r._value)
        );
      };

      req.onerror = () => { db.close(); resolve([]); };
      tx.onerror  = () => { db.close(); resolve([]); };
    });
  } catch {
    return [];
  }
}

export async function runExpiry(store: string): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve) => {
      const tx       = db.transaction(store, "readwrite");
      const objStore = tx.objectStore(store);
      const req      = objStore.openCursor();

      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) return;
        const record = cursor.value as StoreRecord<unknown>;
        if (record._expiresAt !== null && record._expiresAt <= Date.now()) {
          cursor.delete();
        }
        cursor.continue();
      };

      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); resolve(); };
    });
  } catch { /* silent no-op */ }
}

export async function withTransaction(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void
): Promise<void> {
  try {
    const db = await openDB();

    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
      fn(tx);
    });
  } catch { /* silent no-op */ }
}
