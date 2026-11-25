import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, INK_COLORS, INK_REGIONS, MAX_INK_CELLS, appearanceKey, decodeInk, encodeInk, eyePatchOf, inkCell, limbsOf, parseAppearance, parseInk, randomAppearance } from "./appearance";

describe("ink", () => {
  const cols = INK_REGIONS.head.cols;

  it("round-trips cells through its encoding", () => {
    const cells = new Map([[0, inkCell(1, 5)], [1, inkCell(1, 5)], [2, inkCell(1, 5)], [37, inkCell(INK_COLORS.length, 1)], [cols * cols - 1, inkCell(4, 3)]]);
    const encoded = encodeInk(cells);
    expect(encoded.startsWith("~")).toBe(true);
    expect(decodeInk(encoded, cols)).toEqual(cells);
  });

  it("codes runs short", () => {
    const row = new Map(Array.from({ length: 40 }, (_, i) => [100 + i, inkCell(2, 4)] as [number, number]));
    expect(encodeInk(row).length).toBeLessThan(12);
  });

  it("reads ink saved on the first, coarser grids as 2x2 blocks", () => {
    // Old head grid 28 wide: cell 29 is row 1, column 1, colour 2 at level 5.
    const old = (29).toString(36).padStart(2, "0") + "25";
    const cells = decodeInk(old, cols);
    expect([...cells.keys()].sort((a, b) => a - b)).toEqual([2 * cols + 2, 2 * cols + 3, 3 * cols + 2, 3 * cols + 3]);
    expect(new Set(cells.values())).toEqual(new Set([inkCell(2, 5)]));
    // parseInk rewrites it in the new form.
    expect(parseInk({ "head.f": old })!["head.f"]!.startsWith("~")).toBe(true);
  });

  it("keeps only known sides, cells in their grid and known inks", () => {
    const { cols: ac, rows } = INK_REGIONS.armL;
    const inGrid = encodeInk(new Map([[5, inkCell(2, 4)]]));
    const outOfGrid = encodeInk(new Map([[ac * rows, inkCell(1, 1)]]));
    const ink = parseInk({ "armL.f": inGrid, "armR.f": outOfGrid, "tail.f": inGrid, "head.b": 7, "head.f": "~?!" });
    expect(ink).toEqual({ "armL.f": inGrid });
  });

  it("is undefined when nothing is inked", () => {
    expect(parseInk({ "head.f": "" })).toBeUndefined();
    expect(parseInk({ "head.f": "~" })).toBeUndefined();
    expect(parseInk("nonsense")).toBeUndefined();
  });

  it("caps how much can be inked", () => {
    const all = new Map(Array.from({ length: cols * cols }, (_, i) => [i, inkCell(1, 5)] as [number, number]));
    const full = encodeInk(all);
    const ink = parseInk({ "head.f": full, "head.b": full, "armL.f": full })!;
    const total = Object.entries(ink).reduce((n, [side, v]) => n + decodeInk(v, INK_REGIONS[side.split(".")[0] as keyof typeof INK_REGIONS].cols).size, 0);
    expect(total).toBe(MAX_INK_CELLS);
  });

  it("travels with the appearance, and changes its key", () => {
    const ink = { "head.f": encodeInk(new Map([[10, inkCell(1, 5)]])) };
    const look = parseAppearance({ ...DEFAULT_APPEARANCE, ink })!;
    expect(look.ink).toEqual(ink);
    expect(appearanceKey(look)).not.toBe(appearanceKey(DEFAULT_APPEARANCE));
    expect(parseAppearance(DEFAULT_APPEARANCE)!.ink).toBeUndefined();
  });

  it("reads facial hair saved as one choice as the mustache and beard it drew", () => {
    const { facialHair: _, ...rest } = { ...DEFAULT_APPEARANCE, facialHair: "goatee" };
    void _;
    const look = parseAppearance({ ...rest, facialHair: "goatee", mustache: undefined, beard: undefined })!;
    expect([look.mustache, look.beard]).toEqual(["bushy", "goatee"]);
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, mustache: "walrus", beard: "none" })!.mustache).toBe("walrus");
  });
});

describe("nose sliders", () => {
  it("keeps the nose's size and height inside their ends and on their steps, and leaves the usual unset", () => {
    const look = parseAppearance({ ...DEFAULT_APPEARANCE, noseSize: 1.23, noseLift: -9 })!;
    expect(look.noseSize).toBe(1.25);
    expect(look.noseLift).toBe(-0.35);
    const usual = parseAppearance({ ...DEFAULT_APPEARANCE, noseSize: 1, noseLift: 0 })!;
    expect(usual.noseSize).toBeUndefined();
    expect(usual.noseLift).toBeUndefined();
    expect(parseAppearance({ ...DEFAULT_APPEARANCE, noseSize: "big" })!.noseSize).toBeUndefined();
    expect(appearanceKey(look)).not.toBe(appearanceKey(DEFAULT_APPEARANCE));
  });
});

describe("limbs and eye patches", () => {
  it("keeps a peg leg, a hook and a patch, each on its side", () => {
    const look = parseAppearance({ ...DEFAULT_APPEARANCE, legs: "pegL", arms: "hookR", eyes: "almond", eyePatch: "right" })!;
    expect(limbsOf("legs", look).side).toBe("left");
    expect(limbsOf("arms", look).side).toBe("right");
    expect(eyePatchOf(look)).toBe("right");
    // The patch is worn over the eyes chosen, which it keeps.
    expect(look.eyes).toBe("almond");
    expect(appearanceKey(look)).not.toBe(appearanceKey(DEFAULT_APPEARANCE));
  });

  it("reads a patch saved as one of the eyes as round eyes under a patch on that side", () => {
    const { eyePatch: _, ...old } = DEFAULT_APPEARANCE;
    void _;
    const look = parseAppearance({ ...old, eyes: "patchL" })!;
    expect(look.eyes).toBe("round");
    expect(eyePatchOf(look)).toBe("left");
  });

  it("gives a look saved before arms and legs could be chosen the usual ones", () => {
    const { legs: _l, arms: _a, ...old } = DEFAULT_APPEARANCE;
    void _l;
    void _a;
    const look = parseAppearance({ ...old, legs: "tentacles" })!;
    expect([look.legs, look.arms]).toEqual(["average", "average"]);
    expect(limbsOf("legs", look)).toMatchObject({ len: 1, thick: 1 });
    expect(limbsOf("legs", look).side).toBeUndefined();
  });

  it("rolls a patch, a peg or a hook only now and then", () => {
    let n = 0;
    let odd = 0;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (; n < 2000; n++) if (limbsOf("legs", randomAppearance(rand)).side) odd++;
    expect(odd / n).toBeGreaterThan(0.05);
    expect(odd / n).toBeLessThan(0.2);
  });
});
