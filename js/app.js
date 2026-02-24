/**
 * App — Stage 1 main application logic.
 * Manages the file queue, drives scanning, and updates the UI.
 */
(function () {
  'use strict';

  const MAX_FILES = 50;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let queue = [];         // Array of QueueItem
  let nextId = 0;
  let scanning = false;
  let cancelRequested = false;

  // QueueItem shape:
  // { id, file, status: 'pending'|'scanning'|'done'|'error', pagesProcessed, totalPages, scanResult }

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  const dropZone       = document.getElementById('dropZone');
  const fileInput      = document.getElementById('fileInput');
  const btnScan        = document.getElementById('btnScan');
  const btnCancel      = document.getElementById('btnCancel');
  const btnClear       = document.getElementById('btnClear');
  const btnExport      = document.getElementById('btnExport');
  const queueEmpty     = document.getElementById('queueEmpty');
  const queueTable     = document.getElementById('queueTable');
  const queueBody      = document.getElementById('queueBody');
  const overallPCont   = document.getElementById('overallProgressContainer');
  const overallPFill   = document.getElementById('overallProgressFill');
  const progressLabel  = document.getElementById('progressLabel');
  const progressPct    = document.getElementById('progressPercent');
  const resultsPanel   = document.getElementById('resultsPanel');
  const resultsPTitle  = document.getElementById('resultsPanelTitle');
  const resultsPContent= document.getElementById('resultsPanelContent');
  const btnCloseRes    = document.getElementById('btnCloseResults');

  // ---------------------------------------------------------------------------
  // Drag & Drop
  // ---------------------------------------------------------------------------

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drop-zone--active');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drop-zone--active');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drop-zone--active');
    const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
    addFiles(files);
  });

  fileInput.addEventListener('change', () => {
    addFiles([...fileInput.files]);
    fileInput.value = '';
  });

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  function addFiles(files) {
    const remaining = MAX_FILES - queue.length;
    if (remaining <= 0) {
      alert(`Queue is full (max ${MAX_FILES} files).`);
      return;
    }
    const toAdd = files.slice(0, remaining);
    if (files.length > remaining) {
      alert(`Only ${remaining} file(s) added to stay within the ${MAX_FILES} file limit.`);
    }

    for (const file of toAdd) {
      if (!file.name.toLowerCase().endsWith('.pdf')) continue;
      queue.push({
        id: nextId++,
        file,
        status: 'pending',
        pagesProcessed: 0,
        totalPages: 0,
        scanResult: null,
      });
    }

    renderQueue();
    updateControls();
  }

  function clearQueue() {
    queue = [];
    renderQueue();
    updateControls();
    hideResults();
  }

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  async function startScan() {
    if (scanning) return;
    scanning = true;
    cancelRequested = false;
    updateControls();

    const pendingItems = queue.filter(item => item.status === 'pending');
    const total = pendingItems.length;
    let done = 0;

    overallPCont.hidden = false;
    updateOverallProgress(0, total);

    for (const item of pendingItems) {
      if (cancelRequested) break;

      item.status = 'scanning';
      item.pagesProcessed = 0;
      renderQueueRow(item);

      const result = await Scanner.scanFile(item.file, ({ page, total: tp }) => {
        item.pagesProcessed = page;
        item.totalPages = tp;
        renderQueueRow(item);
      });

      item.scanResult = result;
      item.status = result.diagnostics.errors.length > 0 ? 'error' : 'done';
      item.totalPages = result.extraction.pagesProcessed || item.totalPages;
      item.pagesProcessed = item.totalPages;
      renderQueueRow(item);

      done++;
      updateOverallProgress(done, total);
    }

    scanning = false;
    updateControls();

    const doneCount = queue.filter(i => i.status === 'done').length;
    progressLabel.textContent = `Scan complete — ${doneCount} file(s) processed`;
  }

  function cancelScan() {
    cancelRequested = true;
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  function updateOverallProgress(done, total) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    overallPFill.style.width = pct + '%';
    progressPct.textContent = pct + '%';
    if (done < total) {
      progressLabel.textContent = `Scanning ${done + 1} of ${total}…`;
    }
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderQueue() {
    if (queue.length === 0) {
      queueEmpty.hidden = false;
      queueTable.hidden = true;
      return;
    }
    queueEmpty.hidden = true;
    queueTable.hidden = false;
    queueBody.innerHTML = '';
    queue.forEach((item, idx) => {
      const tr = createQueueRow(item, idx + 1);
      queueBody.appendChild(tr);
    });
  }

  function createQueueRow(item, idx) {
    const tr = document.createElement('tr');
    tr.id = 'row-' + item.id;
    tr.innerHTML = buildRowHTML(item, idx);
    attachRowEvents(tr, item);
    return tr;
  }

  function renderQueueRow(item) {
    const tr = document.getElementById('row-' + item.id);
    if (!tr) return;
    const idx = queue.indexOf(item) + 1;
    tr.innerHTML = buildRowHTML(item, idx);
    attachRowEvents(tr, item);
  }

  function buildRowHTML(item, idx) {
    const size = formatSize(item.file.size);
    const statusBadge = buildStatusBadge(item);
    const pageInfo = item.totalPages > 0
      ? `${item.pagesProcessed}/${item.totalPages}`
      : item.status === 'pending' ? '—' : '…';

    const viewBtn = (item.status === 'done' || item.status === 'error')
      ? `<button class="btn btn--small btn--view" data-id="${item.id}">View</button>`
      : '';
    const removeBtn = item.status !== 'scanning'
      ? `<button class="btn btn--small btn--remove" data-id="${item.id}" title="Remove">✕</button>`
      : '';

    return `
      <td class="queue-idx">${idx}</td>
      <td class="queue-name" title="${escHtml(item.file.name)}">${escHtml(truncate(item.file.name, 40))}</td>
      <td class="queue-size">${size}</td>
      <td class="queue-status">${statusBadge}</td>
      <td class="queue-pages">${pageInfo}</td>
      <td class="queue-actions">${viewBtn}${removeBtn}</td>
    `;
  }

  function attachRowEvents(tr, item) {
    const viewBtn = tr.querySelector('.btn--view');
    if (viewBtn) viewBtn.addEventListener('click', () => showResults(item));

    const removeBtn = tr.querySelector('.btn--remove');
    if (removeBtn) removeBtn.addEventListener('click', () => removeItem(item.id));
  }

  function buildStatusBadge(item) {
    const map = {
      pending:  '<span class="badge badge--pending">Pending</span>',
      scanning: '<span class="badge badge--scanning">Scanning…</span>',
      done:     '<span class="badge badge--done">Done</span>',
      error:    '<span class="badge badge--error">Error</span>',
    };
    return map[item.status] || item.status;
  }

  function removeItem(id) {
    queue = queue.filter(i => i.id !== id);
    renderQueue();
    updateControls();
  }

  // ---------------------------------------------------------------------------
  // Results panel
  // ---------------------------------------------------------------------------

  function showResults(item) {
    if (!item.scanResult) return;
    const r = item.scanResult;
    resultsPTitle.textContent = `Results: ${r.file.name}`;
    resultsPContent.innerHTML = buildResultsHTML(r);
    resultsPanel.hidden = false;
    resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function hideResults() {
    resultsPanel.hidden = true;
  }

  btnCloseRes.addEventListener('click', hideResults);

  function buildResultsHTML(r) {
    const d = r.diagnostics;
    const hasErrors = d.errors && d.errors.length > 0;
    const hasWarnings = d.warnings && d.warnings.length > 0;

    return `
      <div class="results-grid">
        <section class="results-section">
          <h3>📄 Document</h3>
          <dl>
            <dt>Type</dt>
            <dd><code>${escHtml(r.doc.docType)}</code></dd>
            <dt>Confidence</dt>
            <dd>${confidenceBar(r.doc.docTypeConfidence)}</dd>
            ${r.doc.titleText ? `<dt>Title text</dt><dd class="text-muted">${escHtml(r.doc.titleText)}</dd>` : ''}
          </dl>
        </section>

        <section class="results-section">
          <h3>👤 Person</h3>
          <dl>
            <dt>Full name</dt>
            <dd>${r.person.fullName ? escHtml(r.person.fullName) : '<em class="text-muted">not found</em>'}</dd>
            <dt>Tax ID</dt>
            <dd>${r.person.taxId
              ? `<strong>${escHtml(r.person.taxId)}</strong> <span class="badge badge--type">${r.person.taxIdType}</span>`
              : '<em class="text-muted">not found</em>'
            }</dd>
          </dl>
          ${r.person.taxIdCandidates.length > 1 ? buildCandidatesTable(r.person.taxIdCandidates) : ''}
        </section>

        <section class="results-section">
          <h3>🔖 References</h3>
          ${buildRefsHTML(r.references)}
        </section>

        <section class="results-section">
          <h3>📊 Extraction</h3>
          <dl>
            <dt>Method</dt><dd>${escHtml(r.extraction.method)}</dd>
            <dt>Pages</dt><dd>${r.extraction.pagesProcessed}</dd>
          </dl>
        </section>

        ${hasWarnings ? `
        <section class="results-section results-section--warn">
          <h3>⚠️ Warnings</h3>
          <ul>${d.warnings.map(w => `<li><code>${escHtml(w.code)}</code> — ${escHtml(w.message)}</li>`).join('')}</ul>
        </section>` : ''}

        ${hasErrors ? `
        <section class="results-section results-section--error">
          <h3>❌ Errors</h3>
          <ul>${d.errors.map(e => `<li><code>${escHtml(e.code)}</code> — ${escHtml(e.message)}</li>`).join('')}</ul>
        </section>` : ''}

        <section class="results-section results-section--full">
          <h3>🔍 Head text preview</h3>
          <pre class="head-text-preview">${escHtml(r.extraction.headText.slice(0, 800))}${r.extraction.headText.length > 800 ? '\n…' : ''}</pre>
        </section>
      </div>
    `;
  }

  function buildCandidatesTable(candidates) {
    const rows = candidates.map(c => `
      <tr>
        <td><strong>${escHtml(c.value)}</strong></td>
        <td>${escHtml(c.type)}</td>
        <td>${c.isValid ? '✅' : '❌'}</td>
        <td>${Math.round(c.score * 100)}%</td>
        <td>${escHtml(c.foundIn)}</td>
        <td class="ctx-snippet">${escHtml(truncate(c.contextSnippet, 50))}</td>
      </tr>`).join('');

    return `
      <details class="candidates-details">
        <summary>All tax ID candidates (${candidates.length})</summary>
        <table class="candidates-table">
          <thead><tr><th>Value</th><th>Type</th><th>Valid</th><th>Score</th><th>Found in</th><th>Context</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </details>`;
  }

  function buildRefsHTML(refs) {
    const entries = Object.entries(refs).filter(([, v]) => v != null);
    if (entries.length === 0) return '<p class="text-muted">No reference fields found.</p>';
    return `<dl>${entries.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(String(v))}</dd>`).join('')}</dl>`;
  }

  function confidenceBar(val) {
    const pct = Math.round(val * 100);
    const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
    return `<span class="conf-bar-wrap"><span class="conf-bar" style="width:${pct}%;background:${color}"></span></span> ${pct}%`;
  }

  // ---------------------------------------------------------------------------
  // Export JSON
  // ---------------------------------------------------------------------------

  function exportJSON() {
    const results = queue
      .filter(i => i.scanResult)
      .map(i => i.scanResult);

    if (results.length === 0) {
      alert('No scan results to export.');
      return;
    }

    const json = JSON.stringify(results, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scan-results-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Controls state
  // ---------------------------------------------------------------------------

  function updateControls() {
    const hasFiles = queue.length > 0;
    const hasPending = queue.some(i => i.status === 'pending');
    const hasResults = queue.some(i => i.scanResult);

    btnScan.disabled   = !hasFiles || !hasPending || scanning;
    btnCancel.disabled = !scanning;
    btnClear.disabled  = !hasFiles || scanning;
    btnExport.disabled = !hasResults;
  }

  btnScan.addEventListener('click', startScan);
  btnCancel.addEventListener('click', cancelScan);
  btnClear.addEventListener('click', clearQueue);
  btnExport.addEventListener('click', exportJSON);

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function truncate(str, max) {
    if (!str || str.length <= max) return str;
    return str.slice(0, max - 1) + '…';
  }

  function escHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
})();
