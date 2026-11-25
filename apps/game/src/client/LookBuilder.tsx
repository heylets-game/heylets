// The look builder at character creation: the hero's body, head and face,
// skin and hair, each picked from a few presets (packages/world appearance.ts),
// with the hero turning beside them. They can be seen in their class's
// starting clothes, which they will have as items, or in what is under them.

import { Fragment, useMemo, useState } from "react";
import {
  APPEARANCE_OPTIONS,
  BODY_TYPES,
  EYE_COLORS,
  HAIR_COLORS,
  NOSE_LIFT,
  NOSE_SIZE,
  SKIN_TONES,
  heroClass,
  randomAppearance,
  starterGarb,
  weaponItem,
  type Appearance,
  type Outfit,
} from "@gantt-quest/world";
import { FigurePreview } from "./FigurePreview";
import { InkEditor } from "./InkEditor";
import "./builder.css";

type Field = keyof typeof APPEARANCE_OPTIONS;

/** The pickers, grouped as the panel shows them. */
const GROUPS: { title: string; fields: [Field, string][] }[] = [
  { title: "Body", fields: [["body", "Body type"], ["height", "Height"], ["build", "Build"], ["shoulders", "Shoulders"], ["hips", "Hips"], ["arms", "Arms"], ["legs", "Legs"]] },
  { title: "Head", fields: [["headSize", "Head size"], ["headShape", "Head shape"], ["ears", "Ears"], ["hairStyle", "Hair"]] },
  { title: "Face", fields: [["eyes", "Eyes"], ["eyePatch", "Eye patch"], ["brows", "Brows"], ["nose", "Nose"], ["mustache", "Mustache"], ["beard", "Beard"]] },
];

/** What a hero of `classId` wears on their first day, with their look on it; `dressed` false for none of it. */
export function startingOutfit(classId: string, look: Appearance, dressed = true): Outfit {
  const outfit: Outfit = { appearance: look };
  if (!dressed) return outfit;
  const weapon = heroClass(classId)?.weapons[0];
  for (const item of [...(weapon ? [weaponItem(weapon)] : []), ...starterGarb(classId)]) outfit[item.slot] = { icon: item.icon, ref: item.ref, rarity: item.rarity };
  return outfit;
}

/** How the hero on the stage is shown: in clothes or not, close on the head, walking, and turned to a side being drawn on. Shared by the stage and the pickers. */
export function useLookView() {
  const [dressed, setDressed] = useState(true);
  const [head, setHead] = useState(false);
  const [walk, setWalk] = useState(false);
  // Which way to turn the hero: set when a side of the paper doll is drawn on, to show that side.
  const [aim, setAim] = useState<{ turn: number; n: number } | null>(null);
  return { dressed, setDressed, head, setHead, walk, setWalk, aim, setAim };
}
export type LookView = ReturnType<typeof useLookView>;

/**
 * The hero turning on a plinth, with buttons for how they are shown. `wearing` is what a hero already out in the
 * world has on, to see them in instead of their class's starting clothes (changing their look from their sheet;
 * see ChangeLook). `size` is the plinth's width in pixels.
 */
export function LookStage({ classId, look, onChange, wearing, view, size = 260 }: { classId: string; look: Appearance; onChange(next: Appearance): void; wearing?: Outfit; view: LookView; size?: number }) {
  const { dressed, setDressed, head, setHead, walk, setWalk, aim } = view;
  const outfit = useMemo(() => (wearing && dressed ? { ...wearing, appearance: look } : startingOutfit(classId, look, dressed)), [classId, look, dressed, wearing]);
  return (
    <div className="look-stage">
      <span className="look-plinth" style={size === 260 ? undefined : { width: size, height: size }}>
        <FigurePreview classId={classId} outfit={outfit} size={size} head={head} walk={walk} aim={aim} />
        <button type="button" className="small look-walk" aria-pressed={walk} onClick={() => setWalk(!walk)}>
          {walk ? "■ Stand" : "Walk"}
        </button>
        <button type="button" className="small look-zoom" aria-pressed={head} onClick={() => setHead(!head)} title={head ? "Whole body" : "Head"} aria-label={head ? "Show the whole body" : "Zoom in on the head"}>
          {head ? "⤢" : "🔍"}<span className="look-zoom-word">{head ? " Whole body" : " Head"}</span>
        </button>
      </span>
      <div className="look-stage-row" role="group" aria-label="What they are wearing">
        <button type="button" className={`small ${dressed ? "selected" : ""}`} aria-pressed={dressed} onClick={() => setDressed(true)}>
          {wearing ? "What they wear" : "Starting clothes"}
        </button>
        <button type="button" className={`small ${!dressed ? "selected" : ""}`} aria-pressed={!dressed} onClick={() => setDressed(false)}>
          Undergarments
        </button>
      </div>
      <button type="button" className="small look-dice" onClick={() => onChange({ ...randomAppearance(), ink: look.ink })}>
        <span aria-hidden>🎲</span> Surprise me
      </button>
      <p className="muted hint look-explain">Drag to turn them by hand. The hat, tunic, trousers and shoes are items you can take off or swap for armor.</p>
    </div>
  );
}

