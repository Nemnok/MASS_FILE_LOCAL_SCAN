/**
 * Stage 3 — EML generator.
 * Generates .eml files (RFC 2822 / MIME) from scanned PDF notification data.
 *
 * Learned from DEBUGFILES example:
 *   PDF: "delete me please.pdf" → Body: DEBUGFILES/123
 *   Body template:
 *     A continuación tiene los detalles de la notificación:
 *     Id Notificacion: ...
 *     Estado: ...
 *     Emisor: ...
 *     Asunto: ...
 *     Fecha: ...
 *     Expediente: ...
 *     Un saludo,
 */
const EmlGenerator = (() => {

  /**
   * Build the notification body text from extracted fields.
   * Format matches the references in DEBUGFILES/salida1 and DEBUGFILES/salida_1.
   *
   * Trailing space convention: Estado, Emisor, and Fecha values always get a
   * trailing space to match the notification system output format.  Name, Id
   * Notificacion, Asunto and Expediente use the raw extracted value as-is.
   */
  function buildNotificationBody(notifFields) {
    const nombreLabel = notifFields.nombreLabel || 'Nombre';
    const nombre = notifFields.nombre || '';
    const idNotif = notifFields.idNotificacion || '';
    const estado = (notifFields.estado || 'PENDIENTE') + ' ';
    const emisor = (notifFields.emisor || 'Tesoreria General de la Seguridad Social') + ' ';
    const asunto = notifFields.asunto || '';
    const fecha = (notifFields.fecha || '11/02/2026 02:59:28') + ' ';
    const expediente = notifFields.expediente || '';

    const lines = [
      '',
      'A continuación tiene los detalles de la notificación:',
      nombreLabel + ': ' + nombre,
      'Id Notificacion: ' + idNotif,
      'Estado: ' + estado,
      'Emisor: ' + emisor,
      'Asunto: ' + asunto,
      'Fecha: ' + fecha,
      'Expediente: ' + expediente,
      '',
      'Un saludo,',
      '',
    ];
    return lines.join('\n');
  }

  /**
   * Encode a Uint8Array / ArrayBuffer to Base64.
   */
  function arrayBufferToBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Fold a base64 string to 76-char lines (RFC 2045).
   */
  function foldBase64(b64) {
    const lines = [];
    for (let i = 0; i < b64.length; i += 76) {
      lines.push(b64.slice(i, i + 76));
    }
    return lines.join('\r\n');
  }

  /**
   * Convert a string to UTF-8 byte string using TextEncoder.
   */
  function toUtf8ByteString(str) {
    const bytes = new TextEncoder().encode(str);
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }

  /**
   * Encode a UTF-8 string as RFC 2047 encoded-word for headers.
   */
  function encodeHeaderValue(str) {
    try {
      const encoded = toUtf8ByteString(str)
        .split('')
        .map(c => {
          const code = c.charCodeAt(0);
          if (
            (code >= 0x30 && code <= 0x39) || // 0-9
            (code >= 0x41 && code <= 0x5a) || // A-Z
            (code >= 0x61 && code <= 0x7a) || // a-z
            c === ' '
          ) {
            return c === ' ' ? '_' : c;
          }
          return '=' + code.toString(16).toUpperCase().padStart(2, '0');
        })
        .join('');
      return '=?UTF-8?Q?' + encoded + '?=';
    } catch (_) {
      return str;
    }
  }

  /**
   * Generate an .eml file for a scanned document.
   * @param {object} options
   * @param {object} options.scanResult    - ScanResult from Stage 1
   * @param {string} [options.recipient]   - Recipient email address
   * @param {ArrayBuffer} options.pdfFileBytes - Original PDF bytes to attach
   * @param {string} [options.pdfFileName] - PDF filename for the attachment
   * @param {object} [options.notifMeta]   - Optional notification metadata overrides
   * @returns {string} EML content as a string
   */
  function generateEml({ scanResult, recipient, pdfFileBytes, pdfFileName, notifMeta }) {
    const fullText = scanResult.extraction.fullText || '';
    const notifFields = FieldExtractor.extractNotificationFields(fullText, notifMeta);

    const body = buildNotificationBody(notifFields);
    const subject = 'Notificación de ' + (notifFields.emisor || 'entidad desconocida');
    const from = 'notificacion@seg-social.es';
    const to = recipient || 'destinatario@example.com';
    const date = new Date().toUTCString();
    const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const attachName = pdfFileName || (scanResult.file && scanResult.file.name) || 'document.pdf';

    const headers = [
      'MIME-Version: 1.0',
      'Date: ' + date,
      'From: ' + from,
      'To: ' + to,
      'Subject: ' + encodeHeaderValue(subject),
      'Content-Type: multipart/mixed; boundary="' + boundary + '"',
      'X-Mailer: MASS_FILE_LOCAL_SCAN EML Generator',
    ];

    // Text body part — normalize to CRLF for RFC 2822 compliance
    const bodyRfc = body.replace(/\r?\n/g, '\r\n');
    const textPart = [
      '--' + boundary,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      quotedPrintableEncode(bodyRfc),
    ].join('\r\n');

    // PDF attachment part
    let attachPart = '';
    if (pdfFileBytes) {
      const b64 = foldBase64(arrayBufferToBase64(pdfFileBytes));
      attachPart = [
        '',
        '--' + boundary,
        'Content-Type: application/pdf; name="' + attachName + '"',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename="' + attachName + '"',
        '',
        b64,
      ].join('\r\n');
    }

    const eml = [
      headers.join('\r\n'),
      '',
      textPart,
      attachPart,
      '',
      '--' + boundary + '--',
      '',
    ].join('\r\n');

    return eml;
  }

  /**
   * Quoted-printable encode a UTF-8 string.
   */
  function quotedPrintableEncode(str) {
    const utf8 = toUtf8ByteString(str);
    let result = '';
    let lineLen = 0;

    for (let i = 0; i < utf8.length; i++) {
      const c = utf8.charCodeAt(i);
      let encoded;

      if (c === 0x0d && utf8.charCodeAt(i + 1) === 0x0a) {
        result += '\r\n';
        lineLen = 0;
        i++; // skip LF
        continue;
      }
      if (c === 0x09 || (c >= 0x20 && c <= 0x7e && c !== 0x3d)) {
        encoded = String.fromCharCode(c);
      } else {
        encoded = '=' + c.toString(16).toUpperCase().padStart(2, '0');
      }

      if (lineLen + encoded.length > 75) {
        result += '=\r\n';
        lineLen = 0;
      }
      result += encoded;
      lineLen += encoded.length;
    }

    return result;
  }

  return { generateEml, buildNotificationBody };
})();
