import { describe, expect, it } from "vitest";
import { baseState } from "../testFixtures.js";
import { encodePropertyFeatures, PROPERTY_SCORE_INPUT_COUNT } from "./encoding.js";

const MEDITERRANEAN = 1; // brown, price 60, rent [2,10,30,90,160,250], group size 2
const BOARDWALK = 39; // darkblue, price 400
const READING_RAILROAD = 5;

describe("encodePropertyFeatures", () => {
  it("returns exactly PROPERTY_SCORE_INPUT_COUNT features", () => {
    const state = baseState();
    expect(encodePropertyFeatures(state, "p0", MEDITERRANEAN)).toHaveLength(PROPERTY_SCORE_INPUT_COUNT);
    expect(PROPERTY_SCORE_INPUT_COUNT).toBe(17);
  });

  it("computes the affordability-margin feature as (cash - price) / 1500", () => {
    const state = baseState();
    state.players[0].cash = 1000;
    const features = encodePropertyFeatures(state, "p0", MEDITERRANEAN); // price 60
    expect(features[9]).toBeCloseTo((1000 - 60) / 1500, 10);
  });

  it("uses the space's base rent, normalized, for color properties", () => {
    const state = baseState();
    const features = encodePropertyFeatures(state, "p0", MEDITERRANEAN);
    expect(features[10]).toBeCloseTo(2 / 250, 10); // Mediterranean's base rent is 2
  });

  it("uses a fixed representative base rent for railroads/utilities", () => {
    const state = baseState();
    const features = encodePropertyFeatures(state, "p0", READING_RAILROAD);
    expect(features[10]).toBeCloseTo(25 / 250, 10);
  });

  it("reflects current improvement level (houses/hotel) of the candidate space", () => {
    const state = baseState();
    state.ownership[BOARDWALK] = { ownerId: "p0", houses: 3, hotel: false, mortgaged: false };
    const withHouses = encodePropertyFeatures(state, "p0", BOARDWALK);
    expect(withHouses[11]).toBeCloseTo(3 / 5, 10);

    state.ownership[BOARDWALK] = { ownerId: "p0", houses: 0, hotel: true, mortgaged: false };
    const withHotel = encodePropertyFeatures(state, "p0", BOARDWALK);
    expect(withHotel[11]).toBeCloseTo(5 / 5, 10);
  });

  it("flags whether the candidate space is currently mortgaged", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN].mortgaged = true;
    const features = encodePropertyFeatures(state, "p0", MEDITERRANEAN);
    expect(features[12]).toBe(1);
  });

  it("tracks the leading opponent's monopoly count, not just the first opponent's", () => {
    const state = baseState({
      players: [
        { id: "p0", name: "Hero", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
        { id: "p1", name: "Weak", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
        { id: "p2", name: "Strong", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
      ],
    });
    // p2 owns the entire brown group (Mediterranean + Baltic).
    state.ownership[1] = { ownerId: "p2", houses: 0, hotel: false, mortgaged: false };
    state.ownership[3] = { ownerId: "p2", houses: 0, hotel: false, mortgaged: false };
    const features = encodePropertyFeatures(state, "p0", 6); // Oriental Ave, an uninvolved candidate space
    expect(features[13]).toBeCloseTo(1 / 8, 10);
  });

  it("computes the active-player fraction, excluding bankrupt players", () => {
    const state = baseState({
      players: [
        { id: "p0", name: "Hero", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
        { id: "p1", name: "Out", cash: 0, position: 0, inJail: false, jailTurns: 0, bankrupt: true, getOutOfJailFreeCards: 0 },
      ],
    });
    const features = encodePropertyFeatures(state, "p0", MEDITERRANEAN);
    expect(features[14]).toBeCloseTo(0.5, 10);
  });

  it("reflects house/hotel scarcity from the bank", () => {
    const state = baseState({ housesRemaining: 8, hotelsRemaining: 2 });
    const features = encodePropertyFeatures(state, "p0", MEDITERRANEAN);
    expect(features[15]).toBeCloseTo(8 / 32, 10);
    expect(features[16]).toBeCloseTo(2 / 12, 10);
  });
});
