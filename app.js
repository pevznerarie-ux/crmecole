/* =========================================================================
   CRM Sinaï — cœur de l'application (aucune dépendance de build).
   Trois fichiers chargés dans cet ordre, qui partagent les mêmes variables :
     app.js        données, synchronisation, formulaires, import, connexion
     app-views.js  affichage des pages (tableau de bord, fiches, collecte...)
     app-tools.js  outils d'interface (recherche globale, menus, exports...)
   Sections de ce fichier :
     1. Constantes & mapping de colonnes d'import
     2. Client API (fetch async, jamais bloquant)
     3. État & données de départ (aucune donnée factice)
     4. Aides de données (liaison par id, totaux dérivés)
     5. Aides de rendu (tag, statut, champ, etc.)
     6. Rendu des vues
     7. Fiche détail d'un contact/structure (onglets réels)
     8. Navigation & tiroir mobile
     9. Modales & actions rapides (interaction / don / commentaire)
    10. Enregistrement des formulaires
    11. Import réel de fichier (CSV / XLSX)
    12. Démarrage
   ========================================================================= */

/* ---------- 1. Constantes & mapping ------------------------------------ */

const STORAGE_KEY = "sinai-crm-local-state-v2";
const AUTH_TOKEN_KEY = "sinai-crm-auth-token";
const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8766" : "";
const AUDIT_LIMIT = 1000;
// Statuts de paiement considérés "en attente" (promesse pas encore encaissée) :
// "Promis" est le seul statut littéral utilisé par l'appli elle-même : les
// ~11 000 paiements importés avant le CRM portent des statuts historiques
// variés, dont trois indiquent sans ambiguïté une promesse pas encore
// arrivée ("En attente d'envoi/de traitement/d'autorisation") — jamais
// "Paiement validé" ou "Chèque encaissé" (déjà reçus), ni "Paiement non
// effectué" (un paiement qui a échoué n'est pas une rentrée à venir).
// Utilisé à la fois par le KPI "Reste à payer" de l'accueil et par le
// filtre "Déjà payé / En attente" du moteur de recherche des contacts.
const PENDING_PAYMENT_STATUSES = new Set(["Promis", "En attente d'envoi", "En attente de traitement", "En attente d'autorisation"]);

// ---- Hauteur réelle visible sur mobile (clavier compris) -------------------
// `100dvh` ne suffit pas : par spécification CSS, les unités "dvh" tiennent
// compte des barres du navigateur qui apparaissent/disparaissent, mais PAS du
// clavier virtuel. La balise "interactive-widget=resizes-content" (essayée
// avant) ne corrige ça que sur Chrome/Android : Safari sur iPhone (l'appareil
// utilisé en pratique) l'ignore complètement, d'où le "ça s'agrandit encore"
// qui persistait après ce premier essai. La seule API fiable multi-navigateur
// est window.visualViewport, qui donne la vraie hauteur visible et se met à
// jour quand le clavier s'ouvre/se ferme. On la répercute dans une variable
// CSS (--vvh) utilisée par .app-shell, .sidebar, .drawer, la boîte de dialogue
// et .modal, pour que ces éléments restent toujours entièrement visibles et
// ne poussent jamais le bas d'un formulaire sous le clavier.
(function syncVisualViewportHeight() {
  function apply() {
    const vv = window.visualViewport;
    const h = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty("--vvh", `${h}px`);
  }
  apply();
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", apply);
    window.visualViewport.addEventListener("scroll", apply);
  }
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
})();

function todayStr() {
  return new Date().toLocaleDateString("fr-FR");
}
function nowIso() {
  return new Date().toISOString();
}
// Format ISO (AAAA-MM-JJ) attendu par <input type="date"> — todayStr() rend
// un format français (JJ/MM/AAAA) inutilisable comme valeur d'un tel champ.
function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
// Convertit la date choisie dans le formulaire (AAAA-MM-JJ) vers le format
// d'affichage français + un horodatage ISO (pour le tri chronologique),
// afin de pouvoir saisir une interaction passée (pas seulement "aujourd'hui").
function dateFromInput(isoDateStr) {
  const parts = String(isoDateStr || "").split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !n)) return { display: todayStr(), at: nowIso() };
  const [y, m, d] = parts;
  const now = new Date();
  const at = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
  const pad = (n) => String(n).padStart(2, "0");
  return { display: `${pad(d)}/${pad(m)}/${y}`, at };
}

// Correspondance entre les en-têtes français d'un export (Ohme / Sinaï) et
// les champs internes d'une fiche. Utilisé par l'import réel (section 11).
const IMPORT_FIELD_MAP = {
  "email": "email",
  "prenom": "first",
  "nom": "last",
  "civilite": "civility",
  "date de naissance": "dob",
  "telephone": "phone",
  "etiquettes de contact": "tags",
  "segments": "segments",
  "groupes": "groups",
  "role(s) de groupes": "groupRoles",
  "nature du donateur": "donorNature",
  "sources de paiements": "paymentSources",
  "moyens de paiement": "paymentMethods",
  "adresse": "address",
  "code postal": "zip",
  "ville": "city",
  "departement francais": "department",
  "region francaise": "region",
  "pays": "country",
  "nombre de paiements": "importedPaymentsCount",
  "montant total des paiements": "importedAmount",
  "montant total des paiements 2025": "importedAmount2025",
  "montant total des paiements 2026": "importedAmount2026",
  "nombre d'interactions": "importedInteractionsCount",
  "role de foyer": "role",
  "type de foyer": "householdType",
  "mode d'envoi souhaite des recus": "receipt",
  "format de recu fiscal": "receiptFormat",
  "date d'ajout": "dateAdded",
  "date de derniere modification": "dateModified",
  "email(s) secondaire(s)": "secondaryEmails",
  "nom unique famille": "family",
  "statut parent": "parentStatus",
  "statut enfant": "childStatus",
  "agent": "agent",
  "profession": "profession",
  "ecole actuelle": "school",
  "telephone 2": "phone2",
  "telephone pere": "fatherPhone",
  "telephone mere": "motherPhone",
  "commentaire": "comment",
  "appellation (courrier)": "mailingName",
  "denomination (export)": "exportName",
};
const IMPORT_LIST_FIELDS = new Set(["tags", "segments", "groups", "groupRoles", "paymentSources", "paymentMethods"]);
const IMPORT_NUMBER_FIELDS = new Set(["importedAmount", "importedAmount2025", "importedAmount2026", "importedPaymentsCount", "importedInteractionsCount"]);

function normalizeHeader(header) {
  return String(header || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");
}

/* ---------- 2. Client API ------------------------------------------------ */

let saveInFlight = false;
let savePending = false;

// Authentification réelle : un jeton de session (renvoyé par /api/auth/login
// ou /api/auth/setup) est envoyé sur chaque appel API dans l'en-tête
// Authorization. Le serveur vérifie ce jeton et n'applique jamais les
// permissions côté client seul — voir server.py.
let authToken = null;
let currentAccount = null;
let accounts = [];

function authHeaders(extra) {
  const headers = Object.assign({}, extra || {});
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  return headers;
}

async function apiAuthStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/status`);
    return res.ok ? res.json() : { setupRequired: false };
  } catch {
    return { setupRequired: false };
  }
}
async function apiSetupAdmin(payload) {
  const res = await fetch(`${API_BASE}/api/auth/setup`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Impossible de créer le compte.");
  return data;
}
async function apiLogin(payload) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Connexion impossible.");
  return data;
}
async function apiLogout() {
  try { await fetch(`${API_BASE}/api/auth/logout`, { method: "POST", headers: authHeaders() }); } catch { /* tant pis */ }
}
async function apiMe() {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
    return res.ok ? res.json() : null;
  } catch {
    return null;
  }
}
async function apiListAccounts() {
  const res = await fetch(`${API_BASE}/api/accounts`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Accès refusé.");
  const data = await res.json();
  return data.items || [];
}
async function apiCreateAccount(payload) {
  const res = await fetch(`${API_BASE}/api/accounts`, {
    method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Création impossible.");
  return data;
}
async function apiUpdateAccount(id, payload) {
  const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(id)}`, {
    method: "PATCH", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Mise à jour impossible.");
  return data;
}
async function apiDeleteAccount(id) {
  const res = await fetch(`${API_BASE}/api/accounts/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Suppression impossible.");
  return data;
}

function currentUserLabel() {
  if (!currentAccount) return "Vous";
  const name = `${currentAccount.first || ""} ${currentAccount.last || ""}`.trim();
  return name || currentAccount.email || "Vous";
}

async function apiGetState() {
  try {
    const res = await fetch(`${API_BASE}/api/state?ts=${Date.now()}`, { cache: "no-store", headers: authHeaders() });
    if (res.status === 401) { handleUnauthorized(); return null; }
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

// ---- Petite base locale (IndexedDB) ---------------------------------------
// Garde sur l'appareil la dernière copie des données (pour consulter le CRM
// sans réseau) et les modifications pas encore envoyées au serveur. Remplace
// l'ancienne copie dans localStorage, limitée à ~5 Mo : avec plusieurs
// milliers de dons elle débordait et n'était en pratique jamais écrite.
function idbOpen() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open("sinai-crm", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (err) { reject(err); }
  });
}
async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* stockage local indisponible : tant pis */ }
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    const value = await new Promise((resolve, reject) => {
      const req = db.transaction("kv").objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value ?? null;
  } catch {
    return null;
  }
}
async function idbDel(key) {
  try {
    const db = await idbOpen();
    await new Promise(resolve => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
    db.close();
  } catch { /* rien à effacer */ }
}

function setSaveIndicator(text, tone) {
  const el = document.querySelector("#saveIndicator");
  if (!el) return;
  el.textContent = text;
  el.className = `save-indicator show ${tone || ""}`;
  if (tone !== "busy") {
    clearTimeout(setSaveIndicator._t);
    setSaveIndicator._t = setTimeout(() => el.classList.remove("show"), 1800);
  }
}

// Toutes les listes de données du CRM, par nom (mêmes noms que côté serveur).
const SYNC_COLLECTIONS = ["records", "payments", "interactions", "tasks", "campaigns", "savedViews", "linkages", "groups", "imports", "receiptLog", "auditLog", "users", "customFields", "receiptTemplates", "interactionCategories", "dismissedDuplicates"];
function crmCollections() {
  return { records, payments, interactions, tasks, campaigns, savedViews, linkages, groups, imports, receiptLog, auditLog, users, customFields, receiptTemplates, interactionCategories, dismissedDuplicates };
}
function currentCrmData() {
  return { version: 1, rev: syncRev, savedAt: nowIso(), state: {}, ...crmCollections(), holidayNotes };
}

// ---- Synchronisation fiche par fiche --------------------------------------
// Le navigateur garde une "photo" de ce que le serveur connaît (syncSnapshot)
// et, à chaque enregistrement, n'envoie que ce qui a changé depuis : les
// éléments créés ou modifiés, et les identifiants de ceux qui ont été
// supprimés. Avant, chaque clic renvoyait TOUT le CRM, qui remplaçait la base
// entière : si deux personnes travaillaient en même temps, la dernière à
// enregistrer effaçait ce que l'autre venait de saisir. Le numéro de révision
// (syncRev) sert à repérer qu'un collègue a modifié quelque chose entre-temps,
// pour récupérer ses changements.
let syncRev = 0;
let syncSnapshot = null;
let saveSeq = 0;
let saveWaiters = [];

// Une liste dont chaque élément porte un identifiant unique se synchronise
// élément par élément ; les autres (listes de simples textes, petits
// réglages) sont renvoyées d'un bloc quand elles changent.
function snapshotCollection(list) {
  const map = new Map();
  for (const item of list) {
    if (!item || typeof item !== "object" || !item.id || map.has(String(item.id))) {
      return { mode: "whole", json: JSON.stringify(list) };
    }
    map.set(String(item.id), JSON.stringify(item));
  }
  return { mode: "items", map };
}
function snapshotOf(data) {
  const collections = {};
  SYNC_COLLECTIONS.forEach(name => { collections[name] = snapshotCollection(Array.isArray(data[name]) ? data[name] : []); });
  return { collections, holidayNotes: JSON.stringify(data.holidayNotes || {}) };
}
function buildSyncPayload() {
  const current = crmCollections();
  const next = { collections: {}, holidayNotes: JSON.stringify(holidayNotes || {}) };
  const changes = {}, replace = {}, meta = {};
  let count = 0;
  SYNC_COLLECTIONS.forEach(name => {
    const list = current[name] || [];
    const now = snapshotCollection(list);
    const before = syncSnapshot.collections[name] || { mode: "items", map: new Map() };
    next.collections[name] = now;
    if (now.mode === "items" && before.mode === "items") {
      const upsert = [], remove = [];
      list.forEach(item => { const id = String(item.id); if (before.map.get(id) !== now.map.get(id)) upsert.push(item); });
      before.map.forEach((_, id) => { if (!now.map.has(id)) remove.push(id); });
      if (upsert.length || remove.length) { changes[name] = { upsert, remove }; count += upsert.length + remove.length; }
    } else {
      const nowJson = now.mode === "whole" ? now.json : JSON.stringify(list);
      if (before.mode !== "whole" || before.json !== nowJson) { replace[name] = list; count += 1; }
    }
  });
  if (next.holidayNotes !== syncSnapshot.holidayNotes) { meta.holidayNotes = holidayNotes; count += 1; }
  return { payload: { version: 1, baseRev: syncRev, changes, replace, meta }, next, count };
}

// Renvoie le résultat RÉEL de l'enregistrement : "ok", "denied" (refusé par
// le serveur, ex. compte Lecture seule), "error" (autre refus serveur),
// "offline" (pas de réseau) ou "unauthorized" (session expirée). Un échec est
// toujours signalé par un message bien visible.
async function saveCrmData(opts = {}) {
  if (isReadOnlyAccount()) { notify(READ_ONLY_MSG); revertToServerState(); return "denied"; }
  if (!syncSnapshot) {
    // Aucune donnée n'a pu être chargée (serveur injoignable au démarrage et
    // pas de copie locale) : rien ne peut être enregistré de façon fiable.
    notify("⚠ Serveur injoignable : cette modification n'est pas enregistrée. Vérifiez la connexion puis rechargez la page.", true);
    return "offline";
  }
  saveSeq += 1;
  if (saveInFlight) { savePending = true; return new Promise(resolve => saveWaiters.push(resolve)); }
  const { payload, next, count } = buildSyncPayload();
  if (!count) return "ok";
  saveInFlight = true;
  if (!opts.silent) setSaveIndicator("Enregistrement…", "busy");
  let outcome = "ok";
  let stale = false;
  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { outcome = "unauthorized"; handleUnauthorized(); }
    else if (res.ok) {
      const data = await res.json();
      stale = data.applied ? data.rev > syncRev + 1 : data.rev !== syncRev;
      syncSnapshot = next;
      syncRev = data.rev;
      idbDel("pending");
      scheduleLocalBackup();
      if (!opts.silent) setSaveIndicator("Enregistré", "ok");
      if ((data.denied || []).length) notify("⚠ Certaines modifications n'ont pas été acceptées : elles sortent du périmètre de votre compte", true);
    } else {
      outcome = res.status === 403 ? "denied" : "error";
      const msg = (await res.json().catch(() => null))?.error;
      setSaveIndicator("Non enregistré", "warn");
      notify(`⚠ Non enregistré${msg ? ` : ${msg}` : " : le serveur a refusé la modification"}`, true);
      if (outcome === "denied") revertToServerState();
    }
  } catch {
    outcome = "offline";
    idbSet("pending", { accountId: currentAccount?.id, payload });
    setSaveIndicator("Hors ligne — sera envoyé au retour du réseau", "warn");
    if (!opts.silent) notify("⚠ Hors ligne : la modification est gardée sur cet appareil et sera envoyée dès le retour du réseau", true);
  } finally {
    saveInFlight = false;
    if (savePending) {
      savePending = false;
      const waiters = saveWaiters;
      saveWaiters = [];
      saveCrmData(opts).then(o => waiters.forEach(w => w(o)));
    } else if (stale) {
      pullFromServer();
    }
  }
  return outcome;
}

// Copie locale pour le mode hors ligne : écrite quelques secondes après la
// dernière synchronisation réussie, et seulement si tout ce qui est à l'écran
// est bien connu du serveur (sinon on mélangerait données confirmées et
// modifications en attente, qui sont gardées à part sous "pending").
function scheduleLocalBackup() {
  clearTimeout(scheduleLocalBackup._t);
  scheduleLocalBackup._t = setTimeout(() => {
    if (saveInFlight || !syncSnapshot || !currentAccount || buildSyncPayload().count) return;
    idbSet("state", { accountId: currentAccount.id, data: currentCrmData() });
  }, 2500);
}

// Rejoue sur les données en mémoire des modifications gardées hors ligne.
function applyPayloadLocally(payload) {
  const lists = crmCollections();
  Object.entries(payload.changes || {}).forEach(([name, change]) => {
    const list = lists[name];
    if (!list) return;
    (change.remove || []).forEach(id => { const i = list.findIndex(x => String(x.id) === String(id)); if (i >= 0) list.splice(i, 1); });
    [...(change.upsert || [])].reverse().forEach(item => {
      const i = list.findIndex(x => String(x.id) === String(item.id));
      if (i >= 0) list[i] = item; else list.unshift(item);
    });
  });
  if (payload.replace && Object.keys(payload.replace).length) applyCrmData(payload.replace, true);
  if (payload.meta?.holidayNotes) holidayNotes = payload.meta.holidayNotes;
}

// Au démarrage : s'il reste des modifications faites sans réseau lors d'une
// session précédente, on les envoie avant de charger les données du serveur.
async function flushPendingSync() {
  const pending = await idbGet("pending");
  if (!pending || !pending.payload) return;
  if (pending.accountId !== currentAccount?.id) { idbDel("pending"); return; }
  try {
    const res = await fetch(`${API_BASE}/api/sync`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(pending.payload),
    });
    if (res.ok) { await idbDel("pending"); notify("Modifications faites hors ligne envoyées au serveur"); }
    else if (res.status === 403 || res.status === 400) await idbDel("pending");
  } catch { /* toujours hors ligne : on réessaiera */ }
}

// La version du serveur devient la référence : données en mémoire, photo de
// synchronisation et numéro de révision.
function applyServerState(server) {
  syncSnapshot = snapshotOf(server);
  syncRev = Number(server.rev || 0);
  applyCrmData(server, true);
  normalizeLoadedData();
  scheduleLocalBackup();
}

function userIsTyping() {
  const el = document.activeElement;
  return !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !!el.closest("#content, #drawer");
}

// Récupère les changements faits par d'autres personnes. Abandonne si une
// modification locale est partie (ou en train de partir) pendant le
// téléchargement : on ne remplace jamais des données plus récentes que celles
// qu'on vient de recevoir ; la vérification suivante s'en chargera.
async function pullFromServer() {
  if (saveInFlight || !syncSnapshot) return;
  if (buildSyncPayload().count) { saveCrmData({ silent: true }); return; }
  const seq = saveSeq;
  const server = await apiGetState();
  if (!server || saveInFlight || seq !== saveSeq) return;
  applyServerState(server);
  if (userIsTyping() || dialog().open) state.pendingRender = true; else render();
}
async function pullIfStale() {
  if (!authToken || !currentAccount || saveInFlight) return;
  if (!syncSnapshot) {
    // Démarrage sans réseau ni copie locale : on retente le chargement.
    const server = await apiGetState();
    if (server) { applyServerState(server); render(); setSaveIndicator("Connexion rétablie", "ok"); }
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/rev`, { headers: authHeaders(), cache: "no-store" });
    if (res.status === 401) { handleUnauthorized(); return; }
    if (!res.ok) return;
    const { rev } = await res.json();
    if (rev !== syncRev) await pullFromServer();
    else if (buildSyncPayload().count) saveCrmData({ silent: true });
  } catch { /* hors ligne : on réessaiera */ }
}

// Après un refus du serveur, la copie locale contient des modifications qui
// n'existent pas côté serveur : on la remplace par la vraie version, pour
// ne pas laisser à l'écran un contact ou un don "fantôme" qui disparaîtrait
// au prochain rechargement.
async function revertToServerState() {
  const server = await apiGetState();
  if (!server) return;
  applyServerState(server);
  render();
}

const READ_ONLY_MSG = "Compte en lecture seule : vous pouvez consulter, mais pas modifier";
function isReadOnlyAccount() {
  return !!currentAccount && currentAccount.profile === "Lecture seule";
}
// Actions qui modifient des données : masquées pour un compte Lecture seule
// (body.read-only, voir styles.css) et bloquées ici par sécurité si l'une
// d'elles reste atteignable.
const WRITE_ACTION_RE = /^(add-|delete-|edit-|quick-|bulk-(tag|portfolio|delete)|mark-received|archive-campaign|dedupe-(delete|merge|separate)|toggle-task|toggle-portfolio|portfolio-touch|generate-receipts|regenerate-receipt|import-new|save-segment|holiday-prepare)/;

// Compte à accès restreint par catégorie : le serveur n'enregistre que les
// fiches portant une de ses étiquettes/segments/groupes. Une fiche créée
// (ou modifiée) sans l'une d'elles était donc ignorée sans prévenir et
// disparaissait au rechargement : on lui ajoute la première étiquette du
// périmètre du compte pour qu'elle reste visible et enregistrée.
function ensureInAccountScope(record) {
  if (!record || record.kind === "Structure" || currentAccount?.scopeMode !== "tags") return;
  const allowed = (currentAccount.scopeTags || []).map(t => String(t).toLowerCase());
  if (!allowed.length) return;
  const labels = [...(record.tags || []), ...(record.segments || []), ...(record.groups || [])].map(t => String(t).toLowerCase());
  if (labels.some(l => allowed.includes(l))) return;
  record.tags = [...(record.tags || []), currentAccount.scopeTags[0]];
}

