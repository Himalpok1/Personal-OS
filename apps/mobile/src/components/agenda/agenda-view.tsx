// Self-contained, self-fetching Agenda component -- same shape as (tabs)/
// index.tsx's TodayScreen (owns its own state, fetches its own data), so
// the calendar screen's integration owner can mount <AgendaView /> with no
// required props, exactly like Today is mounted as a tab screen.
import type { AgendaDay, AgendaResponse } from "@personal-os/schema";
import { useMemo, useState, type JSX } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useAgenda } from "@/queries/agenda";
import { useProjects } from "@/queries/projects";
import { FLOATING_CLEARANCE } from "@/components/floating-layout";
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
      className="mt-3"
      contentContainerClassName="flex-row gap-2 px-4"
    >
      <Pressable onPress={() => onSelect(undefined)} hitSlop={4}>
        <View
          className={`min-h-[40px] items-center justify-center rounded-full border px-3 ${
            selectedProjectId === undefined
              ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
              : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
          }`}
        >
          <Text
            className={`text-sm ${
              selectedProjectId === undefined
                ? "text-blue-600 dark:text-blue-400"
                : "text-black dark:text-white"
            }`}
          >
            All
          </Text>
        </View>
      </Pressable>
      {projects.map((project) => (
        <Pressable key={project.id} onPress={() => onSelect(project.id)} hitSlop={4}>
          <View
            className={`min-h-[40px] items-center justify-center rounded-full border px-3 ${
              selectedProjectId === project.id
                ? "border-blue-600 bg-blue-50 dark:bg-blue-950"
                : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            }`}
          >
            <Text
              className={`text-sm ${
                selectedProjectId === project.id
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-black dark:text-white"
              }`}
              numberOfLines={1}
            >
              {project.name}
            </Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function OverdueSection({ items }: { items: AgendaResponse["overdue"] }) {
  if (items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={`Overdue · ${items.length}`} tone="red" />
      {items.map((item) => (
        <AgendaItemRow key={agendaItemKey(item)} item={item} />
      ))}
    </View>
  );
}

function DaySection({ day, todayLocalDate }: { day: AgendaDay; todayLocalDate: string }) {
  if (day.items.length === 0) return null;
  return (
    <View>
      <SectionHeader title={formatAgendaDayLabel(day.date, todayLocalDate)} tone="neutral" />
      {day.items.map((item) => (
        <AgendaItemRow key={agendaItemKey(item)} item={item} />
      ))}
    </View>
  );
}

export function AgendaView(): JSX.Element {
  const todayLocalDate = useMemo(() => todayLocalDateString(), []);
  const { from, to } = useMemo(() => defaultAgendaRange(todayLocalDate), [todayLocalDate]);
  const [projectId, setProjectId] = useState<string | undefined>(undefined);

  const { data, isLoading, isError, refetch } = useAgenda({ from, to, projectId });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500">Loading…</Text>
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-white dark:bg-black">
        <Text className="text-red-600">Couldn&apos;t load the agenda.</Text>
        <Pressable
          onPress={() => void refetch()}
          hitSlop={4}
          className="min-h-[40px] rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <Text className="font-semibold text-white">Retry</Text>
        </Pressable>
      </View>
    );
  }

  const visibleDays = filterNonEmptyDays(data.days);
  const isWhollyEmpty = data.overdue.length === 0 && visibleDays.length === 0;

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerClassName={FLOATING_CLEARANCE}
    >
      <View className="px-4 pt-4">
        <Text className="text-2xl font-bold text-black dark:text-white">Agenda</Text>
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">
          {data.from} – {data.to}
        </Text>
      </View>

      <ProjectFilterBar selectedProjectId={projectId} onSelect={setProjectId} />

      {isWhollyEmpty ? (
        <View className="items-center px-4 py-12">
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">
            Nothing scheduled in this range.
          </Text>
        </View>
      ) : (
        <>
          <OverdueSection items={data.overdue} />
          {visibleDays.map((day) => (
            <DaySection key={day.date} day={day} todayLocalDate={todayLocalDate} />
          ))}
        </>
      )}
    </ScrollView>
  );
}
