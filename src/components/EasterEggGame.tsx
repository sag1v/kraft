import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useUIContext } from '../context/AppContext';

// ── Constants ────────────────────────────────────────────────────────────────
const GAME_W      = 280;  // total playfield width (walls + corridor), centered on canvas
const WALL_W      = 26;
const PLAYER_SIZE = 20;
const PLAYER_Y    = 120;
const OBS_REACH   = 22;
const OBS_MIN_H   = 16;
const OBS_MAX_H   = 40;
const JUMP_FRAMES = 16;
const BASE_SPEED  = 2.2;
const MAX_SPEED   = 8;
const HEAT_DELAY_S = 30;   // seconds before wall heat starts
const HEAT_RAMP_S  = 90;   // seconds from heat=0 to heat=1 after the delay
const JUMP_ARC    = 14;
const ROT_LEFT    = -Math.PI / 2;
const ROT_RIGHT   =  Math.PI / 2;

// Derived from canvas width at runtime
function gameLeft(W: number)  { return Math.round((W - GAME_W) / 2); }
function leftCX(W: number)    { return gameLeft(W) + WALL_W; }
function rightCX(W: number)   { return gameLeft(W) + GAME_W - WALL_W; }

// ── Types ─────────────────────────────────────────────────────────────────────
type Side = 'left' | 'right';

interface Obstacle { side: Side; wy: number; h: number; }

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;
  decay: number;
}

