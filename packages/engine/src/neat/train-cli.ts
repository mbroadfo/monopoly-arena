#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { trainNeat } from "./train.js";

const { values } = parseArgs({
  options: {
    population: { type: "string" },
    generations: { type: "string" },
    gamesPerGenome: { type: "string" },
    seed: { type: "string" },
    maxTurns: { type: "string" },
    noCoaching: { type: "boolean" },
    distanceThreshold: { type: "string" },
    selfPlay: { type: "boolean" },
  },
});

const population = values.population ? parseInt(values.population, 10) : 16;
const generations = values.generations ? parseInt(values.generations, 10) : 15;
const gamesPerGenome = values.gamesPerGenome ? parseInt(values.gamesPerGenome, 10) : 4;
const seed = values.seed ? parseInt(values.seed, 10) : 1;
const maxTurnsPerGame = values.maxTurns ? parseInt(values.maxTurns, 10) : 1000;
const coaching = !values.noCoaching;
const speciesDistanceThreshold = values.distanceThreshold ? parseFloat(values.distanceThreshold) : undefined;
const selfPlay = values.selfPlay ?? false;

console.log(
  `Training NEAT: population=${population} generations=${generations} gamesPerGenome=${gamesPerGenome} ` +
    `(${population * generations * gamesPerGenome} games total, seed ${seed}, coaching ${coaching ? "on" : "off"}, ` +
    `selfPlay ${selfPlay ? "on" : "off"})`,
);
console.log(
  selfPlay
    ? "Fitness = win bonus + net worth, half vs. the persistent champion + Naive/OrangeRush, half vs. Naive/Random/OrangeRush.\n"
    : "Fitness = win bonus + net worth at game end, vs. a fixed Naive/Random/OrangeRush roster.\n",
);

const start = Date.now();
const { champion, history } = trainNeat({
  population,
  generations,
  gamesPerGenome,
  seed,
  maxTurnsPerGame,
  coaching,
  speciesDistanceThreshold,
  selfPlay,
  onGeneration: (stats) => {
    console.log(
      `  gen ${String(stats.generation).padStart(3)}  best ${stats.bestFitness.toFixed(1).padStart(9)}  ` +
        `avg ${stats.averageFitness.toFixed(1).padStart(9)}  species ${stats.speciesCount}`,
    );
  },
});
const elapsedSeconds = (Date.now() - start) / 1000;

// Deliberately targets the *source* tree, not wherever this script itself is running from
// (src/neat/train-cli.ts under vitest, or dist/neat/train-cli.js as the real compiled CLI) —
// both sit one level under the package root, so "up two, then into src/bots" lands on the
// checked-in source location either way. Writing to a compiled dist/ copy instead would just get
// silently overwritten by the next build's copy-champion step.
const outputPath = fileURLToPath(new URL("../../src/bots/neat-champion.json", import.meta.url));
writeFileSync(outputPath, JSON.stringify(champion, null, 2));

console.log(`\nDone in ${elapsedSeconds.toFixed(1)}s.`);
console.log(`Final best fitness: ${history[history.length - 1]?.bestFitness.toFixed(1)}`);
console.log(`Champion genome (${champion.nodes.length} nodes, ${champion.connections.length} connections) written to ${outputPath}`);
