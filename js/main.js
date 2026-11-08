/* 坦克大战 · 页面交互与 HUD */
(function () {
  'use strict';

  const DIFFICULTY_KEY = 'tank-battle-difficulty';

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const pad = (value, length) => String(Math.max(0, Math.floor(value))).padStart(length, '0');

  class InputController {
    constructor() {
      this.keys = new Set();
      this.directionStack = [];
      this.touchDirection = null;
      this.touchFire = false;
      this.enabled = true;

      this.directionByCode = {
        ArrowUp: 'up', KeyW: 'up',
        ArrowRight: 'right', KeyD: 'right',
        ArrowDown: 'down', KeyS: 'down',
        ArrowLeft: 'left', KeyA: 'left'
      };
      this.fireCodes = new Set(['Space', 'KeyJ', 'KeyK']);
      this.bind();
    }

    bind() {
      window.addEventListener('keydown', (event) => {
        const direction = this.directionByCode[event.code];
        if (direction) {
          event.preventDefault();
          if (!event.repeat && !this.directionStack.includes(direction)) {
            this.directionStack.push(direction);
          }
          return;
        }
        if (this.fireCodes.has(event.code)) {
          if (event.code === 'Space') event.preventDefault();
          this.keys.add(event.code);
        }
      });

      window.addEventListener('keyup', (event) => {
        const direction = this.directionByCode[event.code];
        if (direction) {
          event.preventDefault();
          this.directionStack = this.directionStack.filter((entry) => entry !== direction);
          return;
        }
        if (this.fireCodes.has(event.code)) {
          if (event.code === 'Space') event.preventDefault();
          this.keys.delete(event.code);
        }
      });

      window.addEventListener('blur', () => this.reset());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.reset();
      });
    }

    reset() {
      this.keys.clear();
      this.directionStack = [];
      this.touchDirection = null;
      this.touchFire = false;
    }

    getDirection() {
      if (!this.enabled) return null;
      if (this.touchDirection) return this.touchDirection;
      if (!this.directionStack.length) return null;
      return this.directionStack[this.directionStack.length - 1];
    }

    isFiring() {
      if (!this.enabled) return false;
      if (this.touchFire) return true;
      for (const code of this.fireCodes) {
        if (this.keys.has(code)) return true;
      }
      return false;
    }

    setTouchVector(x, y) {
      const magnitude = Math.hypot(x, y);
      if (magnitude < 0.22) {
        this.touchDirection = null;
        return;
      }
      this.touchDirection = Math.abs(x) > Math.abs(y)
        ? (x > 0 ? 'right' : 'left')
        : (y > 0 ? 'down' : 'up');
    }

    setTouchFire(active) {
      this.touchFire = Boolean(active);
    }
  }

  const elements = {
    canvas: document.getElementById('game'),
    menuOverlay: document.getElementById('menuOverlay'),
    pauseOverlay: document.getElementById('pauseOverlay'),
    endOverlay: document.getElementById('endOverlay'),
    startBtn: document.getElementById('startBtn'),
    resumeBtn: document.getElementById('resumeBtn'),
    quitBtn: document.getElementById('quitBtn'),
    againBtn: document.getElementById('againBtn'),
    menuBtn: document.getElementById('menuBtn'),
    soundBtn: document.getElementById('soundBtn'),
    soundLabel: document.getElementById('soundLabel'),
    pauseBtn: document.getElementById('pauseBtn'),
    pauseLabel: document.getElementById('pauseLabel'),
    levelEl: document.getElementById('levelValue'),
    stageNameEl: document.getElementById('stageName'),
    enemyEl: document.getElementById('enemyValue'),
    livesEl: document.getElementById('livesValue'),
    scoreEl: document.getElementById('scoreValue'),
    hiEl: document.getElementById('hiValue'),
    powerDots: document.getElementById('powerDots'),
    powerLabel: document.getElementById('powerLabel'),
    diffBadge: document.getElementById('diffBadge'),
    buffsEl: document.getElementById('buffs'),
    endKicker: document.getElementById('endKicker'),
    endTitle: document.getElementById('endTitle'),
    endText: document.getElementById('endText'),
    endScore: document.getElementById('endScore'),
    endBest: document.getElementById('endBest'),
    endStage: document.getElementById('endStage'),
    endKills: document.getElementById('endKills'),
    endCard: document.getElementById('endCard'),
    endDifficulty: document.getElementById('endDifficulty'),
    joystick: document.getElementById('joystick'),
    joystickKnob: document.getElementById('joystickKnob'),
    fireBtn: document.getElementById('fireBtn'),
    touchControls: document.getElementById('touchControls')
  };

  const audio = new window.TankAudio();
  const input = new InputController();
  let selectedDifficulty = loadDifficulty();
  let endTimer = 0;
  let game = null;

  function loadDifficulty() {
    try {
      const stored = localStorage.getItem(DIFFICULTY_KEY);
      return window.TB.DIFFICULTIES[stored] ? stored : 'classic';
    } catch (error) {
      return 'classic';
    }
  }

  function saveDifficulty(key) {
    try {
      localStorage.setItem(DIFFICULTY_KEY, key);
    } catch (error) {
      /* localStorage 不可用时静默降级 */
    }
  }

  function updateSoundButton() {
    elements.soundBtn.classList.toggle('is-off', !audio.enabled);
    elements.soundBtn.setAttribute('aria-pressed', audio.enabled ? 'true' : 'false');
    elements.soundLabel.textContent = audio.enabled ? '音效' : '静音';
  }

  function selectDifficulty(key, notifyGame) {
    if (!window.TB.DIFFICULTIES[key]) return;
    selectedDifficulty = key;
    saveDifficulty(key);
    document.querySelectorAll('.difficulty-option').forEach((button) => {
      const selected = button.dataset.difficulty === key;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (notifyGame && game) game.setMenuDifficulty(key);
  }

  function buildLifeIcons(count) {
    const safeCount = clamp(count, 0, 9);
    if (safeCount === 0) return '<span class="lives-empty">—</span>';
    if (safeCount > 5) {
      return `<span class="life-icon" aria-hidden="true"></span><span class="lives-more">×${safeCount}</span>`;
    }
    return Array.from({ length: safeCount }, () => '<span class="life-icon" aria-hidden="true"></span>').join('');
  }

  function buildPowerDots(power) {
    return Array.from({ length: 4 }, (_, index) => (
      `<span class="power-dot${index <= power ? ' is-active' : ''}"></span>`
    )).join('');
  }

  function updateHud(state) {
    elements.levelEl.textContent = pad(state.level, 2);
    elements.stageNameEl.textContent = state.levelName;
    elements.enemyEl.textContent = pad(state.remaining, 2);
    elements.livesEl.innerHTML = buildLifeIcons(state.lives);
    elements.scoreEl.textContent = pad(state.score, 6);
    elements.hiEl.textContent = pad(state.hiScore, 6);
    elements.powerDots.innerHTML = buildPowerDots(state.power);
    elements.powerLabel.textContent = state.powerLabel;
    elements.diffBadge.textContent = state.difficulty;
    elements.diffBadge.dataset.difficulty = state.difficultyKey || selectedDifficulty;

    const buffMarkup = state.buffs.length
      ? state.buffs.map((buff) => (
        `<span class="buff" style="--buff-color:${buff.color}"><i></i>${buff.label} <b>${buff.time}s</b></span>`
      )).join('')
      : '<span class="buff-empty">战术增益待命</span>';
    if (elements.buffsEl.innerHTML !== buffMarkup) elements.buffsEl.innerHTML = buffMarkup;
  }

  function hideAllOverlays() {
    elements.menuOverlay.classList.add('is-hidden');
    elements.pauseOverlay.classList.add('is-hidden');
    elements.endOverlay.classList.add('is-hidden');
  }

  function clearEndTimer() {
    if (endTimer) {
      window.clearTimeout(endTimer);
      endTimer = 0;
    }
  }

  function showMenu() {
    clearEndTimer();
    hideAllOverlays();
    elements.menuOverlay.classList.remove('is-hidden');
    elements.pauseBtn.classList.add('is-hidden');
    elements.pauseBtn.classList.remove('is-active');
    elements.pauseLabel.textContent = '暂停';
    elements.endCard.classList.remove('is-victory');
    input.reset();
    if (game) game.toMenu();
    updateSoundButton();
    selectDifficulty(selectedDifficulty, false);
  }

  function startGame() {
    clearEndTimer();
    hideAllOverlays();
    audio.init();
    input.reset();
    elements.pauseBtn.classList.remove('is-hidden');
    elements.pauseBtn.classList.remove('is-active');
    elements.pauseLabel.textContent = '暂停';
    selectDifficulty(selectedDifficulty, false);
    game.startRun(selectedDifficulty);
    elements.startBtn.blur();
  }

  function pauseGame() {
    if (!game) return;
    if (game.mode === 'playing') {
      game.pause();
    } else if (game.mode === 'paused') {
      game.resume();
    }
  }

  function handlePauseChange(paused) {
    if (paused) {
      elements.pauseOverlay.classList.remove('is-hidden');
      elements.pauseBtn.classList.add('is-active');
      elements.pauseLabel.textContent = '继续';
      elements.resumeBtn.focus({ preventScroll: true });
    } else {
      elements.pauseOverlay.classList.add('is-hidden');
      elements.pauseBtn.classList.remove('is-active');
      elements.pauseLabel.textContent = '暂停';
    }
  }

  function handleEnd(payload) {
    clearEndTimer();
    elements.pauseBtn.classList.add('is-hidden');
    elements.pauseOverlay.classList.add('is-hidden');
    elements.menuOverlay.classList.add('is-hidden');
    elements.endOverlay.classList.remove('is-hidden');
    elements.endCard.classList.toggle('is-victory', payload.victory);
    elements.endKicker.textContent = payload.victory ? 'MISSION COMPLETE' : 'MISSION FAILED';
    elements.endTitle.textContent = payload.victory
      ? '防线守住了'
      : (payload.reason === 'base' ? '基地被摧毁' : '全军覆没');
    elements.endText.textContent = payload.victory
      ? '五关敌军全部肃清。指挥官，这片战场以你为名。'
      : (payload.reason === 'base'
        ? '基地失守，防线崩溃。下一次，把砖墙守到最后一秒。'
        : '坦克全部损失。调整节奏，再来一次。');
    elements.endScore.textContent = pad(payload.score, 6);
    elements.endBest.textContent = pad(payload.hiScore, 6);
    elements.endStage.textContent = pad(payload.level, 2);
    elements.endKills.textContent = pad(payload.kills, 2);
    elements.endDifficulty.textContent = payload.difficulty;
    elements.againBtn.textContent = payload.victory ? '重返战场' : '再战一局';
    window.setTimeout(() => elements.againBtn.focus({ preventScroll: true }), 80);
  }

  function bindButtons() {
    document.querySelectorAll('.difficulty-option').forEach((button) => {
      button.addEventListener('click', () => {
        audio.init();
        audio.play('ui');
        selectDifficulty(button.dataset.difficulty, true);
      });
    });

    elements.startBtn.addEventListener('click', () => {
      audio.init();
      audio.play('ui');
      startGame();
    });

    elements.resumeBtn.addEventListener('click', () => {
      audio.play('ui');
      game.resume();
    });

    elements.quitBtn.addEventListener('click', () => {
      audio.play('ui');
      clearEndTimer();
      showMenu();
    });

    elements.againBtn.addEventListener('click', () => {
      audio.init();
      audio.play('ui');
      startGame();
    });

    elements.menuBtn.addEventListener('click', () => {
      audio.play('ui');
      showMenu();
    });

    elements.soundBtn.addEventListener('click', () => {
      audio.init();
      audio.toggle();
      updateSoundButton();
    });

    elements.pauseBtn.addEventListener('click', () => {
      audio.play('ui');
      pauseGame();
    });

    window.addEventListener('keydown', (event) => {
      const code = event.code;
      if (code === 'Enter') {
        if (!elements.menuOverlay.classList.contains('is-hidden')) {
          event.preventDefault();
          audio.init();
          startGame();
        } else if (!elements.pauseOverlay.classList.contains('is-hidden')) {
          event.preventDefault();
          game.resume();
        } else if (!elements.endOverlay.classList.contains('is-hidden')) {
          event.preventDefault();
          audio.init();
          startGame();
        }
        return;
      }
      if (code === 'KeyP' || code === 'Escape') {
        if (game && (game.mode === 'playing' || game.mode === 'paused')) {
          event.preventDefault();
          audio.play('ui');
          pauseGame();
        }
        return;
      }
      if (code === 'KeyM') {
        event.preventDefault();
        audio.init();
        audio.toggle();
        updateSoundButton();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && game && game.mode === 'playing') {
        game.pause();
      }
    });
    window.addEventListener('blur', () => {
      if (game && game.mode === 'playing') {
        game.pause();
      }
    });

    window.addEventListener('pointerdown', () => audio.init(), { once: true });
  }

  function bindTouchControls() {
    const joystick = elements.joystick;
    const knob = elements.joystickKnob;
    let pointerId = null;

    const updateJoystick = (event) => {
      const rect = joystick.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const maxRadius = rect.width * 0.31;
      let dx = event.clientX - centerX;
      let dy = event.clientY - centerY;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude > maxRadius) {
        dx = (dx / magnitude) * maxRadius;
        dy = (dy / magnitude) * maxRadius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const normalizedX = dx / maxRadius;
      const normalizedY = dy / maxRadius;
      input.setTouchVector(normalizedX, normalizedY);
    };

    const releaseJoystick = (event) => {
      if (pointerId !== null && event.pointerId !== pointerId) return;
      pointerId = null;
      knob.style.transform = 'translate(0px, 0px)';
      joystick.classList.remove('is-active');
      input.setTouchVector(0, 0);
    };

    joystick.addEventListener('pointerdown', (event) => {
      if (pointerId !== null) return;
      pointerId = event.pointerId;
      joystick.setPointerCapture(pointerId);
      joystick.classList.add('is-active');
      updateJoystick(event);
      event.preventDefault();
      audio.init();
    });
    joystick.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerId) return;
      updateJoystick(event);
      event.preventDefault();
    });
    joystick.addEventListener('pointerup', releaseJoystick);
    joystick.addEventListener('pointercancel', releaseJoystick);
    joystick.addEventListener('lostpointercapture', releaseJoystick);

    const setFire = (active) => {
      input.setTouchFire(active);
      elements.fireBtn.classList.toggle('is-active', active);
    };

    elements.fireBtn.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      audio.init();
      elements.fireBtn.setPointerCapture(event.pointerId);
      setFire(true);
    });
    const stopFire = (event) => {
      event.preventDefault();
      setFire(false);
    };
    elements.fireBtn.addEventListener('pointerup', stopFire);
    elements.fireBtn.addEventListener('pointercancel', stopFire);
    elements.fireBtn.addEventListener('lostpointercapture', () => setFire(false));
    elements.fireBtn.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  function boot() {
    selectDifficulty(selectedDifficulty, false);
    updateSoundButton();

    game = new window.TB.TankGame({
      canvas: elements.canvas,
      audio,
      input,
      difficultyKey: selectedDifficulty,
      onHud: updateHud,
      onEnd: handleEnd,
      onPauseChange: handlePauseChange
    });

    bindButtons();
    bindTouchControls();
    showMenu();

    window.__tankGame = game;
    window.__tankInput = input;

    let lastTime = performance.now();
    function frame(now) {
      const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      game.tick(dt);
      game.render();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