function logAudit(text) {
  auditLog.unshift({ id: `AUD-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: todayStr(), at: nowIso(), text, user: currentUserLabel() });
  if (auditLog.length > AUDIT_LIMIT) auditLog.length = AUDIT_LIMIT;
}

/* ---------- 3. État & données de départ --------------------------------- */

const state = {
  view: "home",
  section: "Accueil",
  query: "",
  selectedRecord: null,
  tab: "Details",
  drawer: null,
  toastTimer: null,
  // showDetail : la fiche d'un contact est ouverte en pleine page (ordinateur
  // comme téléphone). mobileDetailOpen suit toujours la même valeur.
  showDetail: false,
  navOpen: false,
  booted: false,
  recordsPage: 80,
  paymentsPage: 80,
  showDoneTasks: false,
  // Distingue "une fiche est affichée par défaut à côté de la liste" (desktop,
  // toujours vrai) de "on vient d'ouvrir explicitement une fiche précise" —
  // c'est ce deuxième cas qui doit, sur mobile, remplacer la liste par la
  // fiche au lieu de l'empiler tout en bas (voir styles.css, .mobile-detail-open).
  mobileDetailOpen: false,
  detailReturn: null,
  // Onglet "Doublons potentiels" (tiroir) : recherche libre, et/ou focus sur
  // les doublons d'une seule fiche (ouvert depuis son bouton "Voir les doublons").
  dedupeQuery: "",
  dedupeFocusId: null,
  // Filtres avancés du répertoire (Contacts/Structures) : voir defaultFilters()
  // pour le détail des critères, et recordMatchesFilters() pour leur application.
  filters: null,
  // Répertoire : filtre rapide (pastilles au-dessus de la liste), tri, et
  // fiches cochées pour une action groupée.
  quick: "",
  sort: { key: "recent", dir: "desc" },
  selection: new Set(),
  // Paiements : filtres de la liste et tri.
  payFilters: { type: "", year: "", status: "", method: "" },
  // Tâches : "mine" (les miennes) ou "all" (toute l'équipe).
  taskScope: "mine",
  statsYear: "",
  auditQuery: "",
  interactionFilter: "",
  pendingRender: false,
};

const PAGE_STEP = 80;

// Filtres avancés disponibles sur le répertoire (Contacts/Structures), en plus
// de la recherche libre : montant total donné, récurrence (plusieurs années
// différentes), campus déduit des étiquettes BM/BH, année de don, type de
// paiement, occasion, et statut payé/en attente. Toutes les listes vides =
// aucun filtre actif sur ce critère (tout passe).
function defaultFilters() {
  return {
    amountMin: "",
    amountMax: "",
    recurring: "", // "" (indifférent) | "yes" | "no"
    campuses: [], // sous-ensemble de ["Beth Mena'hem", "Beth Hilel"]
    years: [], // années (chaînes) déduites des paiements
    paymentTypes: [], // sous-ensemble de PAYMENT_TYPE_OPTIONS
    occasions: [], // valeurs libres de payment.occasion (vide dans les données historiques)
    payStatus: [], // sous-ensemble de ["paye", "attente"]
    segments: [], // étiquettes de record.segments (segments "historiques" en texte libre)
    tags: [], // étiquettes de la fiche (record.tags)
    lastGift: "", // "" | "12m" (a donné depuis 12 mois) | "old" (dernier don il y a plus de 12 mois) | "never"
  };
}
function activeFilters() {
  if (!state.filters) state.filters = defaultFilters();
  return state.filters;
}
function filtersAreActive(f) {
  return !!(f.amountMin || f.amountMax || f.recurring || f.lastGift || f.campuses.length || f.years.length || f.paymentTypes.length || f.occasions.length || f.payStatus.length || f.segments.length || (f.tags || []).length);
}
function activeFilterCount(f) {
  return [f.amountMin, f.amountMax, f.recurring, f.lastGift].filter(Boolean).length
    + f.campuses.length + f.years.length + f.paymentTypes.length + f.occasions.length + f.payStatus.length + f.segments.length + (f.tags || []).length;
}
const PAYMENT_TYPE_OPTIONS = ["Don", "Adhésion", "Billetterie"];
const CAMPUS_OPTIONS = ["Beth Mena'hem", "Beth Hilel"];

function visiblePage(allRows, pageKey) {
  const limit = state[pageKey] || PAGE_STEP;
  return { visible: allRows.slice(0, limit), remaining: Math.max(0, allRows.length - limit) };
}

// Aucune donnée de démonstration : le CRM démarre avec les contacts réellement
// importés (window.SINAI_IMPORTED_CONTACTS, généré par un import réel) ou vide.
const importedContacts = (window.SINAI_IMPORTED_CONTACTS || []).map(c => ({ ...c, source: c.source || "Import" }));

let records = [];
let payments = [];
let imports = [];
let users = [];
let groups = [];
let interactions = [];
let linkages = [];
let customFields = [
  { name: "Établissement", type: "Liste", values: "Beth Hilel, Beth Mena'hem", required: "Non", profile: "Tous" },
];
// Libellés/catégories d'interaction : liste libre, modifiable depuis Paramètres
// (renommer, ajouter, supprimer) pour coller au vocabulaire réel de l'équipe
// (ex : "Chiour"), au lieu d'une liste figée dans le code.
let interactionCategories = ["Collecte", "Comptabilité", "Bénévolat", "Événement", "Scolarité"];
let receiptTemplates = [
  { name: "Don standard", entity: "Réseau Sinaï", mode: "Automatique", signature: "Direction", active: "Oui" },
];
let savedViews = [];
let auditLog = [];
// Tâches personnelles/assignées : première brique de l'agenda demandé par
// Arié, affichée pour l'instant en aperçu sur l'accueil (calendrier complet,
// synchro téléphone et rappels de fêtes = phase suivante, discutée à part).
let tasks = [];
// Brouillon d'idée/message pour chaque occurrence de fête juive (clé =
// JEWISH_HOLIDAYS[].key), pour pouvoir le retravailler et l'affiner au fil
// du temps au lieu de repartir d'un message figé à chaque fois.
let holidayNotes = {};
// Suivi comptable des reçus CERFA : une ligne ajoutée à chaque génération OU
// régénération d'un reçu, à donner à l'expert-comptable (export CSV/Excel
// depuis l'onglet Reçus). Le numéro de reçu, lui, est stocké directement sur
// le paiement (p.receiptNumber) et ne change jamais une fois attribué —
// régénérer un reçu réémet le même numéro, mais ajoute quand même une
// nouvelle ligne ici pour tracer l'événement.
let receiptLog = [];
// Doublons détectés (même email ou même téléphone) qu'on a explicitement
// marqués comme "ce ne sont pas de vrais doublons" (ex : un couple qui
// partage un email) : la clé du groupe ("email:xxx@yyy.fr" ou
// "phone:0601020304") est ajoutée ici pour que ce groupe ne réapparaisse
// plus jamais dans l'onglet Doublons, même si l'email/téléphone reste identique.
let dismissedDuplicates = [];
// Campagnes de collecte : { id, name, goal, startDate, endDate, note, archived }.
// Un don est rattaché à une campagne quand son "occasion" porte le nom de la
// campagne — la saisie reste donc un simple champ Occasion.
let campaigns = [];

const apps = [
  ["HelloAsso", "Collecter"], ["Stripe", "Collecter"], ["GoCardless", "Collecter"], ["iRaiser", "Collecter"],
  ["Brevo", "Communiquer"], ["Mailchimp", "Communiquer"], ["Mailjet", "Communiquer"], ["Gmail / Outlook IMAP", "Communiquer"],
  ["Google Calendar", "Recruter"], ["Gravity Forms", "Recruter"], ["Pennylane", "Comptabilité"], ["Zapier", "Possibilités infinies"],
];

// [identifiant de vue, libellé, sous-pages, icône]
const navTree = [
  ["home", "Tableau de bord", [], "home"],
  ["crm", "Contacts", ["Contacts", "Structures", "Segments", "Groupes", "Liaisons"], "users"],
  ["follow", "Suivi", ["Tâches", "Interactions", "Portefeuille", "Anniversaires"], "tasks"],
  ["pay", "Collecte", ["Tous les paiements", "Promesses", "Campagnes", "Reçus"], "heart"],
  ["stats", "Statistiques", [], "chart"],
  ["imports", "Imports", [], "upload"],
  ["settings", "Paramètres", ["Mon compte", "Champs personnalisés", "Catégories d'interaction", "Intégrations"], "settings"],
  ["admin", "Administration", ["Utilisateurs", "Journal d'activité"], "shield"],
];
const DEFAULT_SECTIONS = { home: "Accueil", stats: "Vue d'ensemble", imports: "Imports" };
function defaultSection(view) {
  const entry = navTree.find(([id]) => id === view);
  return (entry && entry[2][0]) || DEFAULT_SECTIONS[view] || "Accueil";
}

// Sert aussi à valider une adresse de page (voir applyHash dans app-tools.js).
const titles = {
  home: ["Tableau de bord", ""],
  crm: ["Contacts", ""],
  follow: ["Suivi", ""],
  pay: ["Collecte", ""],
  stats: ["Statistiques", ""],
  imports: ["Imports", ""],
  settings: ["Paramètres", ""],
  admin: ["Administration", ""],
};

function seedFromImportedContacts() {
  records = importedContacts.map(c => {
    // Les anciens champs "amount/amount2025/amount2026/payments/interactions" du fichier
    // d'import brut sont l'historique d'avant le CRM : on les range dans les compteurs
    // "imported*" (jamais mélangés avec les dons/interactions saisis en direct ensuite).
    const { amount, amount2025, amount2026, payments: importedPayments, interactions: importedInteractions, ...rest } = c;
    return {
      kind: "Contact",
      tags: [], groups: [], groupRoles: [], segments: [],
      paymentSources: [], paymentMethods: [],
      importedAmount: Number(amount || 0),
      importedAmount2025: Number(amount2025 || 0),
      importedAmount2026: Number(amount2026 || 0),
      importedPaymentsCount: Number(importedPayments || 0),
      importedInteractionsCount: Number(importedInteractions || 0),
      ...rest,
    };
  });
  payments = [];
  interactions = [];
  imports = importedContacts.length ? [{
    status: "Terminé",
    date: todayStr(),
    file: "Import initial (échantillon en attendant le fichier complet)",
    user: "Équipe Sinaï",
    type: "Contacts",
    rows: importedContacts.length,
    errors: 0,
    created: importedContacts.length,
    updated: 0,
    duplicates: 0,
    rejected: 0,
  }] : [];
  users = [];
  groups = [];
  linkages = [];
  auditLog = importedContacts.length ? [{ id: "AUD-seed", date: todayStr(), at: nowIso(), text: `Import initial de ${importedContacts.length} contacts.`, user: "Système" }] : [];
}

/* ---------- 4. Aides de données ------------------------------------------ */

// Index par id : évite un balayage complet des tableaux à chaque fiche affichée.
// Avec plusieurs milliers de contacts et de paiements, un .filter()/.find() répété
// pour chaque ligne rendrait l'écran des contacts très lent (des millions de
// comparaisons) — on reconstruit ces index une fois par rendu à la place.
let recordsIndex = new Map();
let paymentsIndex = new Map();
let interactionsIndex = new Map();

// Index par fiche, construits une seule fois par rendu (comme paymentsIndex),
// pour que les filtres avancés (année, type, occasion, statut payé/en attente,
// récurrence) restent rapides même avec ~11 000 paiements : years/paymentTypes/
// occasions sont des Set (une fiche peut avoir donné plusieurs années ou
// plusieurs types), payStatus distingue juste "au moins un paiement payé" /
// "au moins un en attente" pour cette fiche.
let recordYearsIndex = new Map();
let recordOccasionsIndex = new Map();
let recordPaymentTypesIndex = new Map();
let recordPayStatusIndex = new Map();
// Par fiche : { received, thisYear, lastYear, pending, count, lastIso, firstIso }
// (montants réellement reçus, promesses en cours, dates du premier/dernier don).
let recordMetricsIndex = new Map();
const EMPTY_METRICS = Object.freeze({ received: 0, thisYear: 0, lastYear: 0, pending: 0, count: 0, lastIso: "", firstIso: "" });

function rebuildIndexes() {
  recordsIndex = new Map(records.map(r => [r.id, r]));
  paymentsIndex = new Map();
  recordYearsIndex = new Map();
  recordOccasionsIndex = new Map();
  recordPaymentTypesIndex = new Map();
  recordPayStatusIndex = new Map();
  recordMetricsIndex = new Map();
  const thisYear = String(new Date().getFullYear());
  const lastYear = String(new Date().getFullYear() - 1);
  payments.forEach(p => {
    if (!p.recordId) return;
    if (!paymentsIndex.has(p.recordId)) paymentsIndex.set(p.recordId, []);
    paymentsIndex.get(p.recordId).push(p);
    let m = recordMetricsIndex.get(p.recordId);
    if (!m) { m = { received: 0, thisYear: 0, lastYear: 0, pending: 0, count: 0, lastIso: "", firstIso: "" }; recordMetricsIndex.set(p.recordId, m); }
    const got = paymentReceivedAmount(p);
    if (paymentIsPending(p)) m.pending += Math.max(0, paymentRemaining(p));
    if (got > 0) {
      const iso = paymentIso(p);
      m.received += got;
      m.count += 1;
      if (iso.startsWith(thisYear)) m.thisYear += got;
      else if (iso.startsWith(lastYear)) m.lastYear += got;
      if (iso && iso > m.lastIso) m.lastIso = iso;
      if (iso && (!m.firstIso || iso < m.firstIso)) m.firstIso = iso;
    }
    const year = paymentYear(p);
    if (year) {
      if (!recordYearsIndex.has(p.recordId)) recordYearsIndex.set(p.recordId, new Set());
      recordYearsIndex.get(p.recordId).add(year);
    }
    (p.occasion || []).forEach(o => {
      if (!o) return;
      if (!recordOccasionsIndex.has(p.recordId)) recordOccasionsIndex.set(p.recordId, new Set());
      recordOccasionsIndex.get(p.recordId).add(o);
    });
    if (p.type) {
      if (!recordPaymentTypesIndex.has(p.recordId)) recordPaymentTypesIndex.set(p.recordId, new Set());
      recordPaymentTypesIndex.get(p.recordId).add(p.type);
    }
    if (!recordPayStatusIndex.has(p.recordId)) recordPayStatusIndex.set(p.recordId, new Set());
    recordPayStatusIndex.get(p.recordId).add(paymentPayStatus(p));
  });
  paymentsIndex.forEach(list => list.sort((a, b) => paymentSortKey(b).localeCompare(paymentSortKey(a))));
  interactionsIndex = new Map();
  interactions.forEach(i => {
    if (!i.recordId) return;
    if (!interactionsIndex.has(i.recordId)) interactionsIndex.set(i.recordId, []);
    interactionsIndex.get(i.recordId).push(i);
  });
  interactionsIndex.forEach(list => list.sort((a, b) => (b.at || "").localeCompare(a.at || "")));
  refreshDuplicateGroups();
}

function recordById(id) {
  return recordsIndex.get(id) || null;
}

function recordLivePayments(recordId) {
  return paymentsIndex.get(recordId) || [];
}

function recordLiveInteractions(recordId) {
  return interactionsIndex.get(recordId) || [];
}

// Total réellement donné : historique importé avant le CRM + ce qui a
// effectivement été reçu depuis (un don promis mais pas encore versé, ou un
// paiement qui a échoué, n'est pas compté — la part déjà versée d'une
// promesse échelonnée, si).
function recordTotalAmount(r) {
  return Number(r.importedAmount || 0) + recordMetrics(r).received;
}
function recordPaymentsCount(r) {
  return Number(r.importedPaymentsCount || 0) + recordLivePayments(r.id).length;
}
function recordInteractionsCount(r) {
  return Number(r.importedInteractionsCount || 0) + recordLiveInteractions(r.id).length;
}

// Année d'un paiement, pour le filtre "Année" : même logique que
// paymentPrimaryDate (date de paiement réelle si reçu, sinon date de la
// promesse, sinon l'ancienne date de saisie historique au format "JJ/MM/AAAA").
// paymentDate/promiseDate sont au format ISO ("AAAA-MM-JJ") ; p.date (import
// historique, ~11 000 paiements) est toujours "JJ/MM/AAAA" — on en extrait les
// 4 derniers chiffres plutôt que de supposer un séparateur précis.
function paymentYear(p) {
  if (p.status === "Reçu" && p.paymentDate) return p.paymentDate.slice(0, 4);
  if (p.promiseDate) return p.promiseDate.slice(0, 4);
  const match = String(p.date || "").match(/(\d{4})\s*$/);
  return match ? match[1] : "";
}
// Regroupe les statuts de paiement, très divers dans les données historiques,
// en deux catégories simples pour le filtre "Déjà payé / En attente" : un
// paiement en attente (PENDING_PAYMENT_STATUSES) reste "attente" ; tout le
// reste (validé, encaissé, "Reçu"...) est compté "payé" — y compris un
// paiement historique "Paiement non effectué", qui n'est ni une rentrée à
// venir ni, au sens strict, "en attente" : on ne le fait pas remonter dans un
// des deux groupes faute d'un troisième statut demandé par l'utilisateur.
function paymentPayStatus(p) {
  return PENDING_PAYMENT_STATUSES.has(p.status) ? "attente" : "paye";
}
// Campus déduit des étiquettes de la fiche (PSBM/AESBM/PSBH/AESBH, etc.) :
// record.school n'est jamais rempli dans les vraies données, alors que ces
// codes d'étiquette le sont déjà. "BM" = Beth Mena'hem, "BH" = Beth Hilel.
function recordCampuses(r) {
  const found = new Set();
  (r.tags || []).forEach(t => {
    const up = String(t).toUpperCase();
    if (up.includes("BM")) found.add("Beth Mena'hem");
    if (up.includes("BH")) found.add("Beth Hilel");
  });
  return [...found];
}
// "Récurrent" = a donné sur au moins deux années civiles différentes.
function recordIsRecurring(r) {
  return (recordYearsIndex.get(r.id) || new Set()).size >= 2;
}
function recordPaymentYears(r) {
  return [...(recordYearsIndex.get(r.id) || [])];
}
function recordOccasions(r) {
  return [...(recordOccasionsIndex.get(r.id) || [])];
}
function recordPaymentTypes(r) {
  return [...(recordPaymentTypesIndex.get(r.id) || [])];
}
function recordPayStatuses(r) {
  return [...(recordPayStatusIndex.get(r.id) || [])];
}
function recordMetrics(r) {
  return recordMetricsIndex.get(r.id) || EMPTY_METRICS;
}

// Date d'un paiement au format AAAA-MM-JJ, quelle que soit son origine : date
// de paiement réelle si reçu, sinon date de la promesse, sinon l'ancienne
// date de saisie des imports ("JJ/MM/AAAA").
function paymentIso(p) {
  if (p.status === "Reçu" && p.paymentDate) return String(p.paymentDate).slice(0, 10);
  if (p.promiseDate) return String(p.promiseDate).slice(0, 10);
  const m = String(p.date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return String(p.at || "").slice(0, 10);
}
function paymentSortKey(p) {
  return `${paymentIso(p)}|${p.at || ""}`;
}
function paymentIsPending(p) {
  return PENDING_PAYMENT_STATUSES.has(p.status);
}
// Paiement qui n'a pas abouti (statuts historiques : "Paiement non effectué",
// annulé, rejeté, remboursé...) : ni une rentrée, ni une promesse en cours.
function paymentIsFailed(p) {
  return /non effectu|annul|rejet|rembours|[ée]chou|refus/i.test(p.status || "");
}
// Ce qui est réellement arrivé pour ce paiement : tout le montant s'il est
// reçu, seulement les versements déjà faits s'il est encore en attente.
function paymentReceivedAmount(p) {
  if (paymentIsFailed(p)) return 0;
  if (paymentIsPending(p)) return Math.min(paymentPaidTotal(p), Number(p.amount || 0));
  return Number(p.amount || 0);
}
// Où en est la relation avec ce donateur, d'un coup d'œil.
function donorStage(r) {
  const m = recordMetrics(r);
  const year = String(new Date().getFullYear());
  if (m.thisYear > 0) {
    if (m.firstIso.startsWith(year) && !Number(r.importedAmount || 0)) return { key: "new", label: "Nouveau donateur", tone: "blue" };
    return { key: "active", label: recordIsRecurring(r) ? "Fidèle" : "Actif", tone: "ok" };
  }
  if (m.lastYear > 0) return { key: "lapsed", label: "À relancer", tone: "warn" };
  if (m.pending > 0) return { key: "pledge", label: "Promesse en cours", tone: "violet" };
  if (m.count > 0 || Number(r.importedAmount || 0) > 0) return { key: "inactive", label: "Ancien donateur", tone: "" };
  return null;
}
function distinctTags() {
  const counts = new Map();
  records.forEach(r => (r.tags || []).forEach(t => counts.set(t, (counts.get(t) || 0) + 1)));
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([t]) => t);
}
// Une liaison désigne ses deux fiches par identifiant ; les liaisons créées
// avant ne portaient que les noms, qu'on retrouve alors par le nom.
function linkageSide(l, side) {
  const id = l[`${side}Id`];
  return (id && recordById(id)) || records.find(r => r.name === l[side]) || null;
}
function recordLinkages(r) {
  return linkages.filter(l => linkageSide(l, "a") === r || linkageSide(l, "b") === r);
}
// Supprime des fiches et tout ce qui leur est rattaché (dons, interactions,
// tâches, liaisons). Renvoie une fonction qui annule la suppression.
function removeRecords(ids) {
  const gone = {
    records: records.filter(r => ids.has(r.id)),
    payments: payments.filter(p => ids.has(p.recordId)),
    interactions: interactions.filter(i => ids.has(i.recordId)),
    tasks: tasks.filter(t => ids.has(t.recordId)),
    linkages: linkages.filter(l => ids.has(l.aId) || ids.has(l.bId)),
  };
  records = records.filter(r => !ids.has(r.id));
  payments = payments.filter(p => !ids.has(p.recordId));
  interactions = interactions.filter(i => !ids.has(i.recordId));
  tasks = tasks.filter(t => !ids.has(t.recordId));
  linkages = linkages.filter(l => !(ids.has(l.aId) || ids.has(l.bId)));
  ids.forEach(id => state.selection.delete(id));
  return () => {
    records = [...gone.records, ...records];
    payments = [...gone.payments, ...payments];
    interactions = [...gone.interactions, ...interactions];
    tasks = [...gone.tasks, ...tasks];
    linkages = [...gone.linkages, ...linkages];
    logAudit(`Suppression annulée : ${gone.records.map(r => r.name || r.id).slice(0, 3).join(", ")}${gone.records.length > 3 ? "…" : ""}.`);
    saveCrmData();
    render();
    notify("Suppression annulée");
  };
}

/* ---------- 4bis. Détection des doublons (même email / même téléphone) --- */

// Normalise un numéro pour comparer "06 12 34 56 78", "06.12.34.56.78" et
// "+33 6 12 34 56 78" comme le même numéro (sinon on rate plein de vrais
// doublons juste à cause du format de saisie).
function normalizePhoneKey(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0033") && digits.length > 4) return "0" + digits.slice(4);
  if (digits.startsWith("33") && digits.length > 2 && !digits.startsWith("0")) return "0" + digits.slice(2);
  return digits;
}
function uniqueById(list) {
  const seen = new Set();
  return list.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}
// Un groupe = plusieurs fiches distinctes qui partagent le même email ou le
// même téléphone (phone OU phone2). Quand exactement les mêmes fiches
// partagent À LA FOIS le même email ET le même téléphone, on fusionne les
// deux en une seule carte (sinon la même paire apparaîtrait deux fois dans
// la liste). Les groupes explicitement écartés ("Nom séparé") ne sont plus
// jamais recalculés/affichés, même si l'email/téléphone reste identique.
function computeDuplicateGroups() {
  const byEmail = new Map();
  const byPhone = new Map();
  records.forEach(r => {
    const email = String(r.email || "").toLowerCase().trim();
    if (email) { if (!byEmail.has(email)) byEmail.set(email, []); byEmail.get(email).push(r); }
    [r.phone, r.phone2].forEach(raw => {
      const key = normalizePhoneKey(raw);
      if (key) { if (!byPhone.has(key)) byPhone.set(key, []); byPhone.get(key).push(r); }
    });
  });
  const merged = new Map(); // clé = ids triés, valeur = { matchKeys, reasons, displays, records }
  function addGroup(matchKey, reasonLabel, display, uniqList) {
    const idSetKey = uniqList.map(r => r.id).sort().join(",");
    if (!merged.has(idSetKey)) merged.set(idSetKey, { matchKeys: [], reasons: [], displays: [], records: uniqList });
    const entry = merged.get(idSetKey);
    entry.matchKeys.push(matchKey);
    entry.reasons.push(reasonLabel);
    entry.displays.push(display);
  }
  byEmail.forEach((list, value) => {
    const uniq = uniqueById(list);
    if (uniq.length > 1) addGroup(`email:${value}`, "même email", uniq[0].email || value, uniq);
  });
  byPhone.forEach((list, value) => {
    const uniq = uniqueById(list);
    if (uniq.length > 1) {
      const withPhone = uniq.find(r => normalizePhoneKey(r.phone) === value);
      addGroup(`phone:${value}`, "même téléphone", (withPhone && withPhone.phone) || value, uniq);
    }
  });
  const groups = [];
  merged.forEach(entry => {
    // "key" (composite) sert d'identifiant unique pour les actions (fusionner/
    // effacer/nom séparé) ; "matchKeys" liste les clés individuelles à écarter
    // pour de bon quand on clique "Nom séparé".
    groups.push({
      key: entry.matchKeys.join("|"),
      matchKeys: entry.matchKeys,
      reason: entry.reasons.join(" et "),
      display: entry.displays.join(" / "),
      records: entry.records,
    });
  });
  return groups.filter(g => !g.matchKeys.some(k => dismissedDuplicates.includes(k)));
}
// Recalculé une fois par rendu (voir rebuildIndexes) plutôt qu'à chaque
// affichage de fiche, pour le même motif de performance que les index
// records/payments/interactions juste au-dessus.
let duplicateGroupsCache = [];
function refreshDuplicateGroups() {
  duplicateGroupsCache = computeDuplicateGroups();
}
function recordDuplicateGroups(id) {
  return duplicateGroupsCache.filter(g => g.records.some(r => r.id === id));
}
function isRecordDuplicated(id) {
  return recordDuplicateGroups(id).length > 0;
}

// Identifiant d'un nouvel élément : numéro à la suite du plus grand existant,
// suivi de deux caractères tirés au hasard (ex : C-1204K7). Depuis que
// plusieurs personnes peuvent enregistrer en même temps, deux navigateurs
// pouvaient sinon attribuer le même numéro à deux fiches différentes, et la
// seconde aurait remplacé la première.
function nextId(prefix, list) {
  const re = new RegExp(`^${prefix}-(\\d+)`);
  let max = 1000;
  list.forEach(item => { const m = re.exec(String(item.id || "")); if (m) max = Math.max(max, Number(m[1])); });
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase().padEnd(2, "X");
  return `${prefix}-${String(max + 1).padStart(4, "0")}${suffix}`;
}

function splitTags(value) {
  return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
}

/* ---------- 5. Aides de rendu -------------------------------------------- */

function euro(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0));
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}
function tag(text, tone = "") {
  return `<span class="tag ${tone}">${escapeHtml(text)}</span>`;
}
function status(text) {
  const lower = String(text).toLowerCase();
  const tone = lower.includes("valide") || lower.includes("termine") || lower.includes("genere") || lower.includes("envoye") || lower.includes("reçu") ? "ok"
    : lower.includes("erreur") || lower.includes("non eligible") ? "bad"
    : lower.includes("attente") || lower.includes("reprendre") || lower.includes("generer") || lower.includes("promis") ? "warn" : "";
  return `<span class="status ${tone}">${escapeHtml(text)}</span>`;
}
function action(label, key, cls = "") {
  return `<button type="button" class="${cls}" data-action="${escapeHtml(key || label)}">${escapeHtml(label)}</button>`;
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
}
// Date de naissance civile (sélecteur de date) + "après le coucher du
// soleil", avec la date hébraïque calculée en direct sous le champ.
function dobFields(r) {
  const iso = parseDob(r.dob);
  const preview = iso ? recordHebrewBirth({ dob: iso, dobAfterSunset: r.dobAfterSunset })?.label : "";
  return `<label>Date de naissance (civile)<input name="dob" type="date" value="${escapeHtml(iso)}" data-dob-input><small class="dob-preview" data-dob-preview>${preview ? `Date hébraïque : ${escapeHtml(preview)}` : "La date hébraïque sera calculée automatiquement"}</small></label>
    ${selectField("Né(e) après le coucher du soleil ?", "dobAfterSunset", ["Non", "Oui"], r.dobAfterSunset ? "Oui" : "Non")}`;
}
function wireDobPreview(root) {
  const input = root.querySelector("[data-dob-input]");
  if (!input) return;
  const sunset = root.querySelector('[name="dobAfterSunset"]');
  const out = root.querySelector("[data-dob-preview]");
  const update = () => {
    const heb = input.value ? recordHebrewBirth({ dob: input.value, dobAfterSunset: sunset?.value === "Oui" }) : null;
    out.textContent = heb ? `Date hébraïque : ${heb.label}` : "La date hébraïque sera calculée automatiquement";
  };
  input.addEventListener("input", update);
  input.addEventListener("change", update);
  sunset?.addEventListener("change", update);
}
function textareaField(label, name, value = "", extra = "") {
  return `<label class="span-2">${label}<textarea name="${name}" ${extra}>${escapeHtml(value)}</textarea></label>`;
}
function selectField(label, name, options, value = "") {
  return `<label>${label}<select name="${name}">${options.map(o => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select></label>`;
}
// Certains paiements importés avant le CRM portent un statut ou un reçu qui
// n'existe plus dans les listes actuelles de l'app (ex : "Chèque encaissé",
// "Généré ailleurs"). Sans ça, ouvrir la modale de modification sur un tel
// paiement afficherait une valeur par défaut différente dans le menu
// déroulant et, si l'utilisateur enregistre sans y toucher, écraserait
// silencieusement la vraie valeur d'origine par ce défaut. On ajoute donc la
// valeur actuelle à la liste si elle n'y est pas déjà, pour qu'elle reste
// sélectionnée et fidèlement conservée.
function ensureOption(list, value) {
  return value && !list.includes(value) ? [...list, value] : list;
}
// Sélecteur de catégorie d'interaction avec un bouton "+" pour créer un
// nouveau libellé (ex : Chiour) sans quitter le formulaire — en plus de la
// gestion complète dans Paramètres > Catégories d'interaction.
function categoryField(value) {
  return `<div class="category-field-wrap">
    <label>Catégorie<select name="category">${interactionCategories.map(o => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select></label>
    <button type="button" class="icon-btn" data-add-category-inline title="Créer une nouvelle catégorie">+</button>
  </div>`;
}
function wireCategoryAdders(root) {
  root.querySelectorAll("[data-add-category-inline]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const name = await uiPrompt("Nom de la nouvelle catégorie", "", { title: "Nouvelle catégorie", placeholder: "Ex : Chiour" });
      if (!name) return;
      if (!interactionCategories.some(c => c.toLowerCase() === name.toLowerCase())) {
        interactionCategories.push(name);
        logAudit(`Catégorie d'interaction ajoutée : ${name}.`);
        saveCrmData();
      }
      root.querySelectorAll('select[name="category"]').forEach(sel => {
        sel.innerHTML = interactionCategories.map(o => `<option value="${escapeHtml(o)}" ${o === name ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
      });
    });
  });
}

// Étiquettes/segments réellement présents dans les fiches — sert à construire
// la liste de catégories cochables lors de la création d'un compte à accès
// restreint, sans avoir à coder en dur les noms des écoles/catégories.
function distinctScopeTags() {
  const set = new Set();
  records.forEach(r => {
    (r.tags || []).forEach(t => set.add(t));
    (r.segments || []).forEach(t => set.add(t));
  });
  return [...set].sort((a, b) => a.localeCompare(b, "fr"));
}

// Légende des étiquettes définie par Arié (site par site) : sert uniquement à
// afficher un libellé lisible dans l'écran de création de compte — la valeur
// réellement stockée/filtrée reste le code brut (ex: "AESBH").
const SCOPE_TAG_LABELS = {
  "P": "Parents (général)",
  "AE": "Anciens élèves (général)",
  "PSBH": "Parents – Beth Hillel",
  "PBH": "Parents – Beth Hillel",
  "PSBM": "Parents – Beth Menahem",
  "AESBH": "Anciens élèves – Beth Hillel",
  "AEBH": "Anciens élèves – Beth Hillel",
  "AESBM": "Anciens élèves – Beth Menahem",
  "AEBM": "Anciens élèves – Beth Menahem",
  "PS17": "Parents – Kitov (17e)",
  "AES17": "Anciens élèves – Kitov (17e)",
  "PS18": "Parents – Sinaï 18 (18e)",
  "AES18": "Anciens élèves – Sinaï 18 (18e)",
  "PS20": "Parents – Heikhal (20e)",
  "AES20": "Anciens élèves – Heikhal (20e)",
  "PS16": "Parents – Beth Zalmi (16e)",
  "AES16": "Anciens élèves – Beth Zalmi (16e)",
  "PGIS18": "Parents – Gan Israël 18",
  "AEGIS18": "Anciens élèves – Gan Israël 18",
  "PGISL": "Parents – Gan Israël Levallois",
  "AEGISL": "Anciens élèves – Gan Israël Levallois",
  "Cercle Rav": "Portefeuille donateurs – Rav",
  "Cercle Arie": "Portefeuille donateurs – Arié",
  "Corps enseignant": "Corps enseignant",
  "Allodons": "Origine : Allodons",
  "BilletWeb": "Origine : BilletWeb",
  "GALA": "Gala",
  "GALA 2024": "Gala 2024",
  "Donateur/Donatrice": "Donateur / Donatrice",
  "Participant(e)": "Participant(e)",
  "KITOV": "Kitov",
};

function scopeTagLabel(tag) {
  const friendly = SCOPE_TAG_LABELS[tag];
  return friendly ? `${friendly} (${tag})` : tag;
}

function accountFormFields(existing) {
  const tags = distinctScopeTags();
  const scopeMode = existing ? existing.scopeMode : "all";
  const scopeTags = new Set(existing ? existing.scopeTags || [] : []);
  return `
    <input type="hidden" name="accountId" value="${existing ? escapeHtml(existing.id) : ""}">
    ${field("Prénom", "first", existing ? existing.first || "" : "")}
    ${field("Nom", "last", existing ? existing.last || "" : "")}
    ${field("Email", "email", existing ? existing.email || "" : "", "email", `required placeholder='prenom@sinai.fr' ${existing ? "readonly" : ""}`)}
    ${field(existing ? "Nouveau mot de passe" : "Mot de passe", "password", "", "password", existing ? "minlength='8' placeholder='Laisser vide pour ne pas changer'" : "required minlength='8' placeholder='8 caractères minimum'")}
    ${selectField("Profil", "profile", ["Administrateur", "Collecte", "Comptabilité", "Lecture seule"], existing ? existing.profile : "Lecture seule")}
    <div class="span-2">
      <label>Accès aux contacts</label>
      <div class="account-scope-mode">
        <label style="display:flex;align-items:center;gap:6px;font-weight:500;"><input type="radio" name="scopeMode" value="all" ${scopeMode === "all" ? "checked" : ""}> Tous les contacts</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:500;"><input type="radio" name="scopeMode" value="tags" ${scopeMode === "tags" ? "checked" : ""}> Certaines catégories seulement</label>
      </div>
      <div class="scope-tags">${tags.length
        ? tags.map(t => `<label class="scope-tag-chip"><input type="checkbox" name="scopeTag" value="${escapeHtml(t)}" ${scopeTags.has(t) ? "checked" : ""}> ${escapeHtml(scopeTagLabel(t))}</label>`).join("")
        : "<span class='muted-note'>Aucune étiquette ou segment détecté pour l'instant dans les fiches.</span>"}</div>
    </div>`;
}

async function submitAccountForm(form) {
  const fd = new FormData(form);
  const id = fd.get("accountId");
  const scopeMode = fd.get("scopeMode") || "all";
  const scopeTags = scopeMode === "tags" ? fd.getAll("scopeTag") : [];
  const payload = {
    first: fd.get("first") || "",
    last: fd.get("last") || "",
    profile: fd.get("profile") || "Lecture seule",
    scopeMode, scopeTags,
  };
  const password = fd.get("password");
  if (password) payload.password = password;
  try {
    if (id) {
      await apiUpdateAccount(id, payload);
      logAudit(`Compte modifié : ${fd.get("email") || id}.`);
      notify("Compte mis à jour");
    } else {
      if (!password) { notify("Mot de passe requis"); return; }
      payload.email = fd.get("email");
      await apiCreateAccount(payload);
      logAudit(`Compte créé : ${payload.email}.`);
      notify("Compte créé");
    }
    dialog().close();
    await refreshAccounts();
    render();
  } catch (err) {
    notify(err.message || "Erreur");
  }
}

async function deleteAccount(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  if (!await uiConfirm(`Supprimer le compte de ${acc.email} ? Cette personne ne pourra plus se connecter.`, { title: "Supprimer le compte", danger: true, okLabel: "Supprimer" })) return;
  try {
    await apiDeleteAccount(id);
    logAudit(`Compte supprimé : ${acc.email}.`);
    notify("Compte supprimé");
    await refreshAccounts();
    render();
  } catch (err) {
    notify(err.message || "Erreur");
  }
}

async function refreshAccounts() {
  if (!currentAccount || currentAccount.profile !== "Administrateur") { accounts = []; return; }
  try { accounts = await apiListAccounts(); } catch { accounts = []; }
}

// Sélecteur de contact/structure avec recherche live : un <select> classique
// serait injouable avec 10 000+ fiches (rendu lent, impossible à parcourir).
// On affiche un champ texte + une liste filtrée, et on stocke l'id choisi dans
// un champ caché (recordId) — c'est ce champ que lisent les handlers d'envoi.
function pickerField(label, name, selected, required = true, allowCreate = false) {
  const displayValue = selected ? selected.name : "";
  const idValue = selected ? selected.id : "";
  const inner = `<label class="${allowCreate ? "" : "span-2 "}picker-wrap" data-picker="${name}">${label}
    <input type="text" class="picker-input" data-picker-input="${name}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Rechercher un nom, un email..." value="${escapeHtml(displayValue)}">
    <input type="hidden" name="${name}" data-picker-value="${name}" value="${escapeHtml(idValue)}"${required ? " required" : ""}>
    <div class="picker-results" data-picker-results="${name}"></div>
  </label>`;
  if (!allowCreate) return inner;
  // Bouton "+" pour créer un nouveau contact au vol si celui recherché
  // n'existe pas encore (ex : lier une tâche à quelqu'un pas encore au CRM).
  return `<div class="category-field-wrap span-2">${inner}<button type="button" class="icon-btn" data-picker-create="${name}" title="Créer un nouveau contact et le lier">+</button></div>`;
}
function wirePickers(root) {
  root.querySelectorAll("[data-picker-input]").forEach(input => {
    const key = input.dataset.pickerInput;
    const hidden = root.querySelector(`[data-picker-value="${key}"]`);
    const results = root.querySelector(`[data-picker-results="${key}"]`);
    const showResults = (term) => {
      const q = normalizeSearchText(term).trim();
      let list = records;
      if (q) list = records.filter(r => normalizeSearchText(r.name).includes(q) || normalizeSearchText(r.email).includes(q));
      list = list.slice(0, 8);
      results.innerHTML = list.length
        ? list.map(r => `<button type="button" class="picker-result" data-pick="${r.id}">${escapeHtml(r.name)}<span>${r.kind}${r.email ? " · " + escapeHtml(r.email) : ""}</span></button>`).join("")
        : `<div class="picker-empty">Aucun résultat</div>`;
      results.classList.add("open");
      results.querySelectorAll("[data-pick]").forEach(btn => btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const rec = recordById(btn.dataset.pick);
        if (!rec) return;
        input.value = rec.name;
        hidden.value = rec.id;
        results.classList.remove("open");
      }));
    };
    // Le champ est pré-rempli avec la fiche déjà sélectionnée (pour ne pas
    // partir d'un formulaire vide). Sans le select() ci-dessous, cliquer
    // dedans pour chercher quelqu'un d'autre plaçait juste le curseur dans
    // ce texte existant : les lettres tapées s'ajoutaient au nom déjà là
    // (ex. "David DadounTf") au lieu de le remplacer — d'où l'impression
    // que le formulaire "mettait" tout seul un autre contact. setTimeout(0) :
    // un clic replace le curseur à l'endroit cliqué juste après l'événement,
    // ce qui annulerait un select() appelé de façon synchrone ; on le
    // déclenche donc juste après, une fois ce repositionnement natif fait.
    // On écoute aussi "click" (pas seulement "focus") : le champ étant déjà
    // focus au premier tap (modalShell le fait à l'ouverture de la modale),
    // "focus" ne se redéclenche pas aux clics suivants, alors que "click" si.
    const selectAllSoon = () => setTimeout(() => input.select(), 0);
    // La liste ne s'ouvre d'elle-même que si aucun contact n'est encore
    // choisi : sinon elle recouvrait les champs suivants dès l'ouverture du
    // formulaire (le premier champ reçoit le focus automatiquement).
    input.addEventListener("focus", () => { selectAllSoon(); if (!hidden.value) showResults(input.value); });
    input.addEventListener("click", selectAllSoon);
    input.addEventListener("input", () => { hidden.value = ""; showResults(input.value); });
    input.addEventListener("blur", () => setTimeout(() => results.classList.remove("open"), 120));
  });
  root.querySelectorAll("[data-picker-create]").forEach(btn => {
    const key = btn.dataset.pickerCreate;
    btn.addEventListener("click", async () => {
      const input = root.querySelector(`[data-picker-input="${key}"]`);
      const hidden = root.querySelector(`[data-picker-value="${key}"]`);
      const name = await uiPrompt("Prénom et nom du nouveau contact", input ? input.value.trim() : "", { title: "Nouveau contact", placeholder: "Prénom Nom", okLabel: "Créer" });
      if (!name) return;
      const rec = quickCreateContact(name);
      if (!rec) return;
      if (input) input.value = rec.name;
      if (hidden) hidden.value = rec.id;
      notify(`Contact "${rec.name}" créé et lié`);
    });
  });
}
function emptyState(text, actionLabel, actionKey) {
  return `<div class="empty-state"><p>${escapeHtml(text)}</p>${actionKey ? action(actionLabel, actionKey, "primary-btn") : ""}</div>`;
}

const content = () => document.querySelector("#content");
const nav = () => document.querySelector("#nav");
const viewTitle = () => document.querySelector("#viewTitle");
const viewSubtitle = () => document.querySelector("#viewSubtitle");
const dialog = () => document.querySelector("#recordDialog");
const dialogContent = () => document.querySelector("#dialogContent");
const drawerEl = () => document.querySelector("#drawer");
const toastEl = () => document.querySelector("#toast");

// action (facultatif) : { label, run } ajoute un bouton dans le message, par
// exemple "Annuler" après une suppression ou "Voir la fiche" après un ajout.
function notify(message, warn = false, action = null) {
  const toast = toastEl();
  toast.innerHTML = `<span>${escapeHtml(message)}</span>${action ? `<button type="button" class="toast-action">${escapeHtml(action.label)}</button>` : ""}`;
  toast.classList.toggle("warn", !!warn);
  toast.classList.toggle("has-action", !!action);
  toast.classList.add("show");
  if (action) toast.querySelector("button").onclick = () => { toast.classList.remove("show"); action.run(); };
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), warn ? 6000 : action ? 7000 : 2600);
}

/* ---------- 6. Rendu des vues -------------------------------------------- */

// recordMatchesFilters() applique les filtres avancés du tiroir "Filtres"
// (montant, récurrence, campus, année, type de paiement, occasion, statut
// payé/en attente) ainsi que les segments (dynamiques ou historiques en texte
// libre). Chaque critère vide = indifférent (ne restreint rien) ; plusieurs
// valeurs cochées dans une même liste (ex : deux campus) sont en "OU" entre
// elles, et les critères entre eux sont en "ET".
function recordMatchesFilters(r, f) {
  if (!f || !filtersAreActive(f)) return true;
  if (f.amountMin && recordTotalAmount(r) < Number(f.amountMin)) return false;
  if (f.amountMax && recordTotalAmount(r) > Number(f.amountMax)) return false;
  if (f.recurring === "yes" && !recordIsRecurring(r)) return false;
  if (f.recurring === "no" && recordIsRecurring(r)) return false;
  if (f.campuses.length && !recordCampuses(r).some(c => f.campuses.includes(c))) return false;
  if (f.years.length && !recordPaymentYears(r).some(y => f.years.includes(y))) return false;
  if (f.paymentTypes.length && !recordPaymentTypes(r).some(t => f.paymentTypes.includes(t))) return false;
  if (f.occasions.length && !recordOccasions(r).some(o => f.occasions.includes(o))) return false;
  if (f.payStatus.length && !recordPayStatuses(r).some(s => f.payStatus.includes(s))) return false;
  if (f.segments.length && !(r.segments || []).some(s => f.segments.includes(s))) return false;
  if ((f.tags || []).length && !(r.tags || []).some(t => f.tags.includes(t))) return false;
  if (f.lastGift) {
    const last = recordMetrics(r).lastIso;
    const cutoff = addDaysIso(todayIso(), -365);
    if (f.lastGift === "12m" && !(last && last >= cutoff)) return false;
    if (f.lastGift === "old" && !(last && last < cutoff)) return false;
    if (f.lastGift === "never" && (last || Number(r.importedAmount || 0) > 0)) return false;
  }
  return true;
}
// Filtres rapides (pastilles au-dessus du répertoire).
const QUICK_FILTERS = [["", "Tous"], ["donors", "Donateurs"], ["new", "Nouveaux cette année"], ["lapsed", "À relancer"], ["pledge", "Promesses en cours"], ["mine", "Mon portefeuille"], ["noemail", "Sans email"]];
function recordMatchesQuick(r, quick) {
  if (!quick) return true;
  const m = recordMetrics(r);
  if (quick === "donors") return recordTotalAmount(r) > 0;
  if (quick === "new") return donorStage(r)?.key === "new";
  if (quick === "lapsed") return m.lastYear > 0 && m.thisYear === 0;
  if (quick === "pledge") return m.pending > 0;
  if (quick === "mine") return isInMyPortfolio(r);
  if (quick === "noemail") return !r.email;
  return true;
}
// Recherche sans tenir compte des accents ni de la casse ; plusieurs mots
// doivent tous être présents ; une suite de chiffres est aussi comparée aux
// téléphones sans espaces ni points.
function recordMatchesQuery(r, terms, digits) {
  if (!terms.length) return true;
  const hay = normalizeSearchText([r.name, r.email, r.secondaryEmails, r.phone, r.phone2, r.address, r.zip, r.city, r.family, r.id, ...(r.tags || []), ...(r.groups || [])].join(" "));
  if (terms.every(t => hay.includes(t))) return true;
  return digits.length >= 4 && `${r.phone || ""} ${r.phone2 || ""}`.replace(/\D/g, "").includes(digits);
}
function filteredRecords(queryOverride, filtersOverride) {
  const raw = queryOverride !== undefined ? queryOverride : state.query;
  const terms = normalizeSearchText(raw).split(/\s+/).filter(Boolean);
  const digits = String(raw).replace(/\D/g, "");
  const f = filtersOverride !== undefined ? filtersOverride : activeFilters();
  const quick = queryOverride === undefined && filtersOverride === undefined ? state.quick : "";
  return records.filter(r => recordMatchesQuery(r, terms, digits) && recordMatchesFilters(r, f) && recordMatchesQuick(r, quick));
}
// Liste du répertoire, filtrée puis triée selon l'en-tête de colonne choisi.
function sortedRecords(kind) {
  const rows = filteredRecords().filter(r => !kind || r.kind === kind);
  const { key, dir } = state.sort;
  if (key === "recent") return rows;
  const sign = dir === "asc" ? 1 : -1;
  const value = {
    name: r => normalizeSearchText(r.kind === "Structure" ? r.name : `${r.last || ""} ${r.first || ""} ${r.name || ""}`),
    total: r => recordTotalAmount(r),
    last: r => recordMetrics(r).lastIso,
    year: r => recordMetrics(r).thisYear,
  }[key] || (r => r.name || "");
  return [...rows].sort((a, b) => {
    const va = value(a), vb = value(b);
    if (va === vb) return 0;
    if (va === "" || va === 0) return 1;
    if (vb === "" || vb === 0) return -1;
    return (va < vb ? -1 : 1) * sign;
  });
}
function filteredPayments() {
  const terms = normalizeSearchText(state.query).split(/\s+/).filter(Boolean);
  const pf = state.payFilters;
  return payments.filter(p => {
    if (pf.type && p.type !== pf.type) return false;
    if (pf.year && !paymentIso(p).startsWith(pf.year)) return false;
    if (pf.method && p.method !== pf.method) return false;
    if (pf.status === "recu" && (paymentIsPending(p) || paymentIsFailed(p))) return false;
    if (pf.status === "attente" && !paymentIsPending(p)) return false;
    if (pf.status === "echec" && !paymentIsFailed(p)) return false;
    if (!terms.length) return true;
    const hay = normalizeSearchText([p.payer, p.email, p.type, p.status, p.method, p.receiptNumber, p.amount, ...(p.occasion || [])].join(" "));
    return terms.every(t => hay.includes(t));
  }).sort((a, b) => paymentSortKey(b).localeCompare(paymentSortKey(a)));
}
function currentRows() {
  if (state.view === "pay") return filteredPayments();
  if (state.view === "imports") return imports;
  if (state.view === "admin") return state.section === "Journal d'activité" ? auditLog : accounts;
  if (state.view === "follow" && state.section === "Interactions") return interactions;
  if (state.view === "crm" && state.section === "Groupes") return groups;
  if (state.view === "crm" && state.section === "Liaisons") return linkages;
  return filteredRecords();
}



function metric(label, value, note) {
  return `<div class="metric"><span class="eyebrow">${label}</span><strong>${value}</strong><p>${note}</p></div>`;
}



// ---- Stratégie des fêtes juives -------------------------------------------
// Logique d'un directeur de collecte de fonds pensée pour la mission de
// Sinaï (éducation juive, kirouv, vision de notre Rav) : avant chaque fête,
// l'accueil met en avant la prochaine échéance avec un conseil stratégique
// (quand solliciter, quand se contenter de vœux) et des modèles de message
// prêts à copier-coller (email + SMS/WhatsApp), plutôt que d'automatiser un
// envoi que ce CRM ne sait de toute façon pas faire (pas de messagerie
// intégrée). Dates vérifiées (calendrier hébraïque, diaspora) pour 2026 à
// 2028 ; à compléter chaque année pour la suite.
const HOLIDAY_TEMPLATES = {
  "roch-hachana": {
    strategy: "Moment fort pour ouvrir l'année avec gratitude : remercier chaleureusement pour l'année écoulée prépare le terrain pour la suite, sans qu'il soit nécessaire de solliciter directement dans ce message.",
    emailSubject: "Chana Tova Oumetouka 🍎 — Tous nos vœux des Institutions Sinaï",
    emailBody: "Chers amis,\n\nÀ l'aube de cette nouvelle année, toute l'équipe des Institutions Sinaï — élèves, enseignants et notre Rav — se joint à moi pour vous souhaiter une Chana Tova Oumetouka, une année douce et pleine de bénédictions pour vous et les vôtres.\n\nGrâce à votre soutien fidèle, des dizaines d'enfants continuent de grandir dans la joie d'apprendre et de vivre leur judaïsme. C'est une fierté que nous partageons avec vous.\n\nQue cette nouvelle année vous apporte santé, réussite et beaucoup de nahat.\n\nChana Tova !",
    sms: "Chana Tova Oumetouka ! Toute l'équipe des Institutions Sinaï vous souhaite une année douce et bénie, à vous et aux vôtres. Merci d'être à nos côtés. 🍎",
  },
  "yom-kippour": {
    strategy: "Message purement spirituel : Yom Kippour n'est pas un moment pour solliciter, mais pour exprimer un souhait sincère de pardon et d'inscription pour une bonne année.",
    emailSubject: "Guemar 'Hatima Tova — Nos vœux pour Yom Kippour",
    emailBody: "Chers amis,\n\nÀ la veille de Yom Kippour, nous vous souhaitons, ainsi qu'à toute votre famille, un Guemar 'Hatima Tova — d'être inscrits et scellés pour une année de vie, de santé et de paix.\n\nQue ce jour de recueillement soit source d'élévation pour vous, comme il l'est chaque année pour nos élèves qui en apprennent la portée avec notre Rav.\n\nTsom Kal,",
    sms: "Guemar 'Hatima Tova. Que vous soyez inscrits pour une année de vie, de santé et de paix. Tsom Kal 🕊️",
  },
  "souccot": {
    strategy: "L'hospitalité est au cœur de Souccot : c'est l'occasion idéale d'inviter un donateur à visiter l'école ou la Souccah plutôt que de simplement lui écrire.",
    emailSubject: "'Hag Sameach — Venez visiter notre Souccah !",
    emailBody: "Chers amis,\n\n'Hag Souccot Sameach ! En cette fête où l'on ouvre grand sa Souccah, nous serions heureux de vous accueillir pour partager un moment avec nos élèves et notre équipe.\n\nVotre soutien permet chaque jour à nos enfants de grandir entourés de joie et de valeurs juives authentiques — nous voulions, en cette fête de la joie, simplement vous en remercier.\n\n'Hag Sameach à vous et à toute votre famille !",
    sms: "'Hag Souccot Sameach ! Toute l'équipe Sinaï vous souhaite une fête pleine de joie, entourés des vôtres. 🌿",
  },
  "hanouka": {
    strategy: "Le moment classique de collecte de fin d'année : chaque bougie peut symboliser un enfant scolarisé grâce aux donateurs — un angle puissant, à condition de rester dans la gratitude plus que dans la demande directe.",
    emailSubject: "'Hag Ourim Sameach 🕎 — 8 bougies, 8 raisons de dire merci",
    emailBody: "Chers amis,\n\nEn cette fête des lumières, chaque bougie que nous allumons nous rappelle qu'un tout petit geste peut illuminer beaucoup d'obscurité — exactement ce que fait votre générosité pour nos élèves toute l'année.\n\nCette Hanouka, si le cœur vous en dit, votre soutien nous permettra d'offrir à davantage d'enfants une éducation juive de qualité, portée par la vision de notre Rav depuis trois générations.\n\n'Hag Ourim Sameach, et merci du fond du cœur.",
    sms: "'Hag Ourim Sameach ! Cette Hanouka, chaque bougie éclaire un enfant que vous aidez à grandir. Merci pour votre soutien. 🕎",
  },
  "tou-bichvat": {
    strategy: "Thème de la croissance et de la plantation : bien adapté pour évoquer un don régulier (« planter aujourd'hui pour récolter demain ») plutôt qu'un don ponctuel.",
    emailSubject: "'Hag Sameach 🌳 — Planter aujourd'hui, récolter demain",
    emailBody: "Chers amis,\n\nTou Bichvat nous rappelle qu'un arbre a besoin de temps, de patience et de constance pour porter ses fruits — comme l'éducation que nous donnons chaque jour à nos élèves.\n\nVotre soutien régulier est justement cette eau qui permet à cette « plantation » de grandir année après année. Nous vous en remercions sincèrement.\n\n'Hag Sameach !",
    sms: "'Hag Tou Bichvat Sameach ! Merci de faire grandir, avec nous, l'éducation juive de nos enfants, saison après saison. 🌳",
  },
  "pourim": {
    strategy: "Les Michloa'h Manot et Matanot LaEvyonim ancrent le don dans la tradition même de Pourim : c'est le moment de l'année où solliciter est le plus naturel et le mieux accueilli.",
    emailSubject: "Pourim Sameach 🎭 — Une Matanot LaEvyonim pour nos enfants ?",
    emailBody: "Chers amis,\n\nPourim Sameach ! Cette fête nous rappelle, à travers la Mitsva de Matanot LaEvyonim, combien donner fait partie intégrante de notre joie.\n\nCette année encore, nous comptons sur des amis comme vous pour permettre à chaque enfant de nos écoles de vivre Pourim dans la joie et l'abondance, comme il se doit.\n\nMerci d'avance pour votre générosité, et Pourim Sameach à toute la famille !",
    sms: "Pourim Sameach ! Comme le veut la tradition des Matanot LaEvyonim, aidez-nous à offrir à chaque enfant une fête de Pourim joyeuse. Merci ! 🎭",
  },
  "pessah": {
    strategy: "La Kimha D'Pis'ha (aide traditionnelle aux familles avant la fête) est un point d'entrée naturel et ancien pour une demande ciblée, en particulier pour les familles les plus modestes de nos écoles.",
    emailSubject: "'Hag Cacher Vesameach 🍷 — Offrir un Pessah serein à chaque famille",
    emailBody: "Chers amis,\n\nÀ l'approche de Pessah, la tradition de la Kimha D'Pis'ha nous rappelle notre responsabilité collective : permettre à chaque famille, y compris les plus modestes, de vivre la fête de la liberté avec sérénité.\n\nGrâce à vous, plusieurs familles de nos écoles pourront préparer ce Séder dans la dignité. Nous vous remercions infiniment pour votre soutien.\n\n'Hag Cacher Vesameach à vous et aux vôtres !",
    sms: "'Hag Cacher Vesameach ! Grâce à la Kimha D'Pis'ha, aidons ensemble chaque famille de nos écoles à vivre un Pessah serein. Merci 🍷",
  },
  "chavouot": {
    strategy: "Fête du don de la Torah et de l'étude : idéale pour mettre en valeur les programmes pédagogiques financés par les donateurs, sans nécessairement solliciter directement.",
    emailSubject: "'Hag Sameach 📜 — Merci de faire vivre l'étude de la Torah",
    emailBody: "Chers amis,\n\nChavouot célèbre le don de la Torah — le plus précieux des héritages que nous transmettons chaque jour à nos élèves, grâce à vous.\n\nQue cette fête soit l'occasion de vous dire, simplement, merci pour tout ce que vous rendez possible dans nos écoles.\n\n'Hag Sameach !",
    sms: "'Hag Chavouot Sameach ! Merci de faire vivre, avec nous, l'étude de la Torah auprès de nos élèves. 📜",
  },
};
const JEWISH_HOLIDAYS = [
  { key: "souccot2026", name: "Souccot", date: "2026-09-25", emoji: "🌿", templateKey: "souccot" },
  { key: "hanouka2026", name: "Hanouka", date: "2026-12-04", emoji: "🕎", templateKey: "hanouka" },
  { key: "toubichvat2027", name: "Tou Bichvat", date: "2027-01-22", emoji: "🌳", templateKey: "tou-bichvat" },
  { key: "pourim2027", name: "Pourim", date: "2027-03-22", emoji: "🎭", templateKey: "pourim" },
  { key: "pessah2027", name: "Pessah", date: "2027-04-21", emoji: "🍷", templateKey: "pessah" },
  { key: "chavouot2027", name: "Chavouot", date: "2027-06-10", emoji: "📜", templateKey: "chavouot" },
  { key: "rh2027", name: "Roch Hachana", date: "2027-10-01", emoji: "🍎", templateKey: "roch-hachana" },
  { key: "yk2027", name: "Yom Kippour", date: "2027-10-10", emoji: "🕊️", templateKey: "yom-kippour" },
  { key: "souccot2027", name: "Souccot", date: "2027-10-15", emoji: "🌿", templateKey: "souccot" },
  { key: "hanouka2027", name: "Hanouka", date: "2027-12-24", emoji: "🕎", templateKey: "hanouka" },
  { key: "toubichvat2028", name: "Tou Bichvat", date: "2028-02-11", emoji: "🌳", templateKey: "tou-bichvat" },
  { key: "pourim2028", name: "Pourim", date: "2028-03-11", emoji: "🎭", templateKey: "pourim" },
  { key: "pessah2028", name: "Pessah", date: "2028-04-10", emoji: "🍷", templateKey: "pessah" },
];
function daysBetweenIso(isoA, isoB) {
  const a = new Date(`${isoA}T00:00:00`);
  const b = new Date(`${isoB}T00:00:00`);
  return Math.round((b - a) / 86400000);
}
function daysBeforeIso(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function upcomingHolidays(count = 3) {
  const today = todayIso();
  return JEWISH_HOLIDAYS
    .filter(h => h.date >= today)
    .sort((a, b) => a.date < b.date ? -1 : 1)
    .slice(0, count)
    .map(h => ({ ...h, daysLeft: daysBetweenIso(today, h.date) }));
}
// Pose un rappel de lui-même dès qu'une fête entre dans une fenêtre utile
// (30 jours), sans attendre un clic : une tâche "Réfléchir à une idée pour
// X" apparaît directement dans les tâches, reliée à la fête (t.holidayKey)
// pour ne jamais la recréer en double. Cliquer sur cette tâche (ou sur la
// fête elle-même) ouvre la même case à idée, déjà pré-remplie d'un point de
// départ à retravailler — pas un message figé à copier tel quel.
function ensureHolidayReminders() {
  const today = todayIso();
  let created = false;
  upcomingHolidays(3).forEach(h => {
    if (h.daysLeft > 30) return;
    if (tasks.some(t => t.holidayKey === h.key) || holidayNotes[h.key]?.reminded) return;
    const t = buildTask(`Réfléchir à une idée pour ${h.name}`, today, null);
    if (!t) return;
    t.holidayKey = h.key;
    tasks.unshift(t);
    // Mémorise que le rappel a été posé : supprimer la tâche ne la fait plus
    // réapparaître à chaque ouverture de l'app.
    holidayNotes[h.key] = { ...(holidayNotes[h.key] || {}), reminded: true };
    created = true;
  });
  return created;
}
function hpHolidayPanel() {
  const upcoming = upcomingHolidays(3);
  if (!upcoming.length) return "";
  return `<section class="hp-holidays${panelCls("holidays")}">
    <div class="hp-activity-head"><h2>Idées pour les fêtes</h2><span class="hp-tasks-count">Prochaine dans ${upcoming[0].daysLeft <= 0 ? "0 j" : `${upcoming[0].daysLeft} j`}</span>${panelToggle("holidays")}</div>
    <div class="hp-holiday-list">
      ${upcoming.map(h => `<div class="hp-holiday-row">
        <div class="hp-holiday-main">
          <span class="hp-holiday-emoji">${h.emoji}</span>
          <div>
            <strong>${escapeHtml(h.name)}</strong>
            <span class="hp-holiday-date">${formatFrDate(h.date)} · ${h.daysLeft <= 0 ? "aujourd'hui" : `dans ${h.daysLeft} jour${h.daysLeft > 1 ? "s" : ""}`} · ${holidayNotes[h.key]?.note ? "idée déjà notée" : "pas encore d'idée"}</span>
          </div>
        </div>
        ${action("Travailler l'idée", `holiday-prepare:${h.key}`, "primary-btn")}
      </div>`).join("")}
    </div>
  </section>`;
}
function copyButton(label, targetId) {
  return `<button type="button" class="copy-btn" data-copy-target="${targetId}">${label}</button>`;
}
function openHolidayModal(key) {
  const h = JEWISH_HOLIDAYS.find(x => x.key === key);
  if (!h) return notify("Fête introuvable");
  const tpl = HOLIDAY_TEMPLATES[h.templateKey];
  if (!tpl) return notify("Modèle introuvable");
  const saved = holidayNotes[h.key]?.note;
  const seed = saved || tpl.sms;
  modalShell("holidayTask", "Idées pour les fêtes", `${h.name} — une idée à affiner`,
    `<input type="hidden" name="holidayKey" value="${escapeHtml(h.key)}">
     <div class="span-2 holiday-strategy-tip">💡 ${escapeHtml(tpl.strategy)}</div>
     <label class="span-2">Votre idée ou message — un point de départ à retravailler à votre façon, parfois quelques lignes suffisent<textarea name="note" id="holidayIdeaNote" class="holiday-textarea">${escapeHtml(seed)}</textarea></label>
     <div class="span-2 copy-row">${copyButton("Copier", "holidayIdeaNote")}</div>`,
    "Enregistrer mon idée");
}
function copyFieldValue(el) {
  const text = el.value;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => notify("Copié dans le presse-papiers")).catch(() => legacyCopy(el));
  } else {
    legacyCopy(el);
  }
}
function legacyCopy(el) {
  try {
    el.select();
    el.setSelectionRange(0, 999999);
    document.execCommand("copy");
    notify("Copié dans le presse-papiers");
  } catch {
    notify("Impossible de copier automatiquement — sélectionnez le texte manuellement.");
  }
}

// ---- Portefeuille : suivi personnalisé des relations donateurs -----------
// Logique "directeur de collecte de fonds" : chaque donateur suivi
// personnellement (champ "agent" — déjà utilisé par les imports GALA sous
// "ARIE"/"JP", ou ajouté ici à la main) doit recevoir au moins un vrai
// contact par mois. On calcule le nombre de jours depuis la dernière
// interaction réellement enregistrée (recordLiveInteractions) et on remonte
// en premier ceux qu'on n'a jamais recontactés, puis ceux qui prennent du
// retard. "Enregistrer un contact" demande toujours pourquoi (note
// obligatoire) : au fil des mois d'utilisation, ça construit un vrai
// historique du sens de la relation avec chaque donateur du portefeuille,
// pas juste une date de dernier appel.
function normalizeAgentCode(str) {
  return String(str || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
}
function myAgentCode() {
  if (!currentAccount) return "";
  const first = currentAccount.first || (currentAccount.email || "").split("@")[0] || "";
  return normalizeAgentCode(first);
}
function isInMyPortfolio(r) {
  const mine = myAgentCode();
  return !!mine && normalizeAgentCode(r.agent) === mine;
}
function myPortfolioRecords() {
  const mine = myAgentCode();
  if (!mine) return [];
  return records.filter(r => normalizeAgentCode(r.agent) === mine);
}
function lastContactIso(r) {
  const feed = recordLiveInteractions(r.id); // déjà trié du plus récent au plus ancien
  // Les interactions saisies dans l'app ont un "at" en horodatage ISO complet
  // (ex : 2026-09-23T15:25:08.000Z), celles importées avant le CRM n'ont
  // qu'une date simple (ex : 2024-06-17) : on ne garde que les 10 premiers
  // caractères pour retomber sur AAAA-MM-JJ dans les deux cas.
  return feed.length ? String(feed[0].at || "").slice(0, 10) : null;
}
function daysSincePortfolioContact(r) {
  const last = lastContactIso(r);
  if (!last) return null;
  return daysBetweenIso(last, todayIso());
}
function portfolioTone(days) {
  if (days === null) return "never";
  if (days >= 45) return "late";
  if (days >= 25) return "soon";
  return "ok";
}
const PORTFOLIO_TONE_ORDER = { never: 0, late: 1, soon: 2, ok: 3 };
/* ---- Anniversaires (civils et hébraïques) -------------------------------
   Liste, pour une période donnée, les contacts dont l'anniversaire civil ou
   hébraïque tombe dedans, pour penser à leur envoyer un petit message. Les
   jours hébraïques de la période sont calculés une seule fois puis indexés,
   pour rester rapide même avec plusieurs milliers de fiches. */
// Seuls les donateurs comptent ici (pas les élèves) : fiche avec au moins
// un don (historique importé ou enregistré), étiquetée "donateur", ou
// suivie dans le portefeuille de quelqu'un.
function isDonor(r) {
  return recordTotalAmount(r) > 0 || (r.tags || []).some(t => /donat/i.test(t)) || !!normalizeAgentCode(r.agent);
}
function isBirthdayTarget(r) {
  return state.birthdayScope === "mine" ? isInMyPortfolio(r) : isDonor(r);
}
function birthdaysInRange(fromIso, toIso) {
  const days = [];
  for (let iso = fromIso; iso <= toIso; iso = addDaysIso(iso, 1)) days.push({ iso, h: hebrewParts(iso) });
  const byHeb = new Map(days.map(d => [`${d.h.year}|${d.h.month}|${d.h.day}`, d.iso]));
  const hebYears = [...new Set(days.map(d => d.h.year))];
  const out = [];
  records.forEach(r => {
    if (r.kind === "Structure" || !isBirthdayTarget(r)) return;
    const iso = parseDob(r.dob);
    if (!iso) return;
    const [, mo, dd] = iso.split("-").map(Number);
    for (let y = +fromIso.slice(0, 4); y <= +toIso.slice(0, 4); y += 1) {
      const civil = isoFromParts(y, mo, dd) || isoFromParts(y, mo, dd - 1);
      if (civil && civil >= fromIso && civil <= toIso) out.push({ r, iso: civil, kind: "civil", age: y - +iso.slice(0, 4) });
    }
    const b = recordHebrewBirth(r);
    hebYears.forEach(hy => {
      let month = b.month;
      if (month === "Adar" && hebrewYearIsLeap(hy)) month = "Adar II";
      if ((month === "Adar I" || month === "Adar II") && !hebrewYearIsLeap(hy)) month = "Adar";
      let when = byHeb.get(`${hy}|${month}|${b.day}`);
      if (!when && b.day === 30) {
        const d29 = byHeb.get(`${hy}|${month}|29`);
        if (d29 && hebrewParts(addDaysIso(d29, 1)).month !== month) when = addDaysIso(d29, 1);
        if (when && when > toIso) when = "";
      }
      if (when) out.push({ r, iso: when, kind: "hebrew", age: hy - b.year, hebLabel: `${b.day} ${HEB_FR.formatToParts(utcNoon(when)).find(p => p.type === "month")?.value || ""}` });
    });
  });
  return out.sort((a, b) => a.iso.localeCompare(b.iso) || a.r.name.localeCompare(b.r.name));
}
// Portefeuille d'abord (même jour : les miens en tête), pour l'encart d'accueil.
function birthdaysMineFirst(list) {
  return [...list].sort((a, b) => (isInMyPortfolio(b.r) - isInMyPortfolio(a.r)) || a.iso.localeCompare(b.iso));
}
function birthdayRow(item, today) {
  const { r, iso, kind, age, hebLabel } = item;
  const d = utcNoon(iso);
  const past = iso < today;
  const when = iso === today ? "Auj." : d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: "UTC" });
  const what = kind === "civil" ? `Anniversaire civil${age > 0 ? ` · ${age} ans` : ""}` : `Anniversaire hébraïque · ${hebLabel}${age > 0 ? ` · ${age} ans` : ""}`;
  return `<div class="bday-row${past ? " bday-row-past" : ""}${iso === today ? " bday-row-today" : ""}">
    <div class="bday-date"><strong>${d.getUTCDate()}</strong><span>${escapeHtml(when)}</span></div>
    <button type="button" class="bday-main" data-action="open-record:${r.id}:Details">
      <strong>${escapeHtml(r.name)}${isInMyPortfolio(r) ? ` <span class="bday-mine" title="Dans mon portefeuille">★ Mon portefeuille</span>` : ""}</strong>
      <span class="bday-kind bday-kind-${kind}">${escapeHtml(what)}</span>
    </button>
    <div class="bday-actions">${action("Message", `quick-interaction:${r.id}`)}${action("+ Tâche", `quick-task:${r.id}`)}</div>
  </div>`;
}
function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}
function birthdaysView() {
  const today = todayIso();
  const ym = state.birthdayMonth || today.slice(0, 7);
  const [from, to] = monthBounds(ym);
  const list = birthdaysInRange(from, to);
  const withDob = records.filter(r => r.kind !== "Structure" && isBirthdayTarget(r) && parseDob(r.dob)).length;
  const scope = state.birthdayScope === "mine" ? "mine" : "donors";
  const title = utcNoon(from).toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" });
  return `<section class="panel pad">
    <div class="toolbar clean">
      <div>
        <span class="eyebrow">Anniversaires</span>
        <h2 class="bday-title">${escapeHtml(title.charAt(0).toUpperCase() + title.slice(1))}</h2>
        <p class="muted-note">${list.length} anniversaire${list.length > 1 ? "s" : ""} ce mois-ci (civils et hébraïques) · ${withDob} ${scope === "mine" ? "contact(s) de mon portefeuille" : "donateur(s)"} avec une date de naissance.</p>
        <div class="segmented bday-scope">
          <button type="button" class="${scope === "mine" ? "active" : ""}" data-action="bday-scope:mine">Mon portefeuille</button>
          <button type="button" class="${scope === "donors" ? "active" : ""}" data-action="bday-scope:donors">Tous les donateurs</button>
        </div>
      </div>
      <div class="row-actions bday-nav"><button type="button" data-action="bday-month:-1" title="Mois précédent" aria-label="Mois précédent">‹</button>${ym !== today.slice(0, 7) ? action("Ce mois-ci", "bday-month:0") : ""}<button type="button" data-action="bday-month:1" title="Mois suivant" aria-label="Mois suivant">›</button></div>
    </div>
    ${list.length ? `<div class="bday-list">${list.map(x => birthdayRow(x, today)).join("")}</div>`
      : emptyState(withDob ? "Aucun anniversaire ce mois-ci." : `Aucune date de naissance renseignée pour ${scope === "mine" ? "les contacts de votre portefeuille" : "les donateurs"} pour l'instant. Ajoutez-la depuis la fiche (case « Date de naissance »).`)}
  </section>`;
}
function hpBirthdaysPanel() {
  const today = todayIso();
  const list = birthdaysMineFirst(birthdaysInRange(today, addDaysIso(today, 30)));
  if (!list.length) return "";
  const shown = list.slice(0, 6);
  return `<section class="hp-portfolio hp-birthdays${panelCls("birthdays")}">
    <div class="hp-activity-head"><h2>Anniversaires à venir</h2><span class="hp-tasks-count">${list.length} sur 30 jours</span>${panelToggle("birthdays")}</div>
    <div class="bday-list">${shown.map(x => birthdayRow(x, today)).join("")}</div>
    <button type="button" class="hp-link" data-action="goto-birthdays">Voir tous les anniversaires du mois</button>
  </section>`;
}

// Blocs de l'accueil repliables : chevron dans l'en-tête de chaque bloc,
// état mémorisé sur cet appareil (simple confort d'affichage).
const PANELS_KEY = "crm-collapsed-panels";
let collapsedPanels = (() => { try { return JSON.parse(localStorage.getItem(PANELS_KEY) || "[]"); } catch { return []; } })();
function panelCls(key) { return collapsedPanels.includes(key) ? " hp-collapsed" : ""; }
function panelToggle(key) {
  const closed = collapsedPanels.includes(key);
  return `<button type="button" class="hp-panel-toggle" data-action="toggle-panel:${key}" aria-expanded="${!closed}" title="${closed ? "Déplier" : "Replier"}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button>`;
}

function hpPortfolioPanel() {
  const mine = myAgentCode();
  if (!mine) return "";
  const list = myPortfolioRecords()
    .map(r => { const days = daysSincePortfolioContact(r); return { r, days, tone: portfolioTone(days) }; })
    .sort((a, b) => PORTFOLIO_TONE_ORDER[a.tone] - PORTFOLIO_TONE_ORDER[b.tone] || (b.days ?? 99999) - (a.days ?? 99999));
  const overdue = list.filter(x => x.tone === "never" || x.tone === "late").length;
  const shown = list.slice(0, 8);
  return `<section class="hp-portfolio${panelCls("portfolio")}">
    <div class="hp-activity-head"><h2>Mon portefeuille</h2><span class="hp-tasks-count">${list.length ? (overdue ? `${overdue} à recontacter` : "Tout est à jour") : "Aucun contact suivi"}</span>${panelToggle("portfolio")}</div>
    ${list.length ? `<button type="button" class="hp-link" data-action="goto-portfolio">Voir tout mon portefeuille</button>` : ""}
    ${list.length ? `<div class="hp-portfolio-list">${shown.map(hpPortfolioRow).join("")}</div>${list.length > shown.length ? `<p class="muted-note">+ ${list.length - shown.length} autre(s) contact(s) dans le portefeuille.</p>` : ""}`
      : `<p class="muted-note">Ajoutez les donateurs que vous suivez personnellement pour ne plus jamais en perdre un — l'objectif est un vrai contact au moins une fois par mois.</p>`}
    <button type="button" class="hp-link" data-action="add-to-portfolio">+ Ajouter un contact à mon portefeuille</button>
  </section>`;
}
function hpPortfolioRow({ r, days, tone }) {
  const label = tone === "never" ? "Jamais contacté depuis l'utilisation du CRM" : `Dernier contact il y a ${days} jour${days > 1 ? "s" : ""}`;
  const amount = recordTotalAmount(r);
  return `<div class="hp-portfolio-row">
    <button type="button" class="hp-portfolio-main" data-action="open-record:${r.id}:Activité">
      <span class="hp-portfolio-dot hp-portfolio-dot-${tone}"></span>
      <span class="hp-portfolio-info"><strong>${escapeHtml(r.name)}</strong><span class="hp-portfolio-meta">${amount ? euro(amount) + " donnés · " : ""}${label}</span></span>
    </button>
    ${action("Consigner un contact", `portfolio-touch:${r.id}`, "btn-sm")}
  </div>`;
}
function openPortfolioTouch(id) {
  const r = recordById(id);
  if (!r) return notify("Fiche introuvable");
  modalShell("portfolioTouch", "Mon portefeuille", `Enregistrer un contact — ${r.name}`,
    `<input type="hidden" name="recordId" value="${escapeHtml(r.id)}">
     ${selectField("Type de contact", "type", ["Appel téléphonique", "Message (SMS/WhatsApp)", "Email", "Rencontre"], "Appel téléphonique")}
     ${field("Date", "date", todayIso(), "date", "required")}
     ${textareaField("Pourquoi ce contact ? Qu'est-ce qui s'est dit ?", "note", "", "required placeholder='Ex : pris des nouvelles, parlé du renouvellement de son don, invité au prochain évènement...'")}`,
    "Enregistrer");
}
function openAddToPortfolioModal() {
  modalShell("addToPortfolio", "Mon portefeuille", "Ajouter un contact à mon portefeuille",
    pickerField("Contact à suivre personnellement", "recordId", null, true),
    "Ajouter au portefeuille");
}
function togglePortfolio(id) {
  const r = recordById(id);
  if (!r) return notify("Fiche introuvable");
  const mine = myAgentCode();
  if (!mine) return notify("Impossible de déterminer votre portefeuille : prénom du compte manquant.");
  const already = normalizeAgentCode(r.agent) === mine;
  r.agent = already ? "" : mine;
  logAudit(`${r.name} ${already ? "retiré du" : "ajouté au"} portefeuille de ${currentUserLabel()}.`);
  saveCrmData();
  render();
  notify(already ? `${r.name} retiré de votre portefeuille` : `${r.name} ajouté à votre portefeuille`);
}

// ---- Tâches : premier aperçu "calendrier" sur l'accueil ------------------
// Volontairement simple (pas de vue mois/jour, pas de sync téléphone/Google) :
// ça reste la phase agenda complète, discutée à part et pas encore commencée.
// Les rappels de fêtes hébraïques ont leur propre section (voir
// hpHolidayPanel plus haut). Ici, juste de vraies tâches persistées,
// groupées par échéance, qu'on peut ajouter/cocher depuis l'accueil.
function taskDueInfo(t) {
  if (!t.dueDate) return { tone: "none", label: "" };
  const today = todayIso();
  const timeSuffix = t.dueTime ? ` · ${t.dueTime}` : "";
  if (t.dueDate < today) return { tone: "late", label: `En retard · ${formatFrDate(t.dueDate)}${timeSuffix}` };
  if (t.dueDate === today) return { tone: "today", label: `Aujourd'hui${timeSuffix}` };
  return { tone: "soon", label: `${formatFrDate(t.dueDate)}${timeSuffix}` };
}
function formatFrDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
/* ---- Dates de naissance : civil -> hébraïque ----------------------------
   La conversion utilise le calendrier hébraïque intégré au navigateur
   (Intl, calendrier "hebrew"), sans bibliothèque externe. Une naissance
   après le coucher du soleil compte pour le jour hébraïque suivant
   (r.dobAfterSunset). Les dates importées arrivent sous plusieurs formats
   (JJ/MM/AAAA, AAAA-MM-JJ...) : parseDob les ramène toutes en AAAA-MM-JJ. */
function parseDob(value) {
  const v = String(value || "").trim();
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000;
    return isoFromParts(y, +m[2], +m[1]);
  }
  return "";
}
function isoFromParts(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return "";
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const HEB_FR = new Intl.DateTimeFormat("fr-FR-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const HEB_KEY = new Intl.DateTimeFormat("en-u-ca-hebrew", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
function utcNoon(iso) { return new Date(`${iso}T12:00:00Z`); }
function addDaysIso(iso, n) { const d = utcNoon(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Jour hébraïque d'une date civile : { day, month (clé anglaise : "Adar I"...), year, label (français) }
function hebrewParts(iso) {
  const parts = Object.fromEntries(HEB_KEY.formatToParts(utcNoon(iso)).map(p => [p.type, p.value]));
  const label = HEB_FR.formatToParts(utcNoon(iso)).filter(p => p.type === "day" || p.type === "month" || p.type === "year").map(p => p.value).join(" ");
  return { day: +parts.day, month: parts.month, year: +parts.year, label };
}
function recordHebrewBirth(r) {
  const iso = parseDob(r?.dob);
  if (!iso) return null;
  return hebrewParts(r.dobAfterSunset ? addDaysIso(iso, 1) : iso);
}
function hebrewYearIsLeap(year) { return ((7 * year + 1) % 19) < 7; }
// Prochaine date civile (>= fromIso) où tombe l'anniversaire hébraïque.
// Règles usuelles : né en Adar (année simple) -> Adar II les années
// embolismiques ; né en Adar I/II -> Adar les années simples ; un 30 qui
// n'existe pas cette année-là (Hechvan, Kislev, Adar I) -> le 1er du mois
// suivant, c'est-à-dire le lendemain du 29.
function nextHebrewBirthday(r, fromIso) {
  const birth = recordHebrewBirth(r);
  if (!birth) return "";
  const start = hebrewParts(fromIso);
  for (const hy of [start.year, start.year + 1]) {
    let month = birth.month;
    if (month === "Adar" && hebrewYearIsLeap(hy)) month = "Adar II";
    if ((month === "Adar I" || month === "Adar II") && !hebrewYearIsLeap(hy)) month = "Adar";
    // approximation de départ : même date civile que fromIso, puis on avance
    for (let i = 0, iso = fromIso; i < 400; i += 1, iso = addDaysIso(iso, 1)) {
      const h = hebrewParts(iso);
      if (h.year > hy) break;
      if (h.year !== hy || h.month !== month) continue;
      if (h.day === birth.day) return iso;
      if (birth.day === 30 && h.day === 29) {
        const next = hebrewParts(addDaysIso(iso, 1));
        if (next.month !== month) return addDaysIso(iso, 1);
      }
    }
  }
  return "";
}
function nextCivilBirthday(r, fromIso) {
  const iso = parseDob(r?.dob);
  if (!iso) return "";
  const [, mo, d] = iso.split("-").map(Number);
  const fromYear = +fromIso.slice(0, 4);
  for (const y of [fromYear, fromYear + 1]) {
    // 29 février : fêté le 28 les années non bissextiles
    const candidate = isoFromParts(y, mo, d) || isoFromParts(y, mo, d - 1);
    if (candidate >= fromIso) return candidate;
  }
  return "";
}
function ageOn(r, iso) {
  const b = parseDob(r?.dob);
  if (!b) return null;
  let age = +iso.slice(0, 4) - +b.slice(0, 4);
  if (iso.slice(5) < b.slice(5)) age -= 1;
  return age;
}
function dobLabel(r) {
  const iso = parseDob(r?.dob);
  if (!iso) return r?.dob || "-";
  const heb = recordHebrewBirth(r);
  return `${formatFrDateFull(iso)}${heb ? ` · ${heb.label}${r.dobAfterSunset ? " (après le coucher du soleil)" : ""}` : ""}`;
}

// Version longue (JJ/MM/AAAA) de formatFrDate, pour les endroits qui
// affichaient déjà les dates au format complet (fiches paiement, journal
// comptable) plutôt qu'au format court "23 sept." des tâches.
function formatFrDateFull(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR");
}
// La date à afficher/utiliser pour un paiement : la date de paiement réelle
// une fois le don reçu, sinon la date de la promesse, et pour les paiements
// créés avant l'ajout de ces deux champs on retombe sur l'ancienne date de
// saisie (p.date) pour ne rien casser sur les anciennes données.
function paymentPrimaryDate(p) {
  if (p.status === "Reçu" && p.paymentDate) return formatFrDateFull(p.paymentDate);
  if (p.promiseDate) return formatFrDateFull(p.promiseDate);
  return p.date || "";
}
function hpTasksPanel() {
  const open = tasks.filter(t => t.status !== "fait").sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);
  const done = tasks.filter(t => t.status === "fait").sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
  const shown = open.slice(0, 8);
  const shownDone = done.slice(0, 15);
  const me = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  const showDone = !!state.showDoneTasks;
  return `<section class="hp-tasks${panelCls("tasks")}">
    <div class="hp-activity-head"><h2>Tâches</h2><span class="hp-tasks-count">${open.length ? `${open.length} en cours` : "Tout est fait"}</span>${panelToggle("tasks")}</div>
    <form class="hp-task-form" id="hpTaskForm" autocomplete="off">
      <div class="hp-task-input-wrap">
        <input type="text" name="title" id="hpTaskTitle" placeholder="Ajouter une tâche… ex. « Contacter Dupont »" maxlength="140" required>
        <div class="hp-task-suggest" id="hpTaskSuggest" hidden></div>
      </div>
      <input type="hidden" name="recordId" id="hpTaskRecordId" value="">
      <div class="hp-task-row2">
        <div class="hp-task-datetime">
          <label class="hp-task-field"><span>Date</span><input type="date" name="dueDate" value="${todayIso()}"></label>
          <label class="hp-task-field" data-empty><span>Heure</span><input type="time" name="dueTime" value="" title="Heure (si nécessaire)"></label>
        </div>
        <div class="hp-task-actions">
          <button type="button" class="hp-task-link-btn" id="hpTaskCreateContact" title="Créer un nouveau contact et le lier à cette tâche"><span class="hp-task-btn-icon" aria-hidden="true">+</span><span class="hp-task-btn-label">Contact</span></button>
          <button type="submit" class="hp-task-add" title="Ajouter la tâche"><span class="hp-task-btn-icon" aria-hidden="true">+</span><span class="hp-task-btn-label">Ajouter</span></button>
        </div>
      </div>
      <div class="hp-task-linked" id="hpTaskLinked" hidden>Lié à <strong id="hpTaskLinkedName"></strong><button type="button" id="hpTaskUnlink" title="Détacher" aria-label="Détacher">${icon("x", 13)}</button></div>
    </form>
    ${shown.length ? `<div class="hp-task-list">${shown.map(t => hpTaskRow(t)).join("")}</div>` : `<p class="muted-note">Aucune tâche en cours${me ? ` pour ${escapeHtml(me)}` : ""}. Ajoute la première ci-dessus.</p>`}
    ${done.length ? `<button type="button" class="hp-link hp-tasks-done-toggle" data-action="toggle-done-tasks">${showDone ? "Masquer" : "Voir"} les tâches terminées (${done.length})</button>` : ""}
    ${showDone && shownDone.length ? `<div class="hp-task-list hp-task-list-done">${shownDone.map(t => hpTaskRow(t)).join("")}</div>` : ""}
  </section>`;
}
function openEditTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return notify("Tâche introuvable");
  modalShell("editTask", "Tâche", "Modifier la tâche", taskFormBody(t, null), "Enregistrer");
}
// Reconnaît un verbe d'action suivi d'un nom ("Contacter Dupont", "Relancer
// Cohen"...) pour proposer des fiches du CRM en autocomplétion ; à défaut de
// verbe reconnu, on tente quand même avec le texte tapé s'il est assez long.
const TASK_TRIGGER_WORDS = ["contacter", "contact", "appeler", "rappeler", "relancer", "relance", "voir", "rencontrer", "rdv", "rendez-vous", "email", "mail", "écrire", "ecrire", "suivre", "suivi", "joindre"];
function taskContactQuery(raw) {
  const value = (raw || "").trim();
  if (value.length < 2) return "";
  const lower = value.toLowerCase();
  let bestIdx = -1, bestWord = "";
  TASK_TRIGGER_WORDS.forEach(w => {
    const idx = lower.lastIndexOf(w);
    if (idx > bestIdx) { bestIdx = idx; bestWord = w; }
  });
  if (bestIdx >= 0) {
    const after = value.slice(bestIdx + bestWord.length).replace(/^[\s:,-]+/, "").trim();
    return after.length >= 2 ? after : "";
  }
  return value.length >= 3 ? value : "";
}
function normalizeSearchText(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function matchRecordsForTask(query) {
  const q = normalizeSearchText(query);
  if (!q) return [];
  const scored = [];
  for (const r of records) {
    const name = normalizeSearchText(r.name || "");
    if (name && name.includes(q)) scored.push({ r, rank: name.startsWith(q) ? 0 : 1 });
  }
  scored.sort((a, b) => a.rank - b.rank || (a.r.name || "").localeCompare(b.r.name || "", "fr"));
  return scored.slice(0, 6).map(s => s.r);
}
function buildTask(title, dueDate, recordId, dueTime) {
  const clean = (title || "").trim();
  if (!clean) return null;
  const me = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  const linked = recordId ? recordById(recordId) : null;
  return {
    id: `T-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: clean,
    dueDate: dueDate || "",
    dueTime: dueTime || "",
    status: "à faire",
    assignedTo: me,
    createdBy: me,
    createdAt: nowIso(),
    completedAt: null,
    recordId: linked ? linked.id : null,
  };
}
function addHomeTask(title, dueDate, recordId, dueTime) {
  const t = buildTask(title, dueDate, recordId, dueTime);
  if (!t) return;
  tasks.unshift(t);
  const linked = t.recordId ? recordById(t.recordId) : null;
  logAudit(`Tâche ajoutée : ${t.title}${linked ? ` (liée à ${linked.name})` : ""}.`);
  saveCrmData();
  render();
}
// Création rapide d'un contact minimal depuis un champ de liaison (ex :
// tâches) quand la personne recherchée n'existe pas encore dans le CRM —
// évite d'interrompre la saisie en cours pour aller créer la fiche ailleurs.
// Le contact est volontairement minimal (nom seulement) : à compléter
// ensuite depuis sa fiche si besoin (email, téléphone...).
function quickCreateContact(name) {
  const clean = (name || "").trim();
  if (!clean) return null;
  const idx = clean.lastIndexOf(" ");
  const first = idx > -1 ? clean.slice(0, idx).trim() : "";
  const last = idx > -1 ? clean.slice(idx + 1).trim() : clean;
  const record = {
    id: nextId("C", records), kind: "Contact", civility: "", first, last, name: clean,
    email: "", phone: "", tags: [], groups: [], segments: [],
    importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0,
    address: "", family: "", source: "Manuel", dateAdded: todayStr(),
  };
  ensureInAccountScope(record);
  records.unshift(record);
  // recordById() lit l'index recordsIndex, reconstruit seulement au prochain
  // render() complet : sans cette ligne, un buildTask() appelé juste après
  // (ex. soumission immédiate du formulaire rapide d'accueil) ne retrouvait
  // pas encore ce contact et liait la tâche à "aucun contact".
  recordsIndex.set(record.id, record);
  logAudit(`Contact créé rapidement depuis une tâche : ${record.name}.`);
  saveCrmData();
  return record;
}
// Marque une tâche faite / à refaire. On garde une trace dans le journal
// d'activité et une date d'achèvement (completedAt) pour que les tâches
// cochées restent consultables (voir "Voir les tâches terminées") au lieu
// de simplement disparaître.
function toggleTaskDone(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const willBeDone = t.status !== "fait";
  t.status = willBeDone ? "fait" : "à faire";
  t.completedAt = willBeDone ? nowIso() : null;
  logAudit(`Tâche ${willBeDone ? "marquée terminée" : "remise à faire"} : ${t.title}.`);
  saveCrmData();
  render();
}
function deleteHomeTask(id) {
  const index = tasks.findIndex(x => x.id === id);
  if (index < 0) return;
  const [t] = tasks.splice(index, 1);
  logAudit(`Tâche supprimée : ${t.title}.`);
  saveCrmData();
  render();
  notify("Tâche supprimée", false, { label: "Annuler", run: () => { tasks.splice(Math.min(index, tasks.length), 0, t); saveCrmData(); render(); } });
}

// ---- Notifications push réelles (reçues même app fermée) -----------------
// Remplace l'ancien rappel purement local au navigateur (API Notification +
// setInterval, qui ne fonctionnait que tant que l'onglet avait été ouvert
// récemment) par un vrai abonnement Web Push : c'est le serveur qui envoie
// la notification, et le Service Worker (voir service-worker.js, handler
// "push") qui peut l'afficher même si l'app est totalement fermée. Réglage
// et abonnement gardés par appareil (comme l'autorisation de notification
// elle-même), mais synchronisés avec le serveur via /api/push/*.
// Limite propre à iOS : Apple exige que l'app ait été ajoutée à l'écran
// d'accueil pour que les notifications push fonctionnent du tout sur
// iPhone/iPad — ce n'est pas une limite de ce CRM.
let pushState = {
  supported: ("serviceWorker" in navigator) && ("PushManager" in window),
  permission: (typeof Notification !== "undefined" ? Notification.permission : "unsupported"),
  subscribed: false,
  enabled: false,
  time: "09:00",
};

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent || "");
}
function isStandaloneDisplay() {
  return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
}
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

async function apiGetVapidPublicKey() {
  const res = await fetch(`${API_BASE}/api/push/vapid-public-key`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de récupérer la clé VAPID");
  return res.json();
}
async function apiGetPushPrefs() {
  const res = await fetch(`${API_BASE}/api/push/prefs`, { headers: authHeaders() });
  if (!res.ok) throw new Error("Impossible de récupérer les préférences de notification");
  return res.json();
}
async function apiSetPushPrefs(enabled, time) {
  const res = await fetch(`${API_BASE}/api/push/prefs`, {
    method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ enabled, time }),
  });
  if (!res.ok) throw new Error("Impossible d'enregistrer les préférences de notification");
  return res.json();
}
async function apiPushSubscribe(subscriptionJson) {
  const res = await fetch(`${API_BASE}/api/push/subscribe`, {
    method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify(subscriptionJson),
  });
  if (!res.ok) throw new Error("Impossible d'enregistrer l'abonnement push");
  return res.json();
}
async function apiPushUnsubscribe(endpoint) {
  try {
    const res = await fetch(`${API_BASE}/api/push/unsubscribe`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ endpoint }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
async function apiSendTestPush() {
  const res = await fetch(`${API_BASE}/api/push/test`, {
    method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
  });
  return res.json().catch(() => ({ ok: false, reason: "reponse_invalide" }));
}

async function refreshPushState() {
  if (!pushState.supported) return;
  try {
    const [prefs, reg] = await Promise.all([
      apiGetPushPrefs().catch(() => ({ enabled: false, time: "09:00" })),
      navigator.serviceWorker.ready,
    ]);
    const sub = await reg.pushManager.getSubscription();
    pushState.enabled = !!prefs.enabled;
    pushState.time = prefs.time || "09:00";
    pushState.subscribed = !!sub;
    pushState.permission = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
  } catch { /* réseau indisponible pour l'instant : on garde les valeurs précédentes */ }
}

async function enablePushNotifications(time) {
  if (typeof Notification === "undefined") { notify("Notifications non prises en charge par ce navigateur"); return false; }
  let perm = Notification.permission;
  if (perm === "default") { try { perm = await Notification.requestPermission(); } catch { perm = "denied"; } }
  pushState.permission = perm;
  if (perm !== "granted") { notify("Autorisation refusée dans le navigateur"); return false; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { publicKey, available } = await apiGetVapidPublicKey();
      if (!available || !publicKey) { notify("Notifications push indisponibles sur ce serveur pour le moment"); return false; }
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    }
    await apiPushSubscribe(sub.toJSON());
    await apiSetPushPrefs(true, time || pushState.time);
    pushState.subscribed = true;
    pushState.enabled = true;
    pushState.time = time || pushState.time;
    return true;
  } catch (err) {
    notify(`Impossible d'activer les notifications push : ${err?.message || err}`);
    return false;
  }
}

async function disablePushNotifications() {
  try { await apiSetPushPrefs(false, pushState.time); } catch { /* on continue quand meme cote appareil */ }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await apiPushUnsubscribe(sub.endpoint);
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* pas grave : le serveur n'enverra plus rien tant que enabled=false */ }
  pushState.enabled = false;
  pushState.subscribed = false;
}

async function sendTestPushAndNotify() {
  notify("Envoi de la notification de test…");
  try {
    const res = await apiSendTestPush();
    if (res.ok) {
      notify("Notification de test envoyée — elle devrait arriver dans quelques secondes, même app fermée.");
    } else if (res.reason === "no_subscription") {
      notify("Aucun abonnement actif sur cet appareil : réactive les notifications ci-dessus.");
    } else if (res.reason === "push_unavailable") {
      notify("Notifications push indisponibles sur ce serveur pour le moment.");
    } else {
      const firstError = Array.isArray(res.results) ? res.results.find(r => !r.ok)?.error : null;
      notify(`Échec de l'envoi : ${firstError || res.reason || "erreur inconnue"}`);
    }
  } catch (err) {
    notify(`Impossible de contacter le serveur pour le test : ${err?.message || err}`);
  }
}

function notifSettingsPanel() {
  if (!pushState.supported) {
    return `<section class="panel pad" id="notifSettingsPanel">
      <span class="eyebrow">Rappels</span><h2>Notifications de tâches</h2>
      <p class="muted-note">Ce navigateur ne prend pas en charge les notifications push.</p>
    </section>`;
  }
  const ios = isIosDevice();
  const standalone = isStandaloneDisplay();
  return `<section class="panel pad" id="notifSettingsPanel">
    <span class="eyebrow">Rappels</span><h2>Notifications de tâches</h2>
    <p class="muted-note">Reçois une vraie notification sur ton téléphone ou ordinateur — même quand l'app est fermée : à l'heure précise de chaque tâche qui a une heure, plus un récapitulatif des tâches du jour et en retard à l'heure choisie ci-dessous.</p>
    ${ios && !standalone ? `<p class="muted-note"><strong>Sur iPhone/iPad :</strong> ajoute d'abord ce CRM à l'écran d'accueil (bouton Partager puis "Sur l'écran d'accueil") — c'est une exigence d'Apple, sans ça les notifications ne fonctionnent pas du tout sur iOS.</p>` : ""}
    ${pushState.permission === "denied" ? `<p class="muted-note">Les notifications sont bloquées pour ce site dans les réglages du navigateur. Autorise-les pour recevoir les rappels.</p>` : ""}
    <label class="settings-toggle-row"><input type="checkbox" id="notifEnabledToggle" ${pushState.enabled ? "checked" : ""}><span>Activer les notifications de tâches sur cet appareil</span></label>
    <div class="form-grid"><label>Heure du rappel<input type="time" id="notifTimeInput" value="${escapeHtml(pushState.time)}"></label></div>
    ${pushState.enabled && pushState.subscribed ? `
    <p class="muted-note">Le rappel n'envoie une notification que s'il y a au moins une tâche due ou en retard ce jour-là à l'heure choisie — pas de notification si tout est à jour. Pour vérifier tout de suite que ça fonctionne, sans attendre :</p>
    ${action("Envoyer une notification de test", "send-test-push")}` : ""}
  </section>`;
}








// Page dédiée "Portefeuille" (accessible depuis le menu CONTACTS) : liste
// complète (pas seulement les 8 premiers comme sur l'accueil) des donateurs
// suivis personnellement, avec les mêmes actions que le panneau d'accueil.
// Ajoutée suite au retour d'Arié qui n'arrivait pas à trouver où voir/gérer
// son portefeuille — un simple panneau sur l'accueil n'était pas assez
// visible/complet ; ceci lui donne une vraie destination dans le menu.
function portfolioView() {
  const mine = myAgentCode();
  const list = myPortfolioRecords()
    .map(r => { const days = daysSincePortfolioContact(r); return { r, days, tone: portfolioTone(days) }; })
    .sort((a, b) => PORTFOLIO_TONE_ORDER[a.tone] - PORTFOLIO_TONE_ORDER[b.tone] || (b.days ?? 99999) - (a.days ?? 99999));
  const overdue = list.filter(x => x.tone === "never" || x.tone === "late").length;
  return `<section class="panel pad">
    <div class="toolbar clean">
      <div>
        <span class="eyebrow">Suivi personnalisé</span>
        <h2>Mon portefeuille</h2>
        <p class="muted-note">Identifié comme <strong>${escapeHtml(mine || "—")}</strong>${mine ? "" : " — aucun prénom sur votre compte, contactez un administrateur"} · ${list.length} contact${list.length > 1 ? "s" : ""} suivi${list.length > 1 ? "s" : ""}${overdue ? `, ${overdue} à recontacter` : ""}.</p>
      </div>
      ${action("Ajouter un contact", "add-to-portfolio", "primary-btn")}
    </div>
    ${list.length ? `<div class="hp-portfolio-list">${list.map(portfolioViewRow).join("")}</div>`
      : emptyState("Aucun contact suivi pour l'instant. Ajoutez les donateurs que vous accompagnez personnellement, ou utilisez le champ « Portefeuille » sur une fiche.", "+ Ajouter un contact à mon portefeuille", "add-to-portfolio")}
  </section>`;
}
function portfolioViewRow({ r, days, tone }) {
  const label = tone === "never" ? "Jamais contacté depuis l'utilisation du CRM" : `Dernier contact il y a ${days} jour${days > 1 ? "s" : ""}`;
  const amount = recordTotalAmount(r);
  return `<div class="hp-portfolio-row">
    <button type="button" class="hp-portfolio-main" data-action="open-record:${r.id}:Activité">
      <span class="hp-portfolio-dot hp-portfolio-dot-${tone}"></span>
      <span class="hp-portfolio-info"><strong>${escapeHtml(r.name)}</strong><span class="hp-portfolio-meta">${amount ? euro(amount) + " donnés · " : ""}${label}</span></span>
    </button>
    <div class="hp-portfolio-row-actions">
      ${action("Consigner un contact", `portfolio-touch:${r.id}`, "btn-sm")}
      ${action("Retirer", `toggle-portfolio:${r.id}`, "btn-sm")}
    </div>
  </div>`;
}

// Bouton "Filtres" du répertoire, avec un badge indiquant le nombre de
// critères actifs pour qu'on voie d'un coup d'œil si un filtre oublié est
// encore appliqué.
function filtersButton() {
  const n = activeFilterCount(activeFilters());
  return `<button type="button" class="top-btn filters-btn" data-action="open-filters">Filtres${n ? `<span class="filters-badge">${n}</span>` : ""}</button>`;
}
// Valeurs distinctes réellement présentes dans les données, pour ne proposer
// dans les filtres que des cases qui peuvent effectivement correspondre à
// quelque chose (ex : pas la peine d'afficher "2031" si aucun don n'existe
// cette année-là).
function distinctPaymentYears() {
  const years = new Set();
  payments.forEach(p => { const y = paymentYear(p); if (y) years.add(y); });
  return [...years].sort((a, b) => b.localeCompare(a));
}
function distinctOccasions() {
  const vals = new Set();
  payments.forEach(p => (p.occasion || []).forEach(o => { if (o) vals.add(o); }));
  return [...vals].sort((a, b) => a.localeCompare(b, "fr"));
}
function distinctLegacySegmentTags() {
  const vals = new Set();
  records.forEach(r => (r.segments || []).forEach(s => { if (s) vals.add(s); }));
  return [...vals].sort((a, b) => a.localeCompare(b, "fr"));
}
// Un groupe de cases à cocher générique (campus, année, type, occasion,
// statut, segments historiques) : chaque case coche/décoche une valeur dans
// state.filters[key] (tableau), avec le libellé optionnel distinct de la
// valeur brute (ex : "paye" -> "Déjà payé").
function filterCheckGroup(legend, key, options, labelFn) {
  const selected = activeFilters()[key] || [];
  if (!options.length) return "";
  return `<fieldset class="filter-group" data-filter-key="${key}">
    <legend>${escapeHtml(legend)}</legend>
    <div class="filter-checklist">${options.map(o => `<label class="filter-check"><input type="checkbox" data-filter="${key}" value="${escapeHtml(o)}" ${selected.includes(o) ? "checked" : ""}> ${escapeHtml(labelFn ? labelFn(o) : o)}</label>`).join("")}</div>
  </fieldset>`;
}
function filtersDrawerBody() {
  const f = activeFilters();
  const payStatusLabels = { paye: "Déjà payé", attente: "En attente" };
  return `<p class="muted-note">Les critères se combinent entre eux ; dans une même liste, cocher plusieurs cases élargit le résultat.</p>
    <fieldset class="filter-group">
      <legend>Montant total donné</legend>
      <div class="filter-range-row">
        <label>Min<input type="text" inputmode="numeric" pattern="[0-9]*" data-filter-amount="amountMin" value="${escapeHtml(f.amountMin)}" placeholder="0 €"></label>
        <label>Max<input type="text" inputmode="numeric" pattern="[0-9]*" data-filter-amount="amountMax" value="${escapeHtml(f.amountMax)}" placeholder="Sans max"></label>
      </div>
    </fieldset>
    <fieldset class="filter-group">
      <legend>Récurrence</legend>
      <div class="filter-select-row">
        <select data-filter-select="recurring">
          <option value="" ${!f.recurring ? "selected" : ""}>Indifférent</option>
          <option value="yes" ${f.recurring === "yes" ? "selected" : ""}>Donateur récurrent (2 années ou plus)</option>
          <option value="no" ${f.recurring === "no" ? "selected" : ""}>Don ponctuel (une seule année)</option>
        </select>
      </div>
    </fieldset>
    <fieldset class="filter-group">
      <legend>Dernier don</legend>
      <div class="filter-select-row">
        <select data-filter-select="lastGift">
          <option value="" ${!f.lastGift ? "selected" : ""}>Indifférent</option>
          <option value="12m" ${f.lastGift === "12m" ? "selected" : ""}>A donné depuis 12 mois</option>
          <option value="old" ${f.lastGift === "old" ? "selected" : ""}>Dernier don il y a plus de 12 mois</option>
          <option value="never" ${f.lastGift === "never" ? "selected" : ""}>N'a jamais donné</option>
        </select>
      </div>
    </fieldset>
    ${filterCheckGroup("Étiquettes", "tags", distinctTags())}
    ${filterCheckGroup("École / campus", "campuses", CAMPUS_OPTIONS)}
    ${filterCheckGroup("Année de don", "years", distinctPaymentYears())}
    ${filterCheckGroup("Type de paiement", "paymentTypes", PAYMENT_TYPE_OPTIONS)}
    ${filterCheckGroup("Occasion", "occasions", distinctOccasions())}
    ${filterCheckGroup("Statut du paiement", "payStatus", ["paye", "attente"], v => payStatusLabels[v] || v)}
    ${filterCheckGroup("Segment historique (étiquette libre)", "segments", distinctLegacySegmentTags())}
    <div class="filter-drawer-actions">
      ${action("Réinitialiser", "reset-filters-only")}
      ${action("Créer un segment", "save-segment")}
      ${action(`Voir ${sortedRecords(state.section === "Structures" ? "Structure" : "Contact").length.toLocaleString("fr-FR")} fiche(s)`, "close-drawer", "primary-btn")}
    </div>`;
}


// Nombre de fiches correspondant à un segment enregistré, recalculé à chaque
// affichage de la page (donc toujours à jour) sans toucher aux filtres/à la
// recherche réellement affichés ailleurs (filteredRecords accepte des
// overrides pour ça).
function segmentMatchCount(seg) {
  return filteredRecords("", { ...defaultFilters(), ...(seg.filters || {}) }).length;
}
// Résumé lisible des critères d'un segment enregistré, pour la page Segments
// (ex : "Montant ≥ 100 € · Récurrent · Beth Mena'hem · 2023, 2024").
function summarizeSegmentCriteria(f) {
  const parts = [];
  if (f.amountMin) parts.push(`Montant ≥ ${euro(f.amountMin)}`);
  if (f.amountMax) parts.push(`Montant ≤ ${euro(f.amountMax)}`);
  if (f.recurring === "yes") parts.push("Récurrent");
  if (f.recurring === "no") parts.push("Ponctuel");
  if (f.campuses?.length) parts.push(f.campuses.join(", "));
  if (f.years?.length) parts.push(f.years.join(", "));
  if (f.paymentTypes?.length) parts.push(f.paymentTypes.join(", "));
  if (f.occasions?.length) parts.push(f.occasions.join(", "));
  if (f.payStatus?.length) parts.push(f.payStatus.map(s => ({ paye: "Déjà payé", attente: "En attente" }[s] || s)).join(", "));
  if (f.segments?.length) parts.push(`Segment : ${f.segments.join(", ")}`);
  if (f.tags?.length) parts.push(`Étiquette : ${f.tags.join(", ")}`);
  if (f.lastGift) parts.push({ "12m": "A donné depuis 12 mois", old: "Dernier don > 12 mois", never: "N'a jamais donné" }[f.lastGift]);
  return parts.length ? parts.join(" · ") : "Aucun critère";
}
// Ouvre Contacts avec les filtres d'un segment enregistré (dynamique) déjà
// appliqués — navigate() accepte un override de filtres pour ça, justement
// pour ne pas reproduire l'ancien comportement (une simple recherche texte)
// qui ratait toute fiche ne contenant pas littéralement le nom du segment.
function applySegment(seg) {
  navigate("crm", "Contacts", { ...defaultFilters(), ...(seg.filters || {}) });
}
async function saveCurrentFiltersAsSegment() {
  const f = activeFilters();
  if (!filtersAreActive(f)) { notify("Choisissez au moins un critère dans les filtres avant d'enregistrer un segment"); state.drawer = "filters"; render(); return; }
  const name = await uiPrompt("Nom du segment", "", { title: "Enregistrer comme segment", placeholder: "Ex : Donateurs fidèles Beth Mena'hem", okLabel: "Enregistrer" });
  if (!name) return;
  savedViews.push({ id: nextId("SEG", savedViews), name, filters: { ...f }, createdAt: new Date().toISOString() });
  logAudit(`Segment enregistré : ${name}.`);
  saveCrmData();
  notify(`Segment « ${name} » enregistré`);
  render();
}
async function deleteSavedSegment(id) {
  const seg = savedViews.find(s => s.id === id);
  if (!seg) return;
  if (!await uiConfirm(`Supprimer le segment « ${seg.name} » ? Les fiches ne sont pas touchées.`, { title: "Supprimer le segment", danger: true, okLabel: "Supprimer" })) return;
  savedViews = savedViews.filter(s => s.id !== id);
  logAudit(`Segment supprimé : ${seg.name}.`);
  saveCrmData();
  render();
}
function segments() {
  const legacyTags = distinctLegacySegmentTags();
  const tags = distinctTags().slice(0, 40);
  return `<div class="stack">
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>${savedViews.length ? plural(savedViews.length, "segment") : "Segments"}</h2><p>Une liste dynamique : enregistrez une combinaison de filtres, le nombre de fiches se met à jour tout seul.</p></div>${btn("Nouveau segment", "goto-contacts-filters", "primary-btn", "plus")}</div>
      ${savedViews.length ? `<div class="rows rows-padded">${savedViews.map(seg => `<div class="row row-wide">
          <button type="button" class="row-main" data-action="apply-saved-segment:${seg.id}"><span class="todo-ic">${icon("layers")}</span><span class="row-text"><strong>${escapeHtml(seg.name)}</strong><span>${escapeHtml(summarizeSegmentCriteria(seg.filters || {}))}</span></span></button>
          <span class="row-amount">${plural(segmentMatchCount(seg), "fiche")}</span>
          <div class="row-actions">${btn("Ouvrir", `apply-saved-segment:${seg.id}`, "btn-sm")}<button type="button" class="icon-btn btn-sm danger-text" data-action="delete-saved-segment:${seg.id}" title="Supprimer">${icon("trash")}</button></div>
        </div>`).join("")}</div>`
        : `<div class="empty-state"><span class="empty-ic">${icon("layers", 22)}</span><p>Aucun segment enregistré. Depuis Contacts, ouvrez « Filtres », choisissez vos critères (montant, année, étiquette, dernier don…), puis « Enregistrer comme segment ».</p>${btn("Aller aux contacts", "goto-contacts-filters", "primary-btn")}</div>`}
    </section>
    ${tags.length ? `<section class="panel pad">${sectionHead("Par étiquette", "", "Cliquez sur une étiquette pour voir les fiches qui la portent.")}<div class="chip-list">${tags.map(t => `<button type="button" class="tag tag-btn" data-action="apply-tag:${encodeURIComponent(t)}">${escapeHtml(t)}</button>`).join("")}</div></section>` : ""}
    ${legacyTags.length ? `<section class="panel pad">${sectionHead("Segments importés", "", "Segments en texte libre repris de l'ancien outil.")}<div class="chip-list">${legacyTags.map(s => `<button type="button" class="tag tag-btn" data-action="apply-legacy-segment:${encodeURIComponent(s)}">${escapeHtml(s)}</button>`).join("")}</div></section>` : ""}
  </div>`;
}












function categoriesView() {
  const counts = {};
  interactions.forEach(i => { if (i.category) counts[i.category] = (counts[i.category] || 0) + 1; });
  return `<div class="split"><section class="panel pad">
    <div class="toolbar clean"><div><span class="eyebrow">Paramètres</span><h2>Catégories d'interaction</h2><p>Ces libellés servent à classer les interactions (appels, chiours, visites...) et alimentent le menu déroulant "Catégorie" partout où on ajoute une interaction.</p></div></div>
    <div class="category-manager">${interactionCategories.map((c, i) => `
      <div class="category-row">
        <input type="text" value="${escapeHtml(c)}" data-category-index="${i}">
        <span class="mini-pill">${counts[c] || 0} interaction(s)</span>
        <button type="button" class="icon-btn" data-action="delete-category:${i}" title="Supprimer">${icon("trash")}</button>
      </div>`).join("")}</div>
    ${action("Ajouter une catégorie", "add-category", "primary-btn")}
    </section>
    <section class="panel pad"><span class="eyebrow">Astuce</span><h2>Vision claire</h2><p>Renommer une catégorie met à jour toutes les interactions déjà enregistrées avec ce libellé. La supprimer ne touche pas l'historique : les interactions gardent leur libellé texte, seule la liste de choix change.</p></section>
    </div>`;
}



function render() {
  rebuildIndexes();
  closeMenu();
  if (state.showDetail && !recordById(state.selectedRecord)) { state.showDetail = false; state.mobileDetailOpen = false; }
  if (state.view === "admin" && currentAccount?.profile !== "Administrateur") { state.view = "home"; state.section = "Accueil"; }
  setHeader();
  renderNav();
  const views = { home, stats, crm, follow, pay: paymentsView, imports: importsView, settings: settingsView, admin };
  content().innerHTML = (views[state.view] || home)();
  renderDrawer();
  bind();
  syncBottomNav();
  // Sur téléphone, la fiche d'un contact se comporte comme une page à part :
  // la barre de navigation du bas est masquée tant qu'elle est ouverte.
  document.body.classList.toggle("detail-fullscreen", !!state.showDetail);
  if (state.showDetail && state.scrollToTab) scrollDetailToSection(state.scrollToTab, false);
  state.scrollToTab = null;
  state.pendingRender = false;
  syncUrl();
}

/* ---------- 7. Fiche détail ------------------------------------------- */

// Fiche contact : une seule page qui défile, découpée en sections, avec une
// rangée de "pastilles" en haut qui font défiler jusqu'à la section visée
// (scrollIntoView) plutôt que de cacher 5 sections sur 6 derrière des
// onglets. state.tab garde son rôle (quelle section cibler) mais ne
// contrôle plus ce qui s'affiche — tout est toujours affiché.


function birthdayHint(r) {
  if (!parseDob(r.dob)) return "";
  const today = todayIso();
  const civil = nextCivilBirthday(r, today);
  const heb = nextHebrewBirthday(r, today);
  const fmt = iso => iso === today ? "aujourd'hui" : utcNoon(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return [civil && `Prochain anniversaire civil : ${fmt(civil)}`, heb && `hébraïque : ${fmt(heb)}`].filter(Boolean).join(" · ");
}



// Fait défiler la fiche jusqu'à la section visée (pastilles en haut de la
// fiche sur téléphone, ou retour sur la fiche après un ajout).
function scrollDetailToSection(key, smooth) {
  if (!key) return;
  if (key === "Details") { window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" }); return; }
  const target = document.querySelector(`.record-page [data-section="${key}"]`);
  if (target) target.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

/* ---------- 8. Navigation & tiroir mobile ------------------------------- */

function openNav() {
  state.navOpen = true;
  document.querySelector("#sidebar")?.classList.add("open");
  document.querySelector("#navScrim")?.classList.add("show");
  syncBottomNav();
}
function closeNav() {
  state.navOpen = false;
  document.querySelector("#sidebar")?.classList.remove("open");
  document.querySelector("#navScrim")?.classList.remove("show");
  syncBottomNav();
}



async function addInteractionCategory() {
  const name = await uiPrompt("Nom de la nouvelle catégorie", "", { title: "Nouvelle catégorie", placeholder: "Ex : Chiour" });
  if (!name) return;
  if (interactionCategories.some(c => c.toLowerCase() === name.toLowerCase())) { notify("Cette catégorie existe déjà"); return; }
  interactionCategories.push(name);
  logAudit(`Catégorie d'interaction ajoutée : ${name}.`);
  saveCrmData();
  render();
}
function renameInteractionCategory(index, newName) {
  const name = (newName || "").trim();
  if (!name || !interactionCategories[index]) return;
  const oldName = interactionCategories[index];
  if (oldName === name) return;
  interactionCategories[index] = name;
  interactions.forEach(i => { if (i.category === oldName) i.category = name; });
  logAudit(`Catégorie renommée : ${oldName} → ${name}.`);
  saveCrmData();
}
async function deleteInteractionCategory(index) {
  const name = interactionCategories[index];
  if (!name) return;
  if (interactionCategories.length <= 1) { notify("Il doit rester au moins une catégorie"); return; }
  const used = interactions.filter(i => i.category === name).length;
  if (used && !await uiConfirm(`${used} interaction(s) utilisent « ${name} ». Elles garderont ce libellé, seule la liste de choix change.`, { title: "Supprimer la catégorie", danger: true, okLabel: "Supprimer" })) return;
  interactionCategories.splice(index, 1);
  logAudit(`Catégorie d'interaction supprimée : ${name}.`);
  saveCrmData();
  render();
}

function renderDrawer() {
  document.querySelector("#drawerScrim")?.classList.toggle("show", !!state.drawer);
  if (!state.drawer) { drawerEl().className = "drawer"; drawerEl().innerHTML = ""; return; }
  drawerEl().className = "drawer open";
  const views = {
    dedupe: ["Doublons potentiels", dedupeDrawerBody()],
    filters: ["Filtres", filtersDrawerBody()],
  };
  const [title, body] = views[state.drawer] || ["", ""];
  drawerEl().innerHTML = `<header class="drawer-head"><h2>${title}</h2><button class="icon-btn" type="button" data-action="close-drawer" title="Fermer">${icon("x")}</button></header><div class="drawer-body">${body}</div>`;
}

// Tiroir "Doublons potentiels" : soit une recherche libre sur tous les
// groupes détectés (ouvert depuis l'accueil/le menu Actions), soit, quand on
// vient du bouton "Voir les doublons" d'une fiche précise, uniquement les
// groupes qui concernent cette fiche-là (state.dedupeFocusId).
function dedupeDrawerBody() {
  const focusRecord = state.dedupeFocusId ? recordById(state.dedupeFocusId) : null;
  const groups = focusRecord
    ? duplicateGroupsCache.filter(g => g.records.some(r => r.id === focusRecord.id))
    : filterDuplicateGroups(duplicateGroupsCache, state.dedupeQuery);
  const searchBox = focusRecord ? "" : `<div class="toolbar thin"><input class="search" id="dedupeSearch" value="${escapeHtml(state.dedupeQuery)}" placeholder="Rechercher un nom, un email, un téléphone…" autocapitalize="off" autocorrect="off" spellcheck="false" /></div>`;
  const header = focusRecord
    ? `<p class="muted-note">Doublons potentiels pour <strong>${escapeHtml(focusRecord.name)}</strong>. ${action("← Voir tous les doublons", "dedupe-clear-focus")}</p>`
    : `<p class="muted-note">${groups.length.toLocaleString("fr-FR")} doublon(s) potentiel(s)${duplicateGroupsCache.length !== groups.length ? ` sur ${duplicateGroupsCache.length.toLocaleString("fr-FR")} au total` : ""} (même email ou même téléphone).</p>`;
  const body = groups.length
    ? `<div class="dup-groups">${groups.map(g => dedupeGroupCard(g)).join("")}</div>`
    : emptyState(state.dedupeQuery ? "Aucun doublon ne correspond à cette recherche." : "Aucun doublon détecté.");
  return `${searchBox}${header}${body}`;
}
function filterDuplicateGroups(groups, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return groups;
  return groups.filter(g => g.records.some(r =>
    String(r.name || "").toLowerCase().includes(q) ||
    String(r.email || "").toLowerCase().includes(q) ||
    String(r.phone || "").toLowerCase().includes(q) ||
    String(r.phone2 || "").toLowerCase().includes(q)
  ));
}
function dedupeGroupCard(g) {
  const label = g.reason.charAt(0).toUpperCase() + g.reason.slice(1);
  return `<div class="dup-group">
    <span class="eyebrow">${escapeHtml(label)} · ${escapeHtml(g.display)}</span>
    ${g.records.map(r => dedupeRecordRow(r, g)).join("")}
  </div>`;
}
function dedupeRecordRow(r, g) {
  const keyEnc = encodeURIComponent(g.key);
  return `<div class="dup-record-row">
    <button type="button" class="dup-record-link" data-action="open-record:${r.id}">
      <strong>${escapeHtml(r.name || "(sans nom)")}</strong>
      <span>${r.kind}${r.email ? " · " + escapeHtml(r.email) : ""}${r.phone ? " · " + escapeHtml(r.phone) : ""}</span>
      <span>${recordPaymentsCount(r)} paiement(s) · ${recordInteractionsCount(r)} interaction(s)${r.dateModified ? " · modifiée le " + escapeHtml(r.dateModified) : ""}</span>
    </button>
    <div class="row-actions">
      ${action("Garder celle-ci et fusionner", `dedupe-merge:${keyEnc}§${r.id}`, "primary-btn")}
      ${action("Nom séparé", `dedupe-separate:${keyEnc}§${r.id}`)}
      ${action("Effacer", `dedupe-delete:${keyEnc}§${r.id}`)}
    </div>
  </div>`;
}

function bind() {
  // Lignes de tableau cliquables (<tr data-action>) : pas des boutons, donc
  // inatteignables au clavier et muettes pour un lecteur d'écran. On les rend
  // focalisables et activables avec Entrée/Espace.
  document.querySelectorAll("#content tr[data-action], #content div[data-action], #content tr[data-record]").forEach(el => {
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.addEventListener("keydown", e => {
      if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      el.click();
    });
  });
  // Les pastilles de la fiche contact ne reconstruisent plus toute la page :
  // tout est déjà affiché (une seule page qui défile), donc un clic se
  // contente de faire défiler jusqu'à la section et de déplacer la
  // surbrillance — plus fluide qu'un render() complet à chaque clic.
  document.querySelectorAll(".detail-jumpnav [data-tab]").forEach(el => el.addEventListener("click", () => {
    state.tab = el.dataset.tab;
    document.querySelectorAll(".detail-jumpnav .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === state.tab));
    scrollDetailToSection(state.tab, true);
  }));
  document.querySelectorAll("[data-category-index]").forEach(el => {
    el.addEventListener("change", () => { renameInteractionCategory(Number(el.dataset.categoryIndex), el.value); render(); });
  });
  // Tiroir "Filtres" (Contacts/Structures) : chaque case/menu/montant met à
  // jour state.filters puis redessine tout (liste filtrée + badge du bouton
  // "Filtres" + le tiroir lui-même, qui reste ouvert puisque state.drawer
  // n'est pas touché ici).
  document.querySelectorAll("[data-filter]").forEach(el => {
    el.addEventListener("change", () => {
      const key = el.dataset.filter;
      const f = activeFilters();
      const list = new Set(f[key] || []);
      if (el.checked) list.add(el.value); else list.delete(el.value);
      f[key] = [...list];
      state.recordsPage = PAGE_STEP;
      render();
    });
  });
  document.querySelectorAll("[data-filter-select]").forEach(el => {
    el.addEventListener("change", () => {
      activeFilters()[el.dataset.filterSelect] = el.value;
      state.recordsPage = PAGE_STEP;
      render();
    });
  });
  document.querySelectorAll("[data-filter-amount]").forEach(el => {
    el.addEventListener("input", () => {
      const cursor = el.selectionStart;
      const digitsOnly = el.value.replace(/[^\d]/g, "");
      activeFilters()[el.dataset.filterAmount] = digitsOnly;
      state.recordsPage = PAGE_STEP;
      render();
      const next = document.querySelector(`[data-filter-amount="${el.dataset.filterAmount}"]`);
      if (next) { next.focus(); next.setSelectionRange(cursor, cursor); }
    });
  });
  // Un <input type="time"> vide n'a pas de placeholder (iOS l'affiche comme
  // un encadré vide) : data-empty sur son libellé fait apparaître
  // "Facultatif" en CSS tant qu'aucune heure n'est choisie.
  document.querySelectorAll("#hpTaskForm .hp-task-field").forEach(cell => {
    cell.addEventListener("click", () => { try { cell.querySelector("input")?.showPicker?.(); } catch { /* sélecteur indisponible */ } });
  });
  document.querySelectorAll("#hpTaskForm input[type=time]").forEach(el => {
    const sync = () => el.closest(".hp-task-field")?.toggleAttribute("data-empty", !el.value);
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  });
  document.querySelector("#hpTaskForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    addHomeTask(data.get("title"), data.get("dueDate"), data.get("recordId"), data.get("dueTime"));
  });
  (() => {
    const titleInput = document.querySelector("#hpTaskTitle");
    const suggestBox = document.querySelector("#hpTaskSuggest");
    const recordIdInput = document.querySelector("#hpTaskRecordId");
    const linkedBox = document.querySelector("#hpTaskLinked");
    const linkedName = document.querySelector("#hpTaskLinkedName");
    const unlinkBtn = document.querySelector("#hpTaskUnlink");
    const createBtn = document.querySelector("#hpTaskCreateContact");
    createBtn?.addEventListener("click", async () => {
      const name = await uiPrompt("Prénom et nom du nouveau contact à lier", "", { title: "Nouveau contact", placeholder: "Prénom Nom", okLabel: "Créer et lier" });
      if (!name) return;
      const rec = quickCreateContact(name);
      if (!rec) return;
      if (recordIdInput) recordIdInput.value = rec.id;
      if (linkedName) linkedName.textContent = rec.name || "";
      if (linkedBox) linkedBox.hidden = false;
      notify(`Contact "${rec.name}" créé et lié`);
    });
    if (!titleInput || !suggestBox) return;
    titleInput.addEventListener("input", () => {
      if (recordIdInput) recordIdInput.value = "";
      if (linkedBox) linkedBox.hidden = true;
      const query = taskContactQuery(titleInput.value);
      const matches = query ? matchRecordsForTask(query) : [];
      if (!matches.length) { suggestBox.hidden = true; suggestBox.innerHTML = ""; return; }
      suggestBox.innerHTML = matches.map(r => `<button type="button" class="hp-task-suggest-item" data-id="${r.id}">${escapeHtml(r.name || "")}<span class="hp-task-suggest-kind">${r.kind === "Structure" ? "Structure" : "Contact"}</span></button>`).join("");
      suggestBox.hidden = false;
    });
    titleInput.addEventListener("blur", () => { setTimeout(() => { suggestBox.hidden = true; }, 150); });
    suggestBox.addEventListener("mousedown", e => {
      const btn = e.target.closest(".hp-task-suggest-item");
      if (!btn) return;
      e.preventDefault();
      const rec = recordById(btn.dataset.id);
      if (!rec) return;
      if (recordIdInput) recordIdInput.value = rec.id;
      if (linkedName) linkedName.textContent = rec.name || "";
      if (linkedBox) linkedBox.hidden = false;
      suggestBox.hidden = true;
      suggestBox.innerHTML = "";
    });
    unlinkBtn?.addEventListener("click", () => {
      if (recordIdInput) recordIdInput.value = "";
      if (linkedBox) linkedBox.hidden = true;
    });
  })();
  document.querySelectorAll(".hp-task-date").forEach(el => {
    el.addEventListener("change", () => {
      const t = tasks.find(x => x.id === el.dataset.task);
      if (!t) return;
      t.dueDate = el.value || "";
      saveCrmData();
      render();
    });
  });
  document.querySelector("#notifEnabledToggle")?.addEventListener("change", async (e) => {
    const el = e.target;
    el.disabled = true;
    if (el.checked) {
      const ok = await enablePushNotifications(pushState.time);
      if (!ok) { render(); return; }
      notify("Rappels activés sur cet appareil");
    } else {
      await disablePushNotifications();
      notify("Rappels désactivés sur cet appareil");
    }
    render();
  });
  document.querySelector("#notifTimeInput")?.addEventListener("change", async (e) => {
    pushState.time = e.target.value || "09:00";
    if (pushState.enabled) {
      try { await apiSetPushPrefs(true, pushState.time); } catch { /* reseau indisponible : reessaiera au prochain changement */ }
    }
  });
  document.querySelector("#auditSearch")?.addEventListener("input", e => {
    const cursor = e.target.selectionStart || e.target.value.length;
    state.auditQuery = e.target.value;
    render();
    const next = document.querySelector("#auditSearch");
    next?.focus();
    next?.setSelectionRange(cursor, cursor);
  });
  document.querySelector("#pageSearch")?.addEventListener("input", e => {
    const cursor = e.target.selectionStart || e.target.value.length;
    state.query = e.target.value;
    state.recordsPage = PAGE_STEP;
    state.paymentsPage = PAGE_STEP;
    render();
    const next = document.querySelector("#pageSearch");
    next?.focus();
    next?.setSelectionRange(cursor, cursor);
  });
  document.querySelector("#dedupeSearch")?.addEventListener("input", e => {
    const cursor = e.target.selectionStart || e.target.value.length;
    state.dedupeQuery = e.target.value;
    render();
    const next = document.querySelector("#dedupeSearch");
    next?.focus();
    next?.setSelectionRange(cursor, cursor);
  });
}

function navigate(view, section, filtersOverride) {
  state.view = view;
  state.section = section || defaultSection(view);
  state.query = "";
  state.filters = filtersOverride || defaultFilters();
  state.quick = "";
  state.selection.clear();
  state.payFilters = { type: "", year: "", status: "", method: "" };
  state.drawer = null;
  state.showDetail = false;
  state.mobileDetailOpen = false;
  state.detailReturn = null;
  state.recordsPage = PAGE_STEP;
  state.paymentsPage = PAGE_STEP;
  render();
}
// Ouvre la fiche d'un contact ou d'une structure en pleine page, en gardant
// en mémoire l'écran d'où l'on vient pour le bouton Retour.
function openRecord(id, tab) {
  const r = records.find(x => x.id === id);
  if (!r) return notify("Fiche introuvable");
  if (!(state.view === "crm" && state.showDetail)) state.detailReturn = { view: state.view, section: state.section, scrollY: window.scrollY };
  state.view = "crm";
  state.section = r.kind === "Structure" ? "Structures" : "Contacts";
  state.selectedRecord = r.id;
  state.showDetail = true;
  state.mobileDetailOpen = true;
  state.drawer = null;
  state.tab = tab || "Details";
  state.scrollToTab = tab && tab !== "Details" ? tab : null;
  render();
  if (!state.tab || state.tab === "Details") scrollToTop();
}
function closeRecord() {
  const back = state.detailReturn;
  state.detailReturn = null;
  state.showDetail = false;
  state.mobileDetailOpen = false;
  if (back) { state.view = back.view; state.section = back.section; }
  render();
  window.scrollTo(0, back ? back.scrollY || 0 : 0);
}
function myFirstName() {
  return currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
}
// Remonte en haut de la page après ouverture d'une fiche. Sur mobile, la fiche
// et la liste sont empilées dans une seule colonne (et la liste peut compter
// des milliers de lignes) : sans ça, la fiche s'ouvrait bien mais restait
// invisible tout en bas, hors écran — on avait l'impression que rien ne
// s'ouvrait en cliquant sur un contact ou un don.
function scrollToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

/* ---------- 9. Modales & actions rapides -------------------------------- */

function handleAction(key, el) {
  if (!key) return;
  if (isReadOnlyAccount() && WRITE_ACTION_RE.test(key)) return notify(READ_ONLY_MSG);
  const [name, ...args] = key.split(":");
  const arg = args[0];
  switch (name) {
    // "open-record:<id>" ouvre la fiche ; "open-record:<id>:<Section>" l'ouvre
    // directement sur la section utile (un clic sur un don -> "Paiements").
    case "open-record": return openRecord(arg, args[1]);
    case "goto": return (navigate(arg, args.slice(1).join(":") || defaultSection(arg)), scrollToTop());
    case "download-receipt-pdf": return downloadReceiptPdf(arg);
    case "regenerate-receipt": return regenerateReceipt(arg);
    case "quick-interaction": return openQuickForRecord(arg, "interaction");
    case "quick-payment": return openQuickForRecord(arg, "payment");
    case "quick-pledge": return openQuickForRecord(arg, "payment", { status: "Promis" });
    case "quick-comment": return openQuickForRecord(arg, "comment");
    case "quick-task": return openQuickForRecord(arg, "task");
    case "add-payment": return openModal("payment", { type: arg || "Don" });
    case "add-pledge": return openModal("payment", { status: "Promis" });
    case "add-task": return openModal("task");
    case "toggle-panel": {
      collapsedPanels = collapsedPanels.includes(arg) ? collapsedPanels.filter(x => x !== arg) : [...collapsedPanels, arg];
      try { localStorage.setItem(PANELS_KEY, JSON.stringify(collapsedPanels)); } catch { /* stockage indisponible */ }
      return render();
    }
    case "bday-scope": state.birthdayScope = arg; return render();
    case "bday-month": {
      const step = Number(arg);
      const cur = state.birthdayMonth || todayIso().slice(0, 7);
      const [y, m] = cur.split("-").map(Number);
      state.birthdayMonth = step === 0 ? null : new Date(Date.UTC(y, m - 1 + step, 1)).toISOString().slice(0, 7);
      return render();
    }
    // "edit-record:<champ>" : clic sur une case de la fiche -> ouvre la
    // modification de la fiche directement sur ce champ.
    case "edit-record": {
      openModal("editRecord");
      if (arg) {
        const input = dialogContent().querySelector(`[name="${arg}"]`);
        if (input) { input.scrollIntoView({ block: "center" }); setTimeout(() => input.focus(), 50); }
      }
      return;
    }
    case "add-linkage": return openModal("linkage", { recordId: arg });
    case "delete-linkage": return deleteLinkage(arg);
    case "apply-legacy-segment": return navigate("crm", "Contacts", { ...defaultFilters(), segments: [decodeURIComponent(key.slice("apply-legacy-segment:".length))] });
    case "apply-tag": return navigate("crm", "Contacts", { ...defaultFilters(), tags: [decodeURIComponent(key.slice("apply-tag:".length))] });
    case "apply-saved-segment": { const seg = savedViews.find(s => s.id === arg); if (seg) applySegment(seg); return; }
    case "delete-saved-segment": return deleteSavedSegment(arg);
    case "open-group": { navigate("crm", "Contacts"); state.query = decodeURIComponent(key.slice("open-group:".length)); return render(); }
    case "notify-app": return notify(`${arg} n'est pas encore connecté au CRM.`);
    case "delete-category": return deleteInteractionCategory(Number(arg));
    case "delete-field": return deleteCustomField(decodeURIComponent(key.slice("delete-field:".length)));
    case "edit-account": { const acc = accounts.find(a => a.id === arg); if (acc) openModal("account", { existing: acc }); return; }
    case "delete-account": return deleteAccount(arg);
    case "toggle-task": return toggleTaskDone(arg);
    case "edit-task": return openEditTask(arg);
    case "delete-task": return deleteHomeTask(arg);
    case "task-scope": state.taskScope = arg; return render();
    case "edit-payment": return openEditPayment(arg);
    case "delete-payment": return deletePayment(arg);
    case "add-installment": return openAddInstallment(arg);
    case "mark-received": return markPaymentReceived(arg);
    case "pay-type": state.payFilters.type = arg || ""; state.paymentsPage = PAGE_STEP; return render();
    case "holiday-prepare": return openHolidayModal(arg);
    case "portfolio-touch": return openPortfolioTouch(arg);
    case "toggle-portfolio": return togglePortfolio(arg);
    case "quick-filter": state.quick = arg || ""; state.recordsPage = PAGE_STEP; state.selection.clear(); return render();
    case "sort": {
      state.sort = state.sort.key === arg ? { key: arg, dir: state.sort.dir === "asc" ? "desc" : "asc" } : { key: arg, dir: arg === "name" ? "asc" : "desc" };
      state.recordsPage = PAGE_STEP;
      return render();
    }
    case "export-records": return exportTable(state.section === "Structures" ? "structures" : "contacts", recordExportColumns(), sortedRecords(state.section === "Structures" ? "Structure" : "Contact"), arg);
    case "export-payments": return exportTable("paiements", paymentExportColumns(), filteredPayments(), arg);
    case "log-contact": {
      const rec = recordById(args[1]);
      if (!rec || isReadOnlyAccount()) return;
      return notify(`${arg} — ${rec.name}`, false, { label: "Consigner l'échange", run: () => openQuickForRecord(rec.id, "interaction", { type: arg }) });
    }
    case "delete-interaction": return deleteInteraction(arg);
    case "edit-campaign": return openModal("campaign", { existing: campaigns.find(c => c.id === arg) });
    case "delete-campaign": return deleteCampaign(arg);
    case "archive-campaign": { const c = campaigns.find(x => x.id === arg); if (c) { c.archived = !c.archived; logAudit(`Campagne ${c.archived ? "archivée" : "réactivée"} : ${c.name}.`); saveCrmData(); render(); } return; }
    case "open-campaign": { navigate("pay", "Tous les paiements"); state.query = decodeURIComponent(key.slice("open-campaign:".length)); return render(); }
    case "stats-year": state.statsYear = arg || ""; return render();
    case "receipts-filter": state.receiptsFilter = arg || ""; state.paymentsPage = PAGE_STEP; return render();
    case "interaction-filter": state.interactionFilter = decodeURIComponent(key.slice("interaction-filter:".length)); return render();
    // Actions du tiroir "Doublons potentiels" : la clé du groupe est encodée
    // puis suivie de "§<idFiche>", car elle contient elle-même des ":".
    case "dedupe-merge": { const [gk, id] = key.slice("dedupe-merge:".length).split("§"); return mergeDuplicateGroup(decodeURIComponent(gk), id); }
    case "dedupe-separate": { const [gk, id] = key.slice("dedupe-separate:".length).split("§"); return separateDuplicateRecord(decodeURIComponent(gk), id); }
    case "dedupe-delete": { const [gk, id] = key.slice("dedupe-delete:".length).split("§"); return deleteDuplicateRecord(decodeURIComponent(gk), id); }
    case "dedupe-focus": state.drawer = "dedupe"; state.dedupeFocusId = arg; state.dedupeQuery = ""; return render();
    default: break;
  }

  const actions = {
    "add-contact": () => openModal("contact"),
    "add-comment": () => openModal("comment"),
    "add-structure": () => openModal("structure"),
    "add-user": () => openModal("account"),
    "add-field": () => openModal("field"),
    "add-group": () => openModal("group"),
    "add-interaction": () => openModal("interaction"),
    "add-campaign": () => openModal("campaign"),
    "add-category": () => addInteractionCategory(),
    "add-to-portfolio": () => openAddToPortfolioModal(),
    "import-new": () => openImportModal(),
    "export-current": () => downloadCsv(`export-${state.section.toLowerCase().replace(/[^a-z0-9]+/gi, "-")}-${todayIso()}.csv`, currentRows()),
    "export-interactions": () => exportInteractions(),
    "reset-filters": () => { state.query = ""; state.filters = defaultFilters(); state.quick = ""; state.payFilters = { type: "", year: "", status: "", method: "" }; state.recordsPage = PAGE_STEP; state.paymentsPage = PAGE_STEP; render(); },
    // Réinitialise uniquement les filtres avancés (bouton dans le tiroir
    // "Filtres" lui-même) sans effacer la recherche texte ni fermer le tiroir.
    "reset-filters-only": () => { state.filters = defaultFilters(); state.recordsPage = PAGE_STEP; render(); },
    "save-segment": () => saveCurrentFiltersAsSegment(),
    "send-test-push": () => sendTestPushAndNotify(),
    "load-more-records": () => { state.recordsPage += PAGE_STEP; render(); },
    "load-more-payments": () => { state.paymentsPage += PAGE_STEP; render(); },
    "open-filters": () => { state.drawer = "filters"; render(); },
    "close-drawer": () => { state.drawer = null; render(); },
    "dedupe": () => { state.drawer = "dedupe"; state.dedupeFocusId = null; state.dedupeQuery = ""; render(); },
    "dedupe-clear-focus": () => { state.dedupeFocusId = null; render(); },
    "generate-receipts": () => generateMissingReceipts(),
    "export-receipt-log": () => downloadCsv(`suivi-comptable-cerfa-${todayIso()}.csv`, receiptLog.map(({ id, ...line }) => line)),
    "delete-record": () => deleteSelectedRecord(),
    "close-detail": () => closeRecord(),
    "toggle-done-tasks": () => { state.showDoneTasks = !state.showDoneTasks; render(); },
    "bulk-tag": () => bulkTag(),
    "bulk-portfolio": () => bulkPortfolio(),
    "bulk-delete": () => bulkDelete(),
    "bulk-clear": () => { state.selection.clear(); render(); },
    "bulk-emails": () => openEmailModal(selectedRecords(), `Écrire aux ${state.selection.size} contact(s) sélectionné(s)`),
    "bulk-export": () => exportTable("selection", recordExportColumns(), selectedRecords(), "xlsx"),
    "email-list": () => openEmailModal(sortedRecords(state.section === "Structures" ? "Structure" : "Contact"), "Écrire aux contacts de cette liste"),
    "toggle-theme": () => applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark"),
    "change-password": () => openModal("password"),
    "download-backup": () => downloadBackup(),
    "open-palette": () => openPalette(),
    "logout": () => logout(),
    "goto-receipts": () => navigate("pay", "Reçus"),
    "goto-interactions": () => navigate("follow", "Interactions"),
    "goto-contacts": () => navigate("crm", "Contacts"),
    "goto-contacts-filters": () => { navigate("crm", "Contacts"); state.drawer = "filters"; render(); },
    "quick-filter-noemail": () => { navigate("crm", "Contacts"); state.quick = "noemail"; render(); },
    "noop": () => {},
    "goto-portfolio": () => navigate("follow", "Portefeuille"),
    "goto-tasks": () => navigate("follow", "Tâches"),
    "goto-pledges": () => navigate("pay", "Promesses"),
    "goto-payments": () => navigate("pay", "Tous les paiements"),
    "goto-campaigns": () => navigate("pay", "Campagnes"),
    "goto-stats": () => navigate("stats", "Vue d'ensemble"),
    "goto-account": () => navigate("settings", "Mon compte"),
    "goto-lapsed": () => { navigate("crm", "Contacts"); state.quick = "lapsed"; state.sort = { key: "total", dir: "desc" }; render(); },
    "goto-birthdays": () => { state.birthdayMonth = null; navigate("follow", "Anniversaires"); },
    "goto-audit": () => navigate("admin", "Journal d'activité"),
  };
  const run = actions[key];
  if (!run) return;
  run();
  if (key.startsWith("goto-")) scrollToTop();
}

// Un don promis vient d'arriver : il passe "Reçu" à la date du jour et
// devient éligible au reçu fiscal.
function markPaymentReceived(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  const before = { status: p.status, paymentDate: p.paymentDate, receipt: p.receipt };
  p.status = "Reçu";
  p.paymentDate = todayIso();
  bumpReceiptIfReceived(p);
  logAudit(`Don marqué reçu : ${euro(p.amount)} de ${p.payer}.`);
  saveCrmData();
  render();
  notify(`${euro(p.amount)} de ${p.payer} marqué reçu`, false, { label: "Annuler", run: () => { Object.assign(p, before); saveCrmData(); render(); } });
}
function deleteInteraction(id) {
  const index = interactions.findIndex(i => i.id === id);
  if (index < 0) return;
  const [gone] = interactions.splice(index, 1);
  logAudit(`Interaction supprimée pour ${recordById(gone.recordId)?.name || gone.target || "un contact"}.`);
  saveCrmData();
  render();
  notify("Interaction supprimée", false, { label: "Annuler", run: () => { interactions.splice(Math.min(index, interactions.length), 0, gone); saveCrmData(); render(); } });
}
async function deleteLinkage(id) {
  const l = linkages.find(x => x.id === id);
  if (!l) return;
  if (!await uiConfirm(`Supprimer la liaison entre ${l.a} et ${l.b} ?`, { title: "Supprimer la liaison", danger: true, okLabel: "Supprimer" })) return;
  linkages = linkages.filter(x => x.id !== id);
  logAudit(`Liaison supprimée entre ${l.a} et ${l.b}.`);
  saveCrmData();
  render();
}
async function deleteCampaign(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  if (!await uiConfirm(`Supprimer la campagne « ${c.name} » ? Les dons déjà enregistrés gardent leur occasion.`, { title: "Supprimer la campagne", danger: true, okLabel: "Supprimer" })) return;
  campaigns = campaigns.filter(x => x.id !== id);
  logAudit(`Campagne supprimée : ${c.name}.`);
  saveCrmData();
  render();
}
async function deleteCustomField(name) {
  if (!await uiConfirm(`Supprimer le champ « ${name} » ? Les valeurs déjà saisies sur les fiches sont conservées mais ne seront plus affichées.`, { title: "Supprimer le champ", danger: true, okLabel: "Supprimer" })) return;
  customFields = customFields.filter(f => f.name !== name);
  logAudit(`Champ personnalisé supprimé : ${name}.`);
  saveCrmData();
  render();
}
function exportInteractions() {
  exportTable("interactions", [
    ["Date", i => i.date], ["Contact / structure", i => recordById(i.recordId)?.name || i.target || ""], ["Type", i => i.type], ["Catégorie", i => i.category],
    ["Libellé", i => i.label], ["Note", i => i.note], ["Saisi par", i => i.user],
  ], [...interactions].sort((a, b) => (b.at || "").localeCompare(a.at || "")), "xlsx");
}
async function downloadBackup() {
  notify("Préparation de la sauvegarde…");
  try {
    const res = await fetch(`${API_BASE}/api/backup`, { headers: authHeaders() });
    if (!res.ok) throw new Error("refus");
    triggerDownload(await res.blob(), `sauvegarde-crm-sinai-${todayIso()}.json`);
    logAudit("Sauvegarde complète téléchargée.");
    saveCrmData({ silent: true });
  } catch {
    notify("Sauvegarde impossible pour le moment", true);
  }
}
async function logout() {
  await apiLogout();
  await idbDel("state");
  await idbDel("pending");
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* stockage indisponible */ }
  history.replaceState(null, "", location.pathname);
  location.reload();
}

function modalShell(kind, eyebrow, title, body, submit = "Enregistrer") {
  const d = dialog();
  if (d.open) d.close();
  d.className = kind === "editRecord" ? "wide-dialog" : "";
  dialogContent().innerHTML = `<form class="modal" data-form="${kind}">
    <header><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">${icon("x")}</button></header>
    <div class="form-grid">${body}</div>
    <footer><button type="button" data-modal-close>Annuler</button><button class="primary-btn" type="submit">${submit}</button></footer>
  </form>`;
  d.showModal();
  dialogContent().querySelector("form").addEventListener("submit", submitForm);
  dialogContent().querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => d.close()));
  wirePickers(dialogContent());
  wireCategoryAdders(dialogContent());
  wireDobPreview(dialogContent());
  // Boutons "Copier" des modèles de message (stratégie des fêtes, et tout
  // futur champ en lecture seule à copier-coller ailleurs).
  dialogContent().querySelectorAll("[data-copy-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = dialogContent().querySelector(`#${btn.dataset.copyTarget}`);
      if (target) copyFieldValue(target);
    });
  });
  // Le bloc "versements" (payé jusqu'ici / reste à payer / ajouter un
  // versement maintenant) ne veut rien dire tant que "Paiement échelonné"
  // n'est pas sur "Oui" : on ne l'affiche que dans ce cas, et on le
  // montre/cache en direct si on change ce menu sans fermer la modale.
  const installmentSelect = dialogContent().querySelector('select[name="installmentPlan"]');
  const installmentSection = dialogContent().querySelector('[data-installment-section]');
  if (installmentSelect && installmentSection) {
    const syncInstallmentSection = () => { installmentSection.style.display = installmentSelect.value === "Oui" ? "" : "none"; };
    syncInstallmentSection();
    installmentSelect.addEventListener("change", syncInstallmentSection);
  }
  // "Date du paiement" ne veut rien dire tant qu'un don n'est pas "Reçu" —
  // on ne la montre que dans ce cas (une promesse pas encore payée n'a pas
  // encore de date de paiement à donner).
  const paymentStatusSelect = dialogContent().querySelector('select[name="status"]');
  const paymentDateSection = dialogContent().querySelector('[data-payment-date-section]');
  if (paymentStatusSelect && paymentDateSection) {
    // À la création, un don déjà reçu n'a qu'une date (celle du paiement) ;
    // une promesse n'a que la date de la promesse.
    const promiseDateSection = dialogContent().querySelector('[data-promise-date-section]:not([data-keep])');
    const syncPaymentDateSection = () => {
      paymentDateSection.style.display = paymentStatusSelect.value === "Reçu" ? "" : "none";
      if (promiseDateSection) promiseDateSection.style.display = paymentStatusSelect.value === "Reçu" ? "none" : "";
    };
    syncPaymentDateSection();
    paymentStatusSelect.addEventListener("change", syncPaymentDateSection);
  }
  dialogContent().querySelector("input:not([readonly]), select, textarea")?.focus();
}

function contactLockedField(r) {
  return `<label class="span-2">Contact / structure<input type="text" value="${escapeHtml(r.name)}" readonly class="field-locked"><input type="hidden" name="recordId" value="${escapeHtml(r.id)}"></label>`;
}
const PAYMENT_METHODS = ["CB", "Chèque", "Virement", "SEPA", "Espèces"];
// Champ Occasion avec suggestions : les campagnes en cours d'abord, puis les
// occasions déjà utilisées — pour rattacher un don à une campagne sans faute
// de frappe.
function occasionField(value) {
  const names = [...new Set([...campaigns.filter(c => !c.archived).map(c => c.name), ...distinctOccasions()])];
  return `<label>Occasion / campagne<input name="occasion" type="text" value="${escapeHtml(value || "")}" list="occasionList" placeholder="Gala, Pessah, Bar Mitzvah…" autocomplete="off"><datalist id="occasionList">${names.map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist></label>`;
}
// Corps du formulaire d'un don / paiement (création : p = null).
function paymentFormBody(p, preset = {}) {
  return `
    ${selectField("Type", "type", ensureOption(PAYMENT_TYPE_OPTIONS, p?.type), p ? p.type : (preset.type || "Don"))}
    ${field("Montant total (€)", "amount", p ? p.amount : "", "number", "min='0.01' step='0.01' required inputmode='decimal'")}
    ${selectField("Statut", "status", ensureOption(["Reçu", "Promis"], p?.status), p ? p.status : (preset.status || "Reçu"))}
    ${selectField("Moyen", "method", ensureOption(PAYMENT_METHODS, p?.method), p ? p.method : (preset.status === "Promis" ? "Chèque" : "CB"))}
    <div data-promise-date-section${p ? " data-keep" : ""}>${field("Date de la promesse", "promiseDate", p ? (p.promiseDate || "") : todayIso(), "date")}</div>
    <div data-payment-date-section>${field("Date du paiement", "paymentDate", p ? (p.paymentDate || todayIso()) : todayIso(), "date")}</div>
    ${selectField("Paiement en plusieurs versements", "installmentPlan", ["Non", "Oui"], p?.installmentPlan ? "Oui" : "Non")}
    ${occasionField(p ? (p.occasion || []).join(", ") : (preset.occasion || ""))}
    ${installmentFormSection(p || null)}
    ${p ? selectField("Reçu fiscal", "receipt", ensureOption(["Non éligible", "À générer", "Généré", "Généré ailleurs"], p.receipt), p.receipt) : ""}
    ${textareaField("Note (facultatif)", "note", p?.note || "")}`;
}
// Corps du formulaire d'une tâche (création : t = null). lockedRecord : la
// tâche est créée depuis une fiche, le contact est donc déjà choisi.
function taskFormBody(t, lockedRecord) {
  const linked = t?.recordId ? recordById(t.recordId) : null;
  const people = [...new Set([myFirstName(), ...accounts.map(a => a.first), ...tasks.map(x => x.assignedTo)].filter(Boolean))];
  return `${t ? `<input type="hidden" name="taskId" value="${escapeHtml(t.id)}">` : ""}
    <label class="span-2">Titre de la tâche<input name="title" type="text" value="${escapeHtml(t?.title || "")}" required maxlength="140" placeholder="Ex : Relancer pour le renouvellement"></label>
    ${lockedRecord ? contactLockedField(lockedRecord) : pickerField("Contact lié (facultatif)", "recordId", linked, false, true)}
    ${field("Échéance", "dueDate", t ? (t.dueDate || "") : todayIso(), "date")}
    ${field("Heure (facultatif)", "dueTime", t?.dueTime || "", "time")}
    <label>Assignée à<input name="assignedTo" type="text" value="${escapeHtml(t ? (t.assignedTo || "") : myFirstName())}" list="assigneeList" autocomplete="off"><datalist id="assigneeList">${people.map(n => `<option value="${escapeHtml(n)}">`).join("")}</datalist></label>
    ${selectField("Priorité", "priority", ["Normale", "Haute"], t?.priority === "haute" ? "Haute" : "Normale")}
    ${textareaField("Détail (facultatif)", "note", t?.note || "")}`;
}
function openQuickForRecord(recordId, kind, preset = {}) {
  const r = recordById(recordId);
  if (!r) return notify("Fiche introuvable");
  if (kind === "payment") return modalShell("payment", r.name, preset.status === "Promis" ? "Nouvelle promesse de don" : "Nouveau don / paiement",
    `${contactLockedField(r)}${paymentFormBody(null, preset)}`);
  if (kind === "interaction") return modalShell("interaction", r.name, "Nouvelle interaction",
    `${contactLockedField(r)}
     ${field("Date", "date", todayIso(), "date", "required")}
     ${selectField("Type", "type", ["Appel", "Email", "Message", "Rendez-vous", "Note"], preset.type || "Appel")}
     ${categoryField(interactionCategories[0] || "Suivi")}
     ${field("Libellé", "label", "", "text", "placeholder='Ex : relance annuelle'")}
     ${textareaField("Détail (facultatif)", "note", "")}`);
  if (kind === "task") return modalShell("task", r.name, "Nouvelle tâche", taskFormBody(null, r), "Ajouter la tâche");
  return modalShell("comment", r.name, "Nouvelle note",
    `${contactLockedField(r)}
     ${field("Date", "date", todayIso(), "date", "required")}
     ${textareaField("Note", "note", "", "required placeholder='Une information utile à retenir sur ce contact…'")}`, "Ajouter la note");
}

function openEditPayment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  const r = recordById(p.recordId);
  modalShell("editPayment", p.payer || "Paiement", "Modifier le paiement",
    `${r ? contactLockedField(r) : ""}<input type="hidden" name="paymentId" value="${escapeHtml(p.id)}">${paymentFormBody(p)}`, "Enregistrer");
}
// Un paiement "échelonné" (ex : une Promesse réglée en plusieurs fois) suit
// ses versements séparément du montant total dû, pour calculer
// automatiquement ce qu'il reste à payer sans jamais modifier le montant
// d'origine de la promesse.
function paymentPaidTotal(p) {
  return (p.installments || []).reduce((sum, v) => sum + Number(v.amount || 0), 0);
}
function paymentRemaining(p) {
  return Number(p.amount || 0) - paymentPaidTotal(p);
}
// Un don et une promesse sont la même chose, juste à un stade différent :
// dès qu'un don passe "Reçu" (à la main, ou automatiquement parce que les
// versements couvrent enfin tout le montant), il doit devenir éligible au
// reçu fiscal tout seul — sans repasser par ce champ à la main en plus du
// statut.
function bumpReceiptIfReceived(p) {
  if (p.type === "Don" && p.status === "Reçu" && p.receipt === "Non éligible") p.receipt = "À générer";
}
// Le numéro de reçu est une mention légale du CERFA : il doit rester le même
// que le reçu soit régénéré une fois ou dix fois. On l'attribue une seule
// fois, au tout premier "Généré", séquentiel par année civile (RF-2026-0001,
// RF-2026-0002...) — jamais recalculé à l'affichage comme avant (ce qui
// changeait le numéro à chaque tri/filtre, inutilisable pour un vrai reçu
// fiscal).
function nextReceiptNumber() {
  const year = new Date().getFullYear();
  const prefix = `RF-${year}-`;
  const used = payments
    .filter(p => p.receiptNumber && p.receiptNumber.startsWith(prefix))
    .map(p => Number(p.receiptNumber.slice(prefix.length)) || 0);
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}
// Identité de l'entité émettrice du reçu fiscal CERFA, telle qu'elle figure
// sur le modèle utilisé par Les Institutions Sinaï (reçu n° A2026/00148,
// article 200/238bis/978 du CGI). Cas exceptionnel d'entité différente pour
// un don en particulier : voir la note de l'action "generate-receipts".
const RECEIPT_ENTITY = {
  name: "Les Institutions Sinaï",
  siren: "W751175124",
  address: "2 Rue Tristan Tzara, 75018 Paris",
  objet: "Association d'intérêt général, éducative, sociale et culturelle",
  qualite: "Œuvre ou organisme d'intérêt général",
  signatoryName: "Joseph Pevzner",
  signatoryTitle: "Directeur général",
};
// Libellés CERFA du mode de versement, à partir du moyen enregistré dans le CRM.
const RECEIPT_METHOD_LABELS = { "CB": "Carte bancaire", "Chèque": "Chèque", "Virement": "Virement bancaire", "SEPA": "Prélèvement SEPA", "Espèces": "Espèces" };
// "NOM OU DENOMINATION" du donateur tel qu'attendu sur le CERFA : civilité +
// nom en majuscules pour un particulier, raison sociale telle quelle pour
// une structure (personne morale).
function receiptDonorName(record) {
  if (!record) return "";
  if (record.kind === "Structure") return record.name || "";
  const civ = record.civility ? `${record.civility} ` : "";
  return `${civ}${(record.name || "").toUpperCase()}`;
}
// "ADRESSE DONATEUR" : adresse, puis code postal + ville en majuscules,
// exactement comme sur le modèle papier.
function receiptDonorAddress(record) {
  if (!record) return "";
  const parts = [];
  if (record.address) parts.push(record.address);
  const cityLine = [record.zip, (record.city || "").toUpperCase()].filter(Boolean).join(" ");
  if (cityLine) parts.push(cityLine);
  return parts.join(", ");
}
// Article du CGI à cocher : réduction d'impôt sur le revenu pour un
// particulier (200 du CGI), mécénat d'entreprise pour une structure (238 bis
// du CGI). Pas encore de cas IFI (978 du CGI) dans le CRM.
function receiptArticleCgi(record) {
  return record && record.kind === "Structure" ? "238bis" : "200";
}
// Date complète en toutes lettres ("27 avril 2026") attendue dans le bloc
// "Date et signature" du CERFA.
function formatFrDateLong(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}
// Génère le PDF du reçu CERFA côté serveur (mise en page + montant en
// toutes lettres) et déclenche son téléchargement. Le numéro de reçu doit
// déjà avoir été attribué (bouton "Générer les reçus manquants" ou
// bascule automatique en "Reçu").
async function downloadReceiptPdf(paymentId) {
  const p = payments.find(item => item.id === paymentId);
  if (!p) { notify("Paiement introuvable"); return; }
  if (!p.receiptNumber) { notify("Générez d'abord le reçu (numéro pas encore attribué)"); return; }
  const record = recordById(p.recordId);
  const payloadBody = {
    receiptNumber: p.receiptNumber,
    entity: RECEIPT_ENTITY,
    donorName: receiptDonorName(record) || p.payer,
    donorAddress: receiptDonorAddress(record),
    amount: p.amount,
    articleCgi: receiptArticleCgi(record),
    modeVersement: RECEIPT_METHOD_LABELS[p.method] || p.method || "-",
    dateLong: formatFrDateLong(p.status === "Reçu" ? (p.paymentDate || p.promiseDate) : p.promiseDate) || todayStr(),
  };
  try {
    const res = await fetch(`${API_BASE}/api/receipt-pdf`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payloadBody),
    });
    if (!res.ok) throw new Error("Échec de génération du PDF");
    triggerDownload(await res.blob(), `recu-${p.receiptNumber}.pdf`);
  } catch (err) {
    notify("Impossible de générer le PDF du reçu", true);
  }
}
// Demande au serveur les prochains numéros de reçu (attribués un par un, sans
// trou ni doublon, même si deux personnes génèrent des reçus au même moment).
// Sans réseau, on retombe sur le calcul local.
async function ensureReceiptNumbers(list) {
  const need = list.filter(p => !p.receiptNumber);
  if (!need.length) return;
  let numbers = null;
  try {
    const res = await fetch(`${API_BASE}/api/receipt-number`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ year: new Date().getFullYear(), count: need.length }),
    });
    if (res.ok) numbers = (await res.json()).numbers;
  } catch { /* hors ligne */ }
  need.forEach((p, i) => { p.receiptNumber = (numbers && numbers[i]) || nextReceiptNumber(); });
}
async function regenerateReceipt(paymentId) {
  const p = payments.find(item => item.id === paymentId);
  if (!p) { notify("Paiement introuvable"); return; }
  if (p.receipt === "Généré ailleurs") { notify("Ce don a déjà un reçu émis par l'ancien système : pas de régénération pour éviter un doublon."); return; }
  if (paymentIsPending(p)) { notify("Ce don n'est pas encore reçu : le reçu fiscal ne peut être émis qu'une fois l'argent arrivé."); return; }
  const first = !p.receiptNumber;
  await ensureReceiptNumbers([p]);
  logReceiptGeneration(p);
  logAudit(`Reçu ${first ? "généré" : "régénéré"} pour ${p.payer} (${p.receiptNumber}).`);
  saveCrmData();
  render();
  notify(`Reçu ${p.receiptNumber} ${first ? "généré" : "régénéré"}`);
  await downloadReceiptPdf(p.id);
}
async function generateMissingReceipts() {
  const list = payments.filter(p => (p.receipt === "A generer" || p.receipt === "À générer") && !paymentIsPending(p));
  if (!list.length) return notify("Aucun reçu en attente");
  if (!await uiConfirm(`Générer ${list.length} reçu(s) fiscal(aux) ? Un numéro de reçu définitif sera attribué à chacun.`, { title: "Générer les reçus manquants", okLabel: "Générer" })) return;
  await ensureReceiptNumbers(list);
  list.forEach(p => logReceiptGeneration(p));
  logAudit(`${list.length} reçu(s) généré(s).`);
  saveCrmData();
  render();
  notify(`${list.length} reçu(s) généré(s)`);
}
// Enregistre une (re)génération de reçu : attribue le numéro s'il n'existe
// pas encore, marque le paiement "Généré", et ajoute une ligne au suivi
// comptable pour l'expert-comptable — y compris pour une simple
// régénération, afin qu'il voie chaque émission/réémission.
function logReceiptGeneration(p, entity) {
  if (!p.receiptNumber) p.receiptNumber = nextReceiptNumber();
  p.receipt = "Généré";
  receiptLog.unshift({
    id: `RCL-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    "Date de génération": todayStr(),
    "Numéro de reçu": p.receiptNumber,
    "Donateur": p.payer,
    "Montant (€)": p.amount,
    "Date du don": paymentPrimaryDate(p),
    "Mode de paiement": p.method,
  });
  return p.receiptNumber;
}
// Bloc "versements" affiché sous un paiement marqué "échelonné" : le total
// déjà payé et le moyen utilisé pour chaque versement, le reste à payer
// calculé automatiquement, et un bouton "+" pour enregistrer le prochain
// versement dès qu'il arrive.
function installmentBlock(p) {
  if (!p.installmentPlan) return "";
  const list = p.installments || [];
  const remaining = paymentRemaining(p);
  const paidTotal = paymentPaidTotal(p);
  return `<div class="installment-block">
    <div class="installment-summary">
      <span>Payé : <strong>${euro(paidTotal)}</strong></span>
      <span>${remaining > 0 ? `Reste à payer : <strong>${euro(remaining)}</strong>` : `<strong class="status ok">Entièrement payé</strong>${remaining < 0 ? ` (+ ${euro(-remaining)} versé en trop)` : ""}`}</span>
    </div>
    ${list.length ? `<ul class="installment-list">${list.map(v => `<li>${v.date} — ${euro(v.amount)} (${escapeHtml(v.method)})</li>`).join("")}</ul>` : `<p class="muted-note">Aucun versement enregistré pour l'instant.</p>`}
    ${action("+ Ajouter un versement", `add-installment:${p.id}`)}
  </div>`;
}
// Bloc affiché DANS le formulaire d'ajout/modification d'un paiement dès que
// "Paiement échelonné" passe sur "Oui" (masqué sinon par modalShell) : on n'a
// pas besoin de ressortir de la modale pour voir où on en est et enregistrer
// tout de suite ce qui vient d'être payé — plus besoin de d'abord
// "Enregistrer" puis rouvrir "+ Ajouter un versement" séparément.
function installmentFormSection(p) {
  const list = p ? (p.installments || []) : [];
  const summary = p
    ? `<p class="muted-note">Payé jusqu'à présent : <strong>${euro(paymentPaidTotal(p))}</strong> — Reste à payer : <strong>${euro(Math.max(0, paymentRemaining(p)))}</strong></p>`
    : `<p class="muted-note">Vous pourrez enregistrer les versements suivants depuis la fiche du contact au fur et à mesure des paiements.</p>`;
  const listHtml = list.length ? `<ul class="installment-list">${list.map(v => `<li>${v.date} — ${euro(v.amount)} (${escapeHtml(v.method)})</li>`).join("")}</ul>` : "";
  return `<div class="form-grid span-2 installment-form-section" data-installment-section>
    ${summary}
    ${listHtml}
    <p class="installment-form-label">Ajouter un versement maintenant (optionnel)</p>
    ${field("Montant reçu (€)", "newInstallmentAmount", "", "number", "min='0' step='0.01' inputmode='decimal'")}
    ${selectField("Moyen de ce versement", "newInstallmentMethod", ["CB","Chèque","Virement","SEPA","Espèces"], (p && p.method) || "CB")}
  </div>`;
}
// Utilisé par les handlers "payment" (création) et "editPayment" (modif) :
// si la case "Ajouter un versement maintenant" du bloc échelonné a été
// remplie, on l'enregistre comme un versement à part entière (même logique
// que le bouton "+ Ajouter un versement" de la fiche), pour ne pas obliger à
// ressortir de la modale juste pour saisir ce premier règlement.
function applyInlineInstallment(p, data) {
  const montant = Number(data.newInstallmentAmount || 0);
  if (!p.installmentPlan || !montant) return;
  if (!Array.isArray(p.installments)) p.installments = [];
  p.installments.push({ id: nextId("VER", p.installments), date: todayStr(), amount: montant, method: data.newInstallmentMethod || p.method });
  p.installmentPlan = true;
  logAudit(`Versement de ${euro(montant)} (${data.newInstallmentMethod || p.method}) ajouté pour ${p.payer} — ${p.type}.`);
  if (paymentRemaining(p) <= 0) { p.status = "Reçu"; p.paymentDate = p.paymentDate || todayIso(); bumpReceiptIfReceived(p); }
}
function openAddInstallment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  modalShell("addInstallment", "Versement", `Ajouter un versement — ${p.payer}`,
    `<input type="hidden" name="paymentId" value="${escapeHtml(p.id)}">
     <p class="span-2 form-note">Reste à payer avant ce versement : <strong>${euro(Math.max(0, paymentRemaining(p)))}</strong></p>
     ${field("Montant reçu (€)", "amount", "", "number", "min='0.01' step='0.01' required inputmode='decimal'")}
     ${selectField("Moyen", "method", PAYMENT_METHODS, p.method || "CB")}
     ${field("Date", "date", todayIso(), "date", "required")}`, "Ajouter le versement");
}
async function deletePayment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  const ok = await uiConfirm(`Supprimer ce paiement de ${euro(p.amount)} (${p.type}) pour ${p.payer} ?${p.receiptNumber ? `\n\nAttention : le reçu fiscal ${p.receiptNumber} a déjà été émis pour ce paiement.` : ""}`, { title: "Supprimer le paiement", danger: true, okLabel: "Supprimer" });
  if (!ok) return;
  const index = payments.indexOf(p);
  payments.splice(index, 1);
  logAudit(`Paiement supprimé : ${p.type} de ${euro(p.amount)} pour ${p.payer}.`);
  saveCrmData();
  render();
  notify("Paiement supprimé", false, { label: "Annuler", run: () => { payments.splice(Math.min(index, payments.length), 0, p); logAudit(`Suppression annulée : ${p.type} de ${euro(p.amount)} pour ${p.payer}.`); saveCrmData(); render(); } });
}

