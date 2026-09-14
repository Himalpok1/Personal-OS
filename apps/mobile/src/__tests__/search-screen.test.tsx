import type { SearchDateFilter, SearchResponse, SearchResult } from "@personal-os/schema";
import { FlatList, Pressable, SafeAreaView, Text, TextInput, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import {
  SearchResultRow,
  SearchView,
  type SearchViewProps,
  type SearchViewState,
} from "@/app/search/index";

// Same hand-rolled render walk every render-style test in this app uses -- see
// components/brief/brief-card.test.tsx for the full explanation. There is no
// render library in apps/mobile's dependencies.
//
// SafeAreaView, TextInput and FlatList are added to the host set so the walk
// stops at them: FlatList in particular is a class component whose internals
// are not what these tests are about. The FlatList's `data` prop is inspected
// directly instead, which is a stronger assertion than walking its output --
// it pins exactly what the list was asked to render.
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, SafeAreaView, TextInput, FlatList]);

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

/* eslint-disable @typescript-eslint/no-explicit-any */
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

function findByTestId(node: unknown, testID: string): any {
  return findAll(node, (n) => n.props?.testID === testID)[0];
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const ID = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

const scored = { score: 0, match: { reasons: [], fields: [] } };

function taskResult(
  overrides: Partial<Extract<SearchResult, { type: "task" }>> = {},
): SearchResult {
  return {
    type: "task",
    id: ID,
    title: "Renew the insurance",
    preview: "before the 30th",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...scored,
    status: "active",
    archived: false,
    ...overrides,
  };
}

function eventResult(
  overrides: Partial<Extract<SearchResult, { type: "event" }>> = {},
): SearchResult {
  return {
    type: "event",
    id: EVENT_ID,
    title: "Insurance review",
    preview: "Room 4",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...scored,
    origin: "local",
    all_day: false,
    starts_at: "2026-09-18T12:46:00.000Z",
    start_date: null,
    is_recurring: false,
    is_detached: false,
    archived: false,
    ...overrides,
  };
}

function projectResult(
  overrides: Partial<Extract<SearchResult, { type: "project" }>> = {},
): SearchResult {
  return {
    type: "project",
    id: PROJECT_ID,
    title: "Insurance overhaul",
    preview: "Consolidate every policy",
    timestamp: "2026-08-01T00:00:00.000Z",
    ...scored,
    status: "active",
    target_date: null,
    archived: false,
    ...overrides,
  };
}

function mailResult(
  overrides: Partial<Extract<SearchResult, { type: "mail_message" }>> = {},
): SearchResult {
  return {
    type: "mail_message",
    id: "22222222-2222-4222-8222-222222222222",
    title: "Your receipt",
    preview: null,
    timestamp: "2026-08-01T00:00:00.000Z",
    ...scored,
    sender: "Widget Co",
    has_attachment: false,
    ...overrides,
  };
}

function readyResponse(
  results: SearchResult[],
  overrides: Partial<Pick<SearchResponse, "match_mode" | "date_filter" | "dropped">> = {},
): SearchResponse {
  const zero = { returned: 0, total: 0 };
  const counts = {
    task: zero,
    note: zero,
    event: zero,
    project: zero,
    inbox_item: zero,
    mail_message: zero,
  } as SearchResponse["counts"];
  for (const result of results) {
    counts[result.type] = {
      returned: counts[result.type].returned + 1,
      total: counts[result.type].total + 1,
    };
  }
  return {
    query: "insurance",
    tokens: ["insurance"],
    dropped: [],
    limit: 20,
    order: "score",
    match_mode: "all",
    date_filter: null,
    truncated: false,
    counts,
    results,
    ...overrides,
  };
}

const septemberFilter: SearchDateFilter = {
  token: "september",
  kind: "month",
  from: "2026-09-01",
  to: "2026-09-30",
  tz: "America/Chicago",
  dropped: false,
};

/** Every Text node under `node` is inert: no data detectors, no press, no href. */
function expectInertText(node: unknown): void {
  const texts = findAll(node, (n) => n.type === Text);
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text.props.dataDetectorTypes).toBeUndefined();
    expect(text.props.onPress).toBeUndefined();
    expect(text.props.href).toBeUndefined();
  }
}

