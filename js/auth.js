/* ============================================================
   AUTH
   Simple email/password login via Supabase Auth. The whole app
   is gated behind a signed-in session since job data (client
   PII, signed consent, photos) must not be publicly reachable.
   ============================================================ */

let currentSession = null;

async function initAuth() {
  const { data } = await sb.auth.getSession();
  currentSession = data.session;
  if (currentSession) await refreshJobsCache();
  render();
  sb.auth.onAuthStateChange(async (_event, session) => {
    const wasSignedIn = !!currentSession;
    currentSession = session;
    if (session && !wasSignedIn) await refreshJobsCache();
    if (!session) jobsCache = [];
    render();
  });
}

function renderLoginScreen(mode) {
  mode = mode || "signin";
  setChrome("In Touch Reno", false, false);
  document.getElementById("app").innerHTML = `
    <div style="max-width:360px; margin:60px auto 0;">
      <div style="text-align:center; margin-bottom:28px">
        <div style="font-size:34px">⌂</div>
        <h1 style="margin:8px 0 2px">In Touch Reno</h1>
        <p class="muted small">Healthy Home Inspections</p>
      </div>
      <div class="card">
        <div class="field">
          <label>Email</label>
          <input class="input" type="email" id="authEmail" autocomplete="username">
        </div>
        <div class="field">
          <label>Password</label>
          <input class="input" type="password" id="authPassword" autocomplete="${mode === "signup" ? "new-password" : "current-password"}">
        </div>
        <p id="authError" class="small" style="color:var(--action); display:none; margin-bottom:10px"></p>
        <button class="btn primary block" id="authSubmit" style="margin-bottom:10px">
          ${mode === "signup" ? "Create Account" : "Sign In"}
        </button>
        <button class="btn ghost block" id="authToggle">
          ${mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  `;

  document.getElementById("authToggle").onclick = () => renderLoginScreen(mode === "signup" ? "signin" : "signup");

  document.getElementById("authSubmit").onclick = async () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const errEl = document.getElementById("authError");
    errEl.style.display = "none";
    if (!email || !password) {
      errEl.textContent = "Enter an email and password.";
      errEl.style.display = "block";
      return;
    }
    const btn = document.getElementById("authSubmit");
    btn.disabled = true;
    btn.textContent = "Please wait…";
    try {
      const { error } = mode === "signup"
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      if (mode === "signup") {
        showToast("Account created — signing you in…");
      }
    } catch (e) {
      errEl.textContent = e.message || "Something went wrong.";
      errEl.style.display = "block";
      btn.disabled = false;
      btn.textContent = mode === "signup" ? "Create Account" : "Sign In";
    }
  };
}

async function signOut() {
  settingsCache = null;
  await sb.auth.signOut();
}
