// Vitest stand-in for `expo-crypto` (Checkpoint 9.5): the real module reads
// the React Native `__DEV__` global at import and cannot load under vitest.
// Only `randomUUID` is used in this app (capture composer, new-event screen).
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
