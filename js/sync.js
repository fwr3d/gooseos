// Keeps the device's data in step with the cloud (Supabase) when signed in.
// Push: items changed here go up. Pull: items changed elsewhere since the last
// pull come down. Whichever version has the newer `updated` time wins.
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";
import * as store from "./store.js";

export const enabled = !!(SUPABASE_URL && SUPABASE_KEY);
const TABLE = "items";

let client = null;
let state = { status: enabled ? "signed-out" : "off", email: null, error: null };
const listeners = new Set();
let running = false, again = false, timer = null;

function set(patch) { state = { ...state, ...patch }; for (const fn of listeners) fn(state); }
export function onStatus(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }

function loadLibrary() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = new URL("./vendor/supabase.js", import.meta.url).href;
    s.onload = () => resolve(window.supabase);
    s.onerror = () => reject(new Error("Couldn't load the sync library"));
    document.head.appendChild(s);
  });
}

async function getClient() {
  if (!enabled) return null;
  if (!client) {
    const lib = await loadLibrary();
    client = lib.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "gooseos-auth" },
    });
  }
  return client;
}

async function currentUser() {
  const c = await getClient(); if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session ? data.session.user : null;
}

/** Sign in with an existing account. */
export async function signIn(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  await afterSignIn(data.user);
}

/** Make the account (first time only). Needs "Confirm email" turned off in Supabase. */
export async function createAccount(email, password) {
  const c = await getClient();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.session) {
    const e = new Error("confirm-email-on");
    e.code = "confirm_email_on";
    throw e;
  }
  await afterSignIn(data.user);
}

export async function signOut() {
  const c = await getClient(); if (!c) return;
  await c.auth.signOut();
  set({ status: "signed-out", email: null });
}

async function afterSignIn(user) {
  // First sign-in on this device (or a different account): upload everything here and pull everything from scratch.
  const last = await store.getMeta("syncUser");
  if (last !== user.id) {
    await store.markAllDirty();
    await store.setMeta("lastPulled", null);
    await store.setMeta("syncUser", user.id);
  }
  set({ status: "synced", email: user.email });
  syncNow();
}

/** True when an account is signed in on this device. */
export const signedIn = () => !!state.email && state.status !== "signed-out" && state.status !== "off";

/** Turn a private calendar-feed link on (or off) for the signed-in account. See api/feed.js. */
export async function addFeedToken(token) {
  const c = await getClient();
  if (!c || !(await currentUser())) throw new Error("signed-out");
  const { error } = await c.from("feeds").insert({ token });
  if (error) throw error;
}
export async function removeFeedToken(token) {
  const c = await getClient();
  if (!c || !(await currentUser())) throw new Error("signed-out");
  const { error } = await c.from("feeds").delete().eq("token", token);
  if (error) throw error;
}

/** The signed-in person's file storage (js/files.js), or null when signed out. */
export async function fileBucket() {
  const c = await getClient(); if (!c) return null;
  const user = await currentUser().catch(() => null);
  return user ? { bucket: c.storage.from("files"), folder: user.id } : null;
}

/** Run one push + pull. Safe to call often; overlapping calls are merged. */
export async function syncNow() {
  if (!enabled) return;
  if (running) { again = true; return; }
  const user = await currentUser().catch(() => null);
  if (!user) { set({ status: "signed-out", email: null }); return; }
  if (!navigator.onLine) { set({ status: "offline", email: user.email }); return; }
  running = true; set({ status: "syncing", email: user.email, error: null });
  try {
    const c = await getClient();
    // push
    const out = await store.pending();
    for (let i = 0; i < out.length; i += 50) {
      const batch = out.slice(i, i + 50);
      const rows = batch.map(it => ({ user_id: user.id, app: it.app, id: it.id, data: it.deleted ? null : it.data, updated: it.updated, deleted: it.deleted }));
      const { error } = await c.from(TABLE).upsert(rows, { onConflict: "user_id,app,id" });
      if (error) throw error;
      await store.markSynced(batch);
    }
    // pull
    let since = await store.getMeta("lastPulled");
    for (;;) {
      let q = c.from(TABLE).select("app,id,data,updated,deleted,synced_at").order("synced_at", { ascending: true }).limit(200);
      if (since) q = q.gt("synced_at", since);
      const { data, error } = await q;
      if (error) throw error;
      if (!data.length) break;
      await store.applyRemote(data);
      since = data[data.length - 1].synced_at;
      await store.setMeta("lastPulled", since);
      if (data.length < 200) break;
    }
    set({ status: "synced", error: null });
  } catch (e) {
    console.error(e);
    set({ status: navigator.onLine ? "error" : "offline", error: e.message || String(e) });
  } finally {
    running = false;
    if (again) { again = false; syncNow(); }
  }
}

/** Start syncing in the background. */
export async function start() {
  if (!enabled) return;
  const c = await getClient().catch(e => { set({ status: "error", error: e.message }); return null; });
  if (!c) return;
  c.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") set({ status: "signed-out", email: null });
    else if (session && state.status === "signed-out") set({ status: "synced", email: session.user.email });
  });
  const user = await currentUser();
  if (user) { await afterSignIn(user); } else set({ status: "signed-out" });

  store.onChange(ch => { if (ch.source === "local") { clearTimeout(timer); timer = setTimeout(syncNow, 1200); } });
  window.addEventListener("online", syncNow);
  window.addEventListener("offline", () => set({ status: "offline" }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") syncNow(); });
  setInterval(() => { if (document.visibilityState === "visible") syncNow(); }, 60000);
}
