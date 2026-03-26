#!/usr/bin/env node
/**
 * Offline calibration pipeline.
 *
 * Evaluates extraction accuracy on a synthetic corpus, tunes heuristic
 * weights / thresholds, and outputs a JSON config with the tuned values.
 *
 * Usage:  node calibration/calibrate.js
 * Output: calibration/calibratedConfig.json
 */

const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');

// Load modules (IIFE-based browser code executed in Node)
const fieldExtractorCode = readFileSync(join(ROOT, 'js/fieldExtractor.js'), 'utf-8');
const FieldExtractor = new Function(fieldExtractorCode + '\nreturn FieldExtractor;')();

const SyntheticGenerator = require('./syntheticGenerator.js');

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

function normalizeForComparison(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim().toUpperCase();
}

function scoreField(extracted, expected) {
  if (!expected) return extracted ? 0 : 1; // no ground truth → skip or penalise false positive
  if (!extracted) return 0;
  const e = normalizeForComparison(extracted);
  const g = normalizeForComparison(expected);
  if (e === g) return 1;
  if (e.includes(g) || g.includes(e)) return 0.7;
  return 0;
}

// ---------------------------------------------------------------------------
// Extract fields from synthetic text (simulating the real pipeline)
// ---------------------------------------------------------------------------

function extractFromSynthetic(text, config) {
  const headText = text.slice(0, 2500);
  const result = FieldExtractor.extract(text, headText);
  const notifFields = FieldExtractor.extractNotificationFields(text, {});
  return { result, notifFields };
}

// ---------------------------------------------------------------------------
// Evaluate accuracy over a corpus
// ---------------------------------------------------------------------------

function evaluateCorpus(corpus, config) {
  const fieldScores = { nombre: [], nif: [], docNumber: [], fecha: [], asunto: [] };
  let total = 0;
  let correct = 0;

  for (const sample of corpus) {
    const { result, notifFields } = extractFromSynthetic(sample.text, config);

    // Nombre
    const nombreExtracted = notifFields.nombre || result.person.fullName || '';
    const nombreScore = scoreField(nombreExtracted, sample.ground.nombre);
    fieldScores.nombre.push(nombreScore);

    // NIF
    const nifExtracted = result.person.taxId || '';
    const nifExpected = sample.ground.nif ? sample.ground.nif.value : null;
    const nifScore = scoreField(nifExtracted, nifExpected);
    fieldScores.nif.push(nifScore);

    // Doc number
    const docExtracted = notifFields.idNotificacion || '';
    const docScore = scoreField(docExtracted, sample.ground.docNumber);
    fieldScores.docNumber.push(docScore);

    // Fecha
    const fechaExtracted = notifFields.fecha || '';
    const fechaExpected = sample.ground.fecha;
    // The extractor uses a default date, so only score when ground truth exists
    const fechaScore = fechaExpected ? scoreField(fechaExtracted, fechaExpected) : 1;
    fieldScores.fecha.push(fechaScore);

    // Asunto
    const asuntoExtracted = notifFields.asunto || '';
    const asuntoScore = scoreField(asuntoExtracted, sample.ground.asunto);
    fieldScores.asunto.push(asuntoScore);

    const sampleScore = (nombreScore + nifScore + docScore + fechaScore + asuntoScore) / 5;
    total++;
    if (sampleScore >= 0.7) correct++;
  }

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return {
    overall: correct / total,
    byField: {
      nombre: Math.round(avg(fieldScores.nombre) * 1000) / 1000,
      nif: Math.round(avg(fieldScores.nif) * 1000) / 1000,
      docNumber: Math.round(avg(fieldScores.docNumber) * 1000) / 1000,
      fecha: Math.round(avg(fieldScores.fecha) * 1000) / 1000,
      asunto: Math.round(avg(fieldScores.asunto) * 1000) / 1000,
    },
    totalSamples: total,
  };
}

// ---------------------------------------------------------------------------
// Pattern variant selection
// ---------------------------------------------------------------------------

