/* ============================================================
   STANDARDS LIBRARY
   Built-in offline reference based on HUD / CDC-NCHH Healthy
   Homes principles, NSPIRE severity framework, ASHRAE 62.2,
   and common BPI/EPA diagnostic thresholds.
   This is reference material only — always verify against
   current local, state, and federal code before citing in a
   legal or compliance context.
   ============================================================ */

const PRINCIPLES = [
  { key: "dry", label: "Dry", color: "#3B6E71", icon: "drop" },
  { key: "clean", label: "Clean", color: "#7A8B4F", icon: "spark" },
  { key: "pest", label: "Pest-Free", color: "#8C6A3F", icon: "bug" },
  { key: "vent", label: "Ventilated", color: "#4A7FA6", icon: "wind" },
  { key: "contaminant", label: "Contaminant-Free", color: "#8B4F5C", icon: "hazard" },
  { key: "safe", label: "Safe", color: "#B0503A", icon: "shield" },
  { key: "thermal", label: "Thermally Controlled", color: "#B58A2E", icon: "therm" },
  { key: "maintained", label: "Maintained", color: "#5C5C52", icon: "wrench" }
];

function principleByKey(key) {
  return PRINCIPLES.find(p => p.key === key) || PRINCIPLES[0];
}

/* Default built-in standards entries. Stored separately in
   localStorage under 'hh_standards' so the user can add/edit
   their own without losing the defaults on app update. */
const DEFAULT_STANDARDS = [
  {
    id: "std_rh",
    principle: "dry",
    title: "Indoor Relative Humidity",
    criteria: "Maintain indoor RH between 30–50% to limit mold/dust mite growth and condensation.",
    range: "30–50% RH",
    source: "EPA / CDC-NCHH Healthy Homes guidance"
  },
  {
    id: "std_grading",
    principle: "dry",
    title: "Site Drainage / Grading",
    criteria: "Ground should slope away from the foundation; downspouts should discharge away from the structure.",
    range: "Positive drainage away from foundation",
    source: "CDC Healthy Housing Inspection Manual"
  },
  {
    id: "std_pest_entry",
    principle: "pest",
    title: "Pest Entry Points",
    criteria: "No visible gaps, holes, or unsealed penetrations that allow pest entry; no active droppings, nesting, or live pests observed.",
    range: "No evidence of active infestation",
    source: "HUD Housing-Related Health & Safety Hazard Assessment"
  },
  {
    id: "std_kitchen_exhaust",
    principle: "vent",
    title: "Kitchen Exhaust Ventilation",
    criteria: "Kitchen exhaust should move air to the outside at an adequate rate, intermittent or continuous.",
    range: "≥100 CFM intermittent, or ≥5 ACH continuous",
    source: "ASHRAE 62.2"
  },
  {
    id: "std_bath_exhaust",
    principle: "vent",
    title: "Bathroom Exhaust Ventilation",
    criteria: "Bath exhaust fans should vent to the outside (not attic) and move sufficient air.",
    range: "≥50 CFM intermittent, or ≥20 CFM continuous",
    source: "ASHRAE 62.2"
  },
  {
    id: "std_co_ambient",
    principle: "contaminant",
    title: "Ambient Carbon Monoxide",
    criteria: "Indoor living space ambient CO should read near zero. Investigate any sustained detectable reading.",
    range: "< 9 ppm (8-hr); action needed above 35 ppm (1-hr)",
    source: "EPA NAAQS reference levels"
  },
  {
    id: "std_radon",
    principle: "contaminant",
    title: "Radon",
    criteria: "Test lowest livable level for a minimum of 48 hours (short-term) or use a certified long-term test.",
    range: "Action level: ≥ 4.0 pCi/L",
    source: "EPA radon guidance"
  },
  {
    id: "std_lead_paint",
    principle: "contaminant",
    title: "Lead-Based Paint",
    criteria: "Homes built before 1978 should be tested on surfaces that will be disturbed during any work.",
    range: "Applicable to pre-1978 construction",
    source: "EPA Lead RRP Rule"
  },
  {
    id: "std_caz_depressurization",
    principle: "safe",
    title: "Combustion Appliance Zone (CAZ) Depressurization",
    criteria: "Worst-case depressurization of the CAZ should not cause spillage or exceed safe pressure differential.",
    range: "Typically ≤ 5 Pa relative to outdoors (verify local protocol)",
    source: "BPI Building Analyst / CAZ testing protocol"
  },
  {
    id: "std_water_heater_temp",
    principle: "safe",
    title: "Water Heater Setpoint (Scald Prevention)",
    criteria: "Hot water at fixtures should be hot enough to limit bacterial growth but not so hot it risks scalding.",
    range: "120°F or lower at the tap",
    source: "CPSC scald-prevention guidance"
  },
  {
    id: "std_smoke_co_alarms",
    principle: "safe",
    title: "Smoke & CO Alarms",
    criteria: "Working smoke alarm on every level and near sleeping areas; CO alarm near sleeping areas if fuel-burning appliances or attached garage present.",
    range: "Present, tested, within manufacture/expiration date",
    source: "NFPA 72 / CPSC"
  },
  {
    id: "std_thermal_comfort",
    principle: "thermal",
    title: "Indoor Temperature Range",
    criteria: "Home should be able to maintain a safe, comfortable indoor temperature range regardless of outdoor conditions.",
    range: "~68–78°F typical comfort band",
    source: "HUD / DOE weatherization guidance"
  },
  {
    id: "std_structural",
    principle: "maintained",
    title: "Structural & Envelope Condition",
    criteria: "Roof, siding, foundation, and envelope should be free of active leaks, deterioration, or unresolved deferred maintenance that could become a hazard.",
    range: "No active leaks or structural deficiencies",
    source: "HUD NSPIRE physical condition standards"
  }
];

