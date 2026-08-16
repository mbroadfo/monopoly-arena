import { useEffect, useRef } from "react";
import type { GameState } from "@monopoly-arena/engine";

const ROUND_HEADER = /^Round \d+$/;
const TURN_MARKER = /^Round \d+ · .+'s turn/;
const TAGGED_EVENT = /^ {2}\[(\w+)] /;

// The log is still a flat string[] (see game.ts's logEvent) — classify each line by its own
// formatting (leading "Round N", "  [TAG] ", or plain "  " indentation) rather than the engine
// exposing a parallel structured type just for styling.
function classify(entry: string): { className: string; tag: string | null } {
  if (ROUND_HEADER.test(entry)) return { className: "log-round", tag: null };
  if (TURN_MARKER.test(entry)) return { className: "log-turn", tag: null };
  const tagged = entry.match(TAGGED_EVENT);
  if (tagged) return { className: "log-event log-tagged", tag: tagged[1] };
  return { className: "log-event", tag: null };
}

export function LogFeed({ state }: { state: GameState }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const recent = state.log.slice(-100);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [state.log.length]);

  return (
    <div className="log-feed" ref={containerRef}>
      {recent.map((entry, i) => {
        const { className, tag } = classify(entry);
        return (
          <div key={i} className={`log-entry ${className}`} data-tag={tag ?? undefined}>
            {entry}
          </div>
        );
      })}
    </div>
  );
}
