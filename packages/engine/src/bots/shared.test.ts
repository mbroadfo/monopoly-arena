import { describe, expect, it } from "vitest";
import { baseState } from "../testFixtures.js";
import { maxOpponentRentThreat, maxRentThreat } from "./shared.js";

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
