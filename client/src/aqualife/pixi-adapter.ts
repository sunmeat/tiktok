import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { getFishSpeciesDefinition } from "@tiktok-arena/shared";
import type { AquaLifeRenderSnapshot, FishRenderModel, FishSpeciesId } from "@tiktok-arena/shared";

interface FishView {
  /** Positioned at the fish; holds the never-flipped label and comment. */
  root: Container;
  /** Rotated/mirrored so the fish keeps its back up instead of swimming upside down. */
  swim: Container;
  shadow: Graphics;
  tail: Graphics;
  body: Graphics;
  label: Text;
  comment: Text;
  commentUntilMs: number;
  lastLabel: string;
  lastFeedback: FishRenderModel["rewardFeedback"];
  lastCombatFeedback: FishRenderModel["combatFeedback"];
  lastSpecies: FishSpeciesId;
  /** Last damageSeq already shown, so each bite spawns exactly one floating number. */
  lastDamageSeq: number;
  /** Where the tail joins the body, in unscaled species units. */
  tailJointX: number;
  tailPhase: number;
  swayPhase: number;
  /** Smoothed horizontal mirror, +1 facing right .. -1 facing left. */
  facing: number;
  /** Facing chosen with hysteresis so a near-vertical heading cannot flicker. */
  facingTarget: 1 | -1;
  pitch: number;
}

interface JellyfishView {
  root: Container;
  bell: Graphics;
  tentacles: Graphics;
  phase: number;
}

const TWO_PI = Math.PI * 2;
/** Bounded pool of floating combat numbers; the oldest is reused when all are busy. */
const MAX_DAMAGE_NUMBERS = 24;
const DAMAGE_NUMBER_SECONDS = 1.3;

interface DamageNumber {
  text: Text;
  age: number;
  active: boolean;
  startX: number;
  startY: number;
  drift: number;
}
/** Largest nose-up/nose-down tilt; steeper headings keep this tilt instead of flipping the fish. */
const MAX_PITCH = 1.3;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function wrapAngle(angle: number): number {
  let value = angle;
  while (value > Math.PI) value -= TWO_PI;
  while (value < -Math.PI) value += TWO_PI;
  return value;
}

/** Reusable PixiJS display objects. Simulation owns all gameplay state. */
export class AquaLifePixiAdapter {
  readonly root = new Container();
  private lastNowMs = -1;
  private readonly damageLayer = new Container();
  private readonly damageNumbers: DamageNumber[] = [];
  private readonly damageStyle = new TextStyle({
    fill: "#ff5252",
    fontFamily: "Arial",
    fontSize: 15,
    fontWeight: "900",
    stroke: { color: "#2a0606", width: 3 }
  });
  private readonly fishViews = new Map<string, FishView>();
  private readonly jellyfishViews = new Map<string, JellyfishView>();
  private readonly labelStyle = new TextStyle({
    fill: "#f2fcff",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "700",
    stroke: { color: "#062332", width: 3 }
  });
  private readonly commentStyle = new TextStyle({
    fill: "#ff9ce8",
    fontFamily: "Arial",
    fontSize: 11,
    fontWeight: "600",
    stroke: { color: "#062332", width: 2.5 },
    wordWrap: true,
    wordWrapWidth: 150,
    breakWords: true
  });

  constructor(private readonly stage: Container) {
    this.stage.addChild(this.root);
    this.root.addChild(this.damageLayer);
  }

