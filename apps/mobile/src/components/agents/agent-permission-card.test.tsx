// Render-level tests for <AgentPermissionCard /> (Checkpoint 10.9, ADR-081
// §3/§9): the tree-walk idiom, with `confirmDestructive` mocked so the
// Revoke path can be proven to ask first and the Allow path proven not to.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmDestructive } from "@/components/confirm-destructive";
import { AgentPermissionCard } from "./agent-permission-card";
import { readGrant, writeGrant } from "./fixtures.test-support";
import { deepRender, findAll, findByTestId, getTextContent } from "./tree-walk.test-support";

vi.mock("@/components/confirm-destructive", () => ({ confirmDestructive: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<AgentPermissionCard />", () => {
  it("renders a read grant: label, Read kind chip, Allowed, the tools it covers, and Revoke", () => {
    const tree = deepRender(
      <AgentPermissionCard item={readGrant()} onToggle={() => {}} testID="grant" />,
    );
    const text = getTextContent(tree);
    expect(text).toContain("Today, calendar & tasks");
    expect(text).toContain("Read");
    expect(text).toContain("Allowed");
    const coverage = getTextContent(findByTestId(tree, "grant-coverage"));
    expect(coverage).toContain("Search");
    expect(coverage).toContain("Calendar");
    const toggle = findByTestId(tree, "grant-toggle");
    expect(toggle.props.accessibilityRole).toBe("button");
    expect(toggle.props.accessibilityLabel).toBe("Revoke Today, calendar & tasks for agents");
    expect(getTextContent(toggle)).toBe("Revoke");
    // Never a Switch (docs/MOBILE-DESIGN-SYSTEM.md rule 9).
    expect(findAll(tree, (n) => n.props?.accessibilityRole === "switch")).toHaveLength(0);
  });

  it("Revoke asks first through confirmDestructive, with the read-flavoured message, then toggles off", () => {
    const onToggle = vi.fn();
    const tree = deepRender(
      <AgentPermissionCard item={readGrant()} onToggle={onToggle} testID="grant" />,
    );
    findByTestId(tree, "grant-toggle").props.onPress();
    expect(onToggle).not.toHaveBeenCalled();
    expect(confirmDestructive).toHaveBeenCalledTimes(1);
    const options = vi.mocked(confirmDestructive).mock.calls[0]![0];
    expect(options.title).toBe("Revoke Today, calendar & tasks for agents?");
    expect(options.message).toBe("Agents will no longer be able to read Today, calendar & tasks.");
    expect(options.confirmLabel).toBe("Revoke");
    options.onConfirm();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("a write grant's revoke names the cancelled pending work", () => {
    const tree = deepRender(
      <AgentPermissionCard
        item={writeGrant({ granted: true })}
        onToggle={() => {}}
        testID="grant"
      />,
    );
    expect(getTextContent(tree)).toContain("Write");
    findByTestId(tree, "grant-toggle").props.onPress();
    expect(vi.mocked(confirmDestructive).mock.calls[0]![0].message).toBe(
      "Pending agent actions that need it will be cancelled.",
    );
  });

  it("Allow toggles on directly, with no confirm", () => {
    const onToggle = vi.fn();
    const tree = deepRender(
      <AgentPermissionCard item={writeGrant()} onToggle={onToggle} testID="grant" />,
    );
    expect(getTextContent(tree)).toContain("Off");
    const toggle = findByTestId(tree, "grant-toggle");
    expect(getTextContent(toggle)).toBe("Allow");
    toggle.props.onPress();
    expect(confirmDestructive).not.toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("marks the toggle busy with a progress label while the change is pending", () => {
    const tree = deepRender(
      <AgentPermissionCard item={readGrant()} onToggle={() => {}} pending testID="grant" />,
    );
    const toggle = findByTestId(tree, "grant-toggle");
    expect(getTextContent(toggle)).toBe("Revoking…");
    expect(toggle.props.accessibilityState).toMatchObject({ busy: true });
  });
});
