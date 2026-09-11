import type { SearchResponse, SearchResult } from "@personal-os/schema";
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

function taskResult(overrides: Partial<Extract<SearchResult, { type: "task" }>> = {}): SearchResult {
  return {
    type: "task",
    id: ID,
    title: "Renew the insurance",
    preview: "before the 30th",
    timestamp: "2026-08-01T00:00:00.000Z",
    status: "active",
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
    sender: "Widget Co",
    has_attachment: false,
    ...overrides,
  };
}

function readyResponse(results: SearchResult[]): SearchResponse {
  const zero = { returned: 0, total: 0 };
  const counts = {
    task: zero,
    note: zero,
    inbox_item: zero,
    mail_message: zero,
  } as SearchResponse["counts"];
  for (const result of results) {
    counts[result.type] = {
      returned: counts[result.type].returned + 1,
      total: counts[result.type].total + 1,
    };
  }
  return { query: "insurance", limit: 20, truncated: false, counts, results };
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

  it("READY: hands the list exactly the header+result rows, grouped by type", () => {
    const tree = renderView({
      state: { kind: "ready", response: readyResponse([taskResult(), mailResult()]) },
    });
    const list = findByTestId(tree, "search-results");
    expect(list).toBeDefined();
    expect(
      list.props.data.map((row: { kind: string; type?: string }) =>
        row.kind === "header" ? `H:${row.type}` : "R",
      ),
    ).toEqual(["H:task", "R", "H:mail_message", "R"]);
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
    for (const node of findAll(row, (n) => n.type === Text)) {
      expect(node.props.dataDetectorTypes).toBeUndefined();
      expect(node.props.onPress).toBeUndefined();
      expect(node.props.href).toBeUndefined();
    }
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