function loadStandards() {
  const raw = localStorage.getItem("hh_standards");
  if (raw) return JSON.parse(raw);
  localStorage.setItem("hh_standards", JSON.stringify(DEFAULT_STANDARDS));
  return DEFAULT_STANDARDS.slice();
}

function saveStandards(list) {
  localStorage.setItem("hh_standards", JSON.stringify(list));
}

/* ============================================================
   AUTO PASS/FAIL FOR ENVIRONMENTAL MEASUREMENTS
   Maps each Measurements screen "Test Type" to the built-in standard
   it corresponds to, so entering a value can auto-notate Pass/Fail
   instead of requiring the inspector to judge it by hand every time.
   Deliberately left out any test type without a clear, safe numeric
   threshold in the standards library (e.g. "Appliance CO (ppm)" —
   appliance flue-gas CO safety depends on combustion-analyzer context
   that isn't a simple "below X is fine" number) rather than invent one.
   The inspector's manual Pass/Fail buttons still work as an override.
   ============================================================ */
const MEASUREMENT_AUTO_STANDARDS = {
  "Kitchen Exhaust CFM": { test: v => v >= 100, label: "≥100 CFM intermittent (ASHRAE 62.2)" },
  "Bath Exhaust CFM": { test: v => v >= 50, label: "≥50 CFM intermittent (ASHRAE 62.2)" },
  "Ambient CO (interior)": { test: v => v < 9, label: "<9 ppm, 8-hr avg (EPA NAAQS)" },
  "Ambient CO (exterior)": { test: v => v < 9, label: "<9 ppm, 8-hr avg (EPA NAAQS)" },
  "CAZ Depressurization (Pa)": { test: v => Math.abs(v) <= 5, label: "≤5 Pa relative to outdoors (BPI protocol)" },
  "Water Heater Temp (°F)": { test: v => v <= 120, label: "≤120°F at the tap (CPSC)" },
  "Radon (pCi/L)": { test: v => v < 4.0, label: "Action level ≥4.0 pCi/L (EPA)" },
  "Relative Humidity (%)": { test: v => v >= 30 && v <= 50, label: "30–50% RH (EPA / CDC-NCHH)" },
  "Indoor Temp (°F)": { test: v => v >= 68 && v <= 78, label: "~68–78°F typical comfort band (HUD/DOE)" }
};

// Returns { result: "Pass"|"Fail", label } if this test type has a known
// standard and the value parses as a number, otherwise null (meaning:
// no auto-notation available, leave it to the inspector's judgment).
function autoEvaluateMeasurement(testType, value) {
  const rule = MEASUREMENT_AUTO_STANDARDS[testType];
  if (!rule) return null;
  const num = parseFloat(value);
  if (isNaN(num)) return null;
  return { result: rule.test(num) ? "Pass" : "Fail", label: rule.label };
}