interface ImpactLine {
  x: number; y: number;
  dir: number;   // 1 = right, -1 = left
  len: number;
  life: number;
  decay: number;
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface GS {
  scroll: number;
  speed: number;
  side: Side;
  jumping: boolean;
  fromSide: Side;
  jumpT: number;
  obstacles: Obstacle[];
  nextSpawn: number;
  score: number;
  startTime: number;
  particles: Particle[];
  impactLines: ImpactLine[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

// Heat factor 0→1: flat zero for first HEAT_DELAY_S, then linear ramp over HEAT_RAMP_S
function getHeat(elapsedMs: number): number {
  const delayMs = HEAT_DELAY_S * 1000;
  const rampMs  = HEAT_RAMP_S  * 1000;
  if (elapsedMs < delayMs) return 0;
  return Math.min(1, (elapsedMs - delayMs) / rampMs);
}

// Returns [r, g, b] along a smooth cream→yellow→orange→deep-red ramp
function hotRgb(h: number): [number, number, number] {
  if (h < 0.25) {
    const t = h / 0.25;
    return [255, Math.round(255 - 35 * t), Math.round(200 * (1 - t))]; // cream → yellow
  }
  if (h < 0.55) {
    const t = (h - 0.25) / 0.30;
    return [255, Math.round(220 - 130 * t), Math.round(30 * (1 - t))]; // yellow → orange
  }
  const t = (h - 0.55) / 0.45;
  return [Math.round(255 - 45 * t), Math.round(90 - 75 * t), 0];       // orange → deep red
}

function getPlayerTransform(gs: GS, lCX: number, rCX: number) {
  const arcY = gs.jumping ? -Math.sin(gs.jumpT * Math.PI) * JUMP_ARC : 0;
  const cy   = PLAYER_Y + PLAYER_SIZE / 2 + arcY;
  let cx: number, rot: number;
  const half = PLAYER_SIZE / 2;
  const lPX  = lCX + half;   // player center when hugging left wall
  const rPX  = rCX - half;   // player center when hugging right wall
  if (gs.jumping) {
    const fromCX  = gs.fromSide === 'left' ? lPX      : rPX;
    const toCX    = gs.fromSide === 'left' ? rPX      : lPX;
    const fromRot = gs.fromSide === 'left' ? ROT_LEFT  : ROT_RIGHT;
    const toRot   = gs.fromSide === 'left' ? ROT_RIGHT : ROT_LEFT;
    const e = easeInOut(gs.jumpT);
    cx  = fromCX  + (toCX  - fromCX)  * e;
    rot = fromRot + (toRot - fromRot) * e;
  } else {
    cx  = gs.side === 'left' ? lPX      : rPX;
    rot = gs.side === 'left' ? ROT_LEFT : ROT_RIGHT;
  }
  return { cx, cy, rot };
}

// Collision: Y-only check; X overlap is guaranteed for same-side obstacles
function collides(gs: GS): boolean {
  if (gs.jumping) return false;
  for (const obs of gs.obstacles) {
    if (obs.side !== gs.side) continue;
    const oy = obs.wy - gs.scroll;
    if (PLAYER_Y < oy + obs.h && PLAYER_Y + PLAYER_SIZE > oy) return true;
  }
  return false;
}

function emitImpactLines(gs: GS, wallInnerX: number, side: Side) {
  const dir = side === 'left' ? 1 : -1;
  const cy  = PLAYER_Y + PLAYER_SIZE / 2;
  // 4 lines spread around the contact point
  for (const dy of [-7, -2, 3, 8]) {
    gs.impactLines.push({
      x:     wallInnerX,
      y:     cy + dy,
      dir,
      len:   6 + Math.random() * 10,
      life:  1,
      decay: 0.1 + Math.random() * 0.07,
    });
  }
}

// ── Component ─────────────────────────────────────────────────────────────────
export function EasterEggGame({ onClose }: { onClose: () => void }) {
  const { theme } = useUIContext();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const scoreElRef   = useRef<HTMLSpanElement>(null);
  const timeElRef    = useRef<HTMLSpanElement>(null);
  const wRef = useRef(300);
  const hRef = useRef(480);

  const gsRef = useRef<GS>({
    scroll: 0, speed: BASE_SPEED, side: 'left',
    jumping: false, fromSide: 'left', jumpT: 0,
    obstacles: [], nextSpawn: 0, score: 0,
    startTime: Date.now(),
    particles: [], impactLines: [],
  });

  const [phase, setPhase]           = useState<'idle' | 'countdown' | 'playing' | 'dead'>('idle');
  const [countdownNum, setCountdownNum] = useState(3);
  const [deathScore, setDeathScore] = useState(0);
  const [deathTime,  setDeathTime]  = useState('00:00');
  const [best, setBest]             = useState(0);
  const bestRef          = useRef(0);
  const phaseRef         = useRef<'idle' | 'countdown' | 'playing' | 'dead'>('idle');
  const deathTimestampRef = useRef<number>(0);
  const themeRef         = useRef(theme);

  useEffect(() => { themeRef.current = theme; }, [theme]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Draw ──────────────────────────────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const c    = themeRef.current.colors;
    const gs   = gsRef.current;
    const W    = wRef.current;
    const H    = hRef.current;
    const gx   = gameLeft(W);   // left edge of game area
    const lCX  = leftCX(W);
    const rCX  = rightCX(W);

    const corridorL = gx + WALL_W;
    const corridorW = GAME_W - 2 * WALL_W;

    // Heat factor: 0 for first HEAT_DELAY_S, then ramps to 1 over HEAT_RAMP_S
    const heat = getHeat(Date.now() - gs.startTime);

    // Background
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, H);

    // ── Layer 1 (far): slow dot grid across full canvas ──
    {
      const off = gs.scroll * 0.2 % 50;
      ctx.fillStyle   = c.bgTertiary;
      ctx.globalAlpha = 0.55;
      for (let x = 25; x < W; x += 50) {
        for (let y = -off; y < H + 50; y += 50) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
      ctx.globalAlpha = 1;
    }

    // ── Layer 2 (mid): outer-area depth lines scrolling at 0.5x ──
    {
      const off = gs.scroll * 0.5 % 28;
      ctx.fillStyle   = c.bgTertiary;
      ctx.globalAlpha = 0.5;
      for (let y = -off; y < H + 28; y += 28) {
        // left outer zone — two bands at different distances
        if (gx > 16) ctx.fillRect(gx - 16, y, 10, 1);
        if (gx > 40) ctx.fillRect(gx - 40, y,  6, 1);
        // right outer zone
        ctx.fillRect(gx + GAME_W + 6,  y, 10, 1);
        ctx.fillRect(gx + GAME_W + 34, y,  6, 1);
      }
      ctx.globalAlpha = 1;
    }

    // Walls
    ctx.fillStyle = c.bgTertiary;
    ctx.fillRect(gx, 0, WALL_W, H);
    ctx.fillRect(gx + GAME_W - WALL_W, 0, WALL_W, H);

    // ── Heat tint overlay on walls ──
    // Use heat² so early opacity barely registers and ramps up naturally
    const heatA = heat * heat;
    if (heatA > 0) {
      const [hr, hg, hb] = hotRgb(heat);
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0,    `rgba(${hr}, ${hg}, ${hb}, ${0.20 * heatA})`);
      grad.addColorStop(0.45, `rgba(${hr}, ${hg}, ${hb}, ${0.55 * heatA})`);
      grad.addColorStop(1,    `rgba(${hr}, ${hg}, ${hb}, ${0.30 * heatA})`);
      ctx.fillStyle = grad;
      ctx.fillRect(gx, 0, WALL_W, H);
      ctx.fillRect(gx + GAME_W - WALL_W, 0, WALL_W, H);
    }

    // ── Motion: scrolling stripes on wall faces (1x) ──
    const stripeSpacing = 18;
    const stripeOffset  = gs.scroll % stripeSpacing;
    if (heatA > 0) {
      const [sr, sg, sb] = hotRgb(heat);
      ctx.fillStyle   = `rgb(${sr}, ${sg}, ${sb})`;
      ctx.globalAlpha = 0.35 + heatA * 0.25;
    } else {
      ctx.fillStyle   = c.fgDim;
      ctx.globalAlpha = 0.35;
    }
    for (let y = -stripeOffset; y <= H + stripeSpacing; y += stripeSpacing) {
      ctx.fillRect(gx + 3,                    y, WALL_W - 5, 1);
      ctx.fillRect(gx + GAME_W - WALL_W + 2,  y, WALL_W - 5, 1);
    }
    ctx.globalAlpha = 1;

    // Wall inner edge lines
    if (heatA > 0) {
      const [er, eg, eb] = hotRgb(heat);
      ctx.fillStyle = `rgba(${er}, ${eg}, ${eb}, ${0.3 + heatA * 0.7})`;
    } else {
      ctx.fillStyle = c.border;
    }
    ctx.fillRect(corridorL,          0, 1, H);
    ctx.fillRect(corridorL + corridorW, 0, 1, H);

    // Pre-compute player transform once — used by obstacle tracking and draw
    const { cx, cy, rot } = getPlayerTransform(gs, lCX, rCX);
    const playerCX = cx;
    const playerCY = cy;

    // Obstacles — drawn as spikes (triangles)
    for (const obs of gs.obstacles) {
      const sy  = obs.wy - gs.scroll;
      if (sy > H + 20 || sy + obs.h < 0) continue;
      const mid = sy + obs.h / 2;
      // base x (attached to wall) and tip x (pointing into corridor)
      const baseX = obs.side === 'left' ? gx + WALL_W       : gx + GAME_W - WALL_W;
      const tipX  = obs.side === 'left' ? gx + WALL_W + OBS_REACH : gx + GAME_W - WALL_W - OBS_REACH;
      // Main spike body
      ctx.fillStyle = c.diffRemove;
      ctx.beginPath();
      ctx.moveTo(baseX, sy);
      ctx.lineTo(tipX,  mid);
      ctx.lineTo(baseX, sy + obs.h);
      ctx.closePath();
      ctx.fill();
      // Brighter inner triangle (tip highlight)
      const inset = obs.h * 0.28;
      ctx.fillStyle = c.ansi.brightRed;
      ctx.beginPath();
      ctx.moveTo(baseX, sy + inset);
      ctx.lineTo(tipX,  mid);
      ctx.lineTo(baseX, sy + obs.h - inset);
      ctx.closePath();
      ctx.fill();

      // ── Creature eye ──
      const eyeR   = 3.5;
      const obsEyeX = obs.side === 'left' ? baseX + 6 : baseX - 6;
      const obsEyeY = mid;
      // Blink — desync per obstacle via wy offset
      const obsBlinkCycle = (Date.now() + Math.floor(obs.wy) * 157) % 4500;
      const blinkY = obsBlinkCycle < 160
        ? Math.max(0.05, Math.abs(Math.cos((obsBlinkCycle / 160) * Math.PI)))
        : 1;
      if (blinkY > 0.05) {
        ctx.save();
        ctx.translate(obsEyeX, obsEyeY);
        ctx.scale(1, blinkY);
        // Sclera — light so it pops against the red spike
        ctx.fillStyle = c.fg;
        ctx.beginPath();
        ctx.arc(0, 0, eyeR, 0, Math.PI * 2);
        ctx.fill();
        // Pupil — dark circle tracking player
        const dxP = playerCX - obsEyeX;
        const dyP = playerCY - obsEyeY;
        const dP  = Math.sqrt(dxP * dxP + dyP * dyP) || 1;
        const pX  = (dxP / dP) * 2;
        const pY  = (dyP / dP) * 2;
        ctx.fillStyle = c.bg;
        ctx.beginPath();
        ctx.arc(pX, pY, 2.2, 0, Math.PI * 2);
        ctx.fill();
        // Tiny specular highlight
        ctx.fillStyle = c.fg;
        ctx.beginPath();
        ctx.arc(pX - 0.8, pY - 0.8, 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // Angry eyebrow (tilted inward, hidden while blinking)
      if (blinkY > 0.4) {
        ctx.strokeStyle = c.diffRemove;
        ctx.lineWidth   = 1.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        if (obs.side === 'left') {
          ctx.moveTo(obsEyeX - 3, obsEyeY - eyeR - 3);
          ctx.lineTo(obsEyeX + 3, obsEyeY - eyeR - 1);
        } else {
          ctx.moveTo(obsEyeX + 3, obsEyeY - eyeR - 3);
          ctx.lineTo(obsEyeX - 3, obsEyeY - eyeR - 1);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── Impact lines ──
    for (const l of gs.impactLines) {
      const len = l.len * l.life;
      ctx.globalAlpha = l.life * 0.55;
      ctx.fillStyle   = c.fgMuted;
      ctx.fillRect(l.dir > 0 ? l.x : l.x - len, l.y, len, 1);
    }
    ctx.globalAlpha = 1;

    // Player + sparks — visible during countdown and active game, hidden only on idle
    if (phaseRef.current !== 'idle') {
      const half = PLAYER_SIZE / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      // Body
      ctx.fillStyle = c.accent;
      ctx.fillRect(-half, -half, PLAYER_SIZE, PLAYER_SIZE);

      // Feet — contrasting strip
      ctx.fillStyle = c.accentSecondary;
      ctx.fillRect(-half, half - 5, PLAYER_SIZE, 5);
      if (phaseRef.current === 'dead') {
        // X crossed eyes — cartoon death
        ctx.strokeStyle = c.bg;
        ctx.lineWidth   = 1.5;
        ctx.lineCap     = 'round';
        ctx.beginPath();
        ctx.moveTo(-6, half - 5); ctx.lineTo(-3, half - 2);
        ctx.moveTo(-3, half - 5); ctx.lineTo(-6, half - 2);
        ctx.moveTo( 3, half - 5); ctx.lineTo( 6, half - 2);
        ctx.moveTo( 6, half - 5); ctx.lineTo( 3, half - 2);
        ctx.stroke();
        ctx.lineCap = 'butt';
      } else {
        // Normal blinking eyes — shrink height every ~4s
        const tInCycle = Date.now() % 4200;
        const eyeH = tInCycle < 180
          ? Math.max(0, Math.round(3 * Math.abs(Math.cos((tInCycle / 180) * Math.PI))))
          : 3;
        if (eyeH > 0) {
          ctx.fillStyle = c.bg;
          ctx.fillRect(-5, half - 4, 2, eyeH);
          ctx.fillRect( 3, half - 4, 2, eyeH);
        }
      }

      ctx.restore();

      // ── Friction sparks — drawn on top of Bob ──
      for (const p of gs.particles) {
        const sz = 2 + p.life * 3;
        ctx.globalAlpha = p.life * 0.85;
        ctx.fillStyle   = c.fg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, sz / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // ── Layer 3 (close): fast vertical streaks in corridor ──
    {
      const fgScroll = gs.scroll * 1.8;
      const spc      = 72;
      ctx.fillStyle   = c.fgDim;
      ctx.globalAlpha = 0.18;
      for (let i = 0; i < 4; i++) {
        const sx   = corridorL + (corridorW / 5) * (i + 1);
        const offY = (fgScroll + i * (spc / 4)) % spc;
        for (let y = -offY; y < H + spc; y += spc) {
          ctx.fillRect(sx, y, 1, 9);
        }
      }
      ctx.globalAlpha = 1;
    }
  }, []);

  // ── Resize observer ───────────────────────────────────────────────────────
  useEffect(() => {
    const obs = new ResizeObserver(() => {
      const container = containerRef.current;
      const canvas    = canvasRef.current;
      if (!container || !canvas) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === wRef.current && h === hRef.current) return;
      wRef.current  = w;
      hRef.current  = h;
      canvas.width  = w;
      canvas.height = h;
      drawFrame();
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [drawFrame]);

  useEffect(() => { drawFrame(); }, [theme, phase, drawFrame]);

  // ── Game loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    let rafId: number;

    const tick = () => {
      const gs = gsRef.current;
      const H  = hRef.current;

      gs.scroll += gs.speed;
      gs.speed   = Math.min(gs.speed + 0.0005, MAX_SPEED);
      gs.score   = Math.floor(gs.scroll / 10);

      // Jump animation
      if (gs.jumping) {
        gs.jumpT += 1 / JUMP_FRAMES;
        if (gs.jumpT >= 1) {
          gs.jumping = false;
          gs.jumpT   = 0;
          gs.side    = gs.fromSide === 'left' ? 'right' : 'left';
          // Landing effects
          const W2       = wRef.current;
          const wallInnerX = gs.side === 'left' ? leftCX(W2) : rightCX(W2);
          emitImpactLines(gs, wallInnerX, gs.side);
        }
      }

      // Update impact lines
      for (const l of gs.impactLines) l.life -= l.decay;
      gs.impactLines = gs.impactLines.filter(l => l.life > 0);

      // Friction sparks — trickle from wall contact while grounded
      if (!gs.jumping && Math.random() < 0.55) {
        const W2  = wRef.current;
        const dir   = gs.side === 'left' ? 1 : -1;
        // Emit from wall contact (Bob's back), drift upward + outward
        // Moving opposite to travel direction = friction wake trailing behind him
        const emitX = gs.side === 'left' ? leftCX(W2) : rightCX(W2);
        gs.particles.push({
          x:     emitX + dir * Math.random() * 5,
          y:     PLAYER_Y + Math.random() * PLAYER_SIZE,
          vx:    dir * (0.4 + Math.random() * 0.8),
          vy:    -(gs.speed * 0.35 + 0.5 + Math.random() * 1.2),
          life:  0.5 + Math.random() * 0.3,
          decay: 0.06 + Math.random() * 0.05,
        });
      }

      // Update particles
      for (const p of gs.particles) {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.04;
        p.life -= p.decay;
      }
      gs.particles = gs.particles.filter(p => p.life > 0);

      // Spawn obstacles — difficulty ramps via height and gap variance
      if (gs.scroll + H + 60 > gs.nextSpawn) {
        const diff  = 1 - Math.exp(-gs.score / 180); // 0→1, plateaus ~score 300

        // Obstacles grow taller with difficulty
        const minH = OBS_MIN_H + diff * 12;   // 16 → 28
        const maxH = OBS_MAX_H + diff * 16;   // 40 → 56
        gs.obstacles.push({
          side: Math.random() < 0.5 ? 'left' : 'right',
          wy:   gs.nextSpawn,
          h:    minH + Math.random() * (maxH - minH),
        });

        // Safe minimum gap = enough time to react after a full jump completes.
        // Grows with speed so reaction window stays roughly constant.
        const safeMin = Math.max(230, gs.speed * 34);     // ~230px at low speed, ~272px at max
        const variance = Math.round(170 - diff * 100);    // 170 → 70: rhythm tightens
        gs.nextSpawn += safeMin + Math.random() * variance;
      }
      gs.obstacles = gs.obstacles.filter(o => o.wy > gs.scroll - 60);

      // Collision
      if (collides(gs)) {
        const final = gs.score;
        if (final > bestRef.current) { bestRef.current = final; setBest(final); }
        setDeathScore(final);
        setDeathTime(formatTime(Date.now() - gs.startTime));
        deathTimestampRef.current = Date.now();
        setPhase('dead');
        drawFrame();
        return;
      }

      // Update HUD directly (no React re-render)
      const elapsed = Date.now() - gs.startTime;
      if (scoreElRef.current) scoreElRef.current.textContent = String(gs.score);
      if (timeElRef.current)  timeElRef.current.textContent  = formatTime(elapsed);
      drawFrame();
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [phase, drawFrame]);

  // ── Input ─────────────────────────────────────────────────────────────────
  const startGame = useCallback(() => {
    const H = hRef.current;
    gsRef.current = {
      scroll: 0, speed: BASE_SPEED, side: 'left',
      jumping: false, fromSide: 'left', jumpT: 0,
      obstacles: [], nextSpawn: H + 200, score: 0,
      startTime: Date.now(),
      particles: [], impactLines: [],
    };
    setPhase('playing');
  }, []);

  const startCountdown = useCallback(() => {
    const H = hRef.current;
    gsRef.current = {
      scroll: 0, speed: BASE_SPEED, side: 'left',
      jumping: false, fromSide: 'left', jumpT: 0,
      obstacles: [], nextSpawn: H + 200, score: 0,
      startTime: Date.now(),
      particles: [], impactLines: [],
    };
    setCountdownNum(3);
    setPhase('countdown');
  }, []);

  useEffect(() => {
    if (phase !== 'countdown') return;
    setCountdownNum(3);
    const t1 = setTimeout(() => setCountdownNum(2), 1000);
    const t2 = setTimeout(() => setCountdownNum(1), 2000);
    const t3 = setTimeout(() => startGame(),        3000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [phase, startGame]);

  const jump = useCallback(() => {
    const gs = gsRef.current;
    if (gs.jumping) return;
    gs.jumping  = true;
    gs.fromSide = gs.side;
    gs.jumpT    = 0;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === ' ') {
        e.preventDefault();
        if (phaseRef.current === 'idle') { startCountdown(); return; }
        if (phaseRef.current === 'dead') {
          if (Date.now() - deathTimestampRef.current < 2000) return;
          startCountdown();
          return;
        }
        if (phaseRef.current === 'countdown') return;
        jump();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, startCountdown, jump]);

  const c = theme.colors;

  return (
    <div ref={containerRef} className="easter-egg-container" style={{ background: c.bg }}>
      <canvas ref={canvasRef} className="easter-egg-canvas" />

      <button
        className="easter-egg-exit"
        style={{ color: c.fgDim, background: c.bgSecondary, borderColor: c.border }}
        onClick={onClose}
      >
        ✕
      </button>

      {phase === 'playing' && (
        <div className="easter-egg-live-hud" style={{ color: c.fgDim }}>
          <span ref={scoreElRef} className="easter-egg-live-score">0</span>
          <span ref={timeElRef}  className="easter-egg-live-time">00:00</span>
        </div>
      )}

      {phase !== 'playing' && (
        <div className="easter-egg-msg" style={{ color: c.fg }}>
          {phase === 'idle' && (
            <>
              <span className="easter-egg-msg-pretitle" style={{ color: c.fgMuted }}>
                Need a break?
              </span>
              <span className="easter-egg-msg-pretitle" style={{ color: c.fgMuted }}>
                play
              </span>
              <div className="easter-egg-bob-row">
                <div className="easter-egg-bob-preview" style={{ background: c.accent }}>
                  <div className="easter-egg-bob-feet" style={{ background: c.accentSecondary }} />
                  <div className="easter-egg-bob-eye" style={{ background: c.bg }} />
                  <div className="easter-egg-bob-eye" style={{ background: c.bg }} />
                </div>
                <span className="easter-egg-msg-game-title" style={{ color: c.accent }}>
                  bob
                </span>
              </div>
              <span className="easter-egg-msg-hint" style={{ color: c.fgMuted }}>
                press <kbd style={{ background: c.bgTertiary, borderColor: c.border }}>space</kbd> to start
              </span>
            </>
          )}
          {phase === 'countdown' && (
            <>
              <span key={countdownNum} className="easter-egg-countdown-num" style={{ color: c.accent }}>
                {countdownNum}
              </span>
              <span className="easter-egg-countdown-sub" style={{ color: c.fgMuted }}>
                get ready
              </span>
            </>
          )}
          {phase === 'dead' && (
            <>
              <span className="easter-egg-msg-game-title" style={{ color: c.diffRemove }}>
                game over
              </span>
              <span className="easter-egg-msg-score" style={{ color: c.fg }}>
                score {deathScore}
              </span>
              <span className="easter-egg-msg-score" style={{ color: c.fgMuted }}>
                time {deathTime}
              </span>
              <span className="easter-egg-msg-score" style={{ color: c.fgMuted }}>
                best {best}
              </span>
              <span key={deathScore} className="easter-egg-msg-hint easter-egg-msg-hint-delayed" style={{ color: c.fgMuted }}>
                <kbd style={{ background: c.bgTertiary, borderColor: c.border }}>space</kbd> to retry
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
