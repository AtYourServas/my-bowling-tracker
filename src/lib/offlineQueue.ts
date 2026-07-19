import { openDB, type IDBPDatabase } from 'idb';

/**
 * Offline write queue + reference-data cache for the game page's shot logger
 * (GameLogger.tsx). Browser-only (IndexedDB) -- every export here must only
 * ever be called from a useEffect/event handler, never during SSR render.
 */

const DB_NAME = 'bowling-offline';
const DB_VERSION = 1;
const WRITE_QUEUE_STORE = 'writeQueue';
const REFERENCE_CACHE_STORE = 'referenceCache';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(WRITE_QUEUE_STORE)) {
          db.createObjectStore(WRITE_QUEUE_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(REFERENCE_CACHE_STORE)) {
          db.createObjectStore(REFERENCE_CACHE_STORE, { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
}

type QueuedShotWrite = {
  id: string;
  kind: 'log_shot' | 'log_shorthand';
  gameId: string;
  frameNumber: number;
  url: string;
  fields: Record<string, string>;
  /** A pre-built ClientShotRow (GameLogger.tsx) for instant UI + rehydration after a reload. */
  optimisticShot: unknown;
  createdAt: number;
};

type QueuedApproachWrite = {
  id: string;
  kind: 'save_as_approach';
  gameId: string;
  url: string;
  fields: Record<string, string>;
  /** A pre-built Approach (GameLogger.tsx/ShotForm.tsx) for instant UI. */
  optimisticApproach: unknown;
  createdAt: number;
};

export type QueuedWrite = QueuedShotWrite | QueuedApproachWrite;

export async function enqueueWrite(write: QueuedWrite): Promise<void> {
  const db = await getDb();
  await db.put(WRITE_QUEUE_STORE, write);
}

/** All queued writes for one game, oldest first -- the order they must be replayed in. */
export async function listQueuedWrites(gameId: string): Promise<QueuedWrite[]> {
  const db = await getDb();
  const all = (await db.getAll(WRITE_QUEUE_STORE)) as QueuedWrite[];
  return all.filter((w) => w.gameId === gameId).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedWrite(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(WRITE_QUEUE_STORE, id);
}

/** Whether any write, for any game, is still waiting to sync -- used to gate the logout cleanup. */
export async function hasQueuedWrites(): Promise<boolean> {
  const db = await getDb();
  const count = await db.count(WRITE_QUEUE_STORE);
  return count > 0;
}

/**
 * Wipes both stores (called on logout, only once `hasQueuedWrites()` is
 * false -- never discards an unsynced write).
 */
export async function clearAllOfflineData(): Promise<void> {
  const db = await getDb();
  await db.clear(WRITE_QUEUE_STORE);
  await db.clear(REFERENCE_CACHE_STORE);
}

/**
 * Reference data (balls/approaches/profile defaults) the game page's shot
 * logger depends on -- cached here on every successful mount so a future
 * offline page-load (Phase 3's service worker) has something to seed the
 * picker with. Nothing reads this back yet; Phase 2's job is only to make
 * sure it's there when Phase 3 needs it.
 */
export async function cacheReferenceData(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.put(REFERENCE_CACHE_STORE, { key, value, updatedAt: Date.now() });
}
