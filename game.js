(() => {
  'use strict';

  const W = 480;
  const H = 720;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const $ = (id) => document.getElementById(id);

  const ui = {
    menu: $('menu'), pause: $('pause'), gameover: $('gameover'),
    score: $('score'), wave: $('wave'), high: $('highScore'),
    final: $('finalScore'), newRecord: $('newRecord'),
    lives: $('lives'), status: $('statusText'), power: $('powerText'),
    start: $('startBtn'), restart: $('restartBtn'), resume: $('resumeBtn'), mute: $('muteBtn')
  };

  const COLORS = {
    cyan: '#6aebff', pink: '#ff4fd8', lime: '#b8ff5c',
    violet: '#a78bfa', danger: '#ff5a6e', white: '#eaf7ff'
  };

  const keys = new Set();
  const pointer = { x: W / 2, y: H - 110, active: false };
  let dpr = 1;

  function resize() {
    dpr = Math.min(2.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const stars = [];
  for (let i = 0; i < 130; i += 1) {
    stars.push({ x: rand(0, W), y: rand(0, H), z: rand(0.25, 1), size: rand(0.5, 1.8) });
  }

  const game = {
    mode: 'menu',
    time: 0,
    score: 0,
    wave: 1,
    high: Number(localStorage.getItem('neon-shooter-high') || 0),
    shake: 0,
    spawnTimer: 0.6,
    waveTimer: 0,
    bossSpawned: false,
    player: null,
    bullets: [],
    enemyBullets: [],
    enemies: [],
    particles: [],
    powerups: [],
    messages: []
  };

  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
    }
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      return this.ctx;
    }
    play(type) {
      if (this.muted) return;
      const ac = this.ensure();
      if (!ac) return;
      if (ac.state === 'suspended') ac.resume();
      const now = ac.currentTime;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const config = {
        shoot: [880, 0.035, 'square', 0.035],
        hit: [180, 0.08, 'sawtooth', 0.05],
        explode: [70, 0.32, 'triangle', 0.08],
        power: [520, 0.22, 'sine', 0.07],
        hurt: [120, 0.3, 'sawtooth', 0.11],
        over: [55, 0.7, 'triangle', 0.12]
      }[type] || [440, 0.1, 'sine', 0.05];
      osc.type = config[2];
      osc.frequency.setValueAtTime(config[0], now);
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, config[0] * 0.45), now + config[1]);
      gain.gain.setValueAtTime(config[3], now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + config[1]);
      osc.connect(gain).connect(ac.destination);
      osc.start(now);
      osc.stop(now + config[1] + 0.02);
    }
  }
  const sound = new Sound();

  function playerShip() {
    return {
      x: W / 2,
      y: H - 110,
      r: 13,
      speed: 360,
      lives: 4,
      maxLives: 5,
      fireTimer: 0,
      baseCooldown: 0.155,
      rapid: 0,
      shield: 1,
      invuln: 3,
      alive: true
    };
  }

  function resetGame() {
    game.mode = 'playing';
    game.time = 0;
    game.score = 0;
    game.wave = 1;
    game.shake = 0;
    game.spawnTimer = 0.9;
    game.waveTimer = 0;
    game.bossSpawned = false;
    game.player = playerShip();
    game.bullets = [];
    game.enemyBullets = [];
    game.enemies = [];
    game.particles = [];
    game.powerups = [];
    game.messages = [];
    keys.clear();
    pointer.x = W / 2;
    pointer.y = H - 110;
    pointer.active = false;
    setOverlay('none');
    updateHud();
  }

  function setOverlay(which) {
    ui.menu.classList.toggle('hidden', which !== 'menu');
    ui.pause.classList.toggle('hidden', which !== 'pause');
    ui.gameover.classList.toggle('hidden', which !== 'gameover');
  }

  function updateHud() {
    ui.score.textContent = String(game.score);
    ui.wave.textContent = String(game.wave);
    ui.high.textContent = String(game.high);
    const p = game.player;
    ui.lives.replaceChildren();
    if (p) {
      for (let i = 0; i < p.maxLives; i += 1) {
        const span = document.createElement('span');
        span.className = 'life' + (i < p.lives ? '' : ' lost');
        ui.lives.appendChild(span);
      }
      const parts = [];
      if (p.rapid > 0) parts.push('⚡ 连射 ' + Math.ceil(p.rapid) + 's');
      if (p.shield > 0) parts.push('🛡 护盾');
      if (p.invuln > 0.15) parts.push('✦ 无敌');
      ui.power.textContent = parts.join(' · ');
    } else {
      ui.lives.replaceChildren();
      ui.power.textContent = '';
    }
    ui.status.textContent = game.mode === 'playing' ? (game.wave % 5 === 0 ? '警告：旗舰接近' : '战斗中') : (game.mode === 'paused' ? '已暂停' : '准备起飞');
  }

  function addParticles(x, y, count, color, power = 1) {
    for (let i = 0; i < count; i += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(40, 260) * power;
      game.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: rand(0.25, 0.9),
        maxLife: 0.9,
        size: rand(1, 3.6) * power,
        color
      });
    }
  }

  function message(text, color = COLORS.cyan) {
    game.messages.push({ text, color, life: 1.4 });
  }

  function spawnEnemy() {
    const p = game.player;
    if (!p) return;
    const wave = game.wave;
    const isBoss = wave % 5 === 0 && !game.bossSpawned && game.enemies.length < 5;
    if (isBoss) {
      game.bossSpawned = true;
      game.enemies.push({
        x: W / 2, y: -80, r: 38, hp: 42 + wave * 8, maxHp: 42 + wave * 8,
        type: 'boss', speed: 34, shoot: 1.2, phase: 0, score: 500,
        flash: 0
      });
      message('⚠ 旗舰进入战场', COLORS.danger);
      sound.play('hurt');
      return;
    }
    const roll = Math.random();
    let type = 'scout';
    if (wave >= 3 && roll > 0.68) type = 'zig';
    if (wave >= 5 && roll > 0.86) type = 'tank';
    const base = {
      scout: { r: 14, hp: 1, speed: 130, shoot: 1.4, score: 10, color: COLORS.pink },
      zig: { r: 17, hp: 3, speed: 96, shoot: 1.7, score: 25, color: COLORS.violet },
      tank: { r: 24, hp: 8, speed: 56, shoot: 2.0, score: 60, color: COLORS.danger }
    }[type];
    game.enemies.push({
      x: rand(34, W - 34), y: -40, r: base.r,
      hp: base.hp + Math.floor(wave / 4), maxHp: base.hp + Math.floor(wave / 4),
      type, speed: base.speed * rand(0.85, 1.2), shoot: rand(0.8, base.shoot),
      phase: rand(0, Math.PI * 2), score: base.score, color: base.color, flash: 0
    });
  }

  function shootPlayer() {
    const p = game.player;
    if (!p) return;
    const cooldown = p.rapid > 0 ? 0.065 : p.baseCooldown;
    if (p.fireTimer > 0) return;
    p.fireTimer = cooldown;
    let target = null;
    let best = Infinity;
    for (const e of game.enemies) {
      if (e.y > p.y - 10) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < best) { best = d; target = e; }
    }
    const base = target ? Math.atan2(target.y - p.y, target.x - p.x) : -Math.PI / 2;
    const angles = p.rapid > 0 ? [base - 0.045, base, base + 0.045] : [base];
    for (const angle of angles) {
      game.bullets.push({
        x: p.x + Math.cos(angle) * 16,
        y: p.y + Math.sin(angle) * 16,
        vx: Math.cos(angle) * 900,
        vy: Math.sin(angle) * 900,
        r: 3,
        damage: 1
      });
    }
    sound.play('shoot');
  }

  function enemyShoot(e) {
    const p = game.player;
    if (!p) return;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = e.type === 'boss' ? 230 : 190;
    if (e.type === 'boss') {
      for (let i = -2; i <= 2; i += 1) {
        const angle = Math.atan2(dy, dx) + i * 0.18;
        game.enemyBullets.push({ x: e.x, y: e.y + 18, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 5 });
      }
    } else {
      game.enemyBullets.push({ x: e.x, y: e.y + e.r, vx: (dx / len) * speed, vy: (dy / len) * speed, r: 4 });
    }
  }

  function dropPowerup(x, y) {
    if (Math.random() > 0.095) return;
    const type = pick(['rapid', 'rapid', 'shield', 'shield', 'life']);
    game.powerups.push({ x, y, vy: 80, type, spin: 0, r: 12 });
  }

  function hitPlayer() {
    const p = game.player;
    if (!p || p.invuln > 0) return;
    if (p.shield > 0) {
      p.shield = 0;
      p.invuln = 1.1;
      game.shake = 9;
      addParticles(p.x, p.y, 24, COLORS.cyan, 1.2);
      sound.play('hit');
      message('护盾抵消', COLORS.cyan);
      return;
    }
    p.lives -= 1;
    p.invuln = 2.8;
    p.rapid = 0;
    game.shake = 16;
    addParticles(p.x, p.y, 46, COLORS.danger, 1.4);
    sound.play('hurt');
    if (p.lives <= 0) {
      p.alive = false;
      game.mode = 'gameover';
      sound.play('over');
      addParticles(p.x, p.y, 90, COLORS.pink, 1.8);
      finishGame();
    } else {
      message('战机受损', COLORS.danger);
      p.x = W / 2;
      p.y = H - 110;
    }
    updateHud();
  }

  function finishGame() {
    if (game.score > game.high) {
      game.high = game.score;
      localStorage.setItem('neon-shooter-high', String(game.high));
      ui.newRecord.classList.remove('hidden');
    } else {
      ui.newRecord.classList.add('hidden');
    }
    ui.final.textContent = String(game.score);
    ui.high.textContent = String(game.high);
    setTimeout(() => {
      if (game.mode === 'gameover') setOverlay('gameover');
    }, 420);
  }

  function update(dt) {
    game.time += dt;
    game.wave = 1 + Math.floor(game.time / 22);
    game.waveTimer += dt;
    if (game.waveTimer >= 22) {
      game.waveTimer = 0;
      game.bossSpawned = false;
      game.spawnTimer = Math.min(game.spawnTimer, 0.4);
      message('WAVE ' + game.wave, COLORS.cyan);
    }
    game.shake = Math.max(0, game.shake - dt * 40);

    const p = game.player;
    if (!p) return;
    p.invuln = Math.max(0, p.invuln - dt);
    p.rapid = Math.max(0, p.rapid - dt);
    p.fireTimer = Math.max(0, p.fireTimer - dt);

    const speed = p.speed * dt;
    let dx = 0;
    let dy = 0;
    if (keys.has('arrowleft') || keys.has('a')) dx -= 1;
    if (keys.has('arrowright') || keys.has('d')) dx += 1;
    if (keys.has('arrowup') || keys.has('w')) dy -= 1;
    if (keys.has('arrowdown') || keys.has('s')) dy += 1;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      p.x += (dx / len) * speed;
      p.y += (dy / len) * speed;
      pointer.active = false;
    } else if (pointer.active) {
      const tx = pointer.x - p.x;
      const ty = pointer.y - p.y;
      const dist = Math.hypot(tx, ty);
      const step = Math.min(dist, speed * 1.55);
      if (dist > 0.5) {
        p.x += (tx / dist) * step;
        p.y += (ty / dist) * step;
      }
    }
    p.x = clamp(p.x, p.r + 8, W - p.r - 8);
    p.y = clamp(p.y, p.r + 8, H - p.r - 8);
    shootPlayer();

    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0) {
      game.spawnTimer = Math.max(0.28, 1.15 - game.wave * 0.045) * rand(0.75, 1.2);
      spawnEnemy();
    }

    for (const star of stars) {
      star.y += (24 + star.z * 90) * dt;
      if (star.y > H) {
        star.y = -2;
        star.x = rand(0, W);
      }
    }

    for (const b of game.bullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    game.bullets = game.bullets.filter((b) => b.y > -30 && b.x > -30 && b.x < W + 30);

    for (const e of game.enemies) {
      e.phase += dt;
      if (e.type === 'zig') {
        e.x += Math.sin(e.phase * 3.2) * 120 * dt;
        e.y += e.speed * dt;
      } else if (e.type === 'boss') {
        e.y = Math.min(130, e.y + e.speed * dt);
        e.x = W / 2 + Math.sin(e.phase * 0.9) * (W * 0.32);
      } else {
        e.y += e.speed * dt;
      }
      e.x = clamp(e.x, e.r, W - e.r);
      e.flash = Math.max(0, e.flash - dt * 5);
      if (e.y > 0 && e.y < H - 120) {
        e.shoot -= dt;
        if (e.shoot <= 0) {
          e.shoot = e.type === 'boss' ? 0.55 : rand(1.4, 2.8);
          enemyShoot(e);
        }
      }
    }

    for (const b of game.enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    game.enemyBullets = game.enemyBullets.filter((b) => b.y > -40 && b.y < H + 40 && b.x > -40 && b.x < W + 40);

    for (const pu of game.powerups) {
      pu.y += pu.vy * dt;
      pu.spin += dt * 3;
    }
    game.powerups = game.powerups.filter((pu) => pu.y < H + 30);

    for (const e of [...game.enemies]) {
      for (const b of game.bullets) {
        if (b.dead) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
          b.dead = true;
          e.hp -= b.damage;
          e.flash = 1;
          addParticles(b.x, b.y, 5, e.color, 0.6);
          sound.play('hit');
          if (e.hp <= 0) {
            e.dead = true;
            game.score += e.score;
            game.shake = e.type === 'boss' ? 22 : 6;
            addParticles(e.x, e.y, e.type === 'boss' ? 80 : 22, e.color, e.type === 'boss' ? 1.8 : 1);
            sound.play('explode');
            dropPowerup(e.x, e.y);
            if (e.type === 'boss') message('旗舰击破 +' + e.score, COLORS.lime);
            updateHud();
          }
          break;
        }
      }
    }
    game.bullets = game.bullets.filter((b) => !b.dead);
    game.enemies = game.enemies.filter((e) => !e.dead && e.y < H + 100);

    for (const b of [...game.enemyBullets]) {
      if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r) {
        b.dead = true;
        hitPlayer();
      }
    }
    game.enemyBullets = game.enemyBullets.filter((b) => !b.dead);

    for (const e of [...game.enemies]) {
      if (Math.hypot(p.x - e.x, p.y - e.y) < p.r + e.r) {
        e.dead = true;
        e.hp = 0;
        addParticles(e.x, e.y, 20, e.color, 1);
        hitPlayer();
      }
    }
    game.enemies = game.enemies.filter((e) => !e.dead);

    for (const pu of [...game.powerups]) {
      if (Math.hypot(p.x - pu.x, p.y - pu.y) < p.r + pu.r) {
        pu.dead = true;
        if (pu.type === 'rapid') {
          p.rapid = 8;
          message('⚡ 连射', COLORS.lime);
        } else if (pu.type === 'shield') {
          p.shield = 1;
          message('🛡 护盾', COLORS.cyan);
        } else {
          p.lives = Math.min(p.maxLives, p.lives + 1);
          message('❤ 额外生命', COLORS.pink);
        }
        sound.play('power');
        addParticles(pu.x, pu.y, 18, COLORS.lime, 1);
        updateHud();
      }
    }
    game.powerups = game.powerups.filter((pu) => !pu.dead);

    for (const part of game.particles) {
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.vx *= 0.98;
      part.vy *= 0.98;
      part.life -= dt;
    }
    game.particles = game.particles.filter((part) => part.life > 0);
    for (const m of game.messages) m.life -= dt;
    game.messages = game.messages.filter((m) => m.life > 0);
  }

  function drawShip(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    const blink = p.invuln > 0 && Math.floor(performance.now() / 90) % 2 === 0;
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 18;
    ctx.fillStyle = COLORS.cyan;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(12, 8);
    ctx.lineTo(5, 6);
    ctx.lineTo(0, 14);
    ctx.lineTo(-5, 6);
    ctx.lineTo(-12, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0a2233';
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 4);
    ctx.lineTo(0, 8);
    ctx.lineTo(-6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = COLORS.pink;
    ctx.fillRect(-4, -26, 8, 7);
    const flame = rand(6, 16);
    ctx.fillStyle = 'rgba(106,235,255,0.65)';
    ctx.beginPath();
    ctx.moveTo(-4, 14);
    ctx.lineTo(0, 14 + flame);
    ctx.lineTo(4, 14);
    ctx.closePath();
    ctx.fill();
    if (p.shield > 0) {
      ctx.strokeStyle = 'rgba(106,235,255,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 24 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = e.color;
    ctx.shadowBlur = e.flash > 0 ? 28 : 12;
    ctx.fillStyle = e.flash > 0 ? '#ffffff' : e.color;
    if (e.type === 'boss') {
      ctx.beginPath();
      ctx.moveTo(0, -34);
      ctx.lineTo(44, -6);
      ctx.lineTo(28, 26);
      ctx.lineTo(0, 16);
      ctx.lineTo(-28, 26);
      ctx.lineTo(-44, -6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1b0a2b';
      ctx.beginPath();
      ctx.arc(0, -4, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.lime;
      ctx.beginPath();
      ctx.arc(0, -4, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -4, 22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.type === 'tank') {
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(22, 0);
      ctx.lineTo(0, 22);
      ctx.lineTo(-22, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a1024';
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.danger;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.type === 'zig') {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-12, -12, 24, 24);
      ctx.fillStyle = '#1a1024';
      ctx.fillRect(-5, -5, 10, 10);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, 18);
      ctx.lineTo(14, -10);
      ctx.lineTo(0, -4);
      ctx.lineTo(-14, -10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1a1024';
      ctx.beginPath();
      ctx.arc(0, 2, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    const shakeX = game.shake ? rand(-game.shake, game.shake) : 0;
    const shakeY = game.shake ? rand(-game.shake, game.shake) : 0;
    ctx.translate(shakeX, shakeY);
    ctx.clearRect(-20, -20, W + 40, H + 40);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#040711');
    bg.addColorStop(0.55, '#07111f');
    bg.addColorStop(1, '#03040a');
    ctx.fillStyle = bg;
    ctx.fillRect(-20, -20, W + 40, H + 40);

    for (const star of stars) {
      ctx.globalAlpha = 0.25 + star.z * 0.6;
      ctx.fillStyle = star.z > 0.8 ? COLORS.cyan : '#9cc8e8';
      ctx.fillRect(star.x, star.y, star.size, star.size);
    }
    ctx.globalAlpha = 1;

    for (const b of game.bullets) {
      ctx.shadowColor = COLORS.cyan;
      ctx.shadowBlur = 12;
      ctx.fillStyle = COLORS.cyan;
      ctx.fillRect(b.x - 2, b.y - 10, 4, 14);
    }
    for (const b of game.enemyBullets) {
      ctx.shadowColor = COLORS.pink;
      ctx.shadowBlur = 12;
      ctx.fillStyle = COLORS.pink;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const pu of game.powerups) {
      const color = pu.type === 'rapid' ? COLORS.lime : pu.type === 'shield' ? COLORS.cyan : COLORS.pink;
      ctx.save();
      ctx.translate(pu.x, pu.y);
      ctx.rotate(pu.spin);
      ctx.shadowColor = color;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(-10, -10, 20, 20);
      ctx.fillStyle = color;
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pu.type === 'rapid' ? '⚡' : pu.type === 'shield' ? 'S' : '+', 0, 1);
      ctx.restore();
    }
    for (const e of game.enemies) drawEnemy(e);
    if (game.player && game.player.alive) drawShip(game.player);

    for (const part of game.particles) {
      ctx.globalAlpha = Math.max(0, part.life / part.maxLife);
      ctx.fillStyle = part.color;
      ctx.shadowColor = part.color;
      ctx.shadowBlur = 8;
      ctx.fillRect(part.x, part.y, part.size, part.size);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (game.player) {
      ctx.fillStyle = 'rgba(106,235,255,0.85)';
      ctx.font = 'bold 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('WAVE ' + String(game.wave).padStart(2, '0'), 18, H - 22);
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,79,216,0.9)';
      ctx.fillText('SCORE ' + String(game.score).padStart(6, '0'), W - 18, H - 22);
      if (game.player.rapid > 0) {
        ctx.fillStyle = COLORS.lime;
        ctx.fillText('RAPID ' + Math.ceil(game.player.rapid) + 's', W - 18, H - 40);
      }
    }

    let y = H / 2 - 40;
    for (const m of game.messages) {
      ctx.globalAlpha = Math.min(1, m.life * 2);
      ctx.fillStyle = m.color;
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(m.text, W / 2, y);
      y += 26;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    if (game.mode === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function setPointer(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = clamp(((event.clientX - rect.left) / rect.width) * W, 0, W);
    pointer.y = clamp(((event.clientY - rect.top) / rect.height) * H, 0, H);
    pointer.active = true;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (game.mode !== 'playing') return;
    canvas.setPointerCapture?.(event.pointerId);
    setPointer(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (game.mode !== 'playing') return;
    if (event.pointerType === 'mouse' || pointer.active) setPointer(event);
  });
  canvas.addEventListener('pointerup', () => { if (game.mode === 'playing') pointer.active = false; });
  canvas.addEventListener('pointercancel', () => { pointer.active = false; });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) event.preventDefault();
    keys.add(key);
    if (key === 'p' || key === 'escape') togglePause();
    if (key === 'r' && game.mode !== 'menu') resetGame();
    if (key === 'm') toggleMute();
    if ((key === 'enter' || key === ' ') && game.mode === 'menu') resetGame();
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

  function togglePause() {
    if (game.mode === 'playing') {
      game.mode = 'paused';
      setOverlay('pause');
    } else if (game.mode === 'paused') {
      game.mode = 'playing';
      setOverlay('none');
      last = performance.now();
    }
    updateHud();
  }

  function toggleMute() {
    sound.muted = !sound.muted;
    ui.mute.textContent = sound.muted ? '🔇 音效关' : '🔊 音效开';
    ui.mute.setAttribute('aria-pressed', String(sound.muted));
  }

  ui.start.addEventListener('click', () => { sound.ensure(); resetGame(); });
  ui.restart.addEventListener('click', () => { sound.ensure(); resetGame(); });
  ui.resume.addEventListener('click', togglePause);
  ui.mute.addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.mode === 'playing') togglePause();
  });

  ui.high.textContent = String(game.high);
  setOverlay('menu');
  updateHud();
})();
