/* ============================================================
   APP — routing, state, and screen rendering
   Hash-based router. Single delegated click/change listener.
   ============================================================ */

let currentJob = null; // in-memory working copy of the active job

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.add("hidden"), 2200);
}

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o ? o[k] : undefined), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function persist() {
  if (currentJob) upsertJob(currentJob);
}

/* ---------------- Router ---------------- */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return parts; // e.g. ["job","job_123","inspect"]
}

function navigateTo(hash) {
  location.hash = hash;
}

window.addEventListener("hashchange", render);
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("standardsBtn").onclick = () => navigateTo("/standards");
  document.getElementById("settingsBtn").onclick = () => navigateTo("/settings");
  document.getElementById("signOutBtn").onclick = () => signOut();
  document.getElementById("previewClose").onclick = () => closePreview();
  document.getElementById("backBtn").onclick = () => {
    if (currentJob) navigateTo("/jobs"); else history.back();
  };
  document.getElementById("app").addEventListener("click", onAppClick);
  document.getElementById("app").addEventListener("input", onAppChange);
  document.getElementById("app").addEventListener("change", onAppChange);
  document.getElementById("bottomNav").addEventListener("click", onNavClick);
  if (!location.hash) location.hash = "/jobs";
  initAuth();
});

function onNavClick(e) {
  const btn = e.target.closest(".nav-btn");
  if (!btn || !currentJob) return;
  navigateTo(`/job/${currentJob.id}/${btn.dataset.nav}`);
}

function setChrome(title, showBack, showBottomNav, activeTab) {
  document.getElementById("topTitle").textContent = title;
  document.getElementById("backBtn").classList.toggle("hidden", !showBack);
  document.getElementById("bottomNav").classList.toggle("hidden", !showBottomNav);
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === activeTab));
}

function render() {
  document.getElementById("signOutBtn").classList.toggle("hidden", !currentSession);
  document.getElementById("standardsBtn").classList.toggle("hidden", !currentSession);
  document.getElementById("settingsBtn").classList.toggle("hidden", !currentSession);

  if (!currentSession) { currentJob = null; return renderLoginScreen(); }

  const parts = parseHash();
  window.scrollTo(0, 0);

  if (parts[0] === "settings") { currentJob = null; renderSettingsScreen(); hydrateMedia(); return; }
  if (parts[0] === "standards") { currentJob = null; renderStandardsScreen(); hydrateMedia(); return; }
  if (parts[0] === "jobs" || parts.length === 0) { currentJob = null; renderJobsScreen(); hydrateMedia(); return; }

  if (parts[0] === "job" && parts[1]) {
    const job = getJob(parts[1]);
    if (!job) { navigateTo("/jobs"); return; }
    currentJob = job;
    const tab = parts[2] || "intake";
    if (tab === "intake") renderIntakeScreen();
    else if (tab === "inspect") renderInspectScreen();
    else if (tab === "measurements") renderMeasurementsScreen();
    else if (tab === "notes") renderNotesScreen();
    else if (tab === "review") renderReviewScreen();
    else { navigateTo("/jobs"); return; }
    hydrateMedia();
    return;
  }
  navigateTo("/jobs");
}

async function hydrateMedia() {
  const imgs = document.querySelectorAll('#app img[data-media-path]:not([data-hydrated])');
  for (const img of imgs) {
    img.dataset.hydrated = "1";
    const path = img.dataset.mediaPath;
    const url = await getSignedUrl(path);
    if (url) img.src = url;
  }
}

/* ---------------- Delegated interaction handlers ---------------- */

function onAppChange(e) {
  const el = e.target;
  // File inputs fire BOTH 'input' and 'change' on selection; since this
  // handler is bound to both events, only act on 'change' here or every
  // photo gets uploaded twice.
  if (e.type === "change" && el.matches('input[type="file"][data-photo-target]')) {
    handlePhotoInput(el);
    return;
  }
  if (e.type === "change" && el.matches('input[type="file"][data-logo-target]')) {
    handleLogoInput(el);
    return;
  }
  if (e.type === "change" && el.matches('input[type="file"][data-agreement-template-target]')) {
    handleAgreementTemplateInput(el);
    return;
  }
  if (e.type === "change" && el.matches('input[type="file"][data-frontphoto-target]')) {
    handleFrontPhotoInput(el);
    return;
  }
  if (e.type === "change" && el.matches('input[type="file"][data-csv-target]')) {
    handleCsvImport(el);
    return;
  }
  if (el.dataset.inspectorSelect !== undefined && currentJob) {
    if (el.value === "__new__") {
      const name = prompt("New inspector name:");
      if (name) { currentJob.property.inspectorName = name; persist(); addInspectorIfNew(name); render(); }
      else render();
    } else {
      currentJob.property.inspectorName = el.value; persist();
    }
    return;
  }
  if (el.dataset.orderedBySelect !== undefined && currentJob) {
    if (el.value === "__new__") {
      const name = prompt("New \"Ordered By\" client:");
      if (name) { currentJob.property.orderedBy = name; persist(); addOrderedByIfNew(name); render(); }
      else render();
    } else {
      currentJob.property.orderedBy = el.value; persist();
    }
    return;
  }
  if (el.dataset.areaDesc && currentJob) {
    const area = currentJob.areas.find(a => a.id === el.dataset.pathArea);
    if (area) { area.description = el.value; persist(); }
    return;
  }
  if (el.dataset.path && currentJob) {
    setPath(currentJob, el.dataset.path, el.value);
    persist();
    if (el.dataset.rerender) render();
    return;
  }
  if (el.dataset.findingField && currentJob) {
    const { areaId, findingId, field } = el.dataset;
    const area = currentJob.areas.find(a => a.id === (el.dataset.areaId));
    const finding = area && area.findings.find(f => f.id === el.dataset.findingId);
    if (finding) { finding[field] = el.value; persist(); }
    return;
  }
  if (el.dataset.measureField && currentJob) {
    const m = currentJob.measurements.find(x => x.id === el.dataset.measureId);
    if (m) { m[el.dataset.measureField] = el.value; persist(); if (el.dataset.rerender) render(); }
    return;
  }
}

