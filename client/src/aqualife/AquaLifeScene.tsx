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
    const pendingComments: Array<{ fishId: string; message: string }> = [];
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

      // Layered reef environment: deep-water gradient, sun shafts, caustics, rocks,
      // coral, sea grass and sand ripples. All scenery is static and drawn once.
      const background = new Graphics()
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x03253a })
        .rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT * 0.42).fill({ color: 0x0a5875, alpha: 0.46 })
        .rect(0, WORLD_HEIGHT * 0.38, WORLD_WIDTH, WORLD_HEIGHT * 0.62).fill({ color: 0x031b30, alpha: 0.42 });

      // Soft shafts of sunlight near the surface.
      for (let i = 0; i < 7; i++) {
        const x = 18 + i * 82;
        background.moveTo(x, 0).lineTo(x + 26 + random() * 18, 0)
          .lineTo(x + 158 + random() * 24, WORLD_HEIGHT * 0.62)
          .lineTo(x + 105, WORLD_HEIGHT * 0.62).closePath()
          .fill({ color: 0x67e5ee, alpha: 0.025 + random() * 0.025 });
      }
      // Large diffuse caustic pools and depth haze.
      for (let i = 0; i < 11; i++) {
        const x = random() * WORLD_WIDTH;
        const y = 60 + random() * WORLD_HEIGHT * 0.7;
        background.ellipse(x, y, 24 + random() * 48, 7 + random() * 15)
          .fill({ color: i % 2 ? 0x45cbd1 : 0x3a9fae, alpha: 0.025 + random() * 0.025 });
      }

      // A sloping sandy seabed with a dark contact shadow and warm shallow sand.
      background.moveTo(0, WORLD_HEIGHT - 76)
        .quadraticCurveTo(WORLD_WIDTH * 0.22, WORLD_HEIGHT - 96, WORLD_WIDTH * 0.48, WORLD_HEIGHT - 72)
        .quadraticCurveTo(WORLD_WIDTH * 0.78, WORLD_HEIGHT - 42, WORLD_WIDTH, WORLD_HEIGHT - 82)
        .lineTo(WORLD_WIDTH, WORLD_HEIGHT).lineTo(0, WORLD_HEIGHT).closePath()
        .fill({ color: 0x8c795d, alpha: 0.28 });
      background.moveTo(0, WORLD_HEIGHT - 62)
        .quadraticCurveTo(WORLD_WIDTH * 0.25, WORLD_HEIGHT - 83, WORLD_WIDTH * 0.5, WORLD_HEIGHT - 58)
        .quadraticCurveTo(WORLD_WIDTH * 0.76, WORLD_HEIGHT - 31, WORLD_WIDTH, WORLD_HEIGHT - 67)
        .lineTo(WORLD_WIDTH, WORLD_HEIGHT).lineTo(0, WORLD_HEIGHT).closePath()
        .fill({ color: 0xd0b27a });
      background.moveTo(0, WORLD_HEIGHT - 59)
        .quadraticCurveTo(WORLD_WIDTH * 0.25, WORLD_HEIGHT - 80, WORLD_WIDTH * 0.5, WORLD_HEIGHT - 55)
        .quadraticCurveTo(WORLD_WIDTH * 0.76, WORLD_HEIGHT - 28, WORLD_WIDTH, WORLD_HEIGHT - 64)
        .stroke({ color: 0xf0dba2, alpha: 0.78, width: 2 });

      // Fine sand ripples, shell fragments and small stones.
      for (let i = 0; i < 24; i++) {
        const x = random() * WORLD_WIDTH;
        const y = WORLD_HEIGHT - 54 + random() * 46;
        background.moveTo(x, y).quadraticCurveTo(x + 5 + random() * 9, y - 2, x + 13 + random() * 13, y)
          .stroke({ color: i % 3 === 0 ? 0xf4dfad : 0x79684f, alpha: 0.34 + random() * 0.22, width: 0.7 + random() * 1.2 });
      }
      for (let i = 0; i < 13; i++) {
        const x = random() * WORLD_WIDTH;
        const y = WORLD_HEIGHT - 44 + random() * 32;
        background.ellipse(x, y, 2 + random() * 5, 1.5 + random() * 2.8)
          .fill({ color: i % 2 ? 0xf5e2b3 : 0x665b4e, alpha: 0.65 });
      }

      // Natural reef rocks in irregular silhouettes.
      for (const rock of [
        { x: 18, y: WORLD_HEIGHT - 62, w: 52, h: 27, c: 0x435e61 },
        { x: 472, y: WORLD_HEIGHT - 65, w: 72, h: 34, c: 0x3d5559 },
        { x: 112, y: WORLD_HEIGHT - 55, w: 28, h: 15, c: 0x64746a },
        { x: 376, y: WORLD_HEIGHT - 50, w: 38, h: 20, c: 0x59675f }
      ]) {
        background.moveTo(rock.x - rock.w * 0.5, rock.y)
          .lineTo(rock.x - rock.w * 0.42, rock.y - rock.h * 0.52)
          .lineTo(rock.x - rock.w * 0.08, rock.y - rock.h)
          .lineTo(rock.x + rock.w * 0.27, rock.y - rock.h * 0.78)
          .lineTo(rock.x + rock.w * 0.48, rock.y - rock.h * 0.28)
          .lineTo(rock.x + rock.w * 0.5, rock.y)
          .closePath().fill({ color: rock.c })
          .stroke({ color: 0x9db4a7, alpha: 0.35, width: 1 });
        background.ellipse(rock.x - rock.w * 0.08, rock.y - rock.h * 0.64, rock.w * 0.13, rock.h * 0.08)
          .fill({ color: 0xb2c5ac, alpha: 0.26 });
      }

      // Swaying-looking sea grass silhouettes, plus branching coral fans.
      for (let i = 0; i < 11; i++) {
        const x = 8 + i * 51 + random() * 18;
        const baseY = WORLD_HEIGHT - 58 + random() * 7;
        const height = 34 + random() * 73;
        const color = [0x1d8c7b, 0x36b49b, 0x176e70, 0x5cae88][i % 4];
        for (let blade = -1; blade <= 1; blade++) {
          const bend = blade * (8 + random() * 6);
          background.moveTo(x + blade * 3, baseY)
            .bezierCurveTo(x + bend, baseY - height * 0.25, x + bend * 1.3 + 5, baseY - height * 0.62, x + bend + Math.sin(i + blade) * 6, baseY - height)
            .stroke({ color, alpha: 0.72, width: 2.2 + random() * 1.7, cap: "round" });
        }
      }
      for (const coral of [
        { x: 68, y: WORLD_HEIGHT - 62, h: 49, c: 0xd77a86 },
        { x: 435, y: WORLD_HEIGHT - 66, h: 62, c: 0xd59c74 },
        { x: 300, y: WORLD_HEIGHT - 55, h: 30, c: 0xb978c6 }
      ]) {
        const g = new Graphics();
        g.moveTo(coral.x, coral.y).lineTo(coral.x, coral.y - coral.h * 0.48)
          .lineTo(coral.x - 12, coral.y - coral.h * 0.76)
          .moveTo(coral.x, coral.y - coral.h * 0.48).lineTo(coral.x + 13, coral.y - coral.h * 0.7)
          .moveTo(coral.x - 6, coral.y - coral.h * 0.34).lineTo(coral.x - 17, coral.y - coral.h * 0.5)
          .moveTo(coral.x + 7, coral.y - coral.h * 0.4).lineTo(coral.x + 20, coral.y - coral.h * 0.54)
          .stroke({ color: coral.c, alpha: 0.92, width: 4, cap: "round", join: "round" });
        for (const [dx, dy] of [[0, -0.48], [-12, -0.76], [13, -0.7], [-17, -0.5], [20, -0.54]] as const) {
          g.circle(coral.x + dx, coral.y + coral.h * dy, 3.1).fill({ color: coral.c });
        }
        background.addChild(g);
      }

      // Tiny drifting plankton and bubbles, kept to a fixed count for performance.
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

      for (let i = 0; i < 7; i++) {
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
          if (event) {
            processGameEvent(state, event);
            if (event.type === "chat" && event.comment?.trim()) {
              const fish = state.fish[event.userId];
              if (fish) pendingComments.push({ fishId: fish.id, message: event.comment });
            }
          }
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
        if (adapter && pendingComments.length) {
          for (const comment of pendingComments.splice(0, pendingComments.length)) {
            adapter.showComment(comment.fishId, comment.message, state.nowMs);
          }
        }
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