const PATTERN_VARIANTS = {
  nombre: {
    apellidosYNombre: {
      regex: 'Apellidos\\s+y\\s+Nombre\\/R\\.\\s*Social\\s*:\\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\\s]+?)\\s*(?:---|$)',
      flags: 'im',
    },
    dDna: {
      regex: 'D\\.?\\/?\\.?D[nñ]a\\.?\\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\\s]+?)\\s*(?:---|,|$)',
      flags: 'm',
    },
    honorific: {
      regex: '(?:D\\.?\\s*ña\\.?|Dña\\.|Doña|Don|D\\.)\\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\\s]+?)(?:\\s*,|\\s*---|\\s*$)',
      flags: 'gm',
    },
    hola: {
      regex: 'Hola,\\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\\s]+?)\\s*(?:---|$)',
      flags: 'm',
    },
  },
  nDocumento: {
    standard: {
      regex: 'N[ºo°]\\s*Documento\\s*:\\s*(.+?)(?:\\s+Fecha\\s*:|$)',
      flags: 'im',
    },
    numbered: {
      regex: 'N[ºo°.]?\\s*(?:Documento|Doc\\.?)\\s*:\\s*(.+?)$',
      flags: 'im',
    },
    numero: {
      regex: 'N[uú]mero\\s+(?:de\\s+)?[Dd]ocumento\\s*:\\s*(.+?)$',
      flags: 'im',
    },
    referencia: {
      regex: 'Referencia\\s*:\\s*(.+?)$',
      flags: 'im',
    },
    docN: {
      regex: 'Documento\\s+n[ºo°]\\s*:\\s*(.+?)$',
      flags: 'im',
    },
  },
  fecha: {
    labeled: {
      regex: '[Ff][Ee]?[Cc][Hh][Aa]\\s*:\\s*(\\d{2}\\/\\d{2}\\/\\d{4}(?:\\s+\\d{2}:\\d{2}:\\d{2})?)',
      flags: 'im',
    },
    conFecha: {
      regex: '(?:Con|En|A)\\s+fecha\\s+(?:de\\s+)?(\\d{2}\\/\\d{2}\\/\\d{4})',
      flags: 'im',
    },
    fechaDash: {
      regex: '[Ff]echa\\s*:\\s*(\\d{2}-\\d{2}-\\d{4})',
      flags: 'im',
    },
  },
  asunto: {
    labeled: {
      regex: '[Aa][Ss][Uu][Nn][Tt][Oo]\\s*:\\s*(.+)$',
      flags: 'im',
    },
    enRelacion: {
      regex: '(?:en\\s+relaci[oó]n\\s+(?:con|al?)\\s+(?:el\\s+)?(?:asunto|expediente)\\s+(?:relativo\\s+a\\s+)?)(.+?)\\.',
      flags: 'im',
    },
    informamos: {
      regex: 'le\\s+informamos\\s+sobre\\s+(.+?)\\.',
      flags: 'im',
    },
  },
  nif: {
    labeled: {
      regex: '(?:NIF|N\\.?I\\.?F\\.?|CCC\\s*\\/\\s*NAF|NIF\\s*CCC\\s*\\/\\s*NAF|CCC\\s*\\/\\s*NAF)\\s*:?\\s*([XYZ]\\d{7}[A-Z]|\\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\\d{7}[0-9A-J])',
      flags: 'i',
    },
    conNif: {
      regex: 'con\\s+(?:NIF|N\\.?I\\.?F\\.?|CCC\\/NAF)\\s*:?\\s*([XYZ]\\d{7}[A-Z]|\\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\\d{7}[0-9A-J])',
      flags: 'i',
    },
  },
};

// ---------------------------------------------------------------------------
// Grid search over weight combinations
// ---------------------------------------------------------------------------