function renderView(overrides: Partial<SearchViewProps> = {}): unknown {
  const props: SearchViewProps = {
    query: "insurance",
    onQueryChange: vi.fn(),
    state: { kind: "idle" } satisfies SearchViewState,
    onSelectResult: vi.fn(),
    onRetry: vi.fn(),
    placeholderColor: "#737373",
    keyboardHeight: 0,
    ...overrides,
  };
  return deepRender(SearchView(props));
}

describe("SearchView -- modeToggle (Checkpoint 8.6B)", () => {
  it("renders nothing extra when omitted -- the pre-8.6B behavior, unchanged", () => {
    const tree = renderView({});
    expect(findByTestId(tree, "ask-mode-marker")).toBeUndefined();
  });

  it("renders whatever node the caller passes, in every state", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "loading" },
      { kind: "error" },
      { kind: "ready", response: readyResponse([]) },
    ] as SearchViewState[]) {
      const tree = renderView({ state, modeToggle: <Text testID="ask-mode-marker">toggle</Text> });
      expect(findByTestId(tree, "ask-mode-marker")).toBeDefined();
    }
  });
});

describe("SearchView -- entry and query field", () => {
  it("always renders the search input, whatever the state", () => {
    for (const state of [
      { kind: "idle" },
      { kind: "loading" },
      { kind: "error" },
      { kind: "ready", response: readyResponse([]) },
    ] as SearchViewState[]) {
      expect(findByTestId(renderView({ state }), "search-input")).toBeDefined();
    }
  });

  it("focuses the field on mount and wires value/onChangeText", () => {
    const onQueryChange = vi.fn();
    const input = findByTestId(renderView({ query: "roof", onQueryChange }), "search-input");

    // autoFocus so the Rabbit's keyboard is up without a second tap.
    expect(input.props.autoFocus).toBe(true);
    expect(input.props.value).toBe("roof");
    input.props.onChangeText("roofing");
    expect(onQueryChange).toHaveBeenCalledWith("roofing");
  });

  it("names all six searchable kinds in the placeholder", () => {
    const input = findByTestId(renderView(), "search-input");
    expect(input.props.placeholder).toBe("Search tasks, notes, events, projects, inbox, mail");
  });

  it("uses the shared placeholder colour rather than a hardcoded grey", () => {
    const input = findByTestId(renderView({ placeholderColor: "#a3a3a3" }), "search-input");
    expect(input.props.placeholderTextColor).toBe("#a3a3a3");
  });

  it("never enables OS data detectors on the input", () => {
    const input = findByTestId(renderView(), "search-input");
    expect(input.props.dataDetectorTypes).toBeUndefined();
  });
});

