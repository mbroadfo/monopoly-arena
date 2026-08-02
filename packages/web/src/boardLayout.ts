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
