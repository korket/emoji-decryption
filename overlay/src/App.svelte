<script lang="ts">
  import { onMount } from 'svelte';
  import { connectWS, round, timer, hint, leaderboard, roundEndAnswer, recentWinners, connected } from './lib/store';

  // Phase display labels and durations (ms) for timer bar fill calculation
  const PHASE_DURATION: Record<string, number> = {
    SCORING_WINDOW: 10_000,
    OPEN_GUESSING: 20_000,
    HINT_1: 20_000,
    HINT_2: 20_000,
    RESOLVE: 10_000,
  };

  const PHASE_LABEL: Record<string, string> = {
    SCORING_WINDOW: 'BONUS WINDOW',
    OPEN_GUESSING: 'GUESS NOW',
    HINT_1: 'HINT 1',
    HINT_2: 'HINT 2',
    RESOLVE: 'REVEALING…',
  };

  let remaining = 0;
  let timerInterval: ReturnType<typeof setInterval> | null = null;

  $: if ($timer) {
    if (timerInterval !== null) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if ($timer) {
        remaining = Math.max(0, $timer.remainingMs - (Date.now() - $timer.updatedAt));
      }
    }, 50);
  }

  $: remainingSecs = Math.ceil(remaining / 1000);
  $: timerPct = $timer
    ? (remaining / (PHASE_DURATION[$timer.phase] ?? 10_000)) * 100
    : 0;
  $: phaseLabel = $timer ? (PHASE_LABEL[$timer.phase] ?? $timer.phase) : '';

  // Color of timer bar based on phase
  $: barColor =
    $timer?.phase === 'SCORING_WINDOW' ? '#f59e0b'   // amber — bonus window
    : $timer?.phase === 'RESOLVE'      ? '#ef4444'   // red — resolving
    : '#22c55e';                                     // green — normal guessing

  onMount(() => {
    const disconnect = connectWS();
    return () => {
      if (timerInterval !== null) clearInterval(timerInterval);
      disconnect();
    };
  });

  function medal(rank: number): string {
    return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '★';
  }
</script>

