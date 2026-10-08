/** Short random token used as the ID prefix for one command or gesture. */
export function newIdPrefix(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export function newDocumentId(): string {
  return globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID() : `doc-${newIdPrefix()}${newIdPrefix()}`;
}
