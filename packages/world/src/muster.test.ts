import { describe, expect, it } from "vitest";
import { MUSTER_CHOOSE_MS, MUSTER_LINGER_MS, MUSTER_MS, MUSTER_PARTY, answerMuster, musterGoing, musterHeroes, callMuster, musterAnswered, musterDue, musterOpen, musterShown, settleMuster, type Muster, type MusterMember } from "./muster";

const ann: MusterMember = { id: "a", name: "Ann" };
const bo: MusterMember = { id: "b", name: "Bo" };
const cy: MusterMember = { id: "c", name: "Cy" };
const NOW = 1_000_000;
const called = (asked: MusterMember[] = [bo, cy]) => callMuster("m1", ann, { node: "2,-1", place: "Petrel Spit", site: "Cove", level: 4 }, asked, NOW);
/** Answer, and expect it to be taken. */
function said(m: Muster, who: MusterMember, answer: Parameters<typeof answerMuster>[2], now = NOW + 1000) {
  const res = answerMuster(m, who, answer, now);
  if ("error" in res) throw new Error(res.error);
  return res;
}

describe("a muster", () => {
  it("is called by whoever sets out, who is ready from the first; it waits a minute for those who were in town", () => {
    const m = called([ann, bo, cy]);
    expect(m).toMatchObject({ id: "m1", by: ann, node: "2,-1", place: "Petrel Spit", site: "Cove", level: 4, deadline: NOW + MUSTER_MS, ready: [ann], declined: [] });
    // The caller is not among those asked, even if handed in with them.
    expect(m.asked).toEqual([bo, cy]);
    expect(MUSTER_MS).toBe(60_000);
    expect(musterOpen(m)).toBe(true);
    expect(musterAnswered(m)).toBe(false);
    expect(musterDue(m, NOW + 59_999)).toBe(false);
    expect(musterDue(m, NOW + MUSTER_MS)).toBe(true);
  });

  it("readying up and declining are taken, changed at will, and never change the muster handed in", () => {
    const m = called();
    const one = said(m, bo, "ready");
    expect(one.start).toBeUndefined();
    expect(one.muster.ready).toEqual([ann, bo]);
    expect(m.ready).toEqual([ann]);
    // Bo thinks better of it.
    const two = said(one.muster, bo, "no");
    expect(two.muster.ready).toEqual([ann]);
    expect(two.muster.declined).toEqual(["b"]);
    // And changes his mind again: he is ready, and no longer declined.
    const three = said(two.muster, bo, "ready");
    expect(three.muster.ready).toEqual([ann, bo]);
    expect(three.muster.declined).toEqual([]);
    // Saying the same thing twice changes nothing.
    expect(said(three.muster, bo, "ready").muster.ready).toEqual([ann, bo]);
  });

  it("starts the moment everyone asked has answered, whatever they said", () => {
    const m = said(called(), bo, "ready").muster;
    const last = said(m, cy, "no");
    expect(last.start).toBe(true);
    expect(last.muster.ready).toEqual([ann, bo]);
    expect(last.muster.declined).toEqual(["c"]);
    // Everyone declining starts it too: the caller goes alone.
    const alone = said(said(called(), bo, "no").muster, cy, "no");
    expect(alone.start).toBe(true);
    expect(alone.muster.ready).toEqual([ann]);
  });

  it("someone who was not asked (they walked into town after) can come too, and nobody waits for them", () => {
    const dee: MusterMember = { id: "d", name: "Dee" };
    const m = called([bo]);
    const one = said(m, dee, "ready");
    expect(one.muster.ready).toEqual([ann, dee]);
    expect(one.start).toBeUndefined();
    expect(said(one.muster, bo, "ready").start).toBe(true);
  });

  it("only the caller can start it early or call it off, and the caller cannot answer their own muster", () => {
    const m = called();
    expect(answerMuster(m, bo, "start", NOW)).toEqual({ error: "Only Ann can do that: it is their muster." });
    expect(answerMuster(m, bo, "cancel", NOW)).toHaveProperty("error");
    expect(said(m, ann, "start")).toMatchObject({ start: true });
    expect(said(m, ann, "cancel")).toMatchObject({ cancel: true });
    expect(answerMuster(m, ann, "no", NOW)).toHaveProperty("error");
    expect(answerMuster(m, ann, "ready", NOW)).toHaveProperty("error");
  });

  it("takes as many as a map is made for, and starts when it is full", () => {
    const more = Array.from({ length: 6 }, (_, i): MusterMember => ({ id: `p${i}`, name: `P${i}` }));
    let m = called(more);
    for (let i = 0; i < MUSTER_PARTY - 2; i++) m = said(m, more[i], "ready").muster;
    expect(m.ready).toHaveLength(MUSTER_PARTY - 1);
    const full = said(m, more[4], "ready");
    expect(full.muster.ready).toHaveLength(MUSTER_PARTY);
    expect(full.start).toBe(true);
    expect(MUSTER_PARTY).toBe(6);
    // A seventh may still ready up: the caller chooses who stays behind.
    const over = said(full.muster, more[5], "ready");
    expect(over.muster.ready).toHaveLength(MUSTER_PARTY + 1);
  });

  it("counts each one's party with them, and starts when it is full", () => {
    const dee: MusterMember = { id: "d", name: "Dee", heroes: 3 };
    let m = callMuster("m1", { ...ann, heroes: 2 }, { node: "2,-1", place: "Petrel Spit" }, [bo, dee], NOW);
    m = said(m, dee, "ready").muster;
    expect(musterHeroes(m)).toBe(5);
    const full = said(m, bo, "ready");
    expect(musterHeroes(full.muster)).toBe(6);
    expect(full.start).toBe(true);
  });

  describe("with more ready than a map takes", () => {
    // Ann calls it with a party of four; Dee readies with a party of three.
    const party = (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${id}${i + 1}`, name: `${id.toUpperCase()}${i + 1}` }));
    const ann4: MusterMember = { ...ann, party: party("a", 3) };
    const dee3: MusterMember = { id: "d", name: "Dee", party: party("d", 2) };
    const seven = () => {
      const m = callMuster("m1", ann4, { node: "2,-1", place: "Petrel Spit" }, [bo, dee3], NOW);
      const res = said(m, dee3, "ready");
      expect(musterHeroes(res.muster)).toBe(7);
      expect(res.start).toBe(true);
      return res.muster;
    };

    it("does not set out, but gives the caller time to choose, with the last to ready up picked to stay", () => {
      const m = seven();
      const s = settleMuster(m, NOW + 2000);
      expect(s.start).toBeUndefined();
      expect(s.muster).toMatchObject({ choosing: true, left: ["d2"], deadline: NOW + 2000 + MUSTER_CHOOSE_MS });
      expect(musterDue(s.muster, NOW + 2000 + MUSTER_CHOOSE_MS - 1)).toBe(false);
      expect(musterDue(s.muster, NOW + 2000 + MUSTER_CHOOSE_MS)).toBe(true);
      // Their time up, the pick goes.
      const gone = settleMuster(s.muster, NOW + 2000 + MUSTER_CHOOSE_MS);
      expect(gone.start).toBe(true);
      expect(gone.muster.left).toEqual(["d2"]);
      expect(gone.muster.choosing).toBeUndefined();
      expect(musterGoing(gone.muster, gone.muster.left)).toBe(6);
    });

    it("sets out with whoever the caller chooses, if the rest fit", () => {
      const m = settleMuster(seven(), NOW + 2000).muster;
      // One of Ann's own stays instead.
      expect(settleMuster(m, NOW + 3000, ["a3"])).toMatchObject({ start: true, muster: { left: ["a3"] } });
      // Leaving Dee leaves Dee's party too.
      const noDee = settleMuster(m, NOW + 3000, ["d"]);
      expect(noDee.start).toBe(true);
      expect(musterGoing(noDee.muster, noDee.muster.left)).toBe(4);
      // Not enough left behind, or the caller themselves: it waits on, with the pick as it was.
      expect(settleMuster(m, NOW + 3000, [])).toMatchObject({ muster: { choosing: true, left: ["d2"] } });
      expect(settleMuster(m, NOW + 3000, ["a"]).start).toBeUndefined();
      expect(settleMuster(m, NOW + 3000, ["nobody"]).start).toBeUndefined();
    });

    it("starts at once if someone stands down while the caller chooses, and only the caller can choose", () => {
      const m = settleMuster(seven(), NOW + 2000).muster;
      expect(answerMuster(m, dee3, "start", NOW + 3000)).toHaveProperty("error");
      const res = said(m, dee3, "no", NOW + 3000);
      expect(res.start).toBe(true);
      expect(settleMuster(res.muster, NOW + 3000)).toMatchObject({ start: true, muster: { ready: [ann4] } });
    });
  });

  it("once it has started or fallen through it takes no more answers, and is told a little while longer", () => {
    const gone: Muster = { ...called(), code: "ABCD", endedAt: NOW + 5000 };
    expect(musterOpen(gone)).toBe(false);
    expect(musterDue(gone, NOW + MUSTER_MS * 2)).toBe(false);
    expect(answerMuster(gone, bo, "ready", NOW)).toEqual({ error: "They have set out already." });
    const off: Muster = { ...called(), failed: "Ann called it off.", endedAt: NOW + 5000 };
    expect(answerMuster(off, bo, "ready", NOW)).toEqual({ error: "That muster is over." });
    expect(musterShown(gone, NOW + 5000 + MUSTER_LINGER_MS - 1)).toBe(true);
    expect(musterShown(gone, NOW + 5000 + MUSTER_LINGER_MS)).toBe(false);
    expect(musterShown(called(), NOW + MUSTER_MS * 5)).toBe(true);
    expect(musterShown(null, NOW)).toBe(false);
  });
});
