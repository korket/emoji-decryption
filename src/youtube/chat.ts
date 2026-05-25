import { google } from 'googleapis';
import type { Auth } from 'googleapis';
import type { ChatMessage } from '../types/chat-message';

export interface BroadcastInfo {
  broadcastId: string;
  liveChatId: string;
}

export async function findActiveBroadcast(auth: Auth.OAuth2Client): Promise<BroadcastInfo> {
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.liveBroadcasts.list({
    part: ['id', 'snippet', 'status'],
    mine: true,
  });

  const items = res.data.items ?? [];
  const live = items.find((b) => b.status?.lifeCycleStatus === 'live');

  if (!live) {
    throw new Error(
      'No active live broadcast found.\n' +
      'Make sure your YouTube stream is live before running this.',
    );
  }

  const liveChatId = live.snippet?.liveChatId;
  if (!liveChatId) throw new Error(`Broadcast ${live.id} has no liveChatId`);

  console.log(`Live broadcast: ${live.id}  liveChatId: ${liveChatId}`);
  return { broadcastId: live.id!, liveChatId };
}

export class ChatPoller {
  private stopped = false;
  private nextPageToken: string | undefined = undefined;
  private primed = false;
  private pollTimeout: ReturnType<typeof setTimeout> | null = null;
  private seenIds = new Set<string>();
  private backoffMs = 2_000;

  constructor(
    private readonly auth: Auth.OAuth2Client,
    private readonly liveChatId: string,
    private readonly onMessage: (msg: ChatMessage) => void,
  ) {}

  start(): void {
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.pollTimeout !== null) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.pollTimeout = setTimeout(() => void this.poll(), delayMs);
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;

    const youtube = google.youtube({ version: 'v3', auth: this.auth });

    try {
      const res = await youtube.liveChatMessages.list({
        liveChatId: this.liveChatId,
        part: ['id', 'snippet', 'authorDetails'],
        ...(this.nextPageToken !== undefined ? { pageToken: this.nextPageToken } : {}),
      });

      const { nextPageToken, pollingIntervalMillis, items = [] } = res.data;
      this.nextPageToken = nextPageToken ?? undefined;
      this.backoffMs = 2_000;

      const delay = pollingIntervalMillis ?? 5_000;

      if (!this.primed) {
        // First poll: discard historical messages, only capture the page token
        this.primed = true;
      } else {
        const now = Date.now();
        for (const item of items) {
          const id = item.id;
          if (!id || this.seenIds.has(id)) continue;
          this.seenIds.add(id);

          const text =
            item.snippet?.displayMessage ??
            item.snippet?.textMessageDetails?.messageText;
          const userId = item.authorDetails?.channelId;
          const userHandle = item.authorDetails?.displayName;

          if (!text || !userId || !userHandle) continue;

          this.onMessage({ id, userId, userHandle, text, receivedAt: now });
        }
      }

      this.schedule(delay);
    } catch (err: unknown) {
      await this.handleError(err);
    }
  }

  private async handleError(err: unknown): Promise<void> {
    type GaxiosLike = {
      response?: {
        status?: number;
        data?: { error?: { errors?: Array<{ reason?: string }> } };
      };
    };
    const e = err as GaxiosLike;
    const status = e.response?.status;
    const reason = e.response?.data?.error?.errors?.[0]?.reason;

    if (status === 401) {
      console.error('[chat] Auth token expired. Delete token.json and restart to re-authenticate.');
      this.stop();
      return;
    }

    if (status === 403 && reason === 'quotaExceeded') {
      console.error('[chat] YouTube API quota exceeded. Chat polling stopped for today.');
      this.stop();
      return;
    }

    if (status === 403) {
      console.error(`[chat] YouTube API 403 forbidden (reason: ${reason ?? 'unknown'}). Stopping.`);
      this.stop();
      return;
    }

    if (status === 404 || reason === 'liveChatEnded') {
      console.log('[chat] Live chat ended. Stopping poller.');
      this.stop();
      return;
    }

    // Transient / network error — exponential backoff
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[chat] Poll error, retrying in ${this.backoffMs}ms: ${msg}`);
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
    this.schedule(delay);
  }
}