// Champ de saisie d'un champ personnalisé, selon son type.
function customFieldInput(f, value) {
  const name = `cf:${f.name}`;
  if (f.type === "Liste") return selectField(escapeHtml(f.name), name, ["", ...splitTags(f.values)], value || "");
  if (f.type === "Case à cocher") return selectField(escapeHtml(f.name), name, ["", "Oui", "Non"], value || "");
  return field(escapeHtml(f.name), name, value || "", f.type === "Date" ? "date" : f.type === "Montant" ? "number" : "text");
}
function formSection(label) {
  return `<h3 class="form-section">${escapeHtml(label)}</h3>`;
}
function openModal(kind, options = {}) {
  const selected = (state.showDetail && recordById(state.selectedRecord)) || null;
  const modals = {
    contact: () => modalShell("contact", "Contact", "Nouveau contact",
      `${selectField("Civilité", "civility", ["", "Mme", "M.", "Famille"], "")}
       ${field("Prénom", "first", "", "text", "required placeholder='Prénom' autocomplete='off'")}
       ${field("Nom", "last", "", "text", "required placeholder='Nom' autocomplete='off'")}
       ${field("Email", "email", "", "email", "placeholder='email@exemple.fr' autocomplete='off'")}
       ${field("Téléphone", "phone", "", "tel", "placeholder='06 12 34 56 78' autocomplete='off'")}
       ${dobFields({})}
       <label class="span-2">Adresse<input name="address" type="text" placeholder="Numéro et rue" autocomplete="off"></label>
       ${field("Code postal", "zip", "", "text", "inputmode='numeric' autocomplete='off'")}
       ${field("Ville", "city", "", "text", "autocomplete='off'")}
       ${field("Famille", "family", "", "text", "placeholder='Nom de famille commun'")}
       <label>Étiquettes<input name="tags" type="text" placeholder="Parent, Donateur" list="tagList" autocomplete="off"><datalist id="tagList">${distinctTags().slice(0, 60).map(t => `<option value="${escapeHtml(t)}">`).join("")}</datalist></label>`, "Créer le contact"),
    structure: () => modalShell("structure", "Structure", "Nouvelle structure",
      `<label class="span-2">Nom<input name="name" type="text" required placeholder="Nom de l'entreprise, de la fondation…" autocomplete="off"></label>
       ${field("Email", "email", "", "email", "placeholder='contact@structure.fr'")}
       ${field("Téléphone", "phone", "", "tel")}
       <label class="span-2">Adresse<input name="address" type="text" autocomplete="off"></label>
       ${field("Code postal", "zip", "")}
       ${field("Ville", "city", "")}
       ${field("SIREN", "siren", "")}
       ${selectField("Forme juridique", "legal", ["Association", "Fondation", "SAS", "SARL", "Autre"], "Association")}
       ${field("Étiquettes", "tags", "", "text", "placeholder='Mécène, Partenaire'")}`, "Créer la structure"),
    payment: () => modalShell("payment", "Collecte", options.status === "Promis" ? "Nouvelle promesse de don" : "Nouveau don / paiement",
      `${pickerField("Donateur / payeur", "recordId", selected, true, true)}${paymentFormBody(null, options)}`),
    task: () => modalShell("task", "Suivi", "Nouvelle tâche", taskFormBody(null, null), "Ajouter la tâche"),
    account: () => modalShell("account", "Administration", options.existing ? `Modifier ${options.existing.email}` : "Nouveau compte",
      accountFormFields(options.existing), options.existing ? "Enregistrer" : "Créer le compte"),
    password: () => modalShell("password", "Mon compte", "Changer mon mot de passe",
      `<label class="span-2">Mot de passe actuel<input name="current" type="password" required autocomplete="current-password"></label>
       ${field("Nouveau mot de passe", "next", "", "password", "required minlength='8' autocomplete='new-password' placeholder='8 caractères minimum'")}
       ${field("Confirmer", "confirm", "", "password", "required minlength='8' autocomplete='new-password'")}`, "Changer le mot de passe"),
    field: () => modalShell("field", "Paramètres", "Nouveau champ personnalisé",
      `${field("Nom du champ", "name", "", "text", "required placeholder='Ex : Établissement'")}
       ${selectField("Type", "type", ["Texte", "Date", "Montant", "Liste", "Case à cocher"], "Texte")}
       <label class="span-2">Valeurs possibles (pour une liste, séparées par des virgules)<input name="values" type="text" placeholder="Beth Hilel, Beth Mena'hem"></label>`, "Créer le champ"),
    group: () => modalShell("group", "Groupe", "Nouveau groupe",
      `${field("Nom du groupe", "name", "", "text", "required")}${selectField("Type", "type", ["Équipe", "Famille", "Gouvernance", "Mécénat", "Événement"], "Équipe")}`, "Créer le groupe"),
    campaign: () => {
      const c = options.existing || null;
      return modalShell("campaign", "Collecte", c ? "Modifier la campagne" : "Nouvelle campagne",
        `${c ? `<input type="hidden" name="campaignId" value="${escapeHtml(c.id)}">` : ""}
         <label class="span-2">Nom de la campagne<input name="name" type="text" value="${escapeHtml(c?.name || "")}" required placeholder="Ex : Gala 2027" autocomplete="off"></label>
         ${field("Objectif (€)", "goal", c?.goal || "", "number", "min='0' step='1' inputmode='numeric' placeholder='Facultatif'")}
         <span></span>
         ${field("Début", "startDate", c?.startDate || "", "date")}
         ${field("Fin", "endDate", c?.endDate || "", "date")}
         ${textareaField("Note (facultatif)", "note", c?.note || "")}
         <p class="span-2 form-note">Un don est compté dans cette campagne quand son champ « Occasion / campagne » porte ce nom.</p>`, c ? "Enregistrer" : "Créer la campagne");
    },
    interaction: () => modalShell("interaction", "Suivi", "Nouvelle interaction",
      `${pickerField("Contact / structure", "recordId", selected, true, true)}
       ${field("Date", "date", todayIso(), "date", "required")}
       ${selectField("Type", "type", ["Appel", "Email", "Message", "Rendez-vous", "Note"], "Appel")}
       ${categoryField(interactionCategories[0] || "Suivi")}
       ${field("Libellé", "label", "", "text", "placeholder='Ex : relance annuelle'")}
       ${textareaField("Détail (facultatif)", "note", "")}`),
    comment: () => modalShell("comment", "Suivi", "Nouvelle note",
      `${pickerField("Contact / structure", "recordId", selected)}
       ${field("Date", "date", todayIso(), "date", "required")}
       ${textareaField("Note", "note", "", "required placeholder='Une information utile à retenir…'")}`, "Ajouter la note"),
    linkage: () => {
      const a = options.recordId ? recordById(options.recordId) : selected;
      return modalShell("linkage", "Relations", "Nouvelle liaison",
        `${pickerField("Première fiche", "aId", a)}
         ${pickerField("Deuxième fiche", "bId", null)}
         ${field("Rôle de la première", "roleA", "", "text", "placeholder='Ex : Père'")}
         ${field("Rôle de la deuxième", "roleB", "", "text", "placeholder='Ex : Fils'")}
         <label class="span-2">Type de liaison<input name="type" type="text" value="Famille" list="linkTypeList"><datalist id="linkTypeList">${["Famille", "Conjoint", "Parent / enfant", "Professionnel", "Dirigeant de la structure", "Ami"].map(v => `<option value="${v}">`).join("")}</datalist></label>`, "Créer la liaison");
    },
    editRecord: () => {
      const r = selected;
      if (!r) return notify("Aucune fiche ouverte");
      const custom = customFields.length ? `${formSection("Champs personnalisés")}${customFields.map(f => customFieldInput(f, (r.custom || {})[f.name])).join("")}` : "";
      const classement = `${formSection("Classement")}${field("Étiquettes", "tags", (r.tags || []).join(", "))}${field("Segments", "segments", (r.segments || []).join(", "))}${field("Groupes", "groups", (r.groups || []).join(", "))}${field("Portefeuille (prénom du responsable)", "agent", r.agent || "", "text", "placeholder='Ex : ARIE'")}`;
      if (r.kind === "Structure") return modalShell("editRecord", "Fiche structure", `Modifier ${r.name}`,
        `${formSection("Identité")}${field("Nom", "name", r.name, "text", "required")}${field("SIREN", "siren", r.siren || "")}${field("Forme juridique", "legal", r.legal || "")}${field("Source", "source", r.source || "")}
         ${formSection("Coordonnées")}${field("Email", "email", r.email || "", "email")}${field("Téléphone", "phone", r.phone || "", "tel")}${field("Adresse", "address", r.address || "")}${field("Code postal", "zip", r.zip || "")}${field("Ville", "city", r.city || "")}${field("Pays", "country", r.country || "")}
         ${classement}${custom}${textareaField("Commentaire", "comment", r.comment || "")}`);
      return modalShell("editRecord", "Fiche contact", `Modifier ${r.name}`,
        `${formSection("Identité")}${selectField("Civilité", "civility", ensureOption(["", "Mme", "M.", "Famille"], r.civility), r.civility || "")}${field("Prénom", "first", r.first || "")}${field("Nom", "last", r.last || "", "text", "required")}${field("Profession", "profession", r.profession || "")}${dobFields(r)}
         ${formSection("Coordonnées")}${field("Email principal", "email", r.email || "", "email")}${field("Email secondaire", "secondaryEmails", r.secondaryEmails || "")}${field("Téléphone", "phone", r.phone || "", "tel")}${field("Téléphone 2", "phone2", r.phone2 || "", "tel")}${field("Adresse", "address", r.address || "")}${field("Code postal", "zip", r.zip || "")}${field("Ville", "city", r.city || "")}${field("Pays", "country", r.country || "")}
         ${formSection("Foyer")}${field("Famille", "family", r.family || "")}${field("Rôle de foyer", "role", r.role || "")}${field("Type de foyer", "householdType", r.householdType || "")}${field("Statut parent", "parentStatus", r.parentStatus || "")}${field("Statut enfant", "childStatus", r.childStatus || "")}${field("École actuelle", "school", r.school || "")}
         ${classement}${field("Source", "source", r.source || "")}${custom}${textareaField("Commentaire", "comment", r.comment || "")}`);
    },
  };
  (modals[kind] || modals.contact)();
}

