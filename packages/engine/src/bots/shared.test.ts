import { describe, expect, it } from "vitest";
import { baseState } from "../testFixtures.js";
import { completesMonopolyFor, findMutualMonopolyTargets, maxOpponentRentThreat, maxRentThreat, percentPropertiesUnowned } from "./shared.js";

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean; mortgaged?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: overrides.mortgaged ?? false };
}

describe("maxOpponentRentThreat", () => {
  it("is 0 when no opponent owns anything", () => {
    const state = baseState();
    expect(maxOpponentRentThreat(state, "p0")).toBe(0);
  });

  it("finds the single highest rent across an opponent's holdings", () => {
    const state = baseState();
    state.ownership[1] = owned("p1"); // Mediterranean, base rent 2
    state.ownership[39] = owned("p1"); // Boardwalk, base rent 50
    expect(maxOpponentRentThreat(state, "p0")).toBe(50);
  });

  it("ignores mortgaged properties", () => {
    const state = baseState();
    state.ownership[39] = owned("p1", { mortgaged: true });
    expect(maxOpponentRentThreat(state, "p0")).toBe(0);
  });

  it("ignores this player's own holdings", () => {
    const state = baseState();
    state.ownership[39] = owned("p0"); // I own Boardwalk myself
    expect(maxOpponentRentThreat(state, "p0")).toBe(0);
  });

  it("accounts for developed rent tiers", () => {
    const state = baseState();
    state.ownership[39] = owned("p1", { houses: 2 }); // Boardwalk rent[2] = 600
    expect(maxOpponentRentThreat(state, "p0")).toBe(600);
  });

  it("doubles base rent for a completed monopoly with no houses yet", () => {
    const state = baseState();
    state.ownership[1] = owned("p1"); // Mediterranean, base rent 2
    state.ownership[3] = owned("p1"); // Baltic (base rent 4) — completes the brown group
    expect(maxOpponentRentThreat(state, "p0")).toBe(8); // Baltic's base rent (4) doubled by the monopoly
  });

  it("scales railroad rent by count owned", () => {
    const state = baseState();
    state.ownership[5] = owned("p1");
    state.ownership[15] = owned("p1");
    expect(maxOpponentRentThreat(state, "p0")).toBe(50); // 25 * 2^(2-1)
  });
});

describe("maxRentThreat", () => {
  it("is 0 when the player owns nothing", () => {
    const state = baseState();
    expect(maxRentThreat(state, "p0")).toBe(0);
  });

  it("finds the single highest rent across the player's own holdings", () => {
    const state = baseState();
    state.ownership[1] = owned("p0"); // Mediterranean, base rent 2
    state.ownership[39] = owned("p0"); // Boardwalk, base rent 50
    expect(maxRentThreat(state, "p0")).toBe(50);
  });

  it("ignores mortgaged properties", () => {
    const state = baseState();
    state.ownership[39] = owned("p0", { mortgaged: true });
    expect(maxRentThreat(state, "p0")).toBe(0);
  });

  it("ignores other players' holdings", () => {
    const state = baseState();
    state.ownership[39] = owned("p1");
    expect(maxRentThreat(state, "p0")).toBe(0);
  });
});

describe("percentPropertiesUnowned", () => {
  it("is 1.0 at the start of the game, before anyone owns anything", () => {
    const state = baseState();
    expect(percentPropertiesUnowned(state)).toBe(1);
  });

  it("falls as properties are claimed, regardless of who owns them", () => {
    const state = baseState();
    const indices = Object.keys(state.ownership).map(Number);
    expect(indices.length).toBe(28); // 22 color properties + 4 railroads + 2 utilities
    for (const i of indices.slice(0, 14)) state.ownership[i] = owned(i % 2 === 0 ? "p0" : "p1");
    expect(percentPropertiesUnowned(state)).toBe(0.5);
  });

  it("is 0 once every ownable space is claimed", () => {
    const state = baseState();
    for (const i of Object.keys(state.ownership).map(Number)) state.ownership[i] = owned("p0");
    expect(percentPropertiesUnowned(state)).toBe(0);
  });
});

describe("completesMonopolyFor", () => {
  const MEDITERRANEAN = 1; // brown group with Baltic
  const BALTIC = 3;

  it("is true when the gaining player already owns the rest of the group", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p1");
    state.ownership[BALTIC] = owned("p0");
    expect(completesMonopolyFor(state, "p1", BALTIC, "p0")).toBe(true);
  });

  it("is false when the gaining player doesn't yet own the rest of the group", () => {
    const state = baseState();
    state.ownership[BALTIC] = owned("p0");
    expect(completesMonopolyFor(state, "p1", BALTIC, "p0")).toBe(false);
  });

  it("is false when the space belongs to someone other than the stated current owner", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p1");
    state.ownership[BALTIC] = owned("p2");
    expect(completesMonopolyFor(state, "p1", BALTIC, "p0")).toBe(false);
  });
});

describe("findMutualMonopolyTargets", () => {
  const MEDITERRANEAN = 1; // brown group with Baltic
  const BALTIC = 3;
  const ORIENTAL = 6; // light-blue group with Vermont and Connecticut
  const VERMONT = 8;
  const CONNECTICUT = 9;

  it("finds a property that completes the counterparty's own missing group", () => {
    const state = baseState();
    // p0 is missing Baltic; p1 is missing Connecticut, which p0 owns.
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");
    state.ownership[ORIENTAL] = owned("p1");
    state.ownership[VERMONT] = owned("p1");
    state.ownership[CONNECTICUT] = owned("p0");

    expect(findMutualMonopolyTargets(state, "p0", "p1", BALTIC)).toEqual([CONNECTICUT]);
  });

  it("excludes a same-group swap that would just trade places on a 2-property group", () => {
    const state = baseState();
    // Only the brown group is in play — p0 and p1 each own the other's missing piece, which
    // would otherwise look like a "mutual" swap but is actually self-cancelling.
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");

    expect(findMutualMonopolyTargets(state, "p0", "p1", BALTIC)).toEqual([]);
  });

  it("is empty when the counterparty isn't missing exactly one piece of anything p0 holds", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");
    expect(findMutualMonopolyTargets(state, "p0", "p2", BALTIC)).toEqual([]);
  });
});
