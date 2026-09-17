// A project's completion fraction (Checkpoint 10.6): done over open plus
// done, from the counts the summary and detail read models already carry
// (`counts.open`, `counts.done` -- the same numbers the caption prints). A
// project with neither an open nor a done task has no fraction: null, so
// the bar is not drawn at all rather than drawn empty, which would read as
// "0% done" of work that does not exist. Dropped tasks are outside both
// counts and never move the bar.
export interface ProjectProgress {
  /** 0..1, already safe for ProgressBar (which clamps anyway). */
  fraction: number;
  done: number;
  total: number;
  /** "2 of 5 done" -- the spoken form. */
  label: string;
}

export function projectProgress(counts: { open: number; done: number }): ProjectProgress | null {
  const done = Math.max(0, counts.done);
  const total = Math.max(0, counts.open) + done;
  if (total === 0) return null;
  return {
    fraction: done / total,
    done,
    total,
    label: `${done} of ${total} done`,
  };
}
