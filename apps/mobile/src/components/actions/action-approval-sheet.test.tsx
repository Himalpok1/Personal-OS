// The approval sheet (Checkpoint 10.8, ADR-078 §6/§8): the store the hookless
// rows write to, and the hookless content the host draws. Tree-walk idiom,
// no render library: the content is called directly and its element tree
// walked. The host is the leaf with hooks; because its approve/cancel
// wiring is the whole point of the sheet (a `failed` row must keep it
// open), it is exercised too, with React's `useSyncExternalStore` stubbed
// to a plain read of the store and its two mutation hooks mocked.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "@/components/ui";
import { triggerHaptic } from "@/components/ui/haptics";
import { useApproveAction, useCancelAction } from "@/queries/actions";
import {
  ACTION_CALL_FAILED,
  ACTION_NOT_PENDING,
  ActionApprovalSheetContent,
  ActionApprovalSheetHost,
  ActionRequestSummary,
  closeActionApprovalSheet,
  getActionApprovalSheet,
  openActionApprovalSheet,
  resetActionApprovalSheetForTests,
  setActionApprovalSheetResult,
  subscribeActionApprovalSheet,
} from "./action-approval-sheet";
import {
  completeTaskRequest,
  createEventRequest,
  createTaskRequest,
} from "./fixtures.test-support";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
  };
});

vi.mock("@/queries/actions", () => ({
  useApproveAction: vi.fn(),
  useCancelAction: vi.fn(),
}));

// Mocked at its own module so the Button's import (./haptics) and the
// host's barrel import both land on the same spy.
vi.mock("@/components/ui/haptics", () => ({ triggerHaptic: vi.fn() }));

vi.mock("@/components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...actual,
    showToast: vi.fn(),
    // The sheet frame is a leaf with hooks; the host test reads its props.
    BottomSheet: (props: Record<string, unknown>) => ({ type: "BottomSheet", props }),
  };
});

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

const approveMutate = vi.fn();
const cancelMutate = vi.fn();

