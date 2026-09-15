// Render-level tests for <CloudAskCard />.
//
// Copies digest-today-card.test.tsx's technique exactly, for the reason
// recorded there: this app has no render library, so the component is called
// directly and the plain element tree it returns is walked. That only works
// because every hook this card calls is mocked below -- there is no live
// dispatcher, so an unmocked hook call would throw, and the card itself is
// written with no raw `useState` for exactly this reason (see its own file
// header).

import { ApiClientError } from "@personal-os/api-client";
import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAskConsentOutdated,
  useAskEnabled,
  useAskModels,
  useDisableCloudAsk,
  useEnableCloudAsk,
} from "@/queries/ask";
import { ASK_CONSENT_OUTDATED_TEXT, ASK_DISCLOSURE_TEXT, CloudAskCard } from "./cloud-ask-card";

vi.mock("@/queries/ask", () => ({
  useAskEnabled: vi.fn(),
  useAskModels: vi.fn(),
  useEnableCloudAsk: vi.fn(),
  useDisableCloudAsk: vi.fn(),
  useAskConsentOutdated: vi.fn(),
}));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

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
/* eslint-enable @typescript-eslint/no-explicit-any */

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

function render(): unknown {
  return deepRender(CloudAskCard());
}

function mockEnabled(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAskEnabled).mockReturnValue({
    isLoading: false,
    isError: false,
    enabled: false,
    route: null,
    ...overrides,
  } as never);
}

function mockModels(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAskModels).mockReturnValue({
    models: [
      {
        modelId: "33333333-3333-4333-8333-333333333333",
        modelLabel: "gpt-4.1",
        connectionId: "22222222-2222-4222-8222-222222222222",
        connectionName: "My OpenAI",
        providerType: "openai",
      },
    ],
    isLoading: false,
    isError: false,
    ...overrides,
  } as never);
}

function mockEnable(overrides: Record<string, unknown> = {}) {
  vi.mocked(useEnableCloudAsk).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
    ...overrides,
  } as never);
}

function mockDisable(overrides: Record<string, unknown> = {}) {
  vi.mocked(useDisableCloudAsk).mockReturnValue({
    isPending: false,
    isError: false,
    error: null,
    mutate: vi.fn(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled();
  mockModels();
  mockEnable();
  mockDisable();
  vi.mocked(useAskConsentOutdated).mockReturnValue(false);
});

describe("off state", () => {
  it("shows Off and no Disable action when no 'ask' route exists", () => {
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-card"))).toContain("Off");
    expect(findByTestId(tree, "cloud-ask-disable")).toBeUndefined();
  });

  it("always shows the disclosure and the model picker while off -- no extra reveal step", () => {
    const tree = render();
    const disclosure = findByTestId(tree, "cloud-ask-disclosure-text");
    expect(getTextContent(disclosure)).toBe(ASK_DISCLOSURE_TEXT);
    expect(
      findByTestId(tree, "cloud-ask-model-33333333-3333-4333-8333-333333333333"),
    ).toBeDefined();
  });

  it("names each model's connection so the user knows who receives content", () => {
    const tree = render();
    const row = findByTestId(tree, "cloud-ask-model-33333333-3333-4333-8333-333333333333");
    expect(getTextContent(row)).toContain("gpt-4.1");
    expect(getTextContent(row)).toContain("My OpenAI");
  });

  it("tapping a model enables Cloud Ask with that model's id", () => {
    const mutate = vi.fn();
    mockEnable({ mutate });
    const tree = render();
    findByTestId(tree, "cloud-ask-model-33333333-3333-4333-8333-333333333333").props.onPress();
    expect(mutate).toHaveBeenCalledWith("33333333-3333-4333-8333-333333333333");
  });

  it("shows no dead-end when no models are registered", () => {
    mockModels({ models: [] });
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-no-models"))).toContain(
      "No AI models are registered yet",
    );
  });

  it("shows the mapped enable failure, never raw error text", () => {
    mockEnable({ isError: true, error: new ApiClientError(400, "validation_failed") });
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-enable-error"))).toBe(
      "That model selection wasn't valid.",
    );
  });
});

describe("the disclosure text itself", () => {
  it("does NOT claim data stays local by default -- that would be false", () => {
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-disclosure-text")).toLowerCase();
    expect(text).not.toContain("stays local");
    expect(text).not.toContain("never leaves");
  });

  it("is EXACTLY the Checkpoint 9.7 text -- every class of data that leaves, named", () => {
    // Pinned byte-for-byte: this is the consent the server's vintage check
    // (`ask_consent_outdated`) exists to protect. A wording change here is a
    // change to what the owner agreed to and needs its own re-consent.
    expect(ASK_DISCLOSURE_TEXT).toBe(
      "Sends your question to the model you choose, along with: matching notes and tasks " +
        "(up to 4, bodies included, secrets redacted by pattern only); the titles, times and " +
        "project names of your tasks, reminders and calendar events for today and the next 7 " +
        "days (calendar titles and locations were written by whoever created the invitation); " +
        "tasks you completed in the last 7 days; the text of up to 5 unfiled captures; project " +
        "names and task counts; and whether your reviews are done. Nothing is stored. Personal " +
        "OS cannot verify how the provider handles it.",
    );
  });

  it("names the seven-day windows, the calendar provenance, captures and the no-storage rule", () => {
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-disclosure-text"));
    expect(text).toContain("today and the next 7 days");
    expect(text).toContain("written by whoever created the invitation");
    expect(text).toContain("completed in the last 7 days");
    expect(text).toContain("up to 5 unfiled captures");
    expect(text).toContain("Nothing is stored.");
    expect(text).toContain("cannot verify how the provider handles it");
  });

  it("does not describe the redaction as more than it is", () => {
    const text = ASK_DISCLOSURE_TEXT.toLowerCase();
    expect(text).toContain("redacted by pattern only");
    expect(text).not.toContain("all secrets");
    expect(text).not.toContain("guaranteed");
  });

  it("mentions, beside the disclosure, that captures are already, separately, sent to AI for parsing", () => {
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-context-text"));
    expect(text).toContain("capture parsing");
    expect(text).toContain("already sends the text of every new capture");
  });

  it("says disabling stops new questions immediately but one in flight may finish", () => {
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-context-text"));
    expect(text).toContain("stops new questions immediately");
    expect(text).toContain("already in flight may still finish");
  });

  it("the context paragraph is hidden with the disclosure once Cloud Ask is on", () => {
    mockEnabled({
      enabled: true,
      route: {
        task_name: "ask",
        primary_model_id: "33333333-3333-4333-8333-333333333333",
        connection_name: "My OpenAI",
        provider_type: "openai",
        base_url_host: null,
        enabled: true,
      },
    });
    expect(findByTestId(render(), "cloud-ask-context-text")).toBeUndefined();
  });
});

