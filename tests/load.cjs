/*
 * Loads the game's classic scripts into a fresh VM context for Node tests.
 * Only DOM-free layers are loaded (core, data, systems, game).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const LOGIC_FILES = [
  'js/core/namespace.js',
  'js/core/numbers.js',
  'js/core/pool.js',
  'js/data/range.js',
  'js/data/targets.js',
  'js/data/weapons.js',
  'js/data/upgrades.js',
  'js/data/waves.js',
  'js/systems/perks.js',
  'js/systems/content.js',
  'js/systems/save.js',
  'js/systems/economy.js',
  'js/systems/progression.js',
  'js/systems/combo.js',
  'js/game/camera.js',
  'js/game/targets.js',
  'js/game/weapons.js',
  'js/game/ballistics.js',
  'js/game/director.js',
  'js/game/game.js',
];

function loadZTA() {
  const context = { console, Math, Date, JSON };
  context.globalThis = context;
  vm.createContext(context);
  for (const rel of LOGIC_FILES) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
  }
  return context.ZTA;
}

/** In-memory Storage with the same surface as window.localStorage. */
class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failWrites = false;
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

module.exports = { loadZTA, MemoryStorage, LOGIC_FILES };