  update(snapshot: AquaLifeRenderSnapshot, viewportWidth: number, viewportHeight: number): void {
    const scale = Math.min(viewportWidth / Math.max(1, snapshot.world.width), viewportHeight / Math.max(1, snapshot.world.height));
    this.root.scale.set(scale);
    this.root.position.set((viewportWidth - snapshot.world.width * scale) / 2, (viewportHeight - snapshot.world.height * scale) / 2);

    // Animation advances by real elapsed simulation time so it is frame-rate independent.
    const dt = this.lastNowMs < 0 ? 1 / 60 : clamp((snapshot.nowMs - this.lastNowMs) / 1000, 0, 0.1);
    this.lastNowMs = snapshot.nowMs;

    const seen = new Set<string>();
    for (const fish of snapshot.fish) {
      seen.add(fish.id);
      const view = this.fishViews.get(fish.id) ?? this.createFishView(fish);
      view.root.position.set(fish.x, fish.y);
      this.animateFish(view, fish, dt);
      if (fish.damageSeq !== view.lastDamageSeq) {
        view.lastDamageSeq = fish.damageSeq;
        this.spawnDamageNumber(fish.lastDamage, fish.x, fish.y - 18 * Math.max(0.2, fish.size), fish.damageSeq);
      }
      if (view.lastSpecies !== fish.species) {
        this.drawFishBody(view.body, fish.species);
        this.drawFishTail(view.tail, fish.species);
        view.tailJointX = -getFishSpeciesDefinition(fish.species).bodyLength * 0.66;
        view.body.tint = 0xffffff;
        view.lastFeedback = null;
        view.lastCombatFeedback = null;
        view.lastSpecies = fish.species;
      }
      const bodyScale = Math.max(0.2, fish.size);
      view.shadow.scale.set(bodyScale, bodyScale);
      const label = `${fish.nickname} · ❤️ ${fish.hp}`;
      if (label !== view.lastLabel) {
        view.label.text = label;
        view.lastLabel = label;
      }
      view.label.position.set(0, 20 * bodyScale);
      view.comment.position.set(0, -25 * bodyScale);
      view.comment.alpha = view.commentUntilMs > snapshot.nowMs ? Math.min(1, (view.commentUntilMs - snapshot.nowMs) / 450) : 0;
      if (fish.rewardFeedback !== view.lastFeedback || fish.combatFeedback !== view.lastCombatFeedback) {
        view.body.tint =
          fish.rewardFeedback === "growth" ? 0xffe08a
          : fish.rewardFeedback === "heal" ? 0x8dffbd
          : fish.rewardFeedback === "activity" ? 0x9af2ff
          : fish.combatFeedback === "hurt" ? 0xff7777
          : fish.combatFeedback === "attack" ? 0xffbd76
          : 0xffffff;
        view.lastFeedback = fish.rewardFeedback;
        view.lastCombatFeedback = fish.combatFeedback;
      }
      // Dead fish fade out smoothly; the simulation computes alpha for death and departure.
      view.root.alpha = fish.alpha;
    }

    for (const [id, view] of this.fishViews) {
      if (seen.has(id)) continue;
      view.root.destroy({ children: true });
      this.fishViews.delete(id);
    }

    this.updateDamageNumbers(dt);

    const seenJellyfish = new Set<string>();
    for (const jellyfish of snapshot.jellyfish) {
      seenJellyfish.add(jellyfish.id);
      let view = this.jellyfishViews.get(jellyfish.id);
      if (!view) {
        view = this.createJellyfishView(jellyfish.size);
        this.root.addChild(view.root);
        this.root.addChild(this.damageLayer);
        this.jellyfishViews.set(jellyfish.id, view);
      }
      view.root.position.set(jellyfish.x, jellyfish.y);
      view.phase += 0.045;
      view.root.scale.set(0.92 + Math.sin(view.phase) * 0.1, 0.94 + Math.sin(view.phase * 1.6) * 0.08);
      view.root.rotation = Math.sin(view.phase * 0.65) * 0.09;
    }
    for (const [id, view] of this.jellyfishViews) {
      if (seenJellyfish.has(id)) continue;
      view.root.destroy({ children: true });
      this.jellyfishViews.delete(id);
    }
  }

  showComment(fishId: string, message: string, nowMs: number): void {
    const view = this.fishViews.get(fishId);
    if (!view || !message.trim()) return;
    const clean = message.trim().replace(/\\s+/g, " ").slice(0, 140);
    view.comment.text = clean;
    view.comment.alpha = 1;
    view.commentUntilMs = nowMs + 4_000;
  }

  destroy(): void {
    for (const view of this.fishViews.values()) view.root.destroy({ children: true });
    this.fishViews.clear();
    for (const view of this.jellyfishViews.values()) view.root.destroy({ children: true });
    this.jellyfishViews.clear();
    this.root.destroy({ children: true });
  }

