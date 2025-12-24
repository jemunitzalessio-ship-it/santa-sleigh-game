import React, { useRef, useEffect, useState, useCallback } from 'react';

// Base dimensions - will scale for mobile
const BASE_W = 900, BASE_H = 600;
const GRAVITY = 0.12, THRUST = 0.25, MAX_FALL = 4, MAX_RISE = -3;
const SCROLL_SPEED = 1.2, MOVE_SPEED = 2.5, JUMP = -4.4;
const MAX_ENERGY = 100, DRAIN = 0.082, FOG_PENALTY = 20;
const LIVES = 10, PRESENTS_NEEDED = 3;
const FOG_SPEED = 1.8; // Base fog approach speed

// Points values
const POINTS_PER_ENERGY = 100; // Per 1% energy when landing
const POINTS_PER_LIFE = 1000; // Per life at end
const POINTS_PER_GOODY = 500; // Per collectible

// Detect mobile
const isMobile = () => {
  if (typeof window === 'undefined') return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
};

const SEGMENTS = [
  { id: 'northpole', name: 'North Pole', type: 'flight' },
  { id: 'montreal', name: 'Montreal', type: 'city' },
  { id: 'to_nyc', name: 'To NYC', type: 'flight' },
  { id: 'nyc', name: 'New York City', type: 'city' },
  { id: 'to_dc', name: 'To DC', type: 'flight' },
  { id: 'dc', name: 'Washington DC', type: 'city' },
  { id: 'to_nash', name: 'To Nashville', type: 'flight' },
  { id: 'nashville', name: 'Nashville', type: 'city' },
  { id: 'final', name: 'Final Approach', type: 'flight', isFinal: true }
];

const seed = (s) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const collide = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function genFlight(id, len = 3000, W = BASE_W, H = BASE_H) {
  const obs = [], fogs = [];
  let s = id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const final = id === 'final', dense = final ? 2.5 : 1;
  
  // Determine tree type based on segment
  // Beginning (North Pole) = pine, Middle (to_nyc, to_dc) = oak, End (to_nash, final) = magnolia
  let treeType = 'pine';
  if (id === 'to_nyc' || id === 'to_dc') treeType = 'oak';
  if (id === 'to_nash' || id === 'final') treeType = 'magnolia';
  
  // Ground obstacles (trees, buildings) - don't add near landing zone for final
  const groundObsEnd = final ? len - 600 : len - 400;
  for (let x = 200; x < groundObsEnd; x += 150 / dense) {
    s++;
    const r = seed(s);
    if (r < 0.6) {
      const h = 60 + seed(s+1) * 80;
      // Add variation seed for tree appearance
      obs.push({ t: 'tree', treeType, x: x + seed(s+2) * 50, y: H - 100 - h, w: 40, h, varSeed: seed(s+3) });
    } else if (r < 0.8 && !final) {
      const h = 100 + seed(s+1) * 150;
      // Add variation seed for building appearance
      obs.push({ t: 'bldg', x: x + seed(s+2) * 30, y: H - 100 - h, w: 60 + seed(s+3) * 40, h, varSeed: seed(s+4) });
    }
  }
  
  // Airborne obstacles (planes, blimps, storm clouds)
  const airborneSpacing = final ? 150 : 400;
  const airborneEnd = final ? len - 500 : len - 600;
  for (let x = 400; x < airborneEnd; x += airborneSpacing) {
    s++;
    const threshold = final ? 0.7 : 0.3; // More airborne obstacles in final
    if (seed(s) < threshold) {
      const typeRand = seed(s+1);
      let t;
      if (typeRand < 0.30) t = 'plane';
      else if (typeRand < 0.55) t = 'blimp';
      else t = 'storm';
      
      const baseY = t === 'storm' ? 30 + seed(s+2) * 60 : 100 + seed(s+2) * 200;
      obs.push({ 
        t, 
        x, 
        y: baseY, 
        w: t === 'plane' ? 80 : (t === 'blimp' ? 100 : 120), 
        h: t === 'plane' ? 25 : (t === 'blimp' ? 50 : 40), 
        mv: true, 
        baseY,
        // For planes: track horizontal movement
        startX: x,
        speed: t === 'plane' ? (2 + seed(s+3) * 2) : 0
      });
    }
  }
  
  if (!final) {
    for (let x = 600; x < len - 800; x += 800) {
      s++;
      if (seed(s) < 0.5) fogs.push({ x, w: 200 + seed(s+1) * 150, cleared: false });
    }
  }
  
  // For final approach, create tall trees forming a narrow shaft
  let tallTrees = null;
  if (final) {
    const shaftX = len - 350;
    const shaftWidth = 100; // Narrow gap for Santa to land in
    const treeHeight = 400; // Very tall trees
    tallTrees = {
      leftTree: { x: shaftX - 60, y: H - 100 - treeHeight, w: 60, h: treeHeight },
      rightTree: { x: shaftX + shaftWidth, y: H - 100 - treeHeight, w: 60, h: treeHeight },
      shaftX: shaftX,
      shaftWidth: shaftWidth
    };
  }
  
  return { 
    obs, 
    fogs, 
    land: { 
      x: final ? len - 350 : len - 300, 
      y: final ? H - 180 : 200 + seed(s+100) * 150, 
      w: final ? 100 : 120, 
      h: 50 
    }, 
    len,
    tallTrees,
    final
  };
}

function genCity(id) {
  const W = BASE_W, H = BASE_H; // Use base dimensions
  const styles = {
    montreal: { 
      col: '#4a6572', 
      roof: 'steep', 
      hs: [180, 240, 160, 220, 260, 140, 200],
      monuments: ['olympic_tower', 'notre_dame']
    },
    nyc: { 
      col: '#2f3542', 
      roof: 'flat', 
      hs: [280, 350, 250, 320, 380, 220, 300],
      monuments: ['statue_liberty', 'empire_state']
    },
    dc: { 
      col: '#dfe6e9', 
      roof: 'dome', 
      hs: [150, 200, 170, 190, 160, 180, 140],
      monuments: ['washington_monument', 'capitol']
    },
    nashville: { 
      col: '#8b7355', 
      roof: 'gabled', 
      hs: [160, 220, 180, 240, 200, 170, 190],
      monuments: ['parthenon', 'batman_building']
    }
  };
  const st = styles[id] || styles.montreal;
  const plats = [], chims = [];
  
  // More buildings with varied gaps for challenging platforming
  const numBuildings = 7;
  const totalWidth = W - 40; // Leave margins
  const gaps = [35, 50, 40, 55, 45, 50]; // Varied gap sizes
  const totalGaps = gaps.reduce((a, b) => a + b, 0);
  const buildingWidth = (totalWidth - totalGaps) / numBuildings;
  
  let currentX = 20;
  for (let i = 0; i < numBuildings; i++) {
    const h = st.hs[i] || 180;
    const y = H - h;
    const w = buildingWidth + (i % 2 === 0 ? -10 : 10); // Vary widths
    
    // Main building platform
    plats.push({ 
      x: currentX, 
      y, 
      w, 
      h, 
      col: st.col, 
      roof: st.roof,
      isMain: true 
    });
    
    // Add rooftop levels/structures on some buildings
    if (i > 0 && i < numBuildings - 1 && i % 2 === 0) {
      // Add a raised section on the rooftop
      const roofH = 40 + (i * 10) % 30;
      const roofW = w * 0.5;
      const roofX = currentX + (w - roofW) / 2;
      plats.push({
        x: roofX,
        y: y - roofH,
        w: roofW,
        h: roofH,
        col: st.col,
        roof: 'flat',
        isRooftop: true
      });
    }
    
    // Put chimneys on buildings 2, 3, and 4
    if (i >= 2 && i <= 4) {
      chims.push({ 
        id: i, 
        x: currentX + w/2 - 15, 
        y: y - 35, 
        w: 30, 
        h: 40, 
        done: false 
      });
    }
    
    currentX += w + (gaps[i] || 45);
  }
  
  // Spawn on top of first building
  const firstPlat = plats[0];
  return { 
    plats, 
    chims, 
    spawn: { x: firstPlat.x + 20, y: firstPlat.y - 30 }, 
    sleigh: { x: firstPlat.x + 10, y: firstPlat.y - 25, w: 60, h: 30 },
    monuments: st.monuments,
    cityId: id
  };
}

