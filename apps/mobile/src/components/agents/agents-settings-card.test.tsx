// Render-level tests for <AgentsSettingsCard /> (Checkpoint 10.9, ADR-081 §9).
//
// actions-settings-card.test.tsx's technique: no render library, so the
// component is called directly with its one query hook mocked, and the
// element tree it returns is walked.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgents } from "@/queries/agents";
import { AgentsSettingsCard } from "./agents-settings-card";
import { agentsSettingsPresentation, liveAgentCount } from "./agents-settings-card-state";
import { agent, revokedAgent } from "./fixtures.test-support";
import { deepRender, findByTestId, getTextContent } from "./tree-walk.test-support";
import { AGENTS_TRUST_LINE } from "./trust-line";

vi.mock("@/queries/agents", () => ({ useAgents: vi.fn() }));

const push = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));

function mockAgents(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAgents).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items: [agent(), revokedAgent()] },
    ...overrides,
  } as never);
}

function render(): unknown {
  return deepRender(AgentsSettingsCard());
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAgents();
});

describe("agentsSettingsPresentation (pure)", () => {
  it("loading has no chip; an error is Unknown", () => {
    expect(
      agentsSettingsPresentation({ isLoading: true, isError: false, items: undefined }),
    ).toEqual({ chip: null });
    expect(
      agentsSettingsPresentation({ isLoading: false, isError: true, items: undefined }),
    ).toEqual({ chip: { label: "Unknown", tone: "warning" } });
  });

  it("counts live agents only, and says None yet when there are none", () => {
    expect(liveAgentCount([agent(), revokedAgent()])).toBe(1);
    expect(
      agentsSettingsPresentation({
        isLoading: false,
        isError: false,
        items: [agent(), revokedAgent()],
      }),
    ).toEqual({ chip: { label: "1 registered", tone: "info" } });
    expect(
      agentsSettingsPresentation({ isLoading: false, isError: false, items: [revokedAgent()] }),
    ).toEqual({ chip: { label: "None yet", tone: "neutral" } });
  });
});

describe("<AgentsSettingsCard />", () => {
  it("shows the registered chip and the byte-exact trust line", () => {
    const tree = render();
    expect(getTextContent(findByTestId(tree, "agents-settings-card"))).toContain("1 registered");
    expect(getTextContent(findByTestId(tree, "agents-trust-line"))).toBe(AGENTS_TRUST_LINE);
  });

  it("offers Open Agent Center as a row into /agents", () => {
    const row = findByTestId(render(), "agents-settings-open");
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe("Open Agent Center");
    row.props.onPress();
    expect(push).toHaveBeenCalledWith("/agents");
  });

  it("reads None yet with no agents, and Unknown on an error, and carries no other button", () => {
    mockAgents({ data: { items: [] } });
    expect(getTextContent(render())).toContain("None yet");
    mockAgents({ isError: true, data: undefined });
    expect(getTextContent(render())).toContain("Unknown");
    const tree = render();
    const buttons = findAllButtons(tree);
    expect(buttons).toHaveLength(1);
  });
});

function findAllButtons(tree: unknown): unknown[] {
  const acc: unknown[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const el = node as { props?: { accessibilityRole?: string; children?: unknown } };
    if (el.props?.accessibilityRole === "button") acc.push(el);
    if (el.props?.children !== undefined) walk(el.props.children);
  };
  walk(tree);
  return acc;
}
