/**
 * Asks the browser not to evict this site's data under storage pressure.
 * Resolves true when storage is (now) persistent; false when refused or unsupported.
 */
export async function requestPersistentStorage(storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage): Promise<boolean> {
  if (!storage?.persist) return false;
  try {
    if (storage.persisted && (await storage.persisted())) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
