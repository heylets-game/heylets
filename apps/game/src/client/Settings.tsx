// The game's settings: sound, graphics and the interface. Each is a page
// (SETTINGS_PAGES): the game menu (OptionsMenu.tsx) shows one at a time as a
// submenu, and the main menu's Settings (MainMenu.tsx) lists them all one
// under another (SettingsSections), so both change the same things.
//
// A page is a list of rows: an icon, a name with a short line under it saying
// what it does, and its control on the right (a switch, a choice, a stepper or
// a slider). New settings are a row in the page they belong to.

import { useEffect, useState, useSyncExternalStore, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { audio } from "./audio/engine";
import { FADERS, FADER_LABELS } from "./audio/mixer";
import { resetPanels } from "./DragPanel";
import { PixelIcon } from "./PixelIcon";
import { holdTap, touchScreen } from "./holdTap";
import { fancy, fancyGrass, outlines } from "./render/fancy";
import { units } from "./units";
import { GRASS, HEADPHONES, HOLD, KEYBOARD, OUTLINED, RULER, SCALE, SPARKLE, SPEAKER_OFF, SPEAKER_ON, WINDOWS } from "./ui/menuIcons";
import { UI_SCALE_MAX, UI_SCALE_MIN, UI_SCALE_STEP, getUiScale, onUiScaleChange, setUiScale, uiZoom } from "./uiScale";

/** A slider whose rail fills as far as its knob. */
function Slider({ value, disabled, onChange, label }: { value: number; disabled?: boolean; onChange(v: number): void; label: string }) {
  const pct = Math.round(value * 100);
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={5}
      value={pct}
      disabled={disabled}
      aria-label={label}
      aria-valuetext={`${pct}%`}
      style={{ "--fill": `${pct}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
    />
  );
}

/** One setting: its icon, its name and what it does, and its control at the end. */
function Row({ icon, label, note, children, title }: { icon?: string[]; label: ReactNode; note?: ReactNode; children?: ReactNode; title?: string }) {
  return (
    <div className="set-row" title={title}>
      <span className="set-icon">{icon && <PixelIcon rows={icon} size={18} />}</span>
      <span className="set-text">
        <span className="set-label">{label}</span>
        {note && <small className="set-note">{note}</small>}
      </span>
      {children && <span className="set-control">{children}</span>}
    </div>
  );
}

/** A setting that is on or off: the whole row is the switch. */
function Toggle({ icon, label, note, title, on, onChange }: { icon: string[]; label: string; note?: ReactNode; title?: string; on: boolean; onChange(on: boolean): void }) {
  return (
    <button className="set-row set-toggle" role="switch" aria-checked={on} title={title} onClick={() => onChange(!on)}>
      <span className="set-icon"><PixelIcon rows={icon} size={18} /></span>
      <span className="set-text">
        <span className="set-label">{label}</span>
        {note && <small className="set-note">{note}</small>}
      </span>
      <span className="set-control">
        <span className={`set-switch ${on ? "on" : ""}`} aria-hidden>
          <span className="set-switch-word">{on ? "On" : "Off"}</span>
          <i />
        </span>
      </span>
    </button>
  );
}

/** One of a few: pressed in is the one that holds. */
function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <span className="set-choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? "selected" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

function SoundPage() {
  // The engine's mix: a master, and a slider for each group under it.
  const mix = useSyncExternalStore(audio.mix.subscribe, audio.mix.get);
  const muted = mix.muted;
  return (
    <>
      <Toggle icon={muted ? SPEAKER_OFF : SPEAKER_ON} label="Sound" note={muted ? "Everything is quiet" : "Music, the sea and the game"} on={!muted} onChange={(on) => audio.mix.setMuted(!on)} />
      <div className="set-sliders">
        {FADERS.map((f) => {
          const level = audio.mix.volume(f);
          const name = f === "master" ? "Volume" : FADER_LABELS[f];
          return (
            <label key={f} className={`set-slider ${f === "master" ? "master" : ""}`}>
              <span className="set-label">{name}</span>
              <output className="set-value">{pct(level)}</output>
              <Slider label={name} value={level} disabled={muted} onChange={(v) => audio.mix.setVolume(f, v)} />
            </label>
          );
        })}
      </div>
      <Toggle
        icon={HEADPHONES}
        label="Headphones"
        note="3D sound, placed around your head"
        title="Places sounds around your head instead of between two speakers. Best on headphones."
        on={mix.headphones}
        onChange={(on) => audio.mix.setHeadphones(on)}
      />
      <div className="set-foot">
        <button className="link" disabled={!audio.mix.changed} onClick={() => audio.mix.reset()}>Reset sound</button>
      </div>
    </>
  );
}

function GraphicsPage() {
  const fancyOn = useSyncExternalStore(fancy.subscribe, fancy.get);
  const grassOn = useSyncExternalStore(fancyGrass.subscribe, fancyGrass.get);
  const outlinesOn = useSyncExternalStore(outlines.subscribe, outlines.get);
  return (
    <>
      <Toggle
        icon={SPARKLE}
        label="Fancy graphics"
        note="Glowing lights and a soft haze. Uses more battery"
        title="Glowing lights, a soft blur into the distance, and characters lit by the scene. Uses more battery."
        on={fancyOn}
        onChange={(on) => fancy.set(on)}
      />
      <Toggle
        icon={GRASS}
        label="Fancy grass"
        note="Thick fields and full trees. Off is easier on a phone"
        title="Thick fields of grass blades and oaks in full leaf. Off, the grass is a few tufts and the trees are plain low-poly: easier on a phone."
        on={grassOn}
        onChange={(on) => fancyGrass.set(on)}
      />
      <Toggle
        icon={OUTLINED}
        label="Outlines"
        note="A dark line round people and buildings"
        title="A dark line round people, buildings and what spells throw, like ink round a drawing."
        on={outlinesOn}
        onChange={(on) => outlines.set(on)}
      />
    </>
  );
}

function InterfacePage() {
  const measures = useSyncExternalStore(units.subscribe, units.get);
  const holdOn = useSyncExternalStore(holdTap.subscribe, holdTap.get);
  const [scale, setScale] = useState(getUiScale);
  const [zoom, setZoom] = useState(uiZoom);
  useEffect(
    () =>
      onUiScaleChange(() => {
        setScale(getUiScale());
        setZoom(uiZoom());
      }),
    [],
  );
  // From the live value, so quick presses each count even before a re-render.
  const step = (dir: 1 | -1) => setUiScale(getUiScale() + dir * UI_SCALE_STEP);
  return (
    <>
      <Row icon={SCALE} label="UI scale" note={zoom !== scale ? `Drawn at ${pct(zoom)} on a screen this narrow` : "How big the buttons and windows are"}>
        <span className="set-stepper" role="group" aria-label="UI scale">
          <button aria-label="Smaller" title="Smaller" disabled={scale <= UI_SCALE_MIN} onClick={() => step(-1)}>−</button>
          <output className="set-value" aria-live="polite">{pct(scale)}</output>
          <button aria-label="Larger" title="Larger" disabled={scale >= UI_SCALE_MAX} onClick={() => step(1)}>+</button>
        </span>
      </Row>
      <Row icon={RULER} label="Measures" note="How catches are weighed and measured" title="Kilograms and centimetres, or pounds and inches.">
        <Choice
          label="Measures"
          value={measures}
          options={[
            { value: "metric", label: "Metric" },
            { value: "imperial", label: "Imperial" },
          ]}
          onChange={(v) => units.set(v)}
        />
      </Row>
      {touchScreen() && (
        <Toggle
          icon={HOLD}
          label="Hold to confirm in fights"
          note="A tap shows where you'd go; hold to go there"
          title="In a fight, a quick tap on the map only shows where it would take you; hold your finger there a moment to move or act. Drag the map about without walking off by mistake."
          on={holdOn}
          onChange={(on) => holdTap.set(on)}
        />
      )}
      <Row icon={WINDOWS} label="Windows" note="Put every window you moved back where it started">
        <button onClick={resetPanels}>Reset</button>
      </Row>
    </>
  );
}

/**
 * The game's keys, for the Keys page. A computer has no camera buttons (render/camera.css): these are how it turns,
 * tips and follows. A new key goes here as well as where it is heard.
 */
const KEYS: { keys: string[]; what: string; note?: string }[] = [
  { keys: ["Esc"], what: "This menu" },
  { keys: ["B"], what: "Sea bag" },
  { keys: ["L"], what: "Logbook" },
  { keys: ["1", "–", "0"], what: "Use a slot on the bar", note: "Shift for the bottom row" },
  { keys: ["Q", "E"], what: "Turn the view" },
  { keys: ["R", "F"], what: "Tip the view up or down" },
  { keys: ["C"], what: "Follow your hero" },
  { keys: ["V"], what: "Combat view", note: "Cuts away what is in the way, in a fight" },
  { keys: ["P"], what: "Select your whole party", note: "On a map" },
  { keys: ["Right-drag"], what: "Turn the view by hand", note: "Or Shift-drag" },
  { keys: ["Wheel"], what: "Zoom in and out" },
];

function KeysPage() {
  return (
    <div className="set-keys">
      {KEYS.map((k) => (
        <Row key={k.what} label={k.what} note={k.note}>
          <span className="set-kbds">{k.keys.map((key) => (key === "–" ? <span key={key} className="set-kbd-to">to</span> : <kbd key={key}>{key}</kbd>))}</span>
        </Row>
      ))}
    </div>
  );
}

/** A page of settings: one submenu of the game menu. */
export interface SettingsPage {
  key: string;
  label: string;
  icon: string[];
  Page: ComponentType;
  /** Offered only where this says so (the keys, on a screen with a keyboard and mouse). Always, left out. */
  shown?(): boolean;
}

/** A computer: a mouse (or trackpad) to point with, and so most likely a keyboard. */
const pointerFine = () => typeof matchMedia !== "function" || !matchMedia("(pointer: coarse)").matches;

const ALL_PAGES: SettingsPage[] = [
  { key: "sound", label: "Sound", icon: SPEAKER_ON, Page: SoundPage },
  { key: "graphics", label: "Graphics", icon: SPARKLE, Page: GraphicsPage },
  { key: "interface", label: "Interface", icon: WINDOWS, Page: InterfacePage },
  { key: "keys", label: "Keys", icon: KEYBOARD, Page: KeysPage, shown: pointerFine },
];

/** The pages this screen offers. */
export const SETTINGS_PAGES: SettingsPage[] = ALL_PAGES.filter((p) => p.shown?.() ?? true);

/** One page's rows, in the settings' own box. */
export function SettingsPageBody({ page }: { page: SettingsPage }) {
  return <div className="set-page"><page.Page /></div>;
}

/** Every page, one under another under its heading (the main menu's Settings). */
export function SettingsSections() {
  return (
    <>
      {SETTINGS_PAGES.map((p) => (
        <section key={p.key} className="set-section">
          <h3>{p.label}</h3>
          <SettingsPageBody page={p} />
        </section>
      ))}
    </>
  );
}
