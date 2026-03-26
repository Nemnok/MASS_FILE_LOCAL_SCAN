/**
 * Tests for providers/contactsProvider.js
 *
 * Run: node test/test_contacts.js
 */

// Load the module (IIFE with CommonJS export)
const ContactsProvider = require('../providers/contactsProvider.js');
const { parseCsvLine, normalizeName, meaningfulTokens, firstValidEmail, splitLines } = ContactsProvider._internals;

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ✅ ' + msg);
    passed++;
  } else {
    console.log('  ❌ ' + msg);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual === expected) {
    console.log('  ✅ ' + msg);
    passed++;
  } else {
    console.log('  ❌ ' + msg + ' — expected: ' + JSON.stringify(expected) + ', got: ' + JSON.stringify(actual));
    failed++;
  }
}

function assertDeepEq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    console.log('  ✅ ' + msg);
    passed++;
  } else {
    console.log('  ❌ ' + msg + ' — expected: ' + b + ', got: ' + a);
    failed++;
  }
}

// ── CSV line parser ────────────────────────────────────────────────────────

console.log('\n── parseCsvLine ──');

assertDeepEq(parseCsvLine('a;b;c'), ['a', 'b', 'c'], 'simple fields');
assertDeepEq(parseCsvLine('"hello";world'), ['hello', 'world'], 'quoted first field');
assertDeepEq(parseCsvLine('"a;b";c'), ['a;b', 'c'], 'semicolon inside quotes');
assertDeepEq(parseCsvLine('"a""b";c'), ['a"b', 'c'], 'escaped quote inside quotes');
assertDeepEq(parseCsvLine(''), [''], 'empty line');
assertDeepEq(parseCsvLine('a'), ['a'], 'single field');
assertDeepEq(parseCsvLine('"a@b.com; c@d.com";other'), ['a@b.com; c@d.com', 'other'], 'quoted emails with semicolons');

// ── Name normalization ─────────────────────────────────────────────────────

console.log('\n── normalizeName ──');

assertEq(normalizeName('José García López'), 'JOSE GARCIA LOPEZ', 'diacritics removal');
assertEq(normalizeName('  María  de  la  Torre  '), 'MARIA DE LA TORRE', 'spaces collapsed');
assertEq(normalizeName('Ñoño Pérez'), 'NONO PEREZ', 'ñ removal');
assertEq(normalizeName(''), '', 'empty string');
assertEq(normalizeName(null), '', 'null');
assertEq(normalizeName('IVAN  KAZIMIROV---PAROVOZOV'), 'IVAN KAZIMIROV PAROVOZOV', 'non-alnum to space');

// ── meaningfulTokens ──────────────────────────────────────────────────────

console.log('\n── meaningfulTokens ──');

assertDeepEq(meaningfulTokens('MARIA DE LA TORRE'), ['MARIA', 'TORRE'], 'removes particles');
assertDeepEq(meaningfulTokens('IVAN KAZIMIROV PAROVOZOV'), ['IVAN', 'KAZIMIROV', 'PAROVOZOV'], 'no particles');
assertDeepEq(meaningfulTokens(''), [], 'empty string');

// ── firstValidEmail ────────────────────────────────────────────────────────

console.log('\n── firstValidEmail ──');

assertEq(firstValidEmail('user@example.com'), 'user@example.com', 'simple email');
assertEq(firstValidEmail('USER@EXAMPLE.COM'), 'user@example.com', 'uppercase email lowered');
assertEq(firstValidEmail('a@ example.com'), 'a@example.com', 'space around @');
assertEq(firstValidEmail('bad;good@example.com'), 'good@example.com', 'skip invalid, pick valid');
assertEq(firstValidEmail('a@b.com; c@d.com'), 'a@b.com', 'semicolon-separated, first valid');
assertEq(firstValidEmail('a@b.com / c@d.com'), 'a@b.com', 'slash-separated');
assertEq(firstValidEmail('a@b.com , c@d.com'), 'a@b.com', 'comma-separated');
assertEq(firstValidEmail(''), null, 'empty string');
assertEq(firstValidEmail(null), null, 'null');
assertEq(firstValidEmail('not-an-email'), null, 'no valid email');
assertEq(firstValidEmail('a @b. com'), 'a@b.com', 'spaces around @ and .');

// ── splitLines ────────────────────────────────────────────────────────────

console.log('\n── splitLines ──');

assertDeepEq(splitLines('a\nb\nc'), ['a', 'b', 'c'], 'LF');
assertDeepEq(splitLines('a\r\nb\r\nc'), ['a', 'b', 'c'], 'CRLF');
assertDeepEq(splitLines('a\rb\rc'), ['a', 'b', 'c'], 'CR');

