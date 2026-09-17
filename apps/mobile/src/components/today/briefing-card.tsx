// The daily briefing (Checkpoint 10.6, ADR-075 §4 / ADR-076 §4): the ONE
// gradient block on Today, replacing the counts-only "At a glance" hero. It
// reads like a briefing -- a headline, then Academics / Schedule / Health /
// Focus now as compact blocks whose every line names its source -- and is
// composed entirely on the client by core's `composeBriefing` over the three
// responses this screen already fetches. No model call, nothing stored: the
// AI Daily Brief (ADR-041/043) is the separate `BriefCard` further down.
//
// Owns its three queries (`useToday`, `useAcademicToday`, `useHealthSummary`)
// the way every other self-owned Today card does; React Query dedupes them
// with the screen's and the cards' own calls. Renders NOTHING while `today`
// is loading (the screen shows its skeleton then). A section core omits
// simply does not render -- nothing here invents a section or a count.
//
// Memory (Checkpoint 10.7, ADR-077 §5) joins as a fourth, optional source
// through the same two hooks the Focus Now card reads, and joins the SETTLE
// set below: the block waits for the memory queries like it waits for the
// academic and health ones, and a failed one contributes nothing. Its one
// visible effect here is the "Working hours … — from your preferences" line
// (source "Memory"), which carries no `ref` and is therefore inert.
//
// The "Ask about today" chip is NOT drawn here: the screen passes it as
// `children`, gated exactly where and how it was (Checkpoint 9.7's `ask`
// switch), so it keeps living inside the one hero block.
import type { BriefingLine, BriefingSection } from "@personal-os/core/focus-now/briefing";
import { useRouter, type Href } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { openAssignmentSheet } from "@/components/academic/assignment-sheet";
import { AppText, GradientCard } from "@/components/ui";
import { useAcademicToday } from "@/queries/academic";
import { useHealthSummary } from "@/queries/health";
import { useMemoriesForIntelligence, useMemorySettings } from "@/queries/memory";
import { useToday } from "@/queries/today";
import { formatShortDate } from "@/utils/local-date";
import { briefingFor, briefingLineTarget, type BriefingLineTarget } from "./briefing-card-state";
import { focusNowExplanation, type FocusNowRow } from "./focus-now-card-state";
import { FOCUS_NOW_SOURCE_LABEL } from "./focus-now-source-label";
import { memoryIntelligenceInput } from "./memory-inputs";

/** The on-gradient pill (docs/MOBILE-DESIGN-SYSTEM.md rule 1's documented exception), as a source chip. */
function SourceChip({ label }: { label: string }) {
  return (
    <View className="self-start rounded-full border border-white/30 bg-white/20 px-2 py-0.5">
      <AppText variant="caption" tone="on-gradient" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function BriefingLineView({
  line,
  target,
  onOpen,
}: {
  line: BriefingLine;
  target: BriefingLineTarget;
  onOpen: (target: NonNullable<BriefingLineTarget>) => void;
}) {
  const source = FOCUS_NOW_SOURCE_LABEL[line.source];
  const emphasis = line.tone === "danger" || line.tone === "warning" ? "font-semibold" : "";
  const content = (
    <>
      <AppText
        variant="body"
        tone="on-gradient"
        numberOfLines={2}
        className={["flex-1", emphasis].filter(Boolean).join(" ")}
      >
        {line.text}
      </AppText>
      <SourceChip label={source} />
    </>
  );
  if (target === null) {
    return (
      <View
        className="flex-row items-start gap-2 py-1"
        accessible
        accessibilityLabel={`${line.text}. Source: ${source}`}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      onPress={() => onOpen(target)}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${line.text}. Source: ${source}. Opens details.`}
      className="min-h-[44px] flex-row items-start gap-2 py-1 active:opacity-80"
    >
      {content}
    </Pressable>
  );
}

function BriefingSectionBlock({
  section,
  focus,
  onOpen,
}: {
  section: BriefingSection;
  focus: readonly FocusNowRow[];
  onOpen: (target: NonNullable<BriefingLineTarget>) => void;
}) {
  return (
    <View className="mt-3">
      <AppText variant="overline" tone="on-gradient-muted" numberOfLines={1}>
        {section.title}
      </AppText>
      {section.lines.map((line, index) => (
        <BriefingLineView
          key={`${section.kind}:${index}`}
          line={line}
          target={briefingLineTarget(line, focus)}
          onOpen={onOpen}
        />
      ))}
    </View>
  );
}

export function BriefingCard({ children }: { children?: ReactNode }) {
  const router = useRouter();
  const today = useToday();
  const academic = useAcademicToday();
  const health = useHealthSummary();
  const memories = useMemoriesForIntelligence();
  const memorySettings = useMemorySettings();

  if (today.data === undefined || today.isError) return null;
  // Wait for the optional sources to SETTLE (data or error) before the
  // first render, the Focus Now card's own posture: a gradient block that
  // grows a section mid-view on every cold load reads as a glitch (10.6
  // review, finding 5). A failed source still contributes nothing below.
  // Memory (ADR-077 §5) is in the same set, on the same terms.
  if (academic.data === undefined && !academic.isError) return null;
  if (health.data === undefined && !health.isError) return null;
  const memory = memoryIntelligenceInput(memories, memorySettings);
  if (!memory.settled) return null;

  // A source that failed contributes nothing -- exactly as if it had not
  // loaded -- rather than a stale or partial section.
  const view = briefingFor(
    today.data,
    academic.isError ? undefined : academic.data,
    health.isError ? undefined : health.data,
    new Date(today.dataUpdatedAt),
    memory,
  );
  if (view === null) return null;
  const { briefing, focus } = view;

  const onOpen = (target: NonNullable<BriefingLineTarget>) => {
    if (target.kind === "task") {
      router.push(`/tasks/${target.taskId}` as Href);
      return;
    }
    openAssignmentSheet({
      assignment: target.row.priorityItem.assignment,
      explanation: focusNowExplanation(target.row),
    });
  };

  return (
    <GradientCard gradient="hero" className="mt-4" testID="today-briefing">
      <View className="flex-row items-center justify-between gap-3">
        <AppText variant="overline" tone="on-gradient-muted">
          Briefing
        </AppText>
        <AppText variant="caption" tone="on-gradient-muted" numberOfLines={1}>
          {formatShortDate(today.data.local_date)}
        </AppText>
      </View>
      <AppText
        variant="headline"
        tone="on-gradient"
        className="mt-1"
        accessibilityRole="header"
        testID="today-briefing-headline"
      >
        {briefing.headline}
      </AppText>
      {briefing.sections.map((section) => (
        <BriefingSectionBlock key={section.kind} section={section} focus={focus} onOpen={onOpen} />
      ))}
      {children}
    </GradientCard>
  );
}
