"use client";

import { useEffect, useRef, useState } from "react";

interface SyncStatus {
  status: "syncing" | "ready" | "error";
  pagesDone: number;
  totalPages: number;
  totalScrobbles: number;
  newestUts: number | null;
  oldestUts: number | null;
  error: string | null;
}

const QUIPS = [
  "Mercury has never once hurried.",
  "Aligning your chakras with your play counts…",
  "Asking the moon if she remembers 2014…",
  "Counting scrobbles the old way, on an astrolabe…",
  "Your top artist already knows what you did…",
  "Consulting a very slow oracle (the Last.fm API)…",
  "Every planet you see is a year of your life. No pressure.",
  "Retrogrades located. Regrets pending…",
  "The stars are unionized and take mandated breaks.",
  "Somewhere in here is a song you played 400 times…",
  "Astronomers hate this one weird listener…",
  "Do not be alarmed if planets collide. It's aesthetic.",
];

/**
 * The "consulting the ephemeris" experience. Each year of history pulled adds
 * a planet to the system on its own elliptical orbit. Planets that collide
 * explode (as requested) and the survivor grows. The wait is the show.
 */
export function SyncScreen({ username, sync }: { username: string; sync: SyncStatus | null }) {
  const progress =
    sync && sync.totalPages > 0 ? Math.min(1, sync.pagesDone / sync.totalPages) : 0;
  const fetched = sync ? Math.min(sync.pagesDone * 200, sync.totalScrobbles) : 0;

  // How many years of history have we reached back through?
  const newestYear = sync?.newestUts ? new Date(sync.newestUts * 1000).getUTCFullYear() : null;
  const oldestYear = sync?.oldestUts ? new Date(sync.oldestUts * 1000).getUTCFullYear() : null;
  const yearsLoaded = newestYear && oldestYear ? newestYear - oldestYear + 1 : 1;

  const [quip, setQuip] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setQuip((q) => (q + 1) % QUIPS.length), 4200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex flex-col items-center text-center py-10">
      <PlanetarySystem planetCount={Math.min(yearsLoaded, 22)} />

      <h1 className="font-display text-3xl text-gold mb-2 mt-2">
        Consulting the ephemeris&hellip;
      </h1>
      <p className="text-ink-2 mb-2 max-w-md">
        Pulling {username}&rsquo;s listening history from Last.fm; every planet is a
        year of your life we&rsquo;ve recovered so far.
      </p>
      <p className="text-ink-3 text-sm italic mb-8 h-5" key={quip}>
        {QUIPS[quip]}
      </p>

      <div className="w-full max-w-sm">
        <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div
            className="h-full rounded-full bg-gold transition-all duration-500"
            style={{ width: `${Math.max(2, progress * 100)}%` }}
          />
        </div>
        <p className="text-ink-3 text-xs mt-3 tabular">
          {sync && sync.totalPages > 0 ? (
            <>
              {fetched.toLocaleString()} of {sync.totalScrobbles.toLocaleString()} scrobbles
              {oldestYear ? <> &middot; reaching back to {oldestYear}&hellip;</> : null}
            </>
          ) : (
            <>locating {username} in the heavens&hellip;</>
          )}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface Planet {
  a: number; // semi-major axis
  b: number; // semi-minor axis
  tilt: number; // orbit rotation
  phase: number;
  speed: number; // radians/sec
  r: number; // body radius
  color: string;
  born: number; // ms timestamp, for pop-in scale
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // 1 -> 0
  color: string;
  size: number;
}

const PLANET_COLORS = [
  "#7487ea", "#d55181", "#199e70", "#c98500", "#d95926",
  "#9085e9", "#3987e5", "#e87ba4", "#1baf7a", "#ab8410",
];

function PlanetarySystem({ planetCount }: { planetCount: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const planetsRef = useRef<Planet[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const countRef = useRef(planetCount);
  useEffect(() => {
    countRef.current = planetCount;
  }, [planetCount]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const SIZE = 340;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    ctx.scale(dpr, dpr);
    const cx = SIZE / 2;
    const cy = SIZE / 2;

    const spawnPlanet = (): Planet => {
      const n = planetsRef.current.length;
      const a = 30 + n * 9 + Math.random() * 7;
      return {
        a,
        b: a * (0.55 + Math.random() * 0.4), // properly oval
        tilt: Math.random() * Math.PI,
        phase: Math.random() * Math.PI * 2,
        speed: (0.55 + Math.random() * 0.9) * (Math.random() < 0.12 ? -1 : 1),
        r: 2.5 + Math.random() * 3.5,
        color: PLANET_COLORS[n % PLANET_COLORS.length],
        born: performance.now(),
      };
    };

    const explode = (x: number, y: number, color: string, size: number) => {
      const count = 14 + Math.floor(Math.random() * 10);
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
        const speed = 14 + Math.random() * 50;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          color: Math.random() < 0.35 ? "#d4af37" : color,
          size: 0.8 + Math.random() * (size * 0.5),
        });
      }
    };

    const pos = (p: Planet, t: number) => {
      const angle = p.phase + p.speed * t;
      const ex = Math.cos(angle) * p.a;
      const ey = Math.sin(angle) * p.b;
      return {
        x: cx + ex * Math.cos(p.tilt) - ey * Math.sin(p.tilt),
        y: cy + ex * Math.sin(p.tilt) + ey * Math.cos(p.tilt),
      };
    };

    let raf = 0;
    let last = performance.now();
    let t = 0;
    let lastSpawn = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;

      // Grow the system toward the target count, one planet at a time.
      if (now - lastSpawn > 350 && planetsRef.current.length < countRef.current) {
        planetsRef.current.push(spawnPlanet());
        lastSpawn = now;
      }

      ctx.clearRect(0, 0, SIZE, SIZE);

      // Orbit paths
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(212, 175, 55, 0.14)";
      for (const p of planetsRef.current) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, p.a, p.b, p.tilt, 0, Math.PI * 2);
        ctx.stroke();
      }

      // The sun (that's you)
      const pulse = 1 + Math.sin(t * 2.2) * 0.08;
      ctx.beginPath();
      ctx.fillStyle = "#d4af37";
      ctx.shadowColor = "#d4af37";
      ctx.shadowBlur = 18;
      ctx.arc(cx, cy, 7.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Planets
      const positions: { x: number; y: number }[] = [];
      for (const p of planetsRef.current) {
        const { x, y } = pos(p, t);
        positions.push({ x, y });
        // Clamp: rAF timestamps come from a different point in the frame than
        // performance.now(), so (now - born) can be slightly negative.
        const age = Math.min(1, Math.max(0, (now - p.born) / 450));
        const scale = 1 - Math.pow(1 - age, 3); // pop in
        const radius = Math.max(0.01, p.r * scale);
        ctx.beginPath();
        ctx.fillStyle = p.color;
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Collisions (as requested: they explode)
      outer: for (let i = 0; i < planetsRef.current.length; i++) {
        for (let j = i + 1; j < planetsRef.current.length; j++) {
          const a = planetsRef.current[i];
          const b = planetsRef.current[j];
          const dx = positions[i].x - positions[j].x;
          const dy = positions[i].y - positions[j].y;
          if (dx * dx + dy * dy < (a.r + b.r) * (a.r + b.r)) {
            const smaller = a.r < b.r ? i : j;
            const survivor = smaller === i ? j : i;
            const { x, y } = positions[smaller];
            explode(x, y, planetsRef.current[smaller].color, planetsRef.current[smaller].r);
            // The survivor gets a little bigger. Space is metal.
            planetsRef.current[survivor].r += 0.6;
            planetsRef.current.splice(smaller, 1);
            positions.splice(smaller, 1);
            break outer; // at most one collision per frame; plenty
          }
        }
      }

      // Debris
      particlesRef.current = particlesRef.current.filter((pt) => pt.life > 0);
      for (const pt of particlesRef.current) {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= 0.985;
        pt.vy *= 0.985;
        pt.life -= dt * 1.4;
        ctx.globalAlpha = Math.max(0, pt.life);
        ctx.beginPath();
        ctx.fillStyle = pt.color;
        ctx.arc(pt.x, pt.y, Math.max(0.01, pt.size * pt.life), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: 340, height: 340 }}
      aria-label="Your listening history forming a solar system"
      role="img"
    />
  );
}
