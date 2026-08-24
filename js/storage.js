/* ============================================================
   STORAGE LAYER (Supabase-backed)
   Jobs live in the `jobs` Postgres table (one row per job, full
   nested structure in the `data` jsonb column). Photos and
   signatures live in the `inspection-media` Storage bucket,
   referenced by path (not embedded) inside that jsonb.

   An in-memory cache mirrors the current user's jobs so the rest
   of the app can read synchronously; writes go to Supabase in the
   background (optimistic UI) and are awaited where it matters.
   ============================================================ */

let jobsCache = [];
let signedUrlCache = new Map(); // storage path -> { url, expiresAt }

function uid(prefix) {
  return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function refreshJobsCache() {
  if (!currentSession) { jobsCache = []; return; }
  const { data, error } = await sb
    .from("jobs")
    .select("id, created_at, updated_at, data")
    .order("updated_at", { ascending: false });
  if (error) { console.error("refreshJobsCache", error); showToast("Couldn't load jobs — check your connection"); return; }
  jobsCache = (data || []).map(row => ({ ...row.data, id: row.id, createdAt: row.created_at, updatedAt: row.updated_at }));
}

function loadJobs() {
  return jobsCache;
}

function getJob(id) {
  return jobsCache.find(j => j.id === id);
}

function upsertJob(job) {
  // Optimistic local update
  const idx = jobsCache.findIndex(j => j.id === job.id);
  job.updatedAt = Date.now();
  if (idx >= 0) jobsCache[idx] = job; else jobsCache.unshift(job);

  const { id, createdAt, updatedAt, ...data } = job;
  const userId = currentSession && currentSession.user && currentSession.user.id;
  if (!userId) return;

  sb.from("jobs")
    .upsert({
      id: job.id,
      user_id: userId,
      address: job.property && job.property.address || null,
      client_name: job.property && job.property.clientName || null,
      score: computeJobScore(job).score,
      data
    })
    .then(({ error }) => {
      if (error) { console.error("upsertJob", error); showToast("Save failed — check your connection"); }
    });
}

function deleteJob(id) {
  jobsCache = jobsCache.filter(j => j.id !== id);
  sb.from("jobs").delete().eq("id", id).then(({ error }) => {
    if (error) { console.error("deleteJob", error); showToast("Delete failed — check your connection"); }
  });
}

function newJobId() {
  // The Postgres `jobs.id` column is type uuid — this MUST be a real UUID,
  // not the "job_xxxx" style id used for areas/findings (which live inside
  // jsonb and are never validated as uuid). Using uid("job") here was the
  // root cause of "Save failed" on every autosave.
  return crypto.randomUUID();
}

function newJob() {
  return {
    id: newJobId(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: "draft",
    property: {
      clientName: "", clientPhone: "", clientEmail: "",
      address: "", city: "", state: "", zip: "",
      inspectorName: "", orderedBy: "",
      visitDate: new Date().toISOString().slice(0, 10),
      weather: "", dwellingType: "", yearBuilt: "", stories: "", bedrooms: "",
      frontPhotoPath: ""
    },
    interview: {
      waterSource: "", waterTested: "", pestControl12mo: "", humidifierUse: "",
      dehumidifierUse: "", condensationNoticed: "", smokingInHome: "",
      combustionEquipment: "", fireExtinguisher: "", childrenInHome: "",
      petsInHome: "", homeAgeRenovations: "", primaryConcerns: ""
    },
    consent: { signed: false, signaturePath: "", signedName: "", signedAt: "" },
    areas: [],
    measurements: [],
    fieldNotes: ""
  };
}

/* ---- Area / finding helpers ---- */

const ROOM_CATEGORIES = [
  { key: "airflow", label: "Air Flow & Circulation", principle: "vent",
    hint: "OK = room ventilates adequately (working window, exhaust fan, or vent). Concern = limited airflow. Action Needed = no ventilation source. Log CFM under Readings if you measured exhaust flow." },
  { key: "allergens", label: "Allergens & Dust", principle: "clean",
    hint: "OK = no visible dust/allergen buildup or pet dander concerns. Concern = some buildup or musty odor. Action Needed = heavy buildup, visible mold-like growth, or pest droppings." },
  { key: "moisture", label: "Moisture Control", principle: "dry",
    hint: "OK = dry, no signs of water intrusion. Concern = minor staining, condensation, or musty smell. Action Needed = active leak, standing water, or visible mold. Log RH% under Readings if measured." },
  { key: "chemical", label: "Chemical Exposure", principle: "contaminant",
    hint: "OK = no chemical/VOC odors or exposed hazardous materials. Concern = strong odors (cleaners, smoke residue). Action Needed = exposed chemicals, gas smell, or suspected lead/asbestos disturbance." },
  { key: "safety", label: "Safety & Injury Prevention", principle: "safe",
    hint: "OK = no trip/fall/electrical hazards, smoke/CO alarm present if applicable. Concern = minor hazard (loose rail, worn flooring). Action Needed = exposed wiring, missing alarm, or serious fall/injury risk." }
];

function newArea(name, type) {
  return {
    id: uid("area"),
    name: name || "New Area",
    type: type || "room",
    description: "",
    collapsed: false,
    findings: []
  };
}

function newFinding(category, principle) {
  return {
    id: uid("find"),
    category: category || "",
    principle: principle || "dry",
    status: "ok",
    chronic: false,
    acute: false,
    notes: "",
    photos: [], // storage paths, e.g. "{userId}/{jobId}/{findingId}/{file}.jpg"
    readings: []
  };
}

function scoreForStatus(status) {
  if (status === "ok") return 100;
  if (status === "concern") return 50;
  return 0;
}

function computeJobScore(job) {
  let total = 0, count = 0, chronic = 0, acute = 0;
  job.areas.forEach(area => {
    area.findings.forEach(f => {
      total += scoreForStatus(f.status);
      count++;
      if (f.chronic) chronic++;
      if (f.acute) acute++;
    });
  });
  return {
    score: count ? Math.round(total / count) : 100,
    hazardCount: count,
    chronic, acute
  };
}

/* ---- User settings (company profile, dropdown lists) ---- */

let settingsCache = null;

async function loadSettings() {
  if (settingsCache) return settingsCache;
  const userId = currentUserId();
  if (!userId) return { company_name: "", logo_path: "", inspectors: [], ordered_by_list: [] };
  const { data, error } = await sb.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error) { console.error("loadSettings", error); return { company_name: "", logo_path: "", inspectors: [], ordered_by_list: [] }; }
  if (!data) {
    // First run for this user — seed with the default inspector.
    const seeded = { user_id: userId, company_name: "", logo_path: "", inspectors: ["Forrest Grant"], ordered_by_list: [] };
    await sb.from("user_settings").upsert(seeded);
    settingsCache = seeded;
    return settingsCache;
  }
  settingsCache = data;
  return settingsCache;
}

async function saveSettings(patch) {
  const userId = currentUserId();
  if (!userId) return;
  settingsCache = { ...(settingsCache || {}), ...patch, user_id: userId };
  const { error } = await sb.from("user_settings").upsert(settingsCache);
  if (error) { console.error("saveSettings", error); showToast("Couldn't save settings — check your connection"); }
}

async function addInspectorIfNew(name) {
  const s = await loadSettings();
  if (name && !s.inspectors.includes(name)) {
    await saveSettings({ inspectors: [...s.inspectors, name] });
  }
}

async function addOrderedByIfNew(name) {
  const s = await loadSettings();
  if (name && !s.ordered_by_list.includes(name)) {
    await saveSettings({ ordered_by_list: [...s.ordered_by_list, name] });
  }
}

/* ---- Beneficiary agreement template (blank master PDF, per-user) ---- */

async function uploadAgreementTemplate(file) {
  const userId = currentUserId();
  if (!userId) throw new Error("Not signed in");
  const path = `${userId}/templates/hhp-agreement.pdf`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: "application/pdf",
    upsert: true
  });
  if (error) throw error;
  await saveSettings({ agreement_template_path: path });
  return path;
}

