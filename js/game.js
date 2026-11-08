/* 坦克大战 · 核心游戏 */
(function () {
  'use strict';

  const {
    TILE, COLS, ROWS, FIELD_W, FIELD_H, FIELD_X, FIELD_Y,
    CANVAS_W, CANVAS_H, T, CHAR_TO_TILE, DIRECTIONS, DIR_KEYS,
    PLAYER_SPAWN, PLAYER_ALT_SPAWN, ENEMY_SPAWNS, BASE_CELL, BASE_WALL_CELLS,
    LEVELS, DIFFICULTIES, LEVEL_COUNTS, ENEMY_TYPES, LEVEL_WEIGHTS,
    POWERUPS, POWERUP_WEIGHTS, PLAYER_POWER
  } = window.TB;

  const TAU = Math.PI * 2;
  const HI_SCORE_KEY = 'tank-battle-hi';
  const BULLET_RADIUS = 4;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const rand = (min, max) => min + Math.random() * (max - min);
  const randInt = (min, max) => Math.floor(rand(min, max + 1));
  const pad = (value, length) => String(Math.max(0, Math.floor(value))).padStart(length, '0');
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return dx * dx + dy * dy;
  };
  const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y;

  function hash2(x, y) {
    let n = Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 1442695040, 2246822519);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  }

  function roundedRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  class TankGame {
    constructor(options) {
      this.canvas = options.canvas;
      this.ctx = this.canvas.getContext('2d');
      this.audio = options.audio;
      this.input = options.input;
      this.onHud = options.onHud || function () {};
      this.onEnd = options.onEnd || function () {};
      this.onPauseChange = options.onPauseChange || function () {};

      this.difficultyKey = options.difficultyKey || 'classic';
      this.difficulty = DIFFICULTIES[this.difficultyKey] || DIFFICULTIES.classic;
      this.hiScore = this.loadHiScore();

      this.mode = 'menu';
      this.time = 0;
      this.runId = 0;
      this.levelIndex = 0;
      this.score = 0;
      this.kills = 0;
      this.lives = this.difficulty.lives;
      this.power = 0;
      this.remaining = 12;

      this.enemies = [];
      this.bullets = [];
      this.powerups = [];
      this.particles = [];
      this.floaters = [];
      this.wrecks = [];
      this.trackMarks = [];

      this.enemyQueue = [];
      this.spawnTimer = 0;
      this.spawnIndex = 0;
      this.freezeTimer = 0;
      this.shovelTimer = 0;
      this.levelClearTimer = 0;
      this.dyingTimer = 0;
      this.endReason = '';
      this.respawnTimer = 0;
      this.banner = null;
      this.base = null;
      this.baseAlive = true;
      this.player = null;

      this.shake = 0;
      this.flash = 0;
      this.flashColor = '#ffffff';
      this.hudClock = 0;
      this.hudAccumulator = 0;
      this.hudSignature = '';
      this.smokeTimer = 0;
      this.lastHudAt = -1;

      this.sprites = this.createTileSprites();
      this.initPreview();
      this.emitHud(true);
    }

    /* ------------------------------------------------------------------ */
    /* 初始化 / 关卡                                                      */
    /* ------------------------------------------------------------------ */

    loadHiScore() {
      try {
        const value = Number(localStorage.getItem(HI_SCORE_KEY));
        return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
      } catch (error) {
        return 0;
      }
    }

    saveHiScore() {
      try {
        localStorage.setItem(HI_SCORE_KEY, String(this.hiScore));
      } catch (error) {
        /* localStorage 不可用时静默降级 */
      }
    }

    initPreview() {
      this.runId += 1;
      this.levelIndex = 0;
      this.enemies = [];
      this.bullets = [];
      this.powerups = [];
      this.particles = [];
      this.floaters = [];
      this.wrecks = [];
      this.trackMarks = [];
      this.enemyQueue = [];
      this.baseAlive = true;
      this.freezeTimer = 0;
      this.shovelTimer = 0;
      this.respawnTimer = 0;
      this.score = 0;
      this.kills = 0;
      this.power = 0;
      this.lives = this.difficulty.lives;
      this.remaining = Math.max(8, LEVEL_COUNTS[0] + this.difficulty.countDelta);
      this.buildMap(0);
      this.player = this.createPlayer(false);
      this.player.shieldTimer = 0;
      this.mode = 'menu';
      this.banner = null;
    }

    setMenuDifficulty(key) {
      if (!DIFFICULTIES[key]) return;
      this.difficultyKey = key;
      this.difficulty = DIFFICULTIES[key];
      if (this.mode === 'menu') {
        this.lives = this.difficulty.lives;
        this.remaining = Math.max(8, LEVEL_COUNTS[0] + this.difficulty.countDelta);
        this.emitHud(true);
      }
    }

    startRun(difficultyKey) {
      if (difficultyKey && DIFFICULTIES[difficultyKey]) {
        this.difficultyKey = difficultyKey;
        this.difficulty = DIFFICULTIES[difficultyKey];
      }
      this.mode = 'playing';
      this.runId += 1;
      this.levelIndex = 0;
      this.score = 0;
      this.kills = 0;
      this.lives = this.difficulty.lives;
      this.power = 0;
      this.hiScore = Math.max(this.hiScore, this.loadHiScore());
      this.loadLevel(0);
      this.emitHud(true);
    }

    restart() {
      this.startRun(this.difficultyKey);
    }

    toMenu() {
      this.onPauseChange(false);
      this.initPreview();
      this.emitHud(true);
    }

    togglePause() {
      if (this.mode === 'playing') {
        this.mode = 'paused';
        this.onPauseChange(true);
        return true;
      }
      if (this.mode === 'paused') {
        this.mode = 'playing';
        this.onPauseChange(false);
        return true;
      }
      return false;
    }

    pause() {
      if (this.mode !== 'playing') return false;
      this.mode = 'paused';
      this.onPauseChange(true);
      return true;
    }

    resume() {
      if (this.mode !== 'paused') return false;
      this.mode = 'playing';
      this.onPauseChange(false);
      return true;
    }

    buildMap(levelIndex) {
      const definition = LEVELS[levelIndex % LEVELS.length];
      this.theme = definition;
      this.map = definition.map.map((row) => row.split('').map((char) => CHAR_TO_TILE[char] ?? T.EMPTY));
      this.base = {
        x: BASE_CELL.x,
        y: BASE_CELL.y,
        cx: FIELD_X + BASE_CELL.x * TILE + TILE / 2,
        cy: FIELD_Y + BASE_CELL.y * TILE + TILE / 2
      };
      this.baseAlive = true;
    }

    loadLevel(index) {
      this.mode = 'playing';
      this.levelIndex = index;
      this.buildMap(index);
      this.enemies = [];
      this.bullets = [];
      this.powerups = [];
      this.particles = [];
      this.floaters = [];
      this.wrecks = [];
      this.trackMarks = [];
      this.freezeTimer = 0;
      this.shovelTimer = 0;
      this.levelClearTimer = 0;
      this.dyingTimer = 0;
      this.respawnTimer = 0;
      this.spawnIndex = 0;
      this.spawnTimer = 2.7;
      this.enemyQueue = this.buildEnemyQueue(index);
      this.remaining = this.enemyQueue.length;
      this.player = this.createPlayer(true);
      this.banner = {
        title: `STAGE ${pad(index + 1, 2)}`,
        subtitle: `${this.theme.name}  ·  ${this.theme.nameEn}`,
        timer: 2.6,
        total: 2.6,
        color: this.theme.accent,
        kind: 'stage'
      };
      this.audio.play('stage');
      this.emitHud(true);
    }

    buildEnemyQueue(levelIndex) {
      const count = Math.max(8, LEVEL_COUNTS[levelIndex] + this.difficulty.countDelta);
      const weights = LEVEL_WEIGHTS[Math.min(levelIndex, LEVEL_WEIGHTS.length - 1)];
      const pool = [];
      Object.keys(weights).forEach((key) => {
        const weight = weights[key];
        for (let i = 0; i < Math.round(weight * 100); i += 1) pool.push(key);
      });
      if (!pool.length) pool.push('basic');

      const queue = [];
      for (let i = 0; i < count; i += 1) {
        const type = pool[randInt(0, pool.length - 1)];
        const bonus = i === 3 || i === 9 || (count > 18 && i === 15);
        queue.push({ type, bonus });
      }
      // 前两个敌人固定为轻型，让开场节奏更柔和。
      if (queue[0]) queue[0].type = 'basic';
      if (queue[1]) queue[1].type = 'basic';
      return queue;
    }

    findPlayerSpawnCell() {
      const candidates = [PLAYER_SPAWN, PLAYER_ALT_SPAWN];
      for (const cell of candidates) {
        const blocked = this.enemies.some((enemy) => {
          if (!enemy.alive || enemy.spawnTimer > 0) return false;
          const center = this.entityCenter(enemy);
          const point = this.cellCenter(cell.x, cell.y);
          return dist2(center.x, center.y, point.x, point.y) < 34 * 34;
        });
        if (!blocked) return cell;
      }
      return PLAYER_SPAWN;
    }

    createPlayer(withShield) {
      const cell = this.findPlayerSpawnCell();
      const point = this.cellCenter(cell.x, cell.y);
      const size = 38;
      return {
        x: point.x - size / 2,
        y: point.y - size / 2,
        w: size,
        h: size,
        dir: 'up',
        speed: 118,
        alive: true,
        shieldTimer: withShield ? 3.2 : 0,
        fireCd: 0,
        recoil: 0,
        trackTimer: 0,
        trackPhase: 0,
        slideTimer: 0,
        slideDir: 'up',
        onIce: false,
        moving: false,
        spawnFx: withShield ? 0.5 : 0
      };
    }

    /* ------------------------------------------------------------------ */
    /* 主循环                                                              */
    /* ------------------------------------------------------------------ */

    tick(dt) {
      this.time += dt;
      this.shake = Math.max(0, this.shake - dt * 30);
      this.flash = Math.max(0, this.flash - dt * 3.8);

      if (this.mode === 'playing') {
        this.updateGame(dt);
      } else if (this.mode === 'levelclear') {
        this.updateEffects(dt);
        this.levelClearTimer -= dt;
        if (this.levelClearTimer <= 0) this.advanceLevel();
      } else if (this.mode === 'dying') {
        this.updateEffects(dt);
        this.dyingTimer -= dt;
        if (this.dyingTimer <= 0) this.finishGameOver();
      } else if (this.mode === 'gameover' || this.mode === 'victory') {
        this.updateEffects(dt);
      }

      this.hudAccumulator += dt;
      if (this.mode === 'playing' && this.hudAccumulator >= 0.1) {
        this.hudAccumulator = 0;
        this.emitHud();
      }
    }

    updateGame(dt) {
      if (this.banner && this.banner.kind === 'stage') {
        this.banner.timer -= dt;
        if (this.banner.timer <= 0) this.banner = null;
      }

      if (this.freezeTimer > 0) this.freezeTimer = Math.max(0, this.freezeTimer - dt);

      if (this.shovelTimer > 0) {
        this.shovelTimer -= dt;
        if (this.shovelTimer <= 0) {
          this.shovelTimer = 0;
          this.restoreBaseWalls();
          this.addFloater('基地钢化结束', this.base.cx, this.base.cy - 34, '#f2b84b');
        }
      }

      this.updateSpawns(dt);
      this.updatePlayer(dt);
      if (this.mode !== 'playing') return;

      this.updateEnemies(dt);
      if (this.mode !== 'playing') return;

      this.updateBullets(dt);
      if (this.mode !== 'playing') return;

      this.updatePowerups(dt);
      this.updateEffects(dt);

      this.enemies = this.enemies.filter((enemy) => enemy.alive);
      this.powerups = this.powerups.filter((powerup) => powerup.alive);
      this.bullets = this.bullets.filter((bullet) => bullet.alive);

      this.checkLevelClear();
    }

    checkLevelClear() {
      const anyAlive = this.enemies.some((enemy) => enemy.alive);
      if (this.remaining <= 0 && !anyAlive && this.enemyQueue.length === 0 && this.mode === 'playing') {
        this.mode = 'levelclear';
        const bonus = 600 + this.levelIndex * 260;
        this.score += bonus;
        this.hiScore = Math.max(this.hiScore, this.score);
        this.saveHiScore();
        this.levelClearTimer = 3;
        this.banner = {
          title: 'STAGE CLEAR',
          subtitle: `过关奖励 +${bonus}  ·  准备进入下一关`,
          color: '#7ee2a1',
          kind: 'clear'
        };
        this.audio.play('stageClear');
        this.emitHud(true);
      }
    }

    advanceLevel() {
      if (this.levelIndex + 1 < LEVELS.length) {
        this.loadLevel(this.levelIndex + 1);
      } else {
        this.finishVictory();
      }
    }

    finishVictory() {
      if (this.mode === 'victory') return;
      this.mode = 'victory';
      this.hiScore = Math.max(this.hiScore, this.score);
      this.saveHiScore();
      this.audio.play('victory');
      this.emitHud(true);
      this.onEnd(this.endPayload(true, '全部关卡完成'));
    }

    finishGameOver() {
      if (this.mode === 'gameover') return;
      this.mode = 'gameover';
      this.hiScore = Math.max(this.hiScore, this.score);
      this.saveHiScore();
      this.emitHud(true);
      this.onEnd(this.endPayload(false, this.endReason));
    }

    endPayload(victory, reason) {
      return {
        victory,
        reason,
        score: this.score,
        hiScore: this.hiScore,
        level: this.levelIndex + 1,
        kills: this.kills,
        difficulty: this.difficulty.label,
        difficultyKey: this.difficultyKey
      };
    }

    startDying(reason) {
      if (this.mode === 'dying' || this.mode === 'gameover' || this.mode === 'victory') return;
      this.mode = 'dying';
      this.endReason = reason;
      this.dyingTimer = reason === 'base' ? 1.45 : 1.05;
      this.banner = null;
      this.hiScore = Math.max(this.hiScore, this.score);
      this.audio.play('gameover');
      this.emitHud(true);
    }

    /* ------------------------------------------------------------------ */
    /* 玩家                                                               */
    /* ------------------------------------------------------------------ */

    updatePlayer(dt) {
      const player = this.player;
      if (!player) return;

      if (!player.alive) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0 && this.lives > 0 && this.mode === 'playing') {
          this.player = this.createPlayer(true);
          this.audio.play('shield');
          this.emitHud(true);
        }
        return;
      }

      player.shieldTimer = Math.max(0, player.shieldTimer - dt);
      player.fireCd = Math.max(0, player.fireCd - dt);
      player.recoil = Math.max(0, player.recoil - dt * 7);
      player.spawnFx = Math.max(0, (player.spawnFx || 0) - dt);
      player.trackTimer -= dt;

      const center = this.entityCenter(player);
      const cell = this.cellAt(center.x, center.y);
      player.onIce = cell && this.map[cell.y][cell.x] === T.ICE;

      const direction = this.input.getDirection();
      let moved = false;

      if (direction) {
        player.dir = direction;
        moved = this.moveTank(player, direction, player.speed * dt, dt);
        if (player.onIce) {
          player.slideTimer = 0.32;
          player.slideDir = direction;
        }
      } else if (player.slideTimer > 0) {
        player.slideTimer = Math.max(0, player.slideTimer - dt);
        const slideSpeed = player.speed * 0.58 * (player.slideTimer / 0.32);
        moved = this.moveTank(player, player.slideDir, slideSpeed * dt, dt);
      }

      player.moving = moved;
      if (moved && player.trackTimer <= 0) {
        player.trackTimer = 0.055;
        this.addTrackMark(player);
      }

      if (this.input.isFiring() && player.fireCd <= 0) {
        this.firePlayer();
      }
    }

    firePlayer() {
      const player = this.player;
      if (!player || !player.alive) return;
      const config = PLAYER_POWER[this.power];
      const activeCount = this.bullets.filter((bullet) => bullet.alive && bullet.owner === 'player').length;
      if (activeCount >= config.maxBullets) return;

      const center = this.entityCenter(player);
      const direction = DIRECTIONS[player.dir];
      const perpendicular = { x: -direction.y, y: direction.x };
      const offsets = config.twin ? [-8, 8] : [0];
      offsets.forEach((offset) => {
        this.spawnBullet({
          owner: 'player',
          source: player,
          x: center.x + direction.x * 23 + perpendicular.x * offset,
          y: center.y + direction.y * 23 + perpendicular.y * offset,
          dir: player.dir,
          speed: config.bulletSpeed,
          steelBreak: config.steelBreak,
          color: '#ffe18a'
        });
      });

      player.fireCd = config.cooldown;
      player.recoil = 1;
      this.audio.play('shoot');
      this.addMuzzle(center.x + direction.x * 23, center.y + direction.y * 23, player.dir, '#ffe18a');
    }

    /* ------------------------------------------------------------------ */
    /* 敌人                                                               */
    /* ------------------------------------------------------------------ */

    updateSpawns(dt) {
      if (!this.enemyQueue.length) return;
      const active = this.enemies.filter((enemy) => enemy.alive).length;
      const maxActive = this.difficulty.maxActive + (this.levelIndex >= 3 ? 1 : 0);
      if (active >= maxActive) return;

      this.spawnTimer -= dt;
      if (this.spawnTimer > 0) return;

      const spawn = this.findFreeSpawn();
      if (!spawn) {
        this.spawnTimer = 0.45;
        return;
      }

      const entry = this.enemyQueue.shift();
      this.spawnEnemy(spawn, entry);
      this.spawnTimer = Math.max(0.72, rand(1.15, 1.65) - this.levelIndex * 0.09);
    }

    findFreeSpawn() {
      for (let i = 0; i < ENEMY_SPAWNS.length; i += 1) {
        const index = (this.spawnIndex + i) % ENEMY_SPAWNS.length;
        const spawn = ENEMY_SPAWNS[index];
        const point = this.cellCenter(spawn.x, spawn.y);
        const occupied = this.enemies.some((enemy) => {
          if (!enemy.alive || enemy.spawnTimer > 0) return false;
          const center = this.entityCenter(enemy);
          return dist2(center.x, center.y, point.x, point.y) < 38 * 38;
        }) || (this.player && this.player.alive && (
          dist2(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2, point.x, point.y) < 38 * 38
        ));
        if (!occupied) {
          this.spawnIndex = (index + 1) % ENEMY_SPAWNS.length;
          return spawn;
        }
      }
      return null;
    }

    spawnEnemy(cell, entry) {
      const config = ENEMY_TYPES[entry.type] || ENEMY_TYPES.basic;
      const point = this.cellCenter(cell.x, cell.y);
      const size = 38;
      const maxHp = config.hp + (config.key === 'armor' ? Math.floor(this.levelIndex / 2) : 0);
      const enemy = {
        x: point.x - size / 2,
        y: point.y - size / 2,
        w: size,
        h: size,
        size,
        type: config.key,
        config,
        hp: maxHp,
        maxHp,
        dir: 'down',
        speed: config.speed * this.difficulty.speedScale * (1 + this.levelIndex * 0.018),
        bulletSpeed: config.bulletSpeed * (1 + this.levelIndex * 0.015),
        alive: true,
        bonus: Boolean(entry.bonus),
        spawnTimer: 1.05,
        spawnTotal: 1.05,
        fireCd: rand(0.8, 1.5),
        targetKind: 'player',
        path: null,
        pathTimer: 0,
        aimTimer: 0,
        blockTimer: 0,
        stuckTimer: 0,
        trackTimer: 0,
        trackPhase: 0,
        recoil: 0,
        frozen: false,
        flash: 0,
        detourTimer: 0,
        detourDir: null
      };
      enemy.fireCd = rand(config.fireMin, config.fireMax) * this.difficulty.fireScale;
      this.enemies.push(enemy);
      this.addRing(point.x, point.y, config.color, 18, 0.45);
    }

    updateEnemies(dt) {
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        enemy.flash = Math.max(0, enemy.flash - dt * 8);
        enemy.recoil = Math.max(0, enemy.recoil - dt * 7);

        if (enemy.spawnTimer > 0) {
          enemy.spawnTimer -= dt;
          if (enemy.spawnTimer <= 0) {
            enemy.spawnTimer = 0;
            this.audio.play('spawn');
          }
          continue;
        }

        if (this.freezeTimer > 0) {
          enemy.frozen = true;
          continue;
        }
        enemy.frozen = false;

        enemy.fireCd = Math.max(0, enemy.fireCd - dt);
        enemy.pathTimer -= dt;
        enemy.aimTimer -= dt;

        const cell = this.cellOf(enemy);
        const cellKey = cell.x + ':' + cell.y;
        if (!enemy.path || enemy.pathTimer <= 0 || enemy.lastCell !== cellKey) {
          this.recalcEnemyPath(enemy);
          enemy.pathTimer = rand(0.8, 1.35);
          enemy.lastCell = cellKey;
        }

        let moved = false;
        if (enemy.path && enemy.path.length > 1) {
          const index = enemy.path.findIndex((node) => sameCell(node, cell));
          if (index >= 0) {
            if (index > 0) enemy.path = enemy.path.slice(index);
          }
          const next = enemy.path[1];
          if (next) {
            const direction = this.directionBetween(cell, next);
            if (direction) {
              enemy.dir = direction;
              moved = this.moveTank(enemy, direction, enemy.speed * dt, dt);
            }
          }
        }

        if (!moved) {
          enemy.blockTimer += dt;
          enemy.stuckTimer += dt;
          if (enemy.blockTimer > 0.18) this.fireAtWall(enemy);
          if (enemy.stuckTimer > 1.05) {
            enemy.stuckTimer = 0;
            enemy.pathTimer = 0;
            if (Math.random() < 0.38) {
              const options = DIR_KEYS.filter((key) => key !== enemy.dir && key !== DIRECTIONS[enemy.dir].opposite);
              enemy.dir = options[randInt(0, options.length - 1)];
              this.moveTank(enemy, enemy.dir, enemy.speed * dt * 1.2, dt);
            }
          }
        } else {
          enemy.blockTimer = 0;
          enemy.stuckTimer = 0;
          enemy.trackTimer -= dt;
          if (enemy.trackTimer <= 0) {
            enemy.trackTimer = 0.08;
            this.addTrackMark(enemy);
          }
        }

        if (enemy.aimTimer <= 0) {
          enemy.aimTimer = rand(0.16, 0.28);
          this.enemyAimAtTargets(enemy);
        }
      }
    }

    recalcEnemyPath(enemy) {
      if (!enemy.alive || enemy.spawnTimer > 0) return;
      const start = this.cellOf(enemy);
      let targetKind = 'player';
      let goal = null;

      const baseAttackers = this.enemies.filter((other) => (
        other !== enemy && other.alive && other.spawnTimer <= 0 &&
        other.targetKind === 'base' && other.path && other.path.length > 1
      )).length;
      const baseCap = this.levelIndex >= 3 ? 2 : 1;

      if (this.player && this.player.alive) {
        const wantsBase = this.baseAlive && Math.random() < 0.34 && baseAttackers < baseCap;
        targetKind = wantsBase ? 'base' : 'player';
      } else if (this.baseAlive) {
        targetKind = 'base';
      }

      if (targetKind === 'base') {
        goal = { x: BASE_CELL.x, y: BASE_CELL.y };
      } else if (this.player && this.player.alive) {
        const center = this.entityCenter(this.player);
        goal = this.cellAt(center.x, center.y);
      } else if (this.baseAlive) {
        targetKind = 'base';
        goal = { x: BASE_CELL.x, y: BASE_CELL.y };
      }

      if (!goal) {
        enemy.path = null;
        return;
      }

      let path = this.findPath(start, goal, targetKind === 'base' ? 8 : 6);
      if (!path && this.baseAlive) {
        targetKind = 'base';
        path = this.findPath(start, { x: BASE_CELL.x, y: BASE_CELL.y }, 8);
      }
      if (!path) {
        enemy.path = null;
        enemy.targetKind = targetKind;
        return;
      }
      enemy.targetKind = targetKind;
      enemy.path = path;
    }

    enemyAimAtTargets(enemy) {
      if (enemy.fireCd > 0 || enemy.spawnTimer > 0) return;
      const origin = this.entityCenter(enemy);
      const candidates = [];

      if (this.player && this.player.alive) {
        candidates.push({ point: this.entityCenter(this.player), kind: 'player' });
      }
      if (this.baseAlive) {
        candidates.push({ point: { x: this.base.cx, y: this.base.cy }, kind: 'base' });
      }

      for (const candidate of candidates) {
        if (candidate.kind === 'base' && enemy.targetKind !== 'base') continue;
        const dx = candidate.point.x - origin.x;
        const dy = candidate.point.y - origin.y;
        if (Math.abs(dx) > 470 || Math.abs(dy) > 470) continue;
        if (candidate.kind === 'base' && Math.hypot(dx, dy) > 360) continue;

        let direction = null;
        if (Math.abs(dx) < 15 && Math.abs(dy) > 18) {
          direction = dy > 0 ? 'down' : 'up';
        } else if (Math.abs(dy) < 15 && Math.abs(dx) > 18) {
          direction = dx > 0 ? 'right' : 'left';
        }
        if (!direction) continue;
        if (Math.random() > 0.86) continue;

        enemy.dir = direction;
        this.fireEnemy(enemy);
        return;
      }
    }

    fireAtWall(enemy) {
      if (enemy.fireCd > 0 || enemy.spawnTimer > 0 || this.freezeTimer > 0) return;
      const direction = DIRECTIONS[enemy.dir];
      const center = this.entityCenter(enemy);
      const probeX = center.x + direction.x * 34;
      const probeY = center.y + direction.y * 34;
      const cell = this.cellAt(probeX, probeY);
      if (!cell) return;
      const tile = this.map[cell.y][cell.x];
      if (tile === T.BRICK || tile === T.STEEL || tile === T.BASE) {
        this.fireEnemy(enemy);
      }
    }

    fireEnemy(enemy) {
      if (!enemy.alive || enemy.spawnTimer > 0 || this.freezeTimer > 0) return;
      const hasBullet = this.bullets.some((bullet) => bullet.alive && bullet.owner === 'enemy' && bullet.source === enemy);
      if (hasBullet) return;

      const center = this.entityCenter(enemy);
      const direction = DIRECTIONS[enemy.dir];
      this.spawnBullet({
        owner: 'enemy',
        source: enemy,
        x: center.x + direction.x * 23,
        y: center.y + direction.y * 23,
        dir: enemy.dir,
        speed: enemy.bulletSpeed,
        steelBreak: false,
        color: '#ff8a67'
      });

      enemy.fireCd = rand(enemy.config.fireMin, enemy.config.fireMax) * this.difficulty.fireScale *
        Math.max(0.65, 1 - this.levelIndex * 0.03);
      enemy.recoil = 1;
      this.audio.play('enemyShoot');
      this.addMuzzle(center.x + direction.x * 23, center.y + direction.y * 23, enemy.dir, '#ff9a78');
    }

    /* ------------------------------------------------------------------ */
    /* 子弹 / 碰撞                                                        */
    /* ------------------------------------------------------------------ */

    spawnBullet(options) {
      const direction = DIRECTIONS[options.dir];
      this.bullets.push({
        x: options.x,
        y: options.y,
        vx: direction.x * options.speed,
        vy: direction.y * options.speed,
        dir: options.dir,
        owner: options.owner,
        source: options.source,
        speed: options.speed,
        steelBreak: Boolean(options.steelBreak),
        color: options.color,
        alive: true,
        life: 3.1,
        radius: BULLET_RADIUS,
        trail: []
      });
    }

    updateBullets(dt) {
      for (const bullet of this.bullets) {
        if (!bullet.alive) continue;
        bullet.life -= dt;
        if (bullet.life <= 0) {
          bullet.alive = false;
          continue;
        }

        const distance = bullet.speed * dt;
        const steps = Math.max(1, Math.ceil(distance / 5));
        for (let step = 0; step < steps && bullet.alive; step += 1) {
          bullet.x += bullet.vx * dt / steps;
          bullet.y += bullet.vy * dt / steps;

          if (
            bullet.x < FIELD_X - 4 || bullet.x > FIELD_X + FIELD_W + 4 ||
            bullet.y < FIELD_Y - 4 || bullet.y > FIELD_Y + FIELD_H + 4
          ) {
            bullet.alive = false;
            this.addSpark(bullet.x, bullet.y, 3, bullet.color, 40);
            break;
          }

          if (this.bulletHitsTile(bullet)) continue;
          if (this.bulletHitsTank(bullet)) continue;
        }
      }

      for (let i = 0; i < this.bullets.length; i += 1) {
        const a = this.bullets[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < this.bullets.length; j += 1) {
          const b = this.bullets[j];
          if (!b.alive || a.owner === b.owner) continue;
          if (dist2(a.x, a.y, b.x, b.y) < 11 * 11) {
            a.alive = false;
            b.alive = false;
            this.addSpark((a.x + b.x) / 2, (a.y + b.y) / 2, 7, '#fff0ba', 110);
            this.audio.play('steel');
            break;
          }
        }
      }

      this.bullets = this.bullets.filter((bullet) => bullet.alive);
    }

    bulletHitsTile(bullet) {
      const cell = this.cellAt(bullet.x, bullet.y);
      if (!cell) return false;
      const tile = this.map[cell.y][cell.x];
      if (tile === T.EMPTY || tile === T.TREE || tile === T.WATER || tile === T.ICE) return false;
      const x = FIELD_X + cell.x * TILE;
      const y = FIELD_Y + cell.y * TILE;

      if (tile === T.BRICK) {
        this.destroyTile(cell.x, cell.y);
        bullet.alive = false;
        this.audio.play('brick');
        this.addBrickBurst(x + TILE / 2, y + TILE / 2);
        return true;
      }

      if (tile === T.STEEL) {
        bullet.alive = false;
        if (bullet.steelBreak) {
          this.destroyTile(cell.x, cell.y);
          this.addBrickBurst(x + TILE / 2, y + TILE / 2, '#b7c1c4', '#69767b');
          this.audio.play('brick');
        } else {
          this.addSpark(bullet.x, bullet.y, 7, '#ffe8ae', 100);
          this.audio.play('steel');
        }
        return true;
      }

      if (tile === T.BASE) {
        bullet.alive = false;
        if (bullet.owner === 'player') {
          this.addSpark(bullet.x, bullet.y, 7, '#ffe8ae', 90);
          this.addFloater('基地保护', this.base.cx, this.base.cy - 30, '#f2b84b', 0.6);
          this.audio.play('steel');
        } else {
          this.destroyBase();
        }
        return true;
      }
      return false;
    }

    bulletHitsTank(bullet) {
      if (bullet.owner === 'player') {
        for (const enemy of this.enemies) {
          if (!enemy.alive || enemy.spawnTimer > 0) continue;
          if (this.circleHitsRect(bullet.x, bullet.y, bullet.radius + 1, enemy)) {
            bullet.alive = false;
            enemy.hp -= 1;
            enemy.flash = 1;
            if (enemy.hp <= 0) {
              this.killEnemy(enemy);
            } else {
              this.audio.play('steel');
              this.addSpark(bullet.x, bullet.y, 8, '#ffe8ae', 120);
            }
            return true;
          }
        }
        return false;
      }

      const player = this.player;
      if (player && player.alive && this.circleHitsRect(bullet.x, bullet.y, bullet.radius + 1, player)) {
        bullet.alive = false;
        if (player.shieldTimer > 0) {
          this.addRing(bullet.x, bullet.y, '#7be5ff', 10, 0.35);
          this.addSpark(bullet.x, bullet.y, 8, '#9aeeff', 100);
          this.audio.play('steel');
        } else {
          this.killPlayer();
        }
        return true;
      }
      return false;
    }

    circleHitsRect(x, y, radius, rect) {
      const nearestX = clamp(x, rect.x, rect.x + rect.w);
      const nearestY = clamp(y, rect.y, rect.y + rect.h);
      return dist2(x, y, nearestX, nearestY) <= radius * radius;
    }

    destroyTile(cx, cy) {
      if (this.map[cy][cx] !== T.BRICK && this.map[cy][cx] !== T.STEEL) return;
      this.map[cy][cx] = T.EMPTY;
    }

    killEnemy(enemy, options) {
      if (!enemy.alive) return;
      const opts = options || {};
      enemy.alive = false;
      const config = enemy.config;
      const points = Math.round(config.score * this.difficulty.scoreScale * (1 + this.levelIndex * 0.08));
      this.score += points;
      this.kills += 1;
      this.remaining = Math.max(0, this.remaining - 1);
      this.hiScore = Math.max(this.hiScore, this.score);

      const center = this.entityCenter(enemy);
      this.addExplosion(center.x, center.y, config.key === 'armor' ? 1.25 : 0.9, config.color);
      this.wrecks.push({ x: center.x, y: center.y, dir: enemy.dir, color: config.dark, life: 1.2, max: 1.2 });
      this.addFloater(`+${points}`, center.x, center.y - 22, '#ffe7a8');
      if (enemy.bonus) this.dropPowerup(center.x, center.y);
      this.shake = Math.min(16, this.shake + 4);
      if (!opts.silent) this.audio.play('explode');
      this.emitHud(true);
    }

    killPlayer() {
      const player = this.player;
      if (!player || !player.alive || player.shieldTimer > 0) return;
      player.alive = false;
      const center = this.entityCenter(player);
      this.addExplosion(center.x, center.y, 1.2, '#7ee2a1');
      this.wrecks.push({ x: center.x, y: center.y, dir: player.dir, color: '#286a41', life: 1.4, max: 1.4 });
      this.shake = Math.min(18, this.shake + 8);
      this.flash = 0.45;
      this.flashColor = '#ff735c';
      this.audio.play('explodeBig');
      this.lives -= 1;
      this.emitHud(true);

      if (this.lives <= 0) {
        this.startDying('lives');
      } else {
        this.respawnTimer = 1.55;
      }
    }

    destroyBase() {
      if (!this.baseAlive) return;
      this.baseAlive = false;
      this.map[this.base.y][this.base.x] = T.EMPTY;
      const x = this.base.cx;
      const y = this.base.cy;
      const runId = this.runId;
      for (let i = 0; i < 5; i += 1) {
        const ox = rand(-24, 24);
        const oy = rand(-18, 18);
        window.setTimeout(() => {
          if (this.runId !== runId) return;
          this.addExplosion(x + ox, y + oy, rand(0.8, 1.6), i % 2 ? '#f2b84b' : '#ff654a');
        }, i * 90);
      }
      this.shake = 22;
      this.flash = 0.8;
      this.flashColor = '#ff6b4a';
      this.audio.play('explodeBig');
      this.startDying('base');
    }

    /* ------------------------------------------------------------------ */
    /* 移动 / 寻路                                                        */
    /* ------------------------------------------------------------------ */

    moveTank(tank, dirKey, distance, dt) {
      const direction = DIRECTIONS[dirKey];
      if (!direction) return false;
      const axis = direction.x !== 0 ? 'y' : 'x';
      this.centerTankOnLane(tank, axis, dt);

      const nextX = tank.x + direction.x * distance;
      const nextY = tank.y + direction.y * distance;
      if (!this.tankCollides(tank, nextX, nextY)) {
        tank.x = nextX;
        tank.y = nextY;
        tank.trackPhase = (tank.trackPhase + distance) % 12;
        return true;
      }
      return false;
    }

    centerTankOnLane(tank, axis, dt) {
      const center = axis === 'x' ? tank.x + tank.w / 2 : tank.y + tank.h / 2;
      const relative = center - (axis === 'x' ? FIELD_X : FIELD_Y);
      const cell = clamp(Math.round(relative / TILE - 0.5), 0, COLS - 1);
      const targetCenter = (axis === 'x' ? FIELD_X : FIELD_Y) + cell * TILE + TILE / 2;
      const target = targetCenter - (axis === 'x' ? tank.w : tank.h) / 2;
      const current = axis === 'x' ? tank.x : tank.y;
      const difference = target - current;
      if (Math.abs(difference) < 0.05) return;
      const step = Math.sign(difference) * Math.min(Math.abs(difference), 210 * dt);
      const nextX = axis === 'x' ? tank.x + step : tank.x;
      const nextY = axis === 'y' ? tank.y + step : tank.y;
      if (!this.tankCollides(tank, nextX, nextY)) {
        if (axis === 'x') tank.x = nextX;
        else tank.y = nextY;
      }
    }

    tankCollides(tank, x, y) {
      if (
        x < FIELD_X || y < FIELD_Y ||
        x + tank.w > FIELD_X + FIELD_W || y + tank.h > FIELD_Y + FIELD_H
      ) return true;

      const left = Math.floor((x - FIELD_X) / TILE);
      const right = Math.floor((x + tank.w - 0.01 - FIELD_X) / TILE);
      const top = Math.floor((y - FIELD_Y) / TILE);
      const bottom = Math.floor((y + tank.h - 0.01 - FIELD_Y) / TILE);

      for (let cy = top; cy <= bottom; cy += 1) {
        for (let cx = left; cx <= right; cx += 1) {
          if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return true;
          const tile = this.map[cy][cx];
          if (tile === T.BRICK || tile === T.STEEL || tile === T.WATER || tile === T.BASE) return true;
        }
      }

      const others = this.enemies.concat(this.player ? [this.player] : []);
      for (const other of others) {
        if (other === tank || !other.alive) continue;
        if (other.spawnTimer > 0) continue;
        const involvesPlayer = tank === this.player || other === this.player;
        const inset = involvesPlayer ? 1 : 7;
        if (
          x < other.x + other.w - inset &&
          x + tank.w > other.x + inset &&
          y < other.y + other.h - inset &&
          y + tank.h > other.y + inset
        ) return true;
      }
      return false;
    }

    findPath(start, goal, brickCost) {
      if (!start || !goal) return null;
      if (start.x === goal.x && start.y === goal.y) return [start];
      const size = COLS * ROWS;
      const indexOf = (x, y) => y * COLS + x;
      const distances = new Array(size).fill(Infinity);
      const previous = new Array(size).fill(-1);
      const visited = new Array(size).fill(false);
      const startIndex = indexOf(start.x, start.y);
      const goalIndex = indexOf(goal.x, goal.y);
      distances[startIndex] = 0;
      const open = [{ x: start.x, y: start.y, distance: 0 }];

      while (open.length) {
        let bestIndex = 0;
        for (let i = 1; i < open.length; i += 1) {
          if (open[i].distance < open[bestIndex].distance) bestIndex = i;
        }
        const current = open.splice(bestIndex, 1)[0];
        const currentIndex = indexOf(current.x, current.y);
        if (visited[currentIndex]) continue;
        visited[currentIndex] = true;
        if (currentIndex === goalIndex) break;

        for (const key of DIR_KEYS) {
          const direction = DIRECTIONS[key];
          const nx = current.x + direction.x;
          const ny = current.y + direction.y;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
          const tile = this.map[ny][nx];
          if (tile === T.STEEL || tile === T.WATER) continue;
          if (tile === T.BASE && !(nx === goal.x && ny === goal.y)) continue;
          const nextIndex = indexOf(nx, ny);
          if (visited[nextIndex]) continue;
          const cost = tile === T.BRICK ? brickCost : 1;
          const candidate = current.distance + cost;
          if (candidate < distances[nextIndex]) {
            distances[nextIndex] = candidate;
            previous[nextIndex] = currentIndex;
            open.push({ x: nx, y: ny, distance: candidate });
          }
        }
      }

      if (!Number.isFinite(distances[goalIndex])) return null;
      const path = [];
      let cursor = goalIndex;
      let guard = 0;
      while (cursor !== -1 && guard < size + 2) {
        path.push({ x: cursor % COLS, y: Math.floor(cursor / COLS) });
        if (cursor === startIndex) break;
        cursor = previous[cursor];
        guard += 1;
      }
      if (path[path.length - 1].x !== start.x || path[path.length - 1].y !== start.y) return null;
      path.reverse();
      return path;
    }

    directionBetween(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      if (dx === 1 && dy === 0) return 'right';
      if (dx === -1 && dy === 0) return 'left';
      if (dx === 0 && dy === 1) return 'down';
      if (dx === 0 && dy === -1) return 'up';
      return null;
    }

    /* ------------------------------------------------------------------ */
    /* 道具                                                               */
    /* ------------------------------------------------------------------ */

    dropPowerup(x, y) {
      const total = POWERUP_WEIGHTS.reduce((sum, entry) => sum + entry[1], 0);
      let roll = Math.random() * total;
      let id = 'star';
      for (const entry of POWERUP_WEIGHTS) {
        roll -= entry[1];
        if (roll <= 0) {
          id = entry[0];
          break;
        }
      }
      const type = POWERUPS[id];
      this.powerups.push({
        x,
        y,
        type,
        alive: true,
        life: 12,
        maxLife: 12,
        phase: Math.random() * TAU
      });
      this.addRing(x, y, type.color, 10, 0.45);
      this.audio.play('powerup');
    }

    updatePowerups(dt) {
      const player = this.player;
      for (const powerup of this.powerups) {
        if (!powerup.alive) continue;
        powerup.life -= dt;
        if (powerup.life <= 0) {
          powerup.alive = false;
          continue;
        }
        if (!player || !player.alive) continue;
        const center = this.entityCenter(player);
        if (dist2(center.x, center.y, powerup.x, powerup.y) < 30 * 30) {
          powerup.alive = false;
          this.collectPowerup(powerup);
        }
      }
    }

    collectPowerup(powerup) {
      const type = powerup.type;
      this.score += type.score;
      this.hiScore = Math.max(this.hiScore, this.score);
      this.addRing(powerup.x, powerup.y, type.color, 14, 0.55);
      this.addFloater(type.name, powerup.x, powerup.y - 22, type.color, 1.15);

      switch (type.id) {
        case 'star':
          if (this.power < 3) {
            this.power += 1;
            this.audio.play('powerup');
          } else {
            this.score += 1000;
            this.audio.play('life');
          }
          break;
        case 'shield':
          this.player.shieldTimer = Math.max(this.player.shieldTimer, 8);
          this.audio.play('shield');
          break;
        case 'life':
          this.lives = Math.min(9, this.lives + 1);
          this.audio.play('life');
          break;
        case 'bomb':
          this.audio.play('explodeBig');
          this.flash = 0.7;
          this.flashColor = '#ffb36b';
          this.shake = 18;
          const runId = this.runId;
          const targets = this.enemies.filter((enemy) => enemy.alive && enemy.spawnTimer <= 0);
          targets.forEach((enemy, index) => {
            window.setTimeout(() => {
              if (this.runId === runId && enemy.alive) this.killEnemy(enemy, { silent: true });
            }, index * 60);
          });
          this.bullets = this.bullets.filter((bullet) => bullet.owner !== 'enemy');
          break;
        case 'clock':
          this.freezeTimer = Math.max(this.freezeTimer, 8);
          this.audio.play('freeze');
          break;
        case 'shovel':
          this.shovelTimer = 15;
          this.fortifyBaseWalls();
          this.audio.play('steelWall');
          break;
        default:
          break;
      }
      this.emitHud(true);
    }

    fortifyBaseWalls() {
      for (const cell of BASE_WALL_CELLS) {
        this.map[cell.y][cell.x] = T.STEEL;
      }
      this.addRing(this.base.cx, this.base.cy, '#f2c570', 42, 0.65);
    }

    restoreBaseWalls() {
      for (const cell of BASE_WALL_CELLS) {
        if (this.map[cell.y][cell.x] === T.STEEL) {
          this.map[cell.y][cell.x] = T.BRICK;
        } else {
          this.map[cell.y][cell.x] = T.BRICK;
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* 特效                                                               */
    /* ------------------------------------------------------------------ */

    addExplosion(x, y, scale, color) {
      this.addRing(x, y, color || '#ffcc66', 18 * scale, 0.5);
      this.addSpark(x, y, Math.round(16 * scale), '#ffcb6b', 180 * scale);
      for (let i = 0; i < Math.round(12 * scale); i += 1) {
        const angle = Math.random() * TAU;
        const speed = rand(35, 150) * scale;
        this.particles.push({
          type: 'debris',
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.35, 0.8),
          max: 0.8,
          size: rand(2, 6) * scale,
          color: i % 3 === 0 ? '#20272b' : (i % 3 === 1 ? color : '#ffd480'),
          gravity: 80,
          drag: 0.94
        });
      }
      for (let i = 0; i < 5; i += 1) {
        this.particles.push({
          type: 'smoke',
          x: x + rand(-10, 10),
          y: y + rand(-10, 10),
          vx: rand(-25, 25),
          vy: rand(-50, -10),
          life: rand(0.6, 1.3),
          max: 1.3,
          size: rand(7, 15) * scale,
          color: '#2f3438',
          gravity: -10,
          drag: 0.96
        });
      }
      for (let i = 0; i < 4; i += 1) {
        this.particles.push({
          type: 'flash',
          x: x + rand(-5, 5),
          y: y + rand(-5, 5),
          vx: 0,
          vy: 0,
          life: 0.1,
          max: 0.1,
          size: rand(10, 22) * scale,
          color: '#fff3c4'
        });
      }
    }

    addSpark(x, y, count, color, speed) {
      for (let i = 0; i < count; i += 1) {
        const angle = Math.random() * TAU;
        const velocity = rand(20, speed || 100);
        this.particles.push({
          type: 'spark',
          x,
          y,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity,
          life: rand(0.15, 0.42),
          max: 0.42,
          size: rand(1.5, 3.5),
          color: color || '#ffdd8a',
          gravity: 40,
          drag: 0.92
        });
      }
    }

    addRing(x, y, color, radius, life) {
      this.particles.push({
        type: 'ring',
        x,
        y,
        vx: 0,
        vy: 0,
        life,
        max: life,
        size: radius,
        color,
        ring: true
      });
    }

    addMuzzle(x, y, dir, color) {
      const direction = DIRECTIONS[dir];
      for (let i = 0; i < 4; i += 1) {
        this.particles.push({
          type: 'spark',
          x,
          y,
          vx: direction.x * rand(30, 80) + rand(-25, 25),
          vy: direction.y * rand(30, 80) + rand(-25, 25),
          life: rand(0.08, 0.18),
          max: 0.18,
          size: rand(1.5, 3),
          color,
          gravity: 0,
          drag: 0.94
        });
      }
    }

    addBrickBurst(x, y, primary, secondary) {
      for (let i = 0; i < 12; i += 1) {
        const angle = Math.random() * TAU;
        const speed = rand(25, 110);
        this.particles.push({
          type: 'debris',
          x: x + rand(-12, 12),
          y: y + rand(-12, 12),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: rand(0.3, 0.75),
          max: 0.75,
          size: rand(2, 5),
          color: i % 3 === 0 ? (secondary || '#6c3528') : (primary || '#c46645'),
          gravity: 120,
          drag: 0.94
        });
      }
    }

    addFloater(text, x, y, color, life) {
      this.floaters.push({
        text,
        x,
        y,
        color: color || '#ffe8a8',
        life: life || 0.8,
        max: life || 0.8
      });
    }

    addTrackMark(tank) {
      const direction = DIRECTIONS[tank.dir];
      const perpendicular = { x: -direction.y, y: direction.x };
      const center = this.entityCenter(tank);
      for (const side of [-1, 1]) {
        this.trackMarks.push({
          x: center.x + perpendicular.x * side * 12 - direction.x * 4,
          y: center.y + perpendicular.y * side * 12 - direction.y * 4,
          dir: tank.dir,
          life: 6.5,
          max: 6.5
        });
      }
      if (this.trackMarks.length > 260) this.trackMarks.splice(0, this.trackMarks.length - 260);
    }

    updateEffects(dt) {
      for (const particle of this.particles) {
        particle.life -= dt;
        if (particle.life <= 0) continue;
        if (particle.type !== 'ring' && particle.type !== 'flash') {
          particle.x += particle.vx * dt;
          particle.y += particle.vy * dt;
          particle.vx *= Math.pow(particle.drag || 0.95, dt * 60);
          particle.vy *= Math.pow(particle.drag || 0.95, dt * 60);
          particle.vy += (particle.gravity || 0) * dt;
        }
      }
      this.particles = this.particles.filter((particle) => particle.life > 0);

      for (const floater of this.floaters) {
        floater.life -= dt;
        floater.y -= 24 * dt;
      }
      this.floaters = this.floaters.filter((floater) => floater.life > 0);

      for (const wreck of this.wrecks) wreck.life -= dt;
      this.wrecks = this.wrecks.filter((wreck) => wreck.life > 0);

      for (const mark of this.trackMarks) mark.life -= dt;
      this.trackMarks = this.trackMarks.filter((mark) => mark.life > 0);

      if (!this.baseAlive && this.mode !== 'menu') {
        this.smokeTimer -= dt;
        if (this.smokeTimer <= 0) {
          this.smokeTimer = rand(0.18, 0.45);
          this.particles.push({
            type: 'smoke',
            x: this.base.cx + rand(-18, 18),
            y: this.base.cy + rand(-12, 12),
            vx: rand(-10, 10),
            vy: rand(-35, -15),
            life: rand(0.8, 1.5),
            max: 1.5,
            size: rand(7, 14),
            color: '#282b2d',
            gravity: -8,
            drag: 0.97
          });
        }
      }
    }

    /* ------------------------------------------------------------------ */
    /* HUD                                                               */
    /* ------------------------------------------------------------------ */

    emitHud(force) {
      if (!force && this.mode !== 'playing' && this.mode !== 'levelclear') return;
      const signature = [
        this.levelIndex, this.remaining, this.lives, this.score, this.hiScore,
        this.power, Math.ceil(this.freezeTimer), Math.ceil(this.shovelTimer),
        this.player ? Math.ceil(this.player.shieldTimer) : 0,
        this.mode, this.spawnTimer > 0
      ].join('|');
      if (!force && signature === this.hudSignature) return;
      this.hudSignature = signature;
      this.onHud(this.getHudState());
    }

    getHudState() {
      const buffs = [];
      if (this.freezeTimer > 0) buffs.push({ id: 'freeze', label: '冻结', time: Math.ceil(this.freezeTimer), color: '#9adfff' });
      if (this.shovelTimer > 0) buffs.push({ id: 'shovel', label: '钢化', time: Math.ceil(this.shovelTimer), color: '#e2b169' });
      if (this.player && this.player.alive && this.player.shieldTimer > 0) {
        buffs.push({ id: 'shield', label: '护盾', time: Math.ceil(this.player.shieldTimer), color: '#66d9ff' });
      }
      return {
        mode: this.mode,
        level: Math.min(this.levelIndex + 1, LEVELS.length),
        levelName: this.theme ? this.theme.name : '',
        difficulty: this.difficulty.label,
        difficultyKey: this.difficultyKey,
        remaining: this.remaining,
        lives: this.lives,
        score: this.score,
        hiScore: this.hiScore,
        power: this.power,
        powerLabel: PLAYER_POWER[this.power].label,
        buffs,
        baseAlive: this.baseAlive
      };
    }

    /* ------------------------------------------------------------------ */
    /* 坐标工具                                                           */
    /* ------------------------------------------------------------------ */

    entityCenter(entity) {
      return { x: entity.x + entity.w / 2, y: entity.y + entity.h / 2 };
    }

    cellCenter(cx, cy) {
      return {
        x: FIELD_X + cx * TILE + TILE / 2,
        y: FIELD_Y + cy * TILE + TILE / 2
      };
    }

    cellAt(x, y) {
      const cx = Math.floor((x - FIELD_X) / TILE);
      const cy = Math.floor((y - FIELD_Y) / TILE);
      if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) return null;
      return { x: cx, y: cy };
    }

    cellOf(entity) {
      const center = this.entityCenter(entity);
      return this.cellAt(center.x, center.y) || { x: 0, y: 0 };
    }

    /* ------------------------------------------------------------------ */
    /* 绘制                                                               */
    /* ------------------------------------------------------------------ */

    createTileSprites() {
      const make = (draw) => {
        const canvas = document.createElement('canvas');
        canvas.width = TILE;
        canvas.height = TILE;
        const ctx = canvas.getContext('2d');
        draw(ctx);
        return canvas;
      };

      const brick = make((ctx) => {
        ctx.fillStyle = '#54271f';
        ctx.fillRect(0, 0, TILE, TILE);
        for (let row = 0; row < 4; row += 1) {
          const offset = row % 2 === 0 ? -11 : 2;
          for (let col = 0; col < 4; col += 1) {
            const x = offset + col * 23;
            const y = row * 12 + 2;
            ctx.fillStyle = '#a34a32';
            ctx.fillRect(x, y, 21, 9);
            ctx.fillStyle = '#c66645';
            ctx.fillRect(x + 1, y + 1, 18, 2);
            ctx.fillStyle = '#6e2f23';
            ctx.fillRect(x + 2, y + 7, 17, 2);
          }
        }
        ctx.fillStyle = 'rgba(255, 208, 146, 0.16)';
        ctx.fillRect(0, 0, TILE, 2);
      });

      const steel = make((ctx) => {
        ctx.fillStyle = '#566168';
        ctx.fillRect(0, 0, TILE, TILE);
        ctx.fillStyle = '#7e8b91';
        ctx.fillRect(3, 3, TILE - 6, TILE - 6);
        ctx.fillStyle = '#aeb9bd';
        ctx.fillRect(3, 3, TILE - 6, 5);
        ctx.fillRect(3, 3, 5, TILE - 6);
        ctx.fillStyle = '#3d484e';
        ctx.fillRect(3, TILE - 8, TILE - 6, 5);
        ctx.fillRect(TILE - 8, 3, 5, TILE - 6);
        ctx.strokeStyle = 'rgba(31, 40, 45, 0.6)';
        ctx.lineWidth = 2;
        ctx.strokeRect(13, 13, 22, 22);
        ctx.fillStyle = '#d3dde0';
        for (const [x, y] of [[7, 7], [39, 7], [7, 39], [39, 39]]) {
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(8, 9, 32, 2);
      });

      const ice = make((ctx) => {
        ctx.fillStyle = '#b9d3da';
        ctx.fillRect(0, 0, TILE, TILE);
        ctx.fillStyle = '#dcecf0';
        ctx.fillRect(2, 2, TILE - 4, TILE - 4);
        ctx.fillStyle = '#effbff';
        ctx.beginPath();
        ctx.moveTo(6, 34);
        ctx.lineTo(27, 5);
        ctx.lineTo(33, 5);
        ctx.lineTo(12, 39);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(142, 181, 193, 0.8)';
        ctx.beginPath();
        ctx.moveTo(29, 43);
        ctx.lineTo(43, 24);
        ctx.lineTo(43, 39);
        ctx.lineTo(37, 43);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(121, 165, 181, 0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, 12);
        ctx.lineTo(19, 18);
        ctx.lineTo(16, 27);
        ctx.moveTo(34, 26);
        ctx.lineTo(41, 31);
        ctx.stroke();
      });

      const tree = make((ctx) => {
        const blobs = [
          [8, 37, 11, '#153b25'], [23, 40, 13, '#17462b'], [38, 37, 10, '#123522'],
          [13, 23, 12, '#21583a'], [30, 25, 14, '#1d4f33'], [42, 19, 8, '#173f28'],
          [21, 11, 10, '#2c6844'], [35, 8, 8, '#245a3a'], [6, 14, 7, '#1c4b31']
        ];
        for (const [x, y, r, color] of blobs) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(104, 174, 107, 0.42)';
        for (const [x, y] of [[11, 17], [24, 12], [35, 20], [17, 29], [29, 31]]) {
          ctx.beginPath();
          ctx.arc(x, y, 3.5, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(5, 22, 14, 0.25)';
        ctx.fillRect(0, TILE - 3, TILE, 3);
      });

      return { brick, steel, ice, tree };
    }

    render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      this.drawCanvasBackdrop(ctx);

      const shakeX = this.shake > 0 ? rand(-this.shake, this.shake) * 0.45 : 0;
      const shakeY = this.shake > 0 ? rand(-this.shake, this.shake) * 0.45 : 0;

      ctx.save();
      ctx.translate(shakeX, shakeY);

      ctx.save();
      ctx.beginPath();
      ctx.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
      ctx.clip();
      this.drawField(ctx);
      ctx.restore();

      this.drawFrame(ctx);
      ctx.restore();
    }

    drawCanvasBackdrop(ctx) {
      const gradient = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 80, CANVAS_W / 2, CANVAS_H / 2, 560);
      gradient.addColorStop(0, '#0c1518');
      gradient.addColorStop(0.55, '#080d0f');
      gradient.addColorStop(1, '#050708');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

      ctx.strokeStyle = 'rgba(120, 190, 173, 0.035)';
      ctx.lineWidth = 1;
      for (let i = -CANVAS_H; i < CANVAS_W + CANVAS_H; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + CANVAS_H, CANVAS_H);
        ctx.stroke();
      }
      for (let x = 0; x <= CANVAS_W; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, CANVAS_H);
        ctx.stroke();
      }
      for (let y = 0; y <= CANVAS_H; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(CANVAS_W, y);
        ctx.stroke();
      }
    }

    drawFrame(ctx) {
      ctx.save();
      ctx.strokeStyle = 'rgba(210, 167, 81, 0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(FIELD_X - 6, FIELD_Y - 6, FIELD_W + 12, FIELD_H + 12);
      ctx.strokeStyle = 'rgba(239, 190, 92, 0.72)';
      ctx.lineWidth = 2;
      const length = 22;
      const corners = [
        [FIELD_X - 10, FIELD_Y - 10, 1, 1],
        [FIELD_X + FIELD_W + 10, FIELD_Y - 10, -1, 1],
        [FIELD_X - 10, FIELD_Y + FIELD_H + 10, 1, -1],
        [FIELD_X + FIELD_W + 10, FIELD_Y + FIELD_H + 10, -1, -1]
      ];
      for (const [x, y, sx, sy] of corners) {
        ctx.beginPath();
        ctx.moveTo(x + sx * length, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + sy * length);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(239, 190, 92, 0.45)';
      for (const [x, y] of [
        [FIELD_X - 10, FIELD_Y - 10],
        [FIELD_X + FIELD_W + 10, FIELD_Y - 10],
        [FIELD_X - 10, FIELD_Y + FIELD_H + 10],
        [FIELD_X + FIELD_W + 10, FIELD_Y + FIELD_H + 10]
      ]) {
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      ctx.restore();
    }

    drawField(ctx) {
      ctx.fillStyle = this.theme.ground;
      ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);

      for (let cy = 0; cy < ROWS; cy += 1) {
        for (let cx = 0; cx < COLS; cx += 1) {
          if ((cx + cy) % 2 === 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.015)';
            ctx.fillRect(FIELD_X + cx * TILE, FIELD_Y + cy * TILE, TILE, TILE);
          }
          const noise = hash2(cx, cy);
          if (noise > 0.55) {
            ctx.fillStyle = noise > 0.85 ? 'rgba(231, 230, 193, 0.08)' : 'rgba(139, 186, 169, 0.04)';
            const px = FIELD_X + cx * TILE + 8 + noise * 31;
            const py = FIELD_Y + cy * TILE + 7 + hash2(cx + 11, cy + 7) * 34;
            ctx.fillRect(px, py, noise > 0.85 ? 3 : 2, 2);
          }
        }
      }

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.022)';
      ctx.lineWidth = 1;
      for (let x = 1; x < COLS; x += 1) {
        ctx.beginPath();
        ctx.moveTo(FIELD_X + x * TILE + 0.5, FIELD_Y);
        ctx.lineTo(FIELD_X + x * TILE + 0.5, FIELD_Y + FIELD_H);
        ctx.stroke();
      }
      for (let y = 1; y < ROWS; y += 1) {
        ctx.beginPath();
        ctx.moveTo(FIELD_X, FIELD_Y + y * TILE + 0.5);
        ctx.lineTo(FIELD_X + FIELD_W, FIELD_Y + y * TILE + 0.5);
        ctx.stroke();
      }

      this.drawSpawnPads(ctx);
      this.drawTiles(ctx);
      this.drawBase(ctx);
      this.drawTrackMarks(ctx);
      this.drawPowerups(ctx);

      for (const enemy of this.enemies) this.drawTank(ctx, enemy);
      if (this.player && this.player.alive) this.drawTank(ctx, this.player);

      this.drawTrees(ctx);
      this.drawBullets(ctx);
      this.drawWrecks(ctx);
      this.drawParticles(ctx);
      this.drawFloaters(ctx);
      this.drawDangerVignette(ctx);

      if (this.flash > 0.01) {
        ctx.globalAlpha = clamp(this.flash, 0, 1) * 0.34;
        ctx.fillStyle = this.flashColor;
        ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
        ctx.globalAlpha = 1;
      }

      this.drawBanner(ctx);
      this.drawFieldScanlines(ctx);
    }

    drawTiles(ctx) {
      for (let cy = 0; cy < ROWS; cy += 1) {
        for (let cx = 0; cx < COLS; cx += 1) {
          const tile = this.map[cy][cx];
          const x = FIELD_X + cx * TILE;
          const y = FIELD_Y + cy * TILE;
          if (tile === T.BRICK) {
            ctx.drawImage(this.sprites.brick, x, y);
          } else if (tile === T.STEEL) {
            ctx.drawImage(this.sprites.steel, x, y);
            if (this.shovelTimer > 0) {
              ctx.fillStyle = 'rgba(245, 192, 90, 0.11)';
              ctx.fillRect(x, y, TILE, TILE);
            }
          } else if (tile === T.ICE) {
            ctx.drawImage(this.sprites.ice, x, y);
          } else if (tile === T.WATER) {
            this.drawWater(ctx, x, y, cx, cy);
          }
        }
      }
    }

    drawWater(ctx, x, y, cx, cy) {
      ctx.save();
      ctx.fillStyle = '#16485e';
      ctx.fillRect(x, y, TILE, TILE);
      ctx.fillStyle = '#20657d';
      ctx.fillRect(x + 2, y + 2, TILE - 4, TILE - 4);
      ctx.strokeStyle = 'rgba(117, 218, 231, 0.62)';
      ctx.lineWidth = 2;
      for (let row = 0; row < 3; row += 1) {
        const offset = Math.sin(this.time * 2.4 + cx * 0.8 + cy * 0.55 + row * 1.5) * 5;
        const yy = y + 10 + row * 13;
        ctx.beginPath();
        ctx.moveTo(x + 5 + offset, yy);
        ctx.lineTo(x + 17 + offset, yy + 2);
        ctx.lineTo(x + 29 + offset, yy);
        ctx.lineTo(x + 43 + offset, yy + 2);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(214, 251, 255, 0.48)';
      const glint = Math.sin(this.time * 3 + cx + cy * 2) * 0.5 + 0.5;
      ctx.fillRect(x + 9 + glint * 17, y + 7, 5, 2);
      ctx.strokeStyle = 'rgba(7, 24, 32, 0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
      ctx.restore();
    }

    drawSpawnPads(ctx) {
      for (let i = 0; i < ENEMY_SPAWNS.length; i += 1) {
        const cell = ENEMY_SPAWNS[i];
        const x = FIELD_X + cell.x * TILE;
        const y = FIELD_Y + cell.y * TILE;
        const pulse = 0.5 + Math.sin(this.time * 3 + i * 2) * 0.2;
        ctx.strokeStyle = `rgba(255, 113, 82, ${0.24 + pulse * 0.4})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x + 8, y + 8, TILE - 16, TILE - 16);
        ctx.beginPath();
        ctx.moveTo(x + TILE / 2, y + 12);
        ctx.lineTo(x + 15, y + 23);
        ctx.lineTo(x + TILE / 2, y + 18);
        ctx.lineTo(x + 33, y + 23);
        ctx.closePath();
        ctx.strokeStyle = `rgba(255, 142, 103, ${0.4 + pulse * 0.5})`;
        ctx.stroke();
        ctx.fillStyle = 'rgba(255, 128, 88, 0.7)';
        ctx.fillRect(x + TILE / 2 - 3, y + 35, 6, 2);
      }

      const px = FIELD_X + PLAYER_SPAWN.x * TILE;
      const py = FIELD_Y + PLAYER_SPAWN.y * TILE;
      ctx.strokeStyle = 'rgba(126, 226, 161, 0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 7, py + 7, TILE - 14, TILE - 14);
      ctx.fillStyle = 'rgba(126, 226, 161, 0.5)';
      ctx.fillRect(px + TILE / 2 - 3, py + 32, 6, 2);
    }

    drawBase(ctx) {
      const x = FIELD_X + this.base.x * TILE;
      const y = FIELD_Y + this.base.y * TILE;
      const cx = x + TILE / 2;
      const cy = y + TILE / 2;

      if (!this.baseAlive) {
        ctx.fillStyle = '#171a1b';
        ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        ctx.fillStyle = '#2a2b28';
        ctx.fillRect(x + 8, y + 30, 32, 10);
        ctx.fillStyle = '#5b3f25';
        ctx.fillRect(x + 14, y + 20, 8, 9);
        ctx.fillStyle = '#292b29';
        ctx.fillRect(x + 26, y + 15, 9, 12);
        ctx.strokeStyle = 'rgba(255, 114, 74, 0.4)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 9, y + 9, TILE - 18, TILE - 18);
        return;
      }

      const pulse = 0.5 + Math.sin(this.time * 2.5) * 0.5;
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, 31);
      glow.addColorStop(0, `rgba(246, 196, 86, ${0.16 + pulse * 0.08})`);
      glow.addColorStop(1, 'rgba(246, 196, 86, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 4, y - 4, TILE + 8, TILE + 8);

      ctx.fillStyle = '#27241c';
      ctx.fillRect(x + 5, y + 5, TILE - 10, TILE - 10);
      ctx.fillStyle = '#4b4029';
      ctx.fillRect(x + 7, y + 7, TILE - 14, TILE - 14);
      ctx.fillStyle = '#1a1915';
      ctx.fillRect(x + 11, y + 11, TILE - 22, TILE - 22);

      // 像素鹰徽
      ctx.fillStyle = '#e2b65b';
      ctx.fillRect(cx - 3, cy - 13, 6, 8);
      ctx.fillStyle = '#f7df9f';
      ctx.fillRect(cx - 2, cy - 15, 5, 4);
      ctx.fillRect(cx + 3, cy - 13, 4, 3);
      ctx.fillStyle = '#c78f37';
      ctx.fillRect(cx - 10, cy - 6, 20, 4);
      ctx.fillRect(cx - 13, cy - 3, 26, 3);
      ctx.fillRect(cx - 8, cy, 16, 3);
      ctx.fillStyle = '#f7df9f';
      ctx.fillRect(cx - 8, cy - 6, 16, 2);
      ctx.fillStyle = '#8f6327';
      ctx.fillRect(cx - 2, cy + 3, 4, 9);
      ctx.fillRect(cx - 7, cy + 11, 14, 3);
      ctx.fillStyle = '#f6c84a';
      ctx.fillRect(cx - 5, cy + 5, 3, 3);
      ctx.fillRect(cx + 2, cy + 5, 3, 3);

      if (this.shovelTimer > 0) {
        ctx.strokeStyle = `rgba(246, 200, 103, ${0.35 + pulse * 0.35})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, TILE + 4, TILE + 4);
      }
    }

    drawTrees(ctx) {
      for (let cy = 0; cy < ROWS; cy += 1) {
        for (let cx = 0; cx < COLS; cx += 1) {
          if (this.map[cy][cx] !== T.TREE) continue;
          const x = FIELD_X + cx * TILE;
          const y = FIELD_Y + cy * TILE;
          ctx.save();
          ctx.translate(x + TILE / 2, y + TILE / 2);
          ctx.rotate(Math.sin(this.time * 1.15 + cx * 0.7 + cy) * 0.018);
          ctx.drawImage(this.sprites.tree, -TILE / 2, -TILE / 2);
          ctx.restore();
        }
      }
    }

    drawTrackMarks(ctx) {
      for (const mark of this.trackMarks) {
        const alpha = clamp(mark.life / mark.max, 0, 1) * 0.22;
        if (alpha <= 0.005) continue;
        const direction = DIRECTIONS[mark.dir];
        ctx.save();
        ctx.translate(mark.x, mark.y);
        ctx.rotate(direction.angle);
        ctx.fillStyle = `rgba(8, 13, 14, ${alpha})`;
        ctx.fillRect(-3.5, -1.5, 7, 3);
        ctx.restore();
      }
    }

    drawPowerups(ctx) {
      for (const powerup of this.powerups) {
        if (!powerup.alive) continue;
        if (powerup.life < 3 && Math.floor(powerup.life * 8) % 2 === 0) continue;
        const bob = Math.sin(this.time * 4 + powerup.phase) * 3;
        const x = powerup.x;
        const y = powerup.y + bob;
        const pulse = 0.5 + Math.sin(this.time * 5 + powerup.phase) * 0.5;

        ctx.save();
        ctx.translate(x, y);
        ctx.shadowColor = powerup.type.color;
        ctx.shadowBlur = 12 + pulse * 8;
        ctx.fillStyle = 'rgba(10, 14, 16, 0.92)';
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeStyle = powerup.type.color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-15, -15, 30, 30);
        ctx.fillStyle = powerup.type.color;
        ctx.globalAlpha = 0.18 + pulse * 0.12;
        ctx.fillRect(-12, -12, 24, 24);
        ctx.globalAlpha = 1;
        ctx.fillStyle = powerup.type.color;
        ctx.font = 'bold 17px "Arial Black", "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(powerup.type.symbol, 0, 1);
        ctx.restore();

        ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 + pulse * 0.15})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 20 + pulse * 3, 0, TAU);
        ctx.stroke();
      }
    }

    drawTank(ctx, tank) {
      if (!tank.alive) return;
      if (tank.spawnTimer > 0) {
        this.drawSpawnEffect(ctx, tank);
        return;
      }

      const center = this.entityCenter(tank);
      const isPlayer = tank === this.player;
      const config = isPlayer ? null : tank.config;
      const color = isPlayer ? '#62d287' : config.color;
      const dark = isPlayer ? '#235d3c' : config.dark;
      const light = isPlayer ? '#c9ffda' : config.light;
      const direction = DIRECTIONS[tank.dir];
      const hurt = !isPlayer && tank.maxHp > 1 ? 1 - tank.hp / tank.maxHp : 0;

      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
      ctx.beginPath();
      ctx.ellipse(0, 5, 19, 16, 0, 0, TAU);
      ctx.fill();
      ctx.rotate(direction.angle);

      // 履带
      ctx.fillStyle = '#151b1d';
      ctx.fillRect(-18, -16, 8, 34);
      ctx.fillRect(10, -16, 8, 34);
      ctx.fillStyle = '#394145';
      const treadOffset = tank.trackPhase || 0;
      for (let i = -15; i <= 15; i += 6) {
        const yy = i + (treadOffset % 6);
        ctx.fillRect(-17.5, yy, 7, 2);
        ctx.fillRect(10.5, yy, 7, 2);
      }
      ctx.fillStyle = '#0e1315';
      ctx.fillRect(-18, -16, 2, 34);
      ctx.fillRect(16, -16, 2, 34);

      // 炮管
      const recoil = (tank.recoil || 0) * 2.4;
      ctx.fillStyle = dark;
      ctx.fillRect(-3.5, -25 + recoil, 7, 16);
      ctx.fillStyle = light;
      ctx.fillRect(-2, -25 + recoil, 2, 13);
      ctx.fillStyle = '#121819';
      ctx.fillRect(-4.5, -27 + recoil, 9, 4);

      // 车体
      ctx.fillStyle = dark;
      ctx.fillRect(-12, -15, 24, 30);
      ctx.beginPath();
      ctx.moveTo(-12, -15);
      ctx.lineTo(12, -15);
      ctx.lineTo(14, -10);
      ctx.lineTo(14, 10);
      ctx.lineTo(12, 15);
      ctx.lineTo(-12, 15);
      ctx.lineTo(-14, 10);
      ctx.lineTo(-14, -10);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();

      ctx.fillStyle = light;
      ctx.fillRect(-9, -12, 18, 3);
      ctx.fillRect(-9, -10, 3, 17);
      ctx.fillStyle = 'rgba(10, 18, 17, 0.24)';
      ctx.fillRect(7, -9, 5, 20);
      ctx.fillRect(-9, 8, 15, 4);

      // 炮塔
      ctx.beginPath();
      ctx.arc(0, 0, 8.5, 0, TAU);
      ctx.fillStyle = dark;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-0.5, -0.5, 6.8, 0, TAU);
      ctx.fillStyle = light;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 5.4, 0, TAU);
      ctx.fillStyle = color;
      ctx.fill();

      if (isPlayer) {
        ctx.fillStyle = '#203c2c';
        ctx.fillRect(-1.8, -4, 3.6, 8);
        ctx.fillRect(-4, -1.5, 8, 3);
      } else if (tank.type === 'armor') {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(-7, -7, 14, 2);
        ctx.fillRect(-7, 5, 14, 2);
        ctx.fillStyle = '#2c2547';
        ctx.fillRect(-9, -2, 3, 4);
        ctx.fillRect(6, -2, 3, 4);
      } else if (tank.type === 'power') {
        ctx.fillStyle = light;
        ctx.fillRect(-2, -7, 4, 14);
      } else if (tank.type === 'fast') {
        ctx.fillStyle = light;
        ctx.fillRect(-8, 8, 4, 4);
        ctx.fillRect(4, 8, 4, 4);
      }

      if (hurt > 0.01) {
        ctx.fillStyle = `rgba(15, 13, 22, ${hurt * 0.32})`;
        ctx.fillRect(-14, -15, 28, 30);
      }

      if (tank.bonus && Math.floor(this.time * 10) % 2 === 0) {
        ctx.fillStyle = 'rgba(255, 245, 199, 0.65)';
        ctx.fillRect(-9, -12, 18, 3);
        ctx.fillRect(-12, -3, 3, 15);
      }

      if (tank.frozen) {
        ctx.fillStyle = 'rgba(132, 219, 255, 0.34)';
        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeStyle = 'rgba(218, 250, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(10, 10);
        ctx.moveTo(10, -10);
        ctx.lineTo(-10, 10);
        ctx.stroke();
      }
      ctx.restore();

      if (isPlayer && tank.shieldTimer > 0) {
        const alpha = 0.45 + Math.sin(this.time * 8) * 0.16;
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.rotate(this.time * 1.8);
        ctx.strokeStyle = `rgba(100, 225, 255, ${alpha})`;
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i += 1) {
          ctx.beginPath();
          ctx.arc(0, 0, 24, i * Math.PI / 2 + 0.25, i * Math.PI / 2 + 1.15);
          ctx.stroke();
        }
        ctx.fillStyle = `rgba(100, 225, 255, ${alpha * 0.35})`;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (tank.bonus) {
        const yy = center.y - 29;
        ctx.fillStyle = Math.floor(this.time * 8) % 2 === 0 ? '#ffe6a1' : '#ff8b62';
        ctx.beginPath();
        ctx.moveTo(center.x, yy - 5);
        ctx.lineTo(center.x + 5, yy);
        ctx.lineTo(center.x, yy + 5);
        ctx.lineTo(center.x - 5, yy);
        ctx.closePath();
        ctx.fill();
      }

      if (!isPlayer && tank.maxHp > 1) {
        for (let i = 0; i < tank.maxHp; i += 1) {
          ctx.fillStyle = i < tank.hp ? 'rgba(230, 222, 255, 0.8)' : 'rgba(20, 18, 26, 0.5)';
          ctx.fillRect(center.x - tank.maxHp * 3 + i * 6, center.y - 28, 4, 2);
        }
      }
    }

    drawSpawnEffect(ctx, tank) {
      const progress = 1 - tank.spawnTimer / tank.spawnTotal;
      const center = this.entityCenter(tank);
      const color = tank === this.player ? '#7ee2a1' : tank.config.color;
      const radius = 8 + progress * 18;
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(this.time * 7 + progress * 3);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3 + progress * 0.55;
      ctx.lineWidth = 2;
      for (let i = 0; i < 4; i += 1) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -radius);
        ctx.lineTo(0, -radius + 12);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.55, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();

      if (tank === this.player) {
        ctx.fillStyle = 'rgba(126, 226, 161, 0.12)';
        ctx.fillRect(center.x - 18, center.y - 18, 36, 36);
      }
    }

    drawBullets(ctx) {
      for (const bullet of this.bullets) {
        if (!bullet.alive) continue;
        const direction = DIRECTIONS[bullet.dir];
        ctx.save();
        ctx.translate(bullet.x, bullet.y);
        ctx.rotate(direction.angle);
        ctx.shadowColor = bullet.color;
        ctx.shadowBlur = 10;
        ctx.strokeStyle = bullet.owner === 'player' ? 'rgba(255, 228, 140, 0.42)' : 'rgba(255, 118, 89, 0.35)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 12);
        ctx.lineTo(0, 4);
        ctx.stroke();
        ctx.fillStyle = bullet.color;
        ctx.fillRect(-3, -4, 6, 9);
        ctx.fillStyle = '#fff9df';
        ctx.fillRect(-1.5, -4, 3, 4);
        ctx.restore();
      }
    }

    drawParticles(ctx) {
      for (const particle of this.particles) {
        const alpha = clamp(particle.life / particle.max, 0, 1);
        if (particle.type === 'ring') {
          const progress = 1 - alpha;
          ctx.save();
          ctx.globalAlpha = alpha * 0.85;
          ctx.strokeStyle = particle.color;
          ctx.lineWidth = 2 + (1 - alpha) * 2;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size + progress * particle.size * 1.8, 0, TAU);
          ctx.stroke();
          ctx.restore();
        } else if (particle.type === 'smoke') {
          ctx.save();
          ctx.globalAlpha = alpha * 0.24;
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1.4 - alpha * 0.4), 0, TAU);
          ctx.fill();
          ctx.restore();
        } else if (particle.type === 'flash') {
          ctx.save();
          ctx.globalAlpha = alpha * 0.8;
          ctx.fillStyle = particle.color;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1 - alpha * 0.4), 0, TAU);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = particle.color;
          const size = particle.type === 'spark' ? particle.size : particle.size * (0.6 + alpha * 0.4);
          ctx.fillRect(particle.x - size / 2, particle.y - size / 2, size, size);
        }
      }
      ctx.globalAlpha = 1;
    }

    drawFloaters(ctx) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 12px "SFMono-Regular", "PingFang SC", monospace';
      for (const floater of this.floaters) {
        const alpha = clamp(floater.life / floater.max, 0, 1);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillText(floater.text, floater.x + 1, floater.y + 1);
        ctx.fillStyle = floater.color;
        ctx.fillText(floater.text, floater.x, floater.y);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    drawWrecks(ctx) {
      for (const wreck of this.wrecks) {
        const alpha = clamp(wreck.life / wreck.max, 0, 1);
        ctx.save();
        ctx.translate(wreck.x, wreck.y);
        ctx.rotate(DIRECTIONS[wreck.dir].angle);
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = '#111415';
        ctx.fillRect(-16, -14, 7, 28);
        ctx.fillRect(9, -14, 7, 28);
        ctx.fillStyle = '#242729';
        ctx.fillRect(-10, -11, 20, 22);
        ctx.fillStyle = 'rgba(255, 105, 63, 0.35)';
        ctx.fillRect(-5, -3, 10, 6);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    drawDangerVignette(ctx) {
      if (this.mode !== 'playing' && this.mode !== 'paused') return;
      const pulse = 0.5 + Math.sin(this.time * 3) * 0.5;
      const gradient = ctx.createRadialGradient(
        this.base.cx, this.base.cy, 20,
        this.base.cx, this.base.cy, 230
      );
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, `rgba(13, 35, 28, ${0.13 + pulse * 0.03})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
    }

    drawBanner(ctx) {
      if (!this.banner) return;
      let timer = this.banner.timer;
      let total = this.banner.total;
      if (this.banner.kind === 'clear') {
        timer = this.levelClearTimer;
        total = 3;
      }
      if (timer <= 0) return;
      const elapsed = total - timer;
      const fadeIn = clamp(elapsed / 0.28, 0, 1);
      const fadeOut = clamp(timer / 0.45, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      if (alpha <= 0) return;

      const centerY = FIELD_Y + FIELD_H / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      const gradient = ctx.createLinearGradient(FIELD_X, 0, FIELD_X + FIELD_W, 0);
      gradient.addColorStop(0, 'rgba(5, 9, 10, 0)');
      gradient.addColorStop(0.2, 'rgba(5, 9, 10, 0.9)');
      gradient.addColorStop(0.8, 'rgba(5, 9, 10, 0.9)');
      gradient.addColorStop(1, 'rgba(5, 9, 10, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(FIELD_X, centerY - 54, FIELD_W, 108);

      ctx.strokeStyle = this.banner.color;
      ctx.globalAlpha = alpha * 0.75;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(FIELD_X + 68, centerY - 44);
      ctx.lineTo(FIELD_X + FIELD_W - 68, centerY - 44);
      ctx.moveTo(FIELD_X + 68, centerY + 44);
      ctx.lineTo(FIELD_X + FIELD_W - 68, centerY + 44);
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 34px "Arial Black", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.fillText(this.banner.title, FIELD_X + FIELD_W / 2 + 2, centerY - 10);
      ctx.fillStyle = this.banner.color;
      ctx.fillText(this.banner.title, FIELD_X + FIELD_W / 2, centerY - 12);

      ctx.font = '600 11px "SFMono-Regular", "PingFang SC", monospace';
      ctx.fillStyle = 'rgba(244, 238, 215, 0.8)';
      ctx.fillText(this.banner.subtitle, FIELD_X + FIELD_W / 2, centerY + 24);
      ctx.restore();
    }

    drawFieldScanlines(ctx) {
      ctx.save();
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#000000';
      for (let y = FIELD_Y; y < FIELD_Y + FIELD_H; y += 4) {
        ctx.fillRect(FIELD_X, y, FIELD_W, 1);
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 2;
      ctx.strokeRect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
    }
  }

  window.TB.TankGame = TankGame;
})();
