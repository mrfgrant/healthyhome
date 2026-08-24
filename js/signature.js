/* ============================================================
   SIGNATURE PAD
   Lightweight canvas signature capture, touch + mouse.
   ============================================================ */

const SignaturePad = (function () {
  let canvas, ctx, drawing = false, hasStrokes = false;
  let onSaveCallback = null;

  function pos(evt) {
    const rect = canvas.getBoundingClientRect();
    const t = evt.touches ? evt.touches[0] : evt;
    return {
      x: (t.clientX - rect.left) * (canvas.width / rect.width),
      y: (t.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    hasStrokes = true;
  }
  function end() { drawing = false; }

  function clear() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasStrokes = false;
  }

  function init() {
    canvas = document.getElementById("sigCanvas");
    ctx = canvas.getContext("2d");
    ctx.strokeStyle = "#1C2B33";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);

    document.getElementById("sigClear").onclick = clear;
    document.getElementById("sigCancel").onclick = closeModal;
    document.getElementById("sigSave").onclick = save;
  }

  function open(contextText, callback) {
    if (!canvas) init();
    clear();
    document.getElementById("sigName").value = "";
    document.getElementById("sigContext").textContent = contextText || "";
    onSaveCallback = callback;
    document.getElementById("sigModal").classList.remove("hidden");
  }

  function closeModal() {
    document.getElementById("sigModal").classList.add("hidden");
  }

  function save() {
    if (!hasStrokes) { showToast("Please sign before saving"); return; }
    const name = document.getElementById("sigName").value.trim();
    if (!name) { showToast("Please enter a printed name"); return; }
    const dataUrl = canvas.toDataURL("image/png");
    closeModal();
    if (onSaveCallback) onSaveCallback({ signatureData: dataUrl, signedName: name, signedAt: new Date().toISOString() });
  }

  return { open };
})();