describe("SearchView -- states", () => {
  it("IDLE: prompts for a longer query and shows no results list", () => {
    const tree = renderView({ state: { kind: "idle" } });
    expect(getTextContent(findByTestId(tree, "search-idle"))).toContain("at least 2");
    expect(findByTestId(tree, "search-results")).toBeUndefined();
  });

  it("LOADING: shows a loading line", () => {
    const tree = renderView({ state: { kind: "loading" } });
    expect(findByTestId(tree, "search-loading")).toBeDefined();
  });

  it("ERROR: shows the error and a Retry that calls back", () => {
    const onRetry = vi.fn();
    const tree = renderView({ state: { kind: "error" }, onRetry });
    expect(findByTestId(tree, "search-error")).toBeDefined();

    const retry = findByTestId(tree, "search-retry");
    expect(getTextContent(retry)).toBe("Retry");
    retry.props.onPress();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("EMPTY: distinguishes 'no matches' from 'still typing'", () => {
    const tree = renderView({ state: { kind: "ready", response: readyResponse([]) } });
    expect(findByTestId(tree, "search-empty")).toBeDefined();
    expect(findByTestId(tree, "search-idle")).toBeUndefined();
    expect(findByTestId(tree, "search-results")).toBeUndefined();
  });

  it("READY: hands the list the Top matches section first, then the rest grouped by type", () => {
    const six = [
      taskResult(),
      mailResult(),
      eventResult(),
      projectResult(),
      taskResult({ id: "55555555-5555-4555-8555-555555555555" }),
      mailResult({ id: "66666666-6666-4666-8666-666666666666" }),
    ];
    const tree = renderView({ state: { kind: "ready", response: readyResponse(six) } });
    const list = findByTestId(tree, "search-results");
    expect(list).toBeDefined();
    expect(
      list.props.data.map((row: { kind: string; type?: string | null }) =>
        row.kind === "header" ? (row.type === null ? "T" : `H:${row.type}`) : "R",
      ),
    ).toEqual(["T", "R", "R", "R", "R", "R", "H:mail_message", "R"]);
  });

  it("READY: with five or fewer results there is only the Top matches section", () => {
    const tree = renderView({
      state: { kind: "ready", response: readyResponse([taskResult(), mailResult()]) },
    });
    const list = findByTestId(tree, "search-results");
    expect(list.props.data.filter((row: { kind: string }) => row.kind === "header")).toHaveLength(
      1,
    );
    // The mixed header carries no count -- it would only restate its length.
    const header = deepRender(list.props.renderItem({ item: list.props.data[0] }));
    expect(getTextContent(header)).toBe("Top matches");
  });

  it("READY: a capped per-type header counts the rows UNDER it, then the honest returned/total", () => {
    // Six mail results, five of them in Top matches: the header sits over ONE
    // row. The old copy, "Mail (6 of 298)", was a lie about the rows beneath.
    const response = readyResponse([
      ...Array.from({ length: 6 }, (_, i) =>
        mailResult({ id: `77777777-7777-4777-8777-77777777777${i}` }),
      ),
    ]);
    response.counts.mail_message = { returned: 6, total: 298 };
    const list = findByTestId(renderView({ state: { kind: "ready", response } }), "search-results");
    const typeHeader = list.props.data.find(
      (row: { kind: string; type?: string | null }) =>
        row.kind === "header" && row.type === "mail_message",
    );
    const header = deepRender(list.props.renderItem({ item: typeHeader }));
    expect(getTextContent(header)).toBe("Mail (1 more · 6 of 298 matched)");
    // Screen readers land on section headers as headers.
    expect(findAll(header, (n) => n.type === Text)[0].props.accessibilityRole).toBe("header");
  });

  it("READY: an uncapped per-type header says only how many more rows sit under it", () => {
    const response = readyResponse([
      ...Array.from({ length: 8 }, (_, i) =>
        mailResult({ id: `77777777-7777-4777-8777-77777777777${i}` }),
      ),
    ]);
    const list = findByTestId(renderView({ state: { kind: "ready", response } }), "search-results");
    const typeHeader = list.props.data.find(
      (row: { kind: string; type?: string | null }) =>
        row.kind === "header" && row.type === "mail_message",
    );
    expect(getTextContent(deepRender(list.props.renderItem({ item: typeHeader })))).toBe(
      "Mail (3 more)",
    );
  });

  it("STALE: shows 'Updating…' above the list and withholds the previous response's banner and chip", () => {
    const response = readyResponse([taskResult()], {
      match_mode: "any",
      date_filter: septemberFilter,
    });
    const stale = renderView({ state: { kind: "ready", response }, stale: true });
    const notes = deepRender(findByTestId(stale, "search-results").props.ListHeaderComponent);
    expect(getTextContent(findByTestId(notes, "search-updating"))).toBe("Updating…");
    expect(findByTestId(notes, "search-match-banner")).toBeUndefined();
    expect(findByTestId(notes, "search-date-chip")).toBeUndefined();
    // The previous list itself stays on screen -- nothing flashes back to "Searching...".
    expect(findByTestId(stale, "search-loading")).toBeUndefined();

    const current = renderView({ state: { kind: "ready", response }, stale: false });
    const currentNotes = deepRender(
      findByTestId(current, "search-results").props.ListHeaderComponent,
    );
    expect(findByTestId(currentNotes, "search-updating")).toBeUndefined();
    expect(findByTestId(currentNotes, "search-match-banner")).toBeDefined();
    expect(findByTestId(currentNotes, "search-date-chip")).toBeDefined();
  });

  it("STALE + EMPTY: a previous query's 'No matches.' is not asserted about the typed one", () => {
    const tree = renderView({
      state: { kind: "ready", response: readyResponse([], { date_filter: septemberFilter }) },
      stale: true,
    });
    const empty = findByTestId(tree, "search-empty");
    expect(getTextContent(findByTestId(empty, "search-updating"))).toBe("Updating…");
    expect(getTextContent(empty)).not.toContain("No matches.");
    expect(findByTestId(empty, "search-date-chip")).toBeUndefined();
  });

  it("READY: shows the partial-matches banner ONLY on the `any` rung", () => {
    const partial = renderView({
      state: {
        kind: "ready",
        response: readyResponse([taskResult()], { match_mode: "any" }),
      },
    });
    const list = findByTestId(partial, "search-results");
    const notes = deepRender(list.props.ListHeaderComponent);
    expect(getTextContent(findByTestId(notes, "search-match-banner"))).toBe(
      "No exact matches — showing partial matches",
    );
    expectInertText(notes);

    const exact = renderView({ state: { kind: "ready", response: readyResponse([taskResult()]) } });
    const exactNotes = deepRender(findByTestId(exact, "search-results").props.ListHeaderComponent);
    expect(findByTestId(exactNotes, "search-match-banner")).toBeUndefined();
  });

  it("READY: shows the date-window chip, and 'ignored' when the server dropped it", () => {
    const applied = renderView({
      state: {
        kind: "ready",
        response: readyResponse([taskResult()], { date_filter: septemberFilter }),
      },
    });
    const notes = deepRender(findByTestId(applied, "search-results").props.ListHeaderComponent);
    const chip = getTextContent(findByTestId(notes, "search-date-chip"));
    expect(chip).toMatch(/^In /);
    expect(chip).toContain("2026");

    const dropped = renderView({
      state: {
        kind: "ready",
        response: readyResponse([taskResult()], {
          match_mode: "all_without_date",
          date_filter: { ...septemberFilter, dropped: true },
        }),
      },
    });
    const droppedNotes = deepRender(
      findByTestId(dropped, "search-results").props.ListHeaderComponent,
    );
    expect(getTextContent(findByTestId(droppedNotes, "search-date-chip"))).toBe(
      "Date ignored — no matches in that range",
    );
  });

  it("READY: names the query words the server dropped, under the date chip, and nothing when none were", () => {
    const tree = renderView({
      state: {
        kind: "ready",
        response: readyResponse([taskResult()], {
          date_filter: septemberFilter,
          dropped: ["ninth", "tenth"],
        }),
      },
    });
    const notes = deepRender(findByTestId(tree, "search-results").props.ListHeaderComponent);
    expect(getTextContent(findByTestId(notes, "search-ignored"))).toBe("Ignored: ninth, tenth");
    // Ordered after the chip: the chip explains the window, the note the words.
    const texts = findAll(notes, (n) => n.type === Text).map((n: { props: { testID?: string } }) =>
      n.props.testID,
    );
    expect(texts.indexOf("search-ignored")).toBeGreaterThan(texts.indexOf("search-date-chip"));
    expectInertText(notes);

    const none = renderView({ state: { kind: "ready", response: readyResponse([taskResult()]) } });
    const noneNotes = deepRender(findByTestId(none, "search-results").props.ListHeaderComponent);
    expect(findByTestId(noneNotes, "search-ignored")).toBeUndefined();

    // A stale response's dropped list describes a different query: withheld.
    const stale = renderView({
      state: { kind: "ready", response: readyResponse([taskResult()], { dropped: ["x"] }) },
      stale: true,
    });
    const staleNotes = deepRender(findByTestId(stale, "search-results").props.ListHeaderComponent);
    expect(findByTestId(staleNotes, "search-ignored")).toBeUndefined();
  });

  it("EMPTY: still shows the date chip, so 'nothing in September' reads as what it is", () => {
    const tree = renderView({
      state: { kind: "ready", response: readyResponse([], { date_filter: septemberFilter }) },
    });
    const empty = findByTestId(tree, "search-empty");
    expect(getTextContent(findByTestId(empty, "search-date-chip"))).toMatch(/^In /);
    expect(getTextContent(empty)).toContain("No matches.");
  });

  it("READY: keeps the list clear of the floating buttons and the keyboard", () => {
    const list = findByTestId(
      renderView({
        state: { kind: "ready", response: readyResponse([taskResult()]) },
        keyboardHeight: 238,
      }),
      "search-results",
    );
    // 160 (FLOATING_CLEARANCE_PX) + the measured Rabbit IME height.
    expect(list.props.contentContainerStyle.paddingBottom).toBe(398);
  });
});

describe("SearchResultRow", () => {
  it("navigates a task result through the callback", () => {
    const onSelect = vi.fn();
    const row = deepRender(SearchResultRow({ result: taskResult(), onSelect }));
    const pressable = findByTestId(row, `search-result-${ID}`);

    expect(pressable.type).toBe(Pressable);
    pressable.props.onPress();
    expect(onSelect).toHaveBeenCalledWith(taskResult());
  });

  it("renders a mail result as a NON-pressable row -- nothing invites a dead tap", () => {
    const onSelect = vi.fn();
    const mail = mailResult();
    const row = deepRender(SearchResultRow({ result: mail, onSelect }));
    const node = findByTestId(row, `search-result-${mail.id}`);

    expect(node.type).toBe(View);
    expect(node.props.onPress).toBeUndefined();
  });

  it("wears a type chip so a mixed Top matches list stays legible", () => {
    const chipOf = (result: SearchResult): string =>
      getTextContent(
        findByTestId(
          deepRender(SearchResultRow({ result, onSelect: vi.fn() })),
          "search-result-chip",
        ),
      );
    expect(chipOf(taskResult())).toBe("Task");
    expect(chipOf(mailResult())).toBe("Mail");
    expect(chipOf(eventResult())).toBe("Event");
    expect(chipOf(projectResult())).toBe("Project");
  });

  it("navigates event and project results through the callback", () => {
    for (const result of [eventResult(), projectResult()]) {
      const onSelect = vi.fn();
      const row = deepRender(SearchResultRow({ result, onSelect }));
      const pressable = findByTestId(row, `search-result-${result.id}`);
      expect(pressable.type).toBe(Pressable);
      expect(pressable.props.accessibilityLabel).toMatch(/^Open (event|project): /);
      pressable.props.onPress();
      expect(onSelect).toHaveBeenCalledWith(result);
    }
  });

  it("EVENT: a timed event shows its start as a local date-time; a series says it repeats", () => {
    const timed = deepRender(SearchResultRow({ result: eventResult(), onSelect: vi.fn() }));
    const date = getTextContent(findByTestId(timed, "search-result-date"));
    expect(date).toMatch(/\d{1,2}:\d{2}/);
    expect(date).toContain("2026");

    const series = deepRender(
      SearchResultRow({ result: eventResult({ is_recurring: true }), onSelect: vi.fn() }),
    );
    expect(getTextContent(findByTestId(series, "search-result-date"))).toMatch(/repeats$/);
  });

  it("EVENT: an all-day event shows start_date as a DATE and never a clock time (ADR-045)", () => {
    const row = deepRender(
      SearchResultRow({
        result: eventResult({
          all_day: true,
          start_date: "2026-09-21",
          // Deliberately the local-noon anchor shape: all_day must win.
          starts_at: "2026-09-21T17:00:00.000Z",
        }),
        onSelect: vi.fn(),
      }),
    );
    const date = getTextContent(findByTestId(row, "search-result-date"));
    expect(date).toContain("21");
    expect(date).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("EVENT: marks an imported event read-only and a local one not", () => {
    const external = deepRender(
      SearchResultRow({ result: eventResult({ origin: "external" }), onSelect: vi.fn() }),
    );
    expect(getTextContent(findByTestId(external, "search-result-external"))).toBe(
      "From calendar · read-only",
    );
    const local = deepRender(SearchResultRow({ result: eventResult(), onSelect: vi.fn() }));
    expect(findByTestId(local, "search-result-external")).toBeUndefined();
  });

  it("TASK / PROJECT: shows a closed status and nothing for an open one", () => {
    const done = deepRender(
      SearchResultRow({ result: taskResult({ status: "done" }), onSelect: vi.fn() }),
    );
    expect(getTextContent(findByTestId(done, "search-result-status"))).toBe("Done");
    const dropped = deepRender(
      SearchResultRow({ result: taskResult({ status: "dropped" }), onSelect: vi.fn() }),
    );
    expect(getTextContent(findByTestId(dropped, "search-result-status"))).toBe("Dropped");
    const active = deepRender(SearchResultRow({ result: taskResult(), onSelect: vi.fn() }));
    expect(findByTestId(active, "search-result-status")).toBeUndefined();

    const completed = deepRender(
      SearchResultRow({ result: projectResult({ status: "completed" }), onSelect: vi.fn() }),
    );
    expect(getTextContent(findByTestId(completed, "search-result-status"))).toBe("Completed");
  });

  it("shows title, preview and sender", () => {
    const row = deepRender(SearchResultRow({ result: taskResult(), onSelect: vi.fn() }));
    const text = getTextContent(row);
    expect(text).toContain("Renew the insurance");
    expect(text).toContain("before the 30th");

    const mailRow = deepRender(SearchResultRow({ result: mailResult(), onSelect: vi.fn() }));
    expect(getTextContent(mailRow)).toContain("Widget Co");
  });

  it("marks an archived row", () => {
    const row = deepRender(
      SearchResultRow({ result: taskResult({ archived: true }), onSelect: vi.fn() }),
    );
    expect(getTextContent(row)).toContain("Archived");
  });

  it("RENDERS UNTRUSTED TEXT INERTLY: every string lands in a plain Text node", () => {
    // A mail subject and display name are attacker-chosen. They must be
    // characters on a screen, never a destination and never markup.
    const hostile = mailResult({
      title: "Click https://evil.example/reset now",
      sender: "**bold** <b>markup</b>",
    });
    const row = deepRender(SearchResultRow({ result: hostile, onSelect: vi.fn() }));

    // The text survives verbatim -- it is the user's own mail metadata, not a
    // model's paraphrase, so it is shown rather than rewritten.
    expect(getTextContent(row)).toContain("https://evil.example/reset");
    expect(getTextContent(row)).toContain("<b>markup</b>");

    // ...and every node carrying it is a plain Text with no link detection.
    expectInertText(row);
  });

  it("RENDERS UNTRUSTED TEXT INERTLY in the new event and project rows too", () => {
    // An external event's title and location are third-party text (ADR-064);
    // a project's goal is the owner's but goes through the same path.
    const hostileEvent = eventResult({
      origin: "external",
      title: "Join https://evil.example/meet <script>",
      preview: "Zoom passcode [link](https://evil.example)",
    });
    const eventRow = deepRender(SearchResultRow({ result: hostileEvent, onSelect: vi.fn() }));
    expect(getTextContent(eventRow)).toContain("https://evil.example/meet");
    expectInertText(eventRow);

    const projectRow = deepRender(
      SearchResultRow({ result: projectResult({ title: "/settings" }), onSelect: vi.fn() }),
    );
    expectInertText(projectRow);
  });

  it("gives a hostile title no influence over where a tap goes", () => {
    const onSelect = vi.fn();
    const hostile = taskResult({ title: "/settings" });
    const row = deepRender(SearchResultRow({ result: hostile, onSelect }));

    findByTestId(row, `search-result-${ID}`).props.onPress();
    // The row hands back the RESULT; the destination is derived from its
    // server-authored type and uuid by searchResultHref, never from the title.
    expect(onSelect).toHaveBeenCalledWith(hostile);
  });
});
