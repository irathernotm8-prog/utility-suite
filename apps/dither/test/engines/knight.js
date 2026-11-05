// test characters: a side-view knight and a front-view hero, 48px tall
const FX = require('/home/claude/dither/src/core/fxruntime');
function side() { const g = new FX.Canvas(40, 52, ['#000']); const O = '#1a1c2c', skin = '#e8b796', arm = '#5d6b8c', armL = '#8b9bb4', red = '#b13e53', leg = '#333c57', boot = '#5a3a24';
  // back leg hidden behind front leg; legs slightly apart
  g.fillRect(15, 34, 5, 12, leg).fillRect(15, 45, 8, 3, boot); g.fillRect(19, 34, 5, 12, leg).fillRect(19, 45, 8, 3, boot);
  g.fillRect(13, 18, 12, 17, arm).fillRect(14, 19, 4, 15, armL).fillRect(13, 31, 12, 3, red);
  g.fillRect(14, 5, 11, 12, skin).fillRect(13, 3, 13, 5, armL).fillRect(22, 9, 2, 2, O).fillRect(13, 8, 3, 9, armL);
  g.fillRect(17, 19, 4, 9, armL).fillRect(17, 28, 4, 7, arm).fillRect(17, 35, 4, 3, skin); g.outline(O); return g; }
function front() { const g = new FX.Canvas(40, 52, ['#000']); const O = '#1a1c2c', skin = '#e8b796', shirt = '#38b764', pants = '#29366f', hair = '#5a3a24', boot = '#333c57';
  g.fillRect(13, 33, 6, 13, pants).fillRect(21, 33, 6, 13, pants).fillRect(12, 45, 7, 3, boot).fillRect(21, 45, 7, 3, boot);
  g.fillRect(12, 17, 16, 17, shirt).fillRect(8, 18, 4, 13, shirt).fillRect(28, 18, 4, 13, shirt).fillRect(8, 31, 4, 4, skin).fillRect(28, 31, 4, 4, skin);
  g.fillRect(14, 4, 12, 12, skin).fillRect(13, 2, 14, 5, hair).fillRect(16, 9, 2, 2, O).fillRect(22, 9, 2, 2, O); g.outline(O); return g; }
module.exports = { side, front };