<div class="overlay">
  <!-- ─── Connection badge ───────────────────────── -->
  {#if !$connected}
    <div class="conn-badge">⚡ Connecting…</div>
  {/if}

  {#if $round}
    <!-- ─── Banner ──────────────────────────────── -->
    <div class="banner">
      <span class="banner-text">TYPE YOUR GUESS IN CHAT</span>
      <span class="banner-arrow">↓</span>
    </div>

    <!-- ─── Round + Category ─────────────────────── -->
    <div class="round-info">
      <span class="round-num">Round {$round.roundNumber}</span>
      <span class="round-sep">·</span>
      <span class="round-cat">{$round.category.toUpperCase()}</span>
    </div>

    <!-- ─── Emoji Hero ────────────────────────────── -->
    <div class="emoji-hero">
      {#if $roundEndAnswer}
        <div class="answer-reveal">{$roundEndAnswer}</div>
        <div class="emoji-faded">{$round.emojis}</div>
      {:else}
        <div class="emoji-main">{$round.emojis}</div>
      {/if}
    </div>

    <!-- ─── Timer Bar ─────────────────────────────── -->
    <div class="timer-section">
      <div class="timer-bar-track">
        <div
          class="timer-bar-fill"
          style="width: {timerPct}%; background: {barColor}"
        ></div>
      </div>
      <div class="timer-labels">
        <span class="timer-phase">{phaseLabel}</span>
        <span class="timer-secs">{remainingSecs}s</span>
      </div>
    </div>

    <!-- ─── Hint Row ──────────────────────────────── -->
    <div class="hint-row">
      {#if $hint}
        <span class="hint-text">{$hint}</span>
      {:else}
        <span class="hint-placeholder">﹏ ﹏ ﹏</span>
      {/if}
    </div>

    <!-- ─── Winner Flashes ────────────────────────── -->
    {#if $recentWinners.length > 0}
      <div class="winner-flashes">
        {#each $recentWinners.slice(-3) as w (w.rank)}
          <div class="winner-flash">
            {medal(w.rank)} <strong>{w.userHandle}</strong> +{w.points} pts
          </div>
        {/each}
      </div>
    {/if}

    <!-- ─── Leaderboard ───────────────────────────── -->
    {#if $leaderboard.length > 0}
      <div class="leaderboard">
        <div class="lb-title">🏆 SESSION</div>
        {#each $leaderboard as entry, i}
          <div class="lb-row" class:lb-top={i === 0}>
            <span class="lb-rank">#{i + 1}</span>
            <span class="lb-name">{entry.userHandle}</span>
            <span class="lb-pts">{entry.points}</span>
          </div>
        {/each}
      </div>
    {/if}
  {:else}
    <!-- ─── Waiting state ─────────────────────────── -->
    <div class="waiting">
      <div class="waiting-emoji">🎮</div>
      <div class="waiting-text">Starting soon…</div>
    </div>
  {/if}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
  }

  /* Root overlay — content in top 1440px; bottom 480px = YouTube UI zone */
  .overlay {
    position: relative;
    width: 1080px;
    height: 1920px;
    background: transparent;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    color: #fff;
    display: flex;
    flex-direction: column;
    padding-bottom: 480px;
  }

  .conn-badge {
    position: absolute;
    top: 16px;
    right: 16px;
    background: rgba(239, 68, 68, 0.85);
    color: #fff;
    font-size: 24px;
    font-weight: 700;
    padding: 8px 20px;
    border-radius: 40px;
    z-index: 10;
  }

  .banner {
    background: rgba(0, 0, 0, 0.82);
    border-bottom: 4px solid #f59e0b;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 18px 40px;
    flex-shrink: 0;
  }

  .banner-text {
    font-size: 40px;
    font-weight: 900;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #fde68a;
  }

  .banner-arrow {
    font-size: 48px;
    color: #fde68a;
    animation: bounce 1s ease-in-out infinite;
  }

  .round-info {
    background: rgba(0, 0, 0, 0.70);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: 14px 40px;
    flex-shrink: 0;
  }

  .round-num {
    font-size: 32px;
    font-weight: 700;
    color: #94a3b8;
  }

  .round-sep {
    font-size: 32px;
    color: #475569;
  }

  .round-cat {
    font-size: 32px;
    font-weight: 900;
    letter-spacing: 2px;
    color: #e2e8f0;
  }

  .emoji-hero {
    flex: 1;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px;
    min-height: 0;
  }

  .emoji-main {
    font-size: 160px;
    line-height: 1.2;
    letter-spacing: 12px;
    text-align: center;
    filter: drop-shadow(0 0 24px rgba(245, 158, 11, 0.6));
  }

  .answer-reveal {
    font-size: 96px;
    font-weight: 900;
    color: #4ade80;
    text-align: center;
    text-shadow: 0 0 32px rgba(74, 222, 128, 0.8);
    letter-spacing: 4px;
    margin-bottom: 20px;
  }

  .emoji-faded {
    font-size: 100px;
    letter-spacing: 12px;
    text-align: center;
    opacity: 0.35;
  }

  .timer-section {
    background: rgba(0, 0, 0, 0.80);
    padding: 14px 40px 10px;
    flex-shrink: 0;
  }

  .timer-bar-track {
    width: 100%;
    height: 18px;
    background: rgba(255, 255, 255, 0.12);
    border-radius: 9px;
    overflow: hidden;
  }

  .timer-bar-fill {
    height: 100%;
    border-radius: 9px;
    transition: width 0.1s linear, background 0.3s ease;
  }

  .timer-labels {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }

  .timer-phase {
    font-size: 26px;
    font-weight: 700;
    letter-spacing: 2px;
    color: #94a3b8;
  }

  .timer-secs {
    font-size: 36px;
    font-weight: 900;
    color: #f1f5f9;
    font-variant-numeric: tabular-nums;
  }

  .hint-row {
    background: rgba(0, 0, 0, 0.75);
    border-top: 2px solid rgba(255, 255, 255, 0.08);
    padding: 18px 40px;
    text-align: center;
    flex-shrink: 0;
    min-height: 88px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hint-text {
    font-size: 64px;
    font-weight: 700;
    letter-spacing: 16px;
    color: #67e8f9;
    font-family: 'Courier New', Courier, monospace;
  }

  .hint-placeholder {
    font-size: 40px;
    color: rgba(255, 255, 255, 0.18);
    letter-spacing: 20px;
  }

  .winner-flashes {
    background: rgba(0, 0, 0, 0.72);
    padding: 8px 40px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }

  .winner-flash {
    font-size: 28px;
    font-weight: 600;
    color: #4ade80;
    text-shadow: 0 0 12px rgba(74, 222, 128, 0.5);
  }

  .leaderboard {
    background: rgba(0, 0, 0, 0.82);
    border-top: 3px solid rgba(245, 158, 11, 0.5);
    padding: 16px 40px 20px;
    flex-shrink: 0;
  }

  .lb-title {
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 3px;
    color: #f59e0b;
    margin-bottom: 10px;
  }

  .lb-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 34px;
  }

  .lb-row.lb-top .lb-name {
    color: #fde68a;
  }

  .lb-rank {
    width: 60px;
    color: #64748b;
    font-weight: 700;
    font-size: 28px;
    flex-shrink: 0;
  }

  .lb-name {
    flex: 1;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lb-pts {
    font-weight: 900;
    color: #f59e0b;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }

  .waiting {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    background: rgba(0, 0, 0, 0.65);
  }

  .waiting-emoji {
    font-size: 120px;
  }

  .waiting-text {
    font-size: 48px;
    font-weight: 700;
    color: #94a3b8;
    letter-spacing: 3px;
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(8px); }
  }
</style>
