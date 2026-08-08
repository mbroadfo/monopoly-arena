#!/usr/bin/env node
import { parseArgs } from "node:util";
import { createMonteCarloBot } from "./bots/monteCarlo.js";
import { createNaiveBot } from "./bots/naive.js";
import { createOrangeRushBot } from "./bots/orangeRush.js";
import { createRailroadBaronBot } from "./bots/railroadBaron.js";
import { createRandomBot } from "./bots/random.js";
import { runBatchSimulation, type BatchPlayer, type BatchResult, type GameResult } from "./batch.js";
import type { Rng } from "./dice.js";
import type { Bot } from "./types.js";

// A small, engine-side registry — deliberately not a reuse of the web's BOT_CHOICES (useGame.ts),
// which carries UI-only label strings and can't be imported from here anyway (the engine never
// depends on the web layer).
const BOT_FACTORIES: Record<string, (rng: Rng) => Bot> = {
  naive: () => createNaiveBot(),
  random: () => createRandomBot(),
  orangeRush: () => createOrangeRushBot(),
  railroadBaron: () => createRailroadBaronBot(),
  monteCarlo: (rng) => createMonteCarloBot({ rng }),
};

function usage(message?: string): never {
  if (message) console.error(`${message}\n`);
  console.error("Usage: npm run batch -- --bots=<name,name,...> [--games=100] [--seed=1] [--maxTurns=1000]");
  console.error(`Bot names: ${Object.keys(BOT_FACTORIES).join(", ")}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    bots: { type: "string" },
    games: { type: "string" },
    seed: { type: "string" },
    maxTurns: { type: "string" },
  },
});

if (!values.bots) usage("Missing required --bots");

const botKeys = values.bots.split(",").map((s) => s.trim());
for (const key of botKeys) {
  if (!(key in BOT_FACTORIES)) usage(`Unknown bot "${key}"`);
}

// Numbered by seat position (1..N), matching the web UI's convention (useGame.ts's newGame) —
// not by count-of-that-type, so a mixed lineup reads the same way in both places.
const players: BatchPlayer[] = botKeys.map((key, i) => {
  const displayName = key.charAt(0).toUpperCase() + key.slice(1);
  return { name: `${displayName} ${i + 1}`, createBot: BOT_FACTORIES[key] };
});

const gameCount = values.games ? parseInt(values.games, 10) : 100;
const seed = values.seed ? parseInt(values.seed, 10) : 1;
const maxTurnsPerGame = values.maxTurns ? parseInt(values.maxTurns, 10) : 1000;

console.log(`Running ${gameCount} games: ${players.map((p) => p.name).join(", ")} (seed ${seed}, max ${maxTurnsPerGame} turns/game)`);
const progressEvery = Math.max(1, Math.floor(gameCount / 20));

const result: BatchResult = runBatchSimulation({
  players,
  gameCount,
  seed,
  maxTurnsPerGame,
  onGameComplete: (gameIndex) => {
    if ((gameIndex + 1) % progressEvery === 0 || gameIndex + 1 === gameCount) {
      console.log(`  ...${gameIndex + 1}/${gameCount}`);
    }
  },
});

console.log("");
console.log(formatReport(players, result));

function formatReport(players: BatchPlayer[], result: BatchResult): string {
  const lines: string[] = [];
  const total = result.games.length;

  const winCounts = new Map<string, number>();
  for (const p of players) winCounts.set(p.name, 0);
  let noWinner = 0;
  for (const g of result.games) {
    if (g.winnerName) winCounts.set(g.winnerName, (winCounts.get(g.winnerName) ?? 0) + 1);
    else noWinner++;
  }

  lines.push("Win rate:");
  for (const [name, count] of winCounts) {
    lines.push(`  ${name.padEnd(20)} ${String(count).padStart(4)}  (${((count / total) * 100).toFixed(1)}%)`);
  }
  if (noWinner > 0) {
    lines.push(`  ${"(no winner / turn cap)".padEnd(20)} ${String(noWinner).padStart(4)}  (${((noWinner / total) * 100).toFixed(1)}%)`);
  }
  lines.push("");

  const turnCounts = result.games.map((g) => g.turns).sort((a, b) => a - b);
  const avgTurns = turnCounts.reduce((a, b) => a + b, 0) / turnCounts.length;
  const medianTurns = turnCounts[Math.floor(turnCounts.length / 2)];
  lines.push("Game length (turns):");
  lines.push(`  avg ${avgTurns.toFixed(1)}   median ${medianTurns}   min ${turnCounts[0]}   max ${turnCounts[turnCounts.length - 1]}`);

  const withWinner: GameResult[] = result.games.filter((g) => g.winnerName !== null);
  if (withWinner.length > 0) {
    const avgProperties = withWinner.reduce((sum, g) => sum + g.winnerProperties, 0) / withWinner.length;
    const avgMonopolies = withWinner.reduce((sum, g) => sum + g.winnerMonopolies, 0) / withWinner.length;
    lines.push("");
    lines.push("Winner's board presence at game end:");
    lines.push(`  avg properties owned   ${avgProperties.toFixed(1)}`);
    lines.push(`  avg monopolies         ${avgMonopolies.toFixed(1)}`);
  }

  return lines.join("\n");
}