function onAppClick(e) {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const action = el.dataset.action;
  const handlers = {
    "new-job": () => { const j = newJob(); upsertJob(j); navigateTo(`/job/${j.id}/intake`); },
    "open-job": () => navigateTo(`/job/${el.dataset.id}/intake`),
    "delete-job": () => { if (confirm("Delete this inspection? This cannot be undone.")) { deleteJob(el.dataset.id); render(); } },
    "sign-consent": () => {
      SignaturePad.open(`Consent for Healthy Home Environmental Assessment at ${currentJob.property.address || "this property"}`, async (result) => {
        showToast("Saving signature…");
        try {
          const blob = await (await fetch(result.signatureData)).blob();
          const path = await uploadMedia(currentJob.id, "consent", blob, "png");
          currentJob.consent = { signed: true, signaturePath: path, signedName: result.signedName, signedAt: result.signedAt };
          persist(); render(); showToast("Consent signature saved");
        } catch (e) {
          console.error(e);
          showToast("Couldn't save signature — check your connection");
        }
      });
    },
    "clear-consent": () => {
      const oldPath = currentJob.consent.signaturePath;
      currentJob.consent = { signed: false, signaturePath: "", signedName: "", signedAt: "" };
      persist(); render();
      if (oldPath) deleteMedia(oldPath);
    },
    "add-area": () => openAddAreaFlow(),
    "quick-area": () => { addArea(el.dataset.name, el.dataset.type); },
    "delete-area": () => { if (confirm("Delete this area and all its findings?")) { currentJob.areas = currentJob.areas.filter(a => a.id !== el.dataset.areaId); persist(); render(); } },
    "add-finding": () => { addFinding(el.dataset.areaId, el.dataset.category, el.dataset.principle); },
    "delete-finding": () => { const area = currentJob.areas.find(a => a.id === el.dataset.areaId); area.findings = area.findings.filter(f => f.id !== el.dataset.findingId); persist(); render(); },
    "set-status": () => { setFindingField(el.dataset.areaId, el.dataset.findingId, "status", el.dataset.value); render(); },
    "toggle-chronic": () => { toggleFindingBool(el.dataset.areaId, el.dataset.findingId, "chronic"); render(); },
    "toggle-acute": () => { toggleFindingBool(el.dataset.areaId, el.dataset.findingId, "acute"); render(); },
    "add-reading": () => { addReading(el.dataset.areaId, el.dataset.findingId); render(); },
    "delete-reading": () => { deleteReading(el.dataset.areaId, el.dataset.findingId, el.dataset.readingIdx); render(); },
    "trigger-photo": () => { document.getElementById(`photoInput_${el.dataset.areaId}_${el.dataset.findingId}`).click(); },
    "delete-photo": () => {
      const path = deletePhoto(el.dataset.areaId, el.dataset.findingId, el.dataset.photoIdx);
      render();
      if (path) deleteMedia(path);
    },
    "toggle-yn": () => { setPath(currentJob, el.dataset.path, el.dataset.value); persist(); render(); },
    "add-measurement": () => { addMeasurement(); render(); },
    "delete-measurement": () => { currentJob.measurements = currentJob.measurements.filter(m => m.id !== el.dataset.id); persist(); render(); },
    "set-measure-result": () => { const m = currentJob.measurements.find(x => x.id === el.dataset.id); m.passFail = el.dataset.value; persist(); render(); },
    "download-report": async () => {
      if (!requireConsentWarning()) return;
      showToast("Generating report…");
      try { await downloadReport(currentJob); showToast("Report downloaded"); }
      catch (e) { console.error(e); showToast("Report generation failed — check your connection"); }
    },
    "share-report": async () => {
      if (!requireConsentWarning()) return;
      showToast("Generating report…");
      try { await shareReport(currentJob); }
      catch (e) { console.error(e); showToast("Report generation failed — check your connection"); }
    },
    "toggle-std-expand": () => { el.closest(".std-entry").classList.toggle("expanded"); },
    "preview-report": () => openPreview(),
    "trigger-csv-import": () => document.getElementById("csvImportInput").click(),
    "trigger-frontphoto": () => document.getElementById("frontPhotoInput").click(),
    "toggle-area-collapse": () => {
      const area = currentJob.areas.find(a => a.id === el.dataset.areaId);
      area.collapsed = !area.collapsed;
      persist(); render();
    },
    "ai-clean-finding-notes": async () => {
      const area = currentJob.areas.find(a => a.id === el.dataset.areaId);
      const f = area && area.findings.find(x => x.id === el.dataset.findingId);
      if (!f) return;
      if (!f.notes || !f.notes.trim()) { showToast("Nothing to clean up yet"); return; }
      const btn = el; const original = btn.textContent;
      btn.disabled = true; btn.textContent = "Cleaning up…";
      try {
        const p = principleByKey(f.principle);
        const contextLabel = `${f.category || p.label} finding in a room inspection, current status: ${f.status}`;
        f.notes = await aiCleanText(f.notes, contextLabel);
        persist(); render();
        showToast("Notes cleaned up");
      } catch (e) {
        console.error(e);
        showToast("AI cleanup failed — check your connection");
        btn.disabled = false; btn.textContent = original;
      }
    },
    "ai-clean-field-notes": async () => {
      if (!currentJob.fieldNotes || !currentJob.fieldNotes.trim()) { showToast("Nothing to clean up yet"); return; }
      const btn = el; const original = btn.textContent;
      btn.disabled = true; btn.textContent = "Cleaning up…";
      try {
        currentJob.fieldNotes = await aiCleanText(currentJob.fieldNotes, "Overall field notes and recommendations for a Healthy Home Environmental Assessment report");
        persist(); render();
        showToast("Notes cleaned up");
      } catch (e) {
        console.error(e);
        showToast("AI cleanup failed — check your connection");
        btn.disabled = false; btn.textContent = original;
      }
    },
  };
  if (handlers[action]) handlers[action]();
}

