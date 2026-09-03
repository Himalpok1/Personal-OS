/**
 * A launch that means "the owner wants to capture something".
 *
 * Two Android front doors produce one of these, and they differ only in
 * whether text came with them:
 *
 *  - `share`   -- the system share sheet handed us text/plain from another
 *                 app. `text` is that text, and it is UNTRUSTED.
 *  - `compose` -- the launcher shortcut. `text` is always empty; the owner
 *                 is about to type.
 *
 * `id` is minted natively when the intent is FIRST observed and is stable
 * across both delivery paths (the warm-start event and the cold-start
 * getter), so the same launch seen twice carries the same id. That is what
 * makes de-duplication possible: the capture pipeline dedupes on
 * `client_uuid`, and a fresh random uuid per read would defeat it entirely.
 */
export type CaptureIntentKind = "share" | "compose";

export interface CaptureIntent {
  kind: CaptureIntentKind;
  text: string;
  id: string;
}

export type CaptureIntentEvents = {
  onCaptureIntent: (payload: CaptureIntent) => void;
};
