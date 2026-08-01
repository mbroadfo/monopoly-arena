import { useEffect, useRef } from "react";
import type { ColorGroup, GameState } from "@monopoly-arena/engine";
import { GRID_SIZE, GROUP_COLORS, PLAYER_COLORS, isCorner, spaceToGrid } from "./boardLayout";

const CANVAS_SIZE = 770;
const CELL = CANVAS_SIZE / GRID_SIZE;

function hasGroup(space: GameState["spaces"][number]): space is GameState["spaces"][number] & { group: ColorGroup } {
  return "group" in space;
}

export function Board({ state }: { state: GameState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.fillStyle = "#0f5132";
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    for (const space of state.spaces) {
      const { col, row } = spaceToGrid(space.index);
      const x = col * CELL;
      const y = row * CELL;
      const corner = isCorner(space.index);

      ctx.fillStyle = "#f5f2e8";
      ctx.fillRect(x, y, CELL, CELL);
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, CELL, CELL);

      if (hasGroup(space) && !corner) {
        ctx.fillStyle = GROUP_COLORS[space.group];
        ctx.fillRect(x, y, CELL, CELL * 0.22);
        ctx.strokeRect(x, y, CELL, CELL * 0.22);
      }

      const record = state.ownership[space.index];
      if (record && record.ownerId) {
        const ownerIndex = state.players.findIndex((p) => p.id === record.ownerId);
        ctx.strokeStyle = PLAYER_COLORS[ownerIndex % PLAYER_COLORS.length];
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
        ctx.lineWidth = 1;
      }

      ctx.fillStyle = "#111";
      ctx.font = "8px sans-serif";
      wrapText(ctx, space.name, x + CELL / 2, y + CELL * 0.45, CELL - 6, 9);

      if (record && (record.houses > 0 || record.hotel)) {
        if (record.hotel) {
          ctx.fillStyle = "#c62828";
          ctx.fillRect(x + CELL / 2 - 6, y + CELL - 14, 12, 8);
        } else {
          ctx.fillStyle = "#2e7d32";
          for (let h = 0; h < record.houses; h++) {
            ctx.fillRect(x + 4 + h * 8, y + CELL - 12, 6, 6);
          }
        }
      }
    }

    // Player tokens
    for (let i = 0; i < state.players.length; i++) {
      const player = state.players[i];
      const { col, row } = spaceToGrid(player.position);
      const baseX = col * CELL + CELL / 2;
      const baseY = row * CELL + CELL * 0.75;
      const offset = 9;
      const angle = (i / Math.max(state.players.length, 1)) * Math.PI * 2;
      const tx = baseX + Math.cos(angle) * offset * (state.players.length > 1 ? 1 : 0);
      const ty = baseY + Math.sin(angle) * offset * (state.players.length > 1 ? 1 : 0);

      ctx.beginPath();
      ctx.arc(tx, ty, 7, 0, Math.PI * 2);
      ctx.fillStyle = player.bankrupt ? "#999" : PLAYER_COLORS[i % PLAYER_COLORS.length];
      ctx.fill();
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Center panel
    ctx.fillStyle = "#0f5132";
    ctx.fillRect(CELL, CELL, CANVAS_SIZE - 2 * CELL, CANVAS_SIZE - 2 * CELL);
    ctx.fillStyle = "#f5f2e8";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("MONOPOLY ARENA", CANVAS_SIZE / 2, CANVAS_SIZE / 2 - 10);
    ctx.font = "14px sans-serif";
    ctx.fillText(`Turn ${state.turn}`, CANVAS_SIZE / 2, CANVAS_SIZE / 2 + 20);
    ctx.textAlign = "start";
  }, [state]);

  return <canvas ref={canvasRef} width={CANVAS_SIZE} height={CANVAS_SIZE} style={{ maxWidth: "100%", height: "auto" }} />;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, cx: number, startY: number, maxWidth: number, lineHeight: number) {
  const words = text.split(" ");
  let line = "";
  const lines: string[] = [];
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  ctx.textAlign = "center";
  const totalHeight = lines.length * lineHeight;
  let y = startY - totalHeight / 2 + lineHeight / 2;
  for (const l of lines) {
    ctx.fillText(l, cx, y);
    y += lineHeight;
  }
  ctx.textAlign = "start";
}
