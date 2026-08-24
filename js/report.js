/* ============================================================
   REPORT GENERATION
   Assembles the completed job into a client-ready signed PDF
   using jsPDF. Runs entirely client-side, no server involved.
   ============================================================ */

const DISCLAIMER_TEXT = `This Healthy Home Environmental Assessment evaluates and characterizes home-based environmental health and safety conditions using visual observation, resident interview, and diagnostic testing performed at the time of the visit. Findings reflect only conditions apparent and accessible on the date of the assessment; latent or concealed defects are excluded. This report is not a compliance inspection or certification against any specific governmental code, ordinance, or regulation, and it is not medical or legal advice. Recommendations discussed are intended to help prioritize corrective action and are not exhaustive of every possible hazard. Consult a qualified licensed contractor for repairs and a healthcare provider for any health-related concerns.`;

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function statusLabel(s) {
  return s === "ok" ? "OK" : s === "concern" ? "Concern" : "Action Needed";
}

async function generateReportPDF(job) {
  const settings = await loadSettings();
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
  function heading(text, size) {
    ensureSpace(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(size || 14);
    doc.setTextColor(28, 43, 51);
    doc.text(text, margin, y);
    y += (size || 14) * 0.9 + 8;
    doc.setFont("helvetica", "normal");
  }
  function bodyText(text, opts) {
    doc.setFontSize((opts && opts.size) || 10.5);
    doc.setTextColor(60, 60, 60);
    const width = pageW - margin * 2;
    const lines = doc.splitTextToSize(text || "—", width);
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
    doc.text(String(display), margin + 150, y);
    y += lineH;
  }
  function divider() {
    ensureSpace(14);
    doc.setDrawColor(220, 220, 210);
    doc.line(margin, y, pageW - margin, y);
    y += 14;
  }

  /* ---------- COVER PAGE ---------- */
  doc.setFillColor(28, 43, 51);
  doc.rect(0, 0, pageW, 100, "F");

  // Logo (top-left of the band) and company name
  let titleX = margin;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "JPEG", margin, 18, 60, 60, undefined, "FAST");
      titleX = margin + 74;
    } catch (e) {}
  }
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  if (settings.company_name) doc.text(settings.company_name, titleX, 34);
  doc.setFontSize(18);
  doc.text("Healthy Home Assessment Report", titleX, settings.company_name ? 56 : 44);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(job.property.address || "Address not provided", titleX, settings.company_name ? 76 : 66);
  doc.text(`${job.property.city || ""}${job.property.city ? ", " : ""}${job.property.state || ""} ${job.property.zip || ""}`, titleX, settings.company_name ? 90 : 80);

  y = 116;
  // Front-of-house photo
  if (frontPhotoDataUrl) {
    ensureSpace(190);
    try {
      const imgW = pageW - margin * 2;
      const imgH = 170;
      doc.addImage(frontPhotoDataUrl, "JPEG", margin, y, imgW, imgH, undefined, "FAST");
      y += imgH + 14;
    } catch (e) {}
  }

  doc.setTextColor(30, 30, 30);
  kv("Report ID", job.id);
  kv("Client Name", job.property.clientName);
  kv("Client Phone", job.property.clientPhone);
  kv("Client Email", job.property.clientEmail);
  kv("Ordered By", job.property.orderedBy);
  kv("Inspector", job.property.inspectorName);
  kv("Visit Date", fmtDate(job.property.visitDate));
  kv("Dwelling Type", job.property.dwellingType);
  kv("Year Built", job.property.yearBuilt);
  kv("Weather at Visit", job.property.weather);
  y += 10;
  divider();

  heading("Overall Assessment Score", 16);
  ensureSpace(50);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.setTextColor(28, 43, 51);
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
    doc.setTextColor(28, 43, 51);
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
      ensureSpace(lineH * 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.setTextColor(30, 30, 30);
      doc.text(`${m.testType || "Measurement"} — ${m.location || ""}`, margin, y);
      y += lineH;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(90, 90, 90);
      doc.text(`Value: ${m.value || "—"} ${m.unit || ""}   Result: ${m.passFail || "—"}`, margin + 10, y);
      y += lineH;
      if (m.notes) { bodyText(m.notes); }
      y += 4;
      divider();
    });
  }

  /* ---------- FIELD NOTES ---------- */
  doc.addPage(); y = margin;
  heading("Field Notes & Recommendations", 16);
  bodyText(job.fieldNotes || "No additional field notes recorded.");

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
    doc.text(`Fieldmark Healthy Home Report — ${job.property.address || ""}`, margin, pageH - 24);
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
   Beneficiary Agreement template (Word/text version, converted to PDF),
   page 2 (0-indexed page 1), at 612x792pt. If the City ever reissues the
   template with a different layout, these will need re-calibrating
   against the new file. Note: the year blank on this template already
   prints "20" before the underscores, so only the 2-digit year is filled in. */
function ordinalSuffix(n) {
  const j = n % 10, k = n % 100;
  if (j === 1 && k !== 11) return n + "st";
  if (j === 2 && k !== 12) return n + "nd";
  if (j === 3 && k !== 13) return n + "rd";
  return n + "th";
}

const AGREEMENT_FIELD_COORDS = {
  name:         { x: 41, y: 492, size: 11 },
  addressLine1: { x: 41, y: 429, size: 10 },
  addressLine2: { x: 41, y: 408, size: 10 },
  day:          { x: 120, y: 335, size: 10 },
  month:        { x: 222, y: 335, size: 10 },
  year:         { x: 352, y: 335, size: 10 },
  signature:    { x: 40, y: 289, width: 220, height: 45 }
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
