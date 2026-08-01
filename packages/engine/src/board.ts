import type { Space } from "./types.js";

/** Standard US Monopoly board layout, spaces 0-39 clockwise from GO. */
export const BOARD: Space[] = [
  { index: 0, type: "go", name: "GO" },
  { index: 1, type: "property", name: "Mediterranean Avenue", group: "brown", price: 60, rent: [2, 10, 30, 90, 160, 250], houseCost: 50 },
  { index: 2, type: "community-chest", name: "Community Chest" },
  { index: 3, type: "property", name: "Baltic Avenue", group: "brown", price: 60, rent: [4, 20, 60, 180, 320, 450], houseCost: 50 },
  { index: 4, type: "tax", name: "Income Tax", amount: 200 },
  { index: 5, type: "railroad", name: "Reading Railroad", group: "railroad", price: 200 },
  { index: 6, type: "property", name: "Oriental Avenue", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
  { index: 7, type: "chance", name: "Chance" },
  { index: 8, type: "property", name: "Vermont Avenue", group: "lightblue", price: 100, rent: [6, 30, 90, 270, 400, 550], houseCost: 50 },
  { index: 9, type: "property", name: "Connecticut Avenue", group: "lightblue", price: 120, rent: [8, 40, 100, 300, 450, 600], houseCost: 50 },
  { index: 10, type: "jail", name: "Jail" },
  { index: 11, type: "property", name: "St. Charles Place", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
  { index: 12, type: "utility", name: "Electric Company", group: "utility", price: 150 },
  { index: 13, type: "property", name: "States Avenue", group: "pink", price: 140, rent: [10, 50, 150, 450, 625, 750], houseCost: 100 },
  { index: 14, type: "property", name: "Virginia Avenue", group: "pink", price: 160, rent: [12, 60, 180, 500, 700, 900], houseCost: 100 },
  { index: 15, type: "railroad", name: "Pennsylvania Railroad", group: "railroad", price: 200 },
  { index: 16, type: "property", name: "St. James Place", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
  { index: 17, type: "community-chest", name: "Community Chest" },
  { index: 18, type: "property", name: "Tennessee Avenue", group: "orange", price: 180, rent: [14, 70, 200, 550, 750, 950], houseCost: 100 },
  { index: 19, type: "property", name: "New York Avenue", group: "orange", price: 200, rent: [16, 80, 220, 600, 800, 1000], houseCost: 100 },
  { index: 20, type: "free-parking", name: "Free Parking" },
  { index: 21, type: "property", name: "Kentucky Avenue", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
  { index: 22, type: "chance", name: "Chance" },
  { index: 23, type: "property", name: "Indiana Avenue", group: "red", price: 220, rent: [18, 90, 250, 700, 875, 1050], houseCost: 150 },
  { index: 24, type: "property", name: "Illinois Avenue", group: "red", price: 240, rent: [20, 100, 300, 750, 925, 1100], houseCost: 150 },
  { index: 25, type: "railroad", name: "B&O Railroad", group: "railroad", price: 200 },
  { index: 26, type: "property", name: "Atlantic Avenue", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
  { index: 27, type: "property", name: "Ventnor Avenue", group: "yellow", price: 260, rent: [22, 110, 330, 800, 975, 1150], houseCost: 150 },
  { index: 28, type: "utility", name: "Water Works", group: "utility", price: 150 },
  { index: 29, type: "property", name: "Marvin Gardens", group: "yellow", price: 280, rent: [24, 120, 360, 850, 1025, 1200], houseCost: 150 },
  { index: 30, type: "go-to-jail", name: "Go To Jail" },
  { index: 31, type: "property", name: "Pacific Avenue", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
  { index: 32, type: "property", name: "North Carolina Avenue", group: "green", price: 300, rent: [26, 130, 390, 900, 1100, 1275], houseCost: 200 },
  { index: 33, type: "community-chest", name: "Community Chest" },
  { index: 34, type: "property", name: "Pennsylvania Avenue", group: "green", price: 320, rent: [28, 150, 450, 1000, 1200, 1400], houseCost: 200 },
  { index: 35, type: "railroad", name: "Short Line", group: "railroad", price: 200 },
  { index: 36, type: "chance", name: "Chance" },
  { index: 37, type: "property", name: "Park Place", group: "darkblue", price: 350, rent: [35, 175, 500, 1100, 1300, 1500], houseCost: 200 },
  { index: 38, type: "tax", name: "Luxury Tax", amount: 100 },
  { index: 39, type: "property", name: "Boardwalk", group: "darkblue", price: 400, rent: [50, 200, 600, 1400, 1700, 2000], houseCost: 200 },
];

export const GROUP_MEMBERS: Record<string, number[]> = (() => {
  const map: Record<string, number[]> = {};
  for (const space of BOARD) {
    if (space.type === "property" || space.type === "railroad" || space.type === "utility") {
      const key = space.group;
      if (!map[key]) map[key] = [];
      map[key].push(space.index);
    }
  }
  return map;
})();
