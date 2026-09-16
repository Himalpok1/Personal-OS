import { describe, expect, it } from "vitest";
import { stripHtmlToPlainText, truncateProviderString } from "./provider-strings.js";

describe("truncateProviderString", () => {
  it("returns null for null and undefined so a nullable field passes through", () => {
    expect(truncateProviderString(null, 10)).toBeNull();
    expect(truncateProviderString(undefined, 10)).toBeNull();
  });

  it("distinguishes an empty string from an absent one", () => {
    expect(truncateProviderString("", 10)).toBe("");
    expect(truncateProviderString(null, 10)).toBeNull();
  });

  it("leaves a string under the bound untouched", () => {
    expect(truncateProviderString("hello", 10)).toBe("hello");
  });

  it("leaves a string at exactly the bound untouched", () => {
    expect(truncateProviderString("exactly-10", 10)).toBe("exactly-10");
    expect(truncateProviderString("exactly-10", 10)?.length).toBe(10);
  });

  it("truncates a string exactly one over the bound", () => {
    expect(truncateProviderString("exactly-10x", 10)).toBe("exactly-10");
  });

  it("truncates a string well over the bound", () => {
    expect(truncateProviderString("abcdefghijk", 5)).toBe("abcde");
  });

  it("never splits a surrogate pair straddling the cut point", () => {
    // "ab" + rocket emoji (a single code point that is 2 UTF-16 code units).
    // Cutting at index 3 would leave a lone high surrogate, which is invalid
    // UTF-8 and which Postgres rejects with 'invalid byte sequence for
    // encoding "UTF8"'.
    const value = "ab\u{1F680}cd";
    expect(value.length).toBe(6); // a, b, hi-surrogate, lo-surrogate, c, d
    const cut = truncateProviderString(value, 3);
    expect(cut).toBe("ab");
    for (const ch of cut ?? "") {
      const code = ch.charCodeAt(0);
      expect(code >= 0xd800 && code <= 0xdfff).toBe(false);
    }
  });

  it("keeps a whole surrogate pair when the cut lands exactly after it", () => {
    expect(truncateProviderString("ab\u{1F680}", 4)).toBe("ab\u{1F680}");
  });

  it("returns an empty string for a non-positive bound", () => {
    expect(truncateProviderString("abc", 0)).toBe("");
    expect(truncateProviderString("abc", -1)).toBe("");
  });
});

describe("stripHtmlToPlainText", () => {
  it("returns null for null and undefined", () => {
    expect(stripHtmlToPlainText(null)).toBeNull();
    expect(stripHtmlToPlainText(undefined)).toBeNull();
  });

  it("returns empty string, not null, for a message that is only markup", () => {
    expect(stripHtmlToPlainText("<p></p>")).toBe("");
  });

  it("passes plain text through unchanged", () => {
    expect(stripHtmlToPlainText("No due date changes this week.")).toBe(
      "No due date changes this week.",
    );
  });

  it("strips a realistic Canvas announcement shape: nested divs, a link, entities", () => {
    const html =
      "<div><p>Reminder: the midterm is <strong>Thursday</strong> &amp; covers " +
      'chapters 1-5. See the <a href="https://uta.instructure.com/syllabus">syllabus</a> ' +
      'for details.</p><div class="attachment"><p>&quot;Bring a calculator,&quot; ' +
      "the professor said. It&#39;s required.</p></div></div>";
    expect(stripHtmlToPlainText(html)).toBe(
      "Reminder: the midterm is Thursday & covers chapters 1-5. See the syllabus " +
        'for details. "Bring a calculator," the professor said. It\'s required.',
    );
  });

  it("collapses newlines and repeated whitespace to single spaces", () => {
    expect(stripHtmlToPlainText("<p>Line one.</p>\n\n<p>Line   two.</p>")).toBe(
      "Line one. Line two.",
    );
  });

  it("decodes &nbsp; to a plain space rather than leaving the entity", () => {
    expect(stripHtmlToPlainText("Office&nbsp;hours moved.")).toBe("Office hours moved.");
  });

  it("trims leading and trailing whitespace produced by stripped tags", () => {
    expect(stripHtmlToPlainText("<p>Hello.</p>")).toBe("Hello.");
  });

  it("does not decode an entity it does not recognize", () => {
    expect(stripHtmlToPlainText("Caf&eacute; hours")).toBe("Caf&eacute; hours");
  });
});
