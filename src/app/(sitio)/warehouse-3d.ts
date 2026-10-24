import { animate, createTimeline, stagger } from "animejs";
import type { JSAnimation, Timeline } from "animejs";
import * as THREE from "three";

/**
 * 3D warehouse of the landing hero (three.js + anime.js). Racks with boxes
 * that settle onto the shelves, and a forklift that brings one box to an
 * empty place, over and over, lowering it until it rests on the shelf.
 * Decorative.
 *
 * Colors come from the scene tokens of globals.css and follow the theme.
 * With reduced motion (read live) the scene is drawn once, complete and
 * still. Nothing renders while the canvas is off screen or the tab hidden.
 */

type Slot = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  tone: number;
  drop: number;
  scale: number;
};

type Options = {
  onReady?: () => void;
};

const RACKS = [-5.2, -2, 2, 5.2];
const LEVELS = [0.2, 1.6, 3];
const PLACES = [-2.4, -0.8, 0.8, 2.4];
const RACK_LENGTH = 6.6;
const RACK_HEIGHT = 4.2;
/** The empty place the forklift fills: rack at x = 2, middle level. */
const TARGET = { rack: 2, level: 1.6, z: 0.8 };
/**
 * Facing the rack (turned 90°) the carried box's center is 1.2 ahead of the
 * truck and its base 0.14 above the lift, so these put it exactly on the
 * target place; CLEARANCE lifts it over the beam on the way in.
 */
const REACH = TARGET.rack - 1.2;
const SET_DOWN = TARGET.level - 0.14;
const CLEARANCE = 0.15;

/** Deterministic pseudo-random numbers: the same warehouse on every visit. */
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function readPalette() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: token("--background"),
    floor: token("--scene-floor"),
    rack: token("--scene-rack"),
    beam: token("--scene-beam"),
    box: token("--scene-box"),
    boxShade: token("--scene-box-shade"),
    tape: token("--scene-tape"),
    forklift: token("--scene-forklift"),
    forkliftDark: token("--scene-forklift-dark"),
    primary: token("--primary"),
    dark: document.documentElement.classList.contains("dark"),
  };
}