function requireConsentWarning() {
  if (!currentJob.consent.signed) {
    return confirm("No consent signature has been captured yet. Generate the report anyway?");
  }
  return true;
}

/* ---------------- Job mutation helpers ---------------- */

function addArea(name, type) {
  currentJob.areas.push(newArea(name, type));
  persist(); render();
}
function addFinding(areaId, category, principle) {
  const area = currentJob.areas.find(a => a.id === areaId);
  area.findings.push(newFinding(category, principle));
  persist(); render();
}
function setFindingField(areaId, findingId, field, value) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  f[field] = value; persist();
}
function toggleFindingBool(areaId, findingId, field) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  f[field] = !f[field]; persist();
}
function addReading(areaId, findingId) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  f.readings.push({ label: "", value: "", unit: "" });
  persist();
}
function deleteReading(areaId, findingId, idx) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  f.readings.splice(idx, 1); persist();
}
function deletePhoto(areaId, findingId, idx) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  const path = f.photos[idx];
  f.photos.splice(idx, 1); persist();
  return path;
}
function addMeasurement() {
  currentJob.measurements.push({ id: uid("meas"), testType: "", location: "", value: "", unit: "", passFail: "", notes: "" });
  persist();
}

async function handlePhotoInput(input) {
  const { areaId, findingId } = input.dataset;
  const files = Array.from(input.files || []);
  if (!files.length) return;
  const jobId = currentJob.id;
  showToast(files.length > 1 ? "Uploading photos…" : "Uploading photo…");
  for (const file of files) {
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const blob = await compressImageToBlob(dataUrl, 1000, 0.7);
      const path = await uploadMedia(jobId, `finding_${findingId}`, blob, "jpg");
      const area = currentJob.areas.find(a => a.id === areaId);
      const f = area && area.findings.find(x => x.id === findingId);
      if (f) { f.photos.push(path); persist(); }
    } catch (e) {
      console.error(e);
      showToast("Photo upload failed — check your connection");
    }
  }
  input.value = "";
  render();
}

function compressImageToBlob(dataUrl, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height *= maxDim / width; width = maxDim; }
      else if (height > maxDim) { width *= maxDim / height; height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("compression failed")), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function openAddAreaFlow() {
  const name = prompt("Area name (e.g. Master Bedroom, Kitchen, HVAC System):");
  if (!name) return;
  const type = prompt("Area type: room, mechanical, appliance, or exterior", "room");
  addArea(name, (type || "room").toLowerCase());
}

/* ================================================================
   SCREENS
   ================================================================ */

function renderJobsScreen() {
  setChrome("In Touch Reno", false, false);
  const jobs = loadJobs().sort((a, b) => b.updatedAt - a.updatedAt);
  const app = document.getElementById("app");

  const list = jobs.map(j => {
    const s = computeJobScore(j);
    const pillColor = s.score >= 80 ? "ok" : s.score >= 50 ? "concern" : "action";
    return `
      <div class="card tappable job-card" data-action="open-job" data-id="${j.id}" role="button" tabindex="0">
        <div class="card-row">
          <div class="addr">${j.property.address || "Untitled property"}</div>
          <div class="row gap" style="flex-shrink:0">
            <span class="job-score-pill" style="background:var(--${pillColor}-bg); color:var(--${pillColor})">${s.score}</span>
            <button class="icon-btn" style="color:var(--action); width:auto; padding:2px 6px; font-size:15px" data-action="delete-job" data-id="${j.id}" aria-label="Delete inspection">🗑</button>
          </div>
        </div>
        <div class="meta">${j.property.clientName || "No client name"} · ${fmtDate(j.property.visitDate)}</div>
        <div class="row gap wrap" style="margin-top:4px">
          <span class="small muted">${j.areas.length} area${j.areas.length === 1 ? "" : "s"}</span>
          <span class="small muted">·</span>
          <span class="small muted">${s.chronic} chronic, ${s.acute} acute</span>
        </div>
      </div>`;
  }).join("");

  app.innerHTML = `
    <div class="screen-header">
      <h1>Inspections</h1>
      <p>Your healthy home assessment jobs, synced to your account.</p>
    </div>
    ${jobs.length ? list : `
      <div class="empty-state">
        <div class="big">⌂</div>
        <p>No inspections yet.<br>Tap + to start your first job.</p>
      </div>`}
    <button class="btn ghost block" data-action="trigger-csv-import" style="margin-top:14px">⇪ Import Properties (CSV)</button>
    <input type="file" accept=".csv" class="hidden" id="csvImportInput" data-csv-target="1">
    <button class="fab" data-action="new-job" aria-label="New inspection">+</button>
  `;
}

