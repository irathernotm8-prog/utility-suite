'use strict';
// This device's identity: a random id and its encryption keys, made once and kept in the app-data folder.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const C = require('./crypto');

function loadIdentity(dir) {
  const file = path.join(dir, 'identity.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j.id && j.priv && C.validPub(j.pub)) return j;
  } catch {}
  const keys = C.newKeys();
  const j = { id: crypto.randomUUID(), ...keys, created: Date.now() };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(j), { mode: 0o600 });
  return j;
}

module.exports = { loadIdentity };
