import { describe, expect, it } from "vitest";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  NOTE_BODY_MAX_CHARS,
  PARSER_PROJECT_REF_MAX_CHARS,
  PARSER_REASON_MAX_CHARS,
  PROJECT_GOAL_MAX_CHARS,
  TASK_BODY_MAX_CHARS,
  tooLongMessage,
} from "./text-bounds.js";
import { EventCreateSchema, EventDetachSchema, EventSchema, EventUpdateSchema } from "./events.js";
import { NoteCreateSchema, NoteSchema, NoteUpdateSchema } from "./notes.js";
import {
  CreateEventToolSchema,
  CreateNoteToolSchema,
  CreateTaskToolSchema,
  ParserToolCallSchema,
  UnclearToolSchema,
} from "./parser-tools.js";
import { ProjectCreateSchema, ProjectSchema, ProjectUpdateSchema } from "./projects.js";
import { TaskCreateSchema, TaskSchema, TaskUpdateSchema } from "./tasks.js";
import type { z } from "zod";

const ID = "11111111-1111-4111-8111-111111111111";
const TS = "2026-09-14T12:00:00.000Z";
const TZ = "America/Chicago";

/** `n` UTF-16 code units of a plain letter -- the unit both Zod and RN count in. */
const chars = (n: number) => "x".repeat(n);

// Minimal VALID bodies for each create schema, so that the only thing a
// case varies is the one bounded field under test.
const TASK_CREATE = { title: "t", timezone: TZ };
const NOTE_CREATE = { title: "t", body: "b" };
const EVENT_CREATE = {
  title: "t",
  timezone: TZ,
  starts_at: "2026-09-14T10:00:00-05:00",
  ends_at: "2026-09-14T11:00:00-05:00",
};
const EVENT_DETACH = { original_start_at: TS };
const PROJECT_CREATE = { name: "p" };

interface BoundCase {
  name: string;
  schema: z.ZodType;
  base: Record<string, unknown>;
  field: string;
  max: number;
  /** The `.max()` message, when the schema names one (tool schemas do not). */
  message: string | null;
}

