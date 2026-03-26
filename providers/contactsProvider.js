/**
 * ContactsProvider — Variant A contacts lookup from a locally uploaded CSV.
 *
 * SECURITY / PRIVACY:
 *   - Contacts are held ONLY in memory (no LocalStorage, IndexedDB, Cache API).
 *   - No network requests are made.
 *   - CSV content is never logged; only aggregate counts are logged.
 *   - On page refresh all data is lost.
 *
 * CSV format:
 *   - Delimiter: semicolon (;)
 *   - Quote character: double-quote (")
 *   - Header row expected: at least two columns (name, email cell)
 *   - Email cell may contain multiple emails separated by ; / , — first valid wins.
 *
 * Name matching:
 *   1) Exact match on fully normalized string (fast path).
 *   2) Token-based fuzzy match tolerating word-order differences and Spanish
 *      particles (DE, DEL, LA, LAS, LOS, Y, E).  Score = overlapping meaningful
 *      tokens / max(tokensA, tokensB).  Threshold >= 0.66 (covers 2-of-3 tokens).
 *   3) Tie-breaker: most overlapping tokens, then first CSV occurrence.
 *      If multiple contacts tie with the exact same best score, the first
 *      occurrence in the CSV wins (deterministic).
 */
const ContactsProvider = (() => {
  'use strict';

  // ── In-memory store ──────────────────────────────────────────────────────
  /** @type {Map<string, {email: string, tokens: string[]}>} normalized-name → contact */
  let _exactMap = new Map();
  /** @type {Array<{normalizedName: string, tokens: string[], email: string}>} */
  let _contacts = [];

  const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y', 'E']);

  // ── Email helpers ────────────────────────────────────────────────────────

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  /**
   * Clean up an email cell string and return the first valid email address.
   * @param {string} cell
   * @returns {string|null}
   */
  function firstValidEmail(cell) {
    if (!cell) return null;
    // Remove spaces around @ and .
    let cleaned = cell.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*/g, '.');
    // Normalize delimiters: / and , become ;
    cleaned = cleaned.replace(/[/,]/g, ';');
    const candidates = cleaned.split(';').map(s => s.trim()).filter(Boolean);
    for (const c of candidates) {
      if (EMAIL_RE.test(c)) return c.toLowerCase();
    }
    return null;
  }

  // ── Name normalization ───────────────────────────────────────────────────

  /**
   * Normalize a name string for matching:
   *  - uppercase
   *  - remove diacritics (NFD + strip combining marks)
   *  - replace non-alphanumeric sequences with single space
   *  - trim
   * @param {string} name
   * @returns {string}
   */
  function normalizeName(name) {
    if (!name) return '';
    return name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // strip combining diacritical marks
      .replace(/[^A-Z0-9]+/g, ' ')       // collapse non-alnum to space
      .trim()
      .replace(/\s{2,}/g, ' ');           // collapse multiple spaces
  }

  /**
   * Split a normalized name into meaningful tokens (excluding particles).
   * @param {string} normalized  Already normalized string
   * @returns {string[]}
   */
  function meaningfulTokens(normalized) {
    if (!normalized) return [];
    return normalized.split(' ').filter(t => t && !PARTICLES.has(t));
  }

  // ── CSV parser (handles quoted fields with semicolons) ───────────────────

  /**
   * Parse a CSV line respecting quotes.  Delimiter is `;`, quote is `"`.
   * Handles `""` as escaped quote inside quoted fields.
   * @param {string} line
   * @returns {string[]} array of field values
   */
  function parseCsvLine(line) {
    const fields = [];
    let i = 0;
    const len = line.length;

    while (i <= len) {
      if (i === len) {
        fields.push('');
        break;
      }

      if (line[i] === '"') {
        // Quoted field
        let value = '';
        i++; // skip opening quote
        while (i < len) {
          if (line[i] === '"') {
            if (i + 1 < len && line[i + 1] === '"') {
              // escaped quote
              value += '"';
              i += 2;
            } else {
              // closing quote
              i++; // skip closing quote
              break;
            }
          } else {
            value += line[i];
            i++;
          }
        }
        fields.push(value);
        // skip delimiter after quoted field
        if (i < len && line[i] === ';') i++;
      } else {
        // Unquoted field
        const next = line.indexOf(';', i);
        if (next === -1) {
          fields.push(line.slice(i));
          break;
        } else {
          fields.push(line.slice(i, next));
          i = next + 1;
        }
      }
    }
    return fields;
  }

  /**
   * Split raw CSV text into lines, handling CRLF and LF.
   * @param {string} text
   * @returns {string[]}
   */
  function splitLines(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Load a CSV File into the in-memory contacts store.
   * Replaces any previously loaded contacts.
   * @param {File} file
   * @returns {Promise<number>} number of contacts loaded
   */
  async function loadCsv(file) {
    const text = await file.text();
    const lines = splitLines(text);

    _exactMap = new Map();
    _contacts = [];

    // Skip header row (first non-empty line)
    let started = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (!started) {
        started = true; // skip header
        continue;
      }

      const fields = parseCsvLine(line);
      if (fields.length < 2) continue; // need at least name + email cell

      const rawName = fields[0].trim();
      const emailCell = fields[1]; // may be quoted, already unquoted by parser
      if (!rawName) continue;

      const email = firstValidEmail(emailCell);
      if (!email) continue;

      const normalized = normalizeName(rawName);
      if (!normalized) continue;

      const tokens = meaningfulTokens(normalized);

      // First occurrence wins for duplicates
      if (!_exactMap.has(normalized)) {
        _exactMap.set(normalized, { email, tokens });
      }

      _contacts.push({ normalizedName: normalized, tokens, email });
    }

    // Log count only — never log content
    console.log('ContactsProvider: loaded ' + _exactMap.size + ' unique contacts');
    return _exactMap.size;
  }

  /**
   * Find the first valid email for a person/company name.
   *
   * Matching strategy:
   *   1) Exact normalized string match (fast path).
   *   2) Token-based match with score >= 0.67.
   *      Tie-breaker: most overlapping tokens → first CSV occurrence.
   *
   * @param {string} name
   * @returns {string|null} email or null
   */
  function findFirstEmailByName(name) {
    if (!name) return null;
    const normalized = normalizeName(name);
    if (!normalized) return null;

    // 1) Exact match
    const exact = _exactMap.get(normalized);
    if (exact) return exact.email;

    // 2) Token-based match
    const queryTokens = meaningfulTokens(normalized);
    if (queryTokens.length === 0) return null;

    const THRESHOLD = 0.66;
    let bestScore = 0;
    let bestOverlap = 0;
    let bestEntry = null;

    // Deduplicated iteration via _exactMap (first occurrence per normalized name)
    for (const [, entry] of _exactMap) {
      const contactTokens = entry.tokens;
      if (contactTokens.length === 0) continue;

      // Count overlapping tokens
      const contactSet = new Set(contactTokens);
      let overlap = 0;
      for (const qt of queryTokens) {
        if (contactSet.has(qt)) overlap++;
      }

      const score = overlap / Math.max(queryTokens.length, contactTokens.length);

      if (score < THRESHOLD) continue;

      // Better score wins; on tie: more overlaps wins; on double-tie: first in CSV wins
      if (
        score > bestScore ||
        (score === bestScore && overlap > bestOverlap)
      ) {
        bestScore = score;
        bestOverlap = overlap;
        bestEntry = entry;
      }
      // If exact same score AND overlap, first occurrence (already stored) wins — no update
    }

    return bestEntry ? bestEntry.email : null;
  }

  /**
   * Return the number of loaded contacts.
   * @returns {number}
   */
  function count() {
    return _exactMap.size;
  }

  /**
   * Clear all loaded contacts from memory.
   */
  function clear() {
    _exactMap = new Map();
    _contacts = [];
  }

  // Expose internals for testing (Node.js)
  const _internals = { parseCsvLine, normalizeName, meaningfulTokens, firstValidEmail, splitLines };

  return { loadCsv, findFirstEmailByName, count, clear, _internals };
})();

// CommonJS export for Node.js testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ContactsProvider;
}
