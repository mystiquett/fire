/* 坦克大战 · 程序化音效引擎 */
(function () {
  'use strict';

  const STORAGE_KEY = 'tank-battle-sound';

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.noiseBuffer = null;
      this.enabled = this.loadEnabled();
      this.lastShot = 0;
    }

    loadEnabled() {
      try {
        const value = localStorage.getItem(STORAGE_KEY);
        return value === null ? true : value === '1';
      } catch (error) {
        return true;
      }
    }

    saveEnabled() {
      try {
        localStorage.setItem(STORAGE_KEY, this.enabled ? '1' : '0');
      } catch (error) {
        /* localStorage 不可用时静默降级 */
      }
    }

    init() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? 0.5 : 0;
        this.master.connect(this.ctx.destination);
        this.noiseBuffer = this.makeNoise(1.2);
      } catch (error) {
        this.ctx = null;
      }
    }

    makeNoise(seconds) {
      const rate = this.ctx.sampleRate;
      const length = Math.floor(rate * seconds);
      const buffer = this.ctx.createBuffer(1, length, rate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < length; i += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.86 + white * 0.14;
        data[i] = last;
      }
      return buffer;
    }

    setEnabled(value) {
      this.enabled = Boolean(value);
      this.saveEnabled();
      if (this.ctx && this.master) {
        this.master.gain.setTargetAtTime(this.enabled ? 0.5 : 0, this.ctx.currentTime, 0.02);
      }
    }

    toggle() {
      this.setEnabled(!this.enabled);
      if (this.enabled) this.play('ui');
      return this.enabled;
    }

    tone(options) {
      if (!this.ctx || !this.enabled) return;
      try {
        const {
          freq = 220,
          endFreq = freq,
          duration = 0.12,
          type = 'square',
          volume = 0.05,
          delay = 0,
          attack = 0.004
        } = options;
        const start = this.ctx.currentTime + delay;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + duration);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        osc.connect(gain);
        gain.connect(this.master);
        osc.start(start);
        osc.stop(start + duration + 0.02);
      } catch (error) {
        /* 忽略音频节点异常 */
      }
    }

    noise(options) {
      if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
      try {
        const {
          duration = 0.3,
          volume = 0.08,
          frequency = 900,
          q = 0.7,
          type = 'lowpass',
          delay = 0,
          playbackRate = 1
        } = options;
        const start = this.ctx.currentTime + delay;
        const source = this.ctx.createBufferSource();
        source.buffer = this.noiseBuffer;
        source.playbackRate.value = playbackRate;
        const filter = this.ctx.createBiquadFilter();
        filter.type = type;
        filter.frequency.setValueAtTime(frequency, start);
        filter.Q.value = q;
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        source.start(start);
        source.stop(start + duration + 0.02);
      } catch (error) {
        /* 忽略音频节点异常 */
      }
    }

    play(name) {
      if (!this.enabled) return;
      if (!this.ctx) this.init();
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      switch (name) {
        case 'shoot':
          this.tone({ freq: 240, endFreq: 70, duration: 0.09, type: 'square', volume: 0.035 });
          this.noise({ duration: 0.055, volume: 0.02, frequency: 1800, type: 'highpass' });
          break;
        case 'enemyShoot':
          this.tone({ freq: 150, endFreq: 55, duration: 0.1, type: 'sawtooth', volume: 0.018 });
          break;
        case 'spawn':
          this.tone({ freq: 160, endFreq: 360, duration: 0.16, type: 'sine', volume: 0.02 });
          this.tone({ freq: 240, endFreq: 480, duration: 0.12, type: 'triangle', volume: 0.014, delay: 0.09 });
          break;
        case 'brick':
          this.noise({ duration: 0.13, volume: 0.06, frequency: 1000, type: 'bandpass', q: 0.9 });
          this.tone({ freq: 105, endFreq: 55, duration: 0.1, type: 'square', volume: 0.022 });
          break;
        case 'steel':
          this.tone({ freq: 880, endFreq: 360, duration: 0.09, type: 'triangle', volume: 0.03 });
          this.tone({ freq: 1240, endFreq: 600, duration: 0.07, type: 'sine', volume: 0.018, delay: 0.01 });
          break;
        case 'explode':
          this.noise({ duration: 0.36, volume: 0.11, frequency: 720, type: 'lowpass' });
          this.tone({ freq: 96, endFreq: 32, duration: 0.32, type: 'sawtooth', volume: 0.045 });
          break;
        case 'explodeBig':
          this.noise({ duration: 0.7, volume: 0.16, frequency: 540, type: 'lowpass' });
          this.tone({ freq: 82, endFreq: 24, duration: 0.58, type: 'sawtooth', volume: 0.07 });
          this.tone({ freq: 55, endFreq: 20, duration: 0.7, type: 'square', volume: 0.035, delay: 0.07 });
          break;
        case 'powerup':
          [523, 659, 784, 1046].forEach((freq, index) => {
            this.tone({ freq, duration: 0.13, type: 'square', volume: 0.026, delay: index * 0.07 });
          });
          break;
        case 'shield':
          this.tone({ freq: 440, endFreq: 980, duration: 0.18, type: 'sine', volume: 0.03 });
          break;
        case 'life':
          [392, 523, 659, 784, 1046].forEach((freq, index) => {
            this.tone({ freq, duration: 0.18, type: 'triangle', volume: 0.035, delay: index * 0.09 });
          });
          break;
        case 'freeze':
          [1046, 880, 698, 523].forEach((freq, index) => {
            this.tone({ freq, duration: 0.22, type: 'sine', volume: 0.03, delay: index * 0.06 });
          });
          break;
        case 'steelWall':
          [220, 330, 440].forEach((freq, index) => {
            this.tone({ freq, duration: 0.14, type: 'square', volume: 0.025, delay: index * 0.055 });
          });
          break;
        case 'stage':
          [262, 330, 392, 523].forEach((freq, index) => {
            this.tone({ freq, duration: 0.2, type: 'square', volume: 0.03, delay: index * 0.12 });
          });
          break;
        case 'stageClear':
          [523, 659, 784, 1046, 1319].forEach((freq, index) => {
            this.tone({ freq, duration: 0.3, type: 'square', volume: 0.035, delay: index * 0.12 });
          });
          break;
        case 'gameover':
          [220, 196, 165, 110].forEach((freq, index) => {
            this.tone({ freq, endFreq: freq * 0.8, duration: 0.36, type: 'sawtooth', volume: 0.04, delay: index * 0.19 });
          });
          break;
        case 'victory':
          [392, 523, 659, 784, 1046, 1319].forEach((freq, index) => {
            this.tone({ freq, duration: 0.26, type: 'triangle', volume: 0.045, delay: index * 0.13 });
            this.tone({ freq: freq * 2, duration: 0.18, type: 'sine', volume: 0.016, delay: index * 0.13 + 0.04 });
          });
          break;
        case 'ui':
          this.tone({ freq: 620, endFreq: 880, duration: 0.07, type: 'square', volume: 0.022 });
          break;
        case 'deny':
          this.tone({ freq: 140, endFreq: 110, duration: 0.09, type: 'square', volume: 0.02 });
          break;
        default:
          break;
      }
    }
  }

  window.TankAudio = AudioEngine;
})();
