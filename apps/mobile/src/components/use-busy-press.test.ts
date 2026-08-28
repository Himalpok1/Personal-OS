import { describe, expect, it, vi } from "vitest";

// Same minimal call-order-indexed hooks harness as
// use-reminder-reconciliation.test.ts, for the same reason: this repo has no
// React renderer installed for tests, the hook has no JSX surface, and its
// call order never varies across renders.
const hooksHarness = vi.hoisted(() => {
  const values = new Map<number, unknown>();
  let index = 0;

  function reset(): void {
    values.clear();
    index = 0;
  }

  function beginRender(): void {
    index = 0;
  }

  function useState<T>(initial: T): [T, (updater: T | ((prev: T) => T)) => void] {
    const idx = index++;
    if (!values.has(idx)) values.set(idx, initial);
    const setState = (updater: T | ((prev: T) => T)): void => {
      const prev = values.get(idx) as T;
      values.set(idx, typeof updater === "function" ? (updater as (prev: T) => T)(prev) : updater);
    };
    return [values.get(idx) as T, setState];
  }

  function useRef<T>(initial: T): { current: T } {
    const idx = index++;
    if (!values.has(idx)) values.set(idx, { current: initial });
    return values.get(idx) as { current: T };
  }

  return { reset, beginRender, useState, useRef };
});

vi.mock("react", () => ({
  useState: hooksHarness.useState,
  useRef: hooksHarness.useRef,
}));

// Must import after vi.mock("react") -- same ordering
// use-reminder-reconciliation.test.ts relies on.
// eslint-disable-next-line import/first
import { useBusyPress } from "./use-busy-press";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function render(action: () => Promise<void>): ReturnType<typeof useBusyPress> {
  hooksHarness.beginRender();
  // The harness above IS the "renderer" here; same precedent as
  // use-reminder-reconciliation.test.ts.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useBusyPress(action);
}

describe("useBusyPress", () => {
  it("ignores re-entrant presses while the action is in flight", async () => {
    hooksHarness.reset();
    const gate = deferred();
    const action = vi.fn(() => gate.promise);

    const first = render(action);
    first.onPress();
    // Second and third taps land before any state update re-renders --
    // exactly the double-tap the ref-based guard exists for.
    first.onPress();
    render(action).onPress();
    expect(action).toHaveBeenCalledTimes(1);

    gate.resolve();
    await gate.promise;
  });

  it("reports busy while pending and releases after completion", async () => {
    hooksHarness.reset();
    const gate = deferred();
    const action = vi.fn(() => gate.promise);

    expect(render(action).busy).toBe(false);
    render(action).onPress();
    expect(render(action).busy).toBe(true);

    gate.resolve();
    await gate.promise;
    // Let the .finally microtask run before re-reading state.
    await Promise.resolve();
    expect(render(action).busy).toBe(false);

    // A fresh press after completion fires again -- the guard is
    // single-flight, not single-use.
    render(action).onPress();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("releases the guard when the action rejects, without an unhandled rejection", async () => {
    hooksHarness.reset();
    const action = vi.fn(() => Promise.reject(new Error("boom")));

    render(action).onPress();
    await Promise.resolve();
    await Promise.resolve();
    expect(render(action).busy).toBe(false);

    render(action).onPress();
    expect(action).toHaveBeenCalledTimes(2);
  });
});
