import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { getFishSpeciesDefinition } from "@tiktok-arena/shared";
import type { AquaLifeRenderSnapshot, FishRenderModel, FishSpeciesId } from "@tiktok-arena/shared";

interface FishView {
  root: Container;
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
  phase: number;
}

interface JellyfishView {
  root: Container;
  bell: Graphics;
  tentacles: Graphics;
  phase: number;
}

/** Reusable PixiJS display objects. Simulation owns all gameplay state. */
export class AquaLifePixiAdapter {
  readonly root = new Container();
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
  }

  update(snapshot: AquaLifeRenderSnapshot, viewportWidth: number, viewportHeight: number): void {
    const scale = Math.min(viewportWidth / Math.max(1, snapshot.world.width), viewportHeight / Math.max(1, snapshot.world.height));
    this.root.scale.set(scale);
    this.root.position.set((viewportWidth - snapshot.world.width * scale) / 2, (viewportHeight - snapshot.world.height * scale) / 2);

    const seen = new Set<string>();
    for (const fish of snapshot.fish) {
      seen.add(fish.id);
      const view = this.fishViews.get(fish.id) ?? this.createFishView(fish);
      view.root.position.set(fish.x, fish.y);
      view.root.rotation = fish.rotation;
      view.label.rotation = -fish.rotation;
      view.phase += 0.12 + Math.min(0.14, fish.size * 0.012);
      view.tail.scale.x = 0.82 + Math.sin(view.phase) * 0.22;
      view.tail.rotation = Math.sin(view.phase) * 0.18;
      view.body.scale.y = 0.97 + Math.sin(view.phase * 0.72) * 0.035;
      if (view.lastSpecies !== fish.species) {
        this.drawFishBody(view.body, fish.species);
        this.drawFishTail(view.tail, fish.species);
        view.body.tint = 0xffffff;
        view.lastFeedback = null;
        view.lastCombatFeedback = null;
        view.lastSpecies = fish.species;
      }
      const bodyScale = Math.max(0.2, fish.size);
      const combatScale = fish.combatFeedback === "attack" ? 1.16 : fish.combatFeedback === "hurt" ? 0.86 : 1;
      view.body.scale.set(bodyScale * combatScale, (0.97 + Math.sin(view.phase * 0.72) * 0.035) * bodyScale * combatScale);
      view.tail.scale.set((0.82 + Math.sin(view.phase) * 0.22) * bodyScale, bodyScale);
      view.tail.rotation = Math.sin(view.phase) * 0.18;
      view.shadow.scale.set(bodyScale, bodyScale);
      const label = `${fish.nickname} · HP ${fish.hp} · ATK ${fish.attackDamage}`;
      if (label !== view.lastLabel) {
        view.label.text = label;
        view.lastLabel = label;
      }
      view.label.position.set(0, 20 * bodyScale);
      view.comment.rotation = -fish.rotation;
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
      view.root.alpha = fish.status === "dead" ? 0 : fish.alpha;
    }

    for (const [id, view] of this.fishViews) {
      if (seen.has(id)) continue;
      view.root.destroy({ children: true });
      this.fishViews.delete(id);
    }

    const seenJellyfish = new Set<string>();
    for (const jellyfish of snapshot.jellyfish) {
      seenJellyfish.add(jellyfish.id);
      let view = this.jellyfishViews.get(jellyfish.id);
      if (!view) {
        view = this.createJellyfishView(jellyfish.size);
        this.root.addChild(view.root);
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

  private drawFishTail(tail: Graphics, speciesId: FishSpeciesId): void {
    const species = getFishSpeciesDefinition(speciesId);
    tail.clear();
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
    const shadow = new Graphics().ellipse(0, 3, 18, 6).fill({ color: 0x001521, alpha: 0.28 });
    const tail = new Graphics();
    const body = new Graphics();
    this.drawFishTail(tail, fish.species);
    this.drawFishBody(body, fish.species);
    const label = new Text({ text: `${fish.nickname} · HP ${fish.hp} · ATK ${fish.attackDamage}`, style: this.labelStyle });
    label.anchor.set(0.5, 0);
    const comment = new Text({ text: "", style: this.commentStyle });
    comment.anchor.set(0.5, 1);
    comment.alpha = 0;
    root.addChild(shadow, tail, body, label, comment);
    this.root.addChild(root);
    const view: FishView = { root, shadow, tail, body, label, comment, commentUntilMs: 0, lastLabel: label.text, lastFeedback: null, lastCombatFeedback: null, lastSpecies: fish.species, phase: Math.random() * Math.PI * 2 };
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