  private spawnDamageNumber(amount: number, x: number, y: number, seq: number): void {
    let entry = this.damageNumbers.find(item => !item.active);
    if (!entry) {
      if (this.damageNumbers.length < MAX_DAMAGE_NUMBERS) {
        const text = new Text({ text: "", style: this.damageStyle });
        text.anchor.set(0.5);
        this.damageLayer.addChild(text);
        entry = { text, age: 0, active: false, startX: 0, startY: 0, drift: 0 };
        this.damageNumbers.push(entry);
      } else {
        // Overflow policy: reuse the number that has been on screen the longest.
        entry = this.damageNumbers.reduce((oldest, item) => (item.age > oldest.age ? item : oldest));
      }
    }
    entry.text.text = `-${Math.max(1, Math.round(amount))}`;
    entry.age = 0;
    entry.active = true;
    entry.startX = x;
    entry.startY = y;
    entry.drift = ((seq * 37) % 21 - 10) * 0.9;
    entry.text.visible = true;
  }

  private updateDamageNumbers(dt: number): void {
    for (const item of this.damageNumbers) {
      if (!item.active) continue;
      item.age += dt;
      const t = item.age / DAMAGE_NUMBER_SECONDS;
      if (t >= 1) {
        item.active = false;
        item.text.visible = false;
        continue;
      }
      // Rises with ease-out, pops in slightly larger, then fades over the last 40%.
      const rise = 1 - (1 - t) * (1 - t);
      item.text.position.set(item.startX + item.drift * t, item.startY - 40 * rise);
      item.text.scale.set(t < 0.15 ? 1.35 - 0.35 * (t / 0.15) : 1);
      item.text.alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    }
  }

  /**
   * Procedural swimming animation driven by simulation state:
   * - the tail beats hard (about 5 Hz) right after a stroke and almost stops while gliding;
   * - the body counter-sways against the tail, giving an S-shaped wave;
   * - a turning fish bends its tail toward the inside of the turn;
   * - a hovering fish balances with a slow, small sway;
   * - heading left mirrors the fish instead of rotating it upside down.
   */
  private animateFish(view: FishView, fish: FishRenderModel, dt: number): void {
    const heading = fish.rotation;
    const cosH = Math.cos(heading);
    const sinH = Math.sin(heading);
    if (cosH > 0.2) view.facingTarget = 1;
    else if (cosH < -0.2) view.facingTarget = -1;
    const facingSign = view.facingTarget;
    const targetPitch = clamp(facingSign > 0 ? Math.atan2(sinH, cosH) : Math.atan2(-sinH, -cosH), -MAX_PITCH, MAX_PITCH);
    view.pitch += wrapAngle(targetPitch - view.pitch) * (1 - Math.exp(-10 * dt));
    view.facing += (facingSign - view.facing) * (1 - Math.exp(-14 * dt));
    view.swim.scale.x = view.facing;
    view.swim.rotation = view.pitch;

    const bodyScale = Math.max(0.2, fish.size);
    const combatScale = fish.combatFeedback === "attack" ? 1.16 : fish.combatFeedback === "hurt" ? 0.86 : 1;
    const bs = bodyScale * combatScale;

    const effort = clamp(fish.strokePulse, 0, 1);
    const hovering = fish.hovering;
    const beatHz = hovering ? 1.1 : 0.9 + effort * 4.2;
    view.tailPhase = (view.tailPhase + dt * TWO_PI * beatHz) % TWO_PI;
    view.swayPhase = (view.swayPhase + dt * 2.1) % TWO_PI;

    const beatAmplitude = hovering ? 0.07 : 0.07 + effort * 0.42;
    const wave = Math.sin(view.tailPhase);
    // Tail trails the turn; the local frame is mirrored when facing left.
    const turnBend = clamp(-fish.turnVelocity * 0.12 * facingSign, -0.35, 0.35);
    const tailAngle = wave * beatAmplitude + turnBend;

    const sway = Math.sin(view.swayPhase);
    const lateral = (hovering ? 0.9 : 0.25 + effort * 0.8) * bs * Math.sin(view.tailPhase + 1.2) * (hovering ? 0.5 : 1)
      + (hovering ? sway * 0.9 * bs : sway * 0.2 * bs);
    view.tail.position.set(view.tailJointX * bs, lateral);
    view.tail.rotation = tailAngle;
    view.tail.scale.set(bs * (1 - 0.12 * Math.abs(wave) * Math.min(1, beatAmplitude * 2)), bs);

    view.body.position.set(0, lateral);
    view.body.rotation = -tailAngle * 0.3 + (hovering ? Math.sin(view.swayPhase * 0.8 + 1) * 0.035 : 0);
    view.body.scale.set(bs, bs * (1 + Math.sin(view.swayPhase * 1.7) * 0.02));
  }

