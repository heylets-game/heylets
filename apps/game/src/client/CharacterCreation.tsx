// Making a hero, from the main menu: three short steps in the side panel
// (class, look, then name and stats), with the hero turning large beside it
// the whole way, so every choice shows on them at once.

import { useEffect, useMemo, useRef, useState } from "react";
import { STARTING_STATS } from "@gantt-quest/core";
import { DEFAULT_APPEARANCE, HERO_CLASSES, RARITY_COLOR, STAT_BLURB, STAT_KEYS, STAT_LABEL, WEAPON_ICON, statPct, type Appearance } from "@gantt-quest/world";
import { api, type Character, type StatKey } from "./api";
import { Icon } from "./items";
import { blurb, label } from "./labels";
import { LookPickers, LookStage, useLookView } from "./LookBuilder";
import { GRAPHICS_HELP } from "./render/graphics";
import { isBlankPortrait } from "./render/portraits";
import { spriteDataUrl } from "./render/sprites";
import { useAct } from "./useAct";
import { WoodWindow } from "./ui/WoodWindow";

const STEPS = ["Class", "Look", "Name & stats"] as const;

/** What each class is for in a party, shown as tags. Flavour only: the rules never read it. */
const ROLES: Record<string, string[]> = {
  qa_paladin: ["Tank", "Melee"],
  devops_mage: ["Caster", "Healer"],
  refactor_rogue: ["Striker", "Fast"],
  backend_druid: ["Healer", "Control"],
  frontend_bard: ["Buffer", "Support"],
  staff_sage: ["Caster", "Burst"],
  sre_warden: ["Tank", "Guard"],
  data_warlock: ["Caster", "Curses"],
};
const STAT_SHORT: Record<StatKey, string> = { str: "STR", int_stat: "INT", vit: "VIT", agi: "AGI", dex: "DEX" };
/** Cells in a stat bar. Starting stats run 2 to 11. */
const BAR_CELLS = 12;

/** The stat a class leans on most, from its baseline. */
const mainStat = (classId: string): StatKey => {
  const base = STARTING_STATS[classId];
  return STAT_KEYS.reduce((best, k) => (base[k] > base[best] ? k : best), STAT_KEYS[0]);
};

