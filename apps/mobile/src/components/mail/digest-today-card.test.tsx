// Render-level tests for <MailDigestCard />.
//
// Copies brief-card.test.tsx's technique exactly, for the reason recorded
// there: this app has no render library in its dependencies, so a component is
// called directly and the plain React element tree it returns is walked. That
// only works because the two hooks the card calls are mocked below -- there is
// no live dispatcher, so any UNMOCKED hook call would throw.
//
// What these pin, above digest-card-state.test.ts's pure-logic coverage:
//   1. a cached digest's prose survives a failed generation attempt;
//   2. the "Working..." control is genuinely `disabled` (the prop, not just the
//      label), so a double-tap cannot fire two generations;
//   3. the two setup states offer no dead-end button;
//   4. no model prose is rendered anywhere except through the clamp.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCurrentMailDigest, useGenerateMailDigest } from "@/queries/mail";
import { ClampedText } from "@/components/ui";
import { DIGEST_COLLAPSED_LINES, MailDigestCard } from "./digest-today-card";

vi.mock("@/queries/mail", () => ({
  useCurrentMailDigest: vi.fn(),
  useGenerateMailDigest: vi.fn(),
}));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function isClassComponentType(
  type: unknown,
): type is new (props: unknown) => { render: () => unknown } {
  return (
    typeof type === "function" &&
    typeof (type as { prototype?: unknown }).prototype === "object" &&
    (type as { prototype: { isReactComponent?: unknown } }).prototype.isReactComponent != null
  );
}

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;

  if (isClassComponentType(el.type)) {
    const instance = new el.type(el.props ?? {});
    return deepRender(instance.render());
  }

  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    const rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    return deepRender(rendered);
  }

  if (el.props && "children" in el.props) {
    return { ...el, props: { ...el.props, children: deepRender(el.props.children) } };
  }
  return el;
}

function findAll(node: unknown, predicate: (n: any) => boolean, acc: any[] = []): any[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) {
    const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
    for (const child of children) findAll(child, predicate, acc);
  }
  return acc;
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

function findButtons(node: unknown): any[] {
  return findAll(node, (n) => n.type === Pressable);
}

function render(): unknown {
  return deepRender(MailDigestCard());
}

const DIGEST = {
  id: "33333333-3333-4333-8333-333333333333",
  digest_date: "2026-09-01",
  timezone: "UTC",
  content: { text: "Three messages need attention, two from your bank." },
  model_id: null,
  generated_at: "2026-09-01T13:00:00Z",
};

function mockQuery(overrides: Record<string, unknown> = {}) {
  vi.mocked(useCurrentMailDigest).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { configured: true, has_active_mailbox: true, digest: null },
    ...overrides,
  } as never);
}

