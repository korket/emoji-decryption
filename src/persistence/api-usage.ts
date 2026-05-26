import type { DB } from './db';

export interface ApiUsageInput {
  source: string;
  units?: number;
  timestamp?: number;
  detail?: string | null;
}

export interface ApiUsageSummary {
  since: number;
  totalUnits: number;
  calls: number;
  bySource: Array<{ source: string; units: number; calls: number }>;
}

const PACIFIC_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pacificDateKey(timestamp: number): string {
  const parts = PACIFIC_FORMAT.formatToParts(new Date(timestamp));
  const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export function getPacificDayStart(now: number = Date.now()): number {
  const target = pacificDateKey(now);
  const [year, month, day] = target.split('-').map(Number) as [number, number, number];
  let candidate = Date.UTC(year, month - 1, day, 12, 0, 0, 0);

  while (pacificDateKey(candidate) === target) candidate -= 60 * 60 * 1000;
  while (pacificDateKey(candidate) !== target) candidate += 60 * 1000;

  return candidate;
}

export function recordApiUsage(db: DB, input: ApiUsageInput): void {
  db.prepare(`
    INSERT INTO api_usage_events (source, units, timestamp, detail)
    VALUES (@source, @units, @timestamp, @detail)
  `).run({
    source: input.source,
    units: input.units ?? 1,
    timestamp: input.timestamp ?? Date.now(),
    detail: input.detail ?? null,
  });
}

export function getApiUsageSummarySince(db: DB, since: number): ApiUsageSummary {
  const total = db.prepare(`
    SELECT COALESCE(SUM(units), 0) AS totalUnits, COUNT(*) AS calls
    FROM api_usage_events
    WHERE timestamp >= ?
  `).get(since) as { totalUnits: number; calls: number };

  const bySource = db.prepare(`
    SELECT source, COALESCE(SUM(units), 0) AS units, COUNT(*) AS calls
    FROM api_usage_events
    WHERE timestamp >= ?
    GROUP BY source
    ORDER BY units DESC, source ASC
  `).all(since) as Array<{ source: string; units: number; calls: number }>;

  return {
    since,
    totalUnits: total.totalUnits,
    calls: total.calls,
    bySource,
  };
}

export function getTodayApiUsageSummary(db: DB, now: number = Date.now()): ApiUsageSummary {
  return getApiUsageSummarySince(db, getPacificDayStart(now));
}
