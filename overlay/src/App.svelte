<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { connectWS, round, timer, hint, hintTemplate, leaderboard, roundEndAnswer, recentWinners, connected, preGame, interRound, sessionEnd } from './lib/store';
  import { playSfx } from './lib/sfx';

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

  let preGameRemaining = 0;
  let preGameInterval: ReturnType<typeof setInterval> | null = null;

  let _lastCountdownSec = -1;

  $: if ($preGame) {
    if (preGameInterval !== null) clearInterval(preGameInterval);
    preGameRemaining = Math.max(0, $preGame.startsAt - Date.now());
    _lastCountdownSec = -1;
    preGameInterval = setInterval(() => {
      if ($preGame) {
        preGameRemaining = Math.max(0, $preGame.startsAt - Date.now());
        const sec = Math.ceil(preGameRemaining / 1000);
        if (sec !== _lastCountdownSec && sec > 0) {
          _lastCountdownSec = sec;
          playSfx('countdown_tick.mp3', 0.5);
        }
      }
    }, 200);
  }

  $: preGameRemainingSecs = Math.ceil(preGameRemaining / 1000);

  let interRoundRemaining = 0;
  let interRoundInterval: ReturnType<typeof setInterval> | null = null;

  $: if ($interRound) {
    if (interRoundInterval !== null) clearInterval(interRoundInterval);
    interRoundRemaining = Math.max(0, $interRound.nextRoundAt - Date.now());
    interRoundInterval = setInterval(() => {
      if ($interRound) interRoundRemaining = Math.max(0, $interRound.nextRoundAt - Date.now());
    }, 200);
  } else if (interRoundInterval !== null) {
    clearInterval(interRoundInterval);
    interRoundInterval = null;
  }

  $: interRoundRemainingSecs = Math.ceil(interRoundRemaining / 1000);

  $: remainingSecs = Math.ceil(remaining / 1000);
  $: timerPct = $timer
    ? (remaining / (PHASE_DURATION[$timer.phase] ?? 10_000)) * 100
    : 0;
  $: phaseLabel = $timer ? (PHASE_LABEL[$timer.phase] ?? $timer.phase) : '';

  const CATEGORY_LABEL: Record<string, string> = {
    movies:     'MOVIES',
    songs:      'SONGS',
    tv:         'TV',
    idioms:     'IDIOMS',
    foods:      'FOODS',
    places:     'PLACES',
    sports:     'SPORTS',
    videogames: 'VIDEO GAMES',
  };

  const CATEGORY_THEME: Record<string, { bg: string; accent: string }> = {
    movies:     { bg: 'rgba(220, 130, 130, 0.45)', accent: '#fca5a5' },  // dusty rose
    songs:      { bg: 'rgba(180, 140, 230, 0.45)', accent: '#d8b4fe' },  // soft lavender
    tv:         { bg: 'rgba(100, 195, 215, 0.40)', accent: '#67e8f9' },  // soft cyan
    idioms:     { bg: 'rgba(120, 200, 145, 0.40)', accent: '#86efac' },  // soft mint
    foods:      { bg: 'rgba(240, 165, 100, 0.40)', accent: '#fdba74' },  // soft peach
    places:     { bg: 'rgba(120, 160, 235, 0.40)', accent: '#93c5fd' },  // soft periwinkle
    sports:     { bg: 'rgba(220, 175, 40,  0.40)', accent: '#fde047' },  // golden yellow
    videogames: { bg: 'rgba(130, 60,  220, 0.40)', accent: '#c084fc' },  // electric purple
  };
  const DEFAULT_THEME = { bg: 'rgba(0, 0, 0, 0.65)', accent: '#22c55e' };

  $: theme = $round ? (CATEGORY_THEME[$round.category] ?? DEFAULT_THEME) : DEFAULT_THEME;

  // Timer bar color — accent for normal guessing, fixed amber/red for special phases
  $: barColor =
    $timer?.phase === 'SCORING_WINDOW' ? '#f59e0b'
    : $timer?.phase === 'RESOLVE'      ? '#ef4444'
    : theme.accent;

  // ─── BGM ────────────────────────────────────────────────────────────────────

  const BGM_TRACKS = [
    'Arrival.mp3', 'Blue.mp3', 'Camera.mp3', 'Favorite.mp3',
    'Fire.mp3', 'Forgive.mp3', 'Funny.mp3', 'Glass.mp3',
    'Night Walking.mp3', 'Over.mp3', 'Road  Trip.mp3', 'Stroll.mp3', 'Toy.mp3',
  ];

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const BGM_VOLUME = 0.3;
  const FADE_MS = 3_000;

  let bgmCurrent: HTMLAudioElement | null = null;
  let bgmCrossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  let bgmQueue: string[] = [];
  let bgmIndex = 0;

  function getNextTrack(): string {
    if (bgmIndex >= bgmQueue.length) {
      bgmQueue = shuffle(BGM_TRACKS);
      bgmIndex = 0;
    }
    return bgmQueue[bgmIndex++];
  }

  function rampVolume(el: HTMLAudioElement, to: number, ms: number, onDone?: () => void): void {
    const from = el.volume;
    const steps = Math.max(1, Math.round(ms / 50));
    const delta = (to - from) / steps;
    let step = 0;
    const id = setInterval(() => {
      step++;
      el.volume = Math.max(0, Math.min(1, from + delta * step));
      if (step >= steps) { clearInterval(id); onDone?.(); }
    }, 50);
  }

  function scheduleCrossfade(audio: HTMLAudioElement): void {
    if (bgmCrossfadeTimer !== null) clearTimeout(bgmCrossfadeTimer);
    const dur = audio.duration;
    if (!isFinite(dur)) { audio.addEventListener('ended', () => startBgm(), { once: true }); return; }
    const delay = Math.max(0, (dur - audio.currentTime - FADE_MS / 1000) * 1000);
    bgmCrossfadeTimer = setTimeout(() => crossfadeTo(getNextTrack()), delay);
  }

  function crossfadeTo(track: string): void {
    const incoming = new Audio(`/bgm/${encodeURIComponent(track)}`);
    incoming.volume = 0;
    const outgoing = bgmCurrent;
    bgmCurrent = incoming;
    incoming.addEventListener('loadedmetadata', () => scheduleCrossfade(incoming), { once: true });
    incoming.play().catch(() => {});
    rampVolume(incoming, BGM_VOLUME, FADE_MS);
    if (outgoing) rampVolume(outgoing, 0, FADE_MS, () => outgoing.pause());
  }

  function startBgm(): void {
    const track = getNextTrack();
    const audio = new Audio(`/bgm/${encodeURIComponent(track)}`);
    audio.volume = BGM_VOLUME;
    bgmCurrent = audio;
    audio.addEventListener('loadedmetadata', () => scheduleCrossfade(audio), { once: true });
    audio.play().catch(() => {});
  }

  onMount(() => {
    bgmQueue = shuffle(BGM_TRACKS);
    startBgm();

    const disconnect = connectWS();
    return () => {
      if (timerInterval !== null) clearInterval(timerInterval);
      if (preGameInterval !== null) clearInterval(preGameInterval);
      if (interRoundInterval !== null) clearInterval(interRoundInterval);
      if (bgmCrossfadeTimer !== null) clearTimeout(bgmCrossfadeTimer);
      bgmCurrent?.pause();
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

  {#if $sessionEnd}
    <!-- ─── Session end screen ──────────────────── -->
    <div class="session-end" in:fade={{ duration: 600 }}>
      <div class="se-title">SESSION OVER!</div>
      <div class="se-trophy">🏆</div>
      <div class="se-subtitle">FINAL STANDINGS</div>
      <div class="se-entries">
        {#each $sessionEnd.leaderboard as entry, i}
          <div class="se-row" class:se-top={i === 0}>
            <span class="se-medal">{medal(i + 1)}</span>
            <span class="se-name">{entry.userHandle}</span>
            <span class="se-pts">{entry.points} pts</span>
          </div>
        {/each}
      </div>
      <div class="se-thanks">Thanks for playing! 👋</div>
    </div>
  {:else if $interRound}
    <!-- ─── Inter-round screen ───────────────────── -->
    <div class="interround" in:fade={{ duration: 400 }} out:fade={{ duration: 200 }}>
      <div class="ir-round-label">Round {$round?.roundNumber} — RESULT</div>
      <div class="ir-answer">{$interRound.answer}</div>
      {#if $interRound.winners.length > 0}
        <div class="ir-winners">
          {#each $interRound.winners.slice(0, 3) as w, i}
            <div class="ir-winner-row">
              <span class="ir-medal">{medal(i + 1)}</span>
              <span class="ir-name">{w.userHandle}</span>
              <span class="ir-pts">+{w.points} pts</span>
            </div>
          {/each}
        </div>
      {:else}
        <div class="ir-no-winner">Nobody guessed it!</div>
      {/if}
      <div class="ir-next">Next round in {interRoundRemainingSecs}s</div>
      {#if $leaderboard.length > 0}
        <div class="leaderboard ir-leaderboard" style="border-top-color: {theme.accent}">
          <div class="lb-title" style="color: {theme.accent}">🏆 LEADERBOARD</div>
          {#each $leaderboard as entry, i (entry.userHandle)}
            <div class="lb-row" class:lb-top={i === 0}>
              <span class="lb-rank">#{i + 1}</span>
              <span class="lb-name">{entry.userHandle}</span>
              <span class="lb-pts" style="color: {theme.accent}">{entry.points}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {:else if $round}
    <!-- ─── Banner ──────────────────────────────── -->
    <div class="banner" style="border-bottom-color: {theme.accent}">
      <span class="banner-text">TYPE YOUR GUESS IN CHAT</span>
      <span class="banner-arrow">↓</span>
    </div>

    <!-- ─── Round + Category ─────────────────────── -->
    <div class="round-info">
      <span class="round-num">Round {$round.roundNumber}</span>
      <span class="round-sep">·</span>
      <span class="round-cat" style="color: {theme.accent}">{CATEGORY_LABEL[$round.category] ?? $round.category.toUpperCase()}</span>
    </div>

    <!-- ─── Emoji Hero ────────────────────────────── -->
    <div class="emoji-hero" style="background: {theme.bg}">
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
      {#key $hint}
        {#if $hint}
          <span class="hint-text" in:fade={{ duration: 400 }}>{$hint}</span>
        {:else if $hintTemplate}
          <span class="hint-text hint-blank" in:fade={{ duration: 200 }}>{$hintTemplate}</span>
        {/if}
      {/key}
    </div>

    <!-- ─── Winner Flashes ────────────────────────── -->
    {#if $recentWinners.length > 0}
      <div class="winner-flashes">
        {#each $recentWinners.slice(-3) as w (w.id)}
          <div
            class="winner-flash"
            in:fly={{ x: 120, duration: 300 }}
            out:fly={{ x: 120, duration: 250 }}
          >
            {medal(w.rank)} <strong>{w.userHandle}</strong> +{w.points} pts
          </div>
        {/each}
      </div>
    {/if}

    <!-- ─── Leaderboard ───────────────────────────── -->
    {#if $leaderboard.length > 0}
      <div class="leaderboard" style="border-top-color: {theme.accent}">
        <div class="lb-title" style="color: {theme.accent}">🏆 LEADERBOARD</div>
        {#each $leaderboard as entry, i (entry.userHandle)}
          <div class="lb-row" class:lb-top={i === 0} animate:flip={{ duration: 300 }}>
            <span class="lb-rank">#{i + 1}</span>
            <span class="lb-name">{entry.userHandle}</span>
            <span class="lb-pts" style="color: {theme.accent}">{entry.points}</span>
          </div>
        {/each}
      </div>
    {/if}
  {:else if $preGame}
    <!-- ─── Pre-game countdown ───────────────────── -->
    <div class="pregame">
      <div class="pregame-title">🎮 EMOJI DECRYPTION</div>
      <div class="pregame-label">STARTING IN</div>
      <div class="pregame-secs">{preGameRemainingSecs}</div>
      <div class="pregame-sub">TYPE YOUR ANSWERS IN CHAT</div>
    </div>
  {:else}
    <!-- ─── Waiting state ─────────────────────────── -->
    <div class="waiting">
      <div class="waiting-emoji">🎮</div>
      <div class="waiting-text">Starting soon…</div>
    </div>
  {/if}
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');

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
    background: rgba(15, 15, 20, 0.88);
    font-family: 'Inter', 'Segoe UI', 'Helvetica Neue', Arial,
      'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
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
    transition: background 0.6s ease;
  }

  .emoji-main {
    font-size: 220px;
    line-height: 1.2;
    letter-spacing: 24px;
    text-indent: 24px; /* offset trailing letter-spacing so glyphs visually center */
    text-align: center;
    width: 100%;
    filter: drop-shadow(0 0 32px rgba(255, 255, 255, 0.8));
    animation: emoji-entrance 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) both,
               emoji-float 3.5s ease-in-out 0.7s infinite;
  }

  .answer-reveal {
    font-size: 96px;
    font-weight: 900;
    color: #bbf7d0;
    text-align: center;
    text-shadow: 0 0 28px rgba(187, 247, 208, 0.7), 0 4px 12px rgba(0, 0, 0, 0.5);
    letter-spacing: 4px;
    margin-bottom: 20px;
    animation: reveal-entrance 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both,
               reveal-glow 2.5s ease-in-out 0.55s infinite;
  }

  .emoji-faded {
    font-size: 140px;
    letter-spacing: 24px;
    text-indent: 24px;
    text-align: center;
    width: 100%;
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
    text-indent: 16px;
    color: rgba(255, 255, 255, 0.88);
    font-family: 'Courier New', Courier, monospace, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji';
    width: 100%;
    text-align: center;
  }

  .hint-blank {
    color: rgba(255, 255, 255, 0.30);
  }

  .winner-flashes {
    position: absolute;
    right: 40px;
    bottom: 560px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .winner-flash {
    font-size: 28px;
    font-weight: 600;
    color: #4ade80;
    text-shadow: 0 0 12px rgba(74, 222, 128, 0.5);
    background: rgba(0, 0, 0, 0.75);
    padding: 8px 20px;
    border-radius: 40px;
    white-space: nowrap;
  }

  .leaderboard {
    background: rgba(15, 15, 20, 0.88);
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

  .session-end {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 32px;
    background: rgba(10, 10, 16, 0.98);
    padding: 60px 40px;
  }

  .se-title {
    font-size: 64px;
    font-weight: 900;
    letter-spacing: 4px;
    color: #f59e0b;
    text-shadow: 0 0 36px rgba(245, 158, 11, 0.5);
    animation: pulse 2s ease-in-out infinite;
  }

  .se-trophy {
    font-size: 140px;
    line-height: 1;
    filter: drop-shadow(0 0 32px rgba(245, 158, 11, 0.6));
    animation: emoji-float 3.5s ease-in-out infinite;
  }

  .se-subtitle {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 5px;
    color: #64748b;
  }

  .se-entries {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 800px;
  }

  .se-row {
    display: flex;
    align-items: center;
    gap: 20px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 16px 28px;
  }

  .se-row.se-top {
    background: rgba(245, 158, 11, 0.12);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .se-medal {
    font-size: 40px;
    flex-shrink: 0;
  }

  .se-name {
    flex: 1;
    font-size: 38px;
    font-weight: 700;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .se-row.se-top .se-name {
    color: #fde68a;
  }

  .se-pts {
    font-size: 34px;
    font-weight: 900;
    color: #f59e0b;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .se-thanks {
    font-size: 40px;
    font-weight: 700;
    color: #475569;
    letter-spacing: 2px;
  }

  .interround {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    background: rgba(10, 10, 16, 0.96);
    padding: 40px;
  }

  .ir-round-label {
    font-size: 30px;
    font-weight: 700;
    letter-spacing: 4px;
    color: #64748b;
    text-transform: uppercase;
  }

  .ir-answer {
    font-size: 88px;
    font-weight: 900;
    color: #bbf7d0;
    text-align: center;
    text-shadow: 0 0 36px rgba(187, 247, 208, 0.65), 0 4px 12px rgba(0, 0, 0, 0.6);
    letter-spacing: 4px;
    animation: reveal-entrance 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) both;
  }

  .ir-winners {
    display: flex;
    flex-direction: column;
    gap: 12px;
    width: 100%;
    max-width: 800px;
  }

  .ir-winner-row {
    display: flex;
    align-items: center;
    gap: 20px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 14px 28px;
  }

  .ir-medal {
    font-size: 40px;
    flex-shrink: 0;
  }

  .ir-name {
    flex: 1;
    font-size: 36px;
    font-weight: 700;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ir-pts {
    font-size: 32px;
    font-weight: 900;
    color: #4ade80;
    flex-shrink: 0;
  }

  .ir-no-winner {
    font-size: 38px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 2px;
  }

  .ir-next {
    font-size: 32px;
    font-weight: 700;
    letter-spacing: 3px;
    color: #475569;
    font-variant-numeric: tabular-nums;
  }

  .ir-leaderboard {
    width: 100%;
    max-width: 800px;
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.04);
    padding: 16px 28px 20px;
  }

  .waiting {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
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

  .pregame {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 32px;
  }

  .pregame-title {
    font-size: 52px;
    font-weight: 900;
    letter-spacing: 4px;
    color: #f59e0b;
    text-shadow: 0 0 24px rgba(245, 158, 11, 0.4);
  }

  .pregame-label {
    font-size: 40px;
    font-weight: 700;
    letter-spacing: 6px;
    color: #94a3b8;
  }

  .pregame-secs {
    font-size: 220px;
    font-weight: 900;
    line-height: 1;
    color: #fff;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 60px rgba(245, 158, 11, 0.7);
    animation: pulse 1s ease-in-out infinite;
  }

  .pregame-sub {
    font-size: 32px;
    font-weight: 600;
    letter-spacing: 4px;
    color: #475569;
  }

  @keyframes reveal-entrance {
    0%   { opacity: 0; transform: scale(0.3) translateY(40px); filter: blur(12px); }
    70%  { opacity: 1; transform: scale(1.06) translateY(-6px); filter: blur(0); }
    100% { opacity: 1; transform: scale(1) translateY(0); filter: blur(0); }
  }

  @keyframes reveal-glow {
    0%, 100% { text-shadow: 0 0 28px rgba(187, 247, 208, 0.7), 0 4px 12px rgba(0, 0, 0, 0.5); }
    50%       { text-shadow: 0 0 52px rgba(187, 247, 208, 1.0), 0 6px 16px rgba(0, 0, 0, 0.5); }
  }

  @keyframes emoji-entrance {
    0%   { opacity: 0; transform: scale(0.4) translateY(60px); }
    65%  { opacity: 1; transform: scale(1.08) translateY(-12px); }
    100% { opacity: 1; transform: scale(1) translateY(0); }
  }

  @keyframes emoji-float {
    0%, 100% { transform: translateY(0px); }
    50%       { transform: translateY(-18px); }
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.75; }
  }

  @keyframes bounce {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(8px); }
  }

  @keyframes pop-in {
    0%   { opacity: 0; transform: scale(0.6); }
    100% { opacity: 1; transform: scale(1); }
  }
</style>