async function renderIntakeScreen() {
  const job = currentJob;
  setChrome(job.property.address || "New Inspection", true, true, "intake");
  const p = job.property, iv = job.interview;
  const settings = await loadSettings();
  if (currentJob !== job) return; // navigated away while settings loaded

  function ynRow(label, path) {
    const val = getPath(job, path);
    return `
      <div class="checklist-item">
        <div class="flex1">${label}</div>
        <div class="yn">
          <button class="yn-btn y ${val === "Yes" ? "selected" : ""}" data-action="toggle-yn" data-path="${path}" data-value="Yes">Yes</button>
          <button class="yn-btn n ${val === "No" ? "selected" : ""}" data-action="toggle-yn" data-path="${path}" data-value="No">No</button>
        </div>
      </div>`;
  }

  function dropdownWithAdd(list, current, dataAttr) {
    const opts = (list || []).map(n => `<option ${current === n ? "selected" : ""}>${n}</option>`).join("");
    const customOpt = current && !(list || []).includes(current) ? `<option selected>${current}</option>` : "";
    return `
      <select class="input" ${dataAttr}="1">
        <option value="" ${!current ? "selected" : ""}>— Select —</option>
        ${customOpt}${opts}
        <option value="__new__">+ Add new…</option>
      </select>`;
  }

  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Intake</h1><p>Property info, resident interview, and signed consent.</p></div>

    <div class="section-title">Property</div>
    <div class="card">
      <div class="field"><label>Client Name</label><input class="input" data-path="property.clientName" value="${p.clientName}"></div>
      <div class="grid2">
        <div class="field"><label>Phone</label><input class="input" data-path="property.clientPhone" value="${p.clientPhone}"></div>
        <div class="field"><label>Email</label><input class="input" data-path="property.clientEmail" value="${p.clientEmail}"></div>
      </div>
      <div class="field"><label>Address</label><input class="input" data-path="property.address" value="${p.address}"></div>
      <div class="grid3">
        <div class="field"><label>City</label><input class="input" data-path="property.city" value="${p.city}"></div>
        <div class="field"><label>State</label><input class="input" data-path="property.state" value="${p.state}"></div>
        <div class="field"><label>Zip</label><input class="input" data-path="property.zip" value="${p.zip}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Inspector</label>${dropdownWithAdd(settings.inspectors, p.inspectorName, "data-inspector-select")}</div>
        <div class="field"><label>Ordered By</label>${dropdownWithAdd(settings.ordered_by_list, p.orderedBy, "data-ordered-by-select")}</div>
      </div>
      <div class="grid2">
        <div class="field"><label>Visit Date</label><input class="input" type="date" data-path="property.visitDate" value="${p.visitDate}"></div>
        <div class="field"><label>Year Built <span class="muted" style="text-transform:none; font-weight:400;">(no reliable auto-lookup — enter manually or via CSV import)</span></label><input class="input" data-path="property.yearBuilt" value="${p.yearBuilt}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Dwelling Type</label>
          <select class="input" data-path="property.dwellingType">
            ${["", "Detached single family", "Duplex/Triplex", "Multifamily 1-4 floors", "Multifamily 5+ floors", "Mobile home / trailer"]
              .map(o => `<option ${p.dwellingType === o ? "selected" : ""}>${o}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>Stories</label><input class="input" data-path="property.stories" value="${p.stories}"></div>
      </div>
      <div class="field"><label>Weather at Visit</label><input class="input" data-path="property.weather" value="${p.weather}"></div>
      <div class="field">
        <label>Front of Home Photo</label>
        ${p.frontPhotoPath ? `<img data-media-path="${p.frontPhotoPath}" style="width:100%; max-width:320px; border-radius:8px; border:1px solid var(--line); display:block; margin-bottom:8px;">` : ""}
        <button class="btn ghost" data-action="trigger-frontphoto">${p.frontPhotoPath ? "Replace Photo" : "Add Photo"}</button>
        <input type="file" accept="image/*" capture="environment" class="hidden" id="frontPhotoInput" data-frontphoto-target="1">
      </div>
    </div>

    <div class="section-title">Resident Interview</div>
    <div class="card">
      <div class="field"><label>Water Source</label>
        <select class="input" data-path="interview.waterSource">
          ${["", "Public Water Supply", "Well - drilled", "Well - dug", "Well - driven", "Spring"]
            .map(o => `<option ${iv.waterSource === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>If private source, when last tested</label><input class="input" data-path="interview.waterTested" value="${iv.waterTested}"></div>
      ${ynRow("Pest control used in last 12 months", "interview.pestControl12mo")}
      ${ynRow("Humidifier used in last 12 months", "interview.humidifierUse")}
      ${ynRow("Dehumidifier used in last 12 months", "interview.dehumidifierUse")}
      ${ynRow("Condensation noticed on windows/surfaces", "interview.condensationNoticed")}
      ${ynRow("Smoking allowed in home", "interview.smokingInHome")}
      ${ynRow("Supplemental combustion equipment (space heaters, generators)", "interview.combustionEquipment")}
      ${ynRow("Fire extinguisher in home", "interview.fireExtinguisher")}
      ${ynRow("Children often in home", "interview.childrenInHome")}
      <div class="field" style="margin-top:10px"><label>Pets in home (number/type)</label><input class="input" data-path="interview.petsInHome" value="${iv.petsInHome}"></div>
      <div class="field"><label>Home age / major renovations</label><textarea class="input" data-path="interview.homeAgeRenovations">${iv.homeAgeRenovations}</textarea></div>
      <div class="field"><label>Resident's primary concerns</label><textarea class="input" data-path="interview.primaryConcerns">${iv.primaryConcerns}</textarea></div>
    </div>

    <div class="section-title">Client Consent</div>
    <div class="card">
      ${job.consent.signed ? `
        <p class="small">Signed by <strong>${job.consent.signedName}</strong> on ${new Date(job.consent.signedAt).toLocaleString()}</p>
        <img data-media-path="${job.consent.signaturePath}" style="max-width:220px; min-height:60px; border:1px solid var(--line); border-radius:8px; background:#fff; display:block; margin-bottom:10px">
        <button class="btn ghost" data-action="clear-consent">Clear & Re-sign</button>
      ` : `
        <p class="small muted">Capture the client's signature acknowledging the assessment terms before beginning the inspection.</p>
        <button class="btn gold block" data-action="sign-consent">Sign Consent</button>
      `}
    </div>
  `;
  hydrateMedia();
}

function areaFindingsForCategory(area, categoryKey) {
  return area.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.category === categoryKey);
}

function renderFindingCard(area, f) {
  const p = principleByKey(f.principle);
  return `
    <div class="finding-item">
      <div class="finding-head">
        <span class="chip" style="background:${p.color}"><span class="dot"></span>${p.label}</span>
        <button class="icon-btn" style="color:var(--action); width:auto; padding:0 6px" data-action="delete-finding" data-area-id="${area.id}" data-finding-id="${f.id}">Remove</button>
      </div>
      <div class="seg">
        <button class="on-ok ${f.status === "ok" ? "selected" : ""}" data-action="set-status" data-area-id="${area.id}" data-finding-id="${f.id}" data-value="ok">OK</button>
        <button class="on-concern ${f.status === "concern" ? "selected" : ""}" data-action="set-status" data-area-id="${area.id}" data-finding-id="${f.id}" data-value="concern">Concern</button>
        <button class="on-action ${f.status === "action" ? "selected" : ""}" data-action="set-status" data-area-id="${area.id}" data-finding-id="${f.id}" data-value="action">Action Needed</button>
      </div>
      <div class="hazard-tags">
        <button class="tag-toggle on-chronic ${f.chronic ? "selected" : ""}" data-action="toggle-chronic" data-area-id="${area.id}" data-finding-id="${f.id}">Chronic hazard</button>
        <button class="tag-toggle on-acute ${f.acute ? "selected" : ""}" data-action="toggle-acute" data-area-id="${area.id}" data-finding-id="${f.id}">Acute hazard</button>
      </div>
      <div class="field" style="margin-top:10px">
        <label>Notes</label>
        <textarea class="input" data-finding-field="1" data-area-id="${area.id}" data-finding-id="${f.id}" data-field="notes">${f.notes}</textarea>
        <button class="btn ghost" style="margin-top:6px; padding:6px 12px; font-size:12.5px" data-action="ai-clean-finding-notes" data-area-id="${area.id}" data-finding-id="${f.id}">✨ Clean up with AI</button>
      </div>

      <div class="field">
        <label>Readings</label>
        ${f.readings.map((r, idx) => `
          <div class="reading-row">
            <input class="input" placeholder="Label (e.g. CFM)" style="flex:1.2" value="${r.label}"
              onchange="updateReading('${area.id}','${f.id}',${idx},'label',this.value)">
            <input class="input" placeholder="Value" style="flex:0.8" value="${r.value}"
              onchange="updateReading('${area.id}','${f.id}',${idx},'value',this.value)">
            <input class="input" placeholder="Unit" style="flex:0.6" value="${r.unit}"
              onchange="updateReading('${area.id}','${f.id}',${idx},'unit',this.value)">
            <button class="icon-btn" style="color:var(--action)" data-action="delete-reading" data-area-id="${area.id}" data-finding-id="${f.id}" data-reading-idx="${idx}">×</button>
          </div>`).join("")}
        <button class="btn ghost" style="margin-top:8px; padding:8px 12px; font-size:13px" data-action="add-reading" data-area-id="${area.id}" data-finding-id="${f.id}">+ Add reading</button>
      </div>

      <div class="field">
        <label>Photos</label>
        <div class="photo-grid">
          ${f.photos.map((photo, idx) => `
            <div class="photo-thumb"><img data-media-path="${photo}"><button data-action="delete-photo" data-area-id="${area.id}" data-finding-id="${f.id}" data-photo-idx="${idx}">×</button></div>
          `).join("")}
          <button class="photo-add" data-action="trigger-photo" data-area-id="${area.id}" data-finding-id="${f.id}">+</button>
        </div>
        <input type="file" accept="image/*" capture="environment" multiple class="hidden"
          id="photoInput_${area.id}_${f.id}" data-photo-target="1" data-area-id="${area.id}" data-finding-id="${f.id}">
      </div>
    </div>
  `;
}

function updateReading(areaId, findingId, idx, field, value) {
  const area = currentJob.areas.find(a => a.id === areaId);
  const f = area.findings.find(x => x.id === findingId);
  f.readings[idx][field] = value;
  persist();
}

function renderInspectScreen() {
  const job = currentJob;
  setChrome(job.property.address || "Inspection", true, true, "inspect");

  const areasHtml = job.areas.map(area => {
    const isRoom = area.type === "room";
    let body = "";
    if (isRoom) {
      body = ROOM_CATEGORIES.map(cat => {
        const items = areaFindingsForCategory(area, cat.key);
        return `
          <div class="section-title" style="margin-top:16px">${cat.label}</div>
          <p class="small muted" style="margin:-6px 0 8px">${cat.hint}</p>
          ${items.map(({ f }) => renderFindingCard(area, f)).join("")}
          <button class="btn ghost block" data-action="add-finding" data-area-id="${area.id}" data-category="${cat.key}" data-principle="${cat.principle}">+ Add ${cat.label} item</button>
        `;
      }).join("");
    } else {
      body = `
        ${area.findings.map(f => renderFindingCard(area, f)).join("")}
        <div class="row gap wrap" style="margin-top:10px">
          ${PRINCIPLES.map(p => `<button class="btn ghost" style="padding:8px 12px; font-size:12.5px" data-action="add-finding" data-area-id="${area.id}" data-category="${p.label}" data-principle="${p.key}">+ ${p.label}</button>`).join("")}
        </div>
      `;
    }
    const areaScore = area.findings.length
      ? Math.round(area.findings.reduce((s, f) => s + scoreForStatus(f.status), 0) / area.findings.length)
      : null;

    return `
      <div class="card area-card">
        <div class="card-row">
          <div style="flex:1">
            <div style="font-weight:600; font-size:16px">${area.name}</div>
            <div class="small muted">${area.type} · ${area.findings.length} item${area.findings.length === 1 ? "" : "s"}${areaScore !== null ? ` · score ${areaScore}` : ""}</div>
          </div>
          <button class="icon-btn" style="color:var(--ink-soft)" data-action="toggle-area-collapse" data-area-id="${area.id}" aria-label="${area.collapsed ? "Expand" : "Collapse"}">${area.collapsed ? "▾" : "▴"}</button>
          <button class="icon-btn" style="color:var(--action)" data-action="delete-area" data-area-id="${area.id}">🗑</button>
        </div>
        <div class="field" style="margin-top:8px">
          <input class="input" placeholder="Label / description (e.g. \"Bedroom 1 — northeast, child's room\")" data-path-area="${area.id}" data-area-desc="1" value="${area.description || ""}">
        </div>
        ${area.collapsed ? "" : body}
      </div>
    `;
  }).join("");

  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Inspect</h1><p>Add areas, then log findings by category.</p></div>
    <div class="row gap wrap" style="margin-bottom:14px">
      ${["Kitchen","Bathroom","Bedroom","Living Room","Basement","Attic","Exterior","Garage"].map(n => `
        <button class="btn ghost" style="padding:8px 12px; font-size:12.5px" data-action="quick-area" data-name="${n}" data-type="${n==="Exterior"||n==="Garage"?"exterior":"room"}">+ ${n}</button>
      `).join("")}
      <button class="btn ghost" style="padding:8px 12px; font-size:12.5px" data-action="add-area">+ Custom / Mechanical…</button>
    </div>
    ${job.areas.length ? areasHtml : `<div class="empty-state"><div class="big">▦</div><p>No areas yet. Add a room or system above to start logging findings.</p></div>`}
  `;
}

function renderMeasurementsScreen() {
  const job = currentJob;
  setChrome(job.property.address || "Readings", true, true, "measurements");
  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Environmental Measurements</h1><p>Combustion, exhaust, and diagnostic readings — separate from room findings.</p></div>
    ${job.measurements.map(m => `
      <div class="card">
        <div class="grid2">
          <div class="field"><label>Test Type</label>
            <select class="input" data-measure-field="testType" data-measure-id="${m.id}">
              ${["", "Kitchen Exhaust CFM", "Bath Exhaust CFM", "Ambient CO (interior)", "Ambient CO (exterior)", "CAZ Depressurization (Pa)", "Appliance CO (ppm)", "Water Heater Temp (°F)", "Radon (pCi/L)", "Relative Humidity (%)", "Indoor Temp (°F)"]
                .map(o => `<option ${m.testType === o ? "selected" : ""}>${o}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Location</label><input class="input" data-measure-field="location" data-measure-id="${m.id}" value="${m.location}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label>Value</label><input class="input" data-measure-field="value" data-measure-id="${m.id}" value="${m.value}"></div>
          <div class="field"><label>Unit</label><input class="input" data-measure-field="unit" data-measure-id="${m.id}" value="${m.unit}"></div>
        </div>
        <div class="row gap" style="margin-bottom:10px">
          <button class="yn-btn y ${m.passFail === "Pass" ? "selected" : ""}" data-action="set-measure-result" data-id="${m.id}" data-value="Pass">Pass</button>
          <button class="yn-btn n ${m.passFail === "Fail" ? "selected" : ""}" data-action="set-measure-result" data-id="${m.id}" data-value="Fail">Fail</button>
        </div>
        <div class="field"><label>Notes</label><textarea class="input" data-measure-field="notes" data-measure-id="${m.id}">${m.notes}</textarea></div>
        <button class="btn ghost" data-action="delete-measurement" data-id="${m.id}">Remove Measurement</button>
      </div>
    `).join("")}
    <button class="btn gold block" data-action="add-measurement">+ Add Measurement</button>
  `;
}

function renderNotesScreen() {
  const job = currentJob;
  setChrome(job.property.address || "Notes", true, true, "notes");
  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Field Notes</h1><p>Narrative findings and recommendations — shown near the top of the report.</p></div>
    <div class="card">
      <textarea class="input" style="min-height:260px" data-path="fieldNotes">${job.fieldNotes}</textarea>
      <button class="btn gold block" style="margin-top:10px" data-action="ai-clean-field-notes">✨ Clean up with AI</button>
    </div>
  `;
}

function renderReviewScreen() {
  const job = currentJob;
  setChrome(job.property.address || "Report", true, true, "review");
  const s = computeJobScore(job);
  const color = s.score >= 80 ? "#5B8266" : s.score >= 50 ? "#C08A2E" : "#B0503A";

  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Review & Report</h1><p>Confirm everything looks right, then generate the client PDF.</p></div>
    <div class="score-hero">
      <div class="score-big" style="color:${color}">${s.score}</div>
      <div class="score-label">Overall Score</div>
      <div class="hazard-stats">
        <div class="hazard-stat"><div class="n">${job.areas.length}</div><div class="l">Areas</div></div>
        <div class="hazard-stat"><div class="n">${s.chronic}</div><div class="l">Chronic</div></div>
        <div class="hazard-stat"><div class="n">${s.acute}</div><div class="l">Acute</div></div>
      </div>
    </div>

    <div class="card">
      <div class="card-row"><span>Consent signed</span><strong>${job.consent.signed ? "Yes" : "Not yet"}</strong></div>
      <div class="divider"></div>
      <div class="card-row"><span>Areas inspected</span><strong>${job.areas.length}</strong></div>
      <div class="divider"></div>
      <div class="card-row"><span>Measurements logged</span><strong>${job.measurements.length}</strong></div>
      <div class="divider"></div>
      <div class="card-row"><span>Field notes</span><strong>${job.fieldNotes ? "Added" : "Empty"}</strong></div>
    </div>

    <button class="btn ghost block" style="margin-bottom:10px" data-action="preview-report">Preview Report</button>
    <button class="btn primary block" style="margin-bottom:10px" data-action="download-report">Download PDF Report</button>
    <button class="btn gold block" data-action="share-report">Share Report…</button>
  `;
}

async function renderSettingsScreen() {
  setChrome("Company Settings", true, false);
  const s = await loadSettings();
  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Company Settings</h1><p>Shown on the cover page of every report you generate.</p></div>
    <div class="card">
      <div class="field"><label>Company Name</label><input class="input" id="companyNameInput" value="${s.company_name || ""}"></div>
      <div class="field">
        <label>Logo</label>
        ${s.logo_path ? `<img data-media-path="${s.logo_path}" style="max-width:180px; max-height:80px; display:block; margin-bottom:8px; border:1px solid var(--line); border-radius:8px; background:#fff;">` : ""}
        <button class="btn ghost" id="logoUploadBtn">${s.logo_path ? "Replace Logo" : "Upload Logo"}</button>
        <input type="file" accept="image/*" class="hidden" id="logoFileInput" data-logo-target="1">
      </div>
      <button class="btn primary block" id="saveCompanyBtn" style="margin-top:6px">Save</button>
    </div>

    <div class="section-title">Inspectors</div>
    <div class="card">
      ${(s.inspectors || []).map(n => `<div class="checklist-item"><div class="flex1">${n}</div></div>`).join("") || `<p class="muted small">No inspectors yet — add one from the Intake screen.</p>`}
    </div>

    <div class="section-title">"Ordered By" clients</div>
    <div class="card">
      ${(s.ordered_by_list || []).map(n => `<div class="checklist-item"><div class="flex1">${n}</div></div>`).join("") || `<p class="muted small">No entries yet — add one from the Intake screen.</p>`}
    </div>

    <div class="section-title">Beneficiary Agreement Template</div>
    <div class="card">
      <p class="small ${s.agreement_template_path ? "" : "muted"}">${s.agreement_template_path ? "✓ Template on file — signed agreements are auto-filled into every report." : "Upload the blank Atlanta HHP Beneficiary Agreement PDF. Once uploaded, the homeowner's name, property address, date, and signature are filled onto the real document and included in the report."}</p>
      <button class="btn ghost" id="agreementTemplateBtn">${s.agreement_template_path ? "Replace Template" : "Upload Template"}</button>
      <input type="file" accept=".pdf,application/pdf" class="hidden" id="agreementTemplateInput" data-agreement-template-target="1">
    </div>
  `;
  document.getElementById("logoUploadBtn").onclick = () => document.getElementById("logoFileInput").click();
  document.getElementById("agreementTemplateBtn").onclick = () => document.getElementById("agreementTemplateInput").click();
  document.getElementById("saveCompanyBtn").onclick = async () => {
    await saveSettings({ company_name: document.getElementById("companyNameInput").value.trim() });
    showToast("Company settings saved");
  };
}

async function handleLogoInput(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  showToast("Uploading logo…");
  try {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const blob = await compressImageToBlob(dataUrl, 500, 0.85);
    const path = await uploadMedia("company", "logo", blob, "jpg");
    await saveSettings({ logo_path: path });
    showToast("Logo saved");
    render();
  } catch (e) {
    console.error(e);
    showToast("Logo upload failed — check your connection");
  }
}

async function handleAgreementTemplateInput(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.type !== "application/pdf") { showToast("Please select a PDF file"); input.value = ""; return; }
  showToast("Uploading agreement template…");
  try {
    await uploadAgreementTemplate(file);
    showToast("Agreement template saved");
    render();
  } catch (e) {
    console.error(e);
    showToast("Upload failed — check your connection");
  }
}

async function handleFrontPhotoInput(input) {
  const file = input.files && input.files[0];
  if (!file || !currentJob) return;
  showToast("Uploading photo…");
  try {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    const blob = await compressImageToBlob(dataUrl, 1200, 0.75);
    const path = await uploadMedia(currentJob.id, "cover", blob, "jpg");
    currentJob.property.frontPhotoPath = path;
    persist();
    showToast("Front photo saved");
    render();
  } catch (e) {
    console.error(e);
    showToast("Photo upload failed — check your connection");
  }
}

/* ---------------- Report preview ---------------- */

async function openPreview() {
  if (!requireConsentWarning()) return;
  showToast("Generating preview…");
  try {
    const bytes = await generateReportPDF(currentJob);
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    document.getElementById("previewFrame").src = url;
    document.getElementById("previewModal").classList.remove("hidden");
  } catch (e) {
    console.error(e);
    showToast("Preview failed — check your connection");
  }
}
function closePreview() {
  document.getElementById("previewModal").classList.add("hidden");
  document.getElementById("previewFrame").src = "about:blank";
}

/* ---------------- CSV bulk import ---------------- */

function parseCsv(text) {
  // Minimal RFC4180-ish parser: handles quoted fields with commas/escaped quotes.
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
        if (c === "\r" && text[i + 1] === "\n") i++;
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

const CSV_FIELD_MAP = {
  "client name": "clientName", "clientname": "clientName", "name": "clientName",
  "phone": "clientPhone", "client phone": "clientPhone",
  "email": "clientEmail", "client email": "clientEmail",
  "address": "address", "street": "address", "street address": "address",
  "city": "city",
  "state": "state",
  "zip": "zip", "zip code": "zip", "zipcode": "zip",
  "ordered by": "orderedBy", "orderedby": "orderedBy",
  "year built": "yearBuilt", "yearbuilt": "yearBuilt"
};

async function handleCsvImport(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) { showToast("No data rows found in CSV"); return; }
  const headers = rows[0].map(h => h.trim().toLowerCase());
  const fieldKeys = headers.map(h => CSV_FIELD_MAP[h] || null);
  let imported = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const job = newJob();
    fieldKeys.forEach((key, idx) => {
      if (key && row[idx] !== undefined) job.property[key] = row[idx].trim();
    });
    if (!job.property.address && !job.property.clientName) continue;
    upsertJob(job);
    if (job.property.orderedBy) addOrderedByIfNew(job.property.orderedBy);
    imported++;
  }
  input.value = "";
  showToast(`Imported ${imported} propert${imported === 1 ? "y" : "ies"}`);
  render();
}

function renderStandardsScreen() {
  setChrome("Standards Library", true, false);
  const list = loadStandards();
  document.getElementById("app").innerHTML = `
    <div class="screen-header"><h1>Healthy Homes Standards</h1><p>Built-in offline reference. Verify against current local code before citing formally.</p></div>
    <input type="text" class="input search-bar" id="stdSearch" placeholder="Search standards…">
    <div class="card" id="stdList"></div>
  `;
  function renderList(filter) {
    const q = (filter || "").toLowerCase();
    const filtered = list.filter(s => !q || (s.title + s.criteria + s.source).toLowerCase().includes(q));
    document.getElementById("stdList").innerHTML = filtered.map(s => {
      const p = principleByKey(s.principle);
      return `
      <div class="std-entry">
        <span class="chip" style="background:${p.color}; margin-bottom:6px"><span class="dot"></span>${p.label}</span>
        <div class="std-title">${s.title}</div>
        <div class="small">${s.criteria}</div>
        <div class="std-range">${s.range}</div>
        <div class="std-source">Source: ${s.source}</div>
      </div>`;
    }).join("") || `<p class="muted small">No matching standards.</p>`;
  }
  renderList("");
  document.getElementById("stdSearch").addEventListener("input", (e) => renderList(e.target.value));
}
