import { truncateProviderString } from "@personal-os/core/mail/provider-strings";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
} from "@personal-os/schema";
import ICAL from "ical.js";
import { googleAllDayToLocal, localAllDayToGoogle } from "../translate.js";

export interface CalDavTranslateOptions {
  dtstamp?: Date;
  prodId?: string;
}

export interface CalDavEventFields {
  title: string;
  description: string | null;
  location: string | null;
  allDay: boolean;
  startsAt?: Date;
  endsAt?: Date;
  startLocal?: Date;
  endLocal?: Date;
  timezone?: string;
  startDate?: string;
  endDate?: string;
  rrule?: string;
  recurrenceUntil?: Date;
  recurrenceCount?: number;
  recurrenceTimezone?: string;
  recurrenceExdates?: string[];
  caldavResourceUrl: string;
  caldavEtag: string;
  caldavUpdated?: Date;
  caldavIcalUid?: string;
}

export type CalDavMutationIntent =
  | {
      kind: "upsert_standalone_or_master";
      resourceHref: string;
      etag: string;
      icalUid?: string;
      updatedAt?: Date;
      fields: CalDavEventFields;
    }
  | {
      kind: "detach_instance";
      resourceHref: string;
      originalStartInstant: Date;
      etag: string;
      updatedAt?: Date;
      fields: CalDavEventFields;
    }
  | {
      kind: "cancel_instance";
      resourceHref: string;
      originalStartInstant: Date;
      etag: string;
      updatedAt?: Date;
    };

