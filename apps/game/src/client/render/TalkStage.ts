// A conversation, seen up close: the camera swings in over your hero's shoulder onto the face of whoever you are
// talking to, they put down what they were at and turn to you, and you to them. Not a scene of its own: a minigame
// played in the room's renderer (WorldRenderer.startMinigame), like the garden or a game table. The words are in
// the box along the bottom (Dialogue.tsx); this is only the camera and the two of them.

import * as THREE from "three";
import type { WorldMinigame, WorldRenderer } from "./WorldRenderer";

const DEG = Math.PI / 180;
/** Seconds to swing in, and back out; a moment either way with reduced motion asked for. */
const IN_S = 0.7;
const OUT_S = 0.5;
const STILL_S = 0.2;
/** How far the view may turn from the room's own to see them: past it the room's near walls stand in the way. */
const MAX_SWING = 70 * DEG;
/**
 * How far to one side of the line between the two the view passes your hero, in world units: over their shoulder,
 * not through their head (less on a tall screen). The camera is turned off the line by however much that takes at
 * the distance between them.
 */
const SHOULDER = 0.5;
const SHOULDER_TALL = 0.32;
/** The nearest the eye comes to whoever it looks at, and how far behind your hero it stands. */
const NEAR = 4.4;
const BEHIND = 1.6;
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface TalkHooks {
  /** The camera is most of the way in: their words can start. */
  arrived(): void;
  /** A press on the scene: on to the next words. */
  advance(): void;
  /** Whoever you were talking to is gone (their visit is over): the conversation ends. */
  gone(): void;
  /** The camera is back out and the view given back. */
  left(): void;
}

export class TalkStage implements WorldMinigame {
  private inT = 0;
  private leaving = false;
  private disposed = false;
  private settled = false;
  private told = false;
  private clock = 0;
  private still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The room's own bearing as the conversation began: the camera stays within MAX_SWING of it. */
  private bearing: number;
  /** Where the two last stood, should either go missing for a frame. */
  private hero = new THREE.Vector3();
  private them = new THREE.Vector3();
  /** How far right of the middle of the screen to keep them (a share of its width), and how far it has got: clear of a panel down the left. */
  private asideGoal = 0;
  private aside = 0;

  /** `side`: which of your shoulders to look over (1 right, -1 left), where the room has something in the way of the other. */
  constructor(private world: WorldRenderer, _group: THREE.Group, private you: string, private npc: string, private hooks: TalkHooks, private side?: 1 | -1) {
    this.bearing = world.viewBearing();
  }

  /** Your hero is drawn as ever until the camera takes over, then without their tag and ring: you see over their shoulder. */
  ownHero(): "figure" {
    return "figure";
  }

  frame(dt: number, _now: number, aspect: number): { eye: THREE.Vector3; look: THREE.Vector3; blend: number; fov: number } {
    // Nothing moves until your hero has walked up and stopped.
    if (!this.settled && this.world.heroSettled()) this.settle();
    const hero = this.world.unitSpot(this.you);
    const them = this.world.unitSpot(this.npc);
    if (hero) this.hero.copy(hero);
    if (them) this.them.copy(them);
    else if (this.settled && !this.leaving) this.hooks.gone();
    if (this.settled) {
      this.clock += dt;
      const over = this.still ? STILL_S : this.leaving ? OUT_S : IN_S;
      this.inT = this.leaving ? Math.max(0, this.inT - dt / over) : Math.min(1, this.inT + dt / over);
      if (!this.told && this.inT >= 0.6 && !this.leaving) {
        this.told = true;
        this.hooks.arrived();
      }
      if (this.leaving && this.inT <= 0) setTimeout(() => this.finish(), 0);
      this.aside += (this.asideGoal - this.aside) * (this.still ? 1 : 1 - Math.exp(-dt * 5));
    }
    return { ...this.shot(aspect), blend: smoother(this.inT) };
  }