async function downloadAgreementTemplateBytes(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).download(path);
  if (error) { console.error("downloadAgreementTemplateBytes", error); return null; }
  return await data.arrayBuffer();
}

/* ---- AI notes cleanup (Edge Function) ---- */

async function aiCleanText(rawText, contextLabel) {
  const { data, error } = await sb.functions.invoke("clean-notes", {
    body: { text: rawText, context: contextLabel || "" }
  });
  if (error) throw error;
  if (data && data.error) throw new Error(data.error);
  if (!data || !data.cleaned) throw new Error("No response from AI cleanup service");
  return data.cleaned;
}

/* ---- Media (Storage) helpers ---- */

function currentUserId() {
  return currentSession && currentSession.user && currentSession.user.id;
}

async function uploadMedia(jobId, subfolder, blob, ext) {
  const userId = currentUserId();
  if (!userId) throw new Error("Not signed in");
  const path = `${userId}/${jobId}/${subfolder}/${uid("m")}.${ext || "jpg"}`;
  const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, {
    contentType: ext === "png" ? "image/png" : "image/jpeg",
    upsert: false
  });
  if (error) throw error;
  return path;
}

async function deleteMedia(path) {
  if (!path) return;
  await sb.storage.from(MEDIA_BUCKET).remove([path]).catch(() => {});
}

async function getSignedUrl(path) {
  if (!path) return null;
  const cached = signedUrlCache.get(path);
  if (cached && cached.expiresAt > Date.now() + 5000) return cached.url;
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600);
  if (error) { console.error("getSignedUrl", error); return null; }
  signedUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + 3500 * 1000 });
  return data.signedUrl;
}

async function downloadMediaAsDataUrl(path) {
  if (!path) return null;
  const { data, error } = await sb.storage.from(MEDIA_BUCKET).download(path);
  if (error) { console.error("downloadMediaAsDataUrl", error); return null; }
  return await new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(data);
  });
}
