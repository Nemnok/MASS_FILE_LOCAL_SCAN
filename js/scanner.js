/**
 * Scanner — Stage 1 PDF text extraction using PDF.js.
 * Produces a ScanResult object for each file.
 */
const Scanner = (() => {
  const HEAD_TEXT_CHARS = 2500;

  /**
   * Extract text from a single PDF file.
   * @param {File} file
   * @param {function({ page: number, total: number })} onProgress
   * @returns {Promise<ScanResult>}
   */
  async function scanFile(file, onProgress) {
    const result = {
      file: {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      },
      doc: { docType: 'unknown', docTypeConfidence: 0, titleText: '' },
      person: { fullName: null, taxId: null, taxIdType: null, taxIdCandidates: [] },
      references: {},
      extraction: { method: 'text', pagesProcessed: 0, headText: '', fullText: '' },
      diagnostics: { confidence: 0, warnings: [], errors: [] },
    };

    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;
      const pageTexts = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Build page text, using hasEOL hints to preserve line structure
        let pageText = '';
        for (const item of textContent.items) {
          if (typeof item.str === 'string') {
            pageText += item.str;
            if (item.hasEOL) pageText += '\n';
            else if (item.str && !item.str.endsWith(' ')) pageText += ' ';
          }
        }
        pageTexts.push(pageText);

        if (onProgress) {
          onProgress({ page: pageNum, total: totalPages });
        }
      }

      const rawText = pageTexts.join('\n');
      const fullText = FieldExtractor.normalizeText(rawText);
      const headText = fullText.slice(0, HEAD_TEXT_CHARS);

      result.extraction.pagesProcessed = totalPages;
      result.extraction.headText = headText;
      result.extraction.fullText = fullText;

      // Field recognition
      const extracted = FieldExtractor.extract(fullText, headText);
      result.doc = extracted.doc;
      result.person = extracted.person;
      result.references = extracted.references;
      result.diagnostics = {
        ...extracted.diagnostics,
        errors: [],
      };
    } catch (err) {
      result.diagnostics.errors.push({
        code: 'PDF_EXTRACTION_ERROR',
        message: err.message || 'Unknown error during PDF extraction',
      });
    }

    return result;
  }

  return { scanFile };
})();
