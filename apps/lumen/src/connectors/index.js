const demo = require('./demo');
const meta = require('./meta');

// Connectors still to come are listed so the Connections screen shows the roadmap honestly.
const planned = [
  { kind: 'ga4', name: 'Google Analytics 4', status: 'planned', note: 'Sessions and conversions by campaign, to check Meta against your own tracking.' },
  { kind: 'google-ads', name: 'Google Ads', status: 'planned', note: 'Search and YouTube video campaigns.' },
  { kind: 'youtube', name: 'YouTube', status: 'planned', note: 'Channel views, watch time and subscribers.' },
  { kind: 'salesforce', name: 'Salesforce', status: 'planned', note: 'Reports, dashboards and Marketing Cloud email stats.' }
];

const ready = { demo, meta };
module.exports = { ready, planned, get: (k) => ready[k] };