/** The rows of presets and swatches, the colouring and the tattoos. */
export function LookPickers({ look, onChange, view }: { look: Appearance; onChange(next: Appearance): void; view: LookView }) {
  const { setDressed, setAim } = view;
  const set = <K extends keyof Appearance>(field: K, value: Appearance[K]) => {
    // A body type brings its usual shoulders and hips with it (they can still be changed after).
    const shape = field === "body" ? BODY_TYPES.find((b) => b.id === value)?.shape : undefined;
    onChange({ ...look, ...shape, [field]: value });
  };
  return (
    <div className="look-pickers">
      {GROUPS.map((g) => (
        <fieldset key={g.title} className="look-group">
          <legend>{g.title}</legend>
          {g.fields.map(([field, name]) => (
            <Fragment key={field}>
              <div className="look-row" role="radiogroup" aria-label={name}>
                <span className="look-label">{name}</span>
                <span className="look-chips">
                  {(APPEARANCE_OPTIONS[field] as readonly { id: string; label: string }[]).map((p) => {
                    const on = look[field] === p.id;
                    return (
                      <button key={p.id} type="button" role="radio" aria-checked={on} className={`look-chip ${on ? "selected" : ""}`} onClick={() => set(field, p.id as Appearance[typeof field])}>
                        {p.label}
                      </button>
                    );
                  })}
                </span>
              </div>
              {field === "nose" && (
                <>
                  <LookSlider name="Nose size" range={NOSE_SIZE} usual={1} value={look.noseSize} low="Small" high="Big" onChange={(v) => set("noseSize", v)} />
                  <LookSlider name="Nose height" range={NOSE_LIFT} usual={0} value={look.noseLift} low="Lower" high="Higher" onChange={(v) => set("noseLift", v)} />
                </>
              )}
            </Fragment>
          ))}
        </fieldset>
      ))}
      <fieldset className="look-group">
        <legend>Colouring</legend>
        {(
          [
            ["skin", "Skin", SKIN_TONES],
            ["hair", "Hair", HAIR_COLORS],
          ] as const
        ).map(([field, name, colors]) => (
          <div key={field} className="look-row" role="radiogroup" aria-label={name}>
            <span className="look-label">{name}</span>
            <span className="look-chips">
              {colors.map((c, i) => {
                const on = look[field] === c;
                return <button key={c} type="button" role="radio" aria-checked={on} aria-label={`${name} ${i + 1}`} className={`look-swatch ${on ? "selected" : ""}`} style={{ background: c }} onClick={() => set(field, c)} />;
              })}
            </span>
          </div>
        ))}
        <div className="look-row" role="radiogroup" aria-label="Eye colour">
          <span className="look-label">Eye colour</span>
          <span className="look-chips">
            {/* The plain dark eyes, then each colour: a dark pupil in it, as the eye is drawn. */}
            {[undefined, ...EYE_COLORS].map((c, i) => {
              const on = look.eyeColor === c;
              const background = c ? `radial-gradient(circle, #1a1424 0 22%, ${c} 23%)` : "#1a1424";
              return <button key={c ?? "dark"} type="button" role="radio" aria-checked={on} aria-label={c ? `Eye colour ${i}` : "Eye colour dark"} className={`look-swatch ${on ? "selected" : ""}`} style={{ background }} onClick={() => set("eyeColor", c)} />;
            })}
          </span>
        </div>
      </fieldset>
      <fieldset className="look-group">
        <legend>Tattoos</legend>
        <InkEditor
          look={look}
          onChange={(ink) => onChange({ ...look, ink })}
          onView={(view) => {
            // Show the hero bare, turned to the side being drawn on.
            setDressed(false);
            setAim((a) => ({ turn: view === "b" ? Math.PI : 0, n: (a?.n ?? 0) + 1 }));
          }}
        />
      </fieldset>
    </div>
  );
}

/**
 * A slider row for a size or a position (the nose's): from `range.min` to `range.max` in its steps, worded at
 * each end. At the usual value it is kept as none, so a look that never moved it keeps its old key.
 */
function LookSlider({ name, range, usual, value, low, high, onChange }: { name: string; range: { min: number; max: number; step: number }; usual: number; value: number | undefined; low: string; high: string; onChange(v: number | undefined): void }) {
  const v = value ?? usual;
  return (
    <div className="look-row">
      <span className="look-label">{name}</span>
      <span className="look-slider">
        <span className="look-slider-end">{low}</span>
        <input
          type="range"
          aria-label={name}
          min={range.min}
          max={range.max}
          step={range.step}
          value={v}
          onChange={(e) => {
            const next = Math.round(Number(e.target.value) * 100) / 100;
            onChange(next === usual ? undefined : next);
          }}
        />
        <span className="look-slider-end">{high}</span>
        <button type="button" className="small look-slider-reset" disabled={value === undefined} onClick={() => onChange(undefined)}>
          Reset
        </button>
      </span>
    </div>
  );
}

/** The whole builder: the hero on the left, the pickers beside them. */
export function LookBuilder({ classId, look, onChange, wearing }: { classId: string; look: Appearance; onChange(next: Appearance): void; wearing?: Outfit }) {
  const view = useLookView();
  return (
    <div className="look-builder">
      <LookStage classId={classId} look={look} onChange={onChange} wearing={wearing} view={view} />
      <LookPickers look={look} onChange={onChange} view={view} />
    </div>
  );
}