export function mountWarehouse(
  container: HTMLElement,
  { onReady }: Options = {},
): () => void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
  } catch {
    throw new Error("WebGL is not available");
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 120);
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item);
    return item;
  };

  // Materials (colors set by applyPalette).
  const floorMaterial = track(new THREE.MeshLambertMaterial());
  const rackMaterial = track(new THREE.MeshLambertMaterial());
  const beamMaterial = track(new THREE.MeshLambertMaterial());
  const boxMaterial = track(new THREE.MeshLambertMaterial());
  const tapeMaterial = track(new THREE.MeshLambertMaterial());
  const forkliftMaterial = track(new THREE.MeshLambertMaterial());
  const darkMaterial = track(new THREE.MeshLambertMaterial());
  const lineMaterial = track(
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }),
  );

  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(9, 16, 6);
  scene.add(hemisphere, sun);

  // Floor: a disc whose edge fades out (alpha from a radial gradient), so
  // the warehouse floats on the page instead of sitting in a gray box.
  const fade = document.createElement("canvas");
  fade.width = fade.height = 128;
  const paint = fade.getContext("2d");
  if (paint) {
    const gradient = paint.createRadialGradient(64, 64, 20, 64, 64, 64);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.45, "#fff");
    gradient.addColorStop(1, "#000");
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 128, 128);
  }
  floorMaterial.alphaMap = track(new THREE.CanvasTexture(fade));
  floorMaterial.transparent = true;
  floorMaterial.depthWrite = false;
  const floor = new THREE.Mesh(
    track(new THREE.CircleGeometry(9, 64)),
    floorMaterial,
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const lineGeometry = track(new THREE.PlaneGeometry(0.08, 14));
  for (const x of [-1.2, 1.2]) {
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.01, 0);
    scene.add(line);
  }

  // Racks: uprights, shelves and the orange beams in front.
  const upright = track(new THREE.BoxGeometry(0.12, RACK_HEIGHT, 0.12));
  const shelf = track(new THREE.BoxGeometry(1.2, 0.06, RACK_LENGTH));
  const beam = track(new THREE.BoxGeometry(0.07, 0.14, RACK_LENGTH));
  for (const x of RACKS) {
    for (const side of [-0.56, 0.56]) {
      for (const z of [-RACK_LENGTH / 2, 0, RACK_LENGTH / 2]) {
        const post = new THREE.Mesh(upright, rackMaterial);
        post.position.set(x + side, RACK_HEIGHT / 2, z);
        scene.add(post);
      }
    }
    for (const y of LEVELS) {
      const deck = new THREE.Mesh(shelf, rackMaterial);
      deck.position.set(x, y - 0.03, 0);
      scene.add(deck);
      for (const side of [-0.6, 0.6]) {
        const front = new THREE.Mesh(beam, beamMaterial);
        front.position.set(x + side, y - 0.05, 0);
        scene.add(front);
      }
    }
  }

  // Boxes on the shelves (one instanced mesh for boxes, one for the tape).
  const random = seeded(7);
  const slots: Slot[] = [];
  let target: Slot | undefined;
  for (const x of RACKS) {
    for (const y of LEVELS) {
      for (const z of PLACES) {
        const isTarget =
          x === TARGET.rack && y === TARGET.level && z === TARGET.z;
        if (!isTarget && random() < 0.14) continue;
        const slot: Slot = {
          x: x + (random() - 0.5) * 0.12,
          y,
          z: z + (random() - 0.5) * 0.18,
          w: 0.78 + random() * 0.22,
          h: 0.62 + random() * 0.5,
          d: 0.95 + random() * 0.35,
          tone: random(),
          drop: 0,
          scale: 1,
        };
        if (isTarget) {
          Object.assign(slot, { x, z, w: 0.9, h: 0.8, d: 1.1, tone: 0.2 });
          target = slot;
        }
        slots.push(slot);
      }
    }
  }
  const unitBox = track(new THREE.BoxGeometry(1, 1, 1));
  const boxes = new THREE.InstancedMesh(unitBox, boxMaterial, slots.length);
  const tapes = new THREE.InstancedMesh(unitBox, tapeMaterial, slots.length);
  scene.add(boxes, tapes);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const size = new THREE.Vector3();
  const identity = new THREE.Quaternion();
  const color = new THREE.Color();
  const shade = new THREE.Color();
  const highlightColor = new THREE.Color();
  const tint = new THREE.Color();
  const delivery = { highlight: 0 };

  // Forklift: body, mast, forks and the box it carries (sized like the
  // target once turned: 0.9 across the rack, 1.1 along it).
  const forklift = new THREE.Group();
  const add = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    parent: THREE.Object3D = forklift,
  ) => {
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  add(new THREE.BoxGeometry(1, 0.55, 1.3), forkliftMaterial, 0, 0.5, -0.1);
  add(new THREE.BoxGeometry(0.9, 0.5, 0.5), forkliftMaterial, 0, 0.95, -0.55);
  add(new THREE.BoxGeometry(0.9, 0.06, 0.9), darkMaterial, 0, 1.75, -0.2);
  for (const x of [-0.4, 0.4]) {
    add(new THREE.BoxGeometry(0.06, 0.8, 0.06), darkMaterial, x, 1.35, 0.2);
    add(
      new THREE.BoxGeometry(0.08, 2.3, 0.08),
      darkMaterial,
      x * 0.8,
      1.15,
      0.62,
    );
    for (const z of [-0.5, 0.35]) {
      const wheel = add(
        new THREE.CylinderGeometry(0.2, 0.2, 0.16, 16),
        darkMaterial,
        x * 1.3,
        0.2,
        z,
      );
      wheel.rotation.z = Math.PI / 2;
    }
  }
  const forks = new THREE.Group();
  forks.position.set(0, 0.12, 0.7);
  forklift.add(forks);
  for (const x of [-0.25, 0.25]) {
    add(new THREE.BoxGeometry(0.1, 0.04, 1), darkMaterial, x, 0, 0.5, forks);
  }
  add(new THREE.BoxGeometry(0.8, 0.5, 0.06), darkMaterial, 0, 0.25, 0, forks);
  const carried = add(
    new THREE.BoxGeometry(1.1, 0.8, 0.9),
    boxMaterial,
    0,
    0.42,
    0.5,
    forks,
  );
  const carriedTape = add(
    new THREE.BoxGeometry(1.11, 0.02, 0.16),
    tapeMaterial,
    0,
    0.83,
    0.5,
    forks,
  );
  scene.add(forklift);
  const truck = { x: 0, z: -11, turn: 0, lift: 0, carrying: 1 };

  function applyPalette() {
    const palette = readPalette();
    floorMaterial.color.set(palette.floor);
    rackMaterial.color.set(palette.rack);
    beamMaterial.color.set(palette.beam);
    boxMaterial.color.set(palette.box);
    tapeMaterial.color.set(palette.tape);
    forkliftMaterial.color.set(palette.forklift);
    darkMaterial.color.set(palette.forkliftDark);
    lineMaterial.color.set(palette.beam);
    color.set(palette.box);
    shade.set(palette.boxShade);
    highlightColor.set(palette.primary);
    hemisphere.groundColor.set(palette.floor);
    hemisphere.intensity = palette.dark ? 1.1 : 1.5;
    sun.intensity = palette.dark ? 1.2 : 1.7;
    scene.fog = new THREE.Fog(palette.background, 30, 46);
  }

  function updateBoxes() {
    slots.forEach((slot, index) => {
      const scale = Math.max(slot.scale, 0.0001);
      position.set(slot.x, slot.y + (slot.h * scale) / 2 + slot.drop, slot.z);
      size.set(slot.w * scale, slot.h * scale, slot.d * scale);
      matrix.compose(position, identity, size);
      boxes.setMatrixAt(index, matrix);
      tint.copy(color).lerp(shade, slot.tone * 0.7);
      if (slot === target) tint.lerp(highlightColor, delivery.highlight);
      boxes.setColorAt(index, tint);
      position.y = slot.y + slot.h * scale + slot.drop + 0.005;
      size.set(0.16 * scale, 0.01, (slot.d + 0.01) * scale);
      matrix.compose(position, identity, size);
      tapes.setMatrixAt(index, matrix);
    });
    boxes.instanceMatrix.needsUpdate = true;
    tapes.instanceMatrix.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
  }

  function updateForklift() {
    forklift.position.set(truck.x, 0, truck.z);
    forklift.rotation.y = truck.turn;
    forks.position.y = 0.12 + truck.lift;
    carried.visible = truck.carrying > 0.5;
    carriedTape.visible = carried.visible;
  }

  // Camera: fixed three-quarter view, pointer parallax and a slow drift.
  const pointer = { x: 0, y: 0 };
  const view = { x: 0, y: 0 };
  let distance = 1;
  function resize() {
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = width / height;
    distance = Math.max(1, 1.25 / camera.aspect);
    camera.updateProjectionMatrix();
  }
  function placeCamera(time: number) {
    const drift = reduce ? 0 : Math.sin(time / 9000) * 0.12;
    const angle = Math.PI / 4 + drift + view.x * 0.12;
    const radius = 25 * distance;
    camera.position.set(
      Math.sin(angle) * radius,
      15.5 * distance + view.y * 1.4,
      Math.cos(angle) * radius,
    );
    camera.lookAt(0, 0.9, 0);
  }
  function render(time = performance.now()) {
    view.x += (pointer.x - view.x) * 0.05;
    view.y += (pointer.y - view.y) * 0.05;
    placeCamera(time);
    updateBoxes();
    updateForklift();
    renderer.render(scene, camera);
  }

  // Motion: the boxes settle once, then the forklift loop.
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduce = motionQuery.matches;
  let settle: JSAnimation | undefined;
  let loop: Timeline | undefined;

  function stillLife() {
    for (const slot of slots) Object.assign(slot, { drop: 0, scale: 1 });
    Object.assign(truck, { x: 0, z: 3.2, turn: 0, lift: 0, carrying: 1 });
    delivery.highlight = 0;
  }

  function startMotion() {
    for (const slot of slots) Object.assign(slot, { drop: 3.5, scale: 0 });
    // The target skips the settle animation, so it must start on its shelf.
    if (target) Object.assign(target, { drop: 0, scale: 0 });
    const settling = slots.filter((slot) => slot !== target);
    settle = animate(settling, {
      drop: 0,
      scale: 1,
      duration: 900,
      delay: stagger(22, { from: "random", start: 200 }),
      ease: "outBack(1.1)",
    });
    loop = createTimeline({ loop: true, delay: 1400 })
      .call(() => {
        truck.carrying = 1;
      }, 0)
      .add(target ?? {}, { scale: 0, duration: 400, ease: "inQuad" }, 0)
      .set(truck, { x: 0, z: -11, turn: 0, lift: 0 }, 0)
      .add(truck, { z: TARGET.z, duration: 2800, ease: "inOutSine" }, 300)
      .add(truck, { turn: Math.PI / 2, duration: 700, ease: "inOutQuad" })
      .add(truck, {
        lift: SET_DOWN + CLEARANCE,
        duration: 900,
        ease: "inOutQuad",
      })
      .add(truck, { x: REACH, duration: 500, ease: "outQuad" })
      .add(truck, { lift: SET_DOWN, duration: 350, ease: "inOutQuad" })
      .call(() => {
        truck.carrying = 0;
        if (target) target.scale = 1;
        delivery.highlight = 1;
      })
      .label("delivered")
      .add(truck, { x: 0, duration: 500, ease: "inOutQuad" })
      .add(truck, { lift: 0, duration: 800, ease: "inOutQuad" })
      .add(
        delivery,
        { highlight: 0, duration: 1600, ease: "outQuad" },
        "delivered",
      )
      .add(truck, { turn: 0, duration: 700, ease: "inOutQuad" })
      .add(truck, { z: 12, duration: 2600, ease: "inSine" })
      .add({ wait: 0 }, { wait: 1, duration: 900 });
  }

  function stopMotion() {
    settle?.revert();
    loop?.revert();
    settle = undefined;
    loop = undefined;
  }

  // Render loop, paused off screen, in a hidden tab or with reduced motion.
  let frame = 0;
  let onScreen = true;
  function tick(time: number) {
    frame = 0;
    render(time);
    schedule();
  }
  function schedule() {
    const running = !reduce && onScreen && !document.hidden;
    if (running) {
      settle?.play();
      loop?.play();
      if (!frame) frame = requestAnimationFrame(tick);
    } else {
      settle?.pause();
      loop?.pause();
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    }
  }

  function onMotionChange() {
    reduce = motionQuery.matches;
    stopMotion();
    if (reduce) stillLife();
    else startMotion();
    render();
    schedule();
  }

  const onPointer = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  };
  const onLeave = () => {
    pointer.x = 0;
    pointer.y = 0;
  };
  const resizeObserver = new ResizeObserver(() => {
    resize();
    render();
  });
  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry?.isIntersecting ?? true;
    schedule();
  });
  const themeObserver = new MutationObserver(() => {
    applyPalette();
    render();
  });

  applyPalette();
  resize();
  if (reduce) stillLife();
  else startMotion();
  render();
  onReady?.();

  resizeObserver.observe(container);
  visibility.observe(container);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  motionQuery.addEventListener("change", onMotionChange);
  document.addEventListener("visibilitychange", schedule);
  container.addEventListener("pointermove", onPointer);
  container.addEventListener("pointerleave", onLeave);
  schedule();

  return () => {
    stopMotion();
    if (frame) cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    visibility.disconnect();
    themeObserver.disconnect();
    motionQuery.removeEventListener("change", onMotionChange);
    document.removeEventListener("visibilitychange", schedule);
    container.removeEventListener("pointermove", onPointer);
    container.removeEventListener("pointerleave", onLeave);
    boxes.dispose();
    tapes.dispose();
    for (const item of disposables) item.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
