const API = '/api';
const WORKFLOW = ['New', 'Reviewed', 'Assigned', 'In progress', 'Resolved'];
const AREA_CENTERS = {
  'Canal Ward': { x: 56, y: 41 },
  Northbank: { x: 28, y: 29 },
  'Market Square': { x: 47, y: 59 },
  'Cedar Park': { x: 76, y: 69 },
  'Old Quarter': { x: 32, y: 70 },
  'Device location (prototype)': { x: 50, y: 50 }
};
const SAMPLE_LOCATIONS = [
  { address: 'Canal underpass, east entrance', area: 'Canal Ward', x: 56, y: 41 },
  { address: 'Canal footbridge, south ramp', area: 'Canal Ward', x: 59, y: 43 },
  { address: 'Harbor drain, Canal Ward', area: 'Canal Ward', x: 53, y: 38 },
  { address: 'Northbank library crossing', area: 'Northbank', x: 28, y: 29 },
  { address: 'Mill Street bus stop', area: 'Northbank', x: 24, y: 32 },
  { address: 'Riverside cycle path', area: 'Northbank', x: 32, y: 27 },
  { address: 'Market Square bus stop', area: 'Market Square', x: 47, y: 59 },
  { address: 'Market Hall east corner', area: 'Market Square', x: 50, y: 57 },
  { address: 'Clock Tower crossing', area: 'Market Square', x: 44, y: 62 },
  { address: 'Cedar Park playground entrance', area: 'Cedar Park', x: 76, y: 69 },
  { address: 'Willow Avenue, Cedar Park', area: 'Cedar Park', x: 72, y: 72 },
  { address: 'Old Quarter curb ramp', area: 'Old Quarter', x: 32, y: 70 },
  { address: 'Lantern Street, Old Quarter', area: 'Old Quarter', x: 30, y: 73 }
];
const state = { view: 'report', allReports: [], reports: [], selectedReference: '', insights: null, imageData: '', pin: null, trackingReference: '', deviceCoordinates: null, locationSource: 'area' };
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers }
  });
  let payload;
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload;
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  $('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}

function resetReportForm() {
  const form = $('#report-form');
  form.reset();
  form.hidden = false;
  $('#submission-success').hidden = true;
  $('#form-error').hidden = true;
  $('#description-count').textContent = '0 / 1,000';
  $('#image-name').textContent = '';
  $('#pin-picker').hidden = true;
  $('#pin-marker').hidden = true;
  $('#pin-coords').textContent = 'No pin placed';
  $('#pin-x').value = '';
  $('#pin-y').value = '';
  $('#toggle-pin').setAttribute('aria-expanded', 'false');
  $('#toggle-pin').querySelector('span').textContent = 'Drop a pin';
  $('#location-search-note').textContent = 'Sample Bellwether addresses only; no live geocoder.';
  const deviceArea = [...$('#area').options].find((option) => option.value === 'Device location (prototype)');
  deviceArea?.remove();
  state.pin = null;
  state.deviceCoordinates = null;
  state.locationSource = 'area';
  updateLocationPreview();
}

function setView(name) {
  if (name === 'report' && $('#report-form').hidden) resetReportForm();
  state.view = name;
  $('#help-launcher').hidden = name === 'dashboard';
  $$('.view').forEach((view) => {
    const active = view.id === `view-${name}`;
    view.hidden = !active;
    view.classList.toggle('is-visible', active);
  });
  $$('.nav-link').forEach((link) => {
    const active = link.dataset.nav === name;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (name === 'dashboard') loadDashboard();
  if (name === 'track' && state.trackingReference) lookupReport(state.trackingReference);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatDate(value, options = { month: 'short', day: 'numeric' }) {
  if (!value) return 'Recently';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Recently' : new Intl.DateTimeFormat(undefined, options).format(date);
}

function priorityClass(priority = '') { return priority.toLowerCase().replace(/\s+/g, '-'); }
function statusClass(status = '') { return status.toLowerCase().replace(/\s+/g, '-'); }
function statusText(status = '') { return status === 'In progress' ? 'In progress' : status; }

function reportQuery() {
  const params = new URLSearchParams();
  const filters = [
    ['category', $('#filter-category').value],
    ['priority', $('#filter-priority').value],
    ['status', $('#filter-status').value],
    ['date', $('#filter-date').value]
  ];
  filters.forEach(([key, value]) => { if (value && value !== 'All' && value !== 'all') params.set(key, value); });
  return params.toString();
}

async function loadDashboard() {
  const list = $('#report-list');
  list.innerHTML = '<div class="queue-empty">Loading reports…</div>';
  try {
    const query = reportQuery();
    const [allResult, filteredResult, insights] = await Promise.all([
      api('/reports'), api(`/reports${query ? `?${query}` : ''}`), api('/insights')
    ]);
    state.allReports = allResult.reports || [];
    state.reports = filteredResult.reports || [];
    state.insights = insights;
    $('#nav-count').textContent = String(state.allReports.length);
    renderMetrics(state.allReports);
    renderQueue(state.reports);
    renderMap(state.reports);
    renderInsights(insights);
    renderTopPriority(state.allReports);
    const selected = state.reports.find((report) => report.reference === state.selectedReference);
    if (selected) renderDetail(selected);
    else if (!state.reports.length) clearDetail();
    else if (state.selectedReference && !state.reports.some((report) => report.reference === state.selectedReference)) clearDetail();
  } catch (error) {
    list.innerHTML = `<div class="queue-empty">${escapeHTML(error.message)}<br><button class="text-action" id="retry-dashboard" type="button">Try again</button></div>`;
    $('#retry-dashboard')?.addEventListener('click', loadDashboard);
    showToast('Could not load operations data.', true);
  }
}

function renderMetrics(reports) {
  const active = reports.filter((report) => report.status !== 'Resolved');
  const high = active.filter((report) => ['Critical', 'High'].includes(report.priority));
  const resolved = reports.filter((report) => report.status === 'Resolved');
  const items = [
    { label: 'Total reports', value: reports.length, detail: 'Across Bellwether', icon: 'signal' },
    { label: 'Open reports', value: active.length, detail: 'Not yet resolved', icon: 'clock' },
    { label: 'High risk', value: high.length, detail: 'Critical and high priority', icon: 'alert', alert: true },
    { label: 'Resolved', value: resolved.length, detail: 'Marked complete', icon: 'check' }
  ];
  $('#metric-strip').innerHTML = items.map((item) => `<div class="metric${item.alert ? ' metric-alert' : ''}"><div><div class="metric-label">${item.label}</div><div class="metric-value">${item.value}</div><div class="metric-detail">${item.detail}</div></div><span class="metric-accent">${icon(item.icon)}</span></div>`).join('');
}

function renderQueue(reports) {
  $('#queue-count').textContent = String(reports.length);
  $('#map-result-count').textContent = `${reports.length} ${reports.length === 1 ? 'report' : 'reports'} shown`;
  if (!reports.length) {
    $('#report-list').innerHTML = `<div class="no-results">${icon('search')}<strong>No reports match those filters</strong><span>Try a different category, priority, status, or date.</span></div>`;
    return;
  }
  $('#report-list').innerHTML = reports.map((report) => `
    <button class="report-row${report.reference === state.selectedReference ? ' is-selected' : ''}" data-reference="${escapeHTML(report.reference)}" type="button" aria-label="Review ${escapeHTML(report.reference)}, ${escapeHTML(report.priority)} priority, ${escapeHTML(report.summary)}">
      <span class="row-priority ${priorityClass(report.priority)}"></span>
      <span class="report-row-main"><span class="row-topline"><span class="row-ref">${escapeHTML(report.reference)}</span><span class="priority-pill ${priorityClass(report.priority)}">${escapeHTML(report.priority)}</span></span><span class="row-title">${escapeHTML(report.summary)}</span><span class="row-meta"><span>${escapeHTML(report.category)}</span><span>·</span><span>${escapeHTML(report.location.area)}</span><span class="row-status">${escapeHTML(statusText(report.status))}</span></span></span>
      <span class="row-arrow">${icon('chevron')}</span>
    </button>`).join('');
  $$('.report-row', $('#report-list')).forEach((button) => button.addEventListener('click', () => selectReport(button.dataset.reference)));
}

function clusterReports(reports) {
  const remaining = new Set(reports);
  const clusters = [];
  while (remaining.size) {
    const seed = remaining.values().next().value;
    remaining.delete(seed);
    const members = [seed];
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const candidate of [...remaining]) {
        if (members.some((item) => Math.hypot(Number(item.location.x) - Number(candidate.location.x), Number(item.location.y) - Number(candidate.location.y)) < 9)) {
          members.push(candidate);
          remaining.delete(candidate);
          expanded = true;
        }
      }
    }
    clusters.push(members);
  }
  return clusters;
}

function renderMap(reports) {
  const markerRoot = $('#map-markers');
  if (!reports.length) { markerRoot.innerHTML = ''; return; }
  const clusters = clusterReports(reports);
  markerRoot.innerHTML = clusters.map((members) => {
    const x = members.reduce((sum, report) => sum + Number(report.location.x), 0) / members.length;
    const y = members.reduce((sum, report) => sum + Number(report.location.y), 0) / members.length;
    const top = members.slice().sort((a, b) => b.priorityScore - a.priorityScore)[0];
    const selected = members.some((report) => report.reference === state.selectedReference);
    const kind = members.length > 1 ? 'cluster-marker' : priorityClass(top.priority);
    const label = members.length > 1 ? String(members.length) : '•';
    return `<button type="button" class="map-marker ${kind}${selected ? ' is-selected' : ''}" style="left:${x}%;top:${y}%" data-reference="${escapeHTML(top.reference)}" aria-label="${members.length} report${members.length === 1 ? '' : 's'} near ${escapeHTML(top.location.area)}; highest priority ${escapeHTML(top.priority)}">${label}</button>`;
  }).join('');
  $$('.map-marker', markerRoot).forEach((button) => button.addEventListener('click', () => selectReport(button.dataset.reference)));
}

function renderInsights(insights) {
  const lead = insights.lead;
  $('#insight-headline').textContent = lead ? `${lead.area} is the strongest service hotspot` : 'No recurring issue is taking shape';
  $('#insight-copy').textContent = lead
    ? `${lead.count} reports are grouped in ${lead.area}; ${lead.openCount} remain open and ${lead.urgentCount} are high-risk. ${lead.topCategory} appears most often. These are nearby reports, not a confirmed cause. Recommended action: ${insights.brief}`
    : 'As reports arrive, nearby issues will be grouped into patterns for staff review.';
  $('#hotspot-list').innerHTML = (insights.hotspots || []).slice(0, 4).map((spot) => `<span class="hotspot-chip"><i class="hotspot-dot"></i><strong>${spot.count}</strong> ${escapeHTML(spot.area)}<span>· ${spot.openCount} open</span></span>`).join('');
}

function renderTopPriority(reports) {
  const report = reports.filter((item) => item.status !== 'Resolved').sort((a, b) => b.priorityScore - a.priorityScore)[0];
  if (!report) {
    $('#top-priority').textContent = 'CLEAR';
    $('#top-report-title').textContent = 'No open reports';
    $('#top-report-reason').textContent = 'Every current report is marked resolved.';
    $('#review-top').disabled = true;
    return;
  }
  $('#top-priority').textContent = report.priority.toUpperCase();
  $('#top-priority').className = `priority-pill ${priorityClass(report.priority)}`;
  $('#top-report-title').textContent = report.summary;
  $('#top-report-reason').textContent = `${report.analysis.explanation} ${report.reference} ranks first because safety and urgency combine with nearby reports.`;
  $('#review-top').disabled = false;
  $('#review-top').onclick = () => selectReport(report.reference);
}

function clearDetail() {
  state.selectedReference = '';
  $('.detail-empty').hidden = false;
  $('#detail-content').hidden = true;
  $('#detail-content').innerHTML = '';
  $('.detail-empty h2').textContent = state.reports.length ? 'Choose a report to review' : 'No reports to review';
  $('.detail-empty p:last-child').textContent = state.reports.length ? 'Select an item from the queue or map to assign an owner, add an internal note, or update its status.' : 'Change the filters to see reports in the queue.';
}

async function selectReport(reference) {
  state.selectedReference = reference;
  const report = state.reports.find((item) => item.reference === reference) || state.allReports.find((item) => item.reference === reference);
  if (report) renderDetail(report);
  renderQueue(state.reports);
  renderMap(state.reports);
  $('#detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderDetail(report) {
  $('.detail-empty').hidden = true;
  const content = $('#detail-content');
  content.hidden = false;
  const duplicates = report.analysis.duplicateMatches || [];
  const teamOptions = ['', 'Roads team', 'Public works', 'Utilities', 'Street lighting', 'Waste services', 'Drainage team'];
  const currentAssignee = report.assignee || '';
  const assigneeOption = teamOptions.includes(currentAssignee) ? '' : `<option selected value="${escapeHTML(currentAssignee)}">${escapeHTML(currentAssignee)}</option>`;
  content.innerHTML = `
    <div class="detail-content-head"><div><p class="section-kicker">${escapeHTML(report.reference)} · ${escapeHTML(report.category)} · ${escapeHTML(report.location.area)}</p><h2>${escapeHTML(report.summary)}</h2><p>${escapeHTML(report.location.address)} · Reported ${formatDate(report.createdAt)}</p></div><span class="priority-pill ${priorityClass(report.priority)}">${escapeHTML(report.priority)} priority</span></div>
    <div class="detail-grid"><div><div class="analysis-card"><div class="analysis-title"><span>ANALYSIS EXPLANATION · SIMULATED</span>${icon('spark')}</div><p><strong>Suggested category: ${escapeHTML(report.analysis.category)}</strong><br>${escapeHTML(report.analysis.explanation)}</p><div class="factor-grid"><div class="factor"><span>Urgency</span><strong>${report.analysis.urgency}/4</strong></div><div class="factor"><span>Safety risk</span><strong>${report.analysis.safetyRisk}/4</strong></div><div class="factor"><span>Nearby reports</span><strong>${report.analysis.relatedCount}</strong></div><div class="factor"><span>Potential reach</span><strong>${report.analysis.impact} reports</strong></div></div></div><div class="duplicates"><strong>Related report matches (${duplicates.length})</strong><div class="duplicate-list">${duplicates.length ? duplicates.map((match) => `<span class="duplicate-tag">${escapeHTML(match.reference)} · ${escapeHTML(match.area)}</span>`).join('') : '<span class="duplicate-tag">No close matches found</span>'}</div></div></div>
    <div class="staff-controls"><div class="staff-control-row"><label>Owner / team<select id="staff-assignee">${assigneeOption}${teamOptions.map((team) => `<option value="${escapeHTML(team)}"${team === currentAssignee ? ' selected' : ''}>${team || 'Unassigned'}</option>`).join('')}</select></label><label>Workflow status<select id="staff-status">${WORKFLOW.map((status) => `<option${status === report.status ? ' selected' : ''}>${status}</option>`).join('')}</select></label></div><label>Internal note · staff only<textarea id="staff-note" maxlength="500" placeholder="Short context for the service team">${escapeHTML(report.internalNote || '')}</textarea></label><button class="button button-dark button-small staff-save" id="save-staff" type="button">Save changes ${icon('check')}</button></div></div>
    <div class="workflow-strip" aria-label="Report workflow">${WORKFLOW.map((status, index) => { const current = WORKFLOW.indexOf(report.status); const done = index < current; return `<span class="workflow-step${done ? ' is-done' : ''}${index === current ? ' is-current' : ''}"><i class="workflow-dot">${done ? '✓' : index + 1}</i>${status}</span>`; }).join('')}</div>`;
  $('#save-staff').addEventListener('click', () => saveStaffUpdate(report.reference));
}

async function saveStaffUpdate(reference) {
  const assignee = $('#staff-assignee').value;
  const status = $('#staff-status').value;
  if (['Assigned', 'In progress', 'Resolved'].includes(status) && !assignee) {
    showToast('Assign an owner or team before moving this report to that stage.', true);
    $('#staff-assignee').focus();
    return;
  }
  const button = $('#save-staff');
  button.disabled = true;
  button.textContent = 'Saving…';
  try {
    const result = await api(`/reports/${encodeURIComponent(reference)}`, {
      method: 'PATCH',
      body: JSON.stringify({ assignee, internalNote: $('#staff-note').value, status })
    });
    state.selectedReference = reference;
    await loadDashboard();
    showToast(`${result.report.reference} updated. Citizen tracking is refreshed.`);
  } catch (error) {
    button.disabled = false;
    button.innerHTML = `Save changes ${icon('check')}`;
    showToast(error.message, true);
  }
}

function updateLocationPreview() {
  const area = $('#area').value || 'Neighborhood not set';
  const address = $('#address').value.trim() || 'Address not entered';
  const point = state.pin || areaCoordinates(area);
  $('#location-preview-title').textContent = `${address} · ${area}`;
  const mapPoint = `Approximate prototype-map pin ${point.x}, ${point.y}.`;
  $('#location-preview-detail').textContent = state.deviceCoordinates
    ? `Device coordinates ${state.deviceCoordinates.latitude.toFixed(4)}, ${state.deviceCoordinates.longitude.toFixed(4)} saved locally. ${mapPoint} This schematic map is not a real-world placement.`
    : `${mapPoint} Confirm or adjust the pin before sending.`;
}

function setPin(x, y, source = 'pin') {
  if (source === 'address' || source === 'area') state.deviceCoordinates = null;
  state.locationSource = source;
  state.pin = { x: Math.round(x), y: Math.round(y) };
  $('#pin-x').value = state.pin.x;
  $('#pin-y').value = state.pin.y;
  $('#pin-coords').textContent = state.deviceCoordinates
    ? `Approx. pin ${state.pin.x}, ${state.pin.y} · ${state.deviceCoordinates.latitude.toFixed(4)}, ${state.deviceCoordinates.longitude.toFixed(4)}`
    : `Pin ${state.pin.x}, ${state.pin.y}`;
  const marker = $('#pin-marker');
  marker.hidden = false;
  marker.style.left = `${state.pin.x}%`;
  marker.style.top = `${state.pin.y}%`;
  updateLocationPreview();
}

function areaCoordinates(area) { return AREA_CENTERS[area] || { x: 50, y: 50 }; }

function setupPinPicker() {
  const toggle = $('#toggle-pin');
  const picker = $('#pin-picker');
  const map = $('#mini-map');
  toggle.addEventListener('click', () => {
    const open = picker.hidden;
    picker.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.querySelector('span').textContent = open ? 'Hide map' : 'Show map pin';
    if (open && state.pin) {
      const source = state.deviceCoordinates ? 'device' : state.locationSource;
      setPin(state.pin.x, state.pin.y, source);
    }
  });
  map.addEventListener('click', (event) => {
    if (event.target.closest('#pin-marker')) return;
    const bounds = map.getBoundingClientRect();
    setPin(((event.clientX - bounds.left) / bounds.width) * 100, ((event.clientY - bounds.top) / bounds.height) * 100, 'pin');
  });
  map.addEventListener('keydown', (event) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const point = state.pin || { x: 50, y: 50 };
    const step = event.shiftKey ? 10 : 3;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    setPin(Math.max(2, Math.min(98, point.x + dx)), Math.max(2, Math.min(98, point.y + dy)), 'pin');
  });
}

function openPinPicker() {
  const picker = $('#pin-picker');
  picker.hidden = false;
  $('#toggle-pin').setAttribute('aria-expanded', 'true');
  $('#toggle-pin').querySelector('span').textContent = 'Hide map';
}

function resolveAddress() {
  const address = $('#address').value.trim();
  if (!address) {
    updateLocationPreview();
    return;
  }
  const match = SAMPLE_LOCATIONS.find((location) => location.address.toLowerCase() === address.toLowerCase());
  if (match) {
    $('#area').value = match.area;
    $('#location-search-note').textContent = 'Sample Bellwether match selected. The map pin is approximate.';
    setPin(match.x, match.y, 'address');
  } else {
    const point = state.pin || areaCoordinates($('#area').value);
    $('#location-search-note').textContent = 'No sample address match. This text is kept as entered; the pin is approximate and can be moved.';
    setPin(point.x, point.y, 'address');
  }
  openPinPicker();
}

function requestDeviceLocation() {
  const button = $('#use-current-location');
  const note = $('#location-search-note');
  if (!navigator.geolocation) {
    note.textContent = 'This browser does not provide device location. Search a sample address or place a pin instead.';
    return;
  }
  button.disabled = true;
  button.querySelector('span').textContent = 'Requesting permission…';
  note.textContent = 'Waiting for browser location permission…';
  navigator.geolocation.getCurrentPosition((position) => {
    const latitude = Number(position.coords.latitude.toFixed(4));
    const longitude = Number(position.coords.longitude.toFixed(4));
    state.deviceCoordinates = { latitude, longitude };
    state.locationSource = 'device';
    const area = $('#area').value || 'Device location (prototype)';
    if (![...$('#area').options].some((option) => option.value === area)) $('#area').add(new Option(area, area));
    $('#area').value = area;
    $('#address').value = 'Current location';
    $('#location-search-note').textContent = 'Browser coordinates are stored in this local prototype. The map pin is only an approximate sample-map position.';
    openPinPicker();
    const point = areaCoordinates(area);
    setPin(point.x, point.y, 'device');
    button.disabled = false;
    button.querySelector('span').textContent = 'Update my location';
  }, (error) => {
    const messages = {
      1: 'Location permission was not granted. You can search an address or place a pin instead.',
      2: 'Your device could not determine a location. Search an address or place a pin instead.',
      3: 'The location request timed out. Try again or place a pin instead.'
    };
    note.textContent = messages[error.code] || 'Could not get your location. Search an address or place a pin instead.';
    button.disabled = false;
    button.querySelector('span').textContent = 'Use my location';
  }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
}

async function submitReport(event) {
  event.preventDefault();
  const form = $('#report-form');
  const errorBox = $('#form-error');
  errorBox.hidden = true;
  const category = $('#category').value;
  const area = $('#area').value;
  const description = $('#description').value.trim();
  const address = $('#address').value.trim();
  if (!category || !area || description.length < 12) {
    errorBox.textContent = 'Choose an issue type and neighborhood, then add at least 12 characters describing the issue.';
    errorBox.hidden = false;
    (!category ? $('#category') : !area ? $('#area') : $('#description')).focus();
    return;
  }
  const imageInput = $('#image');
  const button = $('#submit-report');
  button.disabled = true;
  button.querySelector('span').textContent = 'Sending report…';
  try {
    let imageData = '';
    if (imageInput.files[0]) imageData = await fileToDataURL(imageInput.files[0]);
    const point = state.pin || areaCoordinates(area);
    const location = { area, address: address || area, x: point.x, y: point.y };
    if (state.deviceCoordinates) Object.assign(location, state.deviceCoordinates);
    const payload = { category, description, location, imageData };
    const result = await api('/reports', { method: 'POST', body: JSON.stringify(payload) });
    const report = result.report;
    renderSubmissionSuccess(report);
    form.hidden = true;
    state.trackingReference = report.reference;
    state.allReports = [];
    $('#nav-count').textContent = '…';
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
    errorBox.focus?.();
  } finally {
    button.disabled = false;
    button.querySelector('span').textContent = 'Send report';
  }
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return reject(new Error('Choose a PNG, JPEG, or WebP image.'));
    if (file.size > 2 * 1024 * 1024) return reject(new Error('Choose an image smaller than 2 MB.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image. Try another file.'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function renderSubmissionSuccess(report) {
  const success = $('#submission-success');
  const matches = report.analysis.duplicateMatches || [];
  success.innerHTML = `<div class="success-head">${icon('check')}<div><h3>Your report is in the queue.</h3><p>${escapeHTML(report.analysis.summary)}</p><p><strong>Simulated category:</strong> ${escapeHTML(report.analysis.category)} · <strong>${escapeHTML(report.priority)} priority</strong></p><p>${escapeHTML(report.analysis.explanation)} ${matches.length ? `We found ${matches.length} nearby related report${matches.length === 1 ? '' : 's'} for the team to review.` : 'No close duplicate matches were found.'}</p></div></div><span class="success-ref">${escapeHTML(report.reference)}</span><div class="success-actions"><button type="button" id="track-new-report">Track this report</button><button type="button" id="dashboard-new-report">See operations view</button><button type="button" id="another-report">Report another issue</button></div>`;
  success.hidden = false;
  $('#track-new-report').addEventListener('click', () => { $('#track-reference').value = report.reference; setView('track'); });
  $('#dashboard-new-report').addEventListener('click', () => { setView('dashboard'); });
  $('#another-report').addEventListener('click', () => { resetReportForm(); $('#category').focus(); });
  success.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function lookupReport(reference) {
  const cleaned = reference.trim().toUpperCase();
  if (!cleaned) return;
  state.trackingReference = cleaned;
  $('#track-reference').value = cleaned;
  const error = $('#track-error');
  const result = $('#tracking-result');
  error.hidden = true;
  result.innerHTML = '<p class="queue-empty" role="status">Checking that reference…</p>';
  result.hidden = false;
  try {
    const response = await api(`/track/${encodeURIComponent(cleaned)}`);
    renderTracking(response.report);
  } catch (err) {
    result.hidden = true;
    result.innerHTML = '';
    error.textContent = err.message;
    error.hidden = false;
  }
}

function renderTracking(report) {
  const result = $('#tracking-result');
  const updates = [...(report.updates || [])].sort((a, b) => new Date(b.at) - new Date(a.at));
  const badgeClass = statusClass(report.status);
  result.innerHTML = `<article class="tracking-card"><header class="tracking-card-head"><div><span class="tracking-ref">${escapeHTML(report.reference)} · ${escapeHTML(report.category)}</span><h2>${escapeHTML(report.summary)}</h2><p>Reported ${formatDate(report.createdAt, { month: 'long', day: 'numeric', year: 'numeric' })} · ${escapeHTML(report.location.area)}</p></div><span class="tracking-badge ${badgeClass}">${escapeHTML(report.status)}</span></header><div class="tracking-body"><div class="tracking-summary"><p class="section-kicker">LATEST UPDATE</p><p>${escapeHTML(updates[0]?.message || 'Your report has been received and is in the review queue.')}</p><span class="tracking-location">${icon('pin')}${escapeHTML(report.location.address)}</span></div><div class="tracking-timeline" aria-label="Progress history">${updates.map((update) => `<div class="timeline-item"><span class="timeline-marker"></span><div><strong>${escapeHTML(update.status)}</strong><time datetime="${escapeHTML(update.at)}">${formatDate(update.at, { month: 'short', day: 'numeric', year: 'numeric' })}</time><p>${escapeHTML(update.message)}</p></div></div>`).join('')}</div></div></article>`;
  result.hidden = false;
}

function showHelpAnswer(question) {
  const answers = {
    report: {
      title: 'Reporting a local issue',
      text: 'Choose an issue type and neighborhood, describe what is happening, and confirm the address or approximate map pin. A photo is optional. This assistant does not submit the report for you.',
      action: 'Go to reporting',
      view: 'report'
    },
    details: {
      title: 'What to include',
      text: 'Add a clear landmark, what you observed, and any immediate safety or access impact. Leave out names and sensitive personal information. A photo can help but is not required.',
      action: 'Open the report form',
      view: 'report'
    },
    track: {
      title: 'Finding a report update',
      text: 'Use the reference number shown in your submission confirmation on the tracking page. The page reads the saved status history; this help chat does not have live updates.',
      action: 'Go to report tracking',
      view: 'track'
    }
  };
  const answer = answers[question];
  if (!answer) return;
  $('#help-answer').innerHTML = `<h3>${escapeHTML(answer.title)}</h3><p>${escapeHTML(answer.text)}</p><button class="help-answer-action" type="button" data-help-nav="${answer.view}">${escapeHTML(answer.action)} ${icon('arrow')}</button>`;
  $('#help-answer').hidden = false;
}

function setupHelp() {
  const dialog = $('#help-dialog');
  let restoreLauncherFocus = true;
  $('#help-launcher').addEventListener('click', () => dialog.showModal());
  $('#close-help').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
    const navigation = event.target.closest('[data-help-nav]');
    if (!navigation) return;
    const view = navigation.dataset.helpNav;
    restoreLauncherFocus = false;
    dialog.close();
    setView(view);
    if (view === 'track') $('#track-reference').focus();
    if (view === 'report') $('#category').focus();
  });
  dialog.addEventListener('close', () => {
    if (restoreLauncherFocus && !$('#help-launcher').hidden) $('#help-launcher').focus();
    restoreLauncherFocus = true;
  });
  $$('.help-question').forEach((button) => button.addEventListener('click', () => showHelpAnswer(button.dataset.help)));
}

function setupEvents() {
  $$('[data-nav]').forEach((element) => element.addEventListener('click', (event) => {
    event.preventDefault();
    setView(element.dataset.nav);
  }));
  $('#report-form').addEventListener('submit', submitReport);
  $('#area').addEventListener('change', () => {
    const address = $('#address').value.trim();
    const sampleMatch = SAMPLE_LOCATIONS.find((location) => location.address.toLowerCase() === address.toLowerCase());
    if (state.deviceCoordinates || (sampleMatch && sampleMatch.area !== $('#area').value)) $('#address').value = '';
    const point = areaCoordinates($('#area').value);
    $('#location-search-note').textContent = 'Sample Bellwether area selected. Search a local address or adjust the approximate pin.';
    setPin(point.x, point.y, 'area');
    openPinPicker();
  });
  $('#address').addEventListener('input', () => {
    const value = $('#address').value.trim();
    if (state.deviceCoordinates && !value.startsWith('Current location (')) state.deviceCoordinates = null;
    const match = SAMPLE_LOCATIONS.find((location) => location.address.toLowerCase() === value.toLowerCase());
    if (match) {
      $('#area').value = match.area;
      $('#location-search-note').textContent = 'Sample Bellwether match selected. The map pin is approximate.';
      setPin(match.x, match.y, 'address');
      openPinPicker();
    } else updateLocationPreview();
  });
  $('#address').addEventListener('change', resolveAddress);
  $('#use-current-location').addEventListener('click', requestDeviceLocation);
  $('#description').addEventListener('input', () => { $('#description-count').textContent = `${$('#description').value.length} / 1,000`; });
  $('#image').addEventListener('change', (event) => { $('#image-name').textContent = event.target.files[0]?.name || ''; });
  $('#track-form').addEventListener('submit', (event) => { event.preventDefault(); lookupReport($('#track-reference').value); });
  $$('.reference-chip').forEach((button) => button.addEventListener('click', () => lookupReport(button.dataset.reference)));
  ['filter-category', 'filter-priority', 'filter-status', 'filter-date'].forEach((id) => $(`#${id}`).addEventListener('change', loadDashboard));
  $('#reset-filters').addEventListener('click', () => {
    $('#filter-category').value = 'All'; $('#filter-priority').value = 'All'; $('#filter-status').value = 'All'; $('#filter-date').value = 'all';
    loadDashboard();
  });
  setupPinPicker();
  setupHelp();
  updateLocationPreview();
}

setupEvents();
api('/health').catch(() => showToast('The CivicSignal API is not available. Start the server to use the prototype.', true));
loadDashboard();
