#!/usr/bin/env node
/**
 * Tests for:
 *   1. Synthetic data generator produces valid samples
 *   2. Calibrated extraction works on diverse synthetic layouts
 *   3. Calibration pipeline produces valid config
 *
 * Usage:  node test/test_calibration.js
 */

const { readFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');

// Load modules
const fieldExtractorCode = readFileSync(join(ROOT, 'js/fieldExtractor.js'), 'utf-8');
const FieldExtractor = new Function(fieldExtractorCode + '\nreturn FieldExtractor;')();
const SyntheticGenerator = require(join(ROOT, 'calibration/syntheticGenerator.js'));

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; console.log('  ✅ ' + msg); }
  else { failed++; console.log('  ❌ ' + msg); }
}

// ---------------------------------------------------------------------------
// Test 1: Synthetic generator
// ---------------------------------------------------------------------------
console.log('\n=== Test 1: Synthetic generator ===');

const corpus = SyntheticGenerator.generateCorpus(100, 42);
assert(corpus.length === 100, 'Generates 100 samples');
assert(corpus[0].text.length > 50, 'Sample text is non-trivial');
assert(corpus[0].ground.nombre, 'Ground truth has nombre');
assert(corpus[0].layout === 'header' || corpus[0].layout === 'paragraph', 'Layout is header or paragraph');

// Determinism check
const corpus2 = SyntheticGenerator.generateCorpus(10, 42);
assert(corpus[0].text === corpus2[0].text, 'Generator is deterministic (same seed → same output)');
assert(corpus[9].text === corpus2[9].text, 'Generator is deterministic (sample 10)');

// Variety check
const layouts = new Set(corpus.map(s => s.layout));
assert(layouts.has('header'), 'Corpus contains header layout');
assert(layouts.has('paragraph'), 'Corpus contains paragraph layout');

const hasNif = corpus.filter(s => s.ground.nif).length;
const hasNoNif = corpus.filter(s => !s.ground.nif).length;
assert(hasNif > 10, 'Most samples have NIF (' + hasNif + ')');
assert(hasNoNif > 0, 'Some samples have no NIF (' + hasNoNif + ')');

// ---------------------------------------------------------------------------
// Test 2: Extraction on header layout
// ---------------------------------------------------------------------------
console.log('\n=== Test 2: Extraction on header layout samples ===');

const headerSamples = corpus.filter(s => s.layout === 'header').slice(0, 20);
let headerNombreHits = 0;
let headerNifHits = 0;
let headerDocHits = 0;

for (const sample of headerSamples) {
  const headText = sample.text.slice(0, 2500);
  const result = FieldExtractor.extract(sample.text, headText);
  const notifFields = FieldExtractor.extractNotificationFields(sample.text, {});

  // Check nombre
  const extractedNombre = (notifFields.nombre || '').toUpperCase().trim();
  if (extractedNombre && sample.ground.nombre.toUpperCase().includes(extractedNombre.split(' ')[0])) {
    headerNombreHits++;
  }

  // Check NIF
  if (sample.ground.nif && result.person.taxId === sample.ground.nif.value) {
    headerNifHits++;
  } else if (!sample.ground.nif) {
    headerNifHits++;
  }

  // Check doc number
  if (notifFields.idNotificacion && sample.ground.docNumber) {
    const ext = notifFields.idNotificacion.trim();
    const gt = sample.ground.docNumber.trim();
    if (ext === gt || ext.includes(gt) || gt.includes(ext)) {
      headerDocHits++;
    }
  } else if (!sample.ground.docNumber) {
    headerDocHits++;
  }
}

assert(headerNombreHits >= headerSamples.length * 0.5,
  'Header nombre extraction ≥50% (' + headerNombreHits + '/' + headerSamples.length + ')');
assert(headerNifHits >= headerSamples.length * 0.7,
  'Header NIF extraction ≥70% (' + headerNifHits + '/' + headerSamples.length + ')');

// ---------------------------------------------------------------------------
// Test 3: Extraction on paragraph layout
// ---------------------------------------------------------------------------
console.log('\n=== Test 3: Extraction on paragraph layout samples ===');

const paragraphSamples = corpus.filter(s => s.layout === 'paragraph').slice(0, 20);
let paraNameHits = 0;
let paraNifHits = 0;
let paraAsuntoHits = 0;

for (const sample of paragraphSamples) {
  const headText = sample.text.slice(0, 2500);
  const result = FieldExtractor.extract(sample.text, headText);
  const notifFields = FieldExtractor.extractNotificationFields(sample.text, {});

  // Check nombre via D./Dña. pattern
  const extractedName = (notifFields.nombre || result.person.fullName || '').toUpperCase().trim();
  if (extractedName && sample.ground.nombre.toUpperCase().includes(extractedName.split(' ')[0])) {
    paraNameHits++;
  }

  // Check NIF
  if (sample.ground.nif && result.person.taxId === sample.ground.nif.value) {
    paraNifHits++;
  } else if (!sample.ground.nif) {
    paraNifHits++;
  }

  // Check asunto
  if (notifFields.asunto && sample.ground.asunto) {
    const ext = notifFields.asunto.trim().toUpperCase();
    const gt = sample.ground.asunto.trim().toUpperCase();
    if (ext === gt || ext.includes(gt) || gt.includes(ext)) {
      paraAsuntoHits++;
    }
  } else if (!sample.ground.asunto) {
    paraAsuntoHits++;
  }
}

