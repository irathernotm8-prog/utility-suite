const demo = require('./demo');
const meta = require('./meta');
const ga4 = require('./ga4');
const googleAds = require('./google-ads');
const youtube = require('./youtube');
const salesforce = require('./salesforce');

// Still to come, listed so the Sources screen shows the roadmap honestly.
const planned = [
  { kind: 'sfmc', name: 'Salesforce Marketing Cloud', status: 'planned', note: 'Email sends, opens and clicks (a separate API from Salesforce reports).' }
];

const ready = { demo, meta, 'google-ads': googleAds, ga4, youtube, salesforce };
module.exports = { ready, planned, get: (k) => ready[k] };
