/**
 * Synthetic Spanish document text generator.
 *
 * Produces realistic "extracted text" strings (as PDF.js would output) with:
 *   - label variants, spacing noise, line breaks, punctuation variants
 *   - accents sometimes missing (Numero vs Número)
 *   - random insertion of irrelevant boilerplate ("moss" noise)
 *   - different ordering and optional missing fields
 *
 * Usage (Node.js):
 *   const { generateCorpus } = require('./syntheticGenerator.js');
 *   const samples = generateCorpus(500);
 */
const SyntheticGenerator = (() => {
  // ---- deterministic seeded PRNG (xoshiro128**) ----------------------------
  function makeRng(seed) {
    let s = [seed | 0, (seed >>> 16) ^ 0x9e3779b9, seed ^ 0xdeadbeef, (seed << 8) ^ 0x12345678];
    function next() {
      const r = (s[1] * 5) | 0;
      const t = (s[1] << 9) | (s[1] >>> 23);
      const result = ((t * 9) >>> 0);
      const u = s[1] << 9;
      s[2] ^= s[0]; s[3] ^= s[1]; s[1] ^= s[2]; s[0] ^= s[3];
      s[2] ^= u; s[3] = (s[3] << 11) | (s[3] >>> 21);
      return (result >>> 0) / 4294967296;
    }
    return next;
  }

  // ---- helpers -------------------------------------------------------------
  function pick(arr, rng) { return arr[(rng() * arr.length) | 0]; }
  function maybe(prob, rng) { return rng() < prob; }
  function randInt(min, max, rng) { return min + ((rng() * (max - min + 1)) | 0); }

  // ---- data pools ----------------------------------------------------------
  const FIRST_NAMES = [
    'JUAN', 'MARIA', 'CARLOS', 'ANA', 'PEDRO', 'LUCIA', 'FRANCISCO', 'ELENA',
    'MIGUEL', 'ROSA', 'ANTONIO', 'CARMEN', 'JOSE', 'ISABEL', 'PABLO', 'SOFIA',
    'ANDRES', 'MARTA', 'RAFAEL', 'LAURA', 'DAVID', 'PILAR', 'JORGE', 'TERESA',
  ];

  const LAST_NAMES = [
    'GARCIA', 'MARTINEZ', 'LOPEZ', 'GONZALEZ', 'RODRIGUEZ', 'FERNANDEZ',
    'SANCHEZ', 'PEREZ', 'MARTIN', 'GOMEZ', 'RUIZ', 'HERNANDEZ',
    'DIAZ', 'MORENO', 'ALVAREZ', 'MUÑOZ', 'ROMERO', 'JIMENEZ',
    'TORRES', 'BLANCO', 'VEGA', 'CASTRO', 'ORTEGA', 'NAVARRO',
  ];

  const EMISOR_OPTIONS = [
    'Tesoreria General de la Seguridad Social',
    'Agencia Tributaria',
    'Dirección General de Tráfico',
    'Servicio Público de Empleo Estatal',
  ];

  const ASUNTO_OPTIONS = [
    'COMUNICACION A CCC/NAF RESCISIÓN A ARED',
    'RESOLUCIÓN SOBRE BASE DE COTIZACIÓN DEFINITIVA',
    'NOTIFICACIÓN DE ALTA EN RÉGIMEN ESPECIAL',
    'REGULARIZACIÓN AUTÓNOMOS TAR 090',
    'COMUNICACIÓN VARIACIÓN DE DATOS',
    'REQUERIMIENTO DE DOCUMENTACIÓN',
  ];

  const BOILERPLATE_NOISE = [
    'Este documento ha sido generado electrónicamente.',
    'Para cualquier consulta, diríjase a la oficina más cercana.',
    'Plazo de alegaciones: 10 días hábiles desde la recepción.',
    'De conformidad con lo establecido en la Ley General de la Seguridad Social.',
    'Los datos de carácter personal serán tratados conforme al RGPD.',
    'Puede verificar la autenticidad de este documento en la sede electrónica.',
    'MINISTERIO DE TRABAJO Y ECONOMIA SOCIAL',
    'GOBIERNO DE ESPAÑA',
    'Firmado electrónicamente por el órgano competente.',
    'Clave de verificación: ABCD-1234-EFGH-5678',
    'La presente resolución pone fin a la vía administrativa.',
    'Contra la presente resolución cabe interponer recurso de alzada.',
    'Página 1 de 3',
  ];

  // ---- Spanish Tax ID generators ------------------------------------------
  const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

  function generateDNI(rng) {
    const num = randInt(10000000, 99999999, rng);
    return String(num) + DNI_LETTERS[num % 23];
  }

  function generateNIE(rng) {
    const prefix = pick(['X', 'Y', 'Z'], rng);
    const map = { X: 0, Y: 1, Z: 2 };
    const num = randInt(1000000, 9999999, rng);
    const full = map[prefix] * 10000000 + num;
    return prefix + String(num).padStart(7, '0') + DNI_LETTERS[full % 23];
  }

  function generateCIF(rng) {
    const letters = 'ABCDEFGHJNPQRSUVW';
    const controlLetters = 'JABCDEFGHI';
    const letterOnlyTypes = 'NPQRSW';
    const first = pick(letters.split(''), rng);
    const digits = [];
    for (let i = 0; i < 7; i++) digits.push(randInt(0, 9, rng));

    let evenSum = 0, oddSum = 0;
    for (let i = 0; i < 7; i++) {
      if ((i + 1) % 2 === 0) evenSum += digits[i];
      else { const d2 = digits[i] * 2; oddSum += d2 > 9 ? d2 - 9 : d2; }
    }
    const cd = (10 - ((evenSum + oddSum) % 10)) % 10;
    const last = letterOnlyTypes.includes(first) ? controlLetters[cd] : String(cd);
    return first + digits.join('') + last;
  }

  function generateTaxId(rng) {
    const r = rng();
    if (r < 0.5) return { value: generateDNI(rng), type: 'DNI' };
    if (r < 0.85) return { value: generateNIE(rng), type: 'NIE' };
    return { value: generateCIF(rng), type: 'CIF' };
  }

  // ---- date generators -----------------------------------------------------
  function generateDate(rng) {
    const d = String(randInt(1, 28, rng)).padStart(2, '0');
    const m = String(randInt(1, 12, rng)).padStart(2, '0');
    const y = String(randInt(2020, 2026, rng));
    return `${d}/${m}/${y}`;
  }

  function generateDateTime(rng) {
    const h = String(randInt(0, 23, rng)).padStart(2, '0');
    const min = String(randInt(0, 59, rng)).padStart(2, '0');
    const sec = String(randInt(0, 59, rng)).padStart(2, '0');
    return `${generateDate(rng)} ${h}:${min}:${sec}`;
  }

  // ---- doc number generators -----------------------------------------------
  function generateDocNumber(rng) {
    const styles = [
      () => {
        const parts = [randInt(10, 99, rng), randInt(10, 99, rng),
          'R' + randInt(10, 99, rng), randInt(10, 99, rng), randInt(1000000, 9999999, rng)];
        return parts.join(' ');
      },
      () => 'N' + randInt(100000000, 999999999, rng),
      () => 'DOC-' + randInt(2020, 2026, rng) + '-' + randInt(100000, 999999, rng),
      () => String(randInt(10000000, 99999999, rng)),
    ];
    return pick(styles, rng)();
  }

  function generateExpediente(rng) {
    const styles = [
      () => randInt(1000, 9999, rng) + '/' + randInt(2020, 2026, rng),
      () => 'EXP-' + randInt(100000, 999999, rng),
      () => String(randInt(3800, 3899, rng)) + 'Z' + randInt(1000000000, 9999999999, rng),
      () => '',
    ];
    return pick(styles, rng)();
  }

  // ---- label variant helpers -----------------------------------------------
  function nLabel(rng) {
    return pick(['Nº Documento', 'N° Documento', 'No Documento', 'Nº  Documento',
      'Numero Documento', 'Número Documento', 'N.º Documento', 'Nº Doc.', 'NºDocumento'], rng);
  }

  function fechaLabel(rng) {
    return pick(['Fecha', 'FECHA', 'Fecha ', 'fecha'], rng);
  }

  function asuntoLabel(rng) {
    return pick(['Asunto', 'ASUNTO', 'Asunto ', 'asunto'], rng);
  }

  function nifLabel(rng) {
    return pick(['NIF CCC/NAF', 'NIF  CCC/NAF', 'NIF CCC / NAF', 'NIF', 'CCC/NAF',
      'N.I.F.', 'NIF/CCC', 'CCC / NAF'], rng);
  }

  function nombreLabel(rng) {
    return pick(['Apellidos y Nombre/R. Social', 'Apellidos y Nombre / R. Social',
      'Apellidos y Nombre/R.Social', 'Apellidos  y  Nombre/R. Social',
      'APELLIDOS Y NOMBRE/R. SOCIAL', 'Apellidos Y Nombre/R. Social'], rng);
  }

  // ---- spacing / noise helpers ---------------------------------------------
  function sep(rng) {
    return pick([':', ': ', ' : ', ':  ', ' :  '], rng);
  }

  function lineGap(rng) {
    if (rng() < 0.3) return '\n\n';
    return '\n';
  }

  function noiseBlock(rng) {
    if (!maybe(0.4, rng)) return '';
    const n = randInt(1, 3, rng);
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(pick(BOILERPLATE_NOISE, rng));
    return '\n' + lines.join('\n') + '\n';
  }

  function maybeDropAccent(str, rng) {
    if (!maybe(0.25, rng)) return str;
    return str
      .replace(/á/g, 'a').replace(/é/g, 'e').replace(/í/g, 'i')
      .replace(/ó/g, 'o').replace(/ú/g, 'u')
      .replace(/Á/g, 'A').replace(/É/g, 'E').replace(/Í/g, 'I')
      .replace(/Ó/g, 'O').replace(/Ú/g, 'U');
  }

  // ---- layout generators ---------------------------------------------------

  /**
   * Header/Table layout — fields appear as labeled rows (typical of
   * machine-generated administrative PDFs).
   */
  function generateHeaderLayout(ground, rng) {
    const parts = [];
    parts.push(noiseBlock(rng));

    // Optionally add a heading
    if (maybe(0.6, rng)) {
      parts.push(pick([
        'TESORERÍA GENERAL DE LA SEGURIDAD SOCIAL',
        'MINISTERIO DE TRABAJO Y ECONOMIA SOCIAL',
        'GOBIERNO DE ESPAÑA',
        'AGENCIA TRIBUTARIA',
      ], rng));
      parts.push(lineGap(rng));
    }

    // Build the field lines in a shuffleable array
    const fieldLines = [];

    if (ground.nif) {
      fieldLines.push({ key: 'nif', line: nifLabel(rng) + sep(rng) + ground.nif.value });
    }
    if (ground.nombre) {
      fieldLines.push({ key: 'nombre', line: nombreLabel(rng) + sep(rng) + ground.nombre });
    }
    if (ground.docNumber) {
      fieldLines.push({ key: 'docNumber', line: nLabel(rng) + sep(rng) + ground.docNumber });
    }
    if (ground.fecha) {
      const label = maybeDropAccent(fechaLabel(rng), rng);
      fieldLines.push({ key: 'fecha', line: label + sep(rng) + ground.fecha });
    }
    if (ground.asunto) {
      const label = maybeDropAccent(asuntoLabel(rng), rng);
      fieldLines.push({ key: 'asunto', line: label + sep(rng) + ground.asunto });
    }

    // Optionally shuffle
    if (maybe(0.3, rng)) {
      for (let i = fieldLines.length - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        [fieldLines[i], fieldLines[j]] = [fieldLines[j], fieldLines[i]];
      }
    }

    for (const fl of fieldLines) {
      parts.push(fl.line);
      parts.push(lineGap(rng));
      if (maybe(0.2, rng)) parts.push(noiseBlock(rng));
    }

    // Trailing separator (---) sometimes present
    if (maybe(0.5, rng)) {
      const dashCount = randInt(3, 20, rng);
      parts.push('-'.repeat(dashCount));
    }

    parts.push(noiseBlock(rng));
    return parts.join('');
  }

  /**
   * Paragraph layout — fields appear inline in running text,
   * using "D./Dña." patterns, with NIF inline.
   */
  function generateParagraphLayout(ground, rng) {
    const parts = [];
    parts.push(noiseBlock(rng));

    // Heading / saludo
    if (maybe(0.5, rng)) {
      parts.push(pick(['Estimado/a contribuyente,', 'Muy Sr./Sra. mío/a:', 'A quien corresponda:'], rng));
      parts.push(lineGap(rng));
    }

    // D./Dña. name with NIF inline
    const honorific = pick(['D.', 'Dña.', 'Don', 'Doña', 'D./Dña.'], rng);
    let sentence = honorific + ' ' + ground.nombre;

    if (ground.nif) {
      const nifIntro = pick([', con NIF ', ', con N.I.F. ', ', NIF: ', ', con CCC/NAF '], rng);
      sentence += nifIntro + ground.nif.value;
    }
    sentence += ',';
    parts.push(sentence);
    parts.push(lineGap(rng));

    // Body paragraph mentioning asunto and fecha
    if (ground.asunto) {
      const intro = pick([
        'se le comunica que en relación con el asunto',
        'le informamos sobre',
        'en relación al expediente relativo a',
      ], rng);
      parts.push(intro + ' ' + ground.asunto + '.');
      parts.push(lineGap(rng));
    }

    if (ground.fecha) {
      const fechaIntro = pick([
        'Con fecha ',
        'A fecha de ',
        'En fecha ',
      ], rng);
      parts.push(fechaIntro + ground.fecha + ', se ha procedido a la tramitación.');
    }

    parts.push(lineGap(rng));

    if (ground.docNumber) {
      parts.push(pick([
        'Referencia: ',
        nLabel(rng) + sep(rng),
        'Documento nº: ',
      ], rng) + ground.docNumber);
      parts.push(lineGap(rng));
    }

    // Separator
    if (maybe(0.4, rng)) {
      const dashCount = randInt(3, 20, rng);
      parts.push('-'.repeat(dashCount));
    }

    parts.push(noiseBlock(rng));
    return parts.join('');
  }

  // ---- main generate function ----------------------------------------------

  /**
   * Generate a single synthetic document sample.
   * Returns { text, ground } where ground is the ground-truth fields.
   */
  function generateSample(seed) {
    const rng = makeRng(seed);

    // Ground truth
    const ground = {};
    ground.nombre = pick(LAST_NAMES, rng) + ' ' + pick(LAST_NAMES, rng) + ' ' + pick(FIRST_NAMES, rng);
    ground.nif = maybe(0.9, rng) ? generateTaxId(rng) : null;
    ground.docNumber = maybe(0.85, rng) ? generateDocNumber(rng) : null;
    ground.fecha = maybe(0.85, rng) ? (maybe(0.5, rng) ? generateDateTime(rng) : generateDate(rng)) : null;
    ground.asunto = maybe(0.8, rng) ? pick(ASUNTO_OPTIONS, rng) : null;
    ground.expediente = maybe(0.4, rng) ? generateExpediente(rng) : null;
    ground.emisor = pick(EMISOR_OPTIONS, rng);

    // Pick layout
    const layout = maybe(0.6, rng) ? 'header' : 'paragraph';
    const text = layout === 'header'
      ? generateHeaderLayout(ground, rng)
      : generateParagraphLayout(ground, rng);

    return { text, ground, layout, seed };
  }

  /**
   * Generate a corpus of N synthetic samples.
   */
  function generateCorpus(n, startSeed) {
    const base = startSeed || 42;
    const samples = [];
    for (let i = 0; i < n; i++) {
      samples.push(generateSample(base + i));
    }
    return samples;
  }

  return { generateSample, generateCorpus };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SyntheticGenerator;
}
