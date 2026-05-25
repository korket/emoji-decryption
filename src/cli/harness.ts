/**
 * Interactive CLI harness — runs a full GameLoop in the terminal.
 * Seed puzzles are loaded into memory, phases tick in real time, and you
 * type guesses at the ">" prompt.  Ctrl+C to quit.
 *
 * Usage:  npm run harness
 */
import readline from 'readline';
import { openDatabase } from '../persistence/db';
import { seedPuzzlesIfEmpty } from '../persistence/seed';
import { GameLoop } from '../game/loop';
import type { GameEvent } from '../types/events';
import type { ChatMessage } from '../types/chat-message';

// ─── terminal helpers ────────────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

function line(char = '─', len = 50) {
  return char.repeat(len);
}

function fmt(color: keyof typeof C, text: string) {
  return `${C[color]}${text}${C.reset}`;
}

// ─── event display ───────────────────────────────────────────────────────────

function display(event: GameEvent): void {
  switch (event.type) {
    case 'puzzle_reveal': {
      const cat = event.category.toUpperCase();
      process.stdout.write('\n' + line() + '\n');
      process.stdout.write(fmt('bold', `🎯 Round ${event.roundNumber}`) + fmt('dim', ` — ${cat}`) + '\n');
      process.stdout.write(fmt('yellow', `   ${event.emojis}`) + '\n');
      process.stdout.write(fmt('dim', '   Scoring window: 10 s — type your guess!\n'));
      process.stdout.write(line() + '\n');
      break;
    }
    case 'phase_change': {
      const secs = Math.round(event.remainingMs / 1000);
      const label = `[${event.phase}]`;
      process.stdout.write(fmt('dim', `⏱  ${label} ${secs}s left\n`));
      break;
    }
    case 'correct_guess': {
      const medal = event.rank === 1 ? '🥇' : event.rank === 2 ? '🥈' : event.rank === 3 ? '🥉' : '✓ ';
      process.stdout.write(
        `${medal} ${fmt('green', event.userHandle)} ` +
        fmt('bold', `+${event.points} pts`) +
        fmt('dim', ` (rank #${event.rank})`) + '\n',
      );
      break;
    }
    case 'hint_reveal':
      process.stdout.write(fmt('cyan', `💡 Hint ${event.hintIndex}: ${event.revealedLetters}\n`));
      break;
    case 'round_end': {
      process.stdout.write('\n' + fmt('bold', `✅ Answer: ${fmt('green', event.answer)}`) + '\n');
      if (event.winners.length === 0) {
        process.stdout.write(fmt('dim', '   No winners this round.\n'));
      } else {
        const top = event.winners
          .map((w) => `${w.userHandle} (${w.points} pts)`)
          .join(', ');
        process.stdout.write(fmt('dim', `   Winners: ${top}\n`));
      }
      break;
    }
    case 'leaderboard_update': {
      process.stdout.write('\n' + fmt('bold', '📊 Session leaderboard:\n'));
      if (event.session.length === 0) {
        process.stdout.write(fmt('dim', '   (no scores yet)\n'));
      } else {
        event.session.forEach((entry, i) => {
          process.stdout.write(`   ${i + 1}. ${entry.userHandle} — ${fmt('bold', String(entry.points))} pts\n`);
        });
      }
      break;
    }
  }
}

// ─── game loop ───────────────────────────────────────────────────────────────

const db = openDatabase(':memory:');
const seeded = seedPuzzlesIfEmpty(db);
process.stdout.write(`🎮 ${fmt('bold', 'Emoguessr')} — CLI Harness\n`);
process.stdout.write(fmt('dim', `   ${seeded} puzzles loaded. Type guesses at the prompt. Ctrl+C to quit.\n\n`));

let roundActive = false;
let rl!: readline.Interface;

const loop = new GameLoop(db, `harness-${Date.now()}`, (event) => {
  rl.pause();
  display(event);
  if (event.type === 'puzzle_reveal') roundActive = true;
  if (event.type === 'round_end') {
    roundActive = false;
    process.stdout.write(fmt('dim', '\nNext round in 3 s…\n'));
  }
  if (roundActive) rl.prompt(true);
}, { interRoundMs: 3_000 });

// ─── readline ────────────────────────────────────────────────────────────────

rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: fmt('dim', '> '),
  terminal: true,
});

rl.on('line', (line) => {
  const text = line.trim();
  if (!text || !roundActive) {
    rl.prompt(true);
    return;
  }
  const chatMsg: ChatMessage = {
    id: `harness-${Date.now()}`,
    userId: 'harness-user',
    userHandle: 'You',
    text,
    receivedAt: Date.now(),
  };
  loop.processGuess(chatMsg, Date.now());
  rl.prompt(true);
});

function cleanup(): void {
  loop.stop();
  db.close();
  rl.close();
  process.exit(0);
}

rl.on('close', cleanup);
process.on('SIGINT', () => {
  process.stdout.write('\n');
  cleanup();
});

loop.start();
