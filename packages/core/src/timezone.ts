const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));

export function isValidTimezone(tz: string): boolean {
  return supportedTimeZones.has(tz);
}
