/* ============================================================
   SUPABASE CLIENT
   Project: fieldmark-healthy-homes
   Publishable (anon) key is safe to expose in client code — all
   access is enforced by Row Level Security policies in Postgres
   and Storage, scoped to auth.uid().
   ============================================================ */

const SUPABASE_URL = "https://ulxrquagdjtmgrgzuosp.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_uWbA98FgdGX7ER-5XS7BXg_AOd7FjKt";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEDIA_BUCKET = "inspection-media";