  private drawFishTail(tail: Graphics, speciesId: FishSpeciesId): void {
    const species = getFishSpeciesDefinition(speciesId);
    tail.clear();
    // The tail swings about the body/tail joint, not about the fish center.
    tail.pivot.set(-species.bodyLength * 0.66, 0);
    tail.moveTo(-species.bodyLength * 0.66, 0)
      .lineTo(-species.bodyLength - species.tailLength, -species.bodyHeight * 0.92)
      .quadraticCurveTo(-species.bodyLength - species.tailLength * 0.68, 0, -species.bodyLength - species.tailLength, species.bodyHeight * 0.92)
      .closePath()
      .fill({ color: species.finColor })
      .stroke({ color: "#d9f8ff", alpha: 0.36, width: 0.8 });
    tail.moveTo(-species.bodyLength * 0.72, 0).lineTo(-species.bodyLength - species.tailLength * 0.84, 0)
      .stroke({ color: species.accentColor, alpha: 0.75, width: 0.8 });
  }

  private drawFishBody(body: Graphics, speciesId: FishSpeciesId): void {
    const species = getFishSpeciesDefinition(speciesId);
    const length = species.bodyLength;
    const height = species.bodyHeight;
    body.clear();

    // Top fin and lower fin silhouettes.
    body.moveTo(-length * 0.48, -height * 0.36).lineTo(-length * 0.12, -height * 1.12)
      .lineTo(length * 0.24, -height * 0.72).lineTo(length * 0.5, -height * 0.42).closePath()
      .fill({ color: species.finColor }).stroke({ color: "#d7faff", alpha: 0.42, width: 0.8 });
    body.moveTo(-length * 0.18, height * 0.48).lineTo(length * 0.1, height * 1.04)
      .lineTo(length * 0.34, height * 0.56).closePath().fill({ color: species.finColor, alpha: 0.9 });
    body.ellipse(0, 0, length, height)
      .fill({ color: species.bodyColor })
      .stroke({ color: "#c7f4ff", alpha: 0.78, width: 1.15 });

    // Pale underside gives the body volume instead of a flat colored oval.
    body.ellipse(length * 0.02, height * 0.38, length * 0.69, height * 0.46)
      .fill({ color: species.accentColor, alpha: 0.72 });
    body.ellipse(-length * 0.12, -height * 0.34, length * 0.53, height * 0.19)
      .fill({ color: "#ffffff", alpha: 0.28 });

    if (species.pattern === "stripe") {
      for (const x of [-0.24, 0.12, 0.42]) {
        body.moveTo(length * x, -height * 0.78).quadraticCurveTo(length * (x - 0.08), 0, length * x, height * 0.76)
          .stroke({ color: species.accentColor, alpha: 0.94, width: Math.max(1.2, height * 0.19) });
      }
    } else if (species.pattern === "spots") {
      for (const [x, y, r] of [[-0.35, -0.12, 0.13], [-0.08, 0.18, 0.1], [0.2, -0.2, 0.12], [0.42, 0.16, 0.08]] as const) {
        body.circle(length * x, height * y, Math.max(1, height * r)).fill(species.accentColor);
      }
    } else if (species.pattern === "mask") {
      body.ellipse(length * 0.48, 0, Math.max(2, height * 0.15), height * 0.9).fill(species.accentColor);
    } else if (species.pattern === "glow") {
      body.ellipse(0, 0, length * 0.62, height * 0.27).fill({ color: species.accentColor, alpha: 0.78 });
    }

    // Gill arc, pectoral fin, and a subtle lateral line.
    body.moveTo(length * 0.34, -height * 0.58).quadraticCurveTo(length * 0.12, 0, length * 0.34, height * 0.57)
      .stroke({ color: "#062b39", alpha: 0.58, width: 1 });
    body.moveTo(-length * 0.06, height * 0.04).lineTo(length * 0.23, height * 0.65).lineTo(length * 0.34, height * 0.16)
      .closePath().fill({ color: species.finColor, alpha: 0.72 });
    body.moveTo(-length * 0.48, -height * 0.08).quadraticCurveTo(0, -height * 0.2, length * 0.42, -height * 0.03)
      .stroke({ color: "#ffffff", alpha: 0.24, width: 0.7 });

    body.circle(length * 0.59, -height * 0.19, Math.max(1.3, species.eyeSize + 1.1))
      .fill("#effdff").stroke({ color: "#042532", width: 0.8 });
    body.circle(length * 0.61, -height * 0.19, Math.max(0.8, species.eyeSize * 0.72)).fill("#031721");
    body.circle(length * 0.63, -height * 0.25, Math.max(0.45, species.eyeSize * 0.28)).fill("#ffffff");
    body.moveTo(length * 0.82, height * 0.08).lineTo(length * 0.91, height * 0.12)
      .stroke({ color: "#072c36", alpha: 0.72, width: 0.7 });
  }