async function submitPasswordForm(data) {
  if (data.next !== data.confirm) return notify("Les deux mots de passe ne sont pas identiques", true);
  try {
    const res = await fetch(`${API_BASE}/api/auth/password`, {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }), body: JSON.stringify({ current: data.current, new: data.next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return notify(body.error || "Changement impossible", true);
    dialog().close();
    notify("Mot de passe modifié");
  } catch {
    notify("Serveur injoignable : mot de passe inchangé", true);
  }
}

/* ---------- 10. Enregistrement des formulaires -------------------------- */

function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());
  const required = [...form.querySelectorAll("[required]")].filter(el => !String(el.value || "").trim());
  if (required.length) {
    notify(required[0].type === "hidden" ? "Choisissez un contact dans la liste proposée" : "Complétez les champs obligatoires", true);
    return;
  }

  if (kind === "account") { submitAccountForm(form); return; }
  if (kind === "password") { submitPasswordForm(data); return; }
  if (isReadOnlyAccount()) { dialog().close(); notify(READ_ONLY_MSG); return; }

  // Message affiché une fois l'enregistrement confirmé par le serveur. Après
  // un ajout fait ailleurs que sur la fiche concernée, on reste sur l'écran
  // en cours et le message propose d'ouvrir la fiche.
  const done = { message: "Enregistré", action: null };
  const onRecordPage = id => state.view === "crm" && state.showDetail && state.selectedRecord === id;
  const afterRecordChange = (rec, tab, message) => {
    done.message = message;
    if (onRecordPage(rec.id)) state.scrollToTab = tab;
    else done.action = { label: "Voir la fiche", run: () => openRecord(rec.id, tab) };
  };
  const showRecord = record => {
    state.view = "crm"; state.section = record.kind === "Structure" ? "Structures" : "Contacts";
    state.selectedRecord = record.id; state.showDetail = true; state.mobileDetailOpen = true; state.tab = "Details";
    state.detailReturn = null;
  };
  const possibleDuplicate = record => {
    const email = String(record.email || "").toLowerCase().trim();
    const phone = normalizePhoneKey(record.phone);
    return records.find(r => r !== record && ((email && String(r.email || "").toLowerCase().trim() === email) || (phone && [r.phone, r.phone2].some(x => normalizePhoneKey(x) === phone))));
  };

  const handlers = {
    contact: () => {
      const record = { id: nextId("C", records), kind: "Contact", civility: data.civility, first: data.first.trim(), last: data.last.trim(), name: `${data.first} ${data.last}`.replace(/\s+/g, " ").trim(), email: data.email.trim(), phone: data.phone.trim(), tags: splitTags(data.tags), groups: [], segments: [], importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0, address: data.address, zip: data.zip, city: data.city, source: "Manuel", family: data.family, dob: data.dob || "", dobAfterSunset: data.dobAfterSunset === "Oui", dateAdded: todayStr() };
      ensureInAccountScope(record);
      records.unshift(record);
      logAudit(`Contact ajouté : ${record.name}.`);
      showRecord(record);
      const dup = possibleDuplicate(record);
      done.message = dup ? `Contact créé — doublon possible avec ${dup.name}` : "Contact créé";
    },
    structure: () => {
      const record = { id: nextId("S", records), kind: "Structure", name: data.name.trim(), email: data.email.trim(), phone: data.phone.trim(), tags: splitTags(data.tags), groups: [], segments: [], importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0, address: data.address, zip: data.zip, city: data.city, siren: data.siren, legal: data.legal, source: "Manuel", dateAdded: todayStr() };
      records.unshift(record);
      logAudit(`Structure ajoutée : ${record.name}.`);
      showRecord(record);
      done.message = "Structure créée";
    },
    payment: () => {
      const payer = recordById(data.recordId);
      if (!payer) { notify("Donateur introuvable : choisissez-le dans la liste proposée", true); return false; }
      const amount = Number(data.amount);
      if (!(amount > 0)) { notify("Le montant doit être supérieur à zéro", true); return false; }
      const received = data.status === "Reçu";
      const p = { id: nextId("PAY-SIN", payments), recordId: payer.id, date: todayStr(), at: nowIso(), payer: payer.name, email: payer.email, amount, type: data.type, status: data.status, method: data.method, occasion: splitTags(data.occasion), receipt: (data.type === "Don" && received) ? "À générer" : "Non éligible", installmentPlan: data.installmentPlan === "Oui", installments: [], promiseDate: received ? (data.paymentDate || todayIso()) : (data.promiseDate || todayIso()), paymentDate: received ? (data.paymentDate || todayIso()) : "", note: (data.note || "").trim(), user: currentUserLabel() };
      payments.unshift(p);
      logAudit(`${received ? data.type : "Promesse"} de ${euro(p.amount)} ${received ? "ajouté" : "ajoutée"} pour ${payer.name}.`);
      applyInlineInstallment(p, data);
      afterRecordChange(payer, "Paiements", received ? `${data.type} de ${euro(p.amount)} enregistré` : `Promesse de ${euro(p.amount)} enregistrée`);
    },
    interaction: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable : choisissez-le dans la liste proposée", true); return false; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: data.category || "Suivi", label: data.label, type: data.type, note: data.note, user: currentUserLabel() });
      logAudit(`Interaction ajoutée pour ${rec.name}.`);
      afterRecordChange(rec, "Activité", "Interaction enregistrée");
    },
    comment: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable : choisissez-le dans la liste proposée", true); return false; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: "Suivi", label: "Note", type: "Commentaire", note: data.note, user: currentUserLabel() });
      logAudit(`Note ajoutée pour ${rec.name}.`);
      afterRecordChange(rec, "Activité", "Note enregistrée");
    },
    task: () => {
      const t = buildTask(data.title, data.dueDate, data.recordId, data.dueTime);
      if (!t) return false;
      t.assignedTo = (data.assignedTo || "").trim() || t.assignedTo;
      t.priority = data.priority === "Haute" ? "haute" : "";
      t.note = (data.note || "").trim();
      tasks.unshift(t);
      const rec = t.recordId ? recordById(t.recordId) : null;
      logAudit(`Tâche ajoutée : ${t.title}${rec ? ` (liée à ${rec.name})` : ""}.`);
      done.message = "Tâche ajoutée";
      if (rec && onRecordPage(rec.id)) state.scrollToTab = "Tâches";
    },
    editTask: () => {
      const t = tasks.find(x => x.id === data.taskId);
      if (!t) { notify("Tâche introuvable", true); return false; }
      t.title = data.title.trim();
      t.dueDate = data.dueDate || "";
      t.dueTime = data.dueTime || "";
      t.recordId = data.recordId || null;
      t.assignedTo = (data.assignedTo || "").trim();
      t.priority = data.priority === "Haute" ? "haute" : "";
      t.note = (data.note || "").trim();
      logAudit(`Tâche modifiée : ${t.title}.`);
    },
    holidayTask: () => {
      const h = JEWISH_HOLIDAYS.find(x => x.key === data.holidayKey);
      if (!h) { notify("Fête introuvable", true); return false; }
      holidayNotes[h.key] = { ...(holidayNotes[h.key] || {}), note: (data.note || "").trim(), updatedAt: nowIso() };
      ensureHolidayReminders(); // au cas où le rappel n'existerait pas encore
      logAudit(`Idée notée pour ${h.name}.`);
    },
    portfolioTouch: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable", true); return false; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: "Suivi portefeuille", label: data.type, type: data.type, note: data.note, user: currentUserLabel() });
      logAudit(`Contact de portefeuille enregistré avec ${rec.name}.`);
      done.message = "Contact enregistré";
    },
    addToPortfolio: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable : choisissez-le dans la liste proposée", true); return false; }
      const mine = myAgentCode();
      if (!mine) { notify("Impossible de déterminer votre portefeuille.", true); return false; }
      rec.agent = mine;
      logAudit(`${rec.name} ajouté au portefeuille de ${currentUserLabel()}.`);
      done.message = `${rec.name} ajouté à votre portefeuille`;
    },
    editPayment: () => {
      const p = payments.find(item => item.id === data.paymentId);
      if (!p) { notify("Paiement introuvable", true); return false; }
      const amount = Number(data.amount);
      if (!(amount > 0)) { notify("Le montant doit être supérieur à zéro", true); return false; }
      p.amount = amount;
      p.type = data.type;
      p.method = data.method;
      p.status = data.status;
      p.receipt = data.receipt;
      p.promiseDate = data.promiseDate || p.promiseDate || "";
      // La date de paiement ne veut rien dire tant que ce n'est qu'une
      // promesse : on la vide si on repasse en "Promis", et on la fixe
      // (ou on la garde) dès que c'est "Reçu".
      p.paymentDate = data.status === "Reçu" ? (data.paymentDate || p.paymentDate || todayIso()) : "";
      bumpReceiptIfReceived(p);
      p.installmentPlan = data.installmentPlan === "Oui";
      if (p.installmentPlan && !Array.isArray(p.installments)) p.installments = [];
      p.occasion = splitTags(data.occasion);
      p.note = (data.note || "").trim();
      logAudit(`Paiement modifié : ${p.type} de ${euro(p.amount)} pour ${p.payer} (${p.status}).`);
      applyInlineInstallment(p, data);
    },
    addInstallment: () => {
      const p = payments.find(item => item.id === data.paymentId);
      if (!p) { notify("Paiement introuvable", true); return false; }
      const montant = Number(data.amount);
      if (!(montant > 0)) { notify("Le montant doit être supérieur à zéro", true); return false; }
      if (!Array.isArray(p.installments)) p.installments = [];
      p.installmentPlan = true;
      const { display } = dateFromInput(data.date);
      p.installments.push({ id: nextId("VER", p.installments), date: display, amount: montant, method: data.method });
      logAudit(`Versement de ${euro(montant)} (${data.method}) ajouté pour ${p.payer} — ${p.type}.`);
      // Une fois le montant total couvert par les versements, le don est
      // considéré reçu et le reçu fiscal s'ouvre du même coup.
      if (paymentRemaining(p) <= 0) { p.status = "Reçu"; p.paymentDate = p.paymentDate || data.date || todayIso(); bumpReceiptIfReceived(p); }
      done.message = paymentRemaining(p) <= 0 ? "Versement ajouté — don entièrement reçu" : `Versement ajouté — reste ${euro(paymentRemaining(p))}`;
    },
    field: () => {
      const name = data.name.trim();
      if (customFields.some(f => f.name.toLowerCase() === name.toLowerCase())) { notify("Un champ porte déjà ce nom", true); return false; }
      customFields.push({ name, type: data.type, values: data.values || "", required: "Non", profile: "Tous" });
      logAudit(`Champ personnalisé ajouté : ${name}.`);
    },
    group: () => { groups.unshift({ id: nextId("GRP", groups), name: data.name.trim(), date: todayStr(), type: data.type }); logAudit(`Groupe créé : ${data.name}.`); },
    campaign: () => {
      const name = data.name.trim();
      const existing = data.campaignId ? campaigns.find(c => c.id === data.campaignId) : null;
      if (campaigns.some(c => c !== existing && c.name.toLowerCase() === name.toLowerCase())) { notify("Une campagne porte déjà ce nom", true); return false; }
      if (existing) {
        // Renommer une campagne renomme aussi l'occasion des dons déjà rattachés.
        if (existing.name !== name) payments.forEach(p => { if ((p.occasion || []).includes(existing.name)) p.occasion = p.occasion.map(o => o === existing.name ? name : o); });
        Object.assign(existing, { name, goal: Number(data.goal || 0), startDate: data.startDate || "", endDate: data.endDate || "", note: (data.note || "").trim() });
        logAudit(`Campagne modifiée : ${name}.`);
      } else {
        campaigns.unshift({ id: nextId("CAMP", campaigns), name, goal: Number(data.goal || 0), startDate: data.startDate || "", endDate: data.endDate || "", note: (data.note || "").trim(), archived: false, createdAt: nowIso() });
        logAudit(`Campagne créée : ${name}.`);
        done.message = "Campagne créée";
      }
    },
    linkage: () => {
      const a = recordById(data.aId), b = recordById(data.bId);
      if (!a || !b) { notify("Choisissez les deux fiches dans la liste proposée", true); return false; }
      if (a === b) { notify("Une fiche ne peut pas être liée à elle-même", true); return false; }
      linkages.unshift({ id: nextId("LNK", linkages), aId: a.id, bId: b.id, a: a.name, b: b.name, roleA: data.roleA, roleB: data.roleB, type: data.type || "Famille" });
      logAudit(`Liaison ajoutée entre ${a.name} et ${b.name}.`);
      if (onRecordPage(a.id) || onRecordPage(b.id)) state.scrollToTab = "Relations";
      done.message = "Liaison créée";
    },
    editRecord: () => {
      const r = records.find(item => item.id === state.selectedRecord);
      if (!r) return false;
      const oldName = r.name;
      ["civility", "first", "last", "name", "email", "secondaryEmails", "phone", "phone2", "dob", "address", "zip", "city", "country", "family", "role", "householdType", "parentStatus", "childStatus", "profession", "school", "source", "comment", "siren", "legal", "agent"].forEach(key => { if (key in data) r[key] = typeof data[key] === "string" ? data[key].trim() : data[key]; });
      if ("dobAfterSunset" in data) r.dobAfterSunset = data.dobAfterSunset === "Oui";
      ["tags", "segments", "groups"].forEach(key => { if (key in data) r[key] = splitTags(data[key]); });
      const custom = { ...(r.custom || {}) };
      customFields.forEach(f => { const k = `cf:${f.name}`; if (k in data) { if (data[k]) custom[f.name] = data[k]; else delete custom[f.name]; } });
      if (Object.keys(custom).length || r.custom) r.custom = custom;
      // Le nom affiché doit toujours refléter Prénom + Nom pour un contact.
      if (r.kind !== "Structure" && (r.first || r.last)) r.name = `${r.first || ""} ${r.last || ""}`.trim();
      // Le nom est recopié sur les dons, interactions et liaisons : on les
      // met à jour pour que listes, exports et reçus portent le nouveau nom.
      if (r.name !== oldName) {
        payments.forEach(p => { if (p.recordId === r.id) p.payer = r.name; });
        interactions.forEach(i => { if (i.recordId === r.id) i.target = r.name; });
        linkages.forEach(l => { if (l.aId === r.id || (!l.aId && l.a === oldName)) l.a = r.name; if (l.bId === r.id || (!l.bId && l.b === oldName)) l.b = r.name; });
      }
      ensureInAccountScope(r);
      r.dateModified = todayStr();
      logAudit(`Fiche modifiée : ${r.name}.`);
    },
  };
  if ((handlers[kind] || (() => {}))() === false) return;
  dialog().close();
  render();
  // "Enregistré" seulement une fois le serveur d'accord : en cas d'échec,
  // saveCrmData affiche lui-même pourquoi.
  saveCrmData().then(outcome => { if (outcome === "ok") notify(done.message, false, done.action); });
}

