import { Car, Cat, Crown, Dog, Footprints, Ship } from "lucide-react";
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

export type Edge = "top" | "bottom" | "left" | "right";

/**
 * Which of the four sides a (non-corner) space sits on. A left/right tile is geometrically
 * identical to a top/bottom tile with its two axes swapped — never rotated content into a
 * mismatched box, just lay each one out in its own natural orientation.
 */
export function edgeOf(index: number): Edge {
  const { col, row } = spaceToGrid(index);
  if (row === 0) return "top";
  if (row === 10) return "bottom";
  return col === 0 ? "left" : "right";
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

/** A space's full bounding box as 0-100 percentages of the board — the general form
 * spaceToPercent's center point is a special case of, needed for placing something at a specific
 * spot *within* a tile (e.g. the Jail cell) rather than dead center. */
function spaceBounds(index: number): { left: number; top: number; right: number; bottom: number } {
  const { col, row } = spaceToGrid(index);
  const left = (trackStart(col) / TOTAL_UNITS) * 100;
  const right = ((trackStart(col) + trackSize(col)) / TOTAL_UNITS) * 100;
  const top = (trackStart(row) / TOTAL_UNITS) * 100;
  const bottom = ((trackStart(row) + trackSize(row)) / TOTAL_UNITS) * 100;
  return { left, top, right, bottom };
}

// Must match the engine's private JAIL_SPACE_INDEX (game.ts) — not exported from the engine
// package, so duplicated here as the one place the web layer needs the raw index.
export const JAIL_SPACE_INDEX = 10;

// The Jail tile has two real sub-areas (see the .jail-corner rules in index.css): a small inset
// cell — upper-right, bars visible — for tokens actually in jail, and an outer L-shaped "Just
// Visiting" strip along the left and bottom edges for tokens that merely landed there or are
// passing through. Fractions are eyeballed against the card art, not measured.
const JAIL_CELL_FRACTION = { x: 0.68, y: 0.32 };
const JAIL_VISITING_FRACTION = { x: 0.28, y: 0.76 };

/** Anchor point (0-100 board percentage) for a token that's either in the Jail cell or just
 * visiting — see JAIL_CELL_FRACTION/JAIL_VISITING_FRACTION. */
export function jailZoneAnchor(zone: "cell" | "visiting"): { left: number; top: number } {
  const bounds = spaceBounds(JAIL_SPACE_INDEX);
  const frac = zone === "cell" ? JAIL_CELL_FRACTION : JAIL_VISITING_FRACTION;
  return {
    left: bounds.left + (bounds.right - bounds.left) * frac.x,
    top: bounds.top + (bounds.bottom - bounds.top) * frac.y,
  };
}

// red/orange/yellow nudged away from PLAYER_COLORS' red/amber/gold (below) — at a glance the two
// palettes used to collide (e.g. group red #d32f2f vs player red #e63946), making an owned
// same-hue-family property unreadable as "two layers, one color story." Still unmistakably the
// same Monopoly color family, just enough lightness/saturation gap to stay distinct from a token.
export const GROUP_COLORS: Record<ColorGroup, string> = {
  brown: "#8b4513",
  lightblue: "#aee2f0",
  pink: "#d93a96",
  orange: "#ffa726",
  red: "#b71c1c",
  yellow: "#fff176",
  green: "#2e7d32",
  darkblue: "#1a3e8c",
  railroad: "#444444",
  utility: "#888888",
};

// Validated against the dark chart surface (`dataviz` skill's validate_palette.js) for the
// four-player case: lightness band, CVD separation, and contrast all pass for indices 0-3.
export const PLAYER_COLORS = ["#e63946", "#2a9d8f", "#d97706", "#8338ec", "#3a86ff", "#ffbe0b"];

// Classic Monopoly piece icons, matched 1:1 by player index to PLAYER_COLORS — shared by the
// board tokens, the monopoly badge, and the player panel so the same icon+color pairing for a
// given player reads consistently everywhere it appears.
export const TOKEN_ICONS = [Crown, Car, Dog, Footprints, Ship, Cat];
