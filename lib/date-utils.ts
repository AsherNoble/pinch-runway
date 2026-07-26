import type { IsoDate } from "./contracts";

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function epochDay(value: IsoDate): number {
  if (!ISO_DATE.test(value)) throw new Error(`Invalid ISO date: ${value}`);
  const epoch = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ISO date: ${value}`);
  }
  return epoch;
}

export function addDays(value: IsoDate, days: number): IsoDate {
  if (!Number.isInteger(days)) throw new Error("days must be an integer");
  return new Date(epochDay(value) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((epochDay(to) - epochDay(from)) / DAY_MS);
}

export function compareDates(left: IsoDate, right: IsoDate): number {
  return epochDay(left) - epochDay(right);
}

export function sydneyDate(now = new Date()): IsoDate {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function sydneyHourAndWeekday(now = new Date()): {
  hour: number;
  weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? "-1"),
    weekday: parts.find((part) => part.type === "weekday")?.value ?? "",
  };
}

export function isSydneyWeekdayEvaluation(now = new Date()): boolean {
  const { hour, weekday } = sydneyHourAndWeekday(now);
  return hour === 8 && !["Sat", "Sun"].includes(weekday);
}
