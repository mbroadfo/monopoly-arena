import { useEffect, useRef } from "react";
import type { GameState } from "@monopoly-arena/engine";

export function LogFeed({ state }: { state: GameState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const recent = state.log.slice(-100);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [state.log.length]);

  return (
    <div className="log-feed" ref={containerRef}>
      {recent.map((entry, i) => (
        <div key={i} className="log-entry">
          {entry}
        </div>
      ))}
    </div>
  );
}