describe("on state", () => {
  const ROUTE = {
    task_name: "ask",
    primary_model_id: "33333333-3333-4333-8333-333333333333",
    connection_name: "My OpenAI",
    provider_type: "openai",
    base_url_host: null,
    enabled: true,
  };

  it("shows On with the connection name and a Disable action, no disclosure", () => {
    mockEnabled({ enabled: true, route: ROUTE });
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-card"))).toContain(
      "On — sends questions to My OpenAI.",
    );
    expect(findByTestId(tree, "cloud-ask-disable")).toBeDefined();
    expect(findByTestId(tree, "cloud-ask-disclosure")).toBeUndefined();
  });

  it("disabling calls the mutation with no arguments and no confirmation dialog", () => {
    const mutate = vi.fn();
    mockEnabled({ enabled: true, route: ROUTE });
    mockDisable({ mutate });
    const tree = render();
    findByTestId(tree, "cloud-ask-disable").props.onPress();
    expect(mutate).toHaveBeenCalledWith();
  });

  it("disables the button while turning off, so a double-tap cannot fire twice", () => {
    mockEnabled({ enabled: true, route: ROUTE });
    mockDisable({ isPending: true });
    const button = findByTestId(render(), "cloud-ask-disable");
    expect(button.props.disabled).toBe(true);
    expect(getTextContent(button)).toBe("Turning off…");
  });

  it("shows the disable failure, never raw error text", () => {
    mockEnabled({ enabled: true, route: ROUTE });
    mockDisable({ isError: true, error: new Error("ECONNREFUSED") });
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-disable-error"));
    expect(text).toContain("Couldn't turn off Cloud Ask");
    expect(text).not.toContain("ECONNREFUSED");
  });
});

describe("loading and unreadable states", () => {
  it("says Loading while the route list has not resolved", () => {
    mockEnabled({ isLoading: true });
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-card"))).toContain("Loading");
    expect(findByTestId(tree, "cloud-ask-disclosure")).toBeUndefined();
    expect(findByTestId(tree, "cloud-ask-disable")).toBeUndefined();
  });

  it("claims nothing about being on or off when the server cannot be reached", () => {
    mockEnabled({ isError: true });
    const tree = render();
    const text = getTextContent(findByTestId(tree, "cloud-ask-card"));
    expect(text).toContain("Can't reach Personal OS");
    expect(text).not.toContain("On —");
    expect(findByTestId(tree, "cloud-ask-disclosure")).toBeUndefined();
  });
});

describe("consent outdated (Checkpoint 9.7)", () => {
  const ROUTE = {
    task_name: "ask",
    primary_model_id: "33333333-3333-4333-8333-333333333333",
    connection_name: "My OpenAI",
    provider_type: "openai",
    base_url_host: null,
    enabled: true,
  };

  it("shows nothing about it while the flag is false", () => {
    mockEnabled({ enabled: true, route: ROUTE });
    const tree = render();
    expect(findByTestId(tree, "cloud-ask-consent-outdated")).toBeUndefined();
    expect(getTextContent(findByTestId(tree, "cloud-ask-disable"))).toBe("Disable Cloud Ask");
  });

  it("on an enabled row, names the situation and turns Disable into the re-enable step", () => {
    mockEnabled({ enabled: true, route: ROUTE });
    vi.mocked(useAskConsentOutdated).mockReturnValue(true);
    const tree = render();
    expect(getTextContent(findByTestId(tree, "cloud-ask-consent-outdated"))).toBe(
      ASK_CONSENT_OUTDATED_TEXT,
    );
    expect(ASK_CONSENT_OUTDATED_TEXT).toBe(
      "Cloud Ask was enabled under an older disclosure. Re-enable to continue.",
    );
    const button = findByTestId(tree, "cloud-ask-disable");
    expect(getTextContent(button)).toBe("Disable, then re-enable below");
    // The SAME delete mutation -- there is no in-place re-point (the server
    // refuses one), so re-enabling is delete-then-pick-a-model by design.
    const mutate = vi.fn();
    mockDisable({ mutate });
    findByTestId(render(), "cloud-ask-disable").props.onPress();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith();
  });

  it("is irrelevant while off: the picker and the current disclosure are what show", () => {
    vi.mocked(useAskConsentOutdated).mockReturnValue(true);
    const tree = render();
    expect(findByTestId(tree, "cloud-ask-consent-outdated")).toBeUndefined();
    expect(getTextContent(findByTestId(tree, "cloud-ask-disclosure-text"))).toBe(
      ASK_DISCLOSURE_TEXT,
    );
  });
});
