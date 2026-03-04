/**
 * Verification test for PDF field extraction and notification body generation.
 *
 * Validates that:
 *   - entrada1.pdf → body matches DEBUGFILES/salida_1
 *   - entrada2.pdf → body matches DEBUGFILES/salida1
 *   - EML files are generated with correct structure and PDF attachment
 *
 * Usage:  node test/verify_extraction.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Load the browser-targeted JS modules into Node by evaluating them.
// They use IIFE patterns that assign to `const` globals.
// ---------------------------------------------------------------------------

const fieldExtractorCode = readFileSync(join(ROOT, 'js/fieldExtractor.js'), 'utf-8');
const generatorCode = readFileSync(join(ROOT, 'eml/generator.js'), 'utf-8');

const FieldExtractor = new Function(fieldExtractorCode + '\nreturn FieldExtractor;')();
const EmlGenerator = new Function('FieldExtractor', generatorCode + '\nreturn EmlGenerator;')(FieldExtractor);

// ---------------------------------------------------------------------------
// Extract text from PDF using pdfjs-dist (npm)
// ---------------------------------------------------------------------------

const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

async function extractTextFromPdf(pdfPath) {
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    let pageText = '';
    for (const item of textContent.items) {
      if (typeof item.str === 'string') {
        pageText += item.str;
        if (item.hasEOL) pageText += '\n';
        else if (item.str && !item.str.endsWith(' ')) pageText += ' ';
      }
    }
    pageTexts.push(pageText);
  }

  return FieldExtractor.normalizeText(pageTexts.join('\n'));
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const tests = [
  {
    name: 'entrada1.pdf → salida_1',
    pdfPath: join(ROOT, 'DEBUGFILES/entrada1.pdf'),
    expectedPath: join(ROOT, 'DEBUGFILES/salida_1'),
    notifMeta: {},
  },
  {
    name: 'entrada2.pdf → salida1',
    pdfPath: join(ROOT, 'DEBUGFILES/entrada2.pdf'),
    expectedPath: join(ROOT, 'DEBUGFILES/salida1'),
    notifMeta: {
      idNotificacion: 'N274961262 ',
      referenceNumber: '3802Z1726015111051',
    },
  },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${t.name}`);
  console.log('='.repeat(60));

  const fullText = await extractTextFromPdf(t.pdfPath);

  const notifFields = FieldExtractor.extractNotificationFields(fullText, t.notifMeta);
  console.log('\n--- Extracted notification fields ---');
  console.log(JSON.stringify(notifFields, null, 2));

  const body = EmlGenerator.buildNotificationBody(notifFields);
  const expected = readFileSync(t.expectedPath, 'utf-8');

  // Compare line by line
  const bodyLines = body.split('\n');
  const expectedLines = expected.split('\n');
  let testPassed = true;

  if (bodyLines.length !== expectedLines.length) {
    console.log(`\n❌ Line count mismatch: got ${bodyLines.length}, expected ${expectedLines.length}`);
    testPassed = false;
  }

  const maxLines = Math.max(bodyLines.length, expectedLines.length);
  for (let i = 0; i < maxLines; i++) {
    const got = bodyLines[i] || '';
    const exp = expectedLines[i] || '';
    if (got !== exp) {
      console.log(`\n❌ Line ${i + 1} mismatch:`);
      console.log(`  GOT:      |${got}|  (${got.length} chars)`);
      console.log(`  EXPECTED: |${exp}|  (${exp.length} chars)`);
      testPassed = false;
    }
  }

  if (testPassed) {
    console.log('✅ Body PASSED');
    passed++;
  } else {
    console.log('❌ Body FAILED');
    failed++;
  }
}

// ---------------------------------------------------------------------------
// EML generation tests
// ---------------------------------------------------------------------------

console.log(`\n${'='.repeat(60)}`);
console.log('TEST: EML generation (estructura1.pdf)');
console.log('='.repeat(60));

{
  const pdfPath = join(ROOT, 'DEBUGFILES/entrada1.pdf');
  const pdfBytes = readFileSync(pdfPath);
  const fullText = await extractTextFromPdf(pdfPath);

  const scanResult = {
    file: { name: 'entrada1.pdf' },
    extraction: { fullText },
  };

  const eml = EmlGenerator.generateEml({
    scanResult,
    pdfFileBytes: pdfBytes.buffer,
    pdfFileName: 'entrada1.pdf',
  });

  let emlOk = true;
  if (!eml.includes('MIME-Version: 1.0')) { console.log('❌ Missing MIME-Version header'); emlOk = false; }
  if (!eml.includes('Subject:')) { console.log('❌ Missing Subject header'); emlOk = false; }
  if (!eml.includes('Content-Type: multipart/mixed')) { console.log('❌ Missing multipart content type'); emlOk = false; }
  if (!eml.includes('Content-Type: text/plain')) { console.log('❌ Missing text/plain body part'); emlOk = false; }
  if (!eml.includes('Content-Type: application/pdf')) { console.log('❌ Missing PDF attachment'); emlOk = false; }
  if (!eml.includes('Content-Disposition: attachment; filename="entrada1.pdf"')) { console.log('❌ Missing attachment filename'); emlOk = false; }
  if (!eml.includes('Content-Transfer-Encoding: base64')) { console.log('❌ Missing base64 encoding'); emlOk = false; }
  if (!eml.includes('Nombre')) { console.log('❌ Missing Nombre in body'); emlOk = false; }

  if (emlOk) {
    console.log('✅ EML structure PASSED');
    passed++;
  } else {
    console.log('❌ EML structure FAILED');
    failed++;
  }

  // Write EML to /tmp for inspection
  writeFileSync(join(tmpdir(), 'test_entrada1.eml'), eml);
  console.log('  → Wrote ' + join(tmpdir(), 'test_entrada1.eml') + ' for inspection');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Final results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
