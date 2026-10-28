import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { getFishSpeciesDefinition } from "@tiktok-arena/shared";
import type { AquaLifeRenderSnapshot, FishRenderModel, FishSpeciesId } from "@tiktok-arena/shared";

interface FishView {
  root: Container;
  body: Graphics;
  label: Text;
  lastLabel: string;
  lastFeedback: FishRenderModel["rewardFeedback"];
  lastCombatFeedback: FishRenderModel["combatFeedback"];
  lastSpecies: FishSpeciesId;
}

/**
 * Stateful PixiJS view adapter. Simulation owns gameplay data; this class only
 * creates and updates reusable display objects. Call destroy() when the scene ends.
 */
export class AquaLifePixiAdapter {
  readonly root = new Container();
  private readonly fishViews = new Map<string, FishView>();
  private readonly jellyfishViews = new Map<string, Graphics>();
  private readonly labelStyle = new TextStyle({
    fill: "#e8fbff",
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "700",
    stroke: { color: "#05202b", width: 3 }
  });

  constructor(private readonly stage: Container) {
    this.stage.addChild(this.root);
  }

  update(snapshot: AquaLifeRenderSnapshot, viewportWidth: number, viewportHeight: number): void {
    const scale = Math.min(
      viewportWidth / Math.max(1, snapshot.world.width),
      viewportHeight / Math.max(1, snapshot.world.height)
    );
    this.root.scale.set(scale);
    this.root.position.set(
      (viewportWidth - snapshot.world.width * scale) / 2,
      (viewportHeight - snapshot.world.height * scale) / 2
    );

    const seen = new Set<string>();
    for (const fish of snapshot.fish) {
      seen.add(fish.id);
      const view = this.fishViews.get(fish.id) ?? this.createFishView(fish);
      view.root.position.set(fish.x, fish.y);
      view.root.rotation = fish.rotation;
      if (view.lastSpecies !== fish.species) {
        this.drawFishBody(view.body, fish.species);
        view.body.tint = 0xffffff;
        view.lastFeedback = null;
        view.lastCombatFeedback = null;
        view.lastSpecies = fish.species;
      }
      const bodyScale = Math.max(0.2, fish.size);
      const combatScale = fish.combatFeedback === "attack" ? 1.22 : fish.combatFeedback === "hurt" ? 0.82 : 1;
      view.body.scale.set(bodyScale * combatScale);
      const label = `${fish.nickname} · ${fish.hp} HP`;
      if (label !== view.lastLabel) {
        view.label.text = label;
        view.lastLabel = label;
      }
      view.label.position.set(0, 18 * bodyScale);
      if (fish.rewardFeedback !== view.lastFeedback || fish.combatFeedback !== view.lastCombatFeedback) {
        view.body.tint =
          fish.rewardFeedback === "growth" ? 0xffd45c
          : fish.rewardFeedback === "heal" ? 0x68ff9b
          : fish.rewardFeedback === "activity" ? 0x73e8ff
          : fish.combatFeedback === "hurt" ? 0xff6868
          : fish.combatFeedback === "attack" ? 0xff9c52
          : 0xffffff;
        view.lastFeedback = fish.rewardFeedback;
        view.lastCombatFeedback = fish.combatFeedback;
      }
      view.root.alpha = fish.status === "dead" ? 0 : 1;
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
        view = new Graphics()
          .circle(0, 0, Math.max(4, jellyfish.size))
          .fill({ color: 0xb78cff, alpha: 0.85 })
          .moveTo(-jellyfish.size * 0.65, jellyfish.size * 0.45)
          .lineTo(-jellyfish.size * 0.9, jellyfish.size * 1.2)
          .moveTo(0, jellyfish.size * 0.45)
          .lineTo(0, jellyfish.size * 1.25)
          .moveTo(jellyfish.size * 0.65, jellyfish.size * 0.45)
          .lineTo(jellyfish.size * 0.9, jellyfish.size * 1.2)
          .stroke({ color: 0xe6d9ff, width: 2 });
        this.root.addChild(view);
        this.jellyfishViews.set(jellyfish.id, view);
      }
      view.position.set(jellyfish.x, jellyfish.y);
    }
    for (const [id, view] of this.jellyfishViews) {
      if (seenJellyfish.has(id)) continue;
      view.destroy();
      this.jellyfishViews.delete(id);
    }
  }

  destroy(): void {
    for (const view of this.fishViews.values()) view.root.destroy({ children: true });
    this.fishViews.clear();
    for (const view of this.jellyfishViews.values()) view.destroy();
    this.jellyfishViews.clear();
    this.root.destroy({ children: true });
  }

  private drawFishBody(body: Graphics, speciesId: FishSpeciesId): void {
    const species = getFishSpeciesDefinition(speciesId);
    body.clear();
    body
      .poly([species.bodyLength * 0.65, 0, species.bodyLength + species.tailLength, -species.bodyHeight * 0.8, species.bodyLength + species.tailLength, species.bodyHeight * 0.8])
      .fill(species.finColor)
      .ellipse(0, 0, species.bodyLength, species.bodyHeight)
      .fill(species.bodyColor);

    if (species.pattern === "stripe") {
      body.rect(-species.bodyLength * 0.2, -species.bodyHeight * 0.8, 3, species.bodyHeight * 1.6).fill(species.accentColor);
      body.rect(species.bodyLength * 0.25, -species.bodyHeight * 0.8, 3, species.bodyHeight * 1.6).fill(species.accentColor);
    } else if (species.pattern === "spots") {
      body.circle(-species.bodyLength * 0.25, -species.bodyHeight * 0.2, 2.1).fill(species.accentColor);
      body.circle(species.bodyLength * 0.2, species.bodyHeight * 0.25, 1.8).fill(species.accentColor);
      body.circle(species.bodyLength * 0.42, -species.bodyHeight * 0.25, 1.5).fill(species.accentColor);
    } else if (species.pattern === "mask") {
      body.ellipse(species.bodyLength * 0.35, 0, 4, species.bodyHeight * 0.95).fill(species.accentColor);
    } else if (species.pattern === "belly") {
      body.ellipse(0, species.bodyHeight * 0.38, species.bodyLength * 0.58, species.bodyHeight * 0.35).fill(species.accentColor);
    } else if (species.pattern === "glow") {
      body.ellipse(-species.bodyLength * 0.05, 0, species.bodyLength * 0.72, species.bodyHeight * 0.28).fill({ color: species.accentColor, alpha: 0.72 });
    }
    body.poly([-species.bodyLength * 0.2, -species.bodyHeight * 0.65, species.bodyLength * 0.15, -species.bodyHeight * 1.35, species.bodyLength * 0.45, -species.bodyHeight * 0.5]).fill(species.finColor);
    body.circle(species.bodyLength * 0.48, -species.bodyHeight * 0.2, species.eyeSize).fill("#06222b");
  }

  private createFishView(fish: FishRenderModel): FishView {
    const root = new Container();
    const body = new Graphics();
    this.drawFishBody(body, fish.species);
    const label = new Text({ text: `${fish.nickname} · ${fish.hp} HP`, style: this.labelStyle });
    label.anchor.set(0.5, 0);
    root.addChild(body, label);
    this.root.addChild(root);
    const view = { root, body, label, lastLabel: label.text, lastFeedback: null, lastCombatFeedback: null, lastSpecies: fish.species };
    this.fishViews.set(fish.id, view);
    return view;
  }
}
