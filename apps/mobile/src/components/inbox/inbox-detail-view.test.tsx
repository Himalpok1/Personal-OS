import { ENTITY_TITLE_MAX_CHARS, type InboxItem } from "@personal-os/schema";
import { ApiClientError } from "@personal-os/api-client";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_FILE_AS_DRAFT, type FileAsDraft } from "./build-correction";
import { InboxDetailView, type InboxDetailViewProps } from "./inbox-detail-view";

// datetime-field.tsx imports @expo/ui/jetpack-compose, which is Android-only
// and cannot load under the mobile vitest transform (see
// datetime-field-state.ts). The view is what is under test; the picker is a
// leaf whose props are asserted directly.
vi.mock("@/components/datetime-field", () => ({
  DateTimeField: (props: { testID?: string; label: string; value: string | null }) => ({
    type: "MockDateTimeField",
    props,
  }),
}));

// Same hand-rolled render walk every render-style test in this app uses --
// see components/brief/brief-card.test.tsx for the full explanation. No render
// library exists in apps/mobile's dependencies; app-defined function
// components are expanded, react-native's own host components are leaves.
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, TextInput, ActivityIndicator]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;
  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    return deepRender((el.type as (props: unknown) => unknown)(el.props ?? {}));
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

function byTestId(node: unknown, testID: string): any {
  return findAll(node, (n) => n.props?.testID === testID)[0];
}

function text(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const el = node as { props?: { children?: unknown } };
  return el.props?.children !== undefined ? text(el.props.children) : "";
}

const ID = "11111111-1111-4111-8111-111111111111";
const ENTITY = "22222222-2222-4222-8222-222222222222";

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ID,
    client_uuid: null,
    raw_text: "call the insurance guy tomorrow",
    source: "web",
    captured_at: "2026-09-13T15:00:00.000Z",
    timezone: "America/Chicago",
    status: "needs_confirm",
    parse_result: null,
    confidence: null,
    entity_type: null,
    entity_id: null,
    archived_at: null,
    created_at: "2026-09-13T15:00:00.000Z",
    ...overrides,
  };
}

const UNCLEAR = {
  toolCall: { tool: "unclear", args: { reason: "no verb" } },
  confidenceFlags: ["modelUnclear"],
};
const TASK = {
  toolCall: { tool: "create_task", args: { title: "Call the insurance guy" } },
  confidenceFlags: ["unresolvedDatePhrase"],
};

function render(overrides: Partial<InboxDetailViewProps> = {}) {
  const props: InboxDetailViewProps = {
    item: item(),
    draft: EMPTY_FILE_AS_DRAFT,
    onDraftChange: vi.fn(),
    onChooseKind: vi.fn(),
    confirm: { isPending: false, isError: false, error: null },
    awaitingCommit: false,
    commitPollExhausted: false,
    dismiss: { isPending: false, isError: false },
    onConfirmStored: vi.fn(),
    onFile: vi.fn(),
    onDismiss: vi.fn(),
    onOpenEntity: vi.fn(),
    timezone: "America/Chicago",
    ...overrides,
  };
  return { props, tree: deepRender(InboxDetailView(props)) };
}

describe("InboxDetailView -- the capture and its parse result", () => {
  it("renders the raw text, source, status and a human-readable summary -- never JSON", () => {
    const { tree } = render({ item: item({ parse_result: TASK }) });
    expect(text(byTestId(tree, "inbox-detail-raw-text"))).toBe("call the insurance guy tomorrow");
    expect(text(byTestId(tree, "inbox-detail-meta"))).toContain("Quick capture");
    expect(text(byTestId(tree, "inbox-detail-meta"))).toContain("Needs confirmation");
    const lines = findAll(tree, (n) => n.props?.testID === "inbox-detail-summary-line").map(text);
    expect(lines[0]).toBe("Task: Call the insurance guy");
    expect(lines.join("\n")).not.toContain("{");
    expect(lines.join("\n")).not.toContain("toolCall");
  });

  it("says a pending item is not parsed yet", () => {
    const { tree } = render({ item: item({ status: "pending" }) });
    expect(text(byTestId(tree, "inbox-detail-summary-empty"))).toBe("Not parsed yet.");
    // Nothing to confirm or file while the parser has not answered.
    expect(byTestId(tree, "inbox-detail-confirm-stored")).toBeUndefined();
    expect(byTestId(tree, "inbox-detail-kind-task")).toBeUndefined();
  });
});

