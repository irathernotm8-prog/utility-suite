// Cadence — step implementations by type.
'use strict';
module.exports = {
  ...require('./files'),
  ...require('./web'),
  ...require('./data'),
  ...require('./docs'),
  ...require('./logic'),
  'web.browser': async (w, x) => {
    if (!x.services.browser) throw new Error('The browser isn’t available here');
    return x.services.browser.run(w, x);
  },
};
for (const k of Object.keys(module.exports)) if (k === '_') delete module.exports[k];
