// 記録の端末保存（IndexedDB）。通信が途切れても、再読み込みしても、足あとが残る。
// 設計書 docs/design/02_track_recorder.md の KF4。プライベートウィンドウなどで使えない場合は何もしない。
import type { RoutePreset, TrackPoint } from '@core';
import type { Site } from './mapController';

export type SavedSession = {
  version: 1;
  savedAt: string;
  track: TrackPoint[];
  targetId: string;
  preset: RoutePreset;
  startMs: number;
  forcedOffline: boolean;
  base?: Site;
  targets?: Site[];
};

const DB = 'gale-eva';
const STORE = 'session';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB が使えません'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** 保存する。失敗しても画面は止めない（false を返す）。 */
export async function saveSession(s: Omit<SavedSession, 'version' | 'savedAt'>): Promise<boolean> {
  try {
    await run('readwrite', (st) => st.put({ ...s, version: 1, savedAt: new Date().toISOString() } satisfies SavedSession, KEY));
    return true;
  } catch {
    return false;
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const v = (await run('readonly', (st) => st.get(KEY))) as SavedSession | undefined;
    return v && v.version === 1 && Array.isArray(v.track) && v.track.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run('readwrite', (st) => st.delete(KEY));
  } catch {
    /* 保存できない環境では何もしない */
  }
}