function mockMutations(overrides: { approvePending?: boolean; cancelPending?: boolean } = {}) {
  vi.mocked(useApproveAction).mockReturnValue({
    mutate: approveMutate,
    isPending: overrides.approvePending ?? false,
  } as never);
  vi.mocked(useCancelAction).mockReturnValue({
    mutate: cancelMutate,
    isPending: overrides.cancelPending ?? false,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetActionApprovalSheetForTests();
  mockMutations();
});

describe("the store", () => {
  it("starts closed, opens with an item, closes keeping the item for the exit, notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActionApprovalSheet(listener);
    expect(getActionApprovalSheet()).toEqual({ visible: false, item: null, error: null });
    openActionApprovalSheet(createTaskRequest());
    expect(getActionApprovalSheet().visible).toBe(true);
    expect(getActionApprovalSheet().item?.id).toBe(createTaskRequest().id);
    expect(listener).toHaveBeenCalledTimes(1);
    closeActionApprovalSheet();
    expect(getActionApprovalSheet()).toMatchObject({ visible: false });
    expect(getActionApprovalSheet().item?.id).toBe(createTaskRequest().id);
    expect(listener).toHaveBeenCalledTimes(2);
    closeActionApprovalSheet();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    openActionApprovalSheet(createEventRequest());
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("a result replaces the item and the failure line; a null result keeps the item", () => {
    openActionApprovalSheet(createTaskRequest());
    setActionApprovalSheetResult(null, "boom");
    expect(getActionApprovalSheet()).toMatchObject({ visible: true, error: "boom" });
    expect(getActionApprovalSheet().item?.status).toBe("pending");
    const failed = createTaskRequest({ status: "failed", error_class: "target_not_found" });
    setActionApprovalSheetResult(failed, "line");
    expect(getActionApprovalSheet().item?.status).toBe("failed");
    // Re-opening clears the failure line.
    openActionApprovalSheet(createTaskRequest());
    expect(getActionApprovalSheet().error).toBeNull();
  });
});

describe("ActionRequestSummary", () => {
  it("renders the chip strip, Why with the reason and source chip, and What will change, without an id", () => {
    const tree = deepRender(<ActionRequestSummary item={createTaskRequest()} />);
    const text = getTextContent(tree);
    const strip = getTextContent(findByTestId(tree, "action-chip-strip"));
    expect(strip).toContain("Tasks");
    expect(strip).toContain("Reversible");
    expect(strip).toContain("Low risk");
    const why = findByTestId(tree, "action-why");
    expect(getTextContent(why)).toContain("Why");
    expect(getTextContent(why)).toContain("Track this assignment as a task");
    expect(getTextContent(why)).toContain("Academics");
    const change = findByTestId(tree, "action-what-will-change");
    expect(change.props.accessibilityRole).toBe("summary");
    expect(getTextContent(change)).toContain("What will change");
    expect(getTextContent(change)).toContain("Project milestone 2");
    expect(getTextContent(change)).toContain("Linked to an assignment");
    expect(text).not.toContain("cccccccc");
    expect(text).not.toContain("aaaaaaaa");
  });

  it("falls back to You asked for this and the You chip for a bare manual request", () => {
    const why = findByTestId(
      deepRender(<ActionRequestSummary item={completeTaskRequest()} />),
      "action-why",
    );
    expect(getTextContent(why)).toContain("You asked for this");
    expect(getTextContent(why)).toContain("You");
  });
});

describe("ActionApprovalSheetContent", () => {
  it("renders the description, the summary, Approve (primary, block) and Cancel (outline, no haptic) for a pending row", () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const tree = deepRender(
      <ActionApprovalSheetContent
        item={createEventRequest()}
        error={null}
        pending={false}
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );
    expect(getTextContent(tree)).toContain("Adds a timed event you author in Personal OS");
    expect(findByTestId(tree, "action-what-will-change")).toBeDefined();
    const approve = findByTestId(tree, "action-approve");
    expect(approve.props.accessibilityRole).toBe("button");
    expect(approve.props.accessibilityLabel).toBe(
      "Approve: Create event: Study: Project milestone 2",
    );
    approve.props.onPress();
    expect(onApprove).toHaveBeenCalledTimes(1);
    // Approve is the primary button: it fires its own light haptic and no dialog.
    expect(triggerHaptic).toHaveBeenCalledWith("light");
    const cancel = findByTestId(tree, "action-cancel");
    cancel.props.onPress();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(triggerHaptic).toHaveBeenCalledTimes(1);
    expect(findByTestId(tree, "action-approval-error")).toBeUndefined();
  });

  it("disables both buttons while a mutation is pending and neither re-fires", () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    const tree = deepRender(
      <ActionApprovalSheetContent
        item={createEventRequest()}
        error={null}
        pending
        onApprove={onApprove}
        onCancel={onCancel}
      />,
    );
    const approve = findByTestId(tree, "action-approve");
    expect(approve.props.accessibilityState).toEqual({ disabled: true, busy: true });
    approve.props.onPress();
    const cancel = findByTestId(tree, "action-cancel");
    expect(cancel.props.accessibilityState).toEqual({ disabled: true, busy: false });
    cancel.props.onPress();
    expect(onApprove).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows the failure line as an inert danger row, never a toast", () => {
    const tree = deepRender(
      <ActionApprovalSheetContent
        item={createTaskRequest()}
        error="The item this action was for no longer exists."
        pending={false}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    const row = findByTestId(tree, "action-approval-error");
    expect(getTextContent(row)).toContain("no longer exists");
    expect(row.props.onPress).toBeUndefined();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("offers no buttons on a row that is no longer pending", () => {
    const tree = deepRender(
      <ActionApprovalSheetContent
        item={createTaskRequest({ status: "failed", error_class: "target_not_found" })}
        error="x"
        pending={false}
        onApprove={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(findByTestId(tree, "action-approve")).toBeUndefined();
    expect(findByTestId(tree, "action-cancel")).toBeUndefined();
  });
});

describe("ActionApprovalSheetHost", () => {
  function hostSheet(): { props: Record<string, any> } {
    return ActionApprovalSheetHost() as unknown as { props: Record<string, any> };
  }

  function renderedContent(): unknown {
    return deepRender(hostSheet().props.children);
  }

  it("draws the sheet closed with no content until something is opened", () => {
    const sheet = hostSheet();
    expect(sheet.props.open).toBe(false);
    expect(sheet.props.children).toBeNull();
  });

  it("titles the sheet with the registry name and passes the item to the content", () => {
    openActionApprovalSheet(createTaskRequest());
    const sheet = hostSheet();
    expect(sheet.props.open).toBe(true);
    expect(sheet.props.title).toBe("Create task");
    expect(findByTestId(renderedContent(), "action-approve")).toBeDefined();
  });

  it("Approve calls the mutation with the id; a completed row closes, fires the success haptic and toasts the result", () => {
    openActionApprovalSheet(createTaskRequest());
    findByTestId(renderedContent(), "action-approve").props.onPress();
    expect(approveMutate).toHaveBeenCalledWith(createTaskRequest().id, expect.any(Object));
    const options = approveMutate.mock.calls[0]![1];
    options.onSuccess(
      createTaskRequest({
        status: "completed",
        result_summary: "Created task: Project milestone 2",
        target_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }),
    );
    expect(getActionApprovalSheet().visible).toBe(false);
    expect(triggerHaptic).toHaveBeenCalledWith("success");
    expect(showToast).toHaveBeenCalledWith({
      message: "Created task: Project milestone 2",
      tone: "success",
    });
  });

  it("a failed row keeps the sheet open with the friendly line for its error class", () => {
    openActionApprovalSheet(createTaskRequest());
    findByTestId(renderedContent(), "action-approve").props.onPress();
    approveMutate.mock.calls[0]![1].onSuccess(
      createTaskRequest({ status: "failed", error_class: "permission_revoked" }),
    );
    const state = getActionApprovalSheet();
    expect(state.visible).toBe(true);
    expect(state.item?.status).toBe("failed");
    expect(state.error).toBe("That permission was revoked before this could run.");
    expect(showToast).not.toHaveBeenCalled();
    expect(triggerHaptic).not.toHaveBeenCalledWith("success");
    expect(getTextContent(findByTestId(renderedContent(), "action-approval-error"))).toContain(
      "revoked",
    );
  });

  it("a failed call keeps the sheet open with a call-failure line, and names a replayed approval", () => {
    openActionApprovalSheet(createTaskRequest());
    findByTestId(renderedContent(), "action-approve").props.onPress();
    approveMutate.mock.calls[0]![1].onError(new Error("network"));
    expect(getActionApprovalSheet()).toMatchObject({ visible: true, error: ACTION_CALL_FAILED });
    approveMutate.mock.calls[0]![1].onError({ code: "action_not_pending", status: 409 });
    expect(getActionApprovalSheet().error).toBe(ACTION_NOT_PENDING);
  });

  it("Cancel calls the cancel mutation without a confirm, then closes and toasts", () => {
    openActionApprovalSheet(createEventRequest());
    findByTestId(renderedContent(), "action-cancel").props.onPress();
    expect(cancelMutate).toHaveBeenCalledWith(createEventRequest().id, expect.any(Object));
    cancelMutate.mock.calls[0]![1].onSuccess(createEventRequest({ status: "cancelled" }));
    expect(getActionApprovalSheet().visible).toBe(false);
    expect(showToast).toHaveBeenCalledWith({ message: "Cancelled", tone: "neutral" });
  });

  it("marks the content pending while either mutation is in flight", () => {
    mockMutations({ cancelPending: true });
    openActionApprovalSheet(createEventRequest());
    const approve = findByTestId(renderedContent(), "action-approve");
    expect(approve.props.accessibilityState.busy).toBe(true);
  });
});