/** True on a phone-sized screen, where the hero is drawn smaller above the panel. */
function useNarrow() {
  const query = "(max-width: 760px)";
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** A stat as a row of pixel cells, with the class baseline marked. Unrolled, it shows the baseline alone. */
function StatBar({ stat, value, base, rolled }: { stat: StatKey; value: number; base: number; rolled: boolean }) {
  const delta = value - base;
  const id = `stat-${stat}`;
  return (
    <div className={`statbar ${rolled ? "rolled" : ""}`}>
      <span className="statbar-name" title={STAT_LABEL[stat]}>
        <abbr title={STAT_LABEL[stat]}>{STAT_SHORT[stat]}</abbr>
        <span className="statbar-long">{STAT_LABEL[stat]}</span>
      </span>
      <span className="statbar-cells" role="meter" aria-label={STAT_LABEL[stat]} aria-valuemin={0} aria-valuemax={BAR_CELLS} aria-valuenow={value} aria-describedby={`${id}-blurb`}>
        {Array.from({ length: BAR_CELLS }, (_, i) => (
          <span key={i} className={`cell ${i < value ? (i < base ? "on" : "up") : i < base ? "lost" : ""} ${i === base - 1 ? "base" : ""}`} />
        ))}
      </span>
      <span className="statbar-value" aria-hidden>{value}</span>
      <span className={`statbar-delta ${delta > 0 ? "good" : delta < 0 ? "bad" : "muted"}`}>{rolled ? (delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "±0") : ""}</span>
      <span className="statbar-pct muted">{statPct(value)}%</span>
      <span className="statbar-blurb" id={`${id}-blurb`}>{STAT_BLURB[stat]}</span>
    </div>
  );
}

interface Props {
  /** The hero as far as they were made (a rolled draft), or null. */
  draft: Character | null;
  refresh(): Promise<unknown>;
  /** Out of creation, back to the menu it was opened from. */
  onBack(): void;
  /** Called once the hero is confirmed: carry on with what they were made for (joining or making a world). */
  onDone(): Promise<void>;
  /** Why they are making a hero now, shown at the top: "Then you join Testers." */
  note?: string;
}

export function CharacterCreation({ draft, refresh, onBack, onDone, note }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(draft?.name ?? "");
  const [classId, setClassId] = useState(draft?.class_id ?? HERO_CLASSES[0].id);
  const [look, setLook] = useState<Appearance>(DEFAULT_APPEARANCE);
  const view = useLookView();
  const narrow = useNarrow();
  const { busy: rolling, error: rollError, act } = useAct(refresh);
  const [beginning, setBeginning] = useState(false);
  const [beginError, setBeginError] = useState<string | null>(null);
  const busy = rolling || beginning;

  const rolled = draft && draft.class_id === classId ? draft : null;
  const validName = name.trim().length >= 2;
  const cls = HERO_CLASSES.find((c) => c.id === classId) ?? HERO_CLASSES[0];
  const base = STARTING_STATS[classId];

  // The class pictures come up empty when the browser will not give the game WebGL. They are asked for again a few
  // times (it may only have been a bad moment), and meanwhile the player is told why.
  const [redraws, setRedraws] = useState(0);
  const sprites = useMemo(() => Object.fromEntries(HERO_CLASSES.map((c) => [c.id, spriteDataUrl(c.id)])), [redraws]);
  const noGraphics = isBlankPortrait(sprites[HERO_CLASSES[0].id]);
  useEffect(() => {
    if (!noGraphics || redraws >= 6) return;
    const again = setTimeout(() => setRedraws((n) => n + 1), 6000);
    return () => clearTimeout(again);
  }, [noGraphics, redraws]);

  const [naming, setNaming] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const offered = useRef<string[]>([]);
  const suggestName = async () => {
    setNaming(true);
    setNameError(null);
    try {
      const { name: suggested } = await api.suggestName(classId, offered.current);
      offered.current = [...offered.current, suggested].slice(-12);
      setName(suggested);
    } catch (e) {
      setNameError((e as Error).message);
    } finally {
      setNaming(false);
    }
  };

  const begin = async () => {
    setBeginning(true);
    setBeginError(null);
    try {
      await api.setAppearance(look);
      await api.confirm();
      await onDone();
    } catch (e) {
      setBeginError((e as Error).message);
    } finally {
      setBeginning(false);
    }
  };

  // The panel scrolls back to the top on each new step.
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
  }, [step]);

  const error = rollError ?? beginError;
  const main = mainStat(classId);
  return (
    <div className="mm-layout creation-layout">
      <WoodWindow className="mm-panel cr-panel" role="region" labelledBy="cr-title">
        <header className="mm-sub-head">
          <button className="link mm-back" onClick={step === 0 ? onBack : () => setStep(step - 1)}>‹ Back</button>
          <h2 id="cr-title">Create your hero</h2>
        </header>
        <ol className="cr-steps">
          {STEPS.map((title, i) => (
            <li key={title}>
              <button className={i === step ? "selected" : undefined} aria-current={i === step ? "step" : undefined} onClick={() => setStep(i)}>
                <span className="cr-step-num">{i + 1}</span> {title}
              </button>
            </li>
          ))}
        </ol>
        {note && <p className="banner">{note}</p>}
        {noGraphics && (
          <p className="banner error" role="alert">
            Your browser is not giving the game a working 3D canvas (WebGL), so the heroes are not drawn and the Harbor will not open. {GRAPHICS_HELP}
          </p>
        )}
        {error && <p className="banner error" role="alert">{error}</p>}

        <div className="cr-body" ref={body}>
          {step === 0 && (
            <div className="cr-classes" role="radiogroup" aria-label="Class">
              {HERO_CLASSES.map((c) => {
                const on = classId === c.id;
                return (
                  <button key={c.id} role="radio" aria-checked={on} className={`cr-class ${on ? "selected" : ""}`} onClick={() => setClassId(c.id)}>
                    <span className="cr-class-figure"><img className="pixel-icon" src={sprites[c.id]} alt="" width={36} height={44} /></span>
                    <span className="cr-class-text">
                      <strong>{label("class", c.id)}</strong>
                      <span className="cc-tags">
                        {(ROLES[c.id] ?? []).map((r) => <span key={r} className={`role-tag role-${r.toLowerCase()}`}>{r}</span>)}
                        <span className="role-tag stat-tag">{STAT_SHORT[mainStat(c.id)]}</span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && <LookPickers look={look} onChange={setLook} view={view} />}

          {step === 2 && (
            <>
              <label className="field cr-name">
                <span>Name</span>
                <span className="hero-name-row">
                  <input className="hero-name" value={name} maxLength={20} autoComplete="nickname" onChange={(e) => setName(e.target.value)} placeholder="What do they call you?" aria-describedby="hero-name-hint" />
                  <button type="button" className={`name-dice ${naming ? "busy" : ""}`} onClick={suggestName} disabled={naming} aria-label={`Suggest a name for a ${label("class", classId)}`} title="Suggest a name">
                    <PixelDie />
                  </button>
                </span>
              </label>
              <p id="hero-name-hint" className={`hint ${nameError || (name && !validName) ? "bad" : "muted"}`} aria-live="polite">
                {nameError ?? (naming ? "Asking the harbor for a name…" : "Two to twenty characters, or roll the die for one that suits your class.")}
              </p>
              <div className="stat-sheet">
                <p className="muted stat-sheet-note" aria-live="polite">
                  {rolled ? "Green cells beat the class baseline; dashed red ones fall short. Re-roll as often as you like." : `${label("class", classId)} baseline. Roll to see where your hero lands.`}
                </p>
                {STAT_KEYS.map((k) => (
                  <StatBar key={k} stat={k} value={rolled ? rolled[k] : base[k]} base={base[k]} rolled={!!rolled} />
                ))}
                <p className="muted small-print">The % is your chance per die when that stat is tested.</p>
              </div>
            </>
          )}
        </div>

        <footer className="cr-foot">
          {step < 2 ? (
            <button className="primary big" onClick={() => setStep(step + 1)}>
              Next: {STEPS[step + 1]} <span aria-hidden>▸</span>
            </button>
          ) : (
            <>
              <button className={`big ${rolled ? "" : "roll"}`} disabled={busy || !validName} onClick={() => act(() => api.roll(classId, name))} aria-describedby={!validName ? "hero-name-hint" : undefined}>
                <span aria-hidden>🎲</span> {rolled ? "Re-roll" : "Roll stats"}
              </button>
              <button className="primary big" disabled={busy || !rolled || !validName} onClick={() => void begin()}>
                Begin <span aria-hidden>▸</span>
              </button>
              {!validName ? <span className="muted hint">Name your hero to roll.</span> : !rolled ? <span className="muted hint">Roll once to begin.</span> : null}
            </>
          )}
        </footer>
      </WoodWindow>

      <aside className="cr-stage" aria-label="Your hero">
        <LookStage classId={classId} look={look} onChange={setLook} view={view} size={narrow ? 170 : 340} />
        <WoodWindow className="cr-plate" role="group" label="Your hero">
          <strong className="cr-plate-name">{name.trim() || "Your hero"}</strong>
          <span className="cr-plate-class">
            {label("class", classId)}
            <span className="cc-tags">
              {(ROLES[classId] ?? []).map((r) => <span key={r} className={`role-tag role-${r.toLowerCase()}`}>{r}</span>)}
              <span className="role-tag stat-tag" title={`Leans on ${STAT_LABEL[main]}`}>{STAT_SHORT[main]}</span>
            </span>
          </span>
          <span className="cc-blurb">{blurb("class", classId)}</span>
          {cls.passive && <span className="cc-passive"><span className="cc-passive-label">Passive</span>{cls.passive}</span>}
          <span className="cc-weapon">
            <Icon name={WEAPON_ICON[cls.weapons[0]] ?? "broadsword"} color={RARITY_COLOR.common} size={18} />
            <span>Starts with <strong>{label("weapon", cls.weapons[0])}</strong></span>
          </span>
        </WoodWindow>
      </aside>
    </div>
  );
}

/** A six-sided die in pixels, for the name button. */
function PixelDie() {
  return (
    <svg viewBox="0 0 11 11" width={22} height={22} shapeRendering="crispEdges" aria-hidden focusable="false">
      <path fill="#1b1830" d="M2 0h7v1h1v1h1v7h-1v1h-1v1h-7v-1h-1v-1h-1v-7h1v-1h1z" />
      <path fill="#f1eee4" d="M2 1h7v1h1v7h-1v1h-7v-1h-1v-7h1z" />
      <path fill="#c9c3e0" d="M1 7h1v2h7v1h-7v-1h-1z" />
      <path fill="#b9433d" d="M3 3h1v1h-1zM7 3h1v1h-1zM5 5h1v1h-1zM3 7h1v1h-1zM7 7h1v1h-1z" />
    </svg>
  );
}
