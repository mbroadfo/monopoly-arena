import { useCallback, useEffect, useRef, useState } from "react";
import { Game, createNaiveBot, createRandomBot, type Bot, type GameState } from "@monopoly-arena/engine";

export interface BotChoice {
  label: string;
  create: () => Bot;
}

export const BOT_CHOICES: BotChoice[] = [
  { label: "Naive (buys + builds within reserve)", create: () => createNaiveBot() },
  { label: "Random (buys everything, never builds)", create: () => createRandomBot() },
];

function newGame(botIndices: number[]): Game {
  return new Game({
    playerNames: botIndices.map((b, i) => `${BOT_CHOICES[b].label.split(" ")[0]} ${i + 1}`),
    bots: botIndices.map((b) => BOT_CHOICES[b].create()),
  });
}

export function useGame(initialBotIndices: number[] = [0, 1]) {
  const gameRef = useRef<Game>(newGame(initialBotIndices));
  const [state, setState] = useState<GameState>(() => gameRef.current.getSnapshot());
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(400);

  const step = useCallback(() => {
    if (gameRef.current.isGameOver()) {
      setPlaying(false);
      return;
    }
    gameRef.current.playTurn();
    setState(gameRef.current.getSnapshot());
  }, []);

  const reset = useCallback((botIndices: number[]) => {
    gameRef.current = newGame(botIndices);
    setState(gameRef.current.getSnapshot());
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(step, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, step]);

  return { state, step, reset, playing, setPlaying, speedMs, setSpeedMs };
}
