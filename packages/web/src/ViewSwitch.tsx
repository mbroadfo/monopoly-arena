export type View = "play" | "train";

/** Lives inside each screen's own side panel (`.properties-column` on Play, `.training-side` on
 * Train) rather than as a page-level nav bar — a standalone bar above `.layout` used to add its
 * own row of height and shift `.layout`'s children out from under their viewport-relative sizing,
 * which assumes near-zero top offset (see `.board-grid`'s width calc). Nesting it inside a panel
 * that already manages its own fixed height/overflow avoids disturbing that budget entirely. */
export function ViewSwitch({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="view-switch">
      <button className={view === "play" ? "active" : ""} onClick={() => onChange("play")}>
        Play
      </button>
      <button className={view === "train" ? "active" : ""} onClick={() => onChange("train")}>
        Train
      </button>
    </div>
  );
}
