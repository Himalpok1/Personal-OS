// The ONE place an academic surface opens a provider URL (Checkpoint 10.2).
//
// Every "open in Canvas" affordance -- a Today card row, a course header, an
// assignment row, an announcement's Open link -- renders through this
// component, so the same-origin check in same-origin.ts is structurally
// unskippable rather than repeated at each call site. The Checkpoint 10.1
// posture is preserved exactly as it was verified live in the browser: a row
// is pressable, carries `accessibilityRole="link"` and opens `htmlUrl` ONLY
// when `isSameOrigin(htmlUrl, sourceBaseUrl)`; otherwise it renders inert,
// with no role and no handler, and `htmlUrl` is never rendered as text.
//
// This file is one of the two `Linking.openURL` call sites
// apps/worker/src/mobile-inert-rendering.test.ts allows, and
// src/__tests__/academic-open-url.test.ts pins that no other academic file
// grows one.
import type { ReactNode } from "react";
import { Linking, Pressable } from "react-native";
import { isSameOrigin } from "./same-origin";

export interface SourceLinkProps {
  /** The provider-generated link, or null when the provider sent none. */
  htmlUrl: string | null;
  /** The connection's own base URL the link must share an origin with. */
  sourceBaseUrl: string;
  accessibilityLabel: string;
  className?: string;
  children: ReactNode;
}

export function SourceLink({
  htmlUrl,
  sourceBaseUrl,
  accessibilityLabel,
  className,
  children,
}: SourceLinkProps) {
  const openable = isSameOrigin(htmlUrl, sourceBaseUrl);
  return (
    <Pressable
      disabled={!openable}
      // No handler at all when inert -- not a handler that checks and
      // returns -- so the element tree itself shows the row cannot open.
      onPress={openable ? () => void Linking.openURL(htmlUrl as string) : undefined}
      accessibilityRole={openable ? "link" : undefined}
      accessibilityLabel={accessibilityLabel}
      hitSlop={4}
      className={className}
    >
      {children}
    </Pressable>
  );
}
