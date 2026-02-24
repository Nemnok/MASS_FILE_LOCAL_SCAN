/**
 * Stage 3 stub — EML generator.
 * Will be implemented in Stage 3: Generate EML files for Outlook.
 */
const EmlGenerator = (() => {
  /**
   * Generate an .eml file for a scanned document.
   * @param {object} options
   * @param {object} options.scanResult    - ScanResult from Stage 1
   * @param {string} options.recipient     - Recipient email address
   * @param {string} options.signatureHtml - HTML signature block
   * @param {ArrayBuffer} options.pdfFileBytes - Original PDF bytes to attach
   * @returns {Promise<string>} EML content as a string
   */
  async function generateEml({ scanResult, recipient, signatureHtml, pdfFileBytes }) {
    // Stage 3: build MIME multipart EML with the PDF attached
    throw new Error('Stage 3 (EML generation) is not implemented yet.');
  }

  return { generateEml };
})();
