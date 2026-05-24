export interface Session {
  id: string;
  startedAt: number;
  endedAt: number | null;
  totalRounds: number;
}
