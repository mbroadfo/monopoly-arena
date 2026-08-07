import { describe, expect, it } from "vitest";
import { evaluatePosition, expectedRentIncome } from "./lookahead.js";
import { baseState } from "./testFixtures.js";

describe("expectedRentIncome", () => {
  it("is proportional to the opponent's probability of landing on the property next turn", () => {
    // States Avenue (13), base rent $10, no monopoly — kept isolated so the monopoly bonus
    // doesn't confound this specific comparison.
    const state = baseState();
    state.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };

    // Distance 7 from Rival's position (13 - 7 = 6) has the highest single-roll probability, 6/36.
    state.players[1].position = 6;
    expect(expectedRentIncome(state, "p0")).toBeCloseTo((6 / 36) * 10, 5);

    // Distance 13 is unreachable in a single roll (max is 12) — no expected income from it.
    state.players[1].position = 0;
    expect(expectedRentIncome(state, "p0")).toBe(0);
  });

  it("scales with the property's current development level", () => {
    const state = baseState();
    state.players[1].position = 6; // distance 7 to space 13, as above
    state.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    const undeveloped = expectedRentIncome(state, "p0");

    state.ownership[13] = { ownerId: "p0", houses: 4, hotel: false, mortgaged: false };
    const fourHouses = expectedRentIncome(state, "p0");

    expect(fourHouses).toBeGreaterThan(undeveloped);
    expect(fourHouses).toBeCloseTo((6 / 36) * 625, 5); // States Avenue's 4-house rent
  });

  it("is 0 for a mortgaged property, regardless of opponent proximity", () => {
    const state = baseState();
    state.players[1].position = 6;
    state.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: true };
    expect(expectedRentIncome(state, "p0")).toBe(0);
  });
});

describe("evaluatePosition", () => {
  it("scores a closer opponent higher than a farther one, all else equal", () => {
    const near = baseState();
    near.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    near.players[1].position = 6; // distance 7 — high landing probability

    const far = baseState();
    far.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    far.players[1].position = 0; // distance 13 — unreachable in one roll

    expect(evaluatePosition(near, "p0")).toBeGreaterThan(evaluatePosition(far, "p0"));
  });

  it("recognizes that building further increases a property's forward-looking value", () => {
    const undeveloped = baseState();
    undeveloped.ownership[13] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    undeveloped.players[1].position = 6;

    const developed = baseState();
    developed.ownership[13] = { ownerId: "p0", houses: 4, hotel: false, mortgaged: false };
    developed.players[1].position = 6;

    expect(evaluatePosition(developed, "p0")).toBeGreaterThan(evaluatePosition(undeveloped, "p0"));
  });
});
