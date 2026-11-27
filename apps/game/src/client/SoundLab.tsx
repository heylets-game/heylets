// The sound lab: a dev-only page listing every sound in the game, to search and play at will.
// Opened from the dev toolbox's Audio/visual tab (DevToolbox.tsx), so it is there only on a
// development deployment.
//
// Everything comes from the manifest (audio/manifest.ts) and the engine's index of files, so a sound
// added there shows here with no edit to this file:
//   - every event the game can ask for, played as the game plays it (its level, a random pitch and
//     take), with a button for each of its takes to hear one on its own;
//   - every piece of music, bed of atmosphere and placed loop, each part played once through;
//   - every file in the index that nothing plays, so a recording bounced to the wrong path is found.
//
// While it is open the game's own music and atmosphere are hushed (an empty scene is entered), so
// what you hear is what you pressed. Nothing here touches the server or the game being played.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { audio, type Audition } from "./audio/engine";
import { AUDIO } from "./audio/manifest";
import { FADERS, FADER_LABELS } from "./audio/mixer";
import { expandFiles } from "./audio/select";
import type { Group, Loop } from "./audio/types";
import "./soundLab.css";

/** One row: an event (played as the game plays it), or a single file (played once through). */
interface Entry {
  id: string;
  section: string;
  name: string;
  /** What it is made of, in a line: its files, its level, its pitch. */
  detail: string;
  group: Group;
  /** The event it plays; for a file row, the file. */
  event?: string;
  file?: string;
  gainDb?: number;
}

/** The sections events fall into, by the first part of their name, in the order they are listed. */
const SECTIONS: [string, string[]][] = [
  ["Footsteps", ["footstep"]],
  ["Attacks", ["attack"]],
  ["Blows landing", ["impact"]],
  ["Misses", ["miss"]],
  ["Heals", ["heal"]],
  ["Effects", ["effect", "tick"]],
  ["Going down", ["down", "enemy", "hero"]],
  ["Fights on the tiles", ["zone"]],
  ["Ground surfaces", ["surface"]],
  ["Moments", ["turn", "ui", "level_up", "loot", "gold", "pickup"]],
  ["Weather", ["weather"]],
  ["Gathering", ["gather"]],
  ["Pub tables", ["table"]],
  ["Stingers", ["stinger"]],
];
const OTHER = "Other events";
const LOOPS = ["Music", "Atmosphere", "Placed loops"];
const UNUSED = "Files nothing plays";
const ORDER = [...SECTIONS.map(([s]) => s), OTHER, ...LOOPS, UNUSED];

const sectionOf = (event: string): string => {
  const head = event.split(".")[0];
  return SECTIONS.find(([, heads]) => heads.includes(head))?.[0] ?? OTHER;
};
const list = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const db = (n: number | undefined) => (n ? `${n > 0 ? "+" : ""}${n} dB` : "");

/** Every event, loop and loop part in the manifest, as rows. */
function manifestEntries(): Entry[] {
  const out: Entry[] = [];
  for (const [name, ev] of Object.entries(AUDIO.events)) {
    const parts = [list(ev.files).join(", "), ev.fallback ? `else ${list(ev.fallback).join(", ")}` : "", db(ev.gainDb), ev.pitch ? `pitch ${ev.pitch.join(" to ")}` : "", ev.group && ev.group !== "sfx" ? ev.group : ""];
    out.push({ id: `event:${name}`, section: sectionOf(name), name, detail: parts.filter(Boolean).join(" · "), group: ev.group ?? "sfx", event: name });
  }
  const loops = (section: string, group: Group, defs: Record<string, Loop>) => {
    for (const [name, def] of Object.entries(defs)) {
      const parts: [string, string, number | undefined][] = [
        ...(def.intro ? [[`${name} (intro)`, def.intro, def.gainDb] as [string, string, number | undefined]] : []),
        [name, def.file, def.gainDb],
        ...(def.layers ?? []).map((l, i): [string, string, number | undefined] => [`${name} (layer ${i + 1})`, l.file, l.gainDb]),
      ];
      for (const [label, file, gainDb] of parts) out.push({ id: `loop:${section}:${label}`, section, name: label, detail: [file, db(gainDb)].filter(Boolean).join(" · "), group, file, gainDb });
    }
  };
  loops("Music", "music", AUDIO.music);
  loops("Atmosphere", "atmosphere", AUDIO.ambience);
  for (const [kind, def] of Object.entries(AUDIO.emitters ?? {})) {
    if (def) out.push({ id: `emitter:${kind}`, section: "Placed loops", name: kind, detail: [def.file, db(def.gainDb)].filter(Boolean).join(" · "), group: "atmosphere", file: def.file, gainDb: def.gainDb });
  }
  return out;
}