  /** Where the eye is and what it looks at: their face, from just behind your hero and off to one shoulder. */
  private shot(aspect: number): { eye: THREE.Vector3; look: THREE.Vector3; fov: number } {
    const head = this.world.unitHead(this.npc);
    const look = new THREE.Vector3(this.them.x, head ? head.y - 0.55 : this.them.y + 1.25, this.them.z);
    const apart = Math.hypot(this.hero.x - this.them.x, this.hero.z - this.them.z);
    // A tall window (a phone held upright), not a narrow space beside a panel: only then is the shot pulled back.
    const tall = aspect < 1 && innerHeight > innerWidth;
    let reach = Math.max(NEAR, apart + BEHIND);
    if (tall) reach *= THREE.MathUtils.clamp(0.9 / aspect, 1, 1.35);
    // A slow push in while they talk.
    if (!this.still) reach *= 1 - 0.03 * Math.min(1, this.clock / 4);
    // From their side of the line to your hero's, kept within the swing the room allows, and over the shoulder nearer the room's own view.
    const toHero = apart > 0.05 ? Math.atan2(this.hero.x - this.them.x, this.hero.z - this.them.z) : this.bearing;
    const swing = THREE.MathUtils.clamp(wrap(toHero - this.bearing), -MAX_SWING, MAX_SWING);
    const shoulder = Math.asin(Math.min(0.6, (tall ? SHOULDER_TALL : SHOULDER) / Math.max(1, apart)));
    const side = this.side ?? (swing > 0 ? -1 : 1);
    const sway = this.still ? 0 : Math.sin(this.clock * 0.35) * 0.6 * DEG;
    const bearing = this.bearing + swing + side * shoulder + sway;
    const eyeY = this.hero.y + (tall ? 2.35 : 2.2);
    const eye = new THREE.Vector3(look.x + Math.sin(bearing) * reach, eyeY, look.z + Math.cos(bearing) * reach);
    // Narrower the further back, so their head is the same size on the screen however far apart the two stand.
    const fov = THREE.MathUtils.clamp(2 * Math.atan((Math.tan(15 * DEG) * NEAR) / reach) / DEG, 20, 34);
    if (Math.abs(this.aside) > 0.001) {
      // Slid sideways, eye and all, so they stand that far right of the middle: the view's half width there, times two, times the share.
      const across = 2 * reach * Math.tan((fov * DEG) / 2) * aspect * this.aside;
      const left = new THREE.Vector3(-Math.cos(bearing), 0, Math.sin(bearing)).multiplyScalar(across);
      eye.add(left);
      look.add(left);
    }
    return { eye, look, fov };
  }

  /** Your hero has stopped beside them: they put down their work, and the two turn to each other. */
  private settle() {
    this.settled = true;
    const hero = this.world.unitSpot(this.you);
    const them = this.world.unitSpot(this.npc);
    if (hero) this.hero.copy(hero);
    if (them) this.them.copy(them);
    this.world.rest(this.npc);
    if (hero && them) {
      this.world.turnUnit(this.npc, { x: hero.x, z: hero.z });
      this.world.turnUnit(this.you, { x: them.x, z: them.z });
    }
    this.world.setQuiet([this.you, this.npc]);
  }

  /** The camera is all the way in. */
  get arrived(): boolean {
    return this.inT >= 0.6 && !this.leaving;
  }

  /** Keep them this share of the screen's width right of the middle (0: in the middle): clear of a panel down the left. */
  setAside(share: number) {
    this.asideGoal = share;
  }

  /** Speaking: their mouth moves while their words are typed out. */
  setSpeaking(on: boolean) {
    this.world.setTalking(this.npc, on && !this.leaving);
  }

  press() {
    if (this.arrived) this.hooks.advance();
  }

  /** Every key is the conversation's while it is up (the camera keys do nothing), but a focused button's own Enter or Space. */
  key(e: KeyboardEvent): boolean {
    return (e.target as HTMLElement | null)?.tagName !== "BUTTON";
  }

  /** Swing back out to the room, then take the stage down and give the view back. */
  leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.world.setTalking(this.npc, false);
    // Never started (your hero had not stopped yet): nothing to swing back from.
    if (!this.settled) setTimeout(() => this.finish(), 0);
  }

  private finish() {
    if (this.disposed) return;
    this.disposed = true;
    // (Ending the game turns the two back, and draws their tags and bubbles again.)
    if (this.world.playing === this) this.world.endMinigame();
    this.hooks.left();
  }
}