const USER_TYPED: BoundCase[] = [
  {
    name: "TaskCreate.title",
    schema: TaskCreateSchema,
    base: TASK_CREATE,
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "TaskCreate.body",
    schema: TaskCreateSchema,
    base: TASK_CREATE,
    field: "body",
    max: TASK_BODY_MAX_CHARS,
    message: tooLongMessage("body", TASK_BODY_MAX_CHARS),
  },
  {
    name: "TaskUpdate.title",
    schema: TaskUpdateSchema,
    base: {},
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "TaskUpdate.body",
    schema: TaskUpdateSchema,
    base: {},
    field: "body",
    max: TASK_BODY_MAX_CHARS,
    message: tooLongMessage("body", TASK_BODY_MAX_CHARS),
  },
  {
    name: "NoteCreate.title",
    schema: NoteCreateSchema,
    base: NOTE_CREATE,
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "NoteCreate.body",
    schema: NoteCreateSchema,
    base: NOTE_CREATE,
    field: "body",
    max: NOTE_BODY_MAX_CHARS,
    message: tooLongMessage("body", NOTE_BODY_MAX_CHARS),
  },
  {
    name: "NoteUpdate.title",
    schema: NoteUpdateSchema,
    base: {},
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "NoteUpdate.body",
    schema: NoteUpdateSchema,
    base: {},
    field: "body",
    max: NOTE_BODY_MAX_CHARS,
    message: tooLongMessage("body", NOTE_BODY_MAX_CHARS),
  },
  {
    name: "EventCreate.title",
    schema: EventCreateSchema,
    base: EVENT_CREATE,
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "EventCreate.description",
    schema: EventCreateSchema,
    base: EVENT_CREATE,
    field: "description",
    max: EVENT_DESCRIPTION_MAX_CHARS,
    message: tooLongMessage("description", EVENT_DESCRIPTION_MAX_CHARS),
  },
  {
    name: "EventCreate.location",
    schema: EventCreateSchema,
    base: EVENT_CREATE,
    field: "location",
    max: EVENT_LOCATION_MAX_CHARS,
    message: tooLongMessage("location", EVENT_LOCATION_MAX_CHARS),
  },
  {
    name: "EventUpdate.title",
    schema: EventUpdateSchema,
    base: {},
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "EventUpdate.description",
    schema: EventUpdateSchema,
    base: {},
    field: "description",
    max: EVENT_DESCRIPTION_MAX_CHARS,
    message: tooLongMessage("description", EVENT_DESCRIPTION_MAX_CHARS),
  },
  {
    name: "EventUpdate.location",
    schema: EventUpdateSchema,
    base: {},
    field: "location",
    max: EVENT_LOCATION_MAX_CHARS,
    message: tooLongMessage("location", EVENT_LOCATION_MAX_CHARS),
  },
  {
    name: "EventDetach.title",
    schema: EventDetachSchema,
    base: EVENT_DETACH,
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("title", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "EventDetach.description",
    schema: EventDetachSchema,
    base: EVENT_DETACH,
    field: "description",
    max: EVENT_DESCRIPTION_MAX_CHARS,
    message: tooLongMessage("description", EVENT_DESCRIPTION_MAX_CHARS),
  },
  {
    name: "EventDetach.location",
    schema: EventDetachSchema,
    base: EVENT_DETACH,
    field: "location",
    max: EVENT_LOCATION_MAX_CHARS,
    message: tooLongMessage("location", EVENT_LOCATION_MAX_CHARS),
  },
  {
    name: "ProjectCreate.name",
    schema: ProjectCreateSchema,
    base: PROJECT_CREATE,
    field: "name",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("name", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "ProjectCreate.goal",
    schema: ProjectCreateSchema,
    base: PROJECT_CREATE,
    field: "goal",
    max: PROJECT_GOAL_MAX_CHARS,
    message: tooLongMessage("goal", PROJECT_GOAL_MAX_CHARS),
  },
  {
    name: "ProjectCreate.color",
    schema: ProjectCreateSchema,
    base: PROJECT_CREATE,
    field: "color",
    max: 64,
    message: null,
  },
  {
    name: "ProjectUpdate.name",
    schema: ProjectUpdateSchema,
    base: {},
    field: "name",
    max: ENTITY_TITLE_MAX_CHARS,
    message: tooLongMessage("name", ENTITY_TITLE_MAX_CHARS),
  },
  {
    name: "ProjectUpdate.goal",
    schema: ProjectUpdateSchema,
    base: {},
    field: "goal",
    max: PROJECT_GOAL_MAX_CHARS,
    message: tooLongMessage("goal", PROJECT_GOAL_MAX_CHARS),
  },
  {
    name: "ProjectUpdate.color",
    schema: ProjectUpdateSchema,
    base: {},
    field: "color",
    max: 64,
    message: null,
  },
];

// The parser tool schemas are the model-output boundary: the worker
// truncates the model's args to these bounds BEFORE parsing (ADR-065), so
// the schema's job is to make an un-truncated over-long value a parse
// failure. They carry no custom message because no person reads it.
const MODEL_AUTHORED: BoundCase[] = [
  {
    name: "CreateTaskTool.title",
    schema: CreateTaskToolSchema,
    base: { title: "t" },
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateTaskTool.project",
    schema: CreateTaskToolSchema,
    base: { title: "t" },
    field: "project",
    max: PARSER_PROJECT_REF_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateNoteTool.title",
    schema: CreateNoteToolSchema,
    base: { title: "t", body: "" },
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateNoteTool.body",
    schema: CreateNoteToolSchema,
    base: { title: "t", body: "" },
    field: "body",
    max: NOTE_BODY_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateNoteTool.project",
    schema: CreateNoteToolSchema,
    base: { title: "t", body: "" },
    field: "project",
    max: PARSER_PROJECT_REF_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateEventTool.title",
    schema: CreateEventToolSchema,
    base: { title: "t", start: TS },
    field: "title",
    max: ENTITY_TITLE_MAX_CHARS,
    message: null,
  },
  {
    name: "CreateEventTool.location",
    schema: CreateEventToolSchema,
    base: { title: "t", start: TS },
    field: "location",
    max: EVENT_LOCATION_MAX_CHARS,
    message: null,
  },
  {
    name: "UnclearTool.reason",
    schema: UnclearToolSchema,
    base: {},
    field: "reason",
    max: PARSER_REASON_MAX_CHARS,
    message: null,
  },
];

describe("the constants", () => {
  it("are the ADR-065 numbers", () => {
    expect(ENTITY_TITLE_MAX_CHARS).toBe(512);
    expect(TASK_BODY_MAX_CHARS).toBe(4000);
    expect(NOTE_BODY_MAX_CHARS).toBe(20_000);
    expect(EVENT_DESCRIPTION_MAX_CHARS).toBe(4000);
    expect(EVENT_LOCATION_MAX_CHARS).toBe(512);
    expect(PROJECT_GOAL_MAX_CHARS).toBe(2000);
    expect(PARSER_REASON_MAX_CHARS).toBe(1000);
    expect(PARSER_PROJECT_REF_MAX_CHARS).toBe(200);
  });

  it("tooLongMessage names the field and the bound", () => {
    expect(tooLongMessage("title", 512)).toBe("title must be at most 512 characters");
  });
});

describe.each([...USER_TYPED, ...MODEL_AUTHORED])(
  "$name",
  ({ schema, base, field, max, message }) => {
    it("accepts a value exactly at the bound", () => {
      const result = schema.safeParse({ ...base, [field]: chars(max) });
      expect(result.success, result.success ? "" : JSON.stringify(result.error.issues)).toBe(true);
    });

    it("rejects one character over the bound, naming the field in the issue path", () => {
      const result = schema.safeParse({ ...base, [field]: chars(max + 1) });
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find((i) => i.path.join(".") === field);
      expect(issue, "an issue on the field").toBeDefined();
      if (message !== null) expect(issue?.message).toBe(message);
    });

    it("counts UTF-16 code units, so an astral character costs two", () => {
      // 😀 is one code point and two code units; `max` of them is over the bound.
      const emoji = "😀".repeat(Math.ceil(max / 2) + 1);
      expect(schema.safeParse({ ...base, [field]: emoji }).success).toBe(false);
      const fits = "😀".repeat(Math.floor(max / 2));
      expect(schema.safeParse({ ...base, [field]: fits }).success).toBe(true);
    });
  },
);

describe("the parser tool-call union", () => {
  it("rejects an over-long argument through the discriminated union too", () => {
    expect(
      ParserToolCallSchema.safeParse({
        tool: "create_task",
        args: { title: chars(ENTITY_TITLE_MAX_CHARS + 1) },
      }).success,
    ).toBe(false);
    expect(
      ParserToolCallSchema.safeParse({
        tool: "unclear",
        args: { reason: chars(PARSER_REASON_MAX_CHARS + 1) },
      }).success,
    ).toBe(false);
    expect(
      ParserToolCallSchema.safeParse({
        tool: "unclear",
        args: { reason: chars(PARSER_REASON_MAX_CHARS) },
      }).success,
    ).toBe(true);
  });
});

describe("READ schemas stay unbounded -- a legacy row must keep reading back", () => {
  const OVER_TITLE = chars(ENTITY_TITLE_MAX_CHARS * 4);
  const OVER_BODY = chars(NOTE_BODY_MAX_CHARS * 2);

  it("TaskSchema", () => {
    const task = {
      id: ID,
      title: OVER_TITLE,
      body: OVER_BODY,
      status: "active",
      due_at: null,
      remind_at: null,
      timezone: TZ,
      priority: null,
      project_id: null,
      canvas_assignment_id: null,
      completed_at: null,
      rrule: null,
      recurrence_anchor: null,
      recurrence_timezone: null,
      recurrence_until: null,
      recurrence_count: null,
      recurrence_exdates: null,
      archived_at: null,
      created_at: TS,
      updated_at: TS,
    };
    expect(TaskSchema.safeParse(task).success).toBe(true);
  });

  it("NoteSchema", () => {
    const note = {
      id: ID,
      title: OVER_TITLE,
      body: OVER_BODY,
      project_id: null,
      archived_at: null,
      created_at: TS,
      updated_at: TS,
    };
    expect(NoteSchema.safeParse(note).success).toBe(true);
  });

  it("EventSchema", () => {
    const event = {
      id: ID,
      title: OVER_TITLE,
      description: OVER_BODY,
      location: OVER_TITLE,
      starts_at: TS,
      ends_at: TS,
      timezone: TZ,
      all_day: false,
      start_date: null,
      end_date: null,
      rrule: null,
      recurrence_timezone: null,
      recurrence_until: null,
      recurrence_count: null,
      recurrence_exdates: null,
      parent_event_id: null,
      original_start_at: null,
      project_id: null,
      archived_at: null,
      origin: "external",
      sync: null,
      created_at: TS,
      updated_at: TS,
    };
    expect(EventSchema.safeParse(event).success).toBe(true);
  });

  it("ProjectSchema", () => {
    const project = {
      id: ID,
      name: OVER_TITLE,
      status: "active",
      goal: OVER_BODY,
      color: chars(200),
      target_date: null,
      completed_at: null,
      archived_at: null,
      created_at: TS,
      updated_at: TS,
    };
    expect(ProjectSchema.safeParse(project).success).toBe(true);
  });
});
