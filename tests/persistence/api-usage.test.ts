import { describe, it, expect } from 'vitest';
import { openDatabase } from '../../src/persistence/db';
import { getApiUsageSummarySince, getTodayApiUsageSummary, recordApiUsage } from '../../src/persistence/api-usage';

describe('api usage repository', () => {
  it('records API usage events and summarizes by source', () => {
    const db = openDatabase(':memory:');
    recordApiUsage(db, { source: 'youtube.liveBroadcasts.list', timestamp: 1_000, units: 1 });
    recordApiUsage(db, { source: 'youtube.liveChatMessages.list', timestamp: 2_000, units: 1 });
    recordApiUsage(db, { source: 'youtube.liveChatMessages.list', timestamp: 3_000, units: 1 });

    const summary = getApiUsageSummarySince(db, 1_500);

    expect(summary.totalUnits).toBe(2);
    expect(summary.calls).toBe(2);
    expect(summary.bySource).toEqual([{ source: 'youtube.liveChatMessages.list', units: 2, calls: 2 }]);
    db.close();
  });

  it('uses the current Pacific quota day for today summary', () => {
    const db = openDatabase(':memory:');
    const now = Date.UTC(2026, 4, 26, 20, 0, 0);
    recordApiUsage(db, { source: 'old', timestamp: Date.UTC(2026, 4, 25, 6, 0, 0) });
    recordApiUsage(db, { source: 'today', timestamp: now });

    const summary = getTodayApiUsageSummary(db, now);

    expect(summary.totalUnits).toBe(1);
    expect(summary.bySource).toEqual([{ source: 'today', units: 1, calls: 1 }]);
    db.close();
  });
});
