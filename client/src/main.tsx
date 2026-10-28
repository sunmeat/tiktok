import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Application, Container, Graphics, Text, TextStyle } from "pixi.js";
import type { ArenaPlayer, GiftAlert, NormalizedGameEvent, ServerMessage } from "@tiktok-arena/shared";
import { AquaLifeScene } from "./aqualife/AquaLifeScene.js";
import "./styles.css";

const fallback = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%2317283b'/%3E%3Ccircle cx='32' cy='24' r='12' fill='%2362e6ff' opacity='.7'/%3E%3Cpath d='M10 60c1-15 10-22 22-22s21 7 22 22' fill='%2362e6ff' opacity='.7'/%3E%3C/svg%3E";

function Arena() {
  const [players, setPlayers] = useState<ArenaPlayer[]>([]);
  const [gift, setGift] = useState<GiftAlert | null>(null);
  const [username, setUsername] = useState("playing_in.chat");
  const aquaEventsRef = useRef<NormalizedGameEvent[]>([]);
  const handler = useRef<(message: ServerMessage) => void>(() => {});
  handler.current = message => {
    if (message.type === "init" || message.type === "update_leaderboard") setPlayers(message.data);
    if (message.type === "gift_alert") setGift(message.data);
    if (message.type === "aqualife_event") {
      aquaEventsRef.current.push(message.data);
      if (aquaEventsRef.current.length > 2000) aquaEventsRef.current.splice(0, aquaEventsRef.current.length - 2000);
    }
    if (message.type === "connection_status") {
      setUsername(message.data.username);
    }
  };

  useEffect(() => {
    let socket: WebSocket | undefined;
    let timer = 0;
    let delay = 1000;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      // Local development must always use the local backend, not a stale deployment URL from .env.
      const url = import.meta.env.DEV
        ? "ws://127.0.0.1:3000"
        : (import.meta.env.VITE_WS_URL as string | undefined) ||
          `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
      socket = new WebSocket(url);
      socket.onopen = () => { delay = 1000; };
      socket.onmessage = event => {
        try { handler.current(JSON.parse(event.data) as ServerMessage); } catch {}
      };
      socket.onclose = () => {
        if (!disposed) { timer = window.setTimeout(connect, delay); delay = Math.min(15000, delay * 2); }
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { disposed = true; window.clearTimeout(timer); socket?.close(); };
  }, []);

  const ranked = useMemo(() => [...players].sort((a, b) => b.gifts - a.gifts || b.likes - a.likes).slice(0, 8), [players]);

  return <main className="arena">
    <PixiEffects gift={gift} />
    <section className="aquarium-panel" aria-label="AquaLife underwater scene">
      <div className="sea-stage">
      <AquaLifeScene eventsRef={aquaEventsRef} />
      <aside className="aquarium-guide overlay-panel" aria-label="How to play">
        <div className="guide-title">HOW TO PLAY</div>
        <ul>
          <li><b>Likes</b><span>Swim faster</span></li>
          <li><b>5 likes</b><span>+1 HP</span></li>
          <li><b>100 likes</b><span>Grow 1%</span></li>
          <li><b>Gifts</b><span>More power</span></li>
        </ul>
      </aside>
    <aside className="leaderboard overlay-panel" aria-label="Viewer leaderboard">
      <header className="leaderboard-head"><strong>🏆 LEADERBOARD</strong><span className="online-count"><i />{players.length.toLocaleString("en-US")} ONLINE</span></header>
      <div className="rank-caption">@{username}</div>
      <div className="players-list">
        {!ranked.length && <div className="empty">Waiting for viewers…</div>}
        {ranked.map((player,index) => <article className={`player-card rank-${index+1}`} key={player.uniqueId}>
          <div className="rank">{String(index+1).padStart(2,"0")}</div>
          <Avatar src={player.profilePictureUrl} className="player-avatar" />
          <div className="player-main">
            <div className="player-topline"><span className="player-name" title={player.nickname}>{player.nickname}</span><span className={`follow-badge ${player.isFollowing ? "" : "no"}`}>{player.isFollowing ? "✓ FOLLOW" : "NOT FOLLOWING"}</span></div>
            <div className="stats"><span>🎁 <b>{player.gifts.toLocaleString("en-US")}</b></span><span>♥ <b>{player.likes.toLocaleString("en-US")}</b></span></div>
          </div>
        </article>)}
      </div>
    </aside>
      </div>
    </section>
  </main>;
}

function Avatar({src,className}:{src:string;className:string}) {
  return <img className={className} src={src || fallback} alt="" onError={event => {event.currentTarget.onerror=null;event.currentTarget.src=fallback;}} />;
}

function PixiEffects({gift}:{gift:GiftAlert|null}) {
  const host = useRef<HTMLDivElement>(null);
  const giftRef = useRef(gift);
  giftRef.current = gift;
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let app: Application | undefined;
    let disposed = false;
    let lastGiftId = "";
    const particles: Array<{shape:Graphics;vx:number;vy:number;life:number}> = [];
    const start = async () => {
      const pixi = new Application();
      await pixi.init({backgroundAlpha:0,antialias:true,autoDensity:true,resolution:Math.min(window.devicePixelRatio || 1,2),resizeTo:element});
      if (disposed) { pixi.destroy({ removeView: true }); return; }
      app = pixi;
      element.appendChild(pixi.canvas);
      const layer = new Container();
      pixi.stage.addChild(layer);
      pixi.ticker.add(ticker => {
        const current = giftRef.current;
        const id = current ? `${current.uniqueId}:${current.giftName}:${current.count}` : "";
        if (current && id !== lastGiftId) {
          lastGiftId = id;
          const label = new Text({text:`✦ ${current.nickname} · ${current.giftName} ×${current.count}`,style:new TextStyle({fill:"#dffaff",fontFamily:"Arial",fontSize:18,fontWeight:"700",dropShadow:{color:"#438bff",blur:8,distance:0}})});
          label.anchor.set(.5);
          label.x = pixi.screen.width / 2;
          label.y = pixi.screen.height * .78;
          layer.addChild(label);
          window.setTimeout(() => { if (!label.destroyed) label.destroy(); }, 2800);
          for(let i=0;i<Math.min(42,12+current.count*2);i++){
            const shape = new Graphics().circle(0,0,2+Math.random()*4).fill(i%3===0 ? "#ffd47a" : "#62e6ff");
            shape.x=pixi.screen.width/2; shape.y=pixi.screen.height*.78; layer.addChild(shape);
            particles.push({shape,vx:(Math.random()-.5)*7,vy:-2-Math.random()*6,life:85});
          }
        }
        for(let i=particles.length-1;i>=0;i--){
          const p=particles[i]; p.shape.x+=p.vx*ticker.deltaTime; p.shape.y+=p.vy*ticker.deltaTime;
          p.shape.alpha=Math.max(0,p.life/85); p.life-=ticker.deltaTime;
          if(p.life<=0){p.shape.destroy();particles.splice(i,1);}
        }
      });
    };
    void start();
    return () => {disposed=true;particles.length=0;app?.destroy({ removeView: true }, { children: true });};
  },[]);
  return <div className="pixi-effects" ref={host} aria-hidden="true" />;
}

createRoot(document.getElementById("root")!).render(<Arena />);
