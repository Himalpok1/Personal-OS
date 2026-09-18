// Render-level tests for <PermissionCard /> (Checkpoint 10.8, ADR-078 §3/§8).
//
// memory-settings-card.test.tsx's technique: no render library, so the
// component is called directly and its element tree walked. The card is
// hookless, and `confirmDestructive` is mocked so the Revoke path can be
// proven to ask first and the Allow path proven not to.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDestructive } from "@/components/confirm-destructive";
import { permission } from "./fixtures.test-support";
import { PermissionCard } from "./permission-card";
import {
  permissionCardPresentation,
  permissionCardSpoken,
  permissionUsageLine,
} from "./permission-card-state";

vi.mock("@/components/confirm-destructive", () => ({ confirmDestructive: vi.fn() }));

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("permissionCardPresentation (pure)", () => {
  it("names the state, the usage, the covered actions and the toggle for a live grant", () => {
    const view = permissionCardPresentation(permission(), { timeZone: "America/Chicago" });
    expect(view.icon).toBe("checkbox-marked-outline");
    expect(view.stateChip).toEqual({ label: "Allowed", tone: "success" });
    expect(view.reconsentChip).toBeNull();
    expect(view.usageLine).toBe("Used 3 times · last Sep 17");
    expect(view.actionNames).toEqual([
      "Create task",
      "Archive task",
      "Complete task",
      "Reopen task",
    ]);
    expect(view.toggleLabel).toBe("Revoke");
    expect(view.revokeTitle).toBe("Revoke Tasks access?");
    expect(view.revokeMessage).toBe("Pending Tasks actions will be cancelled.");
  });

  it("reads Off / Allow for a revoked grant and flags re-consent only on a live one", () => {
    const off = permissionCardPresentation(
      permission({ granted: false, needs_reconsent: true, category: "calendar" }),
    );
    expect(off.stateChip).toEqual({ label: "Off", tone: "neutral" });
    expect(off.reconsentChip).toBeNull();
    expect(off.toggleLabel).toBe("Allow");
    expect(off.icon).toBe("calendar-month");
    const stale = permissionCardPresentation(permission({ needs_reconsent: true }));
    expect(stale.reconsentChip).toEqual({ label: "Re-consent needed", tone: "warning" });
  });

  it("says Not used yet at zero, and once for a single use", () => {
    expect(permissionUsageLine({ usage_count: 0, last_used_at: null })).toBe("Not used yet");
    expect(permissionUsageLine({ usage_count: 4, last_used_at: null })).toBe("Not used yet");
    expect(
      permissionUsageLine(
        { usage_count: 1, last_used_at: "2026-09-15T14:00:00Z" },
        { timeZone: "America/Chicago" },
      ),
    ).toBe("Used once · last Sep 15");
  });

  it("speaks the label, state, description and usage as one group", () => {
    const item = permission();
    const view = permissionCardPresentation(item, { timeZone: "America/Chicago" });
    expect(permissionCardSpoken(item, view)).toBe(
      "Tasks: Allowed. Create, complete, reopen and archive tasks — only after you approve each one. Used 3 times · last Sep 17.",
    );
  });
});

describe("<PermissionCard />", () => {
  it("renders the label, state chip, description, usage and the covered actions as chips", () => {
    const tree = deepRender(
      <PermissionCard
        item={permission()}
        onToggle={() => {}}
        timeZone="America/Chicago"
        testID="perm"
      />,
    );
    const text = getTextContent(tree);
    expect(text).toContain("Tasks");
    expect(text).toContain("Allowed");
    expect(text).toContain("only after you approve each one");
    expect(getTextContent(findByTestId(tree, "perm-usage"))).toBe("Used 3 times · last Sep 17");
    expect(text).toContain("Create task");
    expect(text).toContain("Reopen task");
  });

  it("Revoke goes through confirmDestructive and only then toggles off", () => {
    const onToggle = vi.fn();
    const tree = deepRender(
      <PermissionCard item={permission()} onToggle={onToggle} testID="perm" />,
    );
    const toggle = findByTestId(tree, "perm-toggle");
    expect(getTextContent(toggle)).toBe("Revoke");
    expect(toggle.props.accessibilityLabel).toBe("Revoke Tasks access");
    toggle.props.onPress();
    expect(onToggle).not.toHaveBeenCalled();
    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    const options = vi.mocked(confirmDestructive).mock.calls[0]![0];
    expect(options).toMatchObject({
      title: "Revoke Tasks access?",
      message: "Pending Tasks actions will be cancelled.",
      confirmLabel: "Revoke",
    });
    options.onConfirm();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("Allow toggles on immediately, with no confirm", () => {
    const onToggle = vi.fn();
    const tree = deepRender(
      <PermissionCard item={permission({ granted: false })} onToggle={onToggle} testID="perm" />,
    );
    const toggle = findByTestId(tree, "perm-toggle");
    expect(getTextContent(toggle)).toBe("Allow");
    toggle.props.onPress();
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("is busy while the grant is changing and does not re-fire", () => {
    const onToggle = vi.fn();
    const tree = deepRender(
      <PermissionCard item={permission()} onToggle={onToggle} pending testID="perm" />,
    );
    const toggle = findByTestId(tree, "perm-toggle");
    expect(toggle.props.accessibilityState).toEqual({ disabled: true, busy: true });
    toggle.props.onPress();
    expect(onToggle).not.toHaveBeenCalled();
    expect(confirmDestructive).not.toHaveBeenCalled();
  });

  it("shows the re-consent chip on a stale live grant", () => {
    const text = getTextContent(
      deepRender(
        <PermissionCard item={permission({ needs_reconsent: true })} onToggle={() => {}} />,
      ),
    );
    expect(text).toContain("Re-consent needed");
  });

  it("never renders a Switch -- the toggle is a Button (rule 9)", () => {
    const tree = deepRender(<PermissionCard item={permission()} onToggle={() => {}} />);
    expect(findAll(tree, (n) => n.type?.displayName === "Switch")).toEqual([]);
    const buttons = findAll(tree, (n) => n.type === Pressable);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props.accessibilityRole).toBe("button");
  });
});
