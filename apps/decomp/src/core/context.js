// Wires the shared services together (used by the app and by the command-line runner).
'use strict';
const { Engines } = require('./engines');
const { Pool } = require('./pool');
const { Scheduler } = require('./scheduler');
const power = require('./power');

function createContext({ enginesDir, mode = 'max', useSystem = true } = {}) {
  const ctx = { mode };
  ctx.budget = () => power.budget(ctx.mode);
  ctx.engines = new Engines(enginesDir, { useSystem });
  ctx.pool = new Pool(ctx.budget().workers);
  ctx.scheduler = new Scheduler(ctx.budget);
  ctx.setMode = (m) => { ctx.mode = power.MODES[m] ? m : 'max'; ctx.pool.resize(ctx.budget().workers); ctx.scheduler.refresh(); };
  ctx.close = () => ctx.pool.close();
  return ctx;
}
module.exports = { createContext };
