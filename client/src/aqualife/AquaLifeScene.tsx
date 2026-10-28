import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import {
  AQUALIFE_CONFIG,
  addJellyfish,
  createAquaLifeRenderSnapshot,
  createAquaLifeState,
  processGameEvent,
  stepAquaLife
} from "@tiktok-arena/shared";
import type { NormalizedGameEvent } from "@tiktok-arena/shared";
import { AquaLifePixiAdapter } from "./pixi-adapter.js";

interface AquaLifeSceneProps {
  eventsRef: { current: NormalizedGameEvent[] };
}

const WORLD_WIDTH = 540;
const WORLD_HEIGHT = 960;
const MAX_EVENTS_PER_FRAME = 80;

export function AquaLifeScene({ eventsRef }: AquaLifeSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let app: Application | undefined;
    let adapter: AquaLifePixiAdapter | undefined;
    const state = createAquaLifeState(WORLD_WIDTH, WORLD_HEIGHT);
    const bubbles: Array<{ view: Graphics; speed: number; phase: number }> = [];
    const rng = (seed: number) => {
      let value = seed >>> 0;
      return () => {
        value = (value + 0x6d2b79f5) | 0;
        let n = Math.imul(value ^ (value >>> 15), 1 | value);
        n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
        return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
      };
    };
    const random = rng(0xa91f15);

    const start = async () => {
      const pixi = new Application();
      await pixi.init({
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: host,
        preference: "webgl"
      });
      if (disposed) {
        pixi.destroy({ removeView: true });
        return;
      }
      app = pixi;
      host.appendChild(pixi.canvas);

      const background = new Graphics()
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT)
        .fill({ color: 0x052a43 })
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT * 0.34)
        .fill({ color: 0x0a5471, alpha: 0.34 })
        .ellipse(WORLD_WIDTH * 0.25, WORLD_HEIGHT * 0.12, WORLD_WIDTH * 0.48, WORLD_HEIGHT * 0.18)
        .fill({ color: 0x3ec8d5, alpha: 0.055 })
        .ellipse(WORLD_WIDTH * 0.83, WORLD_HEIGHT * 0.55, WORLD_WIDTH * 0.3, WORLD_HEIGHT * 0.28)
        .fill({ color: 0x1a86a2, alpha: 0.07 })
        .rect(0, WORLD_HEIGHT - 42, WORLD_WIDTH, 42)
        .fill({ color: 0xc6a66a, alpha: 0.9 });
      for (let i = 0; i < 14; i++) {
        const x = (i / 14) * WORLD_WIDTH + random() * 12;
        background.ellipse(x, WORLD_HEIGHT - 40 + random() * 8, 9 + random() * 8, 2 + random() * 2)
          .fill({ color: i % 2 ? 0xf0d49a : 0x8c744e, alpha: 0.48 });
      }
      // Static seabed plants avoid per-frame redraws and keep the decoration budget bounded.
      for (let i = 0; i < 9; i++) {
        const x = 10 + i * 64 + random() * 20;
        const height = 42 + random() * 80;
        const plant = new Graphics().moveTo(x, WORLD_HEIGHT - 38);
        for (let j = 1; j <= 5; j++) {
          plant.lineTo(x + Math.sin(j * 0.65 + i) * (5 + j * 2), WORLD_HEIGHT - 38 - height * j / 5);
        }
        plant.stroke({ color: i % 3 === 0 ? 0x4dd4a1 : 0x168b75, width: 4 + (i % 2), cap: "round", join: "round" });
        background.addChild(plant);
      }
      adapter = new AquaLifePixiAdapter(pixi.stage);
      adapter.root.addChildAt(background, 0);

      for (let i = 0; i < 18; i++) {
        const radius = 1.5 + random() * 2.5;
        const view = new Graphics().circle(0, 0, radius).stroke({ color: 0xb4f5ff, alpha: 0.38, width: 1 });
        view.x = random() * WORLD_WIDTH;
        view.y = random() * WORLD_HEIGHT;
        background.addChild(view);
        bubbles.push({ view, speed: 0.15 + random() * 0.35, phase: random() * Math.PI * 2 });
      }

      for (let i = 0; i < 5; i++) {
        const angle = random() * Math.PI * 2;
        addJellyfish(state, {
          id: `jelly-${i + 1}`,
          x: 45 + random() * (WORLD_WIDTH - 90),
          y: 80 + random() * (WORLD_HEIGHT - 180),
          directionX: Math.cos(angle),
          directionY: Math.sin(angle),
          speedPxPerSecond: 20 + random() * 14,
          size: 8 + random() * 5
        });
      }
      pixi.ticker.add(ticker => {
        const deltaMs = Math.min(100, ticker.deltaMS);
        let processed = 0;
        while (eventsRef.current.length && processed < MAX_EVENTS_PER_FRAME) {
          const event = eventsRef.current.shift();
          if (event) processGameEvent(state, event);
          processed++;
        }
        stepAquaLife(state, deltaMs, state.nowMs + deltaMs, random, AQUALIFE_CONFIG);
        for (const bubble of bubbles) {
          bubble.view.y -= bubble.speed * ticker.deltaTime;
          bubble.view.x += Math.sin(state.nowMs / 1700 + bubble.phase) * 0.06 * ticker.deltaTime;
          if (bubble.view.y < -8) {
            bubble.view.y = WORLD_HEIGHT + 8;
            bubble.view.x = random() * WORLD_WIDTH;
          }
        }
        adapter?.update(createAquaLifeRenderSnapshot(state), pixi.screen.width, pixi.screen.height);
      });
    };

    void start().catch(error => {
      console.error("[aqualife] Unable to initialize Pixi scene:", error);
    });

    return () => {
      disposed = true;
      if (app && adapter) adapter.destroy();
      app?.destroy({ removeView: true }, { children: true });
      bubbles.length = 0;
    };
  }, [eventsRef]);

  return <div className="aquarium-canvas" ref={hostRef} aria-label="AquaLife aquarium" />;
}