describe("InboxDetailView -- a committed item taps through to its entity", () => {
  it.each([
    ["task", `/tasks/${ENTITY}`],
    ["note", `/notes/${ENTITY}`],
    ["event", `/events/${ENTITY}`],
  ] as const)("offers Open %s and routes by entity_type + entity_id only", (entityType, route) => {
    const { props, tree } = render({
      item: item({
        status: "parsed",
        entity_type: entityType,
        entity_id: ENTITY,
        parse_result: TASK,
      }),
    });
    const open = byTestId(tree, "inbox-detail-open-entity");
    expect(text(open)).toBe(`Open ${entityType}`);
    open.props.onPress();
    expect(props.onOpenEntity).toHaveBeenCalledWith(route);
    // A filed item shows no File-as controls.
    expect(byTestId(tree, "inbox-detail-kind-task")).toBeUndefined();
  });
});

describe("InboxDetailView -- filing a needs_confirm or failed item", () => {
  it("offers Confirm as parsed only when the stored call is committable", () => {
    expect(
      byTestId(render({ item: item({ parse_result: TASK }) }).tree, "inbox-detail-confirm-stored"),
    ).toBeDefined();
    expect(
      byTestId(
        render({ item: item({ parse_result: UNCLEAR }) }).tree,
        "inbox-detail-confirm-stored",
      ),
    ).toBeUndefined();
  });

  it("offers File as task/note/event for needs_confirm AND failed (contract 7)", () => {
    for (const status of ["needs_confirm", "failed"] as const) {
      const { props, tree } = render({ item: item({ status, parse_result: UNCLEAR }) });
      for (const kind of ["task", "note", "event"] as const) {
        const chip = byTestId(tree, `inbox-detail-kind-${kind}`);
        expect(chip).toBeDefined();
        chip.props.onPress();
        expect(props.onChooseKind).toHaveBeenCalledWith(kind);
      }
    }
  });

  it("offers nothing to file for parsed/confirmed/pending -- the API would refuse it", () => {
    for (const status of ["parsed", "confirmed", "pending"] as const) {
      const { tree } = render({ item: item({ status }) });
      expect(byTestId(tree, "inbox-detail-kind-task")).toBeUndefined();
      expect(byTestId(tree, "inbox-detail-file-submit")).toBeUndefined();
    }
  });

  it("submits the corrected tool call built from the draft, and disables submit while unsubmittable", () => {
    const draft: FileAsDraft = {
      kind: "task",
      title: "Insurance",
      dueAt: "2026-09-14T15:00:00-05:00",
      startAt: null,
    };
    const { props, tree } = render({ item: item({ parse_result: UNCLEAR }), draft });
    const submit = byTestId(tree, "inbox-detail-file-submit");
    expect(submit.props.disabled).toBe(false);
    submit.props.onPress();
    expect(props.onFile).toHaveBeenCalledWith({
      tool: "create_task",
      args: { title: "Insurance", due_at: "2026-09-14T15:00:00-05:00" },
    });

    // An event draft with no start cannot be submitted.
    const eventDraft: FileAsDraft = { kind: "event", title: "x", dueAt: null, startAt: null };
    const unsubmittable = render({ item: item({ parse_result: UNCLEAR }), draft: eventDraft });
    const eventSubmit = byTestId(unsubmittable.tree, "inbox-detail-file-submit");
    expect(eventSubmit.props.disabled).toBe(true);
    eventSubmit.props.onPress();
    expect(unsubmittable.props.onFile).not.toHaveBeenCalled();
  });

  it("shows the right picker per kind: due for a task, start for an event, neither for a note", () => {
    const base = { title: "x", dueAt: null, startAt: null };
    const task = render({
      item: item({ parse_result: UNCLEAR }),
      draft: { ...base, kind: "task" },
    }).tree;
    expect(byTestId(task, "inbox-detail-due")).toBeDefined();
    expect(byTestId(task, "inbox-detail-start")).toBeUndefined();
    const event = render({
      item: item({ parse_result: UNCLEAR }),
      draft: { ...base, kind: "event" },
    }).tree;
    expect(byTestId(event, "inbox-detail-start")).toBeDefined();
    expect(byTestId(event, "inbox-detail-due")).toBeUndefined();
    const note = render({
      item: item({ parse_result: UNCLEAR }),
      draft: { ...base, kind: "note" },
    }).tree;
    expect(byTestId(note, "inbox-detail-due")).toBeUndefined();
    expect(byTestId(note, "inbox-detail-start")).toBeUndefined();
    expect(byTestId(note, "inbox-detail-title")).toBeDefined();
  });

  it("bounds the title input at the server's constant and shows the counter only near it (9.6)", () => {
    const short: FileAsDraft = { kind: "task", title: "x", dueAt: null, startAt: null };
    const quiet = render({ item: item({ parse_result: UNCLEAR }), draft: short }).tree;
    expect(byTestId(quiet, "inbox-detail-title").props.maxLength).toBe(ENTITY_TITLE_MAX_CHARS);
    expect(byTestId(quiet, "inbox-detail-title-counter")).toBeUndefined();
    const nearly: FileAsDraft = { ...short, title: "t".repeat(ENTITY_TITLE_MAX_CHARS - 3) };
    const loud = render({ item: item({ parse_result: UNCLEAR }), draft: nearly }).tree;
    expect(text(byTestId(loud, "inbox-detail-title-counter"))).toBe("509 / 512");
  });

  it("edits flow back through onDraftChange, never into local state", () => {
    const draft: FileAsDraft = { kind: "task", title: "x", dueAt: null, startAt: null };
    const { props, tree } = render({ item: item({ parse_result: UNCLEAR }), draft });
    byTestId(tree, "inbox-detail-title").props.onChangeText("Edited");
    expect(props.onDraftChange).toHaveBeenCalledWith({ title: "Edited" });
    byTestId(tree, "inbox-detail-due").props.onChange("2026-09-14T15:00:00-05:00");
    expect(props.onDraftChange).toHaveBeenCalledWith({ dueAt: "2026-09-14T15:00:00-05:00" });
  });

  it("renders every closed 409 code from confirm-state as its own copy, never the raw code", () => {
    for (const code of [
      "parse_result_not_committable",
      "parse_result_unreadable",
      "not_awaiting_confirmation",
      "job_queue_unavailable",
      "not_found",
    ]) {
      const { tree } = render({
        item: item({ parse_result: UNCLEAR }),
        confirm: { isPending: false, isError: true, error: new ApiClientError(409, code) },
      });
      const message = text(byTestId(tree, "inbox-detail-confirm-error"));
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
      expect(message).not.toContain("409");
    }
  });

  it("disables the controls while a confirm is in flight or being committed, and says so", () => {
    const draft: FileAsDraft = { kind: "task", title: "x", dueAt: null, startAt: null };
    const { tree } = render({ item: item({ parse_result: TASK }), draft, awaitingCommit: true });
    expect(byTestId(tree, "inbox-detail-confirm-stored").props.disabled).toBe(true);
    expect(byTestId(tree, "inbox-detail-file-submit").props.disabled).toBe(true);
    expect(byTestId(tree, "inbox-detail-kind-task").props.disabled).toBe(true);
    expect(byTestId(tree, "inbox-detail-awaiting")).toBeDefined();

    const exhausted = render({
      item: item({ parse_result: TASK }),
      commitPollExhausted: true,
    }).tree;
    expect(byTestId(exhausted, "inbox-detail-poll-exhausted")).toBeDefined();
  });
});

