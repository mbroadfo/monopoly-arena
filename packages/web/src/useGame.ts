import { useCallback, useEffect, useRef, useState } from "react";
import {
  Game,
  createNaiveBot,
  createOrangeRushBot,
  createRailroadBaronBot,
  createRandomBot,
  type Bot,
  type GameState,
} from "@monopoly-arena/engine";

export interface BotChoice {
  label: string;
  create: () => Bot;
}

export interface BankrollPoint {
  turn: number;
  cash: number[];
}

function historyPoint(state: GameState): BankrollPoint {
  return { turn: state.turn, cash: state.players.map((p) => p.cash) };
}

export const BOT_CHOICES: BotChoice[] = [
  { label: "Naive (buys + builds within reserve)", create: () => createNaiveBot() },
  { label: "Random (buys everything, builds with thin buffer)", create: () => createRandomBot() },
  { label: "OrangeRush (rushes orange/red, thin reserve)", create: () => createOrangeRushBot() },
  { label: "RailroadBaron (railroads/utilities, big reserve)", create: () => createRailroadBaronBot() },
];

function newGame(botIndices: number[]): Game {
  return new Game({
    playerNames: botIndices.map((b, i) => `${BOT_CHOICES[b].label.split(" ")[0]} ${i + 1}`),
    bots: botIndices.map((b) => BOT_CHOICES[b].create()),
  });
}

export function useGame(initialBotIndices: number[] = [0, 1, 2, 3]) {
  const gameRef = useRef<Game>(newGame(initialBotIndices));
  const [state, setState] = useState<GameState>(() => gameRef.current.getSnapshot());
  const [history, setHistory] = useState<BankrollPoint[]>(() => [historyPoint(state)]);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(400);

  const step = useCallback(() => {
    if (gameRef.current.isGameOver()) {
      setPlaying(false);
      return;
    }
    gameRef.current.playTurn();
    const snapshot = gameRef.current.getSnapshot();
    setState(snapshot);
    setHistory((h) => [...h, historyPoint(snapshot)]);
  }, []);

  const reset = useCallback((botIndices: number[]) => {
    gameRef.current = newGame(botIndices);
    const snapshot = gameRef.current.getSnapshot();
    setState(snapshot);
    setHistory([historyPoint(snapshot)]);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(step, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, step]);

  return { state, history, step, reset, playing, setPlaying, speedMs, setSpeedMs };
}
