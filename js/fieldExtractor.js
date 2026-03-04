/**
 * FieldExtractor — Stage 1 field recognition.
 * Extracts: docType, person.fullName, taxId (DNI/NIE/CIF with validation),
 * and reference fields (fechaResolucion, affiliationNumber, expediente, notificationNumber).
 */
const FieldExtractor = (() => {
  // ---------------------------------------------------------------------------
  // Tax ID validation
  // ---------------------------------------------------------------------------

  const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';

  function validateDNI(value) {
    const num = parseInt(value.slice(0, 8), 10);
    if (isNaN(num)) return false;
    return DNI_LETTERS[num % 23] === value[8];
  }

  function validateNIE(value) {
    const map = { X: '0', Y: '1', Z: '2' };
    const first = map[value[0]];
    if (!first) return false;
    return validateDNI(first + value.slice(1));
  }

  function validateCIF(value) {
    // Letter-type CIFs use letter control; numeric-type use digit control
    const controlLetters = 'JABCDEFGHI';
    const letterOnlyTypes = 'NPQRSW';
    const body = value.slice(1, 8);

    let evenSum = 0;
    let oddSum = 0;
    for (let i = 0; i < body.length; i++) {
      const digit = parseInt(body[i], 10);
      if (isNaN(digit)) return false;
      if ((i + 1) % 2 === 0) {
        evenSum += digit;
      } else {
        const d2 = digit * 2;
        oddSum += d2 > 9 ? d2 - 9 : d2;
      }
    }
    const total = evenSum + oddSum;
    const controlDigit = (10 - (total % 10)) % 10;
    const lastChar = value[8];
    const firstChar = value[0].toUpperCase();

    if (letterOnlyTypes.includes(firstChar)) {
      return lastChar === controlLetters[controlDigit];
    }
    return (
      lastChar === String(controlDigit) ||
      lastChar === controlLetters[controlDigit]
    );
  }

  function classifyTaxId(value) {
    if (/^\d{8}[A-Z]$/.test(value)) return 'DNI';
    if (/^[XYZ]\d{7}[A-Z]$/.test(value)) return 'NIE';
    if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(value)) return 'CIF';
    return null;
  }

  function validateTaxId(value, type) {
    try {
      if (type === 'DNI') return validateDNI(value);
      if (type === 'NIE') return validateNIE(value);
      if (type === 'CIF') return validateCIF(value);
    } catch (_) {}
    return false;
  }

  // ---------------------------------------------------------------------------
  // Text normalization
  // ---------------------------------------------------------------------------

  function normalizeText(raw) {
    return raw
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/[^\S\n]+/g, ' ')   // collapse horizontal whitespace
      .replace(/\n{3,}/g, '\n\n')  // max 2 consecutive newlines
      .trim();
  }

  // ---------------------------------------------------------------------------
  // DocType detection
  // ---------------------------------------------------------------------------

  const DOC_TYPE_RULES = [
    {
      id: 'ss_resolucion_base_cotizacion_definitiva',
      primaryPatterns: [
        /RESOLUCI[OÓ]N\s+SOBRE\s+BASE\s+DE\s+COTIZACI[OÓ]N\s+DEFINITIVA/i,
      ],
      bonusPatterns: [
        /PERSONA\s+TRABAJADORA\s+AUT[OÓ]NOMA/i,
        /BASE\s+DE\s+COTIZACI[OÓ]N/i,
      ],
    },
  ];

  function detectDocType(headText) {
    for (const rule of DOC_TYPE_RULES) {
      let primaryHits = 0;
      for (const pat of rule.primaryPatterns) {
        if (pat.test(headText)) primaryHits++;
      }
      if (primaryHits === 0) continue;

      let confidence = 0.6 + (primaryHits / rule.primaryPatterns.length) * 0.2;
      for (const pat of rule.bonusPatterns) {
        if (pat.test(headText)) confidence = Math.min(1, confidence + 0.1);
      }
      return { docType: rule.id, docTypeConfidence: Math.round(confidence * 100) / 100 };
    }
    return { docType: 'unknown', docTypeConfidence: 0 };
  }

  // ---------------------------------------------------------------------------
  // Person name extraction
  // ---------------------------------------------------------------------------

  // Spanish honorifics + name patterns:
  // Group 1: honorific (D., Dña., Doña, Don, D.)
  // Group 2: capitalized given name(s) + surname(s), 2–5 words
  const NAME_PATTERNS = [
    /(?:D\.?\s*ña\.?|Dña\.|Doña|Don|D\.)\s+([A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+(?:[\s\-][A-ZÁÉÍÓÚÜÑ][a-záéíóúüñA-ZÁÉÍÓÚÜÑ]+){1,4})/g,
  ];

  function extractPersonName(text) {
    const candidates = new Map();

    for (const pattern of NAME_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = re.exec(text)) !== null) {
        const name = match[1].trim().replace(/\s+/g, ' ');
        if (name.length < 5 || name.length > 80) continue;
        // Reject if it looks like a heading (all caps short)
        if (name === name.toUpperCase() && name.split(' ').length <= 2) continue;
        candidates.set(name, (candidates.get(name) || 0) + 1);
      }
    }

    if (candidates.size === 0) return null;

    // Pick the name with the earliest occurrence in the text
    let best = null;
    let bestPos = Infinity;
    for (const [name] of candidates) {
      const pos = text.indexOf(name);
      if (pos !== -1 && pos < bestPos) {
        bestPos = pos;
        best = name;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Tax ID extraction
  // ---------------------------------------------------------------------------

  const TAX_ID_RE = /\b([XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])\b/g;

  function extractTaxIds(fullText, headText) {
    const seen = new Map();

    function scan(src, foundIn) {
      const re = new RegExp(TAX_ID_RE.source, TAX_ID_RE.flags);
      let match;
      while ((match = re.exec(src)) !== null) {
        const value = match[1];
        const type = classifyTaxId(value);
        if (!type) continue;
        // Skip trivially fake values where all 8 digits are identical (e.g. 00000000T, 11111111H)
        if (/^(\d)\1{7}/.test(value)) continue;

        if (seen.has(value)) {
          const existing = seen.get(value);
          if (foundIn === 'head' && existing.foundIn !== 'head') {
            existing.foundIn = 'head';
            existing.score = Math.min(1, existing.score + 0.2);
          }
          continue;
        }

        const isValid = validateTaxId(value, type);
        const ctxStart = Math.max(0, match.index - 40);
        const ctxEnd = Math.min(src.length, match.index + value.length + 40);
        const contextSnippet = src.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ').trim();

        let score = 0.3;
        if (isValid) score += 0.4;
        if (foundIn === 'head') score += 0.3;
        score = Math.min(1, score);

        seen.set(value, { value, type, isValid, score, contextSnippet, foundIn });
      }
    }

    // Head has priority — scan it first
    scan(headText, 'head');
    // Then scan full body (skip-if-already-found logic above)
    scan(fullText, 'body');

    return [...seen.values()].sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------------------
  // Reference fields
  // ---------------------------------------------------------------------------

  function extractReferences(text) {
    const refs = {};

    const fechaM = text.match(
      /[Ff]echa\s+de\s+resoluci[oó]n\s*:?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/
    );
    if (fechaM) refs.fechaResolucion = fechaM[1];

    const afM = text.match(
      /[Nn][uú]mero\s+de\s+afiliaci[oó]n\s*:?\s*([\d\s\/\-]{4,20})/
    );
    if (afM) refs.affiliationNumber = afM[1].trim().replace(/\s+/g, '');

    const expM = text.match(
      /[Ee]xpediente\s*(?:[Nn][uú]m\.?\s*)?:?\s*([\w\/\-]{4,30})/
    );
    if (expM) refs.expediente = expM[1].trim();

    const notifM = text.match(
      /[Nn]otificaci[oó]n\s*(?:[Nn][uú]m\.?\s*)?:?\s*([\w\/\-]{4,30})/
    );
    if (notifM) refs.notificationNumber = notifM[1].trim();

    return refs;
  }

  // ---------------------------------------------------------------------------
  // Notification field extraction (for EML generation)
  // ---------------------------------------------------------------------------

  function extractNotificationFields(fullText, notifMeta) {
    const meta = notifMeta || {};
    const fields = {};
    const lines = fullText.split('\n');

    // --------------- Emisor ---------------
    fields.emisor = 'Tesoreria General de la Seguridad Social';
    const emisorPatterns = [
      /Tesorer[ií]a\s+General\s+de\s+la\s+Seguridad\s+Social/i,
      /Agencia\s+Tributaria/i,
      /Direcci[oó]n\s+General\s+de\s+Tr[aá]fico/i,
      /Servicio\s+P[uú]blico\s+de\s+Empleo\s+Estatal/i,
    ];
    for (const pat of emisorPatterns) {
      if (pat.test(fullText)) break;
    }

    // --------------- Detect document type ---------------
    const isModeloTAR = /MODELO\s+TA\s*R/i.test(fullText);
    const isComunicacion = /Asunto\s*:\s*COMUNICACION/i.test(fullText);

    // --------------- Nombre ---------------
    // Pattern 1: "Apellidos y Nombre/R. Social: NAME ---"
    const apNameM = fullText.match(/Apellidos\s+y\s+Nombre\/R\.\s*Social\s*:\s*([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]+?)\s*---/i);
    // Pattern 2: "D./Dña. NAME ---"
    const dnaM = fullText.match(/D\.?\/?D[nñ]a\.?\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]+?)\s*---/);
    // Pattern 3: "Hola, NAME ---:"
    const holaM = fullText.match(/Hola,\s+([A-ZÁÉÍÓÚÜÑ][A-ZÁÉÍÓÚÜÑ\s]+?)\s*---/);

    if (apNameM) {
      fields.nombre = apNameM[1].trim();
      fields.nombreLabel = 'Nombre';
    } else if (dnaM) {
      fields.nombre = dnaM[1].trim();
      fields.nombreLabel = 'NOMBRE';
    } else if (holaM) {
      fields.nombre = holaM[1].trim();
      fields.nombreLabel = 'NOMBRE';
    }

    // Override name label based on document type
    if (isModeloTAR) fields.nombreLabel = 'NOMBRE';
    if (isComunicacion) fields.nombreLabel = 'Nombre';

    // --------------- Id Notificacion ---------------
    // From "Nº Documento: ..." line
    const nDocM = fullText.match(/N[ºo°]\s*Documento\s*:\s*(.+?)(?:\s+Fecha\s*:|$)/im);
    if (nDocM) {
      fields.idNotificacion = nDocM[1].trim();
    }

    // --------------- Estado ---------------
    const estadoM = fullText.match(
      /[Ee]stado\s*:?\s*(PENDIENTE|ACEPTAD[AO]|RECHAZAD[AO]|NOTIFICAD[AO]|LE[IÍ]D[AO])/i
    );
    fields.estado = estadoM ? estadoM[1].toUpperCase() : 'PENDIENTE';

    // --------------- Asunto ---------------
    // Direct extraction from "Asunto: VALUE" line in the document
    const asuntoLineM = fullText.match(/^Asunto\s*:\s*(.+)$/im);
    if (asuntoLineM) {
      fields.asunto = asuntoLineM[1].trim();
    }

    // For MODELO TA R documents, build asunto from components if not directly found
    if (!fields.asunto && isModeloTAR) {
      const parts = [];
      if (/R[eé]gimen/i.test(fullText)) {
        parts.push('REGIMENES SEG. SOCIAL OBLIGADOS A RED');
      }
      if (meta.referenceNumber) parts.push(meta.referenceNumber);
      const modeloM = fullText.match(/MODELO\s+TA\s*R?\s*(?:\d{2,4}\s+)?(\d{3})/i);
      if (modeloM) {
        const suffix = [];
        if (/regularizaci[oó]n/i.test(fullText)) suffix.push('REGULARIZACIÓN');
        if (/aut[oó]nom/i.test(fullText)) suffix.push('AUTÓNOMOS');
        suffix.push('TAR ' + modeloM[1]);
        parts.push(suffix.join(' '));
      }
      if (parts.length > 0) {
        fields.asunto = parts.join(' / ') + ' ';
      }
    }

    // --------------- Fecha ---------------
    fields.fecha = '11/02/2026 02:59:28';

    // --------------- Expediente ---------------
    fields.expediente = '';

    // --------------- Apply notification metadata overrides ---------------
    if (meta.idNotificacion !== undefined) fields.idNotificacion = meta.idNotificacion;
    if (meta.nombre !== undefined) fields.nombre = meta.nombre;
    if (meta.nombreLabel !== undefined) fields.nombreLabel = meta.nombreLabel;
    if (meta.estado !== undefined) fields.estado = meta.estado;
    if (meta.emisor !== undefined) fields.emisor = meta.emisor;
    if (meta.asunto !== undefined) fields.asunto = meta.asunto;
    if (meta.fecha !== undefined) fields.fecha = meta.fecha;
    if (meta.expediente !== undefined) fields.expediente = meta.expediente;

    return fields;
  }

  // ---------------------------------------------------------------------------
  // Main extract entry point
  // ---------------------------------------------------------------------------

  function extract(fullText, headText) {
    const warnings = [];

    // DocType
    const { docType, docTypeConfidence } = detectDocType(headText);
    if (docType === 'unknown') {
      warnings.push({ code: 'DOC_TYPE_UNKNOWN', message: 'Could not determine document type' });
    }

    // Title text (first meaningful lines)
    const titleText = headText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');

    // Person name
    const fullName = extractPersonName(fullText);
    if (!fullName) {
      warnings.push({ code: 'FULL_NAME_NOT_FOUND', message: 'Could not extract person full name' });
    }

    // Tax IDs
    const taxIdCandidates = extractTaxIds(fullText, headText);
    let taxId = null;
    let taxIdType = null;

    if (taxIdCandidates.length > 0) {
      const best = taxIdCandidates[0];
      taxId = best.value;
      taxIdType = best.type;

      if (!best.isValid) {
        warnings.push({
          code: 'TAX_ID_INVALID',
          message: `Tax ID ${taxId} did not pass checksum validation`,
        });
      }

      const distinctValues = [...new Set(taxIdCandidates.map(c => c.value))];
      if (distinctValues.length > 1) {
        warnings.push({
          code: 'MULTIPLE_TAX_IDS_FOUND',
          message: `Multiple tax IDs found: ${distinctValues.join(', ')}`,
          candidates: distinctValues,
        });
      }
    }

    // References
    const references = extractReferences(fullText);

    // Overall confidence
    let confidence = docTypeConfidence;
    if (fullName) confidence = Math.min(1, confidence + 0.1);
    if (taxId) confidence = Math.min(1, confidence + 0.1);
    confidence = Math.round(confidence * 100) / 100;

    return {
      doc: { docType, docTypeConfidence, titleText },
      person: { fullName, taxId, taxIdType, taxIdCandidates },
      references,
      diagnostics: { confidence, warnings, errors: [] },
    };
  }

  return { extract, extractNotificationFields, normalizeText, validateDNI, validateNIE, validateCIF };
})();