  private createFishView(fish: FishRenderModel): FishView {
    const root = new Container();
    const swim = new Container();
    const shadow = new Graphics().ellipse(0, 3, 18, 6).fill({ color: 0x001521, alpha: 0.28 });
    const tail = new Graphics();
    const body = new Graphics();
    this.drawFishTail(tail, fish.species);
    this.drawFishBody(body, fish.species);
    const label = new Text({ text: `${fish.nickname} · ❤️ ${fish.hp}`, style: this.labelStyle });
    label.anchor.set(0.5, 0);
    const comment = new Text({ text: "", style: this.commentStyle });
    comment.anchor.set(0.5, 1);
    comment.alpha = 0;
    swim.addChild(shadow, tail, body);
    root.addChild(swim, label, comment);
    this.root.addChild(root);
    this.root.addChild(this.damageLayer);
    const facingTarget: 1 | -1 = Math.cos(fish.rotation) < 0 ? -1 : 1;
    const view: FishView = {
      root, swim, shadow, tail, body, label, comment,
      commentUntilMs: 0,
      lastLabel: label.text,
      lastFeedback: null,
      lastCombatFeedback: null,
      lastSpecies: fish.species,
      lastDamageSeq: 0,
      tailJointX: -getFishSpeciesDefinition(fish.species).bodyLength * 0.66,
      tailPhase: Math.random() * TWO_PI,
      swayPhase: Math.random() * TWO_PI,
      facing: facingTarget,
      facingTarget,
      pitch: clamp(facingTarget > 0 ? fish.rotation : Math.atan2(-Math.sin(fish.rotation), -Math.cos(fish.rotation)), -MAX_PITCH, MAX_PITCH)
    };
    this.fishViews.set(fish.id, view);
    return view;
  }

  private createJellyfishView(size: number): JellyfishView {
    const root = new Container();
    const shadow = new Graphics().ellipse(0, size * 0.85, size * 1.1, size * 0.35).fill({ color: 0x06172e, alpha: 0.22 });
    const tentacles = new Graphics();
    for (let i = -2; i <= 2; i++) {
      const x = i * size * 0.32;
      tentacles.moveTo(x, size * 0.22)
        .bezierCurveTo(x - size * 0.55, size * 0.62, x + size * 0.48, size * 0.85, x + Math.sin(i + 1) * size * 0.35, size * 1.35)
        .stroke({ color: i % 2 ? 0x9cecff : 0xd7c5ff, alpha: 0.82, width: Math.max(0.7, size * 0.075), cap: "round" });
    }
    const bell = new Graphics()
      .ellipse(0, 0, size, size * 0.62).fill({ color: 0x9b7bff, alpha: 0.18 })
      .ellipse(0, -size * 0.08, size * 0.88, size * 0.56).fill({ color: 0x9b7bff, alpha: 0.88 })
      .ellipse(0, -size * 0.2, size * 0.62, size * 0.27).fill({ color: 0xf3eaff, alpha: 0.42 })
      .ellipse(-size * 0.22, -size * 0.24, size * 0.19, size * 0.1).fill({ color: "#ffffff", alpha: 0.62 })
      .moveTo(-size * 0.82, size * 0.16).quadraticCurveTo(0, size * 0.56, size * 0.82, size * 0.16)
      .stroke({ color: 0xf0e8ff, alpha: 0.9, width: Math.max(0.8, size * 0.09) });
    root.addChild(shadow, tentacles, bell);
    return { root, bell, tentacles, phase: Math.random() * Math.PI * 2 };
  }
}
