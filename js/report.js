/* ============================================================
   REPORT GENERATION
   Assembles the completed job into a client-ready signed PDF
   using jsPDF. Runs entirely client-side, no server involved.
   ============================================================ */

const DISCLAIMER_TEXT = `This Healthy Home Environmental Assessment evaluates and characterizes home-based environmental health and safety conditions using visual observation, resident interview, and diagnostic testing performed at the time of the visit. Findings reflect only conditions apparent and accessible on the date of the assessment; latent or concealed defects are excluded. This report is not a compliance inspection or certification against any specific governmental code, ordinance, or regulation, and it is not medical or legal advice. Recommendations discussed are intended to help prioritize corrective action and are not exhaustive of every possible hazard. Consult a qualified licensed contractor for repairs and a healthcare provider for any health-related concerns.`;

/* In Touch Reno brand blues, sampled directly from the logo. */
const BRAND_PRIMARY = [8, 71, 123];   // #08477B — title bars, cover band
const BRAND_ACCENT = [33, 133, 214];  // #2185D6 — score, source lines

function hexToRgb(hex) {
  hex = (hex || "#666666").replace("#", "");
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

// jsPDF's built-in Helvetica font uses WinAnsi encoding, which doesn't
// include ≥/≤ (they render as garbage, e.g. "≥100" → "e100"). The
// standards library keeps the real Unicode symbols since the in-app
// Standards screen is plain HTML and renders them fine — this only
// sanitizes text on its way into the PDF specifically.
function pdfSafe(text) {
  return String(text || "").replace(/≥/g, ">=").replace(/≤/g, "<=");
}

// The logo is stored as PNG to preserve transparency (it may be a white
// mark meant to sit on a colored background); photos stay JPEG. jsPDF's
// addImage needs the actual format passed explicitly, so detect it from
// the data URL rather than assuming JPEG everywhere.
function pdfImageFormat(dataUrl) {
  if (dataUrl && dataUrl.indexOf("data:image/png") === 0) return "PNG";
  return "JPEG";
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function statusLabel(s) {
  return s === "ok" ? "OK" : s === "concern" ? "Concern" : "Action Needed";
}

// The cover photo box has a fixed, wide/short aspect ratio that rarely
// matches an actual phone photo's aspect ratio (portrait 3:4, landscape
// 4:3, etc). Passing the raw image straight to addImage at the box's
// exact width/height stretches it non-uniformly to fill that shape,
// which is what was skewing the photo. This crops the image to the
// box's exact aspect ratio first (centered, losing the excess on
// whichever axis doesn't fit), so the later addImage scale is uniform.
function centerCropToDataUrl(dataUrl, targetAspect) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const currentAspect = iw / ih;
      let sx, sy, sw, sh;
      if (currentAspect > targetAspect) {
        // source is wider than the target box -> crop left/right
        sh = ih;
        sw = ih * targetAspect;
        sx = (iw - sw) / 2;
        sy = 0;
      } else {
        // source is taller than the target box -> crop top/bottom
        sw = iw;
        sh = iw / targetAspect;
        sx = 0;
        sy = (ih - sh) / 2;
      }
      const canvas = document.createElement("canvas");
      const outW = Math.min(sw, 1200);
      const outH = outW / targetAspect;
      canvas.width = outW; canvas.height = outH;
      canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function generateReportPDF(job) {
  const settings = await loadSettings();
  const companyName = (settings.company_name && settings.company_name.trim()) || "In Touch Reno";
  let logoDataUrl = null;
  if (settings.logo_path) logoDataUrl = await downloadMediaAsDataUrl(settings.logo_path);
  let frontPhotoDataUrl = null;
  if (job.property.frontPhotoPath) frontPhotoDataUrl = await downloadMediaAsDataUrl(job.property.frontPhotoPath);

  // Pre-fetch every referenced photo + the signature from Storage,
  // since jsPDF needs actual image data (not a path) to embed.
  const photoDataUrls = new Map();
  for (const area of job.areas) {
    for (const f of area.findings) {
      for (const path of (f.photos || [])) {
        if (!photoDataUrls.has(path)) {
          const dataUrl = await downloadMediaAsDataUrl(path);
          if (dataUrl) photoDataUrls.set(path, dataUrl);
        }
      }
    }
  }
  let signatureDataUrl = null;
  if (job.consent.signed && job.consent.signaturePath) {
    signatureDataUrl = await downloadMediaAsDataUrl(job.consent.signaturePath);
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;
  const lineH = 14;
  const scoreInfo = computeJobScore(job);

  function ensureSpace(h) {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }
  // Colored title bar for every major section heading — draws a filled
  // brand-color band spanning the page width with white bold text in it,
  // rather than plain black text on the paper background.
  function heading(text, size) {
    size = size || 14;
    const barH = size + 18;
    ensureSpace(barH + 10);
    const barTop = y - size + 2;
    doc.setFillColor(BRAND_PRIMARY[0], BRAND_PRIMARY[1], BRAND_PRIMARY[2]);
    doc.rect(margin - 6, barTop, pageW - margin * 2 + 12, barH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size);
    doc.setTextColor(255, 255, 255);
    doc.text(text, margin, barTop + barH / 2 + size * 0.32);
    y = barTop + barH + 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
  }
  function bodyText(text, opts) {
    doc.setFontSize((opts && opts.size) || 10.5);
    doc.setTextColor(60, 60, 60);
    const width = pageW - margin * 2;
    // Sanitize before splitTextToSize, not after: jsPDF measures each
    // character's glyph width against the active WinAnsi font to decide
    // where to wrap, and a character outside that encoding (≥/≤) throws
    // off that measurement — which doesn't just garble the character,
    // it can corrupt the whole wrap calculation and silently drop chunks
    // of text nowhere near the symbol itself.
    const lines = doc.splitTextToSize(pdfSafe(text) || "—", width);
    lines.forEach(line => {
      ensureSpace(lineH);
      doc.text(line, margin, y);
      y += lineH;
    });
  }
  function kv(label, value) {
    ensureSpace(lineH);
    doc.setFontSize(10);
    doc.setTextColor(110, 110, 110);
    doc.text(label, margin, y);
    doc.setTextColor(30, 30, 30);
    const display = (value === 0) ? "0" : (value || "—");
    // Fixed column wide enough for the longest label used anywhere in this
    // report ("Supplemental Combustion Equipment" ≈ 167pt at 10pt Helvetica),
    // so every kv() row lines up in one straight column instead of the
    // value shifting per-row based on that row's own label length.
    doc.text(String(display), margin + 190, y);
    y += lineH;
  }
  function divider() {
    ensureSpace(14);
    doc.setDrawColor(220, 220, 210);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
  }

  /* ---------- COVER PAGE ---------- */
  doc.setFillColor(BRAND_PRIMARY[0], BRAND_PRIMARY[1], BRAND_PRIMARY[2]);
  doc.rect(0, 0, pageW, 100, "F");

  // Logo (top-left of the band) and company name
  let titleX = margin;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, pdfImageFormat(logoDataUrl), margin, 18, 60, 60, undefined, "FAST");
      titleX = margin + 74;
    } catch (e) {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(companyName, titleX, 34);
  doc.setFontSize(18);
  doc.text("Healthy Home Assessment Report", titleX, 56);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(job.property.address || "Address not provided", titleX, 76);
  doc.text(`${job.property.city || ""}${job.property.city ? ", " : ""}${job.property.state || ""} ${job.property.zip || ""}`, titleX, 90);

  y = 116;
  // Front-of-house photo
  if (frontPhotoDataUrl) {
    ensureSpace(190);
    try {
      const imgW = pageW - margin * 2;
      const imgH = 170;
      const cropped = await centerCropToDataUrl(frontPhotoDataUrl, imgW / imgH);
      doc.addImage(cropped, "JPEG", margin, y, imgW, imgH, undefined, "FAST");
      y += imgH + 14;
    } catch (e) {}
  }

  // Details block moved down ~3 lines from the photo before starting.
  y += lineH * 3;

  // "Prepared For / Prepared By" signature-style block — replaces the
  // old flat details list (client name/phone/etc.) entirely.
  doc.setTextColor(30, 30, 30);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  ensureSpace(16);
  doc.text("Prepared For:", margin, y);
  y += 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  ensureSpace(16);
  doc.text("C I T Y   O F   A T L A N T A", margin, y);
  y += 16;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  ensureSpace(14);
  doc.text("DEPARTMENT OF GRANTS AND COMMUNITY DEVELOPMENT", margin, y);
  y += 14;

  y += lineH; // blank line
  y += lineH; // blank line

  kv("Inspection Date", fmtDate(job.property.visitDate));
  kv("Prepared by", companyName);
  kv("Inspector", job.property.inspectorName);
  y += 10;
  divider();

  heading("Property Details", 13);
  kv("Dwelling Type", job.property.dwellingType);
  kv("Year Built", job.property.yearBuilt);
  kv("Stories", job.property.stories);
  kv("Weather", job.property.weather);
  y += 10;
  divider();

  heading("Overall Assessment Score", 16);
  ensureSpace(50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(BRAND_PRIMARY[0], BRAND_PRIMARY[1], BRAND_PRIMARY[2]);
  doc.text(String(scoreInfo.score), margin, y + 30);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(90, 90, 90);
  doc.text("out of 100", margin + 70, y + 30);
  y += 50;
  kv("Total Items Reviewed", scoreInfo.hazardCount);
  kv("Chronic Hazards Flagged", scoreInfo.chronic);
  kv("Acute Hazards Flagged", scoreInfo.acute);

  /* ---------- RESIDENT INTERVIEW SUMMARY ---------- */
  doc.addPage(); y = margin;
  heading("Resident Interview Summary");
  const iv = job.interview;
  kv("Water Source", iv.waterSource);
  kv("Private Water Tested", iv.waterTested);
  kv("Pest Control (last 12 mo.)", iv.pestControl12mo);
  kv("Humidifier Use", iv.humidifierUse);
  kv("Dehumidifier Use", iv.dehumidifierUse);
  kv("Condensation Noticed", iv.condensationNoticed);
  kv("Smoking in Home", iv.smokingInHome);
  kv("Supplemental Combustion Equipment", iv.combustionEquipment);
  kv("Fire Extinguisher Present", iv.fireExtinguisher);
  kv("Children in Home", iv.childrenInHome);
  kv("Pets in Home", iv.petsInHome);
  y += 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(30,30,30);
  ensureSpace(lineH); doc.text("Home Age / Renovations", margin, y); y += lineH;
  doc.setFont("helvetica", "normal");
  bodyText(iv.homeAgeRenovations);
  y += 4;
  doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
  ensureSpace(lineH); doc.text("Resident's Primary Concerns", margin, y); y += lineH;
  doc.setFont("helvetica", "normal");
  bodyText(iv.primaryConcerns);

  /* ---------- AREA / ROOM FINDINGS ---------- */
  doc.addPage(); y = margin;
  heading("Room-by-Room & System Findings", 16);

  job.areas.forEach(area => {
    ensureSpace(40);
    doc.setFillColor(245, 246, 243);
    doc.rect(margin - 6, y - 14, pageW - margin * 2 + 12, 22, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(BRAND_PRIMARY[0], BRAND_PRIMARY[1], BRAND_PRIMARY[2]);
    doc.text(`${area.name}  ·  ${area.type}`, margin, y);
    y += 22;
    doc.setFont("helvetica", "normal");

    if (area.description) {
      doc.setFontSize(9.5);
      doc.setTextColor(100, 100, 100);
      doc.text(area.description, margin, y);
      y += lineH;
    }

    if (!area.findings.length) {
      bodyText("No items recorded for this area.");
    }

    area.findings.forEach(f => {
      ensureSpace(20);
      const p = principleByKey(f.principle);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(30, 30, 30);
      const tagLine = `${f.category || p.label}  —  ${statusLabel(f.status)}` +
        (f.chronic ? "  [Chronic]" : "") + (f.acute ? "  [Acute]" : "");
      doc.text(tagLine, margin, y);
      y += lineH;
      doc.setFont("helvetica", "normal");
      if (f.notes) bodyText(f.notes);
      if (f.readings && f.readings.length) {
        f.readings.forEach(r => {
          ensureSpace(lineH);
          doc.setFontSize(9.5);
          doc.setTextColor(90, 90, 90);
          doc.text(`Reading — ${r.label}: ${r.value} ${r.unit || ""}`, margin + 10, y);
          y += lineH;
        });
      }
      if (f.photos && f.photos.length) {
        const thumbSize = 84, gap = 8;
        let x = margin;
        ensureSpace(thumbSize + 10);
        const rowStartY = y;
        f.photos.forEach((photo, i) => {
          if (x + thumbSize > pageW - margin) {
            x = margin;
            y += thumbSize + gap;
            ensureSpace(thumbSize + 10);
          }
          const dataUrl = photoDataUrls.get(photo);
          if (dataUrl) {
            try {
              doc.addImage(dataUrl, "JPEG", x, y, thumbSize, thumbSize, undefined, "FAST");
            } catch (e) { /* skip unreadable image */ }
          }
          x += thumbSize + gap;
        });
        y += thumbSize + 14;
      }
      y += 4;
      divider();
    });
  });

  /* ---------- MEASUREMENTS ---------- */
  doc.addPage(); y = margin;
  heading("Environmental Measurements", 16);
  if (!job.measurements.length) {
    bodyText("No diagnostic measurements recorded.");
  } else {
    job.measurements.forEach(m => {
      const auto = autoEvaluateMeasurement(m.testType, m.value);
      ensureSpace(lineH * (auto ? 3 : 2));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(30, 30, 30);
      doc.text(`${m.testType || "Measurement"} — ${m.location || ""}`, margin, y);
      y += lineH;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(`Value: ${m.value || "—"} ${m.unit || ""}`, margin + 10, y);
      const resultColor = m.passFail === "Pass" ? [91, 130, 102] : m.passFail === "Fail" ? [176, 80, 58] : [90, 90, 90];
      doc.setTextColor(resultColor[0], resultColor[1], resultColor[2]);
      doc.setFont("helvetica", "bold");
      doc.text(`Result: ${m.passFail || "—"}`, margin + 220, y);
      y += lineH;
      if (auto) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(120, 120, 120);
        doc.text(`Standard: ${pdfSafe(auto.label)}`, margin + 10, y);
        y += lineH;
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      if (m.notes) { bodyText(m.notes); }
      y += 4;
      divider();
    });
  }

  /* ---------- FIELD NOTES ---------- */
  doc.addPage(); y = margin;
  heading("Field Notes & Recommendations", 16);
  bodyText(job.fieldNotes || "No additional field notes recorded.");

  /* ---------- HEALTHY HOMES STANDARDS GLOSSARY ---------- */
  doc.addPage(); y = margin;
  heading("Healthy Homes Standards — Reference Glossary", 15);
  bodyText("Built-in reference standards used throughout this assessment. Verify against current local, state, and federal code before citing in a legal or compliance context.", { size: 9 });
  y += 8;
  const stds = loadStandards();
  stds.forEach(s => {
    const p = principleByKey(s.principle);
    const rgbP = hexToRgb(p.color);
    ensureSpace(56);
    doc.setFillColor(rgbP[0], rgbP[1], rgbP[2]);
    doc.circle(margin + 3, y - 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(rgbP[0], rgbP[1], rgbP[2]);
    doc.text(p.label.toUpperCase(), margin + 12, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(s.title, margin, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    bodyText(s.criteria, { size: 9.5 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(BRAND_ACCENT[0], BRAND_ACCENT[1], BRAND_ACCENT[2]);
    ensureSpace(13);
    doc.text(pdfSafe(s.range), margin, y);
    y += 13;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8.5);
    doc.setTextColor(120, 120, 120);
    ensureSpace(13);
    doc.text(`Source: ${s.source}`, margin, y);
    y += 16;
    divider();
  });

  /* ---------- DISCLAIMER + SIGNATURE ---------- */
  doc.addPage(); y = margin;
  heading("Terms & Acknowledgement", 16);
  bodyText(DISCLAIMER_TEXT, { size: 9.5 });
  y += 20;
  divider();

  heading("Client Consent", 13);
  if (job.consent.signed) {
    bodyText("The signed Beneficiary Agreement (Healthy Homes Production Grant Program) follows this page.");
  } else {
    bodyText("No consent signature was captured for this visit.");
  }

  /* ---------- Footer page numbers ---------- */
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`${companyName} Healthy Home Report — ${job.property.address || ""}`, margin, pageH - 24);
    doc.text(`Page ${i} of ${pageCount}`, pageW - margin - 60, pageH - 24);
  }

  const mainBytes = doc.output("arraybuffer");
  if (job.consent.signed && settings.agreement_template_path) {
    try {
      return await appendSignedAgreement(mainBytes, job, settings, signatureDataUrl);
    } catch (e) {
      console.error("appendSignedAgreement", e);
      // Fall back to the report without the filled agreement rather than blocking the whole report.
      return mainBytes;
    }
  }
  return mainBytes;
}

/* ---------- Beneficiary Agreement fill-in ----------
   Coordinates below are calibrated against the City of Atlanta HHP
   Beneficiary Agreement template, page 2 (0-indexed page 1), at 612x792pt.
   Measured directly from the template's blank lines using pdfplumber
   (word/char-level x0/x1/top/bottom extraction) rather than eyeballed —
   if the City ever reissues the template with a different layout, re-run
   that same extraction against the new file to get fresh coordinates.
   Note: the year blank on this template already prints "20" before the
   underscores, so only the 2-digit year is filled in. */
function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return n + "st";
  if (j === 2 && k !== 12) return n + "nd";
  if (j === 3 && k !== 13) return n + "rd";
  return n + "th";
}

const AGREEMENT_FIELD_COORDS = {
  name:         { x: 58, y: 475, size: 11 },
  addressLine1: { x: 58, y: 412, size: 10 },
  addressLine2: { x: 58, y: 391, size: 10 },
  day:          { x: 136, y: 316, size: 10 },
  month:        { x: 238, y: 316, size: 10 },
  year:         { x: 368, y: 316, size: 10 },
  signature:    { x: 58, y: 273, width: 190, height: 32 }
};

async function appendSignedAgreement(mainPdfBytes, job, settings, signatureDataUrl) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const templateBytes = await downloadAgreementTemplateBytes(settings.agreement_template_path);
  if (!templateBytes) return mainPdfBytes; // no template on file yet — ship the report without it

  const templateDoc = await PDFDocument.load(templateBytes);
  const font = await templateDoc.embedFont(StandardFonts.Helvetica);
  const page = templateDoc.getPages()[1]; // page 2 holds the fillable fields
  if (!page) return mainPdfBytes;

  const p = job.property;
  const cityStateZip = [[p.city, p.state].filter(Boolean).join(", "), p.zip].filter(Boolean).join(" ");
  const signedDate = new Date(job.consent.signedAt);
  const C = AGREEMENT_FIELD_COORDS;
  const black = rgb(0, 0, 0);

  page.drawText(p.clientName || "", { x: C.name.x, y: C.name.y, size: C.name.size, font, color: black });
  page.drawText(p.address || "", { x: C.addressLine1.x, y: C.addressLine1.y, size: C.addressLine1.size, font, color: black });
  page.drawText(cityStateZip, { x: C.addressLine2.x, y: C.addressLine2.y, size: C.addressLine2.size, font, color: black });
  if (!isNaN(signedDate)) {
    page.drawText(ordinalSuffix(signedDate.getDate()), { x: C.day.x, y: C.day.y, size: C.day.size, font, color: black });
    page.drawText(signedDate.toLocaleString(undefined, { month: "long" }), { x: C.month.x, y: C.month.y, size: C.month.size, font, color: black });
    page.drawText(String(signedDate.getFullYear()).slice(-2), { x: C.year.x, y: C.year.y, size: C.year.size, font, color: black });
  }

  if (signatureDataUrl) {
    try {
      const sigBytes = await (await fetch(signatureDataUrl)).arrayBuffer();
      const sigImage = await templateDoc.embedPng(sigBytes);
      page.drawImage(sigImage, { x: C.signature.x, y: C.signature.y, width: C.signature.width, height: C.signature.height });
    } catch (e) {
      console.error("embedding signature into agreement", e);
    }
  }

  const finalDoc = await PDFDocument.create();
  const mainDoc = await PDFDocument.load(mainPdfBytes);
  const mainPages = await finalDoc.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach(pg => finalDoc.addPage(pg));
  const agreementPages = await finalDoc.copyPages(templateDoc, templateDoc.getPageIndices());
  agreementPages.forEach(pg => finalDoc.addPage(pg));

  return await finalDoc.save();
}

async function downloadReport(job) {
  const bytes = await generateReportPDF(job);
  const filename = `Healthy-Home-Report-${(job.property.address || "report").replace(/[^a-z0-9]+/gi, "-")}.pdf`;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function shareReport(job) {
  const bytes = await generateReportPDF(job);
  const filename = `Healthy-Home-Report-${(job.property.address || "report").replace(/[^a-z0-9]+/gi, "-")}.pdf`;
  const blob = new Blob([bytes], { type: "application/pdf" });
  const file = new File([blob], filename, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "Healthy Home Report" });
      return;
    } catch (e) { /* user cancelled or share failed, fall back below */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast("Sharing isn't supported on this device — downloaded instead.");
}