// Supprime la fiche ouverte avec tout ce qui lui est rattaché (avant, ses
// dons et interactions restaient en base sans fiche : ils continuaient à
// compter dans les totaux tout en étant impossibles à ouvrir).
async function deleteSelectedRecord() {
  const record = records.find(r => r.id === state.selectedRecord);
  if (!record) return notify("Aucune fiche sélectionnée");
  const parts = [];
  const nbPayments = recordLivePayments(record.id).length;
  const nbInteractions = recordLiveInteractions(record.id).length;
  const nbTasks = tasks.filter(t => t.recordId === record.id).length;
  if (nbPayments) parts.push(`${nbPayments} paiement(s)`);
  if (nbInteractions) parts.push(`${nbInteractions} interaction(s)`);
  if (nbTasks) parts.push(`${nbTasks} tâche(s)`);
  const ok = await uiConfirm(`Supprimer ${record.name || record.id} du CRM ?${parts.length ? `\n\n${parts.join(", ")} lié(s) à cette fiche seront supprimés avec elle.` : ""}`, { title: "Supprimer la fiche", danger: true, okLabel: "Supprimer" });
  if (!ok) return;
  const undo = removeRecords(new Set([record.id]));
  state.showDetail = false;
  state.mobileDetailOpen = false;
  state.selectedRecord = null;
  logAudit(`Fiche supprimée : ${record.name || record.id}.`);
  saveCrmData();
  render();
  notify("Fiche supprimée", false, { label: "Annuler", run: undo });
}

