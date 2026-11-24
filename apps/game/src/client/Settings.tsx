// The game's settings: sound and display. Shown in the game menu (OptionsMenu.tsx)
// and in the main menu's Settings (MainMenu.tsx), so both change the same things.

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { audio } from "./audio/engine";
import { FADERS, FADER_LABELS } from "./audio/mixer";
import { resetPanels } from "./DragPanel";
import { PixelIcon } from "./PixelIcon";
import { holdTap, touchScreen } from "./holdTap";
import { fancy, fancyGrass, outlines } from "./render/fancy";
import { units } from "./units";
import { GRASS, HOLD, OUTLINED, RULER, SPARKLE, SPEAKER_OFF, SPEAKER_ON } from "./ui/menuIcons";
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

/** The Sound and Display columns, each a `.menu-col` section. */
export function SettingsSections() {
  // The sound is the audio engine's mix: a master, and a slider for each group under it.
  const mix = useSyncExternalStore(audio.mix.subscribe, audio.mix.get);
  const muted = mix.muted;
  const fancyOn = useSyncExternalStore(fancy.subscribe, fancy.get);
  const grassOn = useSyncExternalStore(fancyGrass.subscribe, fancyGrass.get);
  const outlinesOn = useSyncExternalStore(outlines.subscribe, outlines.get);
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
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  // From the live value, so quick presses each count even before a re-render.
  const step = (dir: 1 | -1) => setUiScale(getUiScale() + dir * UI_SCALE_STEP);

  return (
    <>
          <section className="menu-col">
            <h3>Sound</h3>
            <button className="options-sound" role="switch" aria-checked={!muted} onClick={() => audio.mix.setMuted(!muted)}>
              <PixelIcon rows={muted ? SPEAKER_OFF : SPEAKER_ON} size={18} />
              <span className="grow">Sound</span>
              <span className={`options-switch ${muted ? "" : "on"}`} aria-hidden>{muted ? "Off" : "On"}</span>
            </button>
            {FADERS.map((f) => {
              const level = audio.mix.volume(f);
              const name = f === "master" ? "Volume" : FADER_LABELS[f];
              return (
                <label key={f} className="menu-slider">
                  <span className="options-label">{name}</span>
                  <output className="options-value">{pct(level)}</output>
                  <Slider label={name} value={level} disabled={muted} onChange={(v) => audio.mix.setVolume(f, v)} />
                </label>
              );
            })}
            <label className="options-check" title="Places sounds around your head instead of between two speakers. Best on headphones.">
              <input type="checkbox" checked={mix.headphones} onChange={(e) => audio.mix.setHeadphones(e.target.checked)} /> Headphones (3D sound)
            </label>
            <button className="link" disabled={!audio.mix.changed} onClick={() => audio.mix.reset()}>Reset sound</button>
          </section>

          <section className="menu-col">
            <h3>Display</h3>
            <div className="options-row" role="group" aria-label="UI scale">
              <span className="options-label">UI scale</span>
              <button className="small" aria-label="Smaller" title="Smaller" disabled={scale <= UI_SCALE_MIN} onClick={() => step(-1)}>−</button>
              <output className="options-value" aria-live="polite">{pct(scale)}</output>
              <button className="small" aria-label="Larger" title="Larger" disabled={scale >= UI_SCALE_MAX} onClick={() => step(1)}>+</button>
            </div>
            {zoom !== scale && <p className="options-note muted">Drawn at {pct(zoom)} on a screen this narrow.</p>}
            <button
              className="options-sound"
              role="switch"
              aria-checked={fancyOn}
              title="Glowing lights, a soft blur into the distance, and characters lit by the scene. Uses more battery."
              onClick={() => fancy.set(!fancyOn)}
            >
              <PixelIcon rows={SPARKLE} size={18} />
              <span className="grow">Fancy graphics</span>
              <span className={`options-switch ${fancyOn ? "on" : ""}`} aria-hidden>{fancyOn ? "On" : "Off"}</span>
            </button>
            <button
              className="options-sound"
              role="switch"
              aria-checked={grassOn}
              title="Thick fields of grass blades and oaks in full leaf. Off, the grass is a few tufts and the trees are plain low-poly: easier on a phone."
              onClick={() => fancyGrass.set(!grassOn)}
            >
              <PixelIcon rows={GRASS} size={18} />
              <span className="grow">Fancy grass</span>
              <span className={`options-switch ${grassOn ? "on" : ""}`} aria-hidden>{grassOn ? "On" : "Off"}</span>
            </button>
            <button
              className="options-sound"
              role="switch"
              aria-checked={outlinesOn}
              title="A dark line round people, buildings and what spells throw, like ink round a drawing."
              onClick={() => outlines.set(!outlinesOn)}
            >
              <PixelIcon rows={OUTLINED} size={18} />
              <span className="grow">Outlines</span>
              <span className={`options-switch ${outlinesOn ? "on" : ""}`} aria-hidden>{outlinesOn ? "On" : "Off"}</span>
            </button>
            <button
              className="options-sound"
              role="switch"
              aria-checked={measures === "imperial"}
              title="How catches are weighed and measured: kilograms and centimetres, or pounds and inches."
              onClick={() => units.set(measures === "imperial" ? "metric" : "imperial")}
            >
              <PixelIcon rows={RULER} size={18} />
              <span className="grow">Measures</span>
              <span className="options-switch on" aria-hidden>{measures === "imperial" ? "Imperial" : "Metric"}</span>
            </button>
            {touchScreen() && (
              <button
                className="options-sound"
                role="switch"
                aria-checked={holdOn}
                title="In a fight, a quick tap on the map only shows where it would take you; hold your finger there a moment to move or act. Drag the map about without walking off by mistake."
                onClick={() => holdTap.set(!holdOn)}
              >
                <PixelIcon rows={HOLD} size={18} />
                <span className="grow">Hold to confirm in fights</span>
                <span className={`options-switch ${holdOn ? "on" : ""}`} aria-hidden>{holdOn ? "On" : "Off"}</span>
              </button>
            )}
            <button className="menu-action" onClick={resetPanels}>Reset UI windows</button>
          </section>
    </>
  );
}