assert(paraNameHits >= paragraphSamples.length * 0.4,
  'Paragraph name extraction ≥40% (' + paraNameHits + '/' + paragraphSamples.length + ')');
assert(paraNifHits >= paragraphSamples.length * 0.6,
  'Paragraph NIF extraction ≥60% (' + paraNifHits + '/' + paragraphSamples.length + ')');

// ---------------------------------------------------------------------------
// Test 4: Calibrated config exists and is valid
// ---------------------------------------------------------------------------
console.log('\n=== Test 4: Calibrated config validation ===');

const config = JSON.parse(readFileSync(join(ROOT, 'calibration/calibratedConfig.json'), 'utf-8'));
assert(config.version === 1, 'Config version is 1');
assert(!!config.generatedAt, 'Config has generatedAt timestamp');
assert(!!config.patterns, 'Config has patterns section');
assert(!!config.thresholds, 'Config has thresholds section');
assert(!!config.patterns.nombre, 'Config has nombre patterns');
assert(!!config.patterns.nDocumento, 'Config has nDocumento patterns');
assert(!!config.patterns.fecha, 'Config has fecha patterns');
assert(!!config.patterns.asunto, 'Config has asunto patterns');
assert(!!config.patterns.nif, 'Config has nif patterns');
assert(config.patterns.nombre.selected.primary === 'apellidosYNombre',
  'Best nombre pattern is apellidosYNombre');
assert(config.patterns.nif.selected.primaryWeight > 0.8,
  'NIF pattern weight is >0.8 (' + config.patterns.nif.selected.primaryWeight + ')');

// Check calibration accuracy was recorded
assert(config.calibration.trainingSamples >= 100, 'Trained on ≥100 samples');
assert(config.calibration.validationSamples >= 50, 'Validated on ≥50 samples');

// ---------------------------------------------------------------------------
// Test 5: Specific field extraction patterns
// ---------------------------------------------------------------------------
console.log('\n=== Test 5: Specific field extraction patterns ===');

// Test NIF CCC/NAF extraction
{
  const text = 'NIF CCC/NAF: X1234567L\nApellidos y Nombre/R. Social: TEST NAME\n---';
  const headText = text;
  const result = FieldExtractor.extract(text, headText);
  assert(result.references.nifCccNaf === 'X1234567L', 'Extracts NIF CCC/NAF labeled');
}

// Test "con NIF" paragraph pattern
{
  const text = 'D. TEST NAME, con NIF 12345678Z, le comunicamos...';
  const headText = text;
  const result = FieldExtractor.extract(text, headText);
  assert(result.references.nifCccNaf === '12345678Z', 'Extracts NIF from "con NIF" pattern');
}

// Test Nº Documento variants
{
  const text1 = 'Nº Documento: 12345678\nFecha: 01/01/2025';
  const nf1 = FieldExtractor.extractNotificationFields(text1, {});
  assert(nf1.idNotificacion === '12345678', 'Extracts Nº Documento standard');
}

{
  const text2 = 'Numero Documento: ABC-2025-123456';
  const nf2 = FieldExtractor.extractNotificationFields(text2, {});
  assert(nf2.idNotificacion === 'ABC-2025-123456', 'Extracts Numero Documento');
}

{
  const text3 = 'Referencia: REF-999';
  const nf3 = FieldExtractor.extractNotificationFields(text3, {});
  assert(nf3.idNotificacion === 'REF-999', 'Extracts Referencia as doc number');
}

// Test Asunto paragraph patterns
{
  const text4 = 'en relación con el asunto RESOLUCIÓN SOBRE BASE DE COTIZACIÓN DEFINITIVA.';
  const nf4 = FieldExtractor.extractNotificationFields(text4, {});
  assert(nf4.asunto && nf4.asunto.includes('RESOLUCIÓN'), 'Extracts asunto from paragraph');
}

{
  const text5 = 'le informamos sobre COMUNICACION A CCC/NAF RESCISIÓN.';
  const nf5 = FieldExtractor.extractNotificationFields(text5, {});
  assert(nf5.asunto && nf5.asunto.includes('COMUNICACION'), 'Extracts asunto from "informamos" pattern');
}

// Test Fecha from paragraph
{
  const text6 = 'Con fecha 15/03/2025, se ha procedido a la tramitación.';
  const headText = text6;
  const result = FieldExtractor.extract(text6, headText);
  assert(result.references.fechaGeneric === '15/03/2025', 'Extracts fecha from "Con fecha" pattern');
}

// Test D./Dña. paragraph nombre extraction
{
  const text7 = 'Dña. GARCIA LOPEZ MARIA, con NIF 12345678Z,\nle comunicamos que...';
  const nf7 = FieldExtractor.extractNotificationFields(text7, {});
  assert(nf7.nombre && nf7.nombre.includes('GARCIA'), 'Extracts nombre from Dña. pattern');
  assert(nf7.nombreLabel === 'NOMBRE', 'Label is NOMBRE for Dña. pattern');
}

// Test config loading
{
  FieldExtractor.loadCalibratedConfig(config);
  const cfg = FieldExtractor.getCalibratedConfig();
  assert(cfg.version === 1, 'loadCalibratedConfig works');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`Final results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
