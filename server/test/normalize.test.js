// ─── Unit tests for normalize.js ────────────────────────────────────────────
// Run with:  node --test server/test/normalize.test.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRawText, exactDedupHash, normalizeForMatching } = require('../services/normalize');

test('normalizeRawText: identical inputs produce identical output', () => {
  const a = 'Studio à louer à Ouakam\nPrix 155mil /3';
  const b = 'Studio à louer à Ouakam\nPrix 155mil /3';
  assert.equal(normalizeRawText(a), normalizeRawText(b));
});

test('normalizeRawText: whitespace-only variants collapse', () => {
  const a = 'Studio à louer à Ouakam';
  const b = '  Studio   à   louer  à  Ouakam  ';
  assert.equal(normalizeRawText(a), normalizeRawText(b));
});

test('normalizeRawText: CR / CRLF line endings normalize', () => {
  const lf = 'Line1\nLine2';
  const crlf = 'Line1\r\nLine2';
  const cr = 'Line1\rLine2';
  assert.equal(normalizeRawText(lf), normalizeRawText(crlf));
  assert.equal(normalizeRawText(lf), normalizeRawText(cr));
});

test('normalizeRawText: keeps accents, case, punctuation intact', () => {
  const s = 'À louer — 155MIL/3 !!';
  const n = normalizeRawText(s);
  assert.match(n, /À/);
  assert.match(n, /—/);
  assert.match(n, /MIL/);
  assert.match(n, /!!/);
});

test('normalizeRawText: distinct texts stay distinct', () => {
  const a = 'Studio à louer à Ouakam';
  const b = 'Studio à louer à Plateau';
  assert.notEqual(normalizeRawText(a), normalizeRawText(b));
});

test('normalizeRawText: NFD vs NFC unicode variants produce same output', () => {
  const nfc = '\u00E9'; // é
  const nfd = 'e\u0301'; // e + combining acute
  assert.equal(normalizeRawText(nfc), normalizeRawText(nfd));
});

test('exactDedupHash: returns 40-char sha1', () => {
  const h = exactDedupHash('hello');
  assert.equal(h.length, 40);
  assert.match(h, /^[0-9a-f]{40}$/);
});

test('exactDedupHash: duplicate texts share a hash', () => {
  assert.equal(
    exactDedupHash('Studio à louer à Ouakam'),
    exactDedupHash('  Studio   à   louer  à  Ouakam  ')
  );
});

test('exactDedupHash: different texts get different hashes', () => {
  assert.notEqual(
    exactDedupHash('Studio à louer'),
    exactDedupHash('Studio à vendre')
  );
});

test('normalizeForMatching: lowercases and strips diacritics', () => {
  assert.equal(normalizeForMatching('À LOUER Médina'), 'a louer medina');
});

test('normalizeForMatching: smart quotes normalize to apostrophe', () => {
  assert.equal(normalizeForMatching("patte d’oie"), "patte d'oie");
});

test('normalizeForMatching: œ / Œ expand to oe', () => {
  assert.match(normalizeForMatching('Sacré-Cœur'), /coeur/);
});
