// Migration 0064 (each world its own home) on rows as 0063 left them: each hut goes to the world its plot is in, or
// the world its hero is in now; furniture follows its owner's hut, boats are every world's; gardens keep their beds.

import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";

it("moves huts, furniture and gardens into the world they stood in", () => {
  const dir = new URL("../migrations/", import.meta.url);
  const files = readdirSync(dir).sort();
  const sql = new DatabaseSync(":memory:");
  for (const f of files.filter((f) => f < "0064")) sql.exec(readFileSync(new URL(f, dir), "utf8"));

  const run = (text: string, ...args: (string | number | null)[]) => sql.prepare(text).run(...args);
  for (const id of ["ann", "bo", "cy"]) run("INSERT INTO players (id, name, created_at) VALUES (?, ?, 0)", id, id);
  for (const id of ["W1", "W2"]) run("INSERT INTO crews (id, name, created_by, created_at) VALUES (?, ?, 'ann', 0)", id, id);
  // Ann: in W1 and W2, now in W2, her hut standing on plot 4 in W1. Bo: in W2, no plot yet but a bigger hut. Cy: in no world.
  run("INSERT INTO crew_members (crew_id, player_id, joined_at) VALUES ('W1', 'ann', 1), ('W2', 'ann', 2), ('W2', 'bo', 1)");
  run("UPDATE players SET current_crew_id = 'W2' WHERE id IN ('ann', 'bo')");
  run("INSERT INTO huts (player_id, tier, plot, plot_crew_id, bin_json, roof) VALUES ('ann', 2, 4, 'W1', NULL, 'slate'), ('bo', 3, NULL, NULL, NULL, NULL), ('cy', 1, NULL, NULL, NULL, NULL)");
  run("INSERT INTO furnishings (player_id, def_id, label, q, r, created_at) VALUES ('ann', 'chair', 'Chair', 1, 1, 0), ('ann', 'rowboat', 'Rowboat', NULL, NULL, 0), ('bo', 'table', 'Table', NULL, NULL, 0), ('cy', 'rug', 'Rug', NULL, NULL, 0)");
  run("INSERT INTO garden_beds (player_id, bed, crop, planted_at, ready_at) VALUES ('ann', 0, 'mushrooms', 1, 2)");

  sql.exec(readFileSync(new URL(files.find((f) => f.startsWith("0064"))!, dir), "utf8"));

  expect(sql.prepare("SELECT player_id, crew_id, tier, plot, roof FROM huts ORDER BY player_id").all()).toEqual([
    { player_id: "ann", crew_id: "W1", tier: 2, plot: 4, roof: "slate" },
    { player_id: "bo", crew_id: "W2", tier: 3, plot: null, roof: null },
    { player_id: "cy", crew_id: "", tier: 1, plot: null, roof: null },
  ]);
  expect(sql.prepare("SELECT player_id, def_id, crew_id FROM furnishings ORDER BY id").all()).toEqual([
    { player_id: "ann", def_id: "chair", crew_id: "W1" },
    { player_id: "ann", def_id: "rowboat", crew_id: null },
    { player_id: "bo", def_id: "table", crew_id: "W2" },
    { player_id: "cy", def_id: "rug", crew_id: "" },
  ]);
  expect(sql.prepare("SELECT player_id, crew_id, bed, crop FROM garden_beds").all()).toEqual([{ player_id: "ann", crew_id: "W1", bed: 0, crop: "mushrooms" }]);
});
