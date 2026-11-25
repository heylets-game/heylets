// A hero's model, live, for the look builder at character creation: the same
// figure the Harbor draws (render/figures.ts), lit like a portrait, rebuilt
// whenever what it shows changes. It stands still, a little turned; drag to
// turn it. `head` brings the camera in close on the face.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { appearanceKey, outfitKey, type Outfit } from "@gantt-quest/world";
import { makeFigure, type Figure } from "./render/figures";
import { lookFor } from "./render/sprites";

/** Tall enough for a lanky hero in a wizard's hat, in world units. */
const SIZE = 2;

/** Where the camera stands and what it looks at: the whole figure, or close on its head. */
interface Shot {
  y: number;
  away: number;
  at: number;
}

/**
 * `aim` turns the hero to face `turn` (0 is the front, π the back) each time its `n` changes, as when a side of
 * the tattoo doll is drawn on. `head` frames the head instead of the whole figure.
 */
export function FigurePreview({ classId, outfit, size = 280, head = false, walk = false, aim = null }: { classId: string; outfit: Outfit; size?: number; head?: boolean; walk?: boolean; aim?: { turn: number; n: number } | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Read by the animation loop each frame, so the camera eases in and out without rebuilding anything.
  const close = useRef(head);
  close.current = head;
  // Walking on the spot, to see the stride and what swings with it.
  const walking = useRef(walk);
  walking.current = walk;
  const stage = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; stand: THREE.Group; figure: Figure | null; turn: number; whole: Shot; face: Shot; zoom: number } | null>(null);

  // The renderer, the lights and the turning stand: made once.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#fff6e6", "#5a5a78", 1.8));
    const sun = new THREE.DirectionalLight("#fff1d8", 2);
    sun.position.set(-3, 6, 7);
    scene.add(sun);
    const rim = new THREE.DirectionalLight("#9fc8ff", 0.8);
    rim.position.set(4, 3, -5);
    scene.add(rim);
    const stand = new THREE.Group();
    scene.add(stand);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 50);
    camera.position.set(0, 1.35, 6.4);
    camera.lookAt(0, 1.05, 0);
    const shot: Shot = { y: 1.35, away: 6.4, at: 1.05 };
    stage.current = { renderer, scene, camera, stand, figure: null, turn: 0.3, whole: shot, face: shot, zoom: close.current ? 1 : 0 };

    let raf = 0;
    let last = performance.now();
    const t0 = last;
    let stride = 0;
    const frame = (now: number) => {
      const s = stage.current;
      if (!s) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      s.stand.rotation.y = s.turn;
      // In toward the head, or back out to the whole figure, easing.
      s.zoom += ((close.current ? 1 : 0) - s.zoom) * Math.min(1, dt * 8);
      const mix = (a: number, b: number) => a + (b - a) * s.zoom;
      s.camera.position.set(0, mix(s.whole.y, s.face.y), mix(s.whole.away, s.face.away));
      s.camera.lookAt(0, mix(s.whole.at, s.face.at), 0);
      if (walking.current) stride += dt * 1.5;
      s.figure?.update({ time: (now - t0) / 1000, stride, walking: walking.current, lean: 0, lying: false });
      s.renderer.render(s.scene, s.camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Drag to turn it by hand; it stays where it is let go.
    let dragging = false;
    let fromX = 0;
    const down = (e: PointerEvent) => {
      dragging = true;
      fromX = e.clientX;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging || !stage.current) return;
      stage.current.turn += (e.clientX - fromX) * 0.012;
      fromX = e.clientX;
    };
    const up = () => {
      dragging = false;
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      stage.current?.figure?.dispose();
      renderer.dispose();
      stage.current = null;
    };
  }, []);

  useEffect(() => {
    stage.current?.renderer.setSize(size, size, false);
  }, [size]);

  useEffect(() => {
    if (aim && stage.current) stage.current.turn = aim.turn;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim?.n]);

  // The figure: rebuilt when the class, what it wears or how it looks changes.
  const key = `${classId}|${outfitKey(outfit)}|${appearanceKey(outfit.appearance)}`;
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.figure?.dispose();
    if (s.figure) s.stand.remove(s.figure.root);
    const figure = makeFigure(classId, lookFor(classId), outfit, { lowPoly: true });
    figure.setSize(SIZE);
    s.stand.add(figure.root);
    s.figure = figure;
    // Frame it: a lanky hero in a tall hat and a short stout one both fill the view, feet to crown.
    figure.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(figure.root);
    const tall = Math.max(1.6, box.max.y - box.min.y);
    const mid = (box.max.y + box.min.y) / 2;
    const lens = Math.tan(THREE.MathUtils.degToRad(s.camera.fov / 2));
    s.whole = { y: mid + tall * 0.12, away: (tall * 0.62) / lens, at: mid };
    // Close on the head: its middle a little above where it sits on the neck, filling most of the view.
    const neck = figure.head()?.getWorldPosition(new THREE.Vector3());
    const faceY = neck ? neck.y + tall * 0.13 : box.max.y - tall * 0.22;
    s.face = { y: faceY + tall * 0.03, away: (tall * 0.29) / lens, at: faceY + tall * 0.02 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <canvas ref={canvas} className="figure-preview" width={size} height={size} style={{ width: size, height: size }} aria-label="Your hero. Drag to turn them." role="img" />;
}
