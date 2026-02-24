/**
 * Stage 2 stub — Excel provider.
 * Will be implemented in Stage 2: Excel matching.
 */
const ExcelProvider = (() => {
  let _workbook = null;

  /**
   * Load an Excel file for matching.
   * @param {File} file
   * @returns {Promise<void>}
   */
  async function loadExcel(file) {
    // Stage 2: parse Excel workbook (e.g. with SheetJS)
    throw new Error('Stage 2 (Excel matching) is not implemented yet.');
  }

  /**
   * Find a record by tax ID in the loaded workbook.
   * @param {string} taxId
   * @returns {object|null}
   */
  function findByTaxId(taxId) {
    // Stage 2: look up the tax ID in the loaded workbook rows
    return null;
  }

  return { loadExcel, findByTaxId };
})();
