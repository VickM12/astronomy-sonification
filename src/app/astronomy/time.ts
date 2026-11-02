import { AstroTime } from 'astronomy-engine';

export class UnsupportedDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDateError';
  }
}

const UTC_INSTANT =
  /^(-?\d{1,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z$/;

export function assertUtcInstant(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new UnsupportedDateError('The date is not a valid UTC instant.');
  }
}

/**
 * Parse a UTC instant. Fields are read as UTC even when the user typed them.
 * A trailing Z is required so a local-time reading cannot slip in unnoticed.
 */
export function parseUtcInstant(value: string): Date {
  const match = UTC_INSTANT.exec(value.trim());
  if (!match) {
    throw new UnsupportedDateError('Enter a UTC instant as YYYY-MM-DDTHH:mm:ssZ.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  const fraction = match[7] ?? '';
  const millisecond = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, '0'));

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new UnsupportedDateError('That UTC instant is not a real calendar date.');
  }

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  date.setUTCFullYear(year);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new UnsupportedDateError('That UTC instant is not a real calendar date.');
  }
  return date;
}

export function addUtcDays(time: Date, days: number): Date {
  assertUtcInstant(time);
  if (!Number.isFinite(days)) {
    throw new UnsupportedDateError('The time step is not a finite number of days.');
  }
  const next = new AstroTime(time).AddDays(days).date;
  assertUtcInstant(next);
  return next;
}

/** Difference in UT days, using the same scale as astronomy-engine. */
export function daysBetween(start: Date, end: Date): number {
  assertUtcInstant(start);
  assertUtcInstant(end);
  return new AstroTime(end).ut - new AstroTime(start).ut;
}