/* ---------- 9bis. Résolution des doublons -------------------------------- */

// "Garder celle-ci et fusionner" : toutes les autres fiches du groupe sont
// absorbées dans la fiche choisie — leurs dons/tâches/interactions sont
// réattribués (recordId), leurs compteurs d'historique importé avant le CRM
// sont additionnés, les champs vides de la fiche gardée sont complétés avec
// ceux des fiches fusionnées (sans jamais écraser une info déjà renseignée),
// puis les autres fiches sont supprimées définitivement.
async function mergeDuplicateGroup(groupKey, keepId) {
  const group = duplicateGroupsCache.find(g => g.key === groupKey);
  if (!group) { notify("Ce groupe de doublons n'est plus à jour, réessaie."); return; }
  const keep = recordById(keepId);
  if (!keep) return notify("Fiche introuvable");
  const others = group.records.filter(r => r.id !== keepId);
  if (!others.length) return;
  const names = others.map(r => r.name || r.id).join(", ");
  const plural = others.length > 1;
  const ok = await uiConfirm(`Fusionner ${names} dans « ${keep.name} » ?\n\nTous les dons, tâches et interactions de ${plural ? "ces fiches" : "cette fiche"} seront transférés vers « ${keep.name} », puis ${plural ? "elles seront supprimées" : "elle sera supprimée"}. Cette action ne peut pas être annulée.`, { title: "Fusionner les fiches", okLabel: "Fusionner" });
  if (!ok) return;
  others.forEach(other => {
    payments.forEach(p => { if (p.recordId === other.id) p.recordId = keep.id; });
    interactions.forEach(i => { if (i.recordId === other.id) i.recordId = keep.id; });
    tasks.forEach(t => { if (t.recordId === other.id) t.recordId = keep.id; });
    linkages.forEach(l => {
      if (l.aId === other.id || (!l.aId && l.a === other.name)) { l.aId = keep.id; l.a = keep.name; }
      if (l.bId === other.id || (!l.bId && l.b === other.name)) { l.bId = keep.id; l.b = keep.name; }
    });
    keep.tags = [...new Set([...(keep.tags || []), ...(other.tags || [])])];
    keep.segments = [...new Set([...(keep.segments || []), ...(other.segments || [])])];
    keep.groups = [...new Set([...(keep.groups || []), ...(other.groups || [])])];
    if (!keep.agent && other.agent) keep.agent = other.agent;
    keep.importedAmount = Number(keep.importedAmount || 0) + Number(other.importedAmount || 0);
    keep.importedAmount2025 = Number(keep.importedAmount2025 || 0) + Number(other.importedAmount2025 || 0);
    keep.importedAmount2026 = Number(keep.importedAmount2026 || 0) + Number(other.importedAmount2026 || 0);
    keep.importedPaymentsCount = Number(keep.importedPaymentsCount || 0) + Number(other.importedPaymentsCount || 0);
    keep.importedInteractionsCount = Number(keep.importedInteractionsCount || 0) + Number(other.importedInteractionsCount || 0);
    ["email", "secondaryEmails", "phone", "phone2", "address", "zip", "city", "country", "dob", "siren", "legal", "comment", "profession", "school", "family", "role"].forEach(f => {
      if (!keep[f] && other[f]) keep[f] = other[f];
    });
    const idx = records.indexOf(other);
    if (idx >= 0) records.splice(idx, 1);
  });
  keep.dateModified = todayStr();
  if (others.some(o => o.id === state.selectedRecord)) state.selectedRecord = keep.id;
  if (others.some(o => o.id === state.dedupeFocusId)) state.dedupeFocusId = keep.id;
  logAudit(`Fiches fusionnées dans "${keep.name}" : ${names}.`);
  saveCrmData();
  render();
  notify("Fiches fusionnées");
}

