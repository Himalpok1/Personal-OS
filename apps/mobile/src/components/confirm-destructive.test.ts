import { Alert, Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmDestructive } from "./confirm-destructive";

// The defect this helper exists for: react-native-web's Alert is
// `class Alert { static alert() {} }` -- it takes the arguments and does
// nothing, so the confirm callback never fires and the action silently does not
// happen. These tests pin that the helper asks on BOTH platforms.

const originalOS = Platform.OS;
const originalConfirm = (globalThis as { confirm?: unknown }).confirm;

afterEach(() => {
  Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
  (globalThis as { confirm?: unknown }).confirm = originalConfirm;
  vi.restoreAllMocks();
});

function setPlatform(os: string) {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

const OPTIONS = {
  title: "Disconnect this mailbox?",
  message: "Personal OS will stop syncing it.",
  confirmLabel: "Disconnect",
};

describe("web", () => {
  it("asks via window.confirm and RUNS the action when accepted", () => {
    // On react-native-web this is the only path that can actually run the
    // action -- Alert.alert would drop it on the floor.
    setPlatform("web");
    const ask = vi.fn().mockReturnValue(true);
    (globalThis as { confirm?: unknown }).confirm = ask;
    const onConfirm = vi.fn();

    confirmDestructive({ ...OPTIONS, onConfirm });

    expect(ask).toHaveBeenCalledOnce();
    expect(String(ask.mock.calls[0]![0])).toContain("Disconnect this mailbox?");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does NOT run the action when declined", () => {
    setPlatform("web");
    (globalThis as { confirm?: unknown }).confirm = vi.fn().mockReturnValue(false);
    const onConfirm = vi.fn();
    confirmDestructive({ ...OPTIONS, onConfirm });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("declines rather than throwing when there is no DOM", () => {
    setPlatform("web");
    delete (globalThis as { confirm?: unknown }).confirm;
    const onConfirm = vi.fn();
    expect(() => confirmDestructive({ ...OPTIONS, onConfirm })).not.toThrow();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("never reaches Alert.alert on web", () => {
    setPlatform("web");
    (globalThis as { confirm?: unknown }).confirm = vi.fn().mockReturnValue(true);
    const alert = vi.spyOn(Alert, "alert");
    confirmDestructive({ ...OPTIONS, onConfirm: vi.fn() });
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("native", () => {
  it("uses the platform dialog with a cancel and a destructive button", () => {
    setPlatform("ios");
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onConfirm = vi.fn();

    confirmDestructive({ ...OPTIONS, onConfirm });

    expect(alert).toHaveBeenCalledOnce();
    const buttons = alert.mock.calls[0]![2] as { text: string; style?: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(["Cancel", "Disconnect"]);
    expect(buttons[0]!.style).toBe("cancel");
    expect(buttons[1]!.style).toBe("destructive");

    // The action runs only through the destructive button.
    expect(onConfirm).not.toHaveBeenCalled();
    buttons[1]!.onPress!();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("does not touch window.confirm on native", () => {
    setPlatform("android");
    vi.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const ask = vi.fn();
    (globalThis as { confirm?: unknown }).confirm = ask;
    confirmDestructive({ ...OPTIONS, onConfirm: vi.fn() });
    expect(ask).not.toHaveBeenCalled();
  });
});
