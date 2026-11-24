/**
 * When to gently suggest downloading a backup. Projects live only in this
 * browser, so after real work (many saved edits) or a day without a backup
 * the editor offers one. Dismissing snoozes it for days; it never nags.
 */

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const REMINDER_EDITS = 40;
export const REMINDER_AFTER_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 3 * REMINDER_AFTER_MS;

const KEY = "floorplan-backup-reminder";

interface State {
  /** Saved edits since the last backup. */
  edits: number;
  /** When work first went unbacked-up (ms), or null when everything is backed up. */
  dirtySince: number | null;
  lastBackupAt: number | null;
  snoozedUntil: number;
}

const FRESH: State = { edits: 0, dirtySince: null, lastBackupAt: null, snoozedUntil: 0 };

const defaultStore = (): KeyValueStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

function read(store: KeyValueStore | null): State {
  try {
    const raw = store?.getItem(KEY);
    return raw ? { ...FRESH, ...(JSON.parse(raw) as Partial<State>) } : { ...FRESH };
  } catch {
    return { ...FRESH };
  }
}

function write(store: KeyValueStore | null, state: State) {
  try {
    store?.setItem(KEY, JSON.stringify(state));
  } catch {
    // The reminder is a nicety; a full or blocked store just means no reminder.
  }
}

/** One edit was saved. */
export function recordEdit(now = Date.now(), store: KeyValueStore | null = defaultStore()) {
  const s = read(store);
  write(store, { ...s, edits: s.edits + 1, dirtySince: s.dirtySince ?? now });
}

/** A backup file was downloaded. */
export function recordBackup(now = Date.now(), store: KeyValueStore | null = defaultStore()) {
  write(store, { ...FRESH, lastBackupAt: now });
}

/** "Not now": stay quiet for a few days. */
export function snoozeReminder(now = Date.now(), store: KeyValueStore | null = defaultStore()) {
  write(store, { ...read(store), snoozedUntil: now + SNOOZE_MS });
}

export function shouldRemind(now = Date.now(), store: KeyValueStore | null = defaultStore()): boolean {
  const s = read(store);
  if (now < s.snoozedUntil || s.dirtySince === null) return false;
  return s.edits >= REMINDER_EDITS || now - s.dirtySince >= REMINDER_AFTER_MS;
}