describe("InboxDetailView -- dismiss", () => {
  it("is offered for every status, calls onDismiss, and surfaces a failure", () => {
    for (const status of ["pending", "parsed", "needs_confirm", "confirmed", "failed"] as const) {
      const { props, tree } = render({ item: item({ status }) });
      const dismiss = byTestId(tree, "inbox-detail-dismiss");
      expect(dismiss).toBeDefined();
      dismiss.props.onPress();
      expect(props.onDismiss).toHaveBeenCalledTimes(1);
    }
    const failed = render({ dismiss: { isPending: false, isError: true } }).tree;
    expect(text(byTestId(failed, "inbox-detail-dismiss-error"))).toContain("Couldn't dismiss");
  });
});

describe("InboxDetailView -- nothing is interpreted", () => {
  it("puts URL- and path-shaped capture text into a plain <Text> and derives no route from it", () => {
    const hostile = "https://evil.example/../tasks/x <b>bold</b>";
    const { props, tree } = render({ item: item({ raw_text: hostile, parse_result: UNCLEAR }) });
    const raw = byTestId(tree, "inbox-detail-raw-text");
    expect(raw.type).toBe(Text);
    expect(text(raw)).toBe(hostile);
    expect(raw.props.dataDetectorTypes).toBeUndefined();
    expect(byTestId(tree, "inbox-detail-open-entity")).toBeUndefined();
    expect(props.onOpenEntity).not.toHaveBeenCalled();
  });
});
