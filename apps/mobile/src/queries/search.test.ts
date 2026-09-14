import { describe, expect, it } from "vitest";
import { isSearchResponseStale } from "./search";

// Pure: the stale predicate the search screen uses to decide whether the
// response on screen answers the query in the field (Checkpoint 9.6 review).
describe("isSearchResponseStale", () => {
  const settled = { typed: "rent", debounced: "rent", isPlaceholderData: false, isFetching: false };

  it("is false once the debounce has caught up, the data is this query's, and nothing is in flight", () => {
    expect(isSearchResponseStale(settled)).toBe(false);
  });

  it("is true while the typed text differs from the debounced query", () => {
    expect(isSearchResponseStale({ ...settled, typed: "rental" })).toBe(true);
  });

  it("compares the TRIMMED typed text, so a trailing space is not a new query", () => {
    expect(isSearchResponseStale({ ...settled, typed: "rent " })).toBe(false);
  });

  it("is true while the list is the previous query's placeholder data", () => {
    expect(isSearchResponseStale({ ...settled, isPlaceholderData: true })).toBe(true);
  });

  it("is true while a request is in flight", () => {
    expect(isSearchResponseStale({ ...settled, isFetching: true })).toBe(true);
  });
});