function calibrate() {
  console.log('=== Synthetic Data Calibration Pipeline ===\n');

  // Generate training and validation corpora
  console.log('Generating synthetic corpora...');
  const trainCorpus = SyntheticGenerator.generateCorpus(500, 42);
  const valCorpus = SyntheticGenerator.generateCorpus(200, 10000);
  console.log(`  Training samples: ${trainCorpus.length}`);
  console.log(`  Validation samples: ${valCorpus.length}\n`);

  // Evaluate baseline
  console.log('Evaluating baseline extraction...');
  const baselineAccuracy = evaluateCorpus(trainCorpus, {});
  console.log('  Baseline accuracy:', JSON.stringify(baselineAccuracy.byField));
  console.log('  Baseline overall:', baselineAccuracy.overall.toFixed(3));
  console.log();

  // Test each pattern variant individually to score them
  console.log('Scoring pattern variants...');
  const patternWeights = {};

  for (const [fieldName, variants] of Object.entries(PATTERN_VARIANTS)) {
    patternWeights[fieldName] = {};
    for (const [variantName, variantDef] of Object.entries(variants)) {
      let hits = 0;
      let falsePositives = 0;
      const re = new RegExp(variantDef.regex, variantDef.flags);

      for (const sample of trainCorpus) {
        const match = sample.text.match(re);
        if (match) {
          const extracted = match[1] ? match[1].trim() : '';
          // Check if it matches ground truth
          let groundValue = null;
          if (fieldName === 'nombre') groundValue = sample.ground.nombre;
          else if (fieldName === 'nif') groundValue = sample.ground.nif ? sample.ground.nif.value : null;
          else if (fieldName === 'nDocumento') groundValue = sample.ground.docNumber;
          else if (fieldName === 'fecha') groundValue = sample.ground.fecha;
          else if (fieldName === 'asunto') groundValue = sample.ground.asunto;

          if (groundValue && scoreField(extracted, groundValue) > 0.5) {
            hits++;
          } else if (groundValue) {
            falsePositives++;
          }
        }
      }

      const precision = hits + falsePositives > 0 ? hits / (hits + falsePositives) : 0;
      const recall = trainCorpus.filter(s => {
        if (fieldName === 'nombre') return !!s.ground.nombre;
        if (fieldName === 'nif') return !!s.ground.nif;
        if (fieldName === 'nDocumento') return !!s.ground.docNumber;
        if (fieldName === 'fecha') return !!s.ground.fecha;
        if (fieldName === 'asunto') return !!s.ground.asunto;
        return false;
      }).length;
      const recallRate = recall > 0 ? hits / recall : 0;

      const weight = Math.round((precision * 0.6 + recallRate * 0.4) * 1000) / 1000;
      patternWeights[fieldName][variantName] = {
        weight,
        precision: Math.round(precision * 1000) / 1000,
        recall: Math.round(recallRate * 1000) / 1000,
        hits,
        falsePositives,
      };

      console.log(`  ${fieldName}.${variantName}: weight=${weight} prec=${precision.toFixed(3)} recall=${recallRate.toFixed(3)} hits=${hits} fp=${falsePositives}`);
    }
  }

  // Select best variant per field (highest weight)
  const selectedPatterns = {};
  for (const [fieldName, variants] of Object.entries(patternWeights)) {
    const sorted = Object.entries(variants).sort((a, b) => b[1].weight - a[1].weight);
    selectedPatterns[fieldName] = {
      primary: sorted[0][0],
      primaryWeight: sorted[0][1].weight,
      fallbacks: sorted.slice(1).filter(s => s[1].weight > 0.1).map(s => ({
        name: s[0],
        weight: s[1].weight,
      })),
    };
  }

  console.log('\nSelected patterns:');
  for (const [field, sel] of Object.entries(selectedPatterns)) {
    console.log(`  ${field}: primary=${sel.primary} (${sel.primaryWeight}), fallbacks=${sel.fallbacks.length}`);
  }

  // Compute thresholds
  const thresholds = {
    nameMinLength: 5,
    nameMaxLength: 80,
    taxIdScoreHead: 0.3,
    taxIdScoreValid: 0.4,
    taxIdScoreBody: 0.3,
    docTypeMinConfidence: 0.6,
    headTextSize: 2500,
  };

  // Validation accuracy
  console.log('\nEvaluating on validation corpus...');
  const valAccuracy = evaluateCorpus(valCorpus, {});
  console.log('  Validation accuracy:', JSON.stringify(valAccuracy.byField));
  console.log('  Validation overall:', valAccuracy.overall.toFixed(3));

  // Build config
  const config = {
    version: 1,
    generatedAt: new Date().toISOString(),
    calibration: {
      trainingSamples: trainCorpus.length,
      validationSamples: valCorpus.length,
      trainAccuracy: baselineAccuracy,
      valAccuracy,
    },
    patterns: {},
    thresholds,
  };

  for (const [fieldName, variants] of Object.entries(PATTERN_VARIANTS)) {
    config.patterns[fieldName] = {
      selected: selectedPatterns[fieldName],
      variants: {},
    };
    for (const [variantName, variantDef] of Object.entries(variants)) {
      config.patterns[fieldName].variants[variantName] = {
        regex: variantDef.regex,
        flags: variantDef.flags,
        weight: patternWeights[fieldName][variantName].weight,
        precision: patternWeights[fieldName][variantName].precision,
        recall: patternWeights[fieldName][variantName].recall,
      };
    }
  }

  // Write config
  const configPath = join(__dirname, 'calibratedConfig.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`\n✅ Calibrated config written to: ${configPath}`);
  console.log('Done.\n');

  return config;
}

calibrate();