// ── loadCsv + findFirstEmailByName ─────────────────────────────────────────

console.log('\n── loadCsv + findFirstEmailByName ──');

// Create a fake File-like object for Node.js
function fakeFile(content) {
  return { text: () => Promise.resolve(content) };
}

(async () => {
  // Basic loading
  const csv1 = [
    'Nombre comercial;Dom. Fiscal>E-mail',
    'GARCIA LOPEZ JOSE;jose@example.com',
    'MARTINEZ PEREZ ANA;"ana@test.com; backup@test.com"',
    'TORRES DE LA VEGA MARIA;maria@ example.com',
    'EMPTY NAME;not-a-valid-email',
    ';orphan@test.com',
    'DUPLICATE;first@example.com',
    'DUPLICATE;second@example.com',
  ].join('\n');

  const count = await ContactsProvider.loadCsv(fakeFile(csv1));
  assertEq(count, 4, 'loaded 4 unique contacts');

  // Exact match
  assertEq(ContactsProvider.findFirstEmailByName('GARCIA LOPEZ JOSE'), 'jose@example.com', 'exact match');

  // Case insensitive + diacritics
  assertEq(ContactsProvider.findFirstEmailByName('García López José'), 'jose@example.com', 'diacritics normalized match');

  // Email with space around @
  assertEq(ContactsProvider.findFirstEmailByName('Torres de la Vega María'), 'maria@example.com', 'email cleanup + particle-containing name');

  // First valid email in multi-email cell
  assertEq(ContactsProvider.findFirstEmailByName('Martinez Perez Ana'), 'ana@test.com', 'first valid email from multi-email cell');

  // Duplicate name: first occurrence wins
  assertEq(ContactsProvider.findFirstEmailByName('DUPLICATE'), 'first@example.com', 'first occurrence wins for duplicates');

  // No match
  assertEq(ContactsProvider.findFirstEmailByName('UNKNOWN PERSON'), null, 'no match returns null');

  // Null/empty
  assertEq(ContactsProvider.findFirstEmailByName(null), null, 'null name returns null');
  assertEq(ContactsProvider.findFirstEmailByName(''), null, 'empty name returns null');

  // ── Token reorder matching ──────────────────────────────────────────────

  console.log('\n── Token-based matching (reordered names) ──');

  const csv2 = [
    'Nombre;Email',
    'IVAN PAROVOZOV KAZIMIROV;ivan@example.com',
    'MARIA GONZALEZ DE LA TORRE;maria@tower.com',
    'PEDRO SANCHEZ GARCIA;pedro@gov.es',
  ].join('\n');

  await ContactsProvider.loadCsv(fakeFile(csv2));

  // Reordered tokens
  assertEq(ContactsProvider.findFirstEmailByName('KAZIMIROV IVAN'), 'ivan@example.com', 'reorder: 2 of 3 tokens match');
  assertEq(ContactsProvider.findFirstEmailByName('PAROVOZOV IVAN'), 'ivan@example.com', 'reorder: 2 of 3 tokens');
  assertEq(ContactsProvider.findFirstEmailByName('IVAN KAZIMIROV PAROVOZOV'), 'ivan@example.com', 'reorder: all 3 tokens (different order)');
  assertEq(ContactsProvider.findFirstEmailByName('PAROVOZOV IVAN KAZIMIROV'), 'ivan@example.com', 'reorder: all 3 reversed');

  // With particles
  assertEq(ContactsProvider.findFirstEmailByName('GONZALEZ TORRE MARIA'), 'maria@tower.com', 'particle-free match');

  // Not enough overlap
  assertEq(ContactsProvider.findFirstEmailByName('IVAN'), null, 'single token: below threshold');

  // ── CRLF handling ──────────────────────────────────────────────────────

  console.log('\n── CRLF handling ──');

  const csv3 = 'Header1;Header2\r\nNAME ONE;one@test.com\r\nNAME TWO;two@test.com\r\n';
  await ContactsProvider.loadCsv(fakeFile(csv3));
  assertEq(ContactsProvider.count(), 2, 'CRLF: loaded 2 contacts');
  assertEq(ContactsProvider.findFirstEmailByName('NAME ONE'), 'one@test.com', 'CRLF match');

  // ── Clear ──────────────────────────────────────────────────────────────

  console.log('\n── clear ──');
  ContactsProvider.clear();
  assertEq(ContactsProvider.count(), 0, 'clear resets count');
  assertEq(ContactsProvider.findFirstEmailByName('NAME ONE'), null, 'clear removes data');

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════');
  console.log('Passed: ' + passed + '  Failed: ' + failed);
  if (failed > 0) process.exit(1);
})();