/** The files in the index that no event or loop can play (built-in sounds and reverbs left out). */
function unusedEntries(entries: Entry[]): Entry[] {
  const used = new Set<string>();
  for (const e of entries) {
    if (e.file) used.add(e.file);
    if (e.event) for (const k of audio.takesFor(e.event)) used.add(k);
  }
  // A recording an event names but does not play (it plays its built-in sound instead) still counts as used.
  for (const k of expandFiles(Object.values(AUDIO.events).flatMap((ev) => list(ev.files)), audio.fileKeys())) used.add(k);
  return audio
    .fileKeys()
    .filter((k) => !used.has(k) && !k.startsWith("synth/") && !k.startsWith("ir/"))
    .map((k) => ({ id: `file:${k}`, section: UNUSED, name: k, detail: "", group: k.startsWith("music/") ? "music" : k.startsWith("ambience/") ? "atmosphere" : "sfx", file: k }));
}

const KIND_WORD = { recording: "recording", "built-in": "built-in", placeholder: "placeholder", missing: "missing" } as const;

export default function SoundLab({ onClose }: { onClose(): void }) {
  const [query, setQuery] = useState("");
  const [indexed, setIndexed] = useState(false);
  const [playing, setPlaying] = useState<Record<string, string>>({});
  const [said, setSaid] = useState("");
  const live = useRef(new Map<string, Audition>());
  const search = useRef<HTMLInputElement>(null);
  const mix = useSyncExternalStore(audio.mix.subscribe, audio.mix.get);

  // Hush the game's own music and atmosphere while the lab is open.
  useEffect(() => {
    const id = audio.pushScene(null);
    void audio.whenIndexed().then(setIndexed);
    search.current?.focus();
    const sounding = live.current;
    return () => {
      audio.popScene(id);
      for (const a of sounding.values()) a.stop();
    };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (e.target === search.current && query) setQuery("");
      else onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose, query]);

  // The takes are only known once the index is in, so the rows are worked out again then.
  const entries = useMemo(() => {
    const all = manifestEntries();
    return indexed ? [...all, ...unusedEntries(all)] : all;
  }, [indexed]);
  const takes = useMemo(() => new Map(entries.map((e) => [e.id, e.event ? audio.takesFor(e.event) : e.file ? [e.file] : []])), [entries]);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (e: Entry) => {
      const text = `${e.section} ${e.name} ${e.detail} ${(takes.get(e.id) ?? []).join(" ")}`.toLowerCase();
      return words.every((w) => text.includes(w));
    };
    const by = new Map<string, Entry[]>();
    for (const e of entries) if (hit(e)) by.set(e.section, [...(by.get(e.section) ?? []), e]);
    return ORDER.filter((s) => by.has(s)).map((s) => [s, by.get(s)!] as const);
  }, [entries, takes, query]);
  const count = shown.reduce((n, [, rows]) => n + rows.length, 0);

  const play = async (e: Entry, take?: string) => {
    const got = e.event ? await audio.audition(e.event, take) : await audio.auditionFile(take ?? e.file!, e.group, e.gainDb);
    if ("why" in got) return setSaid(`${e.name}: ${got.why}`);
    setSaid("");
    // A row plays one thing at a time: pressing it again starts it over.
    live.current.get(e.id)?.stop();
    live.current.set(e.id, got);
    setPlaying((p) => ({ ...p, [e.id]: got.key }));
    setTimeout(() => {
      if (live.current.get(e.id) !== got) return;
      live.current.delete(e.id);
      setPlaying(({ [e.id]: _, ...rest }) => rest);
    }, got.seconds * 1000 + 50);
  };
  const stop = (id: string) => {
    live.current.get(id)?.stop();
    live.current.delete(id);
    setPlaying(({ [id]: _, ...rest }) => rest);
  };
  const stopAll = () => {
    for (const a of live.current.values()) a.stop();
    live.current.clear();
    setPlaying({});
  };

  // Why nothing might be heard: the sound turned off or down in the player's own settings.
  const quiet = [mix.muted ? "the sound is muted" : "", ...FADERS.filter((f) => audio.mix.volume(f) === 0).map((f) => `${FADER_LABELS[f]} is at 0`)].filter(Boolean);

  return (
    <div className="sound-lab" role="dialog" aria-label="Sound lab">
      <div className="sound-lab-box timber">
        <div className="sound-lab-head timber-head">
          <strong className="sound-lab-title">Sound lab</strong>
          <input ref={search} type="search" placeholder="Search: crit, footstep stone, sfx/combat…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the sounds" />
          <span className="muted sound-lab-count">{count} sounds</span>
          <button onClick={stopAll} disabled={Object.keys(playing).length === 0}>Stop all</button>
          <button className="sound-lab-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>×</button>
        </div>
        {(quiet.length > 0 || said || !indexed) && (
          <div className="sound-lab-notes" role="status">
            {quiet.length > 0 && (
              <p className="bad">
                Nothing will be heard: {quiet.join(", ")}.{" "}
                <button className="link" onClick={() => (audio.mix.setMuted(false), FADERS.forEach((f) => audio.mix.volume(f) === 0 && audio.mix.setVolume(f, 1)))}>Turn it back up</button>
              </p>
            )}
            {!indexed && <p className="muted">Loading the list of files…</p>}
            {said && <p className="bad">{said}</p>}
          </div>
        )}
        <div className="sound-lab-body">
          {shown.length === 0 && <p className="muted sound-lab-none">No sound matches “{query}”.</p>}
          {shown.map(([section, rows]) => (
            <section key={section}>
              <h3 className="sound-lab-section">
                {section} <span className="muted">{rows.length}</span>
              </h3>
              {rows.map((e) => {
                const files = takes.get(e.id) ?? [];
                const now = playing[e.id];
                const kind = files[0] ? audio.fileKind(files[0]) : null;
                return (
                  <div key={e.id} className={`sound-lab-row ${now ? "on" : ""}`}>
                    <button className="sound-lab-play" aria-label={now ? `Stop ${e.name}` : `Play ${e.name}`} title={now ? "Stop" : "Play"} onClick={() => (now ? stop(e.id) : void play(e))}>
                      {now ? "■" : "▶"}
                    </button>
                    <div className="sound-lab-what">
                      <div className="sound-lab-name">
                        <code>{e.name}</code>
                        {indexed && <span className={`sound-lab-kind ${kind ?? "none"}`}>{kind ? KIND_WORD[kind] : "nothing to play"}</span>}
                      </div>
                      {e.detail && <div className="muted sound-lab-detail">{e.detail}</div>}
                      {e.event && files.length > 1 && (
                        <div className="sound-lab-takes">
                          {files.map((k, i) => (
                            <button key={k} className={now === k ? "selected" : ""} title={k} aria-label={`Play take ${i + 1}: ${k}`} onClick={() => void play(e, k)}>
                              {i + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