function mockGenerate(overrides: Record<string, unknown> = {}) {
  vi.mocked(useGenerateMailDigest).mockReturnValue({
    isPending: false,
    isSuccess: false,
    submittedAt: 0,
    error: null,
    mutate: vi.fn(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery();
  mockGenerate();
});

describe("empty states", () => {
  it("offers a Generate action when a mailbox is connected but no digest exists", () => {
    const tree = render();
    expect(getTextContent(tree)).toContain("No digest yet");
    expect(findButtons(tree)).toHaveLength(1);
  });

  it("is NOT a dead end, but offers no button when nothing is configured", () => {
    // The button could only ever return the same 409, so it is withheld -- and
    // the copy names the thing that would actually help instead.
    mockQuery({ data: { configured: false, has_active_mailbox: false, digest: null } });
    const tree = render();
    expect(getTextContent(tree)).toContain("isn't set up on this server");
    expect(findButtons(tree)).toHaveLength(0);
  });

  it("points at Settings when configured but no mailbox is connected", () => {
    // A DIFFERENT sentence from the one above: telling someone to connect a
    // mailbox when the server has no Gmail credentials would send them
    // somewhere that cannot help.
    mockQuery({ data: { configured: true, has_active_mailbox: false, digest: null } });
    const tree = render();
    expect(getTextContent(tree)).toContain("Settings");
    expect(findButtons(tree)).toHaveLength(0);
  });

  it("claims nothing about mail when it cannot reach the server", () => {
    mockQuery({ data: undefined, isError: true });
    const text = getTextContent(render());
    expect(text).toContain("Can't reach Personal OS");
    // Must not say "no digest" -- we do not know that.
    expect(text).not.toContain("No digest yet");
  });
});

describe("present", () => {
  it("renders the prose and says which day and zone it covers", () => {
    // The zone is server configuration and can differ from this device's, so
    // labelling it "today" without qualification could be wrong.
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    const text = getTextContent(render());
    expect(text).toContain("Three messages need attention");
    expect(text).toContain("Covers 2026-09-01");
    expect(text).toContain("UTC");
  });

  it("offers Regenerate", () => {
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    expect(getTextContent(render())).toContain("Regenerate");
  });
});

describe("generating", () => {
  it("DISABLES the control so a double-tap cannot fire two generations", () => {
    // The prop, not just the label -- Checkpoint 6.7A finding A1.
    mockGenerate({ isPending: true });
    const buttons = findButtons(render());
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.disabled).toBe(true);
    // Checkpoint 10.3: the design-system Button also reports `busy`, so the
    // state is matched on `disabled` rather than as an exact object.
    expect(buttons[0].props.accessibilityState).toMatchObject({ disabled: true });
  });

  it("does not claim a digest is ready", () => {
    // A 202 means the work was accepted, never that a digest exists.
    mockGenerate({ isPending: true });
    const text = getTextContent(render());
    expect(text).toContain("preparing a digest");
    expect(text).toContain("when it's ready");
  });

  it("keeps the cached prose visible while generating", () => {
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    mockGenerate({ isPending: true });
    expect(getTextContent(render())).toContain("Three messages need attention");
  });
});

describe("failure", () => {
  it("NEVER destroys the cached digest", () => {
    // The invariant the brief card established: a failed regeneration must not
    // take the still-valid content the card was already showing.
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    mockGenerate({ error: { status: 409, code: "no_provider_configured", body: {} } });
    const text = getTextContent(render());
    expect(text).toContain("Three messages need attention");
    expect(text).toContain("No AI provider is configured");
  });

  it("offers Try again for a failure the user may have just fixed", () => {
    mockGenerate({ error: { status: 409, code: "no_provider_configured", body: {} } });
    expect(getTextContent(render())).toContain("Try again");
  });

  it("shows no provider text, only fixed copy", () => {
    // The error carries a developer string; none of it may reach the screen.
    mockGenerate({
      error: {
        status: 500,
        code: "unknown_error",
        message: "API error 500: connect ECONNREFUSED 10.0.0.4:3000",
        body: { detail: "Failing row contains (...)" },
      },
    });
    const text = getTextContent(render());
    expect(text).toContain("Couldn't request a mail digest");
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("Failing row");
    expect(text).not.toContain("10.0.0.4");
  });
});

// The digest's clamp is the design system's ClampedText since Checkpoint 10.6
// (ADR-076 §3; the retired ClampedDigestText was a byte-for-byte twin of the
// Brief's). Constructed here with the digest's own budget so the invariants
// that class carried are still pinned from this card's side.
describe("ClampedText as the digest's clamp", () => {
  function clamp(text: string): ClampedText {
    return new ClampedText({ text, lines: DIGEST_COLLAPSED_LINES, textClassName: "" });
  }

  it("the present card hands its prose to ClampedText at the digest's budget", () => {
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    const clamps = findAll(MailDigestCard(), (n: any) => n.type === ClampedText);
    expect(clamps).toHaveLength(1);
    expect(clamps[0].props.lines).toBe(DIGEST_COLLAPSED_LINES);
    expect(clamps[0].props.text).toBe(DIGEST.content.text);
  });

  it("renders no toggle until a real measurement says it overflows", () => {
    // Guessing from string length is explicitly wrong: font, width and locale
    // all affect wrapping.
    const instance = clamp("short");
    expect(findButtons(deepRender(instance.render()))).toHaveLength(0);
  });

  it("shows the toggle once measurement reports more lines than the cap", () => {
    const instance = clamp("long");
    instance.state = { expanded: false, isClamped: true };
    const buttons = findButtons(deepRender(instance.render()));
    expect(buttons).toHaveLength(1);
    expect(getTextContent(buttons[0])).toBe("Show more");
  });

  it("clamps to the cap when collapsed and lifts it when expanded", () => {
    const instance = clamp("long");
    instance.state = { expanded: false, isClamped: true };

    const collapsed = findAll(deepRender(instance.render()), (n: any) => n.type === Text);
    // The visible copy carries the cap; the hidden measurement copy must not.
    expect(collapsed.some((t) => t.props.numberOfLines === DIGEST_COLLAPSED_LINES)).toBe(true);
    expect(collapsed.some((t) => t.props.numberOfLines === undefined)).toBe(true);

    instance.state = { expanded: true, isClamped: true };

    const expanded = findAll(deepRender(instance.render()), (n: any) => n.type === Text);
    expect(expanded.every((t) => t.props.numberOfLines === undefined)).toBe(true);
  });

  it("resets expansion when the text changes, so a regenerate cannot leave a stale view", () => {
    const instance = clamp("old");
    instance.state = { expanded: true, isClamped: true };
    const applied: unknown[] = [];

    (instance as any).setState = (next: unknown) => applied.push(next);
    instance.componentDidUpdate({
      text: "different",
      lines: DIGEST_COLLAPSED_LINES,
      textClassName: "",
    });
    expect(applied).toEqual([{ expanded: false, isClamped: false }]);
  });
});

describe("requested — a 202 is not a digest", () => {
  it("keeps saying the work is queued after the request succeeds", () => {
    // `isPending` ends at the 202, so without this the "preparing" copy would
    // flash for the length of an HTTP round trip and then vanish while the
    // worker had not started -- which reads as "nothing happened".
    mockGenerate({ isSuccess: true, submittedAt: Date.parse("2026-09-01T14:00:00Z") });
    const text = getTextContent(render());
    expect(text).toContain("Requested");
    expect(text).toContain("when it's ready");
  });

  it("disables the control while the request is outstanding", () => {
    mockGenerate({ isSuccess: true, submittedAt: Date.parse("2026-09-01T14:00:00Z") });
    const buttons = findButtons(render());
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.disabled).toBe(true);
  });

  it("returns to present once a digest NEWER than the request lands", () => {
    // DIGEST was generated at 13:00; a request submitted at 12:00 is superseded.
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    mockGenerate({ isSuccess: true, submittedAt: Date.parse("2026-09-01T12:00:00Z") });
    const text = getTextContent(render());
    expect(text).toContain("Three messages need attention");
    expect(text).toContain("Regenerate");
    expect(text).not.toContain("Requested");
  });

  it("still says requested when the only digest is OLDER than the request", () => {
    mockQuery({ data: { configured: true, has_active_mailbox: true, digest: DIGEST } });
    mockGenerate({ isSuccess: true, submittedAt: Date.parse("2026-09-01T14:00:00Z") });
    const text = getTextContent(render());
    expect(text).toContain("Requested");
    // ...and the previous digest stays visible rather than the card blanking.
    expect(text).toContain("Three messages need attention");
  });
});

describe("unavailable is not a dead end", () => {
  it("offers a Retry, because generating is the wrong action when we could not read", () => {
    mockQuery({ data: undefined, isError: true });
    const tree = render();
    expect(getTextContent(tree)).toContain("Retry");
    expect(findButtons(tree)).toHaveLength(1);
  });
});