export default function SantaSleighRun() {
  const canvasRef = useRef(null);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [gameSize, setGameSize] = useState({ w: BASE_W, h: BASE_H, scale: 1 });
  const pausedRef = useRef(false);
  
  // Detect mobile and set game size
  useEffect(() => {
    const checkMobile = () => {
      const isMob = isMobile();
      setMobile(isMob);
      if (isMob) {
        const maxW = Math.min(window.innerWidth - 20, BASE_W);
        const scale = maxW / BASE_W;
        setGameSize({ w: maxW, h: BASE_H * scale, scale });
      } else {
        setGameSize({ w: BASE_W, h: BASE_H, scale: 1 });
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  const W = BASE_W, H = BASE_H; // Always use base dimensions internally
  
  // Preload intro image - try multiple path patterns
  const introImageRef = useRef(null);
  const [introImageLoaded, setIntroImageLoaded] = useState(false);
  useEffect(() => {
    const img = new Image();
    // Try the provided path first
    img.onload = () => {
      introImageRef.current = img;
      setIntroImageLoaded(true);
    };
    img.onerror = () => {
      // If that fails, try without leading slash
      const img2 = new Image();
      img2.onload = () => {
        introImageRef.current = img2;
        setIntroImageLoaded(true);
      };
      img2.src = 'assets/SallyMillieRetroArcade.png';
    };
    img.src = '/assets/SallyMillieRetroArcade.png';
  }, []);

  // Preload DC interstitial image
  const dcImageRef = useRef(null);
  const [dcImageLoaded, setDcImageLoaded] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      dcImageRef.current = img;
      setDcImageLoaded(true);
    };
    img.onerror = () => {
      const img2 = new Image();
      img2.onload = () => {
        dcImageRef.current = img2;
        setDcImageLoaded(true);
      };
      img2.src = 'assets/SMwithsquishmallowsArcade.png';
    };
    img.src = '/assets/SMwithsquishmallowsArcade.png';
  }, []);

  // DC interstitial countdown state
  const [dcCountdown, setDcCountdown] = useState(0);
  const dcCountdownRef = useRef(null);
  
  // Cleanup DC countdown interval on unmount
  useEffect(() => {
    return () => {
      if (dcCountdownRef.current) {
        clearInterval(dcCountdownRef.current);
      }
    };
  }, []);
  
  const state = useRef({
    mode: 'TITLE', lives: LIVES, energy: MAX_ENERGY, segIdx: 0,
    px: 150, py: 250, pw: 25, ph: 15, vx: 0, vy: 0, ground: false,
    scrollX: 0, seg: null,
    cityLvl: null, delivered: 0, doneCh: [], canExit: false,
    keys: {}, inv: 0, msg: '', msgT: 0, snow: [],
    // Delta time tracking for consistent speed across devices
    lastFrameTime: 0,
    // Beam and fog effects
    beam: null, // { startTime, duration, targetX }
    dissolvingFogs: [], // { x, w, startTime, duration }
    fogPauseStart: 0, // Track when fog first appeared for gravity pause
    // Electric zap effect
    zap: null, // { startTime, duration, x, y }
    // Wind gust effect for city mode
    wind: null, // { direction: -1 or 1, strength, startTime, duration }
    windWarning: null, // { direction, startTime }
    lastWindTime: 0,
    lastRespawnTime: 0, // Track respawn time for wind pause
    airJumpsUsed: 0, // Track air jumps (0-2 allowed for triple jump)
    // Ready countdown (3 second pause at start/respawn)
    readyTime: 0, // timestamp when ready period started
    // Points system
    score: 0,
    // Goodies/collectibles
    goodies: [], // { x, y, type: 'candy'|'cookie'|'cocoa', vy }
    lastGoodyTime: 0,
    // Final approach state
    inFinalShaft: false // True when scrolling stops for vertical landing
  });
  
  const initSeg = useCallback(() => {
    const s = state.current;
    const seg = SEGMENTS[s.segIdx];
    if (!seg || seg.type !== 'flight') return;
    s.scrollX = 0;
    s.seg = genFlight(seg.id);
    s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
    s.readyTime = performance.now(); // Start ready countdown
  }, []);
  
  const update = useCallback((t) => {
    const s = state.current;
    const seg = SEGMENTS[s.segIdx];
    const final = seg?.isFinal;
    
    // Calculate delta time for consistent speed across different frame rates
    // Target is 60fps (16.67ms per frame)
    // Only apply correction to SPEED UP slow devices (dt > 1), never slow down fast ones
    const deltaTime = s.lastFrameTime ? t - s.lastFrameTime : 16.67;
    const dt = Math.max(1, Math.min(deltaTime / 16.67, 3)); // Clamp between 1 and 3
    s.lastFrameTime = t;
    
    // Snow
    s.snow = s.snow.filter(sn => sn.y < H + 10);
    while (s.snow.length < 50) s.snow.push({ x: Math.random() * W, y: -10, sz: 2 + Math.random() * 3, sp: 1 + Math.random() * 2 });
    s.snow.forEach(sn => { sn.y += sn.sp * dt; sn.x += Math.sin(sn.y / 30) * 0.3 * dt; });
    
    // Spawn goodies every 5 seconds in both modes
    if ((s.mode === 'FLIGHT' || s.mode === 'CITY') && t - s.lastGoodyTime > 5000) {
      const types = ['candy', 'cookie', 'cocoa'];
      const type = types[Math.floor(Math.random() * types.length)];
      s.goodies.push({
        x: 100 + Math.random() * (W - 200),
        y: -30,
        type,
        vy: 0.75 + Math.random() * 0.25  // 50% slower
      });
      s.lastGoodyTime = t;
    }
    
    // Update goodies
    s.goodies = s.goodies.filter(g => g.y < H + 50);
    s.goodies.forEach(g => { g.y += g.vy * dt; });
    
    // Collect goodies
    s.goodies = s.goodies.filter(g => {
      if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, { x: g.x - 15, y: g.y - 15, w: 30, h: 30 })) {
        s.score += POINTS_PER_GOODY;
        s.msg = `+${POINTS_PER_GOODY} pts!`; s.msgT = t + 1000;
        return false; // Remove collected goody
      }
      return true;
    });
    
    if (s.mode === 'FLIGHT' && s.seg) {
      const inReadyPeriod = s.readyTime > 0 && (t - s.readyTime < 3000);
      
      // Check if we've reached the final shaft area
      if (final && s.seg.tallTrees) {
        const shaftScreenX = s.seg.tallTrees.shaftX - s.scrollX;
        if (shaftScreenX < W / 2 + 100) {
          s.inFinalShaft = true;
        }
      }
      
      if (!inReadyPeriod) {
        // Stop scrolling when in final shaft
        if (!s.inFinalShaft) {
          s.scrollX += SCROLL_SPEED * dt;
        }
        
        // Move fog toward player
        s.seg.fogs.forEach(f => {
          if (!f.cleared) f.x -= FOG_SPEED * dt;
        });
        
        // Check if fog is visible on screen (for gravity pause)
        let fogOnScreen = false;
        s.seg.fogs.forEach(f => {
          if (!f.cleared) {
            const fx = f.x - s.scrollX;
            if (fx < W && fx + f.w > 0) {
              fogOnScreen = true;
            }
          }
        });
        
        // Start fog pause timer when fog first appears
        if (fogOnScreen && s.fogPauseStart === 0) {
          s.fogPauseStart = t;
        } else if (!fogOnScreen) {
          s.fogPauseStart = 0; // Reset when no fog on screen
        }
        
        // Check if we're in the 2-second fog pause period
        const inFogPause = s.fogPauseStart > 0 && (t - s.fogPauseStart < 2000);
        const gravityMod = inFogPause ? 0.15 : 1; // Greatly reduced gravity during fog pause
        
        if (s.keys[' '] && s.energy > 0) {
          s.vy -= THRUST * dt;
          s.energy = Math.max(0, s.energy - DRAIN * dt);
        }
        s.vy += GRAVITY * gravityMod * dt;
        if (s.keys['ArrowUp']) s.vy -= 0.1 * dt;
        if (s.keys['ArrowDown']) s.vy += 0.1 * dt;
        if (s.keys['ArrowLeft']) s.px = Math.max(50, s.px - 1.7 * dt);
        if (s.keys['ArrowRight']) s.px = Math.min(W - 150, s.px + 1.7 * dt);
        s.vy = clamp(s.vy, MAX_RISE, MAX_FALL);
        s.py += s.vy * dt;
      }
      
      if (s.keys['r'] || s.keys['R']) {
        // Find closest uncleared fog ahead
        let closestFog = null;
        let closestDist = Infinity;
        s.seg.fogs.forEach(f => { 
          if (!f.cleared) {
            const fx = f.x - s.scrollX;
            if (fx > s.px && fx < closestDist) {
              closestDist = fx;
              closestFog = f;
            }
          }
        });
        
        if (closestFog) {
          closestFog.cleared = true;
          // Fire red beam
          s.beam = { startTime: t, duration: 500, targetX: closestFog.x - s.scrollX };
          // Add dissolving animation
          s.dissolvingFogs.push({ 
            x: closestFog.x, 
            w: closestFog.w, 
            startTime: t, 
            duration: 800 
          });
        }
        s.keys['r'] = s.keys['R'] = false;
      }
      
      // Clean up old dissolving fogs
      s.dissolvingFogs = s.dissolvingFogs.filter(df => t - df.startTime < df.duration);
      
      s.seg.fogs.forEach(f => {
        if (!f.cleared) {
          const fx = f.x - s.scrollX;
          if (s.px < fx + f.w && s.px + s.pw > fx) {
            s.energy = Math.max(0, s.energy - FOG_PENALTY);
            f.cleared = true;
            s.msg = 'Fog! Energy -20%'; s.msgT = t + 1500;
          }
        }
      });
      
      // Ground collision - snow level is at H - 100
      if (s.py + s.ph > H - 100 && t > s.inv && !inReadyPeriod) {
        s.lives--; 
        // Respawn at start of current stage with full energy
        s.scrollX = 0; s.px = 150; s.py = 250; s.vy = 0; s.vx = 0;
        s.energy = MAX_ENERGY;
        s.readyTime = t; // Start ready countdown
        s.inv = t + 5000; // Extend invincibility to cover ready period
        s.msg = 'Hit ground! Restarting stage...'; s.msgT = t + 1500;
        s.zap = { startTime: t, duration: 400, x: s.px, y: H - 100 };
        if (s.lives <= 0) s.mode = 'GAME_OVER';
      }
      // Keep Santa above ground
      if (s.py + s.ph > H - 100) { s.py = H - 100 - s.ph; s.vy = 0; }
      if (s.py < 20) { s.py = 20; s.vy = 0; }
      
      // Obstacle collisions - immune during ready period
      if (t > s.inv && !inReadyPeriod) {
        for (const o of s.seg.obs) {
          let ox = o.x - s.scrollX;
          
          // Update obstacle positions based on type
          if (o.mv) {
            if (o.t === 'plane') {
              // Planes move right to left with sine wave altitude
              o.x -= (o.speed || 2) * dt;
              o.y = o.baseY + Math.sin(t / 800 + o.startX * 0.01) * 40;
              ox = o.x - s.scrollX;
            } else {
              // Blimps and storms bob up and down
              o.y = o.baseY + Math.sin(t / 1500 + o.x) * 30;
            }
          }
          
          if (ox > W + 100 || ox + o.w < -100) continue;
          
          if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, { x: ox, y: o.y, w: o.w, h: o.h })) {
            s.lives--; 
            // Respawn at start of current stage with full energy
            s.scrollX = 0; s.px = 150; s.py = 250; s.vy = 0; s.vx = 0;
            s.energy = MAX_ENERGY;
            s.readyTime = t; // Start ready countdown
            s.inv = t + 5000; // Extend invincibility to cover ready period
            s.inFinalShaft = false; // Reset shaft state
            s.msg = `Hit ${o.t}! Restarting stage...`; s.msgT = t + 1500;
            // Trigger electric zap effect
            s.zap = { startTime: t, duration: 400, x: s.px, y: s.py };
            if (s.lives <= 0) s.mode = 'GAME_OVER';
            break;
          }
        }
        
        // Collision with tall trees in final approach
        if (final && s.seg.tallTrees && s.inFinalShaft) {
          const tt = s.seg.tallTrees;
          const leftX = tt.leftTree.x - s.scrollX;
          const rightX = tt.rightTree.x - s.scrollX;
          
          // Check collision with left tree
          if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, 
                      { x: leftX, y: tt.leftTree.y, w: tt.leftTree.w, h: tt.leftTree.h })) {
            s.lives--; 
            s.scrollX = 0; s.px = 150; s.py = 250; s.vy = 0; s.vx = 0;
            s.energy = MAX_ENERGY;
            s.readyTime = t;
            s.inv = t + 5000;
            s.inFinalShaft = false;
            s.msg = 'Hit tree! Restarting...'; s.msgT = t + 1500;
            s.zap = { startTime: t, duration: 400, x: s.px, y: s.py };
            if (s.lives <= 0) s.mode = 'GAME_OVER';
          }
          
          // Check collision with right tree
          if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, 
                      { x: rightX, y: tt.rightTree.y, w: tt.rightTree.w, h: tt.rightTree.h })) {
            s.lives--; 
            s.scrollX = 0; s.px = 150; s.py = 250; s.vy = 0; s.vx = 0;
            s.energy = MAX_ENERGY;
            s.readyTime = t;
            s.inv = t + 5000;
            s.inFinalShaft = false;
            s.msg = 'Hit tree! Restarting...'; s.msgT = t + 1500;
            s.zap = { startTime: t, duration: 400, x: s.px, y: s.py };
            if (s.lives <= 0) s.mode = 'GAME_OVER';
          }
        }
      }
      
      const lx = s.seg.land.x - s.scrollX;
      if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, { x: lx, y: s.seg.land.y, w: s.seg.land.w, h: s.seg.land.h })) {
        if (final) { 
          // Award points for remaining lives
          s.score += s.lives * POINTS_PER_LIFE;
          s.mode = 'WIN'; 
        }
        else {
          // Award points for remaining energy when landing in city
          const energyPoints = Math.round(s.energy) * POINTS_PER_ENERGY;
          s.score += energyPoints;
          s.msg = `Landed! +${energyPoints} pts!`; s.msgT = t + 2000;
          
          s.segIdx++;
          const next = SEGMENTS[s.segIdx];
          if (next?.type === 'city') {
            s.mode = 'CITY';
            s.cityLvl = genCity(next.id);
            s.delivered = 0; s.doneCh = []; s.canExit = false;
            s.px = s.cityLvl.spawn.x; s.py = s.cityLvl.spawn.y;
            s.vx = 0; s.vy = 0;
            s.ground = true; // Start grounded on rooftop
            s.wind = null; // Reset wind
            s.windWarning = null; // Reset wind warning
            s.lastWindTime = 0; // Reset wind timer
            s.lastRespawnTime = t; // Track for wind pause
            s.airJumpsUsed = 0; // Reset air jumps
            s.readyTime = t; // Start ready countdown
            s.goodies = []; // Clear goodies
            s.lastGoodyTime = t; // Reset goody timer
          }
        }
      }
      
      if (s.scrollX > s.seg.len) {
        s.segIdx++;
        if (s.segIdx >= SEGMENTS.length) s.mode = 'WIN';
        else initSeg();
      }
    }
    
    if (s.mode === 'CITY' && s.cityLvl) {
      const inReadyPeriod = s.readyTime > 0 && (t - s.readyTime < 3000);
      const seg = SEGMENTS[s.segIdx];
      const cityId = seg?.id || 'montreal';
      
      // Wind frequency varies by city (subtract 1.5s for warning period)
      // Montreal=6s, NYC=4s, DC=3s, Nashville=2s
      const windIntervals = { montreal: 4500, nyc: 2500, dc: 1500, nashville: 500 };
      const windInterval = windIntervals[cityId] || 4500;
      
      // Check if we're in the 3-second wind pause after respawn
      const windPauseAfterRespawn = s.lastRespawnTime > 0 && (t - s.lastRespawnTime < 3000);
      
      if (!inReadyPeriod) {
        // Wind gust logic - warning 1.5s before (but not during respawn wind pause)
        if (!s.wind && !s.windWarning && !windPauseAfterRespawn) {
          if (!s.lastWindTime) s.lastWindTime = t;
          if (t - s.lastWindTime > windInterval) {
            // Start warning
            s.windWarning = {
              direction: Math.random() < 0.5 ? -1 : 1,
              startTime: t
            };
          }
        }
        
        // After 1.5s warning, start actual wind
        if (s.windWarning && t - s.windWarning.startTime > 1500) {
          s.wind = {
            direction: s.windWarning.direction,
            strength: 2.5 + Math.random() * 2,
            startTime: t,
            duration: 1500 + Math.random() * 1500
          };
          s.msg = s.wind.direction < 0 ? '💨 Wind from right!' : '💨 Wind from left!';
          s.msgT = t + 1000;
          s.lastWindTime = t;
          s.windWarning = null;
        }
        
        // Handle player input first
        if (s.keys['ArrowLeft']) s.vx = -MOVE_SPEED;
        else if (s.keys['ArrowRight']) s.vx = MOVE_SPEED;
        else { s.vx *= Math.pow(0.8, dt); if (Math.abs(s.vx) < 0.5) s.vx = 0; }
        
        // Apply wind force AFTER player input - affects Santa regardless of state
        if (s.wind) {
          if (t - s.wind.startTime < s.wind.duration) {
            // Stronger wind effect that always pushes Santa
            s.vx += s.wind.direction * s.wind.strength * 0.135 * dt;
            // Also directly push position for more noticeable effect
            s.px += s.wind.direction * s.wind.strength * 0.27 * dt;
          } else {
            s.wind = null; // Wind ended
          }
        }
        
        // Jump and triple-jump (can jump twice while in air)
        if (s.keys[' ']) {
          if (s.ground) {
            s.vy = JUMP; s.ground = false; s.airJumpsUsed = 0;
          } else if (s.airJumpsUsed < 2) {
            s.vy = JUMP; s.airJumpsUsed++;
          }
          s.keys[' '] = false;
        }
        
        s.vy += GRAVITY * dt;
        s.vy = Math.min(s.vy, MAX_FALL);
        s.px += s.vx * dt; s.py += s.vy * dt;
        s.px = clamp(s.px, 0, W - s.pw);
        
        s.ground = false;
        for (const p of s.cityLvl.plats) {
          if (s.vy > 0) {
            const feet = s.py + s.ph, prev = feet - s.vy * dt;
            if (prev <= p.y && feet >= p.y && s.px + s.pw > p.x && s.px < p.x + p.w) {
              s.py = p.y - s.ph; s.vy = 0; s.ground = true; s.airJumpsUsed = 0;
            }
        }
      }
      } // End of ready period check
      
      if (s.py > H && t > s.inv) {
        s.lives--; 
        if (s.lives <= 0) s.mode = 'GAME_OVER';
        else {
          // Find nearest building platform to where Santa fell
          let nearestPlat = s.cityLvl.plats[0];
          let nearestDist = Infinity;
          for (const p of s.cityLvl.plats) {
            // Calculate distance from Santa's x position to platform center
            const platCenterX = p.x + p.w / 2;
            const dist = Math.abs(s.px - platCenterX);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearestPlat = p;
            }
          }
          
          // Respawn on top of nearest building
          s.px = nearestPlat.x + nearestPlat.w / 2 - s.pw / 2;
          s.py = nearestPlat.y - s.ph - 5;
          s.vx = 0; s.vy = 0; s.ground = true; s.airJumpsUsed = 0;
          s.readyTime = t; // Start ready countdown
          s.lastRespawnTime = t; // Track for wind pause (3 sec after respawn)
          s.wind = null; // Cancel any active wind
          s.windWarning = null; // Cancel any wind warning
          s.inv = t + 5000; // Extend invincibility to cover ready period
          s.msg = 'Fell! Respawning...'; s.msgT = t + 1500;
        }
      }
      
      for (const c of s.cityLvl.chims) {
        if (s.doneCh.includes(c.id)) continue;
        if (collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, { x: c.x, y: c.y, w: c.w, h: c.h })) {
          s.doneCh.push(c.id); s.delivered++; c.done = true;
          s.msg = `Present! (${s.delivered}/${PRESENTS_NEEDED})`; s.msgT = t + 1500;
          if (s.delivered >= PRESENTS_NEEDED) {
            s.energy = MAX_ENERGY; s.canExit = true;
            s.msg = 'All delivered! Return to sleigh!'; s.msgT = t + 2500;
          }
        }
      }
      
      if (s.canExit && collide({ x: s.px, y: s.py, w: s.pw, h: s.ph }, s.cityLvl.sleigh)) {
        const currentSeg = SEGMENTS[s.segIdx];
        s.segIdx++;
        s.goodies = []; // Clear goodies
        s.lastGoodyTime = t; // Reset goody timer
        if (s.segIdx >= SEGMENTS.length) s.mode = 'WIN';
        else if (currentSeg.id === 'dc') {
          // Show DC interstitial after completing Washington DC
          s.mode = 'DC_INTERSTITIAL';
        }
        else { s.mode = 'FLIGHT'; initSeg(); }
      }
    }
  }, [initSeg]);
  
  const draw = useCallback((ctx, t) => {
    const s = state.current;
    const seg = SEGMENTS[s.segIdx];
    const final = seg?.isFinal;
    
    // Clear
    ctx.fillStyle = '#0d1b2a';
    ctx.fillRect(0, 0, W, H);
    
    if (s.mode === 'INTRO') {
      // Simple dark background
      ctx.fillStyle = '#0a1628';
      ctx.fillRect(0, 0, W, H);
      
      // Stars
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 80; i++) {
        ctx.beginPath();
        ctx.arc((i * 137) % W, (i * 89) % (H * 0.7), ((i * 13) % 3) + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Draw the intro image centered - square aspect ratio, scaled up
      const imgSize = H * 0.45; // Square size based on height
      const imgY = 15;
      
      if (introImageLoaded && introImageRef.current) {
        const img = introImageRef.current;
        const scale = Math.min(imgSize / img.naturalWidth, imgSize / img.naturalHeight);
        const scaledW = img.naturalWidth * scale;
        const scaledH = img.naturalHeight * scale;
        const centeredX = (W - scaledW) / 2;
        
        // Frame
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 4;
        ctx.strokeRect(centeredX - 5, imgY - 5, scaledW + 10, scaledH + 10);
        
        ctx.drawImage(img, centeredX, imgY, scaledW, scaledH);
      } else {
        // Placeholder frame with festive design
        const placeholderX = (W - imgSize) / 2;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 4;
        ctx.strokeRect(placeholderX - 5, imgY - 5, imgSize + 10, imgSize + 10);
        ctx.fillStyle = '#1a2a4a';
        ctx.fillRect(placeholderX, imgY, imgSize, imgSize);
        
        // Decorative placeholder content
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 48px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('🎄 🎅 🎄', W/2, imgY + imgSize/2 - 20);
        ctx.font = '16px Georgia';
        ctx.fillStyle = '#fff';
        ctx.fillText('Sally & Millie', W/2, imgY + imgSize/2 + 20);
        ctx.fillText('Spaulding', W/2, imgY + imgSize/2 + 45);
      }
      
      // "Santa!" header - positioned below image
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 32px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('Santa!', W/2, H * 0.55);
      
      // Message text - single line, wider
      ctx.fillStyle = '#fff';
      ctx.font = '16px Georgia';
      ctx.fillText('Sally and Millie Spaulding of Nashville, Tennessee', W/2, H * 0.63);
      ctx.fillText('have been especially good this year!', W/2, H * 0.69);
      
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 18px Georgia';
      ctx.fillText('🌟 Get to Nashville ASAP! 🌟', W/2, H * 0.77);
      
      // Blinking prompt
      if (Math.floor(t / 500) % 2) {
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 18px Georgia';
        ctx.fillText('Click "Let\'s go!" below', W/2, H * 0.88);
      }
    }
    
    if (s.mode === 'TITLE') {
      // Stars
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 100; i++) {
        ctx.beginPath();
        ctx.arc((i * 137) % W, (i * 89) % (H * 0.6), ((i * 13) % 3) + 1, 0, Math.PI * 2);
        ctx.fill();
      }
      
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 44px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('🎅 SANTA SLEIGH RUN 🎄', W/2, 120);
      
      ctx.fillStyle = '#fff';
      ctx.font = '16px Georgia';
      ctx.fillText('Deliver presents: North Pole → Montreal → NYC → DC → Nashville', W/2, 165);
      
      ctx.fillStyle = '#fff';
      ctx.font = '14px Arial';
      ['↑↓←→ Steer/Move', 'SPACE Thrust/Jump', 'R Clear Fog', 'ENTER Start'].forEach((txt, i) => {
        ctx.fillText(txt, W/2, 220 + i * 28);
      });
      
      if (Math.floor(Date.now() / 500) % 2) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 22px Georgia';
        ctx.fillText('Press ENTER to Start!', W/2, 380);
      }
      
      drawSleigh(ctx, W/2 - 50, 420, false);
    }
    
    if (s.mode === 'FLIGHT' && s.seg) {
      // Sky
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, final ? '#1a1a2e' : '#1a3a5c');
      grad.addColorStop(1, final ? '#16213e' : '#2d5a7b');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      
      // Mountains
      ctx.fillStyle = final ? '#0f2818' : '#3d5a80';
      ctx.beginPath();
      ctx.moveTo(0, H - 150);
      for (let x = 0; x <= W; x += 50) {
        const h = 50 + Math.sin(((x + s.scrollX * 0.3) * 0.02) * Math.PI * 2) * 30;
        ctx.lineTo(x, H - 100 - h);
      }
      ctx.lineTo(W, H); ctx.lineTo(0, H);
      ctx.fill();
      
      // Ground
      ctx.fillStyle = final ? '#1a472a' : '#e8f4f8';
      ctx.fillRect(0, H - 100, W, 100);
      
      // Obstacles
      for (const o of s.seg.obs) {
        let ox = o.x - s.scrollX;
        
        // Update visual positions for rendering
        if (o.mv) {
          if (o.t === 'plane') {
            // Plane position already updated in update loop
            ox = o.x - s.scrollX;
          } else {
            // Blimps and storms bob up and down (visual only, collision uses update values)
          }
        }
        
        if (ox < -100 || ox > W + 100) continue;
        drawObs(ctx, o, ox, t);
      }
      
      // Fog warning & organic fog rendering
      for (const f of s.seg.fogs) {
        const fx = f.x - s.scrollX;
        if (!f.cleared) {
          // Warning indicator - centered on screen
          if (fx > W && fx < W + 360) {
            // Semi-transparent background box
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(W/2 - 180, H/2 - 40, 360, 80);
            ctx.strokeStyle = '#ffaa00';
            ctx.lineWidth = 3;
            ctx.strokeRect(W/2 - 180, H/2 - 40, 360, 80);
            
            // Warning text
            ctx.fillStyle = '#ffaa00';
            ctx.font = 'bold 20px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('⚠️ Fog ahead! ⚠️', W/2, H/2 - 10);
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 18px Arial';
            ctx.fillText('Press "R" to use Rudolph\'s nose!', W/2, H/2 + 20);
          }
          // Organic fog rendering with cloud shapes
          if (fx < W && fx + f.w > 0) {
            const startX = Math.max(0, fx);
            const endX = Math.min(fx + f.w, W);
            
            // Draw multiple cloud layers
            for (let layer = 0; layer < 3; layer++) {
              const alpha = 0.3 - layer * 0.08;
              ctx.fillStyle = `rgba(200, 220, 235, ${alpha})`;
              
              // Draw cloud puffs
              for (let cx = startX; cx < endX; cx += 40) {
                for (let cy = 50; cy < H - 120; cy += 80) {
                  const offsetX = Math.sin(cy * 0.1 + layer) * 20;
                  const offsetY = Math.cos(cx * 0.05 + layer) * 15;
                  const radius = 50 + Math.sin(cx * 0.03 + cy * 0.02) * 20;
                  
                  ctx.beginPath();
                  ctx.arc(cx + offsetX, cy + offsetY, radius, 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
            
            // Add wispy tendrils at edges
            ctx.fillStyle = 'rgba(200, 220, 235, 0.2)';
            for (let i = 0; i < 8; i++) {
              const tendrilX = startX + (i * (endX - startX) / 8);
              const tendrilY = 100 + Math.sin(tendrilX * 0.1) * 50;
              ctx.beginPath();
              ctx.ellipse(tendrilX, tendrilY, 30, 60, Math.sin(tendrilX * 0.05) * 0.3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
      
      // Dissolving fog animation
      for (const df of s.dissolvingFogs) {
        const elapsed = t - df.startTime;
        const progress = elapsed / df.duration;
        const dfx = df.x - s.scrollX;
        
        if (dfx < W && dfx + df.w > 0 && progress < 1) {
          // Fading, expanding cloud fragments
          const alpha = 0.4 * (1 - progress);
          const expansion = 1 + progress * 2;
          
          ctx.fillStyle = `rgba(255, 200, 200, ${alpha})`;
          
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 + progress * 2;
            const dist = 50 + progress * 150;
            const cx = dfx + df.w / 2 + Math.cos(angle) * dist;
            const cy = H / 2 + Math.sin(angle) * dist * 0.5;
            const size = (40 - progress * 30) * expansion;
            
            ctx.beginPath();
            ctx.arc(cx, cy, size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      
      // Red beam from Rudolph's nose
      if (s.beam && t - s.beam.startTime < s.beam.duration) {
        const beamProgress = (t - s.beam.startTime) / s.beam.duration;
        const beamLength = Math.min(s.beam.targetX - s.px, W);
        
        // Main beam
        const gradient = ctx.createLinearGradient(s.px + 60, 0, s.px + 60 + beamLength * beamProgress, 0);
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0.9)');
        gradient.addColorStop(0.5, 'rgba(255, 100, 100, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 200, 200, 0.2)');
        
        ctx.fillStyle = gradient;
        const beamWidth = 20 * (1 - beamProgress * 0.5);
        ctx.beginPath();
        ctx.moveTo(s.px + 55, s.py + 5);
        ctx.lineTo(s.px + 55 + beamLength * beamProgress, s.py + 5 - beamWidth/2);
        ctx.lineTo(s.px + 55 + beamLength * beamProgress, s.py + 5 + beamWidth/2);
        ctx.closePath();
        ctx.fill();
        
        // Glow effect
        ctx.shadowColor = '#ff0000';
        ctx.shadowBlur = 30;
        ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.arc(s.px + 55, s.py + 5, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Sparkles along beam
        for (let i = 0; i < 5; i++) {
          const sparkX = s.px + 60 + (beamLength * beamProgress * i / 5);
          const sparkY = s.py + 5 + Math.sin(t * 0.02 + i) * 8;
          ctx.fillStyle = `rgba(255, 255, 200, ${0.8 - beamProgress})`;
          ctx.beginPath();
          ctx.arc(sparkX, sparkY, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      
      // Landing zone with city cluster
      const lx = s.seg.land.x - s.scrollX;
      if (lx < W + 200 && lx + s.seg.land.w > -200) {
        // Get next city name
        const nextSeg = SEGMENTS[s.segIdx + 1];
        const cityName = nextSeg?.name || (final ? 'Home' : 'City');
        
        // Draw city cluster behind landing zone
        const clusterX = lx - 60;
        const groundY = H - 100;
        
        if (!final) {
          // Building cluster
          const buildings = [
            { x: clusterX - 30, w: 35, h: 80, col: '#3a4a5a' },
            { x: clusterX + 10, w: 45, h: 120, col: '#4a5a6a' },
            { x: clusterX + 60, w: 40, h: 95, col: '#3a4a5a' },
            { x: clusterX + 105, w: 50, h: 140, col: '#5a6a7a' },
            { x: clusterX + 160, w: 35, h: 70, col: '#4a5a6a' },
          ];
          
          for (const b of buildings) {
            // Building body
            ctx.fillStyle = b.col;
            ctx.fillRect(b.x, groundY - b.h, b.w, b.h);
            
            // Windows
            ctx.fillStyle = '#ffeaa7';
            const rows = Math.floor(b.h / 20);
            const cols = Math.floor(b.w / 15);
            for (let r = 0; r < rows; r++) {
              for (let c = 0; c < cols; c++) {
                if ((r + c + Math.floor(t/500)) % 3 !== 0) { // Some windows lit
                  ctx.fillRect(b.x + 4 + c * 12, groundY - b.h + 8 + r * 18, 8, 12);
                }
              }
            }
            
            // Roof detail
            ctx.fillStyle = '#2a3a4a';
            ctx.fillRect(b.x - 2, groundY - b.h - 5, b.w + 4, 8);
          }
          
          // City name banner
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          const bannerWidth = ctx.measureText(cityName).width + 40;
          ctx.fillRect(clusterX + 60 - bannerWidth/2, groundY - 160, bannerWidth + 20, 30);
          ctx.strokeStyle = '#ffd700';
          ctx.lineWidth = 2;
          ctx.strokeRect(clusterX + 60 - bannerWidth/2, groundY - 160, bannerWidth + 20, 30);
          
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 18px Georgia';
          ctx.textAlign = 'center';
          ctx.fillText(cityName, clusterX + 70, groundY - 140);
        } else {
          // Final home - draw cozy house
          const houseX = lx + s.seg.land.w / 2 - 40;
          const houseY = groundY;
          
          // House body
          ctx.fillStyle = '#8b7355';
          ctx.fillRect(houseX, houseY - 60, 80, 60);
          
          // Roof
          ctx.fillStyle = '#5c3317';
          ctx.beginPath();
          ctx.moveTo(houseX - 10, houseY - 60);
          ctx.lineTo(houseX + 40, houseY - 100);
          ctx.lineTo(houseX + 90, houseY - 60);
          ctx.closePath();
          ctx.fill();
          
          // Door
          ctx.fillStyle = '#cc0000';
          ctx.fillRect(houseX + 30, houseY - 40, 20, 40);
          
          // Windows
          ctx.fillStyle = '#ffeaa7';
          ctx.fillRect(houseX + 10, houseY - 50, 15, 15);
          ctx.fillRect(houseX + 55, houseY - 50, 15, 15);
          
          // Chimney with smoke
          ctx.fillStyle = '#5c3317';
          ctx.fillRect(houseX + 55, houseY - 95, 15, 25);
          
          // Smoke puffs
          ctx.fillStyle = 'rgba(200, 200, 200, 0.5)';
          for (let i = 0; i < 3; i++) {
            const smokeY = houseY - 100 - i * 15 - (t % 1000) / 50;
            const smokeX = houseX + 62 + Math.sin(t / 300 + i) * 5;
            ctx.beginPath();
            ctx.arc(smokeX, smokeY, 8 - i * 2, 0, Math.PI * 2);
            ctx.fill();
          }
          
          // Trees around house
          for (let tx of [houseX - 40, houseX + 100]) {
            ctx.fillStyle = '#1a472a';
            ctx.beginPath();
            ctx.moveTo(tx, houseY - 50);
            ctx.lineTo(tx - 20, houseY);
            ctx.lineTo(tx + 20, houseY);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#5c3317';
            ctx.fillRect(tx - 4, houseY - 10, 8, 15);
          }
          
          // "HOME" label
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 20px Georgia';
          ctx.textAlign = 'center';
          ctx.fillText('🏠 HOME', houseX + 40, houseY - 110);
        }
        
        // Landing zone marker (glowing platform)
        ctx.fillStyle = 'rgba(255,215,0,0.4)';
        ctx.fillRect(lx, s.seg.land.y, s.seg.land.w, s.seg.land.h);
        
        // Animated border
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 5]);
        ctx.lineDashOffset = -t / 50;
        ctx.strokeRect(lx, s.seg.land.y, s.seg.land.w, s.seg.land.h);
        ctx.setLineDash([]);
        
        // Arrow pointing down
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.moveTo(lx + s.seg.land.w/2, s.seg.land.y - 10);
        ctx.lineTo(lx + s.seg.land.w/2 - 15, s.seg.land.y - 30);
        ctx.lineTo(lx + s.seg.land.w/2 + 15, s.seg.land.y - 30);
        ctx.closePath();
        ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('LAND HERE', lx + s.seg.land.w/2, s.seg.land.y - 35);
      }
      
      // Draw tall trees for final approach
      if (final && s.seg.tallTrees) {
        const tt = s.seg.tallTrees;
        const leftX = tt.leftTree.x - s.scrollX;
        const rightX = tt.rightTree.x - s.scrollX;
        
        // Left tree
        if (leftX > -100 && leftX < W + 100) {
          // Trunk
          ctx.fillStyle = '#5c3317';
          ctx.fillRect(leftX + 20, tt.leftTree.y + tt.leftTree.h - 50, 20, 50);
          // Tree body (triangle)
          ctx.fillStyle = '#1a472a';
          ctx.beginPath();
          ctx.moveTo(leftX + 30, tt.leftTree.y);
          ctx.lineTo(leftX - 10, tt.leftTree.y + tt.leftTree.h - 50);
          ctx.lineTo(leftX + 70, tt.leftTree.y + tt.leftTree.h - 50);
          ctx.closePath();
          ctx.fill();
          // Snow on tree
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(leftX + 30, tt.leftTree.y);
          ctx.lineTo(leftX + 10, tt.leftTree.y + 60);
          ctx.lineTo(leftX + 50, tt.leftTree.y + 60);
          ctx.closePath();
          ctx.fill();
        }
        
        // Right tree
        if (rightX > -100 && rightX < W + 100) {
          // Trunk
          ctx.fillStyle = '#5c3317';
          ctx.fillRect(rightX + 20, tt.rightTree.y + tt.rightTree.h - 50, 20, 50);
          // Tree body (triangle)
          ctx.fillStyle = '#1a472a';
          ctx.beginPath();
          ctx.moveTo(rightX + 30, tt.rightTree.y);
          ctx.lineTo(rightX - 10, tt.rightTree.y + tt.rightTree.h - 50);
          ctx.lineTo(rightX + 70, tt.rightTree.y + tt.rightTree.h - 50);
          ctx.closePath();
          ctx.fill();
          // Snow on tree
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(rightX + 30, tt.rightTree.y);
          ctx.lineTo(rightX + 10, tt.rightTree.y + 60);
          ctx.lineTo(rightX + 50, tt.rightTree.y + 60);
          ctx.closePath();
          ctx.fill();
        }
        
        // Draw landing zone text if in shaft
        if (s.inFinalShaft) {
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 16px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('↓ LAND IN THE GAP! ↓', W/2, 60);
        }
      }
      
      // Draw goodies (collectibles on parachutes)
      for (const g of s.goodies) {
        ctx.save();
        
        // Flashing red beacon glow
        const beaconAlpha = 0.3 + Math.sin(t / 150 + g.x) * 0.3;
        ctx.fillStyle = `rgba(255, 0, 0, ${beaconAlpha})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 22 + Math.sin(t / 200) * 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Red and green parachute (alternating colors)
        const isRed = Math.floor(g.x / 50) % 2 === 0;
        ctx.fillStyle = isRed ? '#cc0000' : '#00aa00';
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI, 0);
        ctx.fill();
        
        // Parachute highlight stripe
        ctx.fillStyle = isRed ? '#00aa00' : '#cc0000';
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI + 0.5, Math.PI + 1.5);
        ctx.lineTo(g.x, g.y - 20);
        ctx.fill();
        
        // Parachute outline
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI, 0);
        ctx.stroke();
        
        // Parachute strings
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x - 12, g.y - 15);
        ctx.lineTo(g.x - 5, g.y);
        ctx.moveTo(g.x + 12, g.y - 15);
        ctx.lineTo(g.x + 5, g.y);
        ctx.moveTo(g.x, g.y - 20);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        
        // Goody item
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        if (g.type === 'candy') {
          ctx.fillText('🍬', g.x, g.y + 8);
        } else if (g.type === 'cookie') {
          ctx.fillText('🍪', g.x, g.y + 8);
        } else {
          ctx.fillText('☕', g.x, g.y + 8);
        }
        
        ctx.restore();
      }
      
      // Player
      if (t > s.inv || Math.floor(t / 100) % 2) {
        drawSleigh(ctx, s.px, s.py, s.keys[' '] && s.energy > 0);
      }
      
      // Electric zap effect on collision
      if (s.zap && t - s.zap.startTime < s.zap.duration) {
        const zapProgress = (t - s.zap.startTime) / s.zap.duration;
        const zapAlpha = 1 - zapProgress;
        
        // Multiple lightning bolts radiating from impact point
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + zapProgress * 3;
          const length = 30 + zapProgress * 50;
          
          ctx.strokeStyle = `rgba(255, 255, 0, ${zapAlpha})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          
          let px = s.zap.x + 30;
          let py = s.zap.y + 10;
          ctx.moveTo(px, py);
          
          // Jagged lightning path
          for (let j = 0; j < 4; j++) {
            const segLen = length / 4;
            const jitter = (Math.random() - 0.5) * 20;
            px += Math.cos(angle) * segLen + jitter;
            py += Math.sin(angle) * segLen + jitter;
            ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        
        // Central flash
        const flashSize = 40 * (1 - zapProgress);
        const gradient = ctx.createRadialGradient(
          s.zap.x + 30, s.zap.y + 10, 0,
          s.zap.x + 30, s.zap.y + 10, flashSize
        );
        gradient.addColorStop(0, `rgba(255, 255, 255, ${zapAlpha})`);
        gradient.addColorStop(0.3, `rgba(255, 255, 0, ${zapAlpha * 0.8})`);
        gradient.addColorStop(0.6, `rgba(255, 100, 0, ${zapAlpha * 0.5})`);
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(s.zap.x + 30, s.zap.y + 10, flashSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Electric sparks
        ctx.fillStyle = `rgba(255, 255, 200, ${zapAlpha})`;
        for (let i = 0; i < 12; i++) {
          const sparkAngle = Math.random() * Math.PI * 2;
          const sparkDist = 20 + Math.random() * 40 * (1 + zapProgress);
          const sparkX = s.zap.x + 30 + Math.cos(sparkAngle) * sparkDist;
          const sparkY = s.zap.y + 10 + Math.sin(sparkAngle) * sparkDist;
          ctx.beginPath();
          ctx.arc(sparkX, sparkY, 2 + Math.random() * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      
      // HUD
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(10, 10, 240, 105);
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, 240, 105);
      
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(seg?.name || 'Flight', 20, 32);
      
      ctx.fillStyle = '#fff';
      ctx.font = '14px Arial';
      ctx.fillText('Lives: ' + '❤️ x' + s.lives, 20, 52);
      ctx.fillText('Energy:', 20, 72);
      
      ctx.fillStyle = '#333';
      ctx.fillRect(80, 62, 100, 14);
      ctx.fillStyle = s.energy > 30 ? '#4cd137' : '#ffa502';
      ctx.fillRect(80, 62, s.energy, 14);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(80, 62, 100, 14);
      
      ctx.fillStyle = '#fff';
      ctx.font = '12px Arial';
      ctx.fillText(`Progress: ${Math.round(s.scrollX / s.seg.len * 100)}%`, 20, 88);
      
      // Score display
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(`Score: ${s.score.toLocaleString()}`, 20, 108);
      
      // Get Ready overlay
      const readyElapsed = t - s.readyTime;
      if (s.readyTime > 0 && readyElapsed < 3500) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, W, H);
        
        ctx.textAlign = 'center';
        if (readyElapsed < 3000) {
          // Show "Get Ready!"
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 48px Georgia';
          ctx.fillText('Get Ready!', W/2, H/2 - 40);
          
          // Countdown
          const countdown = Math.ceil((3000 - readyElapsed) / 1000);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 72px Georgia';
          ctx.fillText(countdown.toString(), W/2, H/2 + 40);
          
          // Flashing "Press Spacebar to fly!!" message
          if (Math.floor(t / 300) % 2 === 0) {
            ctx.fillStyle = '#00ffff';
            ctx.font = 'bold 24px Arial';
            ctx.shadowColor = '#00ffff';
            ctx.shadowBlur = 15;
            ctx.fillText('Press SPACEBAR to fly!!', W/2, H/2 + 110);
            ctx.shadowBlur = 0;
          }
        } else {
          // Show "Go!"
          ctx.fillStyle = '#00ff00';
          ctx.font = 'bold 72px Georgia';
          ctx.shadowColor = '#00ff00';
          ctx.shadowBlur = 20;
          ctx.fillText('GO!', W/2, H/2 + 20);
          ctx.shadowBlur = 0;
        }
      }
    }
    
    if (s.mode === 'CITY' && s.cityLvl) {
      const cityId = seg?.id || 'montreal';
      const cols = { montreal: ['#1a3a5c', '#2d5a7b'], nyc: ['#0d1b2a', '#1a3a5c'], dc: ['#2c3e50', '#34495e'], nashville: ['#1a1a2e', '#16213e'] };
      const [c1, c2] = cols[cityId] || cols.montreal;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      
      // Draw iconic monuments in background
      if (s.cityLvl.monuments) {
        ctx.globalAlpha = 0.3; // Silhouette effect
        for (let i = 0; i < s.cityLvl.monuments.length; i++) {
          const mon = s.cityLvl.monuments[i];
          const mx = i === 0 ? 50 : W - 150; // Left and right sides
          drawMonument(ctx, mon, mx, H - 30);
        }
        ctx.globalAlpha = 1;
      }
      
      // City name
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 24px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText(seg?.name || 'City', W/2, 40);
      
      // Instructions
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '14px Arial';
      ctx.fillText('Jump between rooftops and deliver presents to chimneys!', W/2, 65);
      
      // Buildings
      for (const p of s.cityLvl.plats) {
        ctx.fillStyle = p.col;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        
        // Roof platform indicator (walkable surface)
        if (!p.isRooftop) {
          ctx.fillStyle = '#444';
          ctx.fillRect(p.x, p.y - 5, p.w, 8);
        }
        
        // Roof style (only for main buildings, not rooftop structures)
        if (p.isMain) {
          ctx.fillStyle = '#2d3436';
          if (p.roof === 'steep') {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.w/2, p.y - 30);
            ctx.lineTo(p.x + p.w, p.y);
            ctx.fill();
          } else if (p.roof === 'dome') {
            ctx.beginPath();
            ctx.arc(p.x + p.w/2, p.y, p.w/3, Math.PI, 0);
            ctx.fill();
          } else if (p.roof === 'gabled') {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x + p.w * 0.3, p.y - 20);
            ctx.lineTo(p.x + p.w * 0.7, p.y - 20);
            ctx.lineTo(p.x + p.w, p.y);
            ctx.fill();
          }
        }
        
        // Windows
        ctx.fillStyle = '#ffeaa7';
        const rows = Math.floor((p.h - 40) / 25);
        const wcols = Math.floor((p.w - 20) / 25);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < wcols; c++) {
            ctx.fillRect(p.x + 10 + c * 25, p.y + 20 + r * 25, 15, 15);
          }
        }
      }
      
      // Chimneys
      for (const c of s.cityLvl.chims) {
        const done = s.doneCh.includes(c.id);
        ctx.fillStyle = done ? '#555' : '#5c3317';
        ctx.fillRect(c.x, c.y, c.w, c.h);
        ctx.fillStyle = done ? '#444' : '#3d2314';
        ctx.fillRect(c.x - 3, c.y, c.w + 6, 8);
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.fillStyle = done ? '#4cd137' : '#ffd700';
        ctx.fillText(done ? '✓' : '🎁', c.x + c.w/2, c.y - 5);
        
        // Pulsing indicator for undelivered chimneys
        if (!done) {
          const pulse = Math.sin(t / 200) * 0.3 + 0.7;
          ctx.strokeStyle = `rgba(255, 215, 0, ${pulse})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(c.x - 5, c.y - 5, c.w + 10, c.h + 10);
        }
      }
      
      // Sleigh on first rooftop
      const firstPlat = s.cityLvl.plats[0];
      if (s.canExit) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('⬇️ Return to Sleigh!', firstPlat.x + firstPlat.w/2, firstPlat.y - 60);
        
        // Glowing indicator
        ctx.strokeStyle = `rgba(255, 215, 0, ${Math.sin(t / 150) * 0.4 + 0.6})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(s.cityLvl.sleigh.x - 5, s.cityLvl.sleigh.y - 40, 70, 45);
      }
      drawSleigh(ctx, s.cityLvl.sleigh.x, s.cityLvl.sleigh.y - 35, false, 0.6);
      
      // Draw goodies (collectibles on parachutes)
      for (const g of s.goodies) {
        ctx.save();
        
        // Flashing red beacon glow
        const beaconAlpha = 0.3 + Math.sin(t / 150 + g.x) * 0.3;
        ctx.fillStyle = `rgba(255, 0, 0, ${beaconAlpha})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 22 + Math.sin(t / 200) * 5, 0, Math.PI * 2);
        ctx.fill();
        
        // Red and green parachute (alternating colors)
        const isRed = Math.floor(g.x / 50) % 2 === 0;
        ctx.fillStyle = isRed ? '#cc0000' : '#00aa00';
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI, 0);
        ctx.fill();
        
        // Parachute highlight stripe
        ctx.fillStyle = isRed ? '#00aa00' : '#cc0000';
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI + 0.5, Math.PI + 1.5);
        ctx.lineTo(g.x, g.y - 20);
        ctx.fill();
        
        // Parachute outline
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(g.x, g.y - 20, 15, Math.PI, 0);
        ctx.stroke();
        
        // Parachute strings
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(g.x - 12, g.y - 15);
        ctx.lineTo(g.x - 5, g.y);
        ctx.moveTo(g.x + 12, g.y - 15);
        ctx.lineTo(g.x + 5, g.y);
        ctx.moveTo(g.x, g.y - 20);
        ctx.lineTo(g.x, g.y);
        ctx.stroke();
        
        // Goody item
        ctx.font = '20px Arial';
        ctx.textAlign = 'center';
        if (g.type === 'candy') {
          ctx.fillText('🍬', g.x, g.y + 8);
        } else if (g.type === 'cookie') {
          ctx.fillText('🍪', g.x, g.y + 8);
        } else {
          ctx.fillText('☕', g.x, g.y + 8);
        }
        
        ctx.restore();
      }
      
      // Player
      if (t > s.inv || Math.floor(t / 100) % 2) {
        drawSanta(ctx, s.px, s.py);
      }
      
      // Ground at bottom (danger zone) - rendered after buildings so it's visible
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, H - 30, W, 30);
      ctx.fillStyle = '#ff4444';
      ctx.font = 'bold 12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('⚠️ DANGER ZONE - Don\'t Fall! ⚠️', W/2, H - 12);
      
      // Wind warning (1.5s before wind)
      if (s.windWarning) {
        const warningProgress = (t - s.windWarning.startTime) / 1500;
        const pulse = Math.sin(t / 100) * 0.3 + 0.7;
        
        // Warning box
        ctx.fillStyle = `rgba(0, 0, 0, ${0.7 * pulse})`;
        ctx.fillRect(W/2 - 150, H/2 - 50, 300, 60);
        ctx.strokeStyle = `rgba(255, 200, 100, ${pulse})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(W/2 - 150, H/2 - 50, 300, 60);
        
        ctx.fillStyle = `rgba(255, 200, 100, ${pulse})`;
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        const dirText = s.windWarning.direction < 0 ? 'from RIGHT!' : 'from LEFT!';
        ctx.fillText(`⚠️ Wind incoming ${dirText}`, W/2, H/2 - 20);
      }
      
      // Wind indicator with animated lines
      if (s.wind && t - s.wind.startTime < s.wind.duration) {
        const windAlpha = 0.6;
        ctx.fillStyle = `rgba(200, 220, 255, ${windAlpha})`;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        const windArrow = s.wind.direction < 0 ? '←←← 💨' : '💨 →→→';
        ctx.fillText(windArrow, W/2, H/2 - 70);
        
        // 3 animated wind lines
        ctx.strokeStyle = `rgba(200, 220, 255, 0.6)`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const lineY = 150 + i * 120;
          const speed = 8 + i * 2;
          const offset = (t * speed / 10) % (W + 200);
          
          let startX, endX;
          if (s.wind.direction < 0) {
            // Wind blowing left
            startX = W + 100 - offset;
            endX = startX - 80;
          } else {
            // Wind blowing right
            startX = -100 + offset;
            endX = startX + 80;
          }
          
          ctx.beginPath();
          ctx.moveTo(startX, lineY);
          ctx.lineTo(endX, lineY);
          // Arrow head
          if (s.wind.direction < 0) {
            ctx.lineTo(endX + 10, lineY - 8);
            ctx.moveTo(endX, lineY);
            ctx.lineTo(endX + 10, lineY + 8);
          } else {
            ctx.lineTo(endX - 10, lineY - 8);
            ctx.moveTo(endX, lineY);
            ctx.lineTo(endX - 10, lineY + 8);
          }
          ctx.stroke();
        }
      }
      
      // HUD
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(10, 80, 200, 90);
      ctx.strokeStyle = '#ffd700';
      ctx.strokeRect(10, 80, 200, 90);
      
      ctx.fillStyle = '#fff';
      ctx.font = '14px Arial';
      ctx.textAlign = 'left';
      ctx.fillText('Lives: ' + '❤️ x' + s.lives, 20, 100);
      ctx.fillText('Presents: ' + '🎁'.repeat(s.delivered) + '⬜'.repeat(PRESENTS_NEEDED - s.delivered), 20, 120);
      ctx.fillStyle = s.canExit ? '#ffd700' : '#fff';
      ctx.fillText(s.canExit ? 'Return to sleigh!' : `Find ${PRESENTS_NEEDED - s.delivered} chimneys`, 20, 140);
      
      // Score display
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 14px Arial';
      ctx.fillText(`Score: ${s.score.toLocaleString()}`, 20, 160);
      
      // Get Ready overlay
      const readyElapsed = t - s.readyTime;
      if (s.readyTime > 0 && readyElapsed < 3500) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, W, H);
        
        ctx.textAlign = 'center';
        if (readyElapsed < 3000) {
          // Show "Get Ready!"
          ctx.fillStyle = '#ffd700';
          ctx.font = 'bold 48px Georgia';
          ctx.fillText('Get Ready!', W/2, H/2 - 20);
          
          // Countdown
          const countdown = Math.ceil((3000 - readyElapsed) / 1000);
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 72px Georgia';
          ctx.fillText(countdown.toString(), W/2, H/2 + 60);
        } else {
          // Show "Go!"
          ctx.fillStyle = '#00ff00';
          ctx.font = 'bold 72px Georgia';
          ctx.shadowColor = '#00ff00';
          ctx.shadowBlur = 20;
          ctx.fillText('GO!', W/2, H/2 + 20);
          ctx.shadowBlur = 0;
        }
      }
    }
    
    if (s.mode === 'WIN') {
      // Retro 80s gradient background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, '#1a0a2e');
      bgGrad.addColorStop(0.5, '#16213e');
      bgGrad.addColorStop(1, '#0f3460');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);
      
      // Animated starfield
      for (let i = 0; i < 50; i++) {
        const twinkle = Math.sin(t / 200 + i * 1.5) * 0.5 + 0.5;
        ctx.fillStyle = `rgba(255, 255, 255, ${twinkle})`;
        ctx.beginPath();
        ctx.arc((i * 73) % W, (i * 47) % (H / 2), 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Animated fireworks/sparkles
      for (let i = 0; i < 12; i++) {
        const angle = (t / 500 + i * 0.5) % (Math.PI * 2);
        const dist = 30 + Math.sin(t / 300 + i) * 20;
        const cx = 150 + (i % 4) * 200;
        const cy = 80 + (Math.floor(i / 4)) * 50;
        const hue = (i * 60 + t / 10) % 360;
        ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Neon "YOU WIN!" text with glow
      ctx.save();
      ctx.shadowColor = '#ff00ff';
      ctx.shadowBlur = 30;
      ctx.fillStyle = '#ff00ff';
      ctx.font = 'bold 56px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('🎄 YOU WIN! 🎄', W/2, 80);
      ctx.shadowBlur = 0;
      ctx.restore();
      
      // Sub-text
      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Santa made it home to Nashville!', W/2, 115);
      
      // Floor/carpet
      ctx.fillStyle = '#8B0000';
      ctx.fillRect(0, H - 80, W, 80);
      ctx.fillStyle = '#660000';
      for (let x = 0; x < W; x += 40) {
        ctx.fillRect(x, H - 80, 20, 80);
      }
      
      // Big decorated Christmas tree
      const treeX = W / 2 + 100;
      const treeY = H - 80;
      
      // Tree trunk
      ctx.fillStyle = '#5c3317';
      ctx.fillRect(treeX - 20, treeY - 40, 40, 40);
      
      // Tree layers (bottom to top)
      ctx.fillStyle = '#1a472a';
      ctx.beginPath();
      ctx.moveTo(treeX, treeY - 280);
      ctx.lineTo(treeX - 120, treeY - 40);
      ctx.lineTo(treeX + 120, treeY - 40);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = '#1f5c32';
      ctx.beginPath();
      ctx.moveTo(treeX, treeY - 280);
      ctx.lineTo(treeX - 90, treeY - 120);
      ctx.lineTo(treeX + 90, treeY - 120);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = '#247339';
      ctx.beginPath();
      ctx.moveTo(treeX, treeY - 280);
      ctx.lineTo(treeX - 60, treeY - 180);
      ctx.lineTo(treeX + 60, treeY - 180);
      ctx.closePath();
      ctx.fill();
      
      // Star on top with glow
      ctx.save();
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 20 + Math.sin(t / 200) * 10;
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
        const r = i % 2 === 0 ? 25 : 10;
        ctx.lineTo(treeX + Math.cos(angle) * r, treeY - 300 + Math.sin(angle) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      
      // Animated ornaments
      const ornamentColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
      for (let i = 0; i < 15; i++) {
        const ox = treeX - 80 + (i % 5) * 35 + Math.sin(i * 2) * 15;
        const oy = treeY - 80 - Math.floor(i / 5) * 60;
        const pulse = Math.sin(t / 300 + i) * 0.3 + 0.7;
        ctx.save();
        ctx.shadowColor = ornamentColors[i % ornamentColors.length];
        ctx.shadowBlur = 10 * pulse;
        ctx.fillStyle = ornamentColors[i % ornamentColors.length];
        ctx.beginPath();
        ctx.arc(ox, oy, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      
      // String lights on tree
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(treeX - 80, treeY - 100);
      for (let x = treeX - 80; x <= treeX + 80; x += 20) {
        ctx.lineTo(x, treeY - 100 + Math.sin((x - treeX) / 20) * 10);
      }
      ctx.stroke();
      
      // Light bulbs
      for (let i = 0; i < 9; i++) {
        const lx = treeX - 80 + i * 20;
        const ly = treeY - 100 + Math.sin((lx - treeX) / 20) * 10;
        const on = Math.floor(t / 200 + i) % 3 === 0;
        ctx.fillStyle = on ? ['#ff0000', '#00ff00', '#ffff00'][i % 3] : '#333';
        ctx.beginPath();
        ctx.arc(lx, ly + 5, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Pile of presents under tree
      const presents = [
        { x: treeX - 80, y: treeY - 45, w: 40, h: 30, c: '#ff0000', r: '#ffd700' },
        { x: treeX - 50, y: treeY - 50, w: 35, h: 35, c: '#00aa00', r: '#ff0000' },
        { x: treeX - 20, y: treeY - 40, w: 45, h: 25, c: '#0066cc', r: '#ffffff' },
        { x: treeX + 20, y: treeY - 48, w: 38, h: 33, c: '#ffaa00', r: '#ff0000' },
        { x: treeX + 50, y: treeY - 42, w: 42, h: 28, c: '#cc00cc', r: '#00ffff' },
        { x: treeX - 65, y: treeY - 75, w: 30, h: 25, c: '#00cccc', r: '#ff00ff' },
        { x: treeX - 30, y: treeY - 78, w: 35, h: 28, c: '#ff6600', r: '#ffffff' },
        { x: treeX + 5, y: treeY - 72, w: 32, h: 30, c: '#9900ff', r: '#ffd700' },
      ];
      
      for (const p of presents) {
        // Present box
        ctx.fillStyle = p.c;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        // Ribbon vertical
        ctx.fillStyle = p.r;
        ctx.fillRect(p.x + p.w/2 - 3, p.y, 6, p.h);
        // Ribbon horizontal
        ctx.fillRect(p.x, p.y + p.h/2 - 3, p.w, 6);
        // Bow
        ctx.beginPath();
        ctx.arc(p.x + p.w/2 - 8, p.y - 5, 6, 0, Math.PI * 2);
        ctx.arc(p.x + p.w/2 + 8, p.y - 5, 6, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Animated Santa walking and placing present
      const santaX = 100 + (Math.sin(t / 1000) * 80);
      const santaY = treeY - 80;
      const walkFrame = Math.floor(t / 200) % 2;
      
      // Santa body
      ctx.fillStyle = '#cc0000';
      ctx.fillRect(santaX - 15, santaY, 30, 40);
      
      // Santa legs (animated)
      ctx.fillStyle = '#1a1a1a';
      if (walkFrame === 0) {
        ctx.fillRect(santaX - 12, santaY + 40, 10, 25);
        ctx.fillRect(santaX + 2, santaY + 40, 10, 20);
      } else {
        ctx.fillRect(santaX - 12, santaY + 40, 10, 20);
        ctx.fillRect(santaX + 2, santaY + 40, 10, 25);
      }
      
      // Santa boots
      ctx.fillStyle = '#333';
      ctx.fillRect(santaX - 14, santaY + 60, 14, 8);
      ctx.fillRect(santaX, santaY + 60, 14, 8);
      
      // Santa belt
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(santaX - 15, santaY + 25, 30, 6);
      ctx.fillStyle = '#ffd700';
      ctx.fillRect(santaX - 5, santaY + 24, 10, 8);
      
      // Santa head
      ctx.fillStyle = '#ffccaa';
      ctx.beginPath();
      ctx.arc(santaX, santaY - 10, 18, 0, Math.PI * 2);
      ctx.fill();
      
      // Santa hat
      ctx.fillStyle = '#cc0000';
      ctx.beginPath();
      ctx.moveTo(santaX - 18, santaY - 15);
      ctx.lineTo(santaX + 5, santaY - 45);
      ctx.lineTo(santaX + 18, santaY - 15);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(santaX - 20, santaY - 18, 40, 8);
      ctx.beginPath();
      ctx.arc(santaX + 5, santaY - 45, 6, 0, Math.PI * 2);
      ctx.fill();
      
      // Santa beard
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(santaX, santaY + 5, 15, 0, Math.PI);
      ctx.fill();
      
      // Santa eyes
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(santaX - 6, santaY - 12, 2, 0, Math.PI * 2);
      ctx.arc(santaX + 6, santaY - 12, 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Santa holding present (animated)
      const holdPresent = Math.sin(t / 1000) > 0;
      if (holdPresent) {
        ctx.fillStyle = '#cc0000';
        ctx.fillRect(santaX + 15, santaY + 10, 25, 20);
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(santaX + 25, santaY + 10, 5, 20);
        ctx.fillRect(santaX + 15, santaY + 17, 25, 5);
      }
      
      // Arms
      ctx.fillStyle = '#cc0000';
      ctx.fillRect(santaX - 25, santaY + 5, 12, 8);
      ctx.fillRect(santaX + 13, santaY + 5, 12, 8);
      
      // Final Score display
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(`FINAL SCORE: ${s.score.toLocaleString()}`, W/2, H - 60);
      
      // Lives display
      ctx.fillStyle = '#00ff00';
      ctx.font = '16px Arial';
      ctx.fillText('Lives Remaining: ' + '❤️ x' + s.lives + ` (+${s.lives * POINTS_PER_LIFE} pts)`, W/2, H - 35);
      
      // Flashing play again
      if (Math.floor(t / 400) % 2) {
        ctx.save();
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 15;
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 24px Georgia';
        ctx.fillText('Press ENTER to Play Again!', W/2, H - 5);
        ctx.restore();
      }
    }
    
    if (s.mode === 'GAME_OVER') {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, W, H);
      
      ctx.fillStyle = '#cc0000';
      ctx.font = 'bold 52px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('GAME OVER', W/2, 200);
      
      ctx.fillStyle = '#fff';
      ctx.font = '70px Arial';
      ctx.fillText('😢', W/2, 310);
      
      ctx.font = '22px Georgia';
      ctx.fillText('Santa ran out of lives!', W/2, 390);
      ctx.fillText('The children are waiting...', W/2, 430);
      
      if (Math.floor(Date.now() / 500) % 2) {
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 22px Georgia';
        ctx.fillText('Press ENTER to Try Again!', W/2, 510);
      }
    }
    
    // Snow
    ctx.fillStyle = '#fff';
    for (const sn of s.snow) {
      ctx.beginPath();
      ctx.arc(sn.x, sn.y, sn.sz, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Message
    if (s.msg && t < s.msgT) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(W/2 - 150, H/2 - 20, 300, 40);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(s.msg, W/2, H/2 + 5);
    }
    
    // DC Interstitial pop-over (drawn on top of frozen game)
    if (s.mode === 'DC_INTERSTITIAL') {
      // Semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(0, 0, W, H);
      
      // Pop-over window
      const popW = W * 0.7;
      const popH = H * 0.85;
      const popX = (W - popW) / 2;
      const popY = (H - popH) / 2;
      
      // Window background with gradient
      const popGrad = ctx.createLinearGradient(popX, popY, popX, popY + popH);
      popGrad.addColorStop(0, '#1a2a4a');
      popGrad.addColorStop(1, '#0a1628');
      ctx.fillStyle = popGrad;
      ctx.fillRect(popX, popY, popW, popH);
      
      // Window border
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 4;
      ctx.strokeRect(popX, popY, popW, popH);
      
      // Inner border
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.strokeRect(popX + 8, popY + 8, popW - 16, popH - 16);
      
      // Image - square aspect ratio
      const imgSize = popH * 0.40;
      const imgY = popY + 20;
      
      if (dcImageLoaded && dcImageRef.current) {
        const img = dcImageRef.current;
        const scale = Math.min(imgSize / img.naturalWidth, imgSize / img.naturalHeight);
        const scaledW = img.naturalWidth * scale;
        const scaledH = img.naturalHeight * scale;
        const centeredX = (W - scaledW) / 2;
        
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.strokeRect(centeredX - 4, imgY - 4, scaledW + 8, scaledH + 8);
        ctx.drawImage(img, centeredX, imgY, scaledW, scaledH);
      } else {
        // Placeholder
        const placeholderX = (W - imgSize) / 2;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.strokeRect(placeholderX - 4, imgY - 4, imgSize + 8, imgSize + 8);
        ctx.fillStyle = '#2a3a5a';
        ctx.fillRect(placeholderX, imgY, imgSize, imgSize);
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 36px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('🧸 🎄 🧸', W/2, imgY + imgSize/2);
      }
      
      // "Santa!" header
      ctx.fillStyle = '#ff3333';
      ctx.font = 'bold 28px Georgia';
      ctx.textAlign = 'center';
      ctx.fillText('Santa!', W/2, popY + popH * 0.52);
      
      // Message text
      ctx.fillStyle = '#fff';
      ctx.font = '16px Georgia';
      ctx.fillText('The girls are still asleep, but not for long!', W/2, popY + popH * 0.60);
      
      ctx.fillStyle = '#ffd700';
      ctx.font = 'bold 20px Georgia';
      ctx.fillText('🌟 Hurry! 🌟', W/2, popY + popH * 0.68);
      
      // Show countdown if active, otherwise show button
      if (dcCountdown > 0) {
        ctx.fillStyle = '#00ff00';
        ctx.font = 'bold 72px Georgia';
        ctx.fillText(dcCountdown.toString(), W/2, popY + popH * 0.85);
      } else {
        // Draw "Let's go!" button inside pop-over
        const btnW = 200;
        const btnH = 50;
        const btnX = (W - btnW) / 2;
        const btnY = popY + popH * 0.78;
        
        // Store button bounds for click detection
        s.dcButtonBounds = { x: btnX, y: btnY, w: btnW, h: btnH };
        
        // Button background
        const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX, btnY + btnH);
        btnGrad.addColorStop(0, '#ff6b6b');
        btnGrad.addColorStop(1, '#cc0000');
        ctx.fillStyle = btnGrad;
        ctx.fillRect(btnX, btnY, btnW, btnH);
        
        // Button border
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 4;
        ctx.strokeRect(btnX, btnY, btnW, btnH);
        
        // Button text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText("🎅 Let's go! 🦌", W/2, btnY + btnH/2 + 6);
      }
    }
  }, [introImageLoaded, dcImageLoaded, dcCountdown]);
  
  // Draw iconic city monuments
  function drawMonument(ctx, type, x, groundY) {
    ctx.fillStyle = '#1a1a3a'; // Dark silhouette color
    
    switch(type) {
      case 'statue_liberty':
        // Statue of Liberty
        // Pedestal
        ctx.fillRect(x + 20, groundY - 60, 40, 60);
        // Body
        ctx.beginPath();
        ctx.moveTo(x + 30, groundY - 60);
        ctx.lineTo(x + 25, groundY - 150);
        ctx.lineTo(x + 35, groundY - 180);
        ctx.lineTo(x + 40, groundY - 200);
        ctx.lineTo(x + 45, groundY - 180);
        ctx.lineTo(x + 55, groundY - 150);
        ctx.lineTo(x + 50, groundY - 60);
        ctx.closePath();
        ctx.fill();
        // Torch arm
        ctx.beginPath();
        ctx.moveTo(x + 45, groundY - 170);
        ctx.lineTo(x + 70, groundY - 210);
        ctx.lineTo(x + 75, groundY - 220);
        ctx.lineTo(x + 80, groundY - 210);
        ctx.lineTo(x + 70, groundY - 200);
        ctx.lineTo(x + 50, groundY - 165);
        ctx.closePath();
        ctx.fill();
        // Crown
        ctx.beginPath();
        for (let i = 0; i < 7; i++) {
          const angle = (i / 7) * Math.PI - Math.PI / 2;
          const tipX = x + 40 + Math.cos(angle) * 20;
          const tipY = groundY - 200 + Math.sin(angle) * 20 - 10;
          ctx.lineTo(tipX, tipY);
          ctx.lineTo(x + 40 + Math.cos(angle + 0.2) * 10, groundY - 195);
        }
        ctx.fill();
        break;
        
      case 'empire_state':
        // Empire State Building
        ctx.fillRect(x + 10, groundY - 200, 60, 200);
        ctx.fillRect(x + 20, groundY - 250, 40, 50);
        ctx.fillRect(x + 30, groundY - 290, 20, 40);
        ctx.fillRect(x + 37, groundY - 320, 6, 30);
        // Windows
        ctx.fillStyle = '#3a3a5a';
        for (let row = 0; row < 15; row++) {
          for (let col = 0; col < 4; col++) {
            ctx.fillRect(x + 15 + col * 14, groundY - 190 + row * 12, 8, 8);
          }
        }
        break;
        
      case 'washington_monument':
        // Washington Monument (obelisk)
        ctx.beginPath();
        ctx.moveTo(x + 35, groundY);
        ctx.lineTo(x + 20, groundY);
        ctx.lineTo(x + 25, groundY - 280);
        ctx.lineTo(x + 40, groundY - 320);
        ctx.lineTo(x + 55, groundY - 280);
        ctx.lineTo(x + 60, groundY);
        ctx.lineTo(x + 45, groundY);
        ctx.closePath();
        ctx.fill();
        break;
        
      case 'capitol':
        // US Capitol Building
        // Main building
        ctx.fillRect(x, groundY - 80, 100, 80);
        // Wings
        ctx.fillRect(x - 20, groundY - 60, 30, 60);
        ctx.fillRect(x + 90, groundY - 60, 30, 60);
        // Dome base
        ctx.fillRect(x + 30, groundY - 110, 40, 30);
        // Dome
        ctx.beginPath();
        ctx.arc(x + 50, groundY - 110, 25, Math.PI, 0);
        ctx.fill();
        // Cupola
        ctx.fillRect(x + 45, groundY - 145, 10, 15);
        ctx.beginPath();
        ctx.arc(x + 50, groundY - 145, 8, Math.PI, 0);
        ctx.fill();
        // Columns
        ctx.fillStyle = '#2a2a4a';
        for (let i = 0; i < 6; i++) {
          ctx.fillRect(x + 10 + i * 14, groundY - 80, 4, 50);
        }
        break;
        
      case 'olympic_tower':
        // Montreal Olympic Stadium Tower
        ctx.beginPath();
        ctx.moveTo(x + 30, groundY);
        ctx.lineTo(x + 20, groundY - 50);
        ctx.quadraticCurveTo(x + 10, groundY - 150, x + 50, groundY - 250);
        ctx.lineTo(x + 55, groundY - 245);
        ctx.quadraticCurveTo(x + 20, groundY - 150, x + 30, groundY - 50);
        ctx.lineTo(x + 40, groundY);
        ctx.closePath();
        ctx.fill();
        break;
        
      case 'notre_dame':
        // Notre-Dame Basilica Montreal
        ctx.fillRect(x + 10, groundY - 100, 60, 100);
        // Twin towers
        ctx.fillRect(x + 5, groundY - 160, 20, 60);
        ctx.fillRect(x + 55, groundY - 160, 20, 60);
        // Spires
        ctx.beginPath();
        ctx.moveTo(x + 5, groundY - 160);
        ctx.lineTo(x + 15, groundY - 190);
        ctx.lineTo(x + 25, groundY - 160);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 55, groundY - 160);
        ctx.lineTo(x + 65, groundY - 190);
        ctx.lineTo(x + 75, groundY - 160);
        ctx.fill();
        // Rose window
        ctx.beginPath();
        ctx.arc(x + 40, groundY - 70, 15, 0, Math.PI * 2);
        ctx.fill();
        break;
        
      case 'parthenon':
        // Nashville Parthenon (full-scale replica)
        // Base
        ctx.fillRect(x, groundY - 20, 100, 20);
        // Columns
        for (let i = 0; i < 8; i++) {
          ctx.fillRect(x + 5 + i * 12, groundY - 80, 6, 60);
        }
        // Roof
        ctx.beginPath();
        ctx.moveTo(x - 5, groundY - 80);
        ctx.lineTo(x + 50, groundY - 110);
        ctx.lineTo(x + 105, groundY - 80);
        ctx.closePath();
        ctx.fill();
        break;
        
      case 'batman_building':
        // AT&T Building (Batman Building) Nashville
        ctx.fillRect(x + 15, groundY - 180, 50, 180);
        // Batman ears
        ctx.beginPath();
        ctx.moveTo(x + 15, groundY - 180);
        ctx.lineTo(x + 5, groundY - 220);
        ctx.lineTo(x + 25, groundY - 190);
        ctx.lineTo(x + 40, groundY - 180);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + 65, groundY - 180);
        ctx.lineTo(x + 75, groundY - 220);
        ctx.lineTo(x + 55, groundY - 190);
        ctx.lineTo(x + 40, groundY - 180);
        ctx.closePath();
        ctx.fill();
        // Windows
        ctx.fillStyle = '#2a2a4a';
        for (let row = 0; row < 12; row++) {
          for (let col = 0; col < 3; col++) {
            ctx.fillRect(x + 22 + col * 14, groundY - 170 + row * 13, 8, 10);
          }
        }
        break;
    }
  }
  
  function drawSleigh(ctx, x, y, thrust, scale = 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * 0.3, scale * 0.3); // 30% of original size
    
    // === SLEIGH (on the left) ===
    // Sleigh body - curved elegant shape
    ctx.fillStyle = '#8B0000';
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.quadraticCurveTo(-10, 20, -15, 30);
    ctx.lineTo(-15, 50);
    ctx.quadraticCurveTo(-15, 60, 0, 60);
    ctx.lineTo(50, 60);
    ctx.quadraticCurveTo(60, 60, 60, 50);
    ctx.lineTo(60, 35);
    ctx.quadraticCurveTo(60, 20, 45, 20);
    ctx.closePath();
    ctx.fill();
    
    // Sleigh runner
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-20, 65);
    ctx.quadraticCurveTo(-25, 72, -15, 72);
    ctx.lineTo(65, 72);
    ctx.quadraticCurveTo(75, 72, 70, 60);
    ctx.stroke();
    
    // Sleigh trim
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-10, 25);
    ctx.lineTo(55, 25);
    ctx.stroke();
    
    // Santa in sleigh
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(15, 5, 25, 20);
    ctx.fillStyle = '#ffdbac';
    ctx.beginPath();
    ctx.arc(27, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    ctx.moveTo(17, 0);
    ctx.lineTo(27, -15);
    ctx.lineTo(37, 0);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(15, -3, 25, 5);
    ctx.beginPath();
    ctx.arc(27, -15, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Present sack
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(-5, 42, 12, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Reins
    ctx.strokeStyle = '#5c3317';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 40);
    ctx.quadraticCurveTo(90, 35, 120, 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(60, 48);
    ctx.quadraticCurveTo(90, 50, 120, 45);
    ctx.stroke();
    
    // === REINDEER FUNCTION ===
    const drawReindeer = (rx, ry, isRudolph) => {
      // Body
      ctx.fillStyle = '#8B6914';
      ctx.beginPath();
      ctx.ellipse(rx, ry, 20, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Neck
      ctx.beginPath();
      ctx.moveTo(rx + 14, ry - 4);
      ctx.quadraticCurveTo(rx + 22, ry - 12, rx + 28, ry - 18);
      ctx.quadraticCurveTo(rx + 32, ry - 12, rx + 22, ry - 4);
      ctx.closePath();
      ctx.fill();
      
      // Head
      ctx.beginPath();
      ctx.ellipse(rx + 32, ry - 20, 9, 7, 0.3, 0, Math.PI * 2);
      ctx.fill();
      
      // Snout
      ctx.fillStyle = '#6B4E0A';
      ctx.beginPath();
      ctx.ellipse(rx + 41, ry - 18, 5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      
      // Nose
      ctx.fillStyle = isRudolph ? '#ff0000' : '#333';
      ctx.beginPath();
      ctx.arc(rx + 45, ry - 17, isRudolph ? 4 : 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Rudolph glow
      if (isRudolph && thrust) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.arc(rx + 45, ry - 17, 12, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Eye
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(rx + 35, ry - 23, 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Ear
      ctx.fillStyle = '#8B6914';
      ctx.beginPath();
      ctx.ellipse(rx + 27, ry - 27, 3, 5, -0.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Antlers
      ctx.strokeStyle = '#5c3317';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(rx + 30, ry - 25);
      ctx.lineTo(rx + 26, ry - 38);
      ctx.lineTo(rx + 21, ry - 34);
      ctx.moveTo(rx + 26, ry - 38);
      ctx.lineTo(rx + 28, ry - 45);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(rx + 35, ry - 25);
      ctx.lineTo(rx + 39, ry - 38);
      ctx.lineTo(rx + 44, ry - 34);
      ctx.moveTo(rx + 39, ry - 38);
      ctx.lineTo(rx + 37, ry - 45);
      ctx.stroke();
      
      // Legs
      ctx.strokeStyle = '#6B4E0A';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx - 10, ry + 7);
      ctx.lineTo(rx - 12, ry + 24);
      ctx.moveTo(rx - 3, ry + 9);
      ctx.lineTo(rx - 2, ry + 24);
      ctx.moveTo(rx + 6, ry + 9);
      ctx.lineTo(rx + 5, ry + 24);
      ctx.moveTo(rx + 13, ry + 7);
      ctx.lineTo(rx + 15, ry + 24);
      ctx.stroke();
      
      // Hooves
      ctx.fillStyle = '#333';
      ctx.fillRect(rx - 14, ry + 22, 5, 4);
      ctx.fillRect(rx - 4, ry + 22, 5, 4);
      ctx.fillRect(rx + 3, ry + 22, 5, 4);
      ctx.fillRect(rx + 13, ry + 22, 5, 4);
      
      // Tail
      ctx.fillStyle = '#D4A857';
      ctx.beginPath();
      ctx.ellipse(rx - 20, ry - 2, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    };
    
    // Draw 2 reindeer on the right
    drawReindeer(100, 45, false);
    drawReindeer(145, 38, true);
    
    // Thrust effect behind sleigh
    if (thrust) {
      ctx.fillStyle = 'rgba(255, 200, 100, 0.6)';
      ctx.beginPath();
      ctx.moveTo(-15, 40);
      ctx.lineTo(-40, 32);
      ctx.lineTo(-35, 45);
      ctx.lineTo(-50, 42);
      ctx.lineTo(-35, 55);
      ctx.lineTo(-40, 50);
      ctx.lineTo(-15, 55);
      ctx.closePath();
      ctx.fill();
      
      ctx.fillStyle = 'rgba(255, 150, 50, 0.8)';
      ctx.beginPath();
      ctx.moveTo(-15, 43);
      ctx.lineTo(-30, 39);
      ctx.lineTo(-26, 47);
      ctx.lineTo(-15, 52);
      ctx.closePath();
      ctx.fill();
    }
    
    ctx.restore();
  }
  
  function drawSanta(ctx, x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.4, 0.4); // Smaller Santa
    
    ctx.fillStyle = '#cc0000';
    ctx.fillRect(10, 15, 25, 30);
    
    ctx.fillStyle = '#ffdbac';
    ctx.beginPath();
    ctx.arc(22, 10, 12, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#cc0000';
    ctx.beginPath();
    ctx.moveTo(10, 8);
    ctx.lineTo(22, -10);
    ctx.lineTo(34, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillRect(8, 6, 28, 5);
    
    ctx.fillStyle = '#000';
    ctx.fillRect(10, 32, 25, 5);
    ctx.fillStyle = '#ffd700';
    ctx.fillRect(18, 31, 8, 7);
    
    ctx.fillStyle = '#000';
    ctx.fillRect(12, 45, 8, 15);
    ctx.fillRect(24, 45, 8, 15);
    
    ctx.fillStyle = '#8b4513';
    ctx.beginPath();
    ctx.ellipse(5, 30, 10, 15, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }
  
  function drawObs(ctx, obs, x, t = 0) {
    const { t: type, y, w, h, treeType, varSeed = 0 } = obs;
    
    if (type === 'tree') {
      const centerX = x + w/2;
      const trunkW = 8 + varSeed * 4;
      const trunkH = 25 + varSeed * 10;
      
      if (treeType === 'pine') {
        // === PINE TREE (16-bit style) ===
        // Trunk with bark texture
        ctx.fillStyle = '#4a3728';
        ctx.fillRect(centerX - trunkW/2, y + h - trunkH, trunkW, trunkH);
        // Bark texture lines
        ctx.strokeStyle = '#3d2b1f';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
          const bx = centerX - trunkW/2 + 2 + (i * trunkW/4);
          ctx.beginPath();
          ctx.moveTo(bx, y + h - trunkH + 5);
          ctx.lineTo(bx + (varSeed - 0.5) * 3, y + h - 5);
          ctx.stroke();
        }
        
        // Multiple triangle layers for pine shape
        const layers = 3;
        for (let layer = 0; layer < layers; layer++) {
          const layerY = y + (layer * h * 0.25);
          const layerH = h * 0.45 - layer * 5;
          const layerW = w * (1 - layer * 0.15);
          
          // Dark green base
          ctx.fillStyle = '#1a472a';
          ctx.beginPath();
          ctx.moveTo(centerX, layerY);
          ctx.lineTo(centerX - layerW/2, layerY + layerH);
          ctx.lineTo(centerX + layerW/2, layerY + layerH);
          ctx.closePath();
          ctx.fill();
          
          // Mid-tone texture stripes (16-bit dithering effect)
          ctx.fillStyle = '#2d5a3d';
          for (let stripe = 0; stripe < 4; stripe++) {
            const stripeY = layerY + layerH * 0.2 + stripe * (layerH * 0.18);
            const stripeW = layerW * (1 - (stripeY - layerY) / layerH) * 0.8;
            ctx.beginPath();
            ctx.moveTo(centerX - stripeW/2, stripeY);
            ctx.lineTo(centerX + stripeW/2, stripeY);
            ctx.lineTo(centerX + stripeW/2 - 3, stripeY + 4);
            ctx.lineTo(centerX - stripeW/2 + 3, stripeY + 4);
            ctx.closePath();
            ctx.fill();
          }
          
          // Highlight on left edge
          ctx.fillStyle = '#3d7a5a';
          ctx.beginPath();
          ctx.moveTo(centerX, layerY);
          ctx.lineTo(centerX - layerW/2, layerY + layerH);
          ctx.lineTo(centerX - layerW/4, layerY + layerH * 0.7);
          ctx.closePath();
          ctx.fill();
        }
        
        // Snow on top
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.moveTo(centerX, y);
        ctx.lineTo(centerX - 12, y + 18);
        ctx.lineTo(centerX + 12, y + 18);
        ctx.closePath();
        ctx.fill();
        // Snow shadow
        ctx.fillStyle = '#d0e8f0';
        ctx.beginPath();
        ctx.moveTo(centerX + 3, y + 5);
        ctx.lineTo(centerX + 12, y + 18);
        ctx.lineTo(centerX + 5, y + 15);
        ctx.closePath();
        ctx.fill();
        
      } else if (treeType === 'oak') {
        // === OAK TREE (16-bit style) ===
        // Thick trunk with texture
        const oakTrunkW = trunkW * 1.5;
        ctx.fillStyle = '#5c4033';
        ctx.fillRect(centerX - oakTrunkW/2, y + h * 0.5, oakTrunkW, h * 0.5);
        // Bark texture
        ctx.fillStyle = '#4a3429';
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(centerX - oakTrunkW/2 + 2 + i * (oakTrunkW/3), y + h * 0.55, 3, h * 0.4);
        }
        // Trunk highlight
        ctx.fillStyle = '#7a5c45';
        ctx.fillRect(centerX - oakTrunkW/2 + 1, y + h * 0.5, 3, h * 0.48);
        
        // Leafy canopy - multiple overlapping circles
        const canopyY = y + h * 0.15;
        const canopyH = h * 0.55;
        
        // Dark green shadow layer
        ctx.fillStyle = '#2d5a2d';
        ctx.beginPath();
        ctx.arc(centerX - 8, canopyY + canopyH * 0.6, w * 0.35, 0, Math.PI * 2);
        ctx.arc(centerX + 10, canopyY + canopyH * 0.7, w * 0.3, 0, Math.PI * 2);
        ctx.arc(centerX, canopyY + canopyH * 0.8, w * 0.25, 0, Math.PI * 2);
        ctx.fill();
        
        // Main green layer
        ctx.fillStyle = '#3d8b3d';
        ctx.beginPath();
        ctx.arc(centerX, canopyY + canopyH * 0.3, w * 0.4, 0, Math.PI * 2);
        ctx.arc(centerX - 12, canopyY + canopyH * 0.45, w * 0.35, 0, Math.PI * 2);
        ctx.arc(centerX + 12, canopyY + canopyH * 0.45, w * 0.35, 0, Math.PI * 2);
        ctx.arc(centerX - 5, canopyY + canopyH * 0.55, w * 0.3, 0, Math.PI * 2);
        ctx.arc(centerX + 8, canopyY + canopyH * 0.55, w * 0.28, 0, Math.PI * 2);
        ctx.fill();
        
        // Highlight layer (lighter spots)
        ctx.fillStyle = '#5aaa5a';
        ctx.beginPath();
        ctx.arc(centerX - 8, canopyY + canopyH * 0.25, w * 0.2, 0, Math.PI * 2);
        ctx.arc(centerX + 5, canopyY + canopyH * 0.35, w * 0.15, 0, Math.PI * 2);
        ctx.arc(centerX - 3, canopyY + canopyH * 0.45, w * 0.12, 0, Math.PI * 2);
        ctx.fill();
        
        // Dithered texture dots for 16-bit effect
        ctx.fillStyle = '#4d9a4d';
        for (let i = 0; i < 15; i++) {
          const dotX = centerX + (varSeed * 100 + i * 17) % 30 - 15;
          const dotY = canopyY + canopyH * 0.2 + (i * 13) % (canopyH * 0.5);
          ctx.fillRect(dotX, dotY, 2, 2);
        }
        
      } else if (treeType === 'magnolia') {
        // === MAGNOLIA TREE (16-bit style) ===
        // Elegant curved trunk
        ctx.fillStyle = '#6b5344';
        ctx.beginPath();
        ctx.moveTo(centerX - 5, y + h);
        ctx.quadraticCurveTo(centerX - 8, y + h * 0.7, centerX - 3, y + h * 0.4);
        ctx.lineTo(centerX + 3, y + h * 0.4);
        ctx.quadraticCurveTo(centerX + 8, y + h * 0.7, centerX + 5, y + h);
        ctx.closePath();
        ctx.fill();
        // Trunk texture
        ctx.strokeStyle = '#5a4538';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(centerX, y + h * 0.45);
        ctx.quadraticCurveTo(centerX + 2, y + h * 0.7, centerX, y + h - 5);
        ctx.stroke();
        
        // Branches
        ctx.strokeStyle = '#6b5344';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(centerX, y + h * 0.5);
        ctx.quadraticCurveTo(centerX - 15, y + h * 0.35, centerX - 20, y + h * 0.25);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX, y + h * 0.45);
        ctx.quadraticCurveTo(centerX + 12, y + h * 0.3, centerX + 18, y + h * 0.2);
        ctx.stroke();
        
        // Large glossy leaves - oval shapes
        const leafPositions = [
          { lx: -18, ly: 0.15, rot: -0.3 },
          { lx: 15, ly: 0.12, rot: 0.4 },
          { lx: -8, ly: 0.08, rot: -0.1 },
          { lx: 8, ly: 0.1, rot: 0.2 },
          { lx: 0, ly: 0.05, rot: 0 },
          { lx: -12, ly: 0.25, rot: -0.2 },
          { lx: 12, ly: 0.22, rot: 0.3 }
        ];
        
        for (const leaf of leafPositions) {
          ctx.save();
          ctx.translate(centerX + leaf.lx, y + h * leaf.ly);
          ctx.rotate(leaf.rot);
          
          // Leaf shadow
          ctx.fillStyle = '#1a4d1a';
          ctx.beginPath();
          ctx.ellipse(2, 2, 12, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          
          // Main leaf
          ctx.fillStyle = '#2d6b2d';
          ctx.beginPath();
          ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
          ctx.fill();
          
          // Leaf highlight
          ctx.fillStyle = '#4d8b4d';
          ctx.beginPath();
          ctx.ellipse(-3, -2, 6, 4, -0.3, 0, Math.PI * 2);
          ctx.fill();
          
          // Leaf vein
          ctx.strokeStyle = '#3d7a3d';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(-10, 0);
          ctx.lineTo(10, 0);
          ctx.stroke();
          
          ctx.restore();
        }
        
        // White magnolia flowers (2-3 blooms)
        const flowerPositions = [
          { fx: -10, fy: 0.18 },
          { fx: 12, fy: 0.15 },
          { fx: 0, fy: 0.08 }
        ];
        
        for (let fi = 0; fi < (2 + Math.floor(varSeed * 2)); fi++) {
          const flower = flowerPositions[fi];
          const fx = centerX + flower.fx;
          const fy = y + h * flower.fy;
          
          // Flower petals
          ctx.fillStyle = '#fff8f0';
          for (let p = 0; p < 6; p++) {
            const angle = (p / 6) * Math.PI * 2;
            ctx.beginPath();
            ctx.ellipse(fx + Math.cos(angle) * 5, fy + Math.sin(angle) * 5, 6, 4, angle, 0, Math.PI * 2);
            ctx.fill();
          }
          // Flower center
          ctx.fillStyle = '#ffeb99';
          ctx.beginPath();
          ctx.arc(fx, fy, 4, 0, Math.PI * 2);
          ctx.fill();
          // Center detail
          ctx.fillStyle = '#e6c54d';
          ctx.beginPath();
          ctx.arc(fx, fy, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      
    } else if (type === 'bldg') {
      // === BUILDING (16-bit style) ===
      // Base color with slight variation
      const baseHue = 220 + varSeed * 40;
      ctx.fillStyle = `hsl(${baseHue}, 15%, 35%)`;
      ctx.fillRect(x, y, w, h);
      
      // Left side shadow
      ctx.fillStyle = `hsl(${baseHue}, 15%, 25%)`;
      ctx.fillRect(x, y, 4, h);
      
      // Right side highlight
      ctx.fillStyle = `hsl(${baseHue}, 15%, 45%)`;
      ctx.fillRect(x + w - 4, y, 4, h);
      
      // Roof
      ctx.fillStyle = `hsl(${baseHue}, 10%, 28%)`;
      ctx.fillRect(x - 3, y - 8, w + 6, 12);
      ctx.fillStyle = `hsl(${baseHue}, 10%, 38%)`;
      ctx.fillRect(x - 3, y - 8, w + 6, 4);
      
      // Windows with glow effect
      const rows = Math.floor(h / 35);
      const cols = Math.floor(w / 22);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x + 8 + c * 20;
          const wy = y + 15 + r * 32;
          const lit = ((r + c + Math.floor(varSeed * 10)) % 3) !== 0;
          
          if (lit) {
            // Window glow
            ctx.fillStyle = 'rgba(255, 230, 150, 0.3)';
            ctx.fillRect(wx - 2, wy - 2, 16, 22);
            // Window
            ctx.fillStyle = '#ffdd77';
            ctx.fillRect(wx, wy, 12, 18);
            // Window panes
            ctx.fillStyle = '#cc9933';
            ctx.fillRect(wx + 5, wy, 2, 18);
            ctx.fillRect(wx, wy + 8, 12, 2);
          } else {
            // Dark window
            ctx.fillStyle = '#2a3a4a';
            ctx.fillRect(wx, wy, 12, 18);
            // Window frame
            ctx.strokeStyle = '#3a4a5a';
            ctx.lineWidth = 1;
            ctx.strokeRect(wx, wy, 12, 18);
          }
        }
      }
      
      // Brick texture (dithered pattern)
      ctx.fillStyle = `hsl(${baseHue}, 12%, 32%)`;
      for (let by = y + 5; by < y + h - 5; by += 8) {
        const offset = (Math.floor(by / 8) % 2) * 10;
        for (let bx = x + 5 + offset; bx < x + w - 5; bx += 20) {
          ctx.fillRect(bx, by, 1, 1);
          ctx.fillRect(bx + 8, by + 4, 1, 1);
        }
      }
      
    } else if (type === 'plane') {
      // Plane flying left (nose pointing left)
      ctx.fillStyle = '#e0e0e0';
      // Fuselage
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2 - 5, h/3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Nose cone
      ctx.beginPath();
      ctx.moveTo(x, y + h/2);
      ctx.lineTo(x + 15, y + h/3);
      ctx.lineTo(x + 15, y + h*2/3);
      ctx.closePath();
      ctx.fill();
      // Wings
      ctx.fillStyle = '#c0c0c0';
      ctx.beginPath();
      ctx.moveTo(x + w/2 - 10, y + h/2);
      ctx.lineTo(x + w/2 + 5, y - 5);
      ctx.lineTo(x + w/2 + 20, y - 5);
      ctx.lineTo(x + w/2 + 10, y + h/2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + w/2 - 10, y + h/2);
      ctx.lineTo(x + w/2 + 5, y + h + 5);
      ctx.lineTo(x + w/2 + 20, y + h + 5);
      ctx.lineTo(x + w/2 + 10, y + h/2);
      ctx.closePath();
      ctx.fill();
      // Tail
      ctx.beginPath();
      ctx.moveTo(x + w - 10, y + h/2 - 3);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w + 5, y + 5);
      ctx.lineTo(x + w - 5, y + h/2);
      ctx.closePath();
      ctx.fill();
      // Windows
      ctx.fillStyle = '#4a90d9';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(x + 20 + i * 12, y + h/2 - 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Engine trail
      ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
      ctx.beginPath();
      ctx.moveTo(x + w, y + h/2);
      ctx.lineTo(x + w + 30, y + h/2 - 5);
      ctx.lineTo(x + w + 30, y + h/2 + 5);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'blimp') {
      // White Goodyear blimp
      ctx.fillStyle = '#f5f5f5';
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Outline
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Gondola
      ctx.fillStyle = '#333333';
      ctx.fillRect(x + w/3, y + h - 3, w/3, 12);
      // Goodyear text
      ctx.fillStyle = '#1e3a8a';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('GOODYEAR', x + w/2, y + h/2 + 4);
      // Fins
      ctx.fillStyle = '#1e3a8a';
      ctx.beginPath();
      ctx.moveTo(x + w - 10, y + h/2);
      ctx.lineTo(x + w + 5, y + 5);
      ctx.lineTo(x + w + 5, y + h/2);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x + w - 10, y + h/2);
      ctx.lineTo(x + w + 5, y + h - 5);
      ctx.lineTo(x + w + 5, y + h/2);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'storm') {
      // Dark storm cloud
      ctx.fillStyle = '#2c3e50';
      // Main cloud body - multiple overlapping circles
      const cx = x + w/2, cy = y + h/2;
      ctx.beginPath();
      ctx.arc(cx - 30, cy, 25, 0, Math.PI * 2);
      ctx.arc(cx, cy - 10, 30, 0, Math.PI * 2);
      ctx.arc(cx + 25, cy - 5, 22, 0, Math.PI * 2);
      ctx.arc(cx + 45, cy + 5, 18, 0, Math.PI * 2);
      ctx.arc(cx - 10, cy + 10, 20, 0, Math.PI * 2);
      ctx.arc(cx + 20, cy + 12, 18, 0, Math.PI * 2);
      ctx.fill();
      
      // Darker bottom
      ctx.fillStyle = '#1a252f';
      ctx.beginPath();
      ctx.arc(cx - 20, cy + 15, 18, 0, Math.PI * 2);
      ctx.arc(cx + 10, cy + 18, 15, 0, Math.PI * 2);
      ctx.arc(cx + 35, cy + 15, 12, 0, Math.PI * 2);
      ctx.fill();
      
      // Lightning bolt (occasional flash)
      if (Math.sin(t / 100 + x) > 0.7) {
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx, cy + 20);
        ctx.lineTo(cx - 8, cy + 35);
        ctx.lineTo(cx + 2, cy + 35);
        ctx.lineTo(cx - 5, cy + 50);
        ctx.stroke();
        
        // Glow effect
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = 15;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
  }
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    let animId;
    const loop = (t) => {
      if (!pausedRef.current) {
        update(t);
      }
      draw(ctx, t);
      // Draw pause overlay
      if (pausedRef.current) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffd700';
        ctx.font = 'bold 48px Georgia';
        ctx.textAlign = 'center';
        ctx.fillText('PAUSED', W/2, H/2 - 20);
        ctx.fillStyle = '#fff';
        ctx.font = '20px Arial';
        ctx.fillText('Press P or ESC to resume', W/2, H/2 + 30);
      }
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    
    const onKey = (e, down) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'r', 'R', 'Enter', 'p', 'P', 'Escape'].includes(e.key)) {
        e.preventDefault();
      }
      state.current.keys[e.key] = down;
      
      // Pause/Resume with P or Escape
      if (down && (e.key === 'p' || e.key === 'P' || e.key === 'Escape')) {
        const s = state.current;
        if (s.mode === 'FLIGHT' || s.mode === 'CITY') {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }
      }
      
      if (down && e.key === 'Enter') {
        const s = state.current;
        if (s.mode === 'INTRO') {
          s.mode = 'FLIGHT';
          s.lives = LIVES;
          s.energy = MAX_ENERGY;
          s.segIdx = 0;
          s.score = 0;
          s.goodies = [];
          s.lastGoodyTime = 0;
          s.inFinalShaft = false;
          s.lastFrameTime = 0;
          // Initialize segment directly
          s.scrollX = 0;
          s.seg = genFlight(SEGMENTS[0].id);
          s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
          s.readyTime = performance.now();
          setTick(t => t + 1);
        } else if (s.mode === 'TITLE') {
          s.mode = 'INTRO';
          setTick(t => t + 1);
        } else if (s.mode === 'WIN' || s.mode === 'GAME_OVER') {
          Object.assign(s, {
            mode: 'TITLE', lives: LIVES, energy: MAX_ENERGY, segIdx: 0,
            px: 150, py: 250, vx: 0, vy: 0, ground: false,
            scrollX: 0, seg: null, cityLvl: null, delivered: 0, doneCh: [], canExit: false,
            inv: 0, msg: '', msgT: 0, beam: null, dissolvingFogs: [], fogPauseStart: 0, zap: null, wind: null, windWarning: null, lastWindTime: 0, lastRespawnTime: 0, airJumpsUsed: 0, readyTime: 0,
            score: 0, goodies: [], lastGoodyTime: 0, inFinalShaft: false
          });
        }
      }
    };
    
    const kd = (e) => onKey(e, true);
    const ku = (e) => onKey(e, false);
    const blur = () => { state.current.keys = {}; };
    
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }, [update, draw, initSeg]);
  
  const togglePause = () => {
    const s = state.current;
    if (s.mode === 'FLIGHT' || s.mode === 'CITY') {
      pausedRef.current = !pausedRef.current;
      setPaused(pausedRef.current);
    }
  };

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      alignItems: 'center', 
      justifyContent: 'center', 
      minHeight: '100vh',
      width: '100vw',
      position: 'fixed',
      top: 0,
      left: 0,
      background: 'linear-gradient(180deg, #1a0a2e 0%, #16213e 50%, #0f3460 100%)', 
      padding: mobile ? 10 : 20,
      boxSizing: 'border-box',
      margin: 0,
      fontFamily: '"Press Start 2P", "Courier New", monospace',
      overflow: 'auto',
      // Prevent text selection on mobile
      userSelect: mobile ? 'none' : 'auto',
      WebkitUserSelect: mobile ? 'none' : 'auto',
      WebkitTouchCallout: mobile ? 'none' : 'auto'
    }}
    onContextMenu={mobile ? (e) => e.preventDefault() : undefined}
    >
      {/* Retro Christmas decorations */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'repeating-linear-gradient(90deg, #ff0000 0px, #ff0000 20px, #00ff00 20px, #00ff00 40px)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: 'repeating-linear-gradient(90deg, #00ff00 0px, #00ff00 20px, #ff0000 20px, #ff0000 40px)' }} />
      
      {/* Neon title - smaller on mobile */}
      <h1 style={{ 
        color: '#ff6b6b', 
        textShadow: '0 0 10px #ff0000, 0 0 20px #ff0000, 0 0 30px #ff0000, 0 0 40px #ff0000',
        fontSize: mobile ? 16 : 28,
        marginBottom: mobile ? 5 : 10,
        letterSpacing: mobile ? 2 : 4,
        fontFamily: '"Press Start 2P", "Courier New", monospace'
      }}>
        🎅 SANTA SLEIGH RUN 🎄
      </h1>
      
      {/* Pause button */}
      <button 
        onClick={togglePause}
        style={{
          position: 'absolute',
          top: mobile ? 15 : 20,
          right: mobile ? 10 : 20,
          padding: mobile ? '8px 12px' : '10px 20px',
          fontSize: mobile ? 10 : 14,
          fontFamily: '"Press Start 2P", "Courier New", monospace',
          background: paused ? 'linear-gradient(180deg, #00ff00, #008800)' : 'linear-gradient(180deg, #ff6b6b, #cc0000)',
          color: '#fff',
          border: '3px solid #ffd700',
          borderRadius: 5,
          cursor: 'pointer',
          boxShadow: paused ? '0 0 15px #00ff00' : '0 0 15px #ff0000',
          textShadow: '2px 2px 0 #000',
          zIndex: 10
        }}
      >
        {paused ? '▶ RESUME' : '⏸ PAUSE'}
      </button>
      
      <canvas 
        ref={canvasRef} 
        width={W} 
        height={H} 
        onClick={(e) => {
          const s = state.current;
          if (s.mode === 'DC_INTERSTITIAL' && dcCountdown === 0 && s.dcButtonBounds) {
            const rect = e.target.getBoundingClientRect();
            const scaleX = W / rect.width;
            const scaleY = H / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            const btn = s.dcButtonBounds;
            
            if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
              // Start countdown
              setDcCountdown(3);
              let count = 3;
              dcCountdownRef.current = setInterval(() => {
                count--;
                setDcCountdown(count);
                if (count <= 0) {
                  clearInterval(dcCountdownRef.current);
                  s.mode = 'FLIGHT';
                  s.scrollX = 0;
                  s.seg = genFlight(SEGMENTS[s.segIdx].id);
                  s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
                  s.readyTime = performance.now();
                  setDcCountdown(0);
                  setTick(t => t + 1);
                }
              }, 1000);
            }
          }
        }}
        onTouchEnd={(e) => {
          const s = state.current;
          if (s.mode === 'DC_INTERSTITIAL' && dcCountdown === 0 && s.dcButtonBounds) {
            const rect = e.target.getBoundingClientRect();
            const touch = e.changedTouches[0];
            const scaleX = W / rect.width;
            const scaleY = H / rect.height;
            const x = (touch.clientX - rect.left) * scaleX;
            const y = (touch.clientY - rect.top) * scaleY;
            const btn = s.dcButtonBounds;
            
            if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
              e.preventDefault();
              setDcCountdown(3);
              let count = 3;
              dcCountdownRef.current = setInterval(() => {
                count--;
                setDcCountdown(count);
                if (count <= 0) {
                  clearInterval(dcCountdownRef.current);
                  s.mode = 'FLIGHT';
                  s.scrollX = 0;
                  s.seg = genFlight(SEGMENTS[s.segIdx].id);
                  s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
                  s.readyTime = performance.now();
                  setDcCountdown(0);
                  setTick(t => t + 1);
                }
              }, 1000);
            }
          }
        }}
        style={{ 
          border: '4px solid #ffd700', 
          borderRadius: 8, 
          boxShadow: '0 0 30px rgba(255,215,0,0.5), 0 0 60px rgba(255,0,0,0.3), inset 0 0 30px rgba(0,0,0,0.5)',
          width: mobile ? 'calc(100vw - 20px)' : W,
          height: mobile ? `calc((100vw - 20px) * ${H/W})` : H,
          maxWidth: '100%',
          cursor: state.current.mode === 'DC_INTERSTITIAL' ? 'pointer' : 'default'
        }} 
        tabIndex={0} 
      />
      
      {/* INTRO screen "Let's go!" button - always rendered but hidden when not in INTRO mode */}
      <button
        onClick={() => {
          const s = state.current;
          if (s.mode === 'INTRO') {
            s.mode = 'FLIGHT';
            s.lives = LIVES;
            s.energy = MAX_ENERGY;
            s.segIdx = 0;
            s.score = 0;
            s.goodies = [];
            s.lastGoodyTime = 0;
            s.inFinalShaft = false;
            s.lastFrameTime = 0;
            // Initialize segment directly
            s.scrollX = 0;
            s.seg = genFlight(SEGMENTS[0].id);
            s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
            s.readyTime = performance.now();
            setTick(t => t + 1);
          }
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          const s = state.current;
          if (s.mode === 'INTRO') {
            s.mode = 'FLIGHT';
            s.lives = LIVES;
            s.energy = MAX_ENERGY;
            s.segIdx = 0;
            s.score = 0;
            s.goodies = [];
            s.lastGoodyTime = 0;
            s.inFinalShaft = false;
            s.lastFrameTime = 0;
            s.scrollX = 0;
            s.seg = genFlight(SEGMENTS[0].id);
            s.px = 150; s.py = 250; s.vx = 0; s.vy = 0;
            s.readyTime = performance.now();
            setTick(t => t + 1);
          }
        }}
        style={{
          display: state.current.mode === 'INTRO' ? 'block' : 'none',
          marginTop: 20,
          padding: mobile ? '15px 40px' : '18px 50px',
          fontSize: mobile ? 18 : 22,
          fontFamily: '"Press Start 2P", "Courier New", monospace',
          background: 'linear-gradient(180deg, #ff6b6b, #cc0000)',
          color: '#fff',
          border: '4px solid #ffd700',
          borderRadius: 12,
          cursor: 'pointer',
          boxShadow: '0 0 25px #ff6b6b, 0 0 50px rgba(255,107,107,0.5)',
          textShadow: '2px 2px 0 #000',
          animation: 'pulse 1s infinite',
          transition: 'transform 0.1s',
          position: 'relative',
          zIndex: 100
        }}
        onMouseOver={(e) => e.target.style.transform = 'scale(1.05)'}
        onMouseOut={(e) => e.target.style.transform = 'scale(1)'}
      >
        🎅 Let's go! 🦌
      </button>
      
      {/* Mobile START button */}
      {mobile && state.current.mode === 'TITLE' && (
        <button
          onClick={() => {
            const s = state.current;
            if (s.mode === 'TITLE') {
              s.mode = 'INTRO';
              setTick(t => t + 1); // Force re-render
            }
          }}
          style={{
            marginTop: 15,
            padding: '15px 40px',
            fontSize: 18,
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            background: 'linear-gradient(180deg, #00ff00, #008800)',
            color: '#fff',
            border: '4px solid #ffd700',
            borderRadius: 10,
            cursor: 'pointer',
            boxShadow: '0 0 20px #00ff00, 0 0 40px #00ff00',
            textShadow: '2px 2px 0 #000',
            animation: 'pulse 1s infinite'
          }}
        >
          🎮 START GAME
        </button>
      )}
      
      {/* Mobile PLAY AGAIN button */}
      {mobile && (state.current.mode === 'WIN' || state.current.mode === 'GAME_OVER') && (
        <button
          onClick={() => {
            const s = state.current;
            Object.assign(s, {
              mode: 'TITLE', lives: LIVES, energy: MAX_ENERGY, segIdx: 0,
              px: 150, py: 250, vx: 0, vy: 0, ground: false,
              scrollX: 0, seg: null, cityLvl: null, delivered: 0, doneCh: [], canExit: false,
              inv: 0, msg: '', msgT: 0, beam: null, dissolvingFogs: [], fogPauseStart: 0, zap: null, wind: null, windWarning: null, lastWindTime: 0, lastRespawnTime: 0, airJumpsUsed: 0, readyTime: 0,
              score: 0, goodies: [], lastGoodyTime: 0, inFinalShaft: false
            });
            setTick(t => t + 1); // Force re-render
          }}
          style={{
            marginTop: 15,
            padding: '15px 30px',
            fontSize: 14,
            fontFamily: '"Press Start 2P", "Courier New", monospace',
            background: 'linear-gradient(180deg, #ffd700, #cc9900)',
            color: '#000',
            border: '4px solid #fff',
            borderRadius: 10,
            cursor: 'pointer',
            boxShadow: '0 0 20px #ffd700',
            textShadow: '1px 1px 0 #fff'
          }}
        >
          🔄 PLAY AGAIN
        </button>
      )}
      
      {/* Mobile controls */}
      {mobile && (
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          width: '100%', 
          maxWidth: '100%',
          marginTop: 10,
          padding: '0 5px',
          boxSizing: 'border-box'
        }}>
          {/* D-Pad on left */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(3, 44px)', 
            gridTemplateRows: 'repeat(3, 44px)',
            gap: 2 
          }}>
            <div />
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys['ArrowUp'] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys['ArrowUp'] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={mobileButtonStyle}
            >▲</button>
            <div />
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys['ArrowLeft'] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys['ArrowLeft'] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={mobileButtonStyle}
            >◀</button>
            <div style={{ ...mobileButtonStyle, background: '#333' }} />
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys['ArrowRight'] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys['ArrowRight'] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={mobileButtonStyle}
            >▶</button>
            <div />
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys['ArrowDown'] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys['ArrowDown'] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={mobileButtonStyle}
            >▼</button>
            <div />
          </div>
          
          {/* A/B buttons on right */}
          <div style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys['r'] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys['r'] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ 
                ...mobileButtonStyle, 
                width: 55, 
                height: 55, 
                borderRadius: '50%',
                background: 'linear-gradient(180deg, #4a90d9, #2563eb)',
                fontSize: 12
              }}
            >B<br/><span style={{fontSize: 7}}>Nose</span></button>
            <button 
              onTouchStart={(e) => { e.preventDefault(); state.current.keys[' '] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); state.current.keys[' '] = false; }}
              onContextMenu={(e) => e.preventDefault()}
              style={{ 
                ...mobileButtonStyle, 
                width: 65, 
                height: 65, 
                borderRadius: '50%',
                background: 'linear-gradient(180deg, #ff6b6b, #cc0000)',
                fontSize: 14
              }}
            >A<br/><span style={{fontSize: 7}}>Fly/Jump</span></button>
          </div>
        </div>
      )}
      
      {/* Retro control instructions - different for mobile vs desktop */}
      {!mobile && (
        <div style={{ 
          color: '#00ff00', 
          marginTop: 20, 
          textAlign: 'center', 
          fontSize: 10,
          textShadow: '0 0 10px #00ff00',
          letterSpacing: 1
        }}>
          <p style={{ margin: '8px 0', color: '#ff6b6b', textShadow: '0 0 10px #ff0000' }}>
            ✈️ FLIGHT: ↑↓←→ Steer | SPACE Thrust | R Clear Fog
          </p>
          <p style={{ margin: '8px 0', color: '#00ffff', textShadow: '0 0 10px #00ffff' }}>
            🏙️ CITY: ←→ Move | SPACE Jump/Triple-Jump | Deliver to chimneys!
          </p>
          <p style={{ margin: '8px 0', color: '#ffd700', textShadow: '0 0 10px #ffd700' }}>
            ⏸️ Press P or ESC to Pause
          </p>
        </div>
      )}
      
      {mobile && (
        <div style={{ 
          color: '#00ff00', 
          marginTop: 10, 
          textAlign: 'center', 
          fontSize: 8,
          textShadow: '0 0 10px #00ff00'
        }}>
          <p style={{ margin: '4px 0', color: '#fff' }}>
            D-Pad: Move | A: Fly/Jump | B: Rudolph's Nose
          </p>
        </div>
      )}
      
      {/* Retro decorative text */}
      <div style={{
        position: 'absolute',
        bottom: mobile ? 5 : 20,
        color: '#ff00ff',
        fontSize: mobile ? 6 : 8,
        textShadow: '0 0 5px #ff00ff',
        letterSpacing: 2
      }}>
        ★ MERRY CHRISTMAS ★ HAPPY HOLIDAYS ★ 
      </div>
    </div>
  );
}

// Mobile button style
const mobileButtonStyle = {
  width: 44,
  height: 44,
  borderRadius: 8,
  border: '2px solid #ffd700',
  background: 'linear-gradient(180deg, #444, #222)',
  color: '#fff',
  fontSize: 18,
  fontWeight: 'bold',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent'
};