// "Effacer" une fiche doublon : contrairement à la suppression générale
// (deleteSelectedRecord, qui laisse l'historique orphelin), ici on prévient
// explicitement si des dons/interactions/tâches sont liés, et on les efface
// avec la fiche pour ne rien laisser d'incohérent derrière.
async function deleteDuplicateRecord(groupKey, id) {
  const record = recordById(id);
  if (!record) return notify("Fiche introuvable");
  const linkedPayments = recordLivePayments(id).length;
  const linkedInteractions = recordLiveInteractions(id).length;
  const linkedTasks = tasks.filter(t => t.recordId === id).length;
  let message = `Supprimer « ${record.name} » du CRM ?`;
  if (linkedPayments || linkedInteractions || linkedTasks) {
    const parts = [];
    if (linkedPayments) parts.push(`${linkedPayments} paiement(s)`);
    if (linkedInteractions) parts.push(`${linkedInteractions} interaction(s)`);
    if (linkedTasks) parts.push(`${linkedTasks} tâche(s)`);
    message = `« ${record.name} » a ${parts.join(", ")} lié(s), qui seront supprimés avec la fiche.\n\nPour les conserver, utilisez plutôt « Garder celle-ci et fusionner » sur l'autre fiche.`;
  }
  if (!await uiConfirm(message, { title: "Supprimer la fiche", danger: true, okLabel: "Supprimer" })) return;
  const undo = removeRecords(new Set([id]));
  if (state.selectedRecord === id) { state.selectedRecord = null; state.showDetail = false; state.mobileDetailOpen = false; }
  if (state.dedupeFocusId === id) state.dedupeFocusId = null;
  logAudit(`Fiche supprimée (doublon) : ${record.name}.`);
  saveCrmData();
  render();
  notify("Fiche supprimée", false, { label: "Annuler", run: undo });
}

