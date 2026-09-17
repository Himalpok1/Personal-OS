// Self-contained, self-fetching Agenda component -- same shape as (tabs)/
// index.tsx's TodayScreen (owns its own state, fetches its own data), so
// the calendar screen's integration owner can mount <AgendaView /> with no
// required props, exactly like Today is mounted as a tab screen.
//
// Checkpoint 10.3: composed on the design system -- `Screen` owns the canvas,
// the floating-button clearance and pull-to-refresh; each day is a Card of
// ListRows; the project filter is a row of ChoiceChips.
import type { AgendaDay, AgendaResponse } from "@personal-os/schema";
import { useMemo, useState, type JSX } from "react";
import { ScrollView, View } from "react-native";
import { useAgenda } from "@/queries/agenda";
import { useProjects } from "@/queries/projects";
import { ChoiceChip } from "@/components/ask/choice-chip";
import {
  AppText,
  Card,
  EmptyState,
  ErrorState,
  Screen,
  ScreenCentered,
  SkeletonList,
} from "@/components/ui";
import { AgendaItemRow, SectionHeader, agendaItemKey } from "./agenda-rows";
import { defaultAgendaRange, filterNonEmptyDays, formatAgendaDayLabel } from "./agenda-grouping";

function todayLocalDateString(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function ProjectFilterBar({
  selectedProjectId,
  onSelect,
}: {
  selectedProjectId: string | undefined;
  onSelect: (projectId: string | undefined) => void;
}) {
  const { data: projects } = useProjects();
  if (!projects || projects.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4 mt-3"
      contentContainerClassName="flex-row gap-2 px-4"
    >
      {/* Role + selected state on both chip shapes: selection was previously
          conveyed by border/background color alone with nothing in the
          accessibility tree, unlike every other picker in the app (6.7A, AY5). */}
      <ChoiceChip
        label="All"
        selected={selectedProjectId === undefined}
        onPress={() => onSelect(undefined)}
        accessibilityLabel="All projects"
      />
      {projects.map((project) => (
        <ChoiceChip
          key={project.id}
          label={project.name}
          selected={selectedProjectId === project.id}
          onPress={() => onSelect(project.id)}
          accessibilityLabel={`Filter by project: ${project.name}`}
        />
      ))}
    </ScrollView>
  );
}

function OverdueSection({ items }: { items: AgendaResponse["overdue"] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={`Overdue · ${items.length}`} tone="red" />
      <Card padding="none">
        {items.map((item, index) => (
          <AgendaItemRow key={agendaItemKey(item)} item={item} last={index === items.length - 1} />
        ))}
      </Card>
    </View>
  );
}

function DaySection({ day, todayLocalDate }: { day: AgendaDay; todayLocalDate: string }) {
  if (day.items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={formatAgendaDayLabel(day.date, todayLocalDate)} tone="neutral" />
      <Card padding="none">
        {day.items.map((item, index) => (
          <AgendaItemRow
            key={agendaItemKey(item)}
            item={item}
            last={index === day.items.length - 1}
          />
        ))}
      </Card>
    </View>
  );
}

export function AgendaView(): JSX.Element {
  const todayLocalDate = useMemo(() => todayLocalDateString(), []);
  const { from, to } = useMemo(() => defaultAgendaRange(todayLocalDate), [todayLocalDate]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, isRefetching, refetch } = useAgenda({
    from,
    to,
    projectId,
  });

  if (isLoading) {
    return (
      <ScreenCentered>
        <SkeletonList className="w-full" />
      </ScreenCentered>
    );
  }

  if (isError || !data) {
    return (
      <ScreenCentered>
        <ErrorState
          message="Couldn't load the agenda."
          onRetry={() => void refetch()}
          retryAccessibilityLabel="Retry loading the agenda"
        />
      </ScreenCentered>
    );
  }

  const visibleDays = filterNonEmptyDays(data.days);
  const isWhollyEmpty = data.overdue.length === 0 && visibleDays.length === 0;

  return (
    <Screen refreshing={isRefetching} onRefresh={() => void refetch()}>
      <View className="pt-4">
        <AppText variant="title" accessibilityRole="header">
          Agenda
        </AppText>
        <AppText variant="caption" tone="secondary">
          {data.from} – {data.to}
        </AppText>
      </View>

      <ProjectFilterBar selectedProjectId={projectId} onSelect={setProjectId} />

      {isWhollyEmpty ? (
        <EmptyState
          icon="calendar-check-outline"
          tone="success"
          title="Nothing scheduled in this range."
          className="py-12"
        />
      ) : (
        <>
          <OverdueSection items={data.overdue} />
          {visibleDays.map((day) => (
            <DaySection key={day.date} day={day} todayLocalDate={todayLocalDate} />
          ))}
        </>
      )}
    </Screen>
  );
}
