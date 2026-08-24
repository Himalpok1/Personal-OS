import { civilDateToLocalDate, type GoogleCivilDateTime } from "./civil-time.js";

// ADR-049: the ONLY place the health day-attribution rule exists.
//
// A sleep session is attributed to its civil END (wake) date; an exercise to
// its civil START date.
//
// Three reasons, the second decisive:
//   1. It matches the question people actually ask -- "how did I sleep last
//      night?" is asked on the morning of the 24th about sleep that began on
//      the 23rd.
//   2. Google's own daily-* types computed from the sleep period
//      (daily-resting-heart-rate, daily-heart-rate-variability,
//      daily-sleep-temperature-derivations) are reported on ONE civil date.
//      Wake-date attribution is what keeps a sleep-to-daily-HRV join from being
//      off by one. This is the argument that settles it.
//   3. It is total: every session has a civil end date, and a daytime nap is
//      self-consistent because its start and end dates are the same.
//
// The API makes this free rather than merely convenient: `list` documents
// sleep.interval.civil_end_time as a sleep-EXCLUSIVE filter and explicitly
// excludes sleep from the generic session-start filter, so attribution, fetch
// filter and deletion-reconciliation scope are all one axis. There is no
// start-time query with a compensating one-day widening, and there must not be.
//
// Reversibility: every input to these functions is stored on the row
// (civil_start_local, civil_end_local), so changing the rule is a local UPDATE
// plus a re-derivation -- no re-fetch, no migration, no version column. It
// would, however, change the query window too, which is a further reason not
// to change it lightly.

/** A sleep session belongs to the local calendar date on which the sleeper woke. */
export function attributeSleepLocalDate(civilEnd: GoogleCivilDateTime): string {
  return civilDateToLocalDate(civilEnd);
}

/**
 * An exercise belongs to the local calendar date on which it began.
 *
 * Deliberately the opposite of sleep: an exercise is an act performed at a
 * time, so "the run I started at 11pm Tuesday" is a Tuesday run. Sleep is a
 * span you emerge from, which is why it is dated by its end.
 */
export function attributeExerciseLocalDate(civilStart: GoogleCivilDateTime): string {
  return civilDateToLocalDate(civilStart);
}
