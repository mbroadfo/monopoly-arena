import type { ColorGroup } from "@monopoly-arena/engine";

export const GRID_SIZE = 11;

/** Maps a board space index (0-39) to a (col, row) cell on an 11x11 grid, corners at the four grid corners. */
export function spaceToGrid(index: number): { col: number; row: number } {
  const i = ((index % 40) + 40) % 40;
  if (i <= 10) return { col: 10 - i, row: 10 };
  if (i <= 20) return { col: 0, row: 10 - (i - 10) };
  if (i <= 30) return { col: i - 20, row: 0 };
  return { col: 10, row: i - 30 };
}

export function isCorner(index: number): boolean {
  return index === 0 || index === 10 || index === 20 || index === 30;
}

// Board side = 9W + 2D (W = one along-edge tile, D = corner/edge depth) — matches Board.tsx's
// BOARD_TEMPLATE, which lays out grid-template-columns/rows as this ratio in literal fr values.
export const EDGE_DEPTH_RATIO = 2;
const INNER_TRACKS = 9;
const TOTAL_UNITS = EDGE_DEPTH_RATIO * 2 + INNER_TRACKS;

function trackStart(i: number): number {
  if (i <= 0) return 0;
  if (i >= 10) return EDGE_DEPTH_RATIO + INNER_TRACKS;
  return EDGE_DEPTH_RATIO + (i - 1);
}

function trackSize(i: number): number {
  return i === 0 || i === 10 ? EDGE_DEPTH_RATIO : 1;
}

/** A space's center as a 0-100 percentage of the board, accounting for the corner tracks
 * being wider than the 9 inner tracks — used to position tokens on an absolute overlay layer. */
export function spaceToPercent(index: number): { left: number; top: number } {
  const { col, row } = spaceToGrid(index);
  const left = ((trackStart(col) + trackSize(col) / 2) / TOTAL_UNITS) * 100;
  const top = ((trackStart(row) + trackSize(row) / 2) / TOTAL_UNITS) * 100;
  return { left, top };
}

export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: "#8b4513",
  lightblue: "#aee2f0",
  pink: "#d93a96",
  orange: "#f0a021",
  red: "#d32f2f",
  yellow: "#f5e642",
  green: "#2e7d32",
  darkblue: "#1a3e8c",
  railroad: "#444444",
  utility: "#888888",
};

// Validated against the dark chart surface (`dataviz` skill's validate_palette.js) for the
// four-player case: lightness band, CVD separation, and contrast all pass for indices 0-3.
export const PLAYER_COLORS = ["#e63946", "#2a9d8f", "#d97706", "#8338ec", "#3a86ff", "#ffbe0b"];
