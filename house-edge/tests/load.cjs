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
  'js/core/pool.js',
  'js/data/content.js',
  'js/systems/slots.js',
  'js/systems/economy.js',
  'js/systems/facilities.js',
  'js/systems/save.js',
  'js/systems/catalog.js',
  'js/game/fx.js',
  'js/game/perks.js',
  'js/game/spins.js',
  'js/game/enemies.js',
  'js/game/boss.js',
  'js/game/director.js',
  'js/game/run.js',
  'js/game/game.js',
  'js/game/debug.js',
];

function loadHE() {
  const context = { console, Math, Date, JSON };
  context.globalThis = context;
  vm.createContext(context);
  for (const rel of LOGIC_FILES) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, context, { filename: rel });
  }
  return context.HE;
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

module.exports = { loadHE, MemoryStorage, LOGIC_FILES };
