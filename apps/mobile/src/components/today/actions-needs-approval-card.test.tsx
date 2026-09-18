// Render-level tests for <ActionsNeedsApprovalCard /> (Checkpoint 10.8,
// ADR-078 §8): NULL while loading, on an error and when nothing is pending;
// otherwise a plain card of at most two rows, each opening the ONE root
// approval sheet, with an honest "+N more".

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getActionApprovalSheet,
  resetActionApprovalSheetForTests,
} from "@/components/actions/action-approval-sheet";
import { createEventRequest, createTaskRequest } from "@/components/actions/fixtures.test-support";
import { useActions } from "@/queries/actions";
import { ActionsNeedsApprovalCard, TODAY_PENDING_ROWS } from "./actions-needs-approval-card";

vi.mock("@/queries/actions", () => ({
  useActions: vi.fn(),
  useApproveAction: vi.fn(),
  useCancelAction: vi.fn(),
}));

const push = vi.fn();
vi.mock("expo-router", () => ({ useRouter: () => ({ push }) }));

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

function mockPending(overrides: Record<string, unknown> = {}) {
  vi.mocked(useActions).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items: [], limit: 3, offset: 0, total: 0 },
    ...overrides,
  } as never);
}

function render(): unknown {
  return deepRender(ActionsNeedsApprovalCard());
}

const SECOND_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const THIRD_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

beforeEach(() => {
  vi.clearAllMocks();
  resetActionApprovalSheetForTests();
  mockPending();
});

describe("<ActionsNeedsApprovalCard />", () => {
  it("asks for the pending requests only, one more than it draws", () => {
    render();
    expect(useActions).toHaveBeenCalledWith({ status: "pending", limit: TODAY_PENDING_ROWS + 1 });
  });

  it("renders NOTHING while loading, on an error, and when nothing is pending", () => {
    mockPending({ isLoading: true, data: undefined });
    expect(render()).toBeNull();
    mockPending({ isError: true, data: undefined });
    expect(render()).toBeNull();
    mockPending();
    expect(render()).toBeNull();
  });

  it("renders the header with the total, one row per pending request, and no +more at two", () => {
    mockPending({
      data: {
        items: [createTaskRequest(), createEventRequest({ id: SECOND_ID })],
        limit: 3,
        offset: 0,
        total: 2,
      },
    });
    const tree = render();
    const card = findByTestId(tree, "actions-needs-approval-card");
    expect(card).toBeDefined();
    expect(getTextContent(card)).toContain("Needs your approval");
    expect(getTextContent(card)).toContain("2");
    expect(getTextContent(card)).toContain("Create task: Project milestone 2");
    expect(getTextContent(card)).toContain("Create event: Study: Project milestone 2");
    expect(findByTestId(tree, "actions-needs-approval-more")).toBeUndefined();
    // A plain card: no gradient layer under it (Today draws one, the briefing).
    expect(findAll(tree, (n) => n.type?.name === "LinearGradient")).toEqual([]);
  });

  it("caps at two rows and says +N more against the honest total", () => {
    mockPending({
      data: {
        items: [
          createTaskRequest(),
          createEventRequest({ id: SECOND_ID }),
          createTaskRequest({ id: THIRD_ID }),
        ],
        limit: 3,
        offset: 0,
        total: 5,
      },
    });
    const tree = render();
    expect(findByTestId(tree, `today-pending-action-${createTaskRequest().id}`)).toBeDefined();
    expect(findByTestId(tree, `today-pending-action-${SECOND_ID}`)).toBeDefined();
    expect(findByTestId(tree, `today-pending-action-${THIRD_ID}`)).toBeUndefined();
    expect(getTextContent(findByTestId(tree, "actions-needs-approval-more"))).toBe("+3 more");
  });

  it("a row opens the approval sheet on its item; See all goes to /actions", () => {
    mockPending({
      data: { items: [createTaskRequest()], limit: 3, offset: 0, total: 1 },
    });
    const tree = render();
    const row = findByTestId(tree, `today-pending-action-${createTaskRequest().id}`);
    expect(row.props.accessibilityRole).toBe("button");
    row.props.onPress();
    expect(getActionApprovalSheet()).toMatchObject({ visible: true });
    expect(getActionApprovalSheet().item?.id).toBe(createTaskRequest().id);
    const seeAll = findAll(
      tree,
      (n) => n.props?.accessibilityLabel === "See all pending actions",
    )[0];
    seeAll.props.onPress();
    expect(push).toHaveBeenCalledWith("/actions");
  });
});