export function parseVCalendarToMutationIntents(
  icsString: string,
  resourceHref: string,
  etag: string,
): CalDavMutationIntent[] {
  let jcalData: [string, unknown[], unknown[]];
  try {
    jcalData = ICAL.parse(icsString) as [string, unknown[], unknown[]];
  } catch (err: unknown) {
    throw new Error(
      `Failed to parse iCalendar payload at ${resourceHref}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const comp = new ICAL.Component(jcalData);
  const vevents = comp.getAllSubcomponents("vevent");
  if (vevents.length === 0) return [];

  const intents: CalDavMutationIntent[] = [];
  let masterEvent: ICAL.Event | undefined;
  let masterUid: string = "";

  // Separate master and exception VEVENTs
  for (const v of vevents) {
    const event = new ICAL.Event(v);
    const recurrenceId = v.getFirstPropertyValue("recurrence-id");

    if (!recurrenceId) {
      masterEvent = event;
      masterUid = event.uid || "";
    }
  }

  // If no explicit master found, use the first VEVENT as master
  if (!masterEvent && vevents.length > 0) {
    masterEvent = new ICAL.Event(vevents[0]);
    masterUid = masterEvent.uid || "";
  }

  // 1. Process Master
  if (masterEvent) {
    const fields = veventToCalDavFields(masterEvent, resourceHref, etag, masterUid);
    intents.push({
      kind: "upsert_standalone_or_master",
      resourceHref,
      icalUid: masterUid || undefined,
      etag,
      updatedAt: extractLastModified(masterEvent),
      fields,
    });
  }

  // 2. Process Exceptions
  for (const v of vevents) {
    const recurrenceIdProp = v.getFirstProperty("recurrence-id");
    if (!recurrenceIdProp) continue;

    const event = new ICAL.Event(v);
    const recVal = recurrenceIdProp.getFirstValue();
    const originalStartInstant = icalTimeToDate(recVal);
    const status = (v.getFirstPropertyValue("status") || "").toString().toUpperCase();

    if (status === "CANCELLED") {
      intents.push({
        kind: "cancel_instance",
        resourceHref,
        originalStartInstant,
        etag,
        updatedAt: extractLastModified(event),
      });
    } else {
      const fields = veventToCalDavFields(event, resourceHref, etag, masterUid);
      intents.push({
        kind: "detach_instance",
        resourceHref,
        originalStartInstant,
        etag,
        updatedAt: extractLastModified(event),
        fields,
      });
    }
  }

  return intents;
}

function veventToCalDavFields(
  event: ICAL.Event,
  resourceHref: string,
  etag: string,
  uidFallback?: string,
): CalDavEventFields {
  const comp = event.component;
  // Third-party text, bounded at write (Checkpoint 9.6, ADR-065) -- the same
  // surrogate-safe truncation the Google path applies, so a CalDAV server's
  // oversized DESCRIPTION cannot put more into `events` than a typed one may.
  const summary =
    truncateProviderString(event.summary || "Untitled event", ENTITY_TITLE_MAX_CHARS) ??
    "Untitled event";
  const description = truncateProviderString(
    event.description || null,
    EVENT_DESCRIPTION_MAX_CHARS,
  );
  const location = truncateProviderString(event.location || null, EVENT_LOCATION_MAX_CHARS);

  const dtstart = event.startDate;
  const dtend = event.endDate;
  const isAllDay = dtstart ? dtstart.isDate : false;

  let allDay = false;
  let startDate: string | undefined;
  let endDate: string | undefined;
  let startsAt: Date | undefined;
  let endsAt: Date | undefined;
  let startLocal: Date | undefined;
  let endLocal: Date | undefined;
  let timezone: string = "UTC";

  if (isAllDay && dtstart) {
    allDay = true;
    const startStr = dtstart.toICALString(); // YYYYMMDD
    const endStr = dtend ? dtend.toICALString() : startStr;
    const { googleStartDate, googleEndDate } = {
      googleStartDate: formatIcalDateStr(startStr),
      googleEndDate: formatIcalDateStr(endStr),
    };
    const local = googleAllDayToLocal(googleStartDate, googleEndDate);
    startDate = local.startDate;
    endDate = local.endDate;
  } else if (dtstart) {
    startsAt = dtstart.toJSDate();
    endsAt = dtend ? dtend.toJSDate() : startsAt;
    timezone = dtstart.zone ? dtstart.zone.tzid || "UTC" : "UTC";
    startLocal = new Date(
      dtstart.year,
      dtstart.month - 1,
      dtstart.day,
      dtstart.hour,
      dtstart.minute,
      dtstart.second,
    );
    if (dtend) {
      endLocal = new Date(
        dtend.year,
        dtend.month - 1,
        dtend.day,
        dtend.hour,
        dtend.minute,
        dtend.second,
      );
    }
  }

  // RRULE & EXDATE
  let rrule: string | undefined;
  let recurrenceUntil: Date | undefined;
  let recurrenceCount: number | undefined;
  const recurrenceExdates: string[] = [];

  const rruleProp = comp.getFirstProperty("rrule");
  if (rruleProp) {
    const rruleObj = rruleProp.getFirstValue() as ICAL.Recur;
    if (rruleObj) {
      // Build clean RRULE string without UNTIL/COUNT
      const parts: string[] = [`FREQ=${rruleObj.freq}`];
      if (rruleObj.interval && rruleObj.interval > 1) parts.push(`INTERVAL=${rruleObj.interval}`);
      if (rruleObj.parts && Object.keys(rruleObj.parts).length > 0) {
        for (const [k, v] of Object.entries(rruleObj.parts)) {
          if (k !== "UNTIL" && k !== "COUNT" && v) {
            parts.push(`${k}=${Array.isArray(v) ? v.join(",") : v}`);
          }
        }
      }
      rrule = parts.join(";");

      if (rruleObj.until) {
        recurrenceUntil = rruleObj.until.toJSDate();
      }
      if (rruleObj.count) {
        recurrenceCount = rruleObj.count;
      }
    }
  }

  // EXDATES
  const exdateProps = comp.getAllProperties("exdate");
  for (const ex of exdateProps) {
    const val = ex.getFirstValue();
    if (val) {
      const exDate = icalTimeToDate(val);
      recurrenceExdates.push(exDate.toISOString().slice(0, 10));
    }
  }

  return {
    title: summary,
    description,
    location,
    allDay,
    startDate,
    endDate,
    startsAt,
    endsAt,
    startLocal,
    endLocal,
    timezone,
    rrule,
    recurrenceTimezone: rrule ? timezone : undefined,
    recurrenceUntil,
    recurrenceCount,
    recurrenceExdates: recurrenceExdates.length > 0 ? recurrenceExdates : undefined,
    caldavResourceUrl: resourceHref,
    caldavEtag: etag,
    caldavUpdated: extractLastModified(event),
    caldavIcalUid: event.uid || uidFallback,
  };
}

function extractLastModified(event: ICAL.Event): Date | undefined {
  const comp = event.component;
  const lastMod = comp.getFirstPropertyValue("last-modified");
  if (lastMod instanceof ICAL.Time) {
    return lastMod.toJSDate();
  }
  const dtstamp = comp.getFirstPropertyValue("dtstamp");
  if (dtstamp instanceof ICAL.Time) {
    return dtstamp.toJSDate();
  }
  return undefined;
}

function icalTimeToDate(timeVal: unknown): Date {
  if (timeVal instanceof ICAL.Time) {
    return timeVal.toJSDate();
  }
  if (typeof timeVal === "string") {
    return new Date(timeVal);
  }
  return new Date();
}

function formatIcalDateStr(ymd: string): string {
  if (ymd.length === 8) {
    return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
  }
  return ymd;
}

export function localEventToVCalendar(
  event: Partial<CalDavEventFields> & { title: string; allDay: boolean; uid?: string },
  options: CalDavTranslateOptions = {},
): string {
  const vcal = new ICAL.Component("vcalendar");
  vcal.addPropertyWithValue("version", "2.0");
  vcal.addPropertyWithValue("prodid", options.prodId || "-//Personal OS//EN");

  const vevent = new ICAL.Component("vevent");
  const uid = event.uid || event.caldavIcalUid || `${crypto.randomUUID()}@personal-os.local`;
  vevent.addPropertyWithValue("uid", uid);

  const dtstampTime = options.dtstamp
    ? ICAL.Time.fromJSDate(options.dtstamp, true)
    : ICAL.Time.now();
  vevent.addPropertyWithValue("dtstamp", dtstampTime);

  vevent.addPropertyWithValue("summary", event.title);
  if (event.description) vevent.addPropertyWithValue("description", event.description);
  if (event.location) vevent.addPropertyWithValue("location", event.location);

  if (event.allDay && event.startDate) {
    const { googleStartDate, googleEndDate } = localAllDayToGoogle(
      event.startDate,
      event.endDate ?? event.startDate,
    );
    const startObj = ICAL.Time.fromDateString(googleStartDate);
    startObj.isDate = true;
    vevent.addPropertyWithValue("dtstart", startObj);

    const endObj = ICAL.Time.fromDateString(googleEndDate);
    endObj.isDate = true;
    vevent.addPropertyWithValue("dtend", endObj);
  } else if (event.startsAt) {
    const startObj = ICAL.Time.fromJSDate(event.startsAt, false);
    if (event.timezone && event.timezone !== "UTC") {
      startObj.zone = new ICAL.Timezone({ tzid: event.timezone });
    }
    vevent.addPropertyWithValue("dtstart", startObj);

    if (event.endsAt) {
      const endObj = ICAL.Time.fromJSDate(event.endsAt, false);
      if (event.timezone && event.timezone !== "UTC") {
        endObj.zone = new ICAL.Timezone({ tzid: event.timezone });
      }
      vevent.addPropertyWithValue("dtend", endObj);
    }
  }

  // Recurrence
  if (event.rrule) {
    let rruleStr = event.rrule;
    if (event.recurrenceUntil) {
      const untilStr = event.recurrenceUntil.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
      rruleStr += `;UNTIL=${untilStr}`;
    }
    if (event.recurrenceCount) {
      rruleStr += `;COUNT=${event.recurrenceCount}`;
    }
    vevent.addPropertyWithValue("rrule", ICAL.Recur.fromString(rruleStr));
  }

  if (event.recurrenceExdates && event.recurrenceExdates.length > 0) {
    for (const ex of event.recurrenceExdates) {
      const exTime = ICAL.Time.fromDateString(ex);
      exTime.isDate = true;
      vevent.addPropertyWithValue("exdate", exTime);
    }
  }

  vcal.addSubcomponent(vevent);
  return vcal.toString();
}

/**
 * Modifies an existing VCALENDAR payload to apply a single-occurrence exception (RFC 4791 single resource model).
 */
export function applyExceptionToVCalendar(
  existingIcsString: string,
  exception: {
    kind: "detach" | "cancel";
    originalStartInstant: Date;
    fields?: Partial<CalDavEventFields>;
  },
): string {
  const jcal = ICAL.parse(existingIcsString) as unknown as [string, unknown[], unknown[]];
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  let masterUid = "";
  for (const v of vevents) {
    if (!v.getFirstProperty("recurrence-id")) {
      const uidVal = v.getFirstPropertyValue("uid");
      masterUid = typeof uidVal === "string" ? uidVal : "";
      break;
    }
  }

  const recTime = ICAL.Time.fromJSDate(exception.originalStartInstant, false);

  if (exception.kind === "cancel") {
    let masterVevent: ICAL.Component | undefined;
    for (const v of vevents) {
      if (!v.getFirstProperty("recurrence-id")) {
        masterVevent = v;
        break;
      }
    }
    if (masterVevent) {
      recTime.isDate = true;
      masterVevent.addPropertyWithValue("exdate", recTime);
    }
  } else if (exception.kind === "detach" && exception.fields) {
    const excVevent = new ICAL.Component("vevent");
    excVevent.addPropertyWithValue("uid", masterUid || `${crypto.randomUUID()}@personal-os.local`);
    excVevent.addPropertyWithValue("recurrence-id", recTime);
    if (exception.fields.title) excVevent.addPropertyWithValue("summary", exception.fields.title);
    if (exception.fields.description)
      excVevent.addPropertyWithValue("description", exception.fields.description);
    if (exception.fields.location)
      excVevent.addPropertyWithValue("location", exception.fields.location);

    if (exception.fields.allDay && exception.fields.startDate) {
      const { googleStartDate, googleEndDate } = localAllDayToGoogle(
        exception.fields.startDate,
        exception.fields.endDate ?? exception.fields.startDate,
      );
      const s = ICAL.Time.fromDateString(googleStartDate);
      s.isDate = true;
      excVevent.addPropertyWithValue("dtstart", s);
      const e = ICAL.Time.fromDateString(googleEndDate);
      e.isDate = true;
      excVevent.addPropertyWithValue("dtend", e);
    } else if (exception.fields.startsAt) {
      excVevent.addPropertyWithValue(
        "dtstart",
        ICAL.Time.fromJSDate(exception.fields.startsAt, false),
      );
      if (exception.fields.endsAt) {
        excVevent.addPropertyWithValue(
          "dtend",
          ICAL.Time.fromJSDate(exception.fields.endsAt, false),
        );
      }
    }
    comp.addSubcomponent(excVevent);
  }

  return comp.toString();
}