// "Nom séparé" : ce ne sont pas de vrais doublons (ex : un couple qui partage
// un email/téléphone). On écarte définitivement ce groupe (il ne réapparaîtra
// plus), puis on ouvre directement la fiche modifiable pour la renommer tout
// de suite si besoin (via le formulaire standard "Modifier toute la fiche",
// qui gère correctement prénom/nom — pas de logique de renommage dupliquée ici).
function separateDuplicateRecord(groupKey, id) {
  const record = recordById(id);
  if (!record) return notify("Fiche introuvable");
  // groupKey peut être composite ("email:x|phone:y") quand la même paire de
  // fiches partageait à la fois le même email et le même téléphone : on écarte
  // chaque clé individuelle pour que le groupe ne revienne pas par un autre biais.
  String(groupKey || "").split("|").filter(Boolean).forEach(k => {
    if (!dismissedDuplicates.includes(k)) dismissedDuplicates.push(k);
  });
  logAudit(`Doublon écarté : "${record.name}" marquée comme fiche distincte (pas un doublon).`);
  state.selectedRecord = id;
  saveCrmData();
  render();
  notify("Ces fiches ne seront plus signalées comme doublons");
  openModal("editRecord");
}

// Export brut d'une liste (colonnes = champs de la première ligne). Les
// contacts et paiements passent par exportTable (app-tools.js), qui met des
// en-têtes lisibles et propose le format Excel.
function downloadCsv(filename, rows) {
  const clean = rows.map(r => { const c = (r && typeof r === "object") ? { ...r } : { valeur: r }; delete c._backendId; delete c._createdAt; delete c._updatedAt; return c; });
  if (!clean.length) return notify("Rien à exporter");
  const headers = [...new Set(clean.flatMap(row => Object.keys(row)))];
  const cell = v => Array.isArray(v) ? v.map(x => (x && typeof x === "object") ? JSON.stringify(x) : x).join(", ") : (v && typeof v === "object") ? JSON.stringify(v) : v;
  const csv = [headers.map(csvCell).join(";"), ...clean.map(row => headers.map(h => csvCell(cell(row[h]))).join(";"))].join("\r\n");
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), filename);
  notify(`${filename} téléchargé`);
}
function csvCell(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

/* ---------- 11. Import réel de fichier (CSV / XLSX) --------------------- */

let pendingImport = null;

function openImportModal() {
  const d = dialog();
  if (d.open) d.close();
  d.className = "";
  dialogContent().innerHTML = `<div class="modal">
    <header><div><span class="eyebrow">Import</span><h2>Importer un fichier</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">${icon("x")}</button></header>
    <div class="form-grid">
      <p class="span-2 form-note">Contacts ou paiements, au format CSV ou Excel. Le type est reconnu d'après les colonnes : un fichier avec une colonne <strong>Montant</strong> est importé comme une liste de paiements, rattachés aux fiches par email (ou par nom).</p>
      <label class="span-2">Fichier CSV ou Excel (.xlsx)
        <input type="file" id="importFile" accept=".csv,.xlsx,.xls" />
      </label>
      <div class="span-2" id="importPreview"></div>
    </div>
    <footer><button type="button" data-modal-close>Annuler</button><button class="primary-btn" type="button" id="importConfirm" disabled>Importer</button></footer>
  </div>`;
  d.showModal();
  dialogContent().querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => d.close()));
  dialogContent().querySelector("#importFile").addEventListener("change", handleImportFile);
  dialogContent().querySelector("#importConfirm").addEventListener("click", confirmImport);
}

async function handleImportFile(event) {
  const file = event.target.files[0];
  const preview = dialogContent().querySelector("#importPreview");
  const confirmBtn = dialogContent().querySelector("#importConfirm");
  if (!file) return;
  preview.innerHTML = `<p>Lecture de ${escapeHtml(file.name)}…</p>`;
  confirmBtn.disabled = true;
  try {
    const rows = await parseImportFile(file);
    pendingImport = analyzeImportRows(rows, file.name);
    preview.innerHTML = importPreviewHtml(pendingImport);
    confirmBtn.disabled = pendingImport.kind === "payments" ? !pendingImport.prepared.length : !pendingImport.rows;
    confirmBtn.textContent = pendingImport.kind === "payments" ? `Importer ${pendingImport.prepared.length} paiement(s)` : `Importer ${pendingImport.rows} ligne(s)`;
  } catch (err) {
    preview.innerHTML = `<p>Impossible de lire ce fichier (${escapeHtml(String(err.message || err))}). Vérifiez le format (.csv ou .xlsx).</p>`;
  }
}

// Une date lue dans Excel arrive comme un objet Date : on la remet au format
// JJ/MM/AAAA attendu partout ailleurs (avant, elle arrivait comme un numéro
// de série Excel du type 45231, inutilisable comme date de naissance).
function importCellValue(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = new Date(v.getTime() + 2 * 3600 * 1000);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }
  return v;
}
function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("lecture impossible"));
    const isCsv = /\.csv$/i.test(file.name);
    if (isCsv) {
      reader.onload = () => resolve(parseCsv(String(reader.result)));
      reader.readAsText(file, "utf-8");
    } else {
      reader.onload = () => {
        if (!window.XLSX) return reject(new Error("bibliothèque Excel indisponible (pas de connexion internet ?)"));
        const wb = window.XLSX.read(reader.result, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, importCellValue(v)]))));
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

// Lecture d'un CSV : séparateur ";" ou "," (détecté sur la ligne d'en-tête),
// guillemets, et retours à la ligne à l'intérieur d'une cellule entre
// guillemets (une adresse ou un commentaire sur deux lignes ne coupe plus la
// ligne en deux).
function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r\n|\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const table = [];
  let row = [], cur = "", inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"' && clean[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some(cell => cell !== "")) table.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(cell => cell !== "")) table.push(row);
  if (!table.length) return [];
  const headers = table[0].map(h => h.trim());
  return table.slice(1).map(cells => {
    const line = {};
    headers.forEach((h, i) => { line[h] = (cells[i] ?? "").trim(); });
    return line;
  });
}

// Colonnes reconnues pour un fichier de paiements.
const PAYMENT_IMPORT_MAP = {
  "montant": "amount", "montant (€)": "amount", "montant total": "amount", "amount": "amount",
  "date": "date", "date du paiement": "date", "date de paiement": "date", "date du don": "date",
  "email": "email", "payeur": "payer", "donateur": "payer", "nom complet": "payer", "nom": "last", "prenom": "first",
  "type": "type", "statut": "status", "moyen": "method", "moyen de paiement": "method", "mode de paiement": "method",
  "occasion": "occasion", "campagne": "occasion", "occasion / campagne": "occasion",
  "identifiant fiche": "recordId", "n° de recu": "receiptNumber", "numero de recu": "receiptNumber", "note": "note",
};
function importDateIso(value) {
  const v = String(value || "").trim();
  return parseDob(v) || "";
}
function importAmount(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/\s|€/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  return Number(cleaned.replace(/[^0-9.-]/g, "")) || 0;
}
function analyzeImportRows(rows, fileName) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const isPayments = headers.some(h => PAYMENT_IMPORT_MAP[normalizeHeader(h)] === "amount");
  return isPayments ? analyzePaymentImport(rows, fileName, headers) : analyzeContactImport(rows, fileName, headers);
}
function analyzeContactImport(rows, fileName, headers) {
  const mappedHeaders = headers.filter(h => IMPORT_FIELD_MAP[normalizeHeader(h)]);
  const unmapped = headers.filter(h => !IMPORT_FIELD_MAP[normalizeHeader(h)]);
  const existingByEmail = {};
  records.forEach(r => { if (r.email) existingByEmail[r.email.toLowerCase().trim()] = r; });
  let created = 0, updated = 0, missingEmail = 0;
  const preparedRecords = rows.map(row => {
    const mapped = { tags: [], groups: [], groupRoles: [], segments: [], paymentSources: [], paymentMethods: [] };
    Object.entries(row).forEach(([header, value]) => {
      const field = IMPORT_FIELD_MAP[normalizeHeader(header)];
      if (!field) return;
      if (IMPORT_LIST_FIELDS.has(field)) mapped[field] = splitTags(value);
      else if (IMPORT_NUMBER_FIELDS.has(field)) mapped[field] = importAmount(value);
      else mapped[field] = String(value ?? "").trim();
    });
    mapped.name = `${mapped.first || ""} ${mapped.last || ""}`.trim() || mapped.name || "Sans nom";
    if (!mapped.email) missingEmail += 1;
    const match = mapped.email ? existingByEmail[mapped.email.toLowerCase().trim()] : null;
    if (match) updated += 1; else created += 1;
    return { mapped, match };
  });
  return { kind: "contacts", fileName, rows: rows.length, mappedHeaders: mappedHeaders.length, unmapped, created, updated, missingEmail, preparedRecords };
}
function analyzePaymentImport(rows, fileName, headers) {
  const mappedHeaders = headers.filter(h => PAYMENT_IMPORT_MAP[normalizeHeader(h)]);
  const unmapped = headers.filter(h => !PAYMENT_IMPORT_MAP[normalizeHeader(h)]);
  const byEmail = new Map(), byName = new Map(), byId = new Map(records.map(r => [r.id, r]));
  records.forEach(r => {
    if (r.email) byEmail.set(r.email.toLowerCase().trim(), r);
    const key = normalizeSearchText(r.name).trim();
    if (key) byName.set(key, byName.has(key) ? null : r); // null = homonymes : on ne devine pas
  });
  const existingKeys = new Set(payments.map(p => `${p.recordId}|${Number(p.amount || 0)}|${paymentIso(p)}`));
  let matched = 0, newContacts = 0, rejected = 0, duplicates = 0, total = 0;
  const prepared = [];
  rows.forEach(row => {
    const m = {};
    Object.entries(row).forEach(([header, value]) => { const f = PAYMENT_IMPORT_MAP[normalizeHeader(header)]; if (f && m[f] === undefined) m[f] = value; });
    const amount = importAmount(m.amount);
    const name = String(m.payer || `${m.first || ""} ${m.last || ""}`).replace(/\s+/g, " ").trim();
    const email = String(m.email || "").trim();
    if (!(amount > 0) || (!name && !email && !m.recordId)) { rejected += 1; return; }
    const record = byId.get(String(m.recordId || "")) || (email && byEmail.get(email.toLowerCase())) || byName.get(normalizeSearchText(name).trim()) || null;
    const iso = importDateIso(m.date) || todayIso();
    if (record && existingKeys.has(`${record.id}|${amount}|${iso}`)) { duplicates += 1; return; }
    if (record) matched += 1; else newContacts += 1;
    total += amount;
    prepared.push({ record, name: name || email, email, amount, iso, type: String(m.type || "").trim() || "Don", status: String(m.status || "").trim() || "Reçu", method: String(m.method || "").trim() || "Virement", occasion: splitTags(m.occasion), receiptNumber: String(m.receiptNumber || "").trim(), note: String(m.note || "").trim() });
  });
  return { kind: "payments", fileName, rows: rows.length, mappedHeaders: mappedHeaders.length, unmapped, matched, newContacts, rejected, duplicates, total, prepared };
}

function importPreviewHtml(p) {
  const notes = `${p.unmapped.length ? `<p class="form-note">Colonnes non reconnues (ignorées) : ${p.unmapped.map(escapeHtml).join(", ")}</p>` : ""}`;
  if (p.kind === "payments") return `<div class="metric-grid">
    ${metric("Paiements à importer", p.prepared.length.toLocaleString("fr-FR"), euro(p.total))}
    ${metric("Rattachés à une fiche", p.matched.toLocaleString("fr-FR"), "par email ou nom")}
    ${metric("Nouvelles fiches", p.newContacts.toLocaleString("fr-FR"), "payeur inconnu du CRM")}
    ${metric("Ignorés", (p.duplicates + p.rejected).toLocaleString("fr-FR"), `${p.duplicates} déjà présent(s), ${p.rejected} sans montant ou sans nom`)}
  </div>
  <p class="form-note">Les paiements importés sont marqués « Non éligible » au reçu fiscal (sauf numéro de reçu fourni) : aucun reçu n'est émis automatiquement pour un historique.</p>${notes}`;
  return `<div class="metric-grid">
    ${metric("Lignes lues", p.rows.toLocaleString("fr-FR"), "")}
    ${metric("Colonnes reconnues", `${p.mappedHeaders}/${p.mappedHeaders + p.unmapped.length}`, "")}
    ${metric("Nouvelles fiches", p.created.toLocaleString("fr-FR"), "")}
    ${metric("Fiches mises à jour", p.updated.toLocaleString("fr-FR"), "par email identique")}
  </div>
  ${p.missingEmail ? `<p class="form-note">${p.missingEmail} ligne(s) sans email — importées quand même, à compléter ensuite.</p>` : ""}${notes}`;
}

function confirmImport() {
  if (!pendingImport) return;
  const p = pendingImport;
  if (p.kind === "payments") {
    const createdByKey = new Map();
    p.prepared.forEach(row => {
      let record = row.record;
      if (!record) {
        const key = (row.email || row.name).toLowerCase();
        record = createdByKey.get(key);
        if (!record) {
          const idx = row.name.lastIndexOf(" ");
          record = { id: nextId("C", records), kind: "Contact", first: idx > -1 ? row.name.slice(0, idx) : "", last: idx > -1 ? row.name.slice(idx + 1) : row.name, name: row.name, email: row.email, phone: "", tags: [], groups: [], segments: [], importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0, source: `Import ${p.fileName}`, dateAdded: todayStr() };
          ensureInAccountScope(record);
          records.push(record);
          createdByKey.set(key, record);
        }
      }
      const [y, mo, d] = row.iso.split("-");
      payments.push({ id: nextId("PAY-SIN", payments), recordId: record.id, date: `${d}/${mo}/${y}`, at: `${row.iso}T12:00:00.000Z`, payer: record.name, email: record.email || row.email, amount: row.amount, type: row.type, status: row.status, method: row.method, occasion: row.occasion, receipt: row.receiptNumber ? "Généré ailleurs" : "Non éligible", ...(row.receiptNumber ? { receiptNumber: row.receiptNumber } : {}), promiseDate: row.iso, paymentDate: row.status === "Reçu" ? row.iso : "", installmentPlan: false, installments: [], note: row.note, source: `Import ${p.fileName}` });
    });
    imports.unshift({ id: nextId("IMP", imports), status: "Terminé", date: todayStr(), file: p.fileName, user: currentUserLabel(), type: "Paiements", rows: p.rows, errors: p.rejected, created: p.prepared.length, updated: 0, duplicates: p.duplicates, rejected: p.rejected });
    logAudit(`Import de ${p.fileName} : ${p.prepared.length} paiement(s) pour ${euro(p.total)}, ${p.newContacts} fiche(s) créée(s).`);
  } else {
    p.preparedRecords.forEach(({ mapped, match }) => {
      if (match) {
        Object.entries(mapped).forEach(([k, v]) => { if (v !== "" && !(Array.isArray(v) && !v.length)) match[k] = v; });
        match.dateModified = todayStr();
      } else {
        const imported = { id: nextId("C", records), kind: "Contact", source: `Import ${p.fileName}`, dateAdded: todayStr(), ...mapped };
        ensureInAccountScope(imported);
        records.push(imported);
      }
    });
    imports.unshift({ id: nextId("IMP", imports), status: "Terminé", date: todayStr(), file: p.fileName, user: currentUserLabel(), type: "Contacts", rows: p.rows, errors: 0, created: p.created, updated: p.updated, duplicates: p.updated, rejected: 0 });
    logAudit(`Import de ${p.fileName} : ${p.created} créé(s), ${p.updated} mis à jour.`);
  }
  pendingImport = null;
  dialog().close();
  navigate("imports", "Imports");
  saveCrmData().then(outcome => { if (outcome === "ok") notify("Import terminé"); });
}

/* ---------- 12. Démarrage ------------------------------------------------ */

/* ---------- 12b. Authentification (comptes réels, accès par serveur) --- */

function authScreenEl() { return document.querySelector("#authScreen"); }
function showAuthScreen() {
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.display = "none";
  authScreenEl().classList.add("show");
}
function hideAuthScreen() {
  authScreenEl().classList.remove("show");
  authScreenEl().innerHTML = "";
  const shell = document.querySelector(".app-shell");
  if (shell) shell.style.display = "";
}
function handleUnauthorized() {
  authToken = null;
  currentAccount = null;
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* stockage indisponible */ }
  showAuthScreen();
  renderLoginScreen("Session expirée — reconnectez-vous.");
}

function renderSetupScreen(error) {
  authScreenEl().innerHTML = `<div class="auth-card">
    <img class="auth-logo" src="./assets/logo-sinai.png" alt="Les Institutions Sinaï">
    <h1>Bienvenue sur le CRM Sinaï</h1>
    <p class="auth-subtitle">Première connexion : créez le compte administrateur.</p>
    ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
    <form class="auth-form" id="setupForm">
      <div class="auth-name-row">
        <label>Prénom<input name="first" required autocomplete="given-name"></label>
        <label>Nom<input name="last" required autocomplete="family-name"></label>
      </div>
      <label>Email<input name="email" type="email" required autocomplete="username"></label>
      <label>Mot de passe<input name="password" type="password" required minlength="8" autocomplete="new-password"></label>
      <button type="submit" class="primary-btn">Créer mon compte</button>
    </form>
  </div>`;
  document.querySelector("#setupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await apiSetupAdmin(data);
      authToken = res.token; currentAccount = res.account;
      try { localStorage.setItem(AUTH_TOKEN_KEY, authToken); } catch { /* stockage indisponible */ }
      hideAuthScreen();
      bootApp();
    } catch (err) { renderSetupScreen(err.message); }
  });
}

function renderLoginScreen(error) {
  authScreenEl().innerHTML = `<div class="auth-card">
    <img class="auth-logo" src="./assets/logo-sinai.png" alt="Les Institutions Sinaï">
    <h1>Bon retour</h1>
    <p class="auth-subtitle">Connectez-vous pour accéder au CRM Sinaï.</p>
    ${error ? `<div class="auth-error">${escapeHtml(error)}</div>` : ""}
    <form class="auth-form" id="loginForm">
      <label>Email<input name="email" type="email" required autocomplete="username"></label>
      <label>Mot de passe<input name="password" type="password" required autocomplete="current-password"></label>
      <button type="submit" class="primary-btn">Se connecter</button>
    </form>
  </div>`;
  document.querySelector("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    try {
      const res = await apiLogin(data);
      authToken = res.token; currentAccount = res.account;
      try { localStorage.setItem(AUTH_TOKEN_KEY, authToken); } catch { /* stockage indisponible */ }
      hideAuthScreen();
      bootApp();
    } catch (err) { renderLoginScreen(err.message); }
  });
}

function updateProfileCard() {
  const card = document.querySelector("#profileCard");
  if (!card || !currentAccount) return;
  const name = `${currentAccount.first || ""} ${currentAccount.last || ""}`.trim() || currentAccount.email;
  document.body.classList.toggle("read-only", isReadOnlyAccount());
  card.innerHTML = `${avatar({ name, kind: "Contact" }, "sm")}<span class="account-text"><strong>${escapeHtml(name)}</strong><span>${escapeHtml(currentAccount.profile)}${currentAccount.scopeMode === "tags" ? " · accès restreint" : ""}</span></span>${icon("chevrons", 14)}`;
}

async function boot() {
  authToken = (() => { try { return localStorage.getItem(AUTH_TOKEN_KEY); } catch { return null; } })();
  const status = await apiAuthStatus();
  if (status.setupRequired) {
    showAuthScreen();
    renderSetupScreen();
    return;
  }
  if (authToken) {
    currentAccount = await apiMe();
    if (!currentAccount) {
      authToken = null;
      try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* stockage indisponible */ }
    }
  }
  if (!currentAccount) {
    showAuthScreen();
    renderLoginScreen();
    return;
  }
  hideAuthScreen();
  bootApp();
}

// fromServer : la version reçue fait foi, même vide (utilisé au chargement
// et après un refus d'enregistrement, pour effacer les fiches "fantômes").
// Les trois listes de réglages qui ont une valeur par défaut la gardent tant
// que le serveur n'en a pas enregistré une.
function applyCrmData(data, fromServer = false) {
  const take = (key, current, needsContent = false) => {
    const value = data[key];
    if (!Array.isArray(value)) return current;
    if (needsContent && !value.length) return current;
    return value;
  };
  records = take("records", records, !fromServer);
  payments = take("payments", payments);
  imports = take("imports", imports);
  users = take("users", users);
  groups = take("groups", groups);
  interactions = take("interactions", interactions);
  linkages = take("linkages", linkages);
  customFields = take("customFields", customFields, true);
  receiptTemplates = take("receiptTemplates", receiptTemplates, true);
  savedViews = take("savedViews", savedViews);
  auditLog = take("auditLog", auditLog);
  interactionCategories = take("interactionCategories", interactionCategories, true);
  tasks = take("tasks", tasks);
  campaigns = take("campaigns", campaigns);
  holidayNotes = (data.holidayNotes && typeof data.holidayNotes === "object") ? data.holidayNotes : holidayNotes;
  receiptLog = take("receiptLog", receiptLog);
  dismissedDuplicates = take("dismissedDuplicates", dismissedDuplicates);
}

// Remise en forme des données chargées, sans rien changer à leur sens : un
// identifiant pour les éléments qui n'en avaient pas (liaisons, groupes,
// lignes du journal comptable...), nécessaire pour les modifier un par un.
// Volontairement minimal : chaque élément modifié ici est renvoyé au serveur
// au prochain enregistrement.
function normalizeLoadedData() {
  const giveIds = (list, prefix) => {
    const seen = new Set();
    list.forEach(item => {
      if (!item || typeof item !== "object") return;
      if (!item.id || seen.has(String(item.id))) item.id = `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      seen.add(String(item.id));
    });
  };
  giveIds(linkages, "LNK");
  giveIds(groups, "GRP");
  giveIds(imports, "IMP");
  giveIds(receiptLog, "RCL");
  giveIds(campaigns, "CAMP");
  giveIds(auditLog, "AUD");
  giveIds(tasks, "T");
  giveIds(savedViews, "SEG");
  records.forEach(r => { ["tags", "segments", "groups"].forEach(k => { if (r[k] && !Array.isArray(r[k])) r[k] = splitTags(r[k]); }); });
  payments.forEach(p => { if (p.occasion && !Array.isArray(p.occasion)) p.occasion = splitTags(p.occasion); });
}

async function bootApp() {
  updateProfileCard();
  await refreshAccounts();
  seedFromImportedContacts();
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ancienne copie locale, remplacée par IndexedDB */ }
  await flushPendingSync();
  const server = await apiGetState();
  if (server) {
    applyServerState(server);
  } else {
    // Serveur injoignable : on affiche la dernière copie gardée sur cet
    // appareil, avec les modifications qui attendaient d'être envoyées.
    const backup = await idbGet("state");
    if (backup && backup.accountId === currentAccount.id && backup.data) {
      syncSnapshot = snapshotOf(backup.data);
      syncRev = Number(backup.data.rev || 0);
      applyCrmData(backup.data, true);
      normalizeLoadedData();
      const pending = await idbGet("pending");
      if (pending && pending.accountId === currentAccount.id && pending.payload) applyPayloadLocally(pending.payload);
    }
  }
  // Pose déjà un rappel dès qu'une fête approche (pas besoin de cliquer un
  // bouton pour y penser) : voir ensureHolidayReminders plus haut.
  if (syncSnapshot && !isReadOnlyAccount() && ensureHolidayReminders()) saveCrmData({ silent: true });
  applyHash();
  state.booted = true;
  render();
  document.body.classList.remove("booting");
  if (!server) setSaveIndicator(syncSnapshot ? "Mode hors ligne — dernières données de cet appareil" : "Serveur injoignable", "warn");
  // Rappels de tâches : vraies notifications push envoyées par le serveur
  // (voir Paramètres > Mon compte) — on resynchronise juste l'état
  // d'abonnement de cet appareil pour que le réglage reflète la réalité.
  refreshPushState().then(() => { if (state.view === "settings" && !userIsTyping()) render(); });
}

// Thème clair/sombre : persisté dans localStorage, appliqué via l'attribut
// data-theme sur <html> (voir le script "anti-flash" dans index.html qui
// applique déjà la valeur mémorisée avant même que ce fichier ne se charge).
const THEME_KEY = "crm-theme";
function getEffectiveTheme() {
  const saved = document.documentElement.getAttribute("data-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* stockage indisponible */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b0b0f" : "#f4f4f6");
}

// Le démarrage (boot) et les écouteurs globaux sont à la fin de app-tools.js,
// chargé en dernier.
