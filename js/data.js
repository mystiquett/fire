/* 坦克大战 · 数据与常量 */
(function () {
  'use strict';

  const TILE = 48;
  const COLS = 13;
  const ROWS = 13;
  const FIELD_W = COLS * TILE;
  const FIELD_H = ROWS * TILE;
  const FIELD_X = 48;
  const FIELD_Y = 48;
  const CANVAS_W = 720;
  const CANVAS_H = 720;

  const T = Object.freeze({
    EMPTY: 0,
    BRICK: 1,
    STEEL: 2,
    TREE: 3,
    WATER: 4,
    ICE: 5,
    BASE: 6
  });

  const CHAR_TO_TILE = Object.freeze({
    '.': T.EMPTY,
    'B': T.BRICK,
    'S': T.STEEL,
    'T': T.TREE,
    'W': T.WATER,
    'I': T.ICE,
    'E': T.BASE
  });

  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1, angle: 0, opposite: 'down' }),
    right: Object.freeze({ x: 1, y: 0, angle: Math.PI / 2, opposite: 'left' }),
    down: Object.freeze({ x: 0, y: 1, angle: Math.PI, opposite: 'up' }),
    left: Object.freeze({ x: -1, y: 0, angle: -Math.PI / 2, opposite: 'right' })
  });
  const DIR_KEYS = ['up', 'right', 'down', 'left'];

  const PLAYER_SPAWN = { x: 4, y: 12 };
  const PLAYER_ALT_SPAWN = { x: 8, y: 12 };
  const ENEMY_SPAWNS = Object.freeze([
    Object.freeze({ x: 0, y: 0 }),
    Object.freeze({ x: 6, y: 0 }),
    Object.freeze({ x: 12, y: 0 })
  ]);
  const BASE_CELL = Object.freeze({ x: 6, y: 12 });
  const BASE_WALL_CELLS = Object.freeze([
    Object.freeze({ x: 5, y: 10 }),
    Object.freeze({ x: 6, y: 10 }),
    Object.freeze({ x: 7, y: 10 }),
    Object.freeze({ x: 5, y: 11 }),
    Object.freeze({ x: 6, y: 11 }),
    Object.freeze({ x: 7, y: 11 }),
    Object.freeze({ x: 5, y: 12 }),
    Object.freeze({ x: 7, y: 12 })
  ]);

  // 每张地图均为 13 × 13；E 为基地，四周砖墙由游戏逻辑统一校验。
  const LEVELS = Object.freeze([
    Object.freeze({
      name: '绿野前哨',
      nameEn: 'GREEN OUTPOST',
      accent: '#7ee2a1',
      ground: '#131b1c',
      grid: '#192426',
      map: Object.freeze([
        '.............',
        '..BB.....BB..',
        '..BB.....BB..',
        '.....SSS.....',
        '.BB.......BB.',
        '.BB...T...BB.',
        '......T......',
        '.BB...T...BB.',
        '.BB.......BB.',
        '.....SSS.....',
        '..BB.BBB.BB..',
        '.....BBB.....',
        '.....BEB.....'
      ])
    }),
    Object.freeze({
      name: '断桥水域',
      nameEn: 'BROKEN CAUSEWAY',
      accent: '#6cd9ee',
      ground: '#111b20',
      grid: '#17262c',
      map: Object.freeze([
        '.............',
        '.SS.......SS.',
        '.SB.......BS.',
        '...BB...BB...',
        '...B.....B...',
        '.BBBW.T.WBBB.',
        '....W.T.W....',
        '.BBBW.T.WBBB.',
        '...B.....B...',
        '...BB...BB...',
        '.SB..BBB..BS.',
        '.SS..BBB..SS.',
        '.....BEB.....'
      ])
    }),
    Object.freeze({
      name: '暗林迷阵',
      nameEn: 'BLACKWOOD MAZE',
      accent: '#a9d977',
      ground: '#151b12',
      grid: '#1d2618',
      map: Object.freeze([
        '.............',
        '...T.....T...',
        '.B.T.BBB.T.B.',
        '.B...B.B...B.',
        '.BBB.B.B.BBB.',
        '...T...T.....',
        '.T...TTT...T.',
        '...T...T.....',
        '.BBB.B.B.BBB.',
        '.B...B.B...B.',
        '.B.T.BBB.T.B.',
        '...T.BBB.T...',
        '.....BEB.....'
      ])
    }),
    Object.freeze({
      name: '钢铁堡垒',
      nameEn: 'IRON CITADEL',
      accent: '#e7b56e',
      ground: '#1b1813',
      grid: '#282219',
      map: Object.freeze([
        '.............',
        '.BBBB...BBBB.',
        '.B..B...B..B.',
        '.B..BBBBB..B.',
        '.B.........B.',
        '.BBBB.S.BBBB.',
        '......S......',
        '.BBBB.S.BBBB.',
        '.B.........B.',
        '.B..BBBBB..B.',
        '.B..B...B..B.',
        '.BBB.BBB.BBB.',
        '.....BEB.....'
      ])
    }),
    Object.freeze({
      name: '极寒禁区',
      nameEn: 'FROZEN FRONTIER',
      accent: '#a8bdff',
      ground: '#141923',
      grid: '#1c2431',
      map: Object.freeze([
        '.............',
        '..SBB...BBS..',
        '..S.......S..',
        '.II.BBBBB.II.',
        '.II.......II.',
        '..B..III..B..',
        '.B...III...B.',
        '..B..III..B..',
        '.II.......II.',
        '.II.BBBBB.II.',
        '..S..BBB..S..',
        '..S..BBB..S..',
        '.....BEB.....'
      ])
    })
  ]);

  const DIFFICULTIES = Object.freeze({
    recruit: Object.freeze({
      key: 'recruit',
      label: '新兵',
      tag: 'RECRUIT',
      description: '5 条生命 · 敌军火力较弱',
      lives: 5,
      countDelta: -2,
      maxActive: 3,
      fireScale: 1.4,
      speedScale: 0.9,
      scoreScale: 0.8
    }),
    classic: Object.freeze({
      key: 'classic',
      label: '经典',
      tag: 'CLASSIC',
      description: '3 条生命 · 原汁原味的战场',
      lives: 3,
      countDelta: 0,
      maxActive: 4,
      fireScale: 1,
      speedScale: 1,
      scoreScale: 1
    }),
    veteran: Object.freeze({
      key: 'veteran',
      label: '老兵',
      tag: 'VETERAN',
      description: '2 条生命 · 敌人更快更凶',
      lives: 2,
      countDelta: 2,
      maxActive: 5,
      fireScale: 0.78,
      speedScale: 1.12,
      scoreScale: 1.35
    })
  });

  const LEVEL_COUNTS = Object.freeze([12, 14, 16, 18, 20]);

  const ENEMY_TYPES = Object.freeze({
    basic: Object.freeze({
      key: 'basic',
      label: '轻型',
      speed: 44,
      hp: 1,
      bulletSpeed: 286,
      fireMin: 1.6,
      fireMax: 2.7,
      score: 100,
      color: '#b9bda8',
      dark: '#666b5b',
      light: '#eef0d7'
    }),
    fast: Object.freeze({
      key: 'fast',
      label: '高速',
      speed: 82,
      hp: 1,
      bulletSpeed: 336,
      fireMin: 1.45,
      fireMax: 2.35,
      score: 200,
      color: '#d7a33e',
      dark: '#7c5b1f',
      light: '#ffe59b'
    }),
    power: Object.freeze({
      key: 'power',
      label: '炮击',
      speed: 51,
      hp: 1,
      bulletSpeed: 452,
      fireMin: 0.8,
      fireMax: 1.55,
      score: 300,
      color: '#d65c4c',
      dark: '#7b2e28',
      light: '#ffb2a2'
    }),
    armor: Object.freeze({
      key: 'armor',
      label: '重甲',
      speed: 37,
      hp: 4,
      bulletSpeed: 316,
      fireMin: 1.25,
      fireMax: 2.1,
      score: 400,
      color: '#9788d3',
      dark: '#4d447d',
      light: '#d8d0ff'
    })
  });

  const LEVEL_WEIGHTS = Object.freeze([
    Object.freeze({ basic: 0.78, fast: 0.2, power: 0.02, armor: 0 }),
    Object.freeze({ basic: 0.58, fast: 0.25, power: 0.14, armor: 0.03 }),
    Object.freeze({ basic: 0.46, fast: 0.27, power: 0.2, armor: 0.07 }),
    Object.freeze({ basic: 0.36, fast: 0.28, power: 0.24, armor: 0.12 }),
    Object.freeze({ basic: 0.28, fast: 0.3, power: 0.27, armor: 0.15 })
  ]);

  const POWERUPS = Object.freeze({
    star: Object.freeze({ id: 'star', name: '火力升级', short: '火力', symbol: '★', color: '#f6c84a', score: 300 }),
    shield: Object.freeze({ id: 'shield', name: '能量护盾', short: '护盾', symbol: '◈', color: '#66d9ff', score: 300 }),
    life: Object.freeze({ id: 'life', name: '额外生命', short: '生命', symbol: '♥', color: '#7ce29a', score: 300 }),
    bomb: Object.freeze({ id: 'bomb', name: '全屏轰炸', short: '轰炸', symbol: '✹', color: '#ff7152', score: 300 }),
    clock: Object.freeze({ id: 'clock', name: '时间冻结', short: '冻结', symbol: '❄', color: '#9adfff', score: 300 }),
    shovel: Object.freeze({ id: 'shovel', name: '基地钢化', short: '钢化', symbol: '⬢', color: '#e2b169', score: 300 })
  });

  const POWERUP_WEIGHTS = Object.freeze([
    ['star', 26],
    ['shield', 20],
    ['clock', 17],
    ['shovel', 15],
    ['bomb', 12],
    ['life', 10]
  ]);

  const PLAYER_POWER = Object.freeze([
    Object.freeze({ maxBullets: 1, cooldown: 0.4, bulletSpeed: 396, steelBreak: false, twin: false, label: '标准炮' }),
    Object.freeze({ maxBullets: 2, cooldown: 0.33, bulletSpeed: 424, steelBreak: false, twin: false, label: '速射炮' }),
    Object.freeze({ maxBullets: 2, cooldown: 0.3, bulletSpeed: 452, steelBreak: true, twin: false, label: '穿甲炮' }),
    Object.freeze({ maxBullets: 4, cooldown: 0.27, bulletSpeed: 482, steelBreak: true, twin: true, label: '双联炮' })
  ]);

  window.TB = {
    TILE,
    COLS,
    ROWS,
    FIELD_W,
    FIELD_H,
    FIELD_X,
    FIELD_Y,
    CANVAS_W,
    CANVAS_H,
    T,
    CHAR_TO_TILE,
    DIRECTIONS,
    DIR_KEYS,
    PLAYER_SPAWN,
    PLAYER_ALT_SPAWN,
    ENEMY_SPAWNS,
    BASE_CELL,
    BASE_WALL_CELLS,
    LEVELS,
    DIFFICULTIES,
    LEVEL_COUNTS,
    ENEMY_TYPES,
    LEVEL_WEIGHTS,
    POWERUPS,
    POWERUP_WEIGHTS,
    PLAYER_POWER
  };
})();
