/* =========================================================================
   CRM Sinaï — application front (aucune dépendance de build, un seul fichier)
   Sections :
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
const AUDIT_LIMIT = 200;

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

function loadLocalBackup() {
  try {
    if (!window.localStorage) return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

function saveLocalBackup(data) {
  try {
    if (window.localStorage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* stockage local indisponible : tant pis, on retentera au prochain enregistrement */ }
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

function currentCrmData() {
  return {
    version: 1,
    savedAt: nowIso(),
    state: { selectedRecord: state.selectedRecord },
    records, payments, imports, users, groups, interactions, linkages,
    customFields, receiptTemplates, savedViews, auditLog, interactionCategories, tasks,
  };
}

async function saveCrmData() {
  if (saveInFlight) { savePending = true; return; }
  saveInFlight = true;
  setSaveIndicator("Enregistrement…", "busy");
  const payload = currentCrmData();
  saveLocalBackup(payload);
  try {
    const res = await fetch(`${API_BASE}/api/state`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { handleUnauthorized(); return; }
    setSaveIndicator(res.ok ? "Enregistré" : "Enregistré localement seulement", res.ok ? "ok" : "warn");
  } catch {
    setSaveIndicator("Hors ligne — enregistré sur cet appareil", "warn");
  } finally {
    saveInFlight = false;
    if (savePending) { savePending = false; saveCrmData(); }
  }
}

function logAudit(text) {
  auditLog.unshift({ id: `AUD-${Date.now().toString(36)}`, date: todayStr(), at: nowIso(), text, user: currentUserLabel() });
  if (auditLog.length > AUDIT_LIMIT) auditLog.length = AUDIT_LIMIT;
}

/* ---------- 3. État & données de départ --------------------------------- */

const state = {
  view: "home",
  section: "ACCUEIL",
  query: "",
  selectedRecord: null,
  tab: "Details",
  drawer: null,
  toastTimer: null,
  showDetail: true,
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
};

const PAGE_STEP = 80;

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

const apps = [
  ["HelloAsso", "Collecter"], ["Stripe", "Collecter"], ["GoCardless", "Collecter"], ["iRaiser", "Collecter"],
  ["Brevo", "Communiquer"], ["Mailchimp", "Communiquer"], ["Mailjet", "Communiquer"], ["Gmail / Outlook IMAP", "Communiquer"],
  ["Google Calendar", "Recruter"], ["Gravity Forms", "Recruter"], ["Pennylane", "Comptabilité"], ["Zapier", "Possibilités infinies"],
];

const navTree = [
  ["home", "ACCUEIL", []],
  ["stats", "STATS", ["Vue d'ensemble"]],
  ["crm", "CONTACTS", ["Contacts", "Structures", "Interactions", "Segments", "Groupes", "Liaisons"]],
  ["pay", "PAIEMENTS", ["Tous les paiements", "Dons", "Adhésions", "Billetterie", "Reçus"]],
  ["imports", "IMPORTS", []],
  ["apps", "APPLIS", ["Toutes les applis"]],
  ["settings", "PARAMÈTRES", ["Champs personnalisés", "Catégories d'interaction", "Reçus"]],
  ["admin", "ADMINISTRATION", ["Utilisateurs", "Journal d'activité"]],
];

const titles = {
  home: ["Accueil", "Vue générale du CRM Sinaï"],
  stats: ["Stats", "Chiffres réels de la collecte et des contacts"],
  crm: ["Contacts", "Contacts, structures, interactions, segments, groupes et liaisons"],
  pay: ["Paiements", "Dons, adhésions, billetterie et reçus"],
  imports: ["Imports", "Historique des imports de contacts"],
  apps: ["Applis", "Connexions externes"],
  settings: ["Paramètres", "Champs personnalisés et reçus fiscaux"],
  admin: ["Administration", "Utilisateurs et journal d'activité"],
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
  users = [{ email: "pevznerarie@gmail.com", first: "Arié", last: "Pevzner", profile: "Administrateur", lastSeen: "Aujourd'hui" }];
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

function rebuildIndexes() {
  recordsIndex = new Map(records.map(r => [r.id, r]));
  paymentsIndex = new Map();
  payments.forEach(p => {
    if (!p.recordId) return;
    if (!paymentsIndex.has(p.recordId)) paymentsIndex.set(p.recordId, []);
    paymentsIndex.get(p.recordId).push(p);
  });
  paymentsIndex.forEach(list => list.sort((a, b) => (b.at || "").localeCompare(a.at || "")));
  interactionsIndex = new Map();
  interactions.forEach(i => {
    if (!i.recordId) return;
    if (!interactionsIndex.has(i.recordId)) interactionsIndex.set(i.recordId, []);
    interactionsIndex.get(i.recordId).push(i);
  });
  interactionsIndex.forEach(list => list.sort((a, b) => (b.at || "").localeCompare(a.at || "")));
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

function recordTotalAmount(r) {
  return Number(r.importedAmount || 0) + recordLivePayments(r.id).reduce((sum, p) => sum + Number(p.amount || 0), 0);
}
function recordPaymentsCount(r) {
  return Number(r.importedPaymentsCount || 0) + recordLivePayments(r.id).length;
}
function recordInteractionsCount(r) {
  return Number(r.importedInteractionsCount || 0) + recordLiveInteractions(r.id).length;
}

function nextId(prefix, list) {
  const numbers = list
    .map(item => String(item.id || ""))
    .filter(id => id.startsWith(`${prefix}-`))
    .map(id => id.split("-").pop())
    .map(Number)
    .filter(Number.isFinite);
  const next = (numbers.length ? Math.max(...numbers) : 1000) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
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
  const tone = lower.includes("valide") || lower.includes("termine") || lower.includes("genere") || lower.includes("envoye") ? "ok"
    : lower.includes("erreur") || lower.includes("non eligible") ? "bad"
    : lower.includes("attente") || lower.includes("reprendre") || lower.includes("generer") ? "warn" : "";
  return `<span class="status ${tone}">${escapeHtml(text)}</span>`;
}
function action(label, key, cls = "") {
  return `<button type="button" class="${cls}" data-action="${escapeHtml(key || label)}">${escapeHtml(label)}</button>`;
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
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
    btn.addEventListener("click", () => {
      const name = (window.prompt("Nom de la nouvelle catégorie (ex : Chiour)") || "").trim();
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
  if (!window.confirm(`Supprimer le compte de ${acc.email} ? Cette action est irréversible.`)) return;
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
function pickerField(label, name, selected, required = true) {
  const displayValue = selected ? selected.name : "";
  const idValue = selected ? selected.id : "";
  return `<label class="span-2 picker-wrap" data-picker="${name}">${label}
    <input type="text" class="picker-input" data-picker-input="${name}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Rechercher un nom, un email..." value="${escapeHtml(displayValue)}">
    <input type="hidden" name="${name}" data-picker-value="${name}" value="${escapeHtml(idValue)}"${required ? " required" : ""}>
    <div class="picker-results" data-picker-results="${name}"></div>
  </label>`;
}
function wirePickers(root) {
  root.querySelectorAll("[data-picker-input]").forEach(input => {
    const key = input.dataset.pickerInput;
    const hidden = root.querySelector(`[data-picker-value="${key}"]`);
    const results = root.querySelector(`[data-picker-results="${key}"]`);
    const showResults = (term) => {
      const q = term.trim().toLowerCase();
      let list = records;
      if (q) list = records.filter(r => (r.name || "").toLowerCase().includes(q) || (r.email || "").toLowerCase().includes(q));
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
    input.addEventListener("focus", () => { selectAllSoon(); showResults(input.value); });
    input.addEventListener("click", selectAllSoon);
    input.addEventListener("input", () => { hidden.value = ""; showResults(input.value); });
    input.addEventListener("blur", () => setTimeout(() => results.classList.remove("open"), 120));
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

function notify(message) {
  const toast = toastEl();
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

/* ---------- 6. Rendu des vues -------------------------------------------- */

function filteredRecords() {
  const q = state.query.toLowerCase();
  return records.filter(r => !q || [r.id, r.kind, r.name, r.email, r.phone, r.address, r.city, ...(r.tags || []), ...(r.groups || [])].join(" ").toLowerCase().includes(q));
}
function filteredPayments(type) {
  const q = state.query.toLowerCase();
  return payments.filter(p => (!type || p.type === type) && (!q || Object.values(p).join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
function currentRows() {
  if (state.view === "pay") return filteredPayments({ Dons: "Don", Adhésions: "Adhésion", Billetterie: "Billetterie" }[state.section]);
  if (state.view === "imports") return imports;
  if (state.view === "admin") return accounts;
  if (state.view === "settings") return customFields;
  return filteredRecords();
}

function renderNav() {
  const isAdmin = currentAccount && currentAccount.profile === "Administrateur";
  const visibleTree = navTree.filter(([id]) => id !== "admin" || isAdmin);
  nav().innerHTML = visibleTree.map(([id, label, children]) => `
    <div class="nav-group">
      <button class="nav-btn ${state.view === id ? "active" : ""}" data-view="${id}" data-section="${children[0] || label}">
        <span>${label}</span>
      </button>
      ${children.length ? `<div class="subnav">${children.map(child => `<button class="subnav-btn ${state.section === child ? "current" : ""}" data-view="${id}" data-section="${child}">${child}</button>`).join("")}</div>` : ""}
    </div>`).join("");
}

function setHeader() {
  const [title, subtitle] = titles[state.view];
  viewTitle().textContent = state.section === title.toUpperCase() ? title : state.section;
  viewSubtitle().textContent = subtitle;
  // Sur l'Accueil, ce bandeau générique ("Accueil" / "Vue générale...") ne
  // sert à rien : la page a déjà son propre en-tête juste en dessous
  // ("Bonjour, ..."), avec la date et les actions rapides. On ne le masque
  // que pour cette page — les autres vues (Contacts, Paiements...) n'ont pas
  // de gros titre à elles et en ont toujours besoin.
  const topbarEl = document.querySelector(".topbar");
  if (topbarEl) topbarEl.classList.toggle("topbar-hidden", state.view === "home");
}

function metric(label, value, note) {
  return `<div class="metric"><span class="eyebrow">${label}</span><strong>${value}</strong><p>${note}</p></div>`;
}

function toolbar(placeholder = "Rechercher un nom, un email ou une ville") {
  return `<div class="toolbar">
    <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="${placeholder}" autocapitalize="off" autocorrect="off" spellcheck="false" />
    <div class="row-actions">
      ${action("Réinitialiser", "reset-filters")}
      ${action("Actions", "open-actions")}
    </div>
  </div>`;
}

function home() {
  const totalDons = records.reduce((s, r) => s + recordTotalAmount(r), 0) || payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const missingEmail = records.filter(r => !r.email).length;
  // "Reste à payer" ne porte que sur les Promesses et les paiements
  // échelonnés (les seuls dont on suit vraiment un solde restant) : les dons
  // historiques importés utilisent des libellés de statut très divers
  // ("Paiement validé", "Chèque encaissé"...) qui ne veulent pas dire
  // "en attente" même s'ils ne s'écrivent pas exactement "Validé" — les
  // inclure ferait passer presque tout l'historique pour "restant à payer".
  // Tient compte des versements déjà reçus sur un paiement échelonné : une
  // Promesse de 7 700 € dont 5 000 € sont déjà arrivés ne compte plus que
  // pour 2 700 € restants, pas pour son montant d'origine.
  const outstanding = payments.filter(p => (p.type === "Promesse" || p.installmentPlan) && p.status !== "Validé" && paymentRemaining(p) > 0);
  const outstandingAmount = outstanding.reduce((s, p) => s + paymentRemaining(p), 0);
  const lateTasks = tasks.filter(t => t.status !== "fait" && t.dueDate && t.dueDate < todayIso());
  const recentInteractions = [...interactions].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 6);
  const now = new Date();
  const greetHour = now.getHours();
  const greetWord = greetHour < 5 ? "Bonsoir" : greetHour < 12 ? "Bonjour" : greetHour < 18 ? "Bon après-midi" : "Bonsoir";
  const greetName = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  const todayLabel = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return `
    <div class="home-premium">
      <div class="hp-topline">
        <span class="hp-eyebrow">Les institutions Sinaï</span>
        <span class="hp-date">${escapeHtml(todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1))}</span>
      </div>
      <header class="hp-hero">
        <p class="hp-kicker">Pilotage Sinaï</p>
        <h1 class="hp-title">${greetName ? `${greetWord}, <em>${escapeHtml(greetName)}</em>` : "Pilotage Sinaï"}</h1>
        <p class="hp-subtitle">Contacts, familles, structures, dons et suivi des interactions, centralisés et à jour.</p>
        <div class="hp-actions">
          ${action("Nouveau contact", "add-contact", "hp-btn hp-btn-primary")}
          ${action("Nouveau don", "add-payment:Don", "hp-btn hp-btn-ghost")}
        </div>
      </header>

      <section class="hp-stats hp-stats-2col">
        ${hpStat("Reste à payer", euro(outstandingAmount), outstanding.length ? `${outstanding.length} paiement(s) à encaisser` : "Rien en attente")}
        ${hpStat("Tâches en retard", lateTasks.length.toLocaleString("fr-FR"), lateTasks.length ? "À traiter en priorité" : "Rien en retard")}
      </section>

      ${hpTasksPanel()}

      ${hpPortfolioPanel()}

      ${hpHolidayPanel()}

      <section class="hp-columns">
        ${hpCard("hp-icon-family", "Contacts et familles", [["Ajouter un contact", "add-contact"], ["Ajouter une structure", "add-structure"], ["Rechercher les doublons", "dedupe"]])}
        ${hpCard("hp-icon-coin", "Collecte", [["Ajouter un don", "add-payment:Don"], ["Ajouter une adhésion", "add-payment:Adhésion"], ["Reçus", "goto-receipts"]])}
        ${hpCard("hp-icon-check", "Suivi", [["Ajouter une interaction", "add-interaction"], ["Voir les interactions", "goto-interactions"], ["Voir le journal", "goto-audit"]])}
        ${hpCard("hp-icon-import", "Import", [["Importer un fichier", "import-new"], ["Exporter la vue active", "export-current"]])}
      </section>

      ${recentInteractions.length ? `<section class="hp-activity">
        <div class="hp-activity-head"><h2>Activité récente</h2><button type="button" class="hp-link" data-action="goto-interactions">Voir tout</button></div>
        <div class="hp-timeline">${recentInteractions.map(i => hpActivityItem(i)).join("")}</div>
      </section>` : ""}

      <section class="hp-activity hp-admin">
        <div class="hp-activity-head"><h2>Vue d'ensemble</h2><span class="hp-admin-tag">Administration générale</span></div>
        <div class="hp-stats hp-stats-2col hp-stats-boxed">
          ${hpStat("Montant total", euro(totalDons), "Historique importé + dons enregistrés")}
          ${hpStat("Emails manquants", missingEmail.toLocaleString("fr-FR"), "À compléter pour l'emailing")}
        </div>
      </section>
    </div>`;
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
function hpHolidayPanel() {
  const upcoming = upcomingHolidays(3);
  if (!upcoming.length) return "";
  return `<section class="hp-holidays">
    <div class="hp-activity-head"><h2>Stratégie des fêtes</h2><span class="hp-tasks-count">Prochaine dans ${upcoming[0].daysLeft <= 0 ? "0 j" : `${upcoming[0].daysLeft} j`}</span></div>
    <div class="hp-holiday-list">
      ${upcoming.map(h => `<div class="hp-holiday-row">
        <div class="hp-holiday-main">
          <span class="hp-holiday-emoji">${h.emoji}</span>
          <div>
            <strong>${escapeHtml(h.name)}</strong>
            <span class="hp-holiday-date">${formatFrDate(h.date)} · ${h.daysLeft <= 0 ? "aujourd'hui" : `dans ${h.daysLeft} jour${h.daysLeft > 1 ? "s" : ""}`}</span>
          </div>
        </div>
        ${action("Préparer la relance", `holiday-prepare:${h.key}`, "primary-btn")}
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
  modalShell("holidayTask", "Stratégie des fêtes", `Préparer ${h.name}`,
    `<input type="hidden" name="holidayKey" value="${escapeHtml(h.key)}">
     <div class="span-2 holiday-strategy-tip">💡 ${escapeHtml(tpl.strategy)}</div>
     <label class="span-2">Objet de l'email<input type="text" readonly id="holidayEmailSubject" value="${escapeHtml(tpl.emailSubject)}"></label>
     <div class="span-2 copy-row">${copyButton("Copier l'objet", "holidayEmailSubject")}</div>
     <label class="span-2">Corps de l'email<textarea readonly id="holidayEmailBody" class="holiday-textarea">${escapeHtml(tpl.emailBody)}</textarea></label>
     <div class="span-2 copy-row">${copyButton("Copier l'email", "holidayEmailBody")}</div>
     <label class="span-2">Message court (SMS / WhatsApp)<textarea readonly id="holidaySmsBody" class="holiday-textarea holiday-textarea-sms">${escapeHtml(tpl.sms)}</textarea></label>
     <div class="span-2 copy-row">${copyButton("Copier le message", "holidaySmsBody")}</div>`,
    "Créer une tâche de relance");
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
function hpPortfolioPanel() {
  const mine = myAgentCode();
  if (!mine) return "";
  const list = myPortfolioRecords()
    .map(r => { const days = daysSincePortfolioContact(r); return { r, days, tone: portfolioTone(days) }; })
    .sort((a, b) => PORTFOLIO_TONE_ORDER[a.tone] - PORTFOLIO_TONE_ORDER[b.tone] || (b.days ?? 99999) - (a.days ?? 99999));
  const overdue = list.filter(x => x.tone === "never" || x.tone === "late").length;
  const shown = list.slice(0, 8);
  return `<section class="hp-portfolio">
    <div class="hp-activity-head"><h2>Mon portefeuille</h2><span class="hp-tasks-count">${list.length ? (overdue ? `${overdue} à recontacter` : "Tout est à jour") : "Aucun contact suivi"}</span></div>
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
    ${action("Enregistrer un contact", `portfolio-touch:${r.id}`, "primary-btn")}
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
  if (t.dueDate < today) return { tone: "late", label: `En retard — ${formatFrDate(t.dueDate)}` };
  if (t.dueDate === today) return { tone: "today", label: "Aujourd'hui" };
  return { tone: "soon", label: formatFrDate(t.dueDate) };
}
function formatFrDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
function hpTasksPanel() {
  const open = tasks.filter(t => t.status !== "fait").sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);
  const done = tasks.filter(t => t.status === "fait").sort((a, b) => (b.completedAt || b.createdAt || "").localeCompare(a.completedAt || a.createdAt || ""));
  const shown = open.slice(0, 8);
  const shownDone = done.slice(0, 15);
  const me = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  const showDone = !!state.showDoneTasks;
  return `<section class="hp-tasks">
    <div class="hp-activity-head"><h2>Tâches</h2><span class="hp-tasks-count">${open.length ? `${open.length} en cours` : "Tout est fait"}</span></div>
    <form class="hp-task-form" id="hpTaskForm" autocomplete="off">
      <div class="hp-task-input-wrap">
        <input type="text" name="title" id="hpTaskTitle" placeholder="Ajouter une tâche… ex. « Contacter Dupont »" maxlength="140" required>
        <div class="hp-task-suggest" id="hpTaskSuggest" hidden></div>
      </div>
      <input type="hidden" name="recordId" id="hpTaskRecordId" value="">
      <input type="date" name="dueDate" value="${todayIso()}">
      <button type="submit" class="hp-task-add" title="Ajouter">+</button>
      <div class="hp-task-linked" id="hpTaskLinked" hidden>Lié à <strong id="hpTaskLinkedName"></strong><button type="button" id="hpTaskUnlink" title="Détacher">✕</button></div>
    </form>
    ${shown.length ? `<div class="hp-task-list">${shown.map(t => hpTaskRow(t)).join("")}</div>` : `<p class="muted-note">Aucune tâche en cours${me ? ` pour ${escapeHtml(me)}` : ""}. Ajoute la première ci-dessus.</p>`}
    ${done.length ? `<button type="button" class="hp-link hp-tasks-done-toggle" data-action="toggle-done-tasks">${showDone ? "Masquer" : "Voir"} les tâches terminées (${done.length})</button>` : ""}
    ${showDone && shownDone.length ? `<div class="hp-task-list hp-task-list-done">${shownDone.map(t => hpTaskRow(t)).join("")}</div>` : ""}
  </section>`;
}
function hpTaskRow(t) {
  const due = taskDueInfo(t);
  const linkedRecord = t.recordId ? recordById(t.recordId) : null;
  const done = t.status === "fait";
  // Les commandes de fin de ligne (date, assigné, modifier, supprimer) sont
  // regroupées dans leur propre bloc : sur un petit écran, ajouter le bouton
  // "Modifier" en plus de "Supprimer" ne tenait plus sur une seule ligne à
  // côté du titre et débordait hors de l'écran (invisible et impossible à
  // toucher). Ce regroupement permet de le faire passer proprement à la
  // ligne suivante sur mobile, sans rien changer sur desktop où il y a
  // largement la place.
  return `<div class="hp-task-row${done ? " hp-task-row-done" : ""}">
    <input type="checkbox" class="hp-task-checkbox" data-action="toggle-task:${t.id}" ${done ? "checked" : ""}>
    <div class="hp-task-main">
      <span class="hp-task-title">${escapeHtml(t.title)}</span>
      ${linkedRecord ? `<button type="button" class="hp-task-contact-chip" data-action="open-record:${linkedRecord.id}:Tâches" title="Ouvrir la fiche">${escapeHtml(linkedRecord.name || "")}</button>` : ""}
    </div>
    <div class="hp-task-controls">
      <input type="date" class="hp-task-date hp-task-date-${done ? "none" : due.tone}" data-task="${t.id}" value="${t.dueDate || ""}" title="${due.label ? escapeHtml(due.label) : "Ajouter une échéance"}">
      ${t.assignedTo ? `<span class="hp-task-assignee">${escapeHtml(t.assignedTo)}</span>` : ""}
      <button type="button" class="hp-task-edit" data-action="edit-task:${t.id}" title="Modifier">✎</button>
      <button type="button" class="hp-task-remove" data-action="delete-task:${t.id}" title="Supprimer">✕</button>
    </div>
  </div>`;
}
// Modifier une tâche existante : jusqu'ici on pouvait seulement cocher,
// changer la date (directement sur la ligne) ou supprimer une tâche —
// impossible de corriger une faute de frappe dans le titre, changer le
// contact lié ou réassigner la tâche sans tout refaire depuis le début.
function openEditTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return notify("Tâche introuvable");
  const linked = t.recordId ? recordById(t.recordId) : null;
  modalShell("editTask", "Tâche", "Modifier la tâche",
    `<input type="hidden" name="taskId" value="${escapeHtml(t.id)}">
     ${field("Titre de la tâche", "title", t.title, "text", "required maxlength='140'")}
     ${field("Échéance", "dueDate", t.dueDate || "", "date")}
     ${pickerField("Contact lié (optionnel)", "recordId", linked, false)}
     ${field("Assigné à", "assignedTo", t.assignedTo || "")}`, "Enregistrer");
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
function buildTask(title, dueDate, recordId) {
  const clean = (title || "").trim();
  if (!clean) return null;
  const me = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  const linked = recordId ? recordById(recordId) : null;
  return {
    id: `T-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    title: clean,
    dueDate: dueDate || "",
    status: "à faire",
    assignedTo: me,
    createdBy: me,
    createdAt: nowIso(),
    completedAt: null,
    recordId: linked ? linked.id : null,
  };
}
function addHomeTask(title, dueDate, recordId) {
  const t = buildTask(title, dueDate, recordId);
  if (!t) return;
  tasks.unshift(t);
  const linked = t.recordId ? recordById(t.recordId) : null;
  logAudit(`Tâche ajoutée : ${t.title}${linked ? ` (liée à ${linked.name})` : ""}.`);
  saveCrmData();
  render();
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
  const t = tasks.find(x => x.id === id);
  tasks = tasks.filter(x => x.id !== id);
  if (t) logAudit(`Tâche supprimée : ${t.title}.`);
  saveCrmData();
  render();
}

// ---- Notifications de tâches sur cet appareil -----------------------------
// Rappel local (API Notification du navigateur), avec une heure choisie par
// la personne connectée. Réglage volontairement gardé par appareil (comme
// l'autorisation de notification elle-même) : stocké en localStorage, pas
// synchronisé dans /api/state. Ça fonctionne tant que le CRM a été ouvert
// dans ce navigateur récemment (l'onglet ou l'app installée) ; ce n'est pas
// une vraie notification "push" reçue même app totalement fermée — surtout
// pas garanti sur iPhone/Safari, où c'est une vraie limite technique.
const NOTIF_PREFS_KEY = "sinai-crm-notif-prefs-v1";
function loadNotifPrefs() {
  try {
    if (!window.localStorage) return { enabled: false, time: "09:00", lastFired: "" };
    const raw = window.localStorage.getItem(NOTIF_PREFS_KEY);
    if (!raw) return { enabled: false, time: "09:00", lastFired: "" };
    const data = JSON.parse(raw);
    return { enabled: !!data.enabled, time: data.time || "09:00", lastFired: data.lastFired || "" };
  } catch {
    return { enabled: false, time: "09:00", lastFired: "" };
  }
}
function saveNotifPrefs() {
  try {
    if (window.localStorage) window.localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(notifPrefs));
  } catch { /* stockage indisponible : tant pis, le réglage ne persistera pas */ }
}
let notifPrefs = loadNotifPrefs();
function tasksDueForNotification() {
  const me = currentAccount ? (currentAccount.first || (currentAccount.email || "").split("@")[0]) : "";
  return tasks.filter(t => t.status !== "fait" && t.dueDate && t.dueDate <= todayIso() && (!me || !t.assignedTo || t.assignedTo === me));
}
function maybeFireTaskNotification() {
  if (!notifPrefs.enabled) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const today = todayIso();
  if (notifPrefs.lastFired === today) return;
  const now = new Date();
  const nowHm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (nowHm < (notifPrefs.time || "09:00")) return;
  const due = tasksDueForNotification();
  if (due.length) {
    try {
      const title = due.length === 1 ? "1 tâche à traiter" : `${due.length} tâches à traiter`;
      const body = due.slice(0, 5).map(t => `• ${t.title}`).join("\n") + (due.length > 5 ? `\n… et ${due.length - 5} autre(s)` : "");
      new Notification(title, { body, icon: "./assets/icon-192.png" });
    } catch { /* notification indisponible sur cet appareil */ }
  }
  notifPrefs.lastFired = today;
  saveNotifPrefs();
}
function notifSettingsPanel() {
  const supported = typeof Notification !== "undefined";
  const permission = supported ? Notification.permission : "unsupported";
  return `<section class="panel pad" id="notifSettingsPanel">
    <span class="eyebrow">Rappels</span><h2>Notifications de tâches</h2>
    <p class="muted-note">Reçois une notification sur cet appareil pour tes tâches du jour et en retard, à l'heure choisie ci-dessous. Ça fonctionne tant que le CRM a été ouvert récemment dans ce navigateur (ou l'app installée) sur ce téléphone/ordinateur — ce n'est pas garanti si l'app reste fermée longtemps, notamment sur iPhone.</p>
    ${!supported ? `<p class="muted-note">Ce navigateur ne prend pas en charge les notifications.</p>` : ""}
    ${supported && permission === "denied" ? `<p class="muted-note">Les notifications sont bloquées pour ce site dans les réglages du navigateur. Autorise-les pour recevoir les rappels.</p>` : ""}
    <label class="settings-toggle-row"><input type="checkbox" id="notifEnabledToggle" ${supported ? "" : "disabled"} ${notifPrefs.enabled ? "checked" : ""}><span>Activer les notifications de tâches sur cet appareil</span></label>
    <div class="form-grid"><label>Heure du rappel<input type="time" id="notifTimeInput" value="${escapeHtml(notifPrefs.time)}" ${supported ? "" : "disabled"}></label></div>
  </section>`;
}

const HP_ICONS = {
  "hp-icon-family": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.2"/><path d="M15.8 13.6c1.9.3 3.4 1.8 3.9 4.2"/></svg>',
  "hp-icon-coin": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M14.6 9.3a3.6 3.6 0 1 0 0 5.4"/><path d="M7.5 10.6h5.5M7.5 13.4h4.6"/></svg>',
  "hp-icon-check": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M8 12.2l2.4 2.4L16 9.2"/></svg>',
  "hp-icon-import": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7.5 11 12 15.5 16.5 11"/><path d="M4.5 18.5h15"/></svg>',
};

function hpStat(label, value, note) {
  return `<div class="hp-stat">
    <span class="hp-stat-label">${escapeHtml(label)}</span>
    <strong class="hp-stat-value">${value}</strong>
    <span class="hp-stat-note">${escapeHtml(note)}</span>
  </div>`;
}

function hpCard(icon, title, rows) {
  return `<section class="hp-card">
    <div class="hp-card-head">${HP_ICONS[icon] || ""}<h3>${escapeHtml(title)}</h3></div>
    <div class="hp-card-links">${rows.map(([label, key]) => `<button type="button" class="hp-card-link" data-action="${escapeHtml(key || label)}">${escapeHtml(label)}<span class="hp-card-arrow">→</span></button>`).join("")}</div>
  </section>`;
}

function hpActivityItem(i) {
  const r = recordById(i.recordId);
  const name = r ? r.name : (i.target || "Contact supprimé");
  return `<button class="hp-timeline-item" type="button" data-action="open-record:${i.recordId}:Activité">
    <span class="hp-timeline-dot"></span>
    <span class="hp-timeline-body">
      <span class="hp-timeline-top"><strong>${escapeHtml(name)}</strong><span class="hp-timeline-kind">${escapeHtml(i.type || "")}</span></span>
      <span class="hp-timeline-label">${escapeHtml(i.label || "")}${i.note ? " — " + escapeHtml(i.note) : ""}</span>
      <span class="hp-timeline-date">${i.date || ""}</span>
    </span>
  </button>`;
}

function card(title, rows) {
  return `<section class="panel pad compact-card"><h3>${title}</h3>${rows.map(([label, key]) => action(label, key)).join("")}</section>`;
}

function activityItem(i) {
  const r = recordById(i.recordId);
  const name = r ? r.name : (i.target || "Contact supprimé");
  const kindTag = i.type === "Commentaire" ? tag("Commentaire", "violet") : tag(i.type, "blue");
  return `<button class="timeline-item" type="button" data-action="open-record:${i.recordId}"><strong>${escapeHtml(name)}</strong> ${kindTag}<p>${escapeHtml(i.label || "")}${i.note ? " — " + escapeHtml(i.note) : ""}</p><span class="timeline-date">${i.date}</span></button>`;
}

function crm() {
  if (state.section === "Segments") return segments();
  if (state.section === "Groupes") return groupsView();
  if (state.section === "Interactions") return interactionsView();
  if (state.section === "Liaisons") return linkagesView();
  return recordsView(state.section === "Structures" ? "Structure" : state.section === "Contacts" ? "Contact" : null);
}

function recordsView(kind) {
  const rows = filteredRecords().filter(r => !kind || r.kind === kind);
  if (!rows.length && !records.length) {
    return emptyState("Aucun contact pour l'instant. Ajoutez-en un ou importez un fichier.", "Ajouter un contact", "add-contact");
  }
  const selected = recordById(state.selectedRecord) || rows[0] || records[0];
  if (selected) state.selectedRecord = selected.id;
  const totalAmount = rows.reduce((sum, r) => sum + recordTotalAmount(r), 0);
  const missingEmail = rows.filter(r => !r.email).length;
  const recordLabel = kind === "Structure" ? "structures" : kind === "Contact" ? "contacts" : "fiches";
  const showDetail = state.showDetail && rows.length && selected;
  const { visible, remaining } = visiblePage(rows, "recordsPage");
  const loadMore = remaining ? `<button type="button" class="load-more" data-action="load-more-records">Afficher ${Math.min(remaining, PAGE_STEP)} de plus (${remaining.toLocaleString("fr-FR")} restants)</button>` : "";
  return `<div class="records-layout${showDetail ? "" : " no-detail"}${showDetail && state.mobileDetailOpen ? " mobile-detail-open" : ""}">
    <section class="panel records-panel">
      <div class="records-command">
        <div>
          <span class="eyebrow">Répertoire Sinaï</span>
          <h2>${rows.length.toLocaleString("fr-FR")} ${recordLabel}</h2>
          <p>Vue de travail pour qualifier, segmenter et suivre les relations.</p>
        </div>
        <div class="command-stats">
          <div><strong>${euro(totalAmount)}</strong><span>Montant relié</span></div>
          <div><strong>${missingEmail.toLocaleString("fr-FR")}</strong><span>Emails absents</span></div>
          <div><strong>${rows.reduce((sum, r) => sum + recordInteractionsCount(r), 0).toLocaleString("fr-FR")}</strong><span>Interactions</span></div>
        </div>
      </div>
      <div class="toolbar records-tools">
        <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Rechercher un nom, un email ou une ville" autocapitalize="off" autocorrect="off" spellcheck="false" />
        <div class="row-actions">${action("Contact", "add-contact", "primary-btn")} ${action("Structure", "add-structure")}${showDetail ? "" : (rows.length ? action("Voir la fiche", "open-detail") : "")}</div>
      </div>
      <div class="table-wrap desktop-only"><table class="records-table">
      <thead><tr><th>Nom</th><th>ID</th><th>Email</th><th>Téléphone</th><th>Étiquettes</th><th>Montant total</th><th>Interactions</th></tr></thead>
      <tbody>${visible.map(r => `<tr class="${showDetail && r.id === selected.id ? "selected" : ""}" data-record="${r.id}">
        <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><span>${r.kind}</span></td><td>${r.id}</td><td>${escapeHtml(r.email || "-")}</td><td>${escapeHtml(r.phone || "-")}</td><td>${(r.tags || []).map((t,i)=>tag(t, ["","blue","violet"][i%3])).join(" ") || "-"}</td><td class="money-cell">${euro(recordTotalAmount(r))}</td><td>${recordInteractionsCount(r)}</td>
      </tr>`).join("")}</tbody></table>${loadMore}</div>
      <div class="record-cards mobile-only">${visible.map(r => `<button type="button" class="record-card ${showDetail && r.id === selected.id ? "selected" : ""}" data-record="${r.id}">
        <div class="record-card-head"><strong>${escapeHtml(r.name)}</strong><span class="money-cell">${euro(recordTotalAmount(r))}</span></div>
        <p>${escapeHtml(r.email || "Pas d'email")} · ${escapeHtml(r.phone || "Pas de téléphone")}</p>
        <div class="chip-list">${(r.tags || []).map(t=>tag(t,"blue")).join("")}</div>
      </button>`).join("")}${loadMore}</div>
    </section>
    ${showDetail ? recordDetail(selected) : ""}
  </div>`;
}

function segments() {
  const known = new Set();
  records.forEach(r => (r.segments || []).forEach(s => known.add(s)));
  const rows = [...known].map(s => [s, `apply-segment:${s}`]);
  return panelList("Segments détectés dans les fiches", rows.length ? rows : [], "Créer un segment sur une fiche", "goto-contacts");
}

function groupsView() {
  const derived = {};
  records.forEach(r => (r.groups || []).forEach(g => { derived[g] = derived[g] || { contacts: 0, structures: 0 }; derived[g][r.kind === "Structure" ? "structures" : "contacts"] += 1; }));
  const manual = groups.filter(g => !(g.name in derived));
  const rows = [...Object.entries(derived).map(([name, c]) => ({ name, ...c, type: "Détecté" })), ...manual];
  return `<section class="panel">${toolbar("Rechercher un nom de groupe")}<div class="toolbar thin"><div class="row-actions">${action("Créer un groupe", "add-group", "primary-btn")} ${action("Exporter", "export-current")}</div></div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Nom</th><th>Contacts</th><th>Structures</th><th>Origine</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.contacts||0}</td><td>${r.structures||0}</td><td>${r.type||"Manuel"}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Aucun groupe pour l'instant. Les groupes apparaissent ici dès qu'une fiche en porte un, ou créez-en un manuellement.", "Créer un groupe", "add-group")}
  </section>`;
}

function interactionsView() {
  const rows = [...interactions].sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  return `<section class="panel">${toolbar("Rechercher dans les interactions")}<div class="toolbar thin"><div class="row-actions">${action("Ajouter une interaction", "add-interaction", "primary-btn")} ${action("Exporter", "export-current")}</div></div>
    ${rows.length ? `<div class="table-wrap desktop-only"><table><thead><tr><th>Date</th><th>Contact / structure</th><th>Catégorie</th><th>Libellé</th><th>Type</th><th>Note</th><th>Utilisateur</th></tr></thead><tbody>${rows.map(r=>{
      const rec = recordById(r.recordId);
      return `<tr class="row-click" data-action="open-record:${r.recordId}:Activité"><td>${r.date}</td><td>${escapeHtml(rec ? rec.name : (r.target || "-"))}</td><td>${r.category||"-"}</td><td>${escapeHtml(r.label||"-")}</td><td>${r.type==="Commentaire"?tag("Commentaire","violet"):r.type}</td><td>${escapeHtml(r.note||"-")}</td><td>${r.user}</td></tr>`;
    }).join("")}</tbody></table></div>
    <div class="record-cards mobile-only">${rows.map(r=>{
      const rec = recordById(r.recordId);
      return `<button type="button" class="record-card" data-action="open-record:${r.recordId}:Activité">
        <div class="record-card-head"><strong>${escapeHtml(rec ? rec.name : (r.target || "-"))}</strong><span>${r.date}</span></div>
        <p>${r.type==="Commentaire" ? "Commentaire" : escapeHtml(r.category||r.type||"-")}${r.label ? " — " + escapeHtml(r.label) : ""}</p>
        ${r.note ? `<p>${escapeHtml(r.note)}</p>` : ""}
      </button>`;
    }).join("")}</div>` : emptyState("Aucune interaction enregistrée pour l'instant.", "Ajouter une interaction", "add-interaction")}
  </section>`;
}

function linkagesView() {
  return `<section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Ajouter une liaison", "add-linkage", "primary-btn")} ${action("Exporter", "export-current")}</div></div>
    ${linkages.length ? `<div class="table-wrap"><table><thead><tr><th>Contact A</th><th>Rôle A</th><th>Contact / structure B</th><th>Rôle B</th><th>Type de liaison</th></tr></thead><tbody>${linkages.map(r=>`<tr><td>${escapeHtml(r.a)}</td><td>${r.roleA}</td><td>${escapeHtml(r.b)}</td><td>${r.roleB}</td><td>${r.type}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Aucune liaison enregistrée (lien familial, professionnel...).", "Ajouter une liaison", "add-linkage")}
  </section>`;
}

function panelList(title, rows, btnLabel, btnAction) {
  return `<section class="panel pad"><div class="toolbar"><h2>${title}</h2>${action(btnLabel, btnAction, "primary-btn")}</div>${rows.length ? `<div class="timeline">${rows.map(([label, key])=>`<button class="timeline-item" type="button" data-action="${key}"><strong>${label}</strong></button>`).join("")}</div>` : emptyState("Rien à afficher pour l'instant.")}</section>`;
}

function paymentTable(type = null) {
  const rows = filteredPayments(type);
  const { visible, remaining } = visiblePage(rows, "paymentsPage");
  const loadMore = remaining ? `<button type="button" class="load-more" data-action="load-more-payments">Afficher ${Math.min(remaining, PAGE_STEP)} de plus (${remaining.toLocaleString("fr-FR")} restants)</button>` : "";
  return `<section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Ajouter un paiement", `add-payment:${type || "Don"}`, "primary-btn")} ${action("Générer les reçus manquants", "generate-receipts")} ${action("Exporter", "export-current")}</div></div>
    <div class="pay-tabs">${["Tous les paiements","Dons","Adhésions","Billetterie","Reçus"].map(s => `<button class="${state.section===s ? "active" : ""}" data-view="pay" data-section="${s}">${s}</button>`).join("")}</div>
    ${rows.length ? `<p class="muted-note">${rows.length.toLocaleString("fr-FR")} paiement(s)${state.query ? " correspondant à la recherche" : ""}.</p>
    <div class="table-wrap desktop-only"><table><thead><tr><th>Date</th><th>Nom</th><th>Montant</th><th>Type</th><th>Occasion</th><th>Statut</th><th>Moyen</th><th>Reçu</th></tr></thead>
    <tbody>${visible.map(p => `<tr class="row-click" data-action="open-record:${p.recordId}:Paiements"><td>${p.date}</td><td>${escapeHtml(p.payer)}</td><td>${euro(p.amount)}</td><td>${p.type}</td><td>${(p.occasion||[]).map(o=>tag(o,"violet")).join(" ") || "-"}</td><td>${status(p.status)}</td><td>${p.method}</td><td>${status(p.receipt)}</td></tr>`).join("")}</tbody></table>${loadMore}</div>
    <div class="record-cards mobile-only">${visible.map(p => `<button type="button" class="record-card" data-action="open-record:${p.recordId}:Paiements">
      <div class="record-card-head"><strong>${escapeHtml(p.payer)}</strong><span class="money-cell">${euro(p.amount)}</span></div>
      <p>${escapeHtml(p.type)} · ${p.date} · ${escapeHtml(p.method || "-")}</p>
      <div class="chip-list">${status(p.status)} ${status(p.receipt)} ${(p.occasion||[]).map(o=>tag(o,"violet")).join(" ")}</div>
    </button>`).join("")}${loadMore}</div>` : emptyState("Aucun paiement enregistré pour l'instant.", "Ajouter un don", "add-payment:Don")}
  </section>`;
}

function paymentsView() {
  const map = { Dons: "Don", Adhésions: "Adhésion", Billetterie: "Billetterie" };
  if (state.section === "Reçus") return receipts();
  return paymentTable(map[state.section]);
}

function receipts() {
  const rows = payments.filter(p => p.type === "Don" || p.type === "Adhésion");
  const { visible, remaining } = visiblePage(rows, "paymentsPage");
  const loadMore = remaining ? `<button type="button" class="load-more" data-action="load-more-payments">Afficher ${Math.min(remaining, PAGE_STEP)} de plus (${remaining.toLocaleString("fr-FR")} restants)</button>` : "";
  return `<div class="split"><section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Générer les reçus manquants", "generate-receipts", "primary-btn")} ${action("Exporter", "export-current")}</div></div>
    ${rows.length ? `<p class="muted-note">${rows.length.toLocaleString("fr-FR")} don(s)/adhésion(s).</p><div class="table-wrap"><table><thead><tr><th>Reçu</th><th>Payeur</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${visible.map((p,i)=>`<tr class="row-click" data-action="open-record:${p.recordId}:Paiements"><td>${p.receipt==="Genere"||p.receipt==="Généré"||p.receipt==="Disponible" ? `RF-${new Date().getFullYear()}-${1000+i}` : "-"}</td><td>${escapeHtml(p.payer)}</td><td>${euro(p.amount)}</td><td>${status(p.receipt)}</td></tr>`).join("")}</tbody></table>${loadMore}</div>` : emptyState("Aucun don ou adhésion pour l'instant.")}
    </section><section class="panel pad"><span class="eyebrow">Modèles de reçus</span><h2>Configuration fiscale</h2><div class="timeline">${receiptTemplates.map(t => `<div class="timeline-item"><strong>${t.name}</strong><p>${t.entity} — ${t.mode} — Signature ${t.signature}</p></div>`).join("")}</div>${action("Ajouter un modèle", "add-receipt-template")}</section></div>`;
}

function importsView() {
  return `<section class="panel"><div class="toolbar"><h2>Historique des imports</h2>${action("Nouvel import", "import-new", "primary-btn")}</div>
    ${imports.length ? `<div class="table-wrap"><table><thead><tr><th>Statut</th><th>Date</th><th>Fichier</th><th>Lignes</th><th>Créés</th><th>Mis à jour</th><th>Doublons</th><th>Erreurs</th></tr></thead><tbody>${imports.map((r)=>`<tr><td>${status(r.status)}</td><td>${r.date}</td><td><strong>${escapeHtml(r.file)}</strong></td><td>${Number(r.rows).toLocaleString("fr-FR")}</td><td>${Number(r.created).toLocaleString("fr-FR")}</td><td>${Number(r.updated).toLocaleString("fr-FR")}</td><td>${Number(r.duplicates).toLocaleString("fr-FR")}</td><td>${Number(r.errors).toLocaleString("fr-FR")}</td></tr>`).join("")}</tbody></table></div>` : emptyState("Aucun import pour l'instant.", "Importer un fichier", "import-new")}
  </section>`;
}

function appsView() {
  return `<section class="panel pad">
    <div class="toolbar clean"><div><span class="eyebrow">À venir</span><h2>Connexions externes</h2><p>Ces connexions ne sont pas encore actives : aucune donnée n'est synchronisée automatiquement pour l'instant.</p></div></div>
    <div class="integration-grid">${apps.map(a=>`<div class="integration"><header><strong>${a[0]}</strong><span class="tag">Bientôt</span></header><p>${a[1]}</p>${action("Être prévenu", `notify-app:${a[0]}`)}</div>`).join("")}</div>
  </section>`;
}

function stats() {
  const contacts = records.filter(r => r.kind === "Contact").length;
  const structures = records.filter(r => r.kind === "Structure").length;
  const totalDons = payments.filter(p => p.type === "Don").reduce((s,p)=>s+Number(p.amount||0),0);
  const byMonth = {};
  payments.forEach(p => {
    const m = (p.at || "").slice(0, 7);
    if (!m) return;
    byMonth[m] = (byMonth[m] || 0) + Number(p.amount || 0);
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  const maxVal = Math.max(1, ...months.map(m => byMonth[m]));
  return `<div class="hero-grid">
    <section class="panel pad">
      <span class="eyebrow">Vue d'ensemble</span><h2>Chiffres réels</h2>
      <div class="metric-grid">${metric("Contacts", contacts, "Fiches individuelles")}${metric("Structures", structures, "Personnes morales")}${metric("Dons enregistrés dans le CRM", euro(totalDons), "Depuis l'utilisation du CRM")}${metric("Interactions", interactions.length, "Journalisées dans le CRM")}</div>
      ${months.length ? `<div class="bar-chart">${months.map(m => `<div class="bar" style="height:${Math.max(6, Math.round(byMonth[m]/maxVal*100))}%"><span>${m}</span></div>`).join("")}</div>` : emptyState("Pas encore de dons datés à afficher sous forme de graphique. Il apparaîtra dès les premiers dons enregistrés.")}
    </section>
    <section class="panel pad"><span class="eyebrow">Segments</span><h2>Répartition</h2>${segmentsSummary()}</section>
  </div>`;
}

function segmentsSummary() {
  const counts = {};
  records.forEach(r => (r.tags || []).forEach(t => { counts[t] = (counts[t] || 0) + 1; }));
  const top = Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return top.length ? `<div class="chip-list">${top.map(([t,c])=>tag(`${t} (${c})`, "blue")).join("")}</div>` : emptyState("Aucune étiquette utilisée pour l'instant.");
}

function settingsView() {
  if (state.section === "Reçus") return receipts();
  if (state.section === "Catégories d'interaction") return categoriesView();
  return `<div class="split"><section class="panel"><div class="toolbar"><h2>Champs personnalisés</h2>${action("Créer un champ", "add-field", "primary-btn")}</div>
    <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Valeur(s)</th><th>Obligatoire ?</th><th>Profils</th></tr></thead><tbody>${customFields.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.type}</td><td>${escapeHtml(r.values)}</td><td>${r.required}</td><td>${r.profile}</td></tr>`).join("")}</tbody></table></div></section>
    <div class="stacked-panels">
      <section class="panel pad"><span class="eyebrow">Configuration Sinaï</span><h2>Réglages</h2><div class="timeline">
        <button class="timeline-item" type="button" data-action="add-receipt-template"><strong>Reçus fiscaux</strong><p>Modèles, signatures, entités émettrices.</p></button>
        <button class="timeline-item" type="button" data-view="settings" data-section="Catégories d'interaction"><strong>Catégories d'interaction</strong><p>Ajouter, renommer ou supprimer les libellés (ex : Chiour).</p></button>
      </div></section>
      ${notifSettingsPanel()}
    </div></div>`;
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
        <button type="button" class="icon-btn" data-action="delete-category:${i}" title="Supprimer">✕</button>
      </div>`).join("")}</div>
    ${action("Ajouter une catégorie", "add-category", "primary-btn")}
    </section>
    <section class="panel pad"><span class="eyebrow">Astuce</span><h2>Vision claire</h2><p>Renommer une catégorie met à jour toutes les interactions déjà enregistrées avec ce libellé. La supprimer ne touche pas l'historique : les interactions gardent leur libellé texte, seule la liste de choix change.</p></section>
    </div>`;
}

function admin() {
  if (state.section === "Journal d'activité") return auditView();
  if (!currentAccount || currentAccount.profile !== "Administrateur") {
    return emptyState("La gestion des comptes est réservée aux administrateurs.");
  }
  const scopeLabel = (a) => a.scopeMode === "tags"
    ? ((a.scopeTags || []).length ? (a.scopeTags || []).map(t => `<span class="tag" title="${escapeHtml(scopeTagLabel(t))}">${escapeHtml(t)}</span>`).join(" ") : "Aucune catégorie choisie")
    : "Tous les contacts";
  const tableView = `<div class="table-wrap desktop-only"><table><thead><tr><th>Compte</th><th>Profil</th><th>Accès aux contacts</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${accounts.map(a => `<tr>
        <td class="name-cell"><strong>${escapeHtml(`${a.first || ""} ${a.last || ""}`.trim() || a.email)}</strong><span>${escapeHtml(a.email)}</span></td>
        <td>${a.profile}</td>
        <td>${scopeLabel(a)}</td>
        <td>${a.lastLogin ? new Date(a.lastLogin).toLocaleString("fr-FR") : "Jamais connecté"}</td>
        <td class="row-actions"><button type="button" class="icon-btn" data-action="edit-account:${a.id}" title="Modifier">✎</button>${a.id !== currentAccount.id ? `<button type="button" class="icon-btn" data-action="delete-account:${a.id}" title="Supprimer">✕</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>
    <div class="record-cards mobile-only">${accounts.map(a => `<div class="record-card">
        <div class="record-card-head"><strong>${escapeHtml(`${a.first || ""} ${a.last || ""}`.trim() || a.email)}</strong><span>${a.profile}</span></div>
        <p>${escapeHtml(a.email)}</p>
        <p>${scopeLabel(a)}</p>
        <div class="row-actions"><button type="button" data-action="edit-account:${a.id}">Modifier</button>${a.id !== currentAccount.id ? `<button type="button" data-action="delete-account:${a.id}">Supprimer</button>` : ""}</div>
      </div>`).join("")}</div>`;
  return `<section class="panel"><div class="toolbar"><h2>Comptes</h2>${action("Ajouter un compte", "add-user", "primary-btn")}</div>
    <p class="muted-note">Chaque personne se connecte avec son propre email et mot de passe. L'accès aux contacts peut être limité par catégorie (étiquette ou segment).</p>
    ${accounts.length ? tableView : emptyState("Aucun compte pour l'instant.", "Ajouter un compte", "add-user")}
  </section>`;
}

function auditView() {
  return `<section class="panel pad"><h2>Journal d'activité</h2>${auditLog.length ? `<div class="timeline">${auditLog.map(a=>`<div class="timeline-item"><strong>${a.date}</strong><p>${escapeHtml(a.text)} — ${escapeHtml(a.user)}</p></div>`).join("")}</div>` : emptyState("Aucune activité enregistrée pour l'instant.")}</section>`;
}

function render() {
  rebuildIndexes();
  closeFabMenu();
  setHeader();
  renderNav();
  const views = { home, stats, crm, pay: paymentsView, imports: importsView, apps: appsView, settings: settingsView, admin };
  content().innerHTML = (views[state.view] || home)();
  renderDrawer();
  bind();
  syncBottomNav();
}

/* ---------- 7. Fiche détail ------------------------------------------- */

function recordDetail(r) {
  const tabs = ["Details", "Activité", "Tâches", "Paiements", "Categorisation", "Relations"];
  const initial = r.kind === "Structure" ? "ST" : (r.first?.[0] || r.name?.[0] || "C");
  return `<aside class="panel detail-card">
    <div class="detail-head"><div class="avatar">${escapeHtml(initial)}</div><div><span class="eyebrow">${r.kind}</span><h2>${escapeHtml(r.name)}</h2><p>${r.id}</p></div><button class="icon-btn detail-close" type="button" data-action="close-detail" title="Fermer et voir toute la liste">✕</button></div>
    <div class="detail-kpis">
      <div><strong>${euro(recordTotalAmount(r))}</strong><span>Total</span></div>
      <div><strong>${recordPaymentsCount(r)}</strong><span>Paiements</span></div>
      <div><strong>${recordInteractionsCount(r)}</strong><span>Interactions</span></div>
    </div>
    <div class="quick-actions">
      ${action("+ Interaction", `quick-interaction:${r.id}`)}
      ${action("+ Don", `quick-payment:${r.id}`)}
      ${action("+ Tâche", `quick-task:${r.id}`)}
      ${action("+ Commentaire", `quick-comment:${r.id}`)}
      ${action(isInMyPortfolio(r) ? "★ Dans mon portefeuille" : "+ Ajouter à mon portefeuille", `toggle-portfolio:${r.id}`)}
    </div>
    <div class="tabs">${tabs.map(t => `<button class="tab-btn ${state.tab === t ? "active" : ""}" data-tab="${t}">${t === "Categorisation" ? "Détails +" : t}</button>`).join("")}</div>
    <div class="detail-body">${recordDetailBody(r)}
    <div class="row-actions detail-actions">${action("Modifier toute la fiche", "edit-record", "primary-btn")} ${action("Supprimer", "delete-record")}</div></div>
  </aside>`;
}

function recordDetailBody(r) {
  if (state.tab === "Activité") {
    const feed = recordLiveInteractions(r.id);
    const importedNote = r.importedInteractionsCount ? `<p class="muted-note">+ ${r.importedInteractionsCount} interaction(s) historiques importées avant le CRM.</p>` : "";
    const addBtn = `<div class="row-actions tab-actions">${action("+ Ajouter une interaction", `quick-interaction:${r.id}`, "primary-btn")}</div>`;
    return `${addBtn}${importedNote}${feed.length ? `<div class="timeline">${feed.map(i => `<div class="timeline-item"><strong>${i.type === "Commentaire" ? "Commentaire" : i.type}${i.label ? " — " + escapeHtml(i.label) : ""}</strong>${i.note ? `<p>${escapeHtml(i.note)}</p>` : ""}<span class="timeline-date">${i.date} · ${escapeHtml(i.user)}</span></div>`).join("")}</div>` : emptyState("Aucune interaction ou commentaire enregistré pour l'instant.")}`;
  }
  if (state.tab === "Tâches") {
    const recTasks = tasks.filter(t => t.recordId === r.id).sort((a, b) => (a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1);
    const openTasks = recTasks.filter(t => t.status !== "fait");
    const doneTasks = recTasks.filter(t => t.status === "fait");
    const addBtn = `<div class="row-actions tab-actions">${action("+ Ajouter une tâche", `quick-task:${r.id}`, "primary-btn")}</div>`;
    return `${addBtn}${recTasks.length ? `<div class="hp-task-list">${openTasks.map(t => hpTaskRow(t)).join("")}${doneTasks.map(t => hpTaskRow(t)).join("")}</div>` : emptyState("Aucune tâche pour cette fiche pour l'instant.")}`;
  }
  if (state.tab === "Paiements") {
    const feed = recordLivePayments(r.id);
    const importedNote = r.importedAmount ? `<p class="muted-note">+ ${euro(r.importedAmount)} sur ${r.importedPaymentsCount || 0} paiement(s) historiques importés avant le CRM.</p>` : "";
    // Chaque don/paiement peut être modifié (ex : passer une "Promesse" en
    // "Validé" une fois l'argent effectivement reçu) ou supprimé, directement
    // depuis cette liste — jusqu'ici impossible une fois le paiement ajouté.
    return `${importedNote}${feed.length ? `<div class="timeline">${feed.map(p => paymentTimelineItem(p)).join("")}</div>` : emptyState("Aucun don enregistré pour l'instant.")}`;
  }
  if (state.tab === "Categorisation") {
    const body = [["Étiquettes", (r.tags||[]).join(", ") || "-"], ["Segments", (r.segments||[]).join(", ") || "-"], ["Groupes", (r.groups||[]).join(", ") || "-"], ["Source", r.source || "-"], ["Adresse", r.address || "-"], ["Ville", r.city || "-"], ["Code postal", r.zip || "-"], ["Pays", r.country || "-"]];
    return `<div class="field-grid">${body.map(([k,v]) => `<div class="field"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>`;
  }
  if (state.tab === "Relations") {
    const links = linkages.filter(l => l.a === r.name || l.b === r.name);
    const body = [["Rôle de foyer", r.role || "-"], ["Type de foyer", r.householdType || "-"], ["Statut parent", r.parentStatus || "-"], ["Statut enfant", r.childStatus || "-"], ["Profession", r.profession || "-"], ["École actuelle", r.school || "-"], ["Famille", r.family || "-"]];
    return `<div class="field-grid">${body.map(([k,v]) => `<div class="field"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>${links.length ? `<div class="timeline">${links.map(l=>`<div class="timeline-item"><strong>${escapeHtml(l.a)} ↔ ${escapeHtml(l.b)}</strong><p>${l.type}</p></div>`).join("")}</div>` : ""}${action("Ajouter une liaison", `add-linkage:${r.id}`)}`;
  }
  const body = [["Civilité", r.civility || "-"], ["Nom", r.name], ["Email", r.email || "-"], ["Email secondaire", r.secondaryEmails || "-"], ["Téléphone", r.phone || "-"], ["Téléphone 2", r.phone2 || "-"], ["Adresse", r.address || "-"], ["Ville", r.city || "-"], ["Date de naissance", r.dob || "-"], ["SIREN", r.siren || "-"], ["Forme juridique", r.legal || "-"], ["Commentaire", r.comment || "-"]];
  return `<div class="field-grid">${body.map(([k,v]) => `<div class="field"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>`;
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

// Barre de navigation mobile (bas d'écran) : 2 destinations de chaque côté du
// bouton menu (☰), qui ouvre le même tiroir de navigation complet que sur
// desktop. On surligne la destination active sans reconstruire le DOM (les
// boutons sont statiques dans index.html, jamais recréés par render()).
function bottomNavKey() {
  if (state.view === "home") return "home";
  if (state.view === "pay") return "payments";
  if (state.view === "crm" && state.section === "Interactions") return "interactions";
  if (state.view === "crm") return "contacts";
  return "";
}
function syncBottomNav() {
  const activeKey = bottomNavKey();
  document.querySelectorAll(".bnav-btn[data-bnav]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.bnav === activeKey);
  });
  document.querySelector("#bnavMenu")?.classList.toggle("active", !!state.navOpen);
}

// Menu rapide du bouton "+" flottant : accessible depuis n'importe quel écran
// (pas seulement depuis la fiche d'un contact), pour répondre au besoin de
// pouvoir logger une interaction "en direct, rapide" sans naviguer.
function buildFabMenu() {
  const menu = document.querySelector("#fabMenu");
  if (!menu) return;
  menu.innerHTML = `
    <button type="button" data-fab-open="interaction">Interaction</button>
    <button type="button" data-fab-open="payment">Don / paiement</button>
    <button type="button" data-fab-open="comment">Commentaire</button>
    <button type="button" data-fab-open="contact">Nouveau contact</button>
    <button type="button" data-fab-open="structure">Nouvelle structure</button>
  `;
  menu.querySelectorAll("[data-fab-open]").forEach(btn => btn.addEventListener("click", () => { closeFabMenu(); openModal(btn.dataset.fabOpen); }));
  document.querySelector("#fabScrim")?.addEventListener("click", closeFabMenu);
}
function openFabMenu() {
  document.querySelector("#fabMenu")?.classList.add("open");
  document.querySelector("#fabScrim")?.classList.add("show");
}
function closeFabMenu() {
  document.querySelector("#fabMenu")?.classList.remove("open");
  document.querySelector("#fabScrim")?.classList.remove("show");
}
function toggleFabMenu() {
  if (document.querySelector("#fabMenu")?.classList.contains("open")) closeFabMenu(); else openFabMenu();
}

// Libellés/catégories d'interaction personnalisables (Paramètres > Catégories).
function addInteractionCategory() {
  const name = (window.prompt("Nom de la nouvelle catégorie (ex : Chiour)") || "").trim();
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
function deleteInteractionCategory(index) {
  const name = interactionCategories[index];
  if (!name) return;
  if (interactionCategories.length <= 1) { notify("Il doit rester au moins une catégorie"); return; }
  const used = interactions.filter(i => i.category === name).length;
  if (used && !window.confirm(`${used} interaction(s) utilisent "${name}". La supprimer quand même ? Ces interactions garderont ce libellé en texte.`)) return;
  interactionCategories.splice(index, 1);
  logAudit(`Catégorie d'interaction supprimée : ${name}.`);
  saveCrmData();
  render();
}

function renderDrawer() {
  if (!state.drawer) { drawerEl().className = "drawer"; drawerEl().innerHTML = ""; return; }
  drawerEl().className = "drawer open";
  const views = {
    actions: `<h2>Actions</h2>${action("Exporter la vue", "export-current", "primary-btn")}${action("Détecter les doublons", "dedupe")}${action("Fermer", "close-drawer")}`,
    dedupe: `<h2>Doublons potentiels</h2><p>Fiches partageant le même email ou téléphone.</p>${duplicatesList()}${action("Fermer", "close-drawer")}`,
  };
  drawerEl().innerHTML = `<button class="drawer-close" type="button" data-action="close-drawer">✕</button>${views[state.drawer] || ""}`;
}

function duplicatesList() {
  const byEmail = {};
  records.forEach(r => { if (r.email) { const k = r.email.toLowerCase().trim(); (byEmail[k] = byEmail[k] || []).push(r); } });
  const dups = Object.values(byEmail).filter(list => list.length > 1);
  if (!dups.length) return emptyState("Aucun doublon d'email détecté.");
  return `<div class="timeline">${dups.map(list => `<div class="timeline-item"><strong>${escapeHtml(list[0].email)}</strong><p>${list.map(r=>escapeHtml(r.name)).join(" · ")}</p></div>`).join("")}</div>`;
}

function bind() {
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => {
    state.view = el.dataset.view;
    state.section = el.dataset.section || titles[state.view][0];
    state.query = "";
    state.drawer = null;
    state.showDetail = true;
    state.mobileDetailOpen = false;
    closeNav();
    render();
  }));
  document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => handleAction(el.dataset.action)));
  document.querySelectorAll("[data-record]").forEach(el => el.addEventListener("click", () => { state.selectedRecord = el.dataset.record; state.showDetail = true; state.mobileDetailOpen = true; state.tab = "Details"; render(); scrollToTop(); }));
  document.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => { state.tab = el.dataset.tab; render(); }));
  document.querySelectorAll("[data-category-index]").forEach(el => {
    el.addEventListener("change", () => { renameInteractionCategory(Number(el.dataset.categoryIndex), el.value); render(); });
  });
  document.querySelector("#hpTaskForm")?.addEventListener("submit", e => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    addHomeTask(data.get("title"), data.get("dueDate"), data.get("recordId"));
  });
  (() => {
    const titleInput = document.querySelector("#hpTaskTitle");
    const suggestBox = document.querySelector("#hpTaskSuggest");
    const recordIdInput = document.querySelector("#hpTaskRecordId");
    const linkedBox = document.querySelector("#hpTaskLinked");
    const linkedName = document.querySelector("#hpTaskLinkedName");
    const unlinkBtn = document.querySelector("#hpTaskUnlink");
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
    if (el.checked) {
      if (typeof Notification === "undefined") { notify("Notifications non prises en charge par ce navigateur"); el.checked = false; return; }
      let perm = Notification.permission;
      if (perm === "default") { try { perm = await Notification.requestPermission(); } catch { perm = "denied"; } }
      if (perm !== "granted") { notify("Autorisation refusée dans le navigateur"); el.checked = false; render(); return; }
    }
    notifPrefs.enabled = el.checked;
    if (el.checked) notifPrefs.lastFired = "";
    saveNotifPrefs();
    notify(notifPrefs.enabled ? "Rappels activés sur cet appareil" : "Rappels désactivés sur cet appareil");
  });
  document.querySelector("#notifTimeInput")?.addEventListener("change", (e) => {
    notifPrefs.time = e.target.value || "09:00";
    notifPrefs.lastFired = "";
    saveNotifPrefs();
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
}

function navigate(view, section) {
  state.view = view;
  state.section = section;
  state.query = "";
  state.drawer = null;
  state.showDetail = true;
  // Par défaut, une navigation "générale" (menu, "Voir les interactions"...)
  // n'ouvre pas explicitement une fiche précise sur mobile ; open-record
  // remet ce drapeau à true juste après avoir appelé navigate().
  state.mobileDetailOpen = false;
  state.recordsPage = PAGE_STEP;
  state.paymentsPage = PAGE_STEP;
  render();
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

function handleAction(key) {
  if (!key) return;
  // "open-record:<id>" ouvre la fiche sur l'onglet Détails ; "open-record:<id>:<Onglet>"
  // ouvre directement sur l'onglet pertinent (ex : un clic sur un don ouvre la fiche
  // sur "Paiements", un clic sur une interaction l'ouvre sur "Activité") pour qu'on
  // retrouve tout de suite ce qu'on est venu voir, et qu'on puisse le suivre / le
  // mettre à jour sans re-naviguer soi-même dans les onglets.
  if (key.startsWith("open-record:")) {
    const [, id, tab] = key.split(":");
    if (recordById(id)) {
      navigate("crm", recordById(id).kind === "Structure" ? "Structures" : "Contacts");
      state.selectedRecord = id;
      state.showDetail = true;
      state.mobileDetailOpen = true;
      state.tab = tab || "Details";
      render();
      scrollToTop();
    }
    return;
  }
  if (key.startsWith("quick-interaction:")) return openQuickForRecord(key.split(":")[1], "interaction");
  if (key.startsWith("quick-payment:")) return openQuickForRecord(key.split(":")[1], "payment");
  if (key.startsWith("quick-comment:")) return openQuickForRecord(key.split(":")[1], "comment");
  if (key.startsWith("quick-task:")) return openQuickForRecord(key.split(":")[1], "task");
  if (key.startsWith("add-payment:")) return openModal("payment", { type: key.split(":")[1] || "Don" });
  if (key.startsWith("add-linkage:")) return openModal("linkage", { recordId: key.split(":")[1] });
  if (key.startsWith("apply-segment:")) { state.query = key.split(":")[1]; navigate("crm", "Contacts"); return; }
  if (key.startsWith("notify-app:")) return notify(`Nous vous préviendrons pour ${key.split(":")[1]} dès que la connexion sera disponible.`);
  if (key.startsWith("delete-category:")) return deleteInteractionCategory(Number(key.split(":")[1]));
  if (key.startsWith("edit-account:")) { const acc = accounts.find(a => a.id === key.split(":")[1]); if (acc) openModal("account", { existing: acc }); return; }
  if (key.startsWith("delete-account:")) return deleteAccount(key.split(":")[1]);
  if (key.startsWith("toggle-task:")) return toggleTaskDone(key.split(":")[1]);
  if (key.startsWith("edit-task:")) return openEditTask(key.split(":")[1]);
  if (key.startsWith("delete-task:")) return deleteHomeTask(key.split(":")[1]);
  if (key.startsWith("edit-payment:")) return openEditPayment(key.split(":")[1]);
  if (key.startsWith("delete-payment:")) return deletePayment(key.split(":")[1]);
  if (key.startsWith("add-installment:")) return openAddInstallment(key.split(":")[1]);
  if (key.startsWith("holiday-prepare:")) return openHolidayModal(key.split(":")[1]);
  if (key.startsWith("portfolio-touch:")) return openPortfolioTouch(key.split(":")[1]);
  if (key.startsWith("toggle-portfolio:")) return togglePortfolio(key.split(":")[1]);
  if (key === "add-to-portfolio") return openAddToPortfolioModal();
  if (key === "toggle-done-tasks") { state.showDoneTasks = !state.showDoneTasks; render(); return; }

  const actions = {
    "add-contact": () => openModal("contact"),
    "add-structure": () => openModal("structure"),
    "add-user": () => openModal("account"),
    "add-field": () => openModal("field"),
    "add-group": () => openModal("group"),
    "add-interaction": () => openModal("interaction"),
    "add-payment": () => openModal("payment"),
    "add-comment": () => openModal("comment"),
    "add-linkage": () => openModal("linkage"),
    "add-receipt-template": () => openModal("receiptTemplate"),
    "add-category": () => addInteractionCategory(),
    "import-new": () => openImportModal(),
    "export-current": () => downloadCsv(`export-${state.view}-${todayStr().replace(/\//g,"-")}.csv`, currentRows()),
    "reset-filters": () => { state.query = ""; state.recordsPage = PAGE_STEP; state.paymentsPage = PAGE_STEP; render(); },
    "load-more-records": () => { state.recordsPage += PAGE_STEP; render(); },
    "load-more-payments": () => { state.paymentsPage += PAGE_STEP; render(); },
    "open-actions": () => { state.drawer = "actions"; render(); },
    "close-drawer": () => { state.drawer = null; render(); },
    "dedupe": () => { state.drawer = "dedupe"; render(); },
    "generate-receipts": () => { let n = 0; payments.forEach(p => { if (p.receipt === "A generer" || p.receipt === "À générer") { p.receipt = "Généré"; n += 1; } }); if (n) { logAudit(`${n} reçu(s) généré(s).`); saveCrmData(); } notify(n ? `${n} reçu(s) généré(s)` : "Aucun reçu en attente"); render(); },
    "edit-record": () => openModal("editRecord"),
    "delete-record": () => deleteSelectedRecord(),
    "close-detail": () => { state.showDetail = false; state.mobileDetailOpen = false; render(); },
    "open-detail": () => { state.showDetail = true; state.mobileDetailOpen = true; render(); scrollToTop(); },
    "goto-receipts": () => navigate("pay", "Reçus"),
    "goto-interactions": () => navigate("crm", "Interactions"),
    "goto-contacts": () => navigate("crm", "Contacts"),
    "goto-audit": () => navigate("admin", "Journal d'activité"),
  };
  (actions[key] || (() => notify("Fonctionnalité à venir")))();
}

function modalShell(kind, eyebrow, title, body, submit = "Enregistrer") {
  const d = dialog();
  if (d.open) d.close();
  d.className = kind === "editRecord" ? "wide-dialog" : "";
  dialogContent().innerHTML = `<form class="modal" data-form="${kind}">
    <header><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">✕</button></header>
    <div class="form-grid">${body}</div>
    <footer><button type="button" data-modal-close>Annuler</button><button class="primary-btn" type="submit">${submit}</button></footer>
  </form>`;
  d.showModal();
  dialogContent().querySelector("form").addEventListener("submit", submitForm);
  dialogContent().querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => d.close()));
  wirePickers(dialogContent());
  wireCategoryAdders(dialogContent());
  // Boutons "Copier" des modèles de message (stratégie des fêtes, et tout
  // futur champ en lecture seule à copier-coller ailleurs).
  dialogContent().querySelectorAll("[data-copy-target]").forEach(btn => {
    btn.addEventListener("click", () => {
      const target = dialogContent().querySelector(`#${btn.dataset.copyTarget}`);
      if (target) copyFieldValue(target);
    });
  });
  // Une "Promesse" (don pas encore reçu) doit se voir proposer un statut
  // "En attente" par défaut plutôt que "Validé".
  const typeSelect = dialogContent().querySelector('select[name="type"]');
  const statusSelect = dialogContent().querySelector('select[name="status"]');
  if (typeSelect && statusSelect) {
    typeSelect.addEventListener("change", () => {
      if (typeSelect.value === "Promesse") statusSelect.value = "En attente";
    });
  }
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
  dialogContent().querySelector("input:not([readonly]), select, textarea")?.focus();
}

function contactLockedField(r) {
  return `<label class="span-2">Contact / structure<input type="text" value="${escapeHtml(r.name)}" readonly class="field-locked"><input type="hidden" name="recordId" value="${r.id}"></label>`;
}
function openQuickForRecord(recordId, kind) {
  const r = recordById(recordId);
  if (!r) return notify("Fiche introuvable");
  if (kind === "payment") return modalShell("payment", "Don pour " + r.name, "Ajouter un don / paiement",
    `${contactLockedField(r)}
     ${selectField("Type", "type", ["Don","Promesse","Adhésion","Billetterie"], "Don")}
     ${selectField("Paiement échelonné (plusieurs versements)", "installmentPlan", ["Non","Oui"], "Non")}
     ${field("Montant total (€)", "amount", "", "number", "min='0' step='1' required")}
     ${installmentFormSection(null)}
     ${selectField("Moyen", "method", ["CB","Chèque","Virement","SEPA","Espèces"], "CB")}
     ${selectField("Statut", "status", ["Validé","En attente"], "Validé")}
     ${field("Occasion", "occasion", "", "text", "placeholder='Bar Mitzvah, Pessah, Anniversaire…'")}`);
  if (kind === "interaction") return modalShell("interaction", "Interaction avec " + r.name, "Ajouter une interaction",
    `${contactLockedField(r)}
     ${field("Date", "date", todayIso(), "date", "required")}
     ${categoryField(interactionCategories[0] || "Suivi")}
     ${selectField("Type", "type", ["Email","Appel","Rendez-vous","Note"], "Appel")}
     ${field("Libellé", "label", "", "text", "placeholder='Ex : relance annuelle'")}
     ${textareaField("Détail (optionnel)", "note", "")}`);
  if (kind === "task") return modalShell("task", "Tâche pour " + r.name, "Ajouter une tâche",
    `${contactLockedField(r)}
     ${field("Titre de la tâche", "title", "", "text", "required placeholder='Ex : Relancer pour le renouvellement'")}
     ${field("Échéance", "dueDate", todayIso(), "date")}`, "Ajouter la tâche");
  return modalShell("comment", "Commentaire sur " + r.name, "Ajouter un commentaire",
    `${contactLockedField(r)}
     ${field("Date", "date", todayIso(), "date", "required")}
     ${textareaField("Commentaire", "note", "", "required placeholder='Notez ici une information utile sur ce contact...'")}`, "Ajouter le commentaire");
}

// Modifier un paiement existant : jusqu'ici seul l'ajout d'un nouveau
// paiement était possible, donc corriger une erreur ou faire passer une
// "Promesse" en "Validé" une fois le don reçu n'avait aucune solution.
function openEditPayment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  const r = recordById(p.recordId);
  modalShell("editPayment", "Paiement", `Modifier le paiement de ${p.payer}`,
    `${r ? contactLockedField(r) : ""}
     <input type="hidden" name="paymentId" value="${escapeHtml(p.id)}">
     ${selectField("Type", "type", ensureOption(["Don","Promesse","Adhésion","Billetterie"], p.type), p.type)}
     ${selectField("Paiement échelonné (plusieurs versements)", "installmentPlan", ["Non","Oui"], p.installmentPlan ? "Oui" : "Non")}
     ${field("Montant total (€)", "amount", p.amount, "number", "min='0' step='1' required")}
     ${installmentFormSection(p)}
     ${selectField("Moyen", "method", ensureOption(["CB","Chèque","Virement","SEPA","Espèces"], p.method), p.method)}
     ${selectField("Statut", "status", ensureOption(["Validé","En attente"], p.status), p.status)}
     ${selectField("Reçu", "receipt", ensureOption(["Non éligible","À générer","Généré","Généré ailleurs"], p.receipt), p.receipt)}
     ${field("Occasion", "occasion", (p.occasion || []).join(", "))}`, "Enregistrer");
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
    ${field("Montant reçu (€)", "newInstallmentAmount", "", "number", "min='0' step='1'")}
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
  logAudit(`Versement de ${euro(montant)} (${data.newInstallmentMethod || p.method}) ajouté pour ${p.payer} — ${p.type}.`);
  if (paymentRemaining(p) <= 0) p.status = "Validé";
}
function paymentTimelineItem(p) {
  return `<div class="timeline-item"><strong>${euro(p.amount)} — ${p.type}</strong><p>${p.method} · ${status(p.status)} · Reçu : ${status(p.receipt)}</p>${(p.occasion||[]).length ? `<div class="chip-list">${p.occasion.map(o=>tag(o,"violet")).join(" ")}</div>` : ""}<span class="timeline-date">${p.date}</span>${installmentBlock(p)}<div class="row-actions payment-actions">${action("Modifier", `edit-payment:${p.id}`)}${action("Supprimer", `delete-payment:${p.id}`)}</div></div>`;
}
function openAddInstallment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  modalShell("addInstallment", "Versement", `Ajouter un versement — ${p.payer}`,
    `<input type="hidden" name="paymentId" value="${escapeHtml(p.id)}">
     <p class="muted-note">Reste à payer avant ce versement : ${euro(paymentRemaining(p))}</p>
     ${field("Montant reçu (€)", "amount", "", "number", "min='0' step='1' required")}
     ${selectField("Moyen", "method", ["CB","Chèque","Virement","SEPA","Espèces"], p.method || "CB")}
     ${field("Date", "date", todayIso(), "date", "required")}`, "Ajouter le versement");
}
function deletePayment(id) {
  const p = payments.find(item => item.id === id);
  if (!p) return notify("Paiement introuvable");
  const ok = window.confirm(`Supprimer définitivement ce paiement de ${euro(p.amount)} (${p.type}) pour ${p.payer} ?\nCette action est irréversible.`);
  if (!ok) return;
  payments.splice(payments.indexOf(p), 1);
  logAudit(`Paiement supprimé : ${p.type} de ${euro(p.amount)} pour ${p.payer}.`);
  saveCrmData();
  render();
  notify("Paiement supprimé");
}

function openModal(kind, options = {}) {
  const structOptions = records.filter(r => r.kind === "Structure");
  const contactOptions = records.filter(r => r.kind === "Contact");
  const selected = records.find(r => r.id === state.selectedRecord) || records[0];
  const modals = {
    contact: () => modalShell("contact", "Contact", "Ajouter un contact",
      `${selectField("Civilité", "civility", ["","Mme","M.","Famille"], "")}
       ${field("Prénom", "first", "", "text", "required placeholder='Prénom'")}
       ${field("Nom", "last", "", "text", "required placeholder='Nom'")}
       ${field("Email", "email", "", "email", "placeholder='email@exemple.fr'")}
       ${field("Téléphone", "phone", "", "tel", "placeholder='06 12 34 56 78'")}
       ${field("Adresse", "address", "", "text", "placeholder='Adresse'")}
       ${field("Famille", "family", "", "text", "placeholder='Nom de famille commun'")}
       ${field("Étiquettes", "tags", "", "text", "placeholder='Parent, Donateur'")}`),
    structure: () => modalShell("structure", "Structure", "Ajouter une structure",
      `${field("Nom", "name", "", "text", "required placeholder='Nom de la structure'")}
       ${field("Email", "email", "", "email", "placeholder='contact@structure.fr'")}
       ${field("Téléphone", "phone", "", "tel")}
       ${field("Adresse", "address", "")}
       ${field("SIREN", "siren", "")}
       ${selectField("Forme juridique", "legal", ["Association","Fondation","SAS","SARL","Autre"], "Association")}
       ${field("Étiquettes", "tags", "", "text", "placeholder='Structure, Partenaire'")}`),
    payment: () => modalShell("payment", "Paiement", "Ajouter un paiement",
      `${pickerField("Payeur", "recordId", selected)}
       ${selectField("Type", "type", ["Don","Promesse","Adhésion","Billetterie"], options.type || "Don")}
       ${selectField("Paiement échelonné (plusieurs versements)", "installmentPlan", ["Non","Oui"], options.type === "Promesse" ? "Oui" : "Non")}
       ${field("Montant total (€)", "amount", "", "number", "min='0' step='1' required")}
       ${installmentFormSection(null)}
       ${selectField("Moyen", "method", ["CB","Chèque","Virement","SEPA","Espèces"], "CB")}
       ${selectField("Statut", "status", ["Validé","En attente"], options.type === "Promesse" ? "En attente" : "Validé")}
       ${field("Occasion", "occasion", "", "text", "placeholder='Bar Mitzvah, Pessah, Anniversaire…'")}`),
    account: () => modalShell("account", "Administration", options.existing ? `Modifier ${options.existing.email}` : "Ajouter un compte",
      accountFormFields(options.existing), options.existing ? "Enregistrer" : "Créer le compte"),
    field: () => modalShell("field", "Paramètres", "Ajouter un champ personnalisé",
      `${field("Nom du champ", "name", "", "text", "required")}${selectField("Type", "type", ["Texte","Date","Montant","Liste","Case à cocher"], "Texte")}${field("Valeurs", "values", "Libre")}${selectField("Obligatoire", "required", ["Oui","Non"], "Non")}`),
    group: () => modalShell("group", "Groupe", "Créer un groupe",
      `${field("Nom du groupe", "name", "", "text", "required")}${selectField("Type", "type", ["Équipe","Famille","Gouvernance","Mécénat","Événement"], "Équipe")}${field("Établissement", "establishment", "Sinaï")}`),
    interaction: () => modalShell("interaction", "Interaction", "Ajouter une interaction",
      `${pickerField("Contact / structure", "recordId", selected)}
       ${field("Date", "date", todayIso(), "date", "required")}
       ${categoryField(interactionCategories[0] || "Suivi")}
       ${selectField("Type", "type", ["Email","Appel","Rendez-vous","Note"], "Email")}
       ${field("Libellé", "label", "")}
       ${textareaField("Détail (optionnel)", "note", "")}`),
    comment: () => modalShell("comment", "Commentaire", "Ajouter un commentaire",
      `${pickerField("Contact / structure", "recordId", selected)}
       ${field("Date", "date", todayIso(), "date", "required")}
       ${textareaField("Commentaire", "note", "", "required placeholder='Notez ici une information utile...'")}`, "Ajouter le commentaire"),
    linkage: () => modalShell("linkage", "Liaison", "Ajouter une liaison",
      `${selectField("Entité A", "a", records.map(r => r.name), selected ? selected.name : "")}${field("Rôle A", "roleA", "Parent")}${selectField("Entité B", "b", records.map(r => r.name), (records[1]||records[0]||{}).name || "")}${field("Rôle B", "roleB", "Parent")}${field("Type de liaison", "type", "Famille")}`),
    receiptTemplate: () => modalShell("receiptTemplate", "Reçus fiscaux", "Ajouter un modèle de reçu",
      `${field("Nom du modèle", "name", "", "text", "required")}${field("Entité émettrice", "entity", "Réseau Sinaï")}${selectField("Mode", "mode", ["Automatique","Validation","Manuel"], "Validation")}${field("Signature", "signature", "Direction")}`),
    editRecord: () => selected.kind === "Structure"
      ? modalShell("editRecord", "Fiche structure", `Modifier ${selected.name}`, `${field("Nom", "name", selected.name, "text", "required")}${field("Email", "email", selected.email || "", "email")}${field("Téléphone", "phone", selected.phone || "")}${field("Adresse", "address", selected.address || "")}${field("SIREN", "siren", selected.siren || "")}${field("Forme juridique", "legal", selected.legal || "")}${field("Étiquettes", "tags", (selected.tags || []).join(", "))}${field("Groupes", "groups", (selected.groups || []).join(", "))}${field("Segments", "segments", (selected.segments || []).join(", "))}`)
      : modalShell("editRecord", "Fiche contact", `Modifier ${selected.name}`, `${selectField("Civilité", "civility", ["","Mme","M.","Famille"], selected.civility || "")}${field("Prénom", "first", selected.first || "")}${field("Nom", "last", selected.last || "", "text", "required")}${field("Email principal", "email", selected.email || "", "email")}${field("Email secondaire", "secondaryEmails", selected.secondaryEmails || "")}${field("Téléphone", "phone", selected.phone || "")}${field("Téléphone 2", "phone2", selected.phone2 || "")}${field("Date de naissance", "dob", selected.dob || "")}${field("Adresse", "address", selected.address || "")}${field("Code postal", "zip", selected.zip || "")}${field("Ville", "city", selected.city || "")}${field("Pays", "country", selected.country || "")}${field("Famille", "family", selected.family || "")}${field("Rôle de foyer", "role", selected.role || "")}${field("Profession", "profession", selected.profession || "")}${field("École actuelle", "school", selected.school || "")}${field("Étiquettes", "tags", (selected.tags || []).join(", "))}${field("Segments", "segments", (selected.segments || []).join(", "))}${field("Groupes", "groups", (selected.groups || []).join(", "))}${textareaField("Commentaire", "comment", selected.comment || "")}`),
  };
  (modals[kind] || modals.contact)();
}

/* ---------- 10. Enregistrement des formulaires -------------------------- */

function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());
  const required = [...form.querySelectorAll("[required]")].filter(el => !String(el.value || "").trim());
  if (required.length) { notify("Complétez les champs obligatoires"); return; }

  if (kind === "account") { submitAccountForm(form); return; }

  const handlers = {
    contact: () => {
      const record = { id: nextId("C", records), kind: "Contact", civility: data.civility, first: data.first, last: data.last, name: `${data.first} ${data.last}`.trim(), email: data.email, phone: data.phone, tags: splitTags(data.tags), groups: [], segments: [], importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0, address: data.address, source: "Manuel", family: data.family, dateAdded: todayStr() };
      records.unshift(record); state.selectedRecord = record.id; logAudit(`Contact ajouté : ${record.name}.`); navigate("crm", "Contacts");
    },
    structure: () => {
      const record = { id: nextId("S", records), kind: "Structure", name: data.name, email: data.email, phone: data.phone, tags: splitTags(data.tags), groups: [], segments: [], importedAmount: 0, importedPaymentsCount: 0, importedInteractionsCount: 0, address: data.address, siren: data.siren, legal: data.legal, source: "Manuel", dateAdded: todayStr() };
      records.unshift(record); state.selectedRecord = record.id; logAudit(`Structure ajoutée : ${record.name}.`); navigate("crm", "Structures");
    },
    payment: () => {
      const payer = data.recordId ? recordById(data.recordId) : records.find(r => r.name === data.payer);
      if (!payer) { notify("Payeur introuvable"); return; }
      const p = { id: nextId("PAY-SIN", payments), recordId: payer.id, date: todayStr(), at: nowIso(), payer: payer.name, email: payer.email, amount: Number(data.amount), type: data.type, status: data.status, method: data.method, occasion: splitTags(data.occasion), receipt: data.type === "Don" ? "À générer" : "Non éligible", installmentPlan: data.installmentPlan === "Oui", installments: [] };
      payments.unshift(p);
      logAudit(`${data.type} de ${euro(p.amount)} ajouté pour ${payer.name}.`);
      applyInlineInstallment(p, data);
      state.selectedRecord = payer.id; state.tab = "Paiements";
      navigate("crm", payer.kind === "Structure" ? "Structures" : "Contacts");
    },
    interaction: () => {
      const rec = data.recordId ? recordById(data.recordId) : records.find(r => r.name === data.recordName);
      if (!rec) { notify("Contact introuvable"); return; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: data.category || "Suivi", label: data.label, type: data.type, note: data.note, user: currentUserLabel() });
      logAudit(`Interaction ajoutée pour ${rec.name}.`);
      state.selectedRecord = rec.id; state.tab = "Activité";
      navigate("crm", rec.kind === "Structure" ? "Structures" : "Contacts");
    },
    comment: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable"); return; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: "Suivi", label: "Commentaire", type: "Commentaire", note: data.note, user: currentUserLabel() });
      logAudit(`Commentaire ajouté pour ${rec.name}.`);
      state.selectedRecord = rec.id; state.tab = "Activité";
      navigate("crm", rec.kind === "Structure" ? "Structures" : "Contacts");
    },
    task: () => {
      const t = buildTask(data.title, data.dueDate, data.recordId);
      if (!t) return;
      tasks.unshift(t);
      const rec = t.recordId ? recordById(t.recordId) : null;
      logAudit(`Tâche ajoutée : ${t.title}${rec ? ` (liée à ${rec.name})` : ""}.`);
      if (rec) state.tab = "Tâches";
    },
    editTask: () => {
      const t = tasks.find(x => x.id === data.taskId);
      if (!t) { notify("Tâche introuvable"); return; }
      const cleanTitle = (data.title || "").trim();
      if (!cleanTitle) { notify("Le titre ne peut pas être vide"); return; }
      t.title = cleanTitle;
      t.dueDate = data.dueDate || "";
      t.recordId = data.recordId || null;
      t.assignedTo = (data.assignedTo || "").trim();
      logAudit(`Tâche modifiée : ${t.title}.`);
      state.tab = "Tâches";
    },
    holidayTask: () => {
      const h = JEWISH_HOLIDAYS.find(x => x.key === data.holidayKey);
      if (!h) { notify("Fête introuvable"); return; }
      const due = daysBeforeIso(h.date, 5);
      const t = buildTask(`Envoyer les vœux de ${h.name} au portefeuille`, due, null);
      if (!t) return;
      tasks.unshift(t);
      logAudit(`Tâche de relance créée pour ${h.name}.`);
      state.tab = "Tâches";
    },
    portfolioTouch: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable"); return; }
      const { display, at } = dateFromInput(data.date);
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: display, at, target: rec.name, category: "Suivi portefeuille", label: data.type, type: data.type, note: data.note, user: currentUserLabel() });
      logAudit(`Contact de portefeuille enregistré avec ${rec.name}.`);
    },
    addToPortfolio: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable"); return; }
      const mine = myAgentCode();
      if (!mine) { notify("Impossible de déterminer votre portefeuille."); return; }
      rec.agent = mine;
      logAudit(`${rec.name} ajouté au portefeuille de ${currentUserLabel()}.`);
    },
    editPayment: () => {
      const p = payments.find(item => item.id === data.paymentId);
      if (!p) { notify("Paiement introuvable"); return; }
      p.amount = Number(data.amount);
      p.type = data.type;
      p.method = data.method;
      p.status = data.status;
      p.receipt = data.receipt;
      if ("installmentPlan" in data) p.installmentPlan = data.installmentPlan === "Oui";
      if (p.installmentPlan && !Array.isArray(p.installments)) p.installments = [];
      p.occasion = splitTags(data.occasion);
      logAudit(`Paiement modifié : ${p.type} de ${euro(p.amount)} pour ${p.payer} (${p.status}).`);
      applyInlineInstallment(p, data);
      state.tab = "Paiements";
    },
    addInstallment: () => {
      const p = payments.find(item => item.id === data.paymentId);
      if (!p) { notify("Paiement introuvable"); return; }
      if (!Array.isArray(p.installments)) p.installments = [];
      const { display } = dateFromInput(data.date);
      const montant = Number(data.amount);
      p.installments.push({ id: nextId("VER", p.installments), date: display, amount: montant, method: data.method });
      logAudit(`Versement de ${euro(montant)} (${data.method}) ajouté pour ${p.payer} — ${p.type}.`);
      // Une fois le montant total couvert par les versements, on considère
      // le paiement réglé : ça évite d'avoir à repasser manuellement le
      // statut en "Validé" en plus d'avoir ajouté le dernier versement.
      if (paymentRemaining(p) <= 0) p.status = "Validé";
      state.tab = "Paiements";
    },
    field: () => { customFields.unshift({ name: data.name, type: data.type, values: data.values, required: data.required, profile: "Tous" }); navigate("settings", "Champs personnalisés"); },
    group: () => { groups.unshift({ name: data.name, contacts: 0, structures: 0, date: todayStr(), type: data.type, establishment: data.establishment }); navigate("crm", "Groupes"); },
    linkage: () => { linkages.unshift({ a: data.a, roleA: data.roleA, b: data.b, roleB: data.roleB, type: data.type }); logAudit(`Liaison ajoutée entre ${data.a} et ${data.b}.`); navigate("crm", "Liaisons"); },
    receiptTemplate: () => { receiptTemplates.unshift({ name: data.name, entity: data.entity, mode: data.mode, signature: data.signature, active: "Oui" }); navigate("pay", "Reçus"); },
    editRecord: () => {
      const r = records.find(item => item.id === state.selectedRecord);
      if (r) {
        ["civility","first","last","name","email","secondaryEmails","phone","phone2","dob","address","zip","city","country","family","role","profession","school","comment","siren","legal"].forEach(key => { if (key in data) r[key] = data[key]; });
        ["tags","segments","groups"].forEach(key => { if (key in data) r[key] = splitTags(data[key]); });
        if (!r.name && (r.first || r.last)) r.name = `${r.first || ""} ${r.last || ""}`.trim();
        r.dateModified = todayStr();
        state.tab = "Details";
        logAudit(`Fiche modifiée : ${r.name}.`);
      }
    },
  };
  dialog().close();
  (handlers[kind] || (() => {}))();
  saveCrmData();
  render();
  notify("Enregistré");
}

function deleteSelectedRecord() {
  const index = records.findIndex(record => record.id === state.selectedRecord);
  if (index < 0) return notify("Aucune fiche sélectionnée");
  const record = records[index];
  const ok = window.confirm(`Supprimer définitivement ${record.name || record.id} du CRM Sinaï ?\nCette action est irréversible.`);
  if (!ok) return;
  records.splice(index, 1);
  state.selectedRecord = records[0]?.id || null;
  logAudit(`Fiche supprimée : ${record.name || record.id}.`);
  saveCrmData();
  render();
  notify("Fiche supprimée");
}

function downloadCsv(filename, rows) {
  const clean = rows.map(r => { const c = { ...r }; delete c._backendId; delete c._createdAt; delete c._updatedAt; return c; });
  const list = clean.length ? clean : [{}];
  const headers = Object.keys(list[0]);
  const csv = [headers.join(","), ...list.map(row => headers.map(h => csvCell(Array.isArray(row[h]) ? row[h].join("; ") : row[h])).join(","))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
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
    <header><div><span class="eyebrow">Import</span><h2>Importer un fichier de contacts</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">✕</button></header>
    <div class="form-grid">
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
    confirmBtn.disabled = false;
  } catch (err) {
    preview.innerHTML = `<p>Impossible de lire ce fichier (${escapeHtml(String(err.message || err))}). Vérifiez le format (.csv ou .xlsx).</p>`;
  }
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
        const wb = window.XLSX.read(reader.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
        resolve(rows);
      };
      reader.readAsArrayBuffer(file);
    }
  });
}

function parseCsv(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r\n|\n/).filter(l => l.length);
  if (!lines.length) return [];
  const splitLine = (line) => {
    const cells = []; let cur = ""; let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuotes = false;
        else cur += c;
      } else if (c === '"') inQuotes = true;
      else if (c === "," || c === ";") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ""; });
    return row;
  });
}

function analyzeImportRows(rows, fileName) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
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
      else if (IMPORT_NUMBER_FIELDS.has(field)) mapped[field] = Number(String(value).replace(",", ".").replace(/[^0-9.-]/g, "")) || 0;
      else mapped[field] = String(value ?? "").trim();
    });
    mapped.name = `${mapped.first || ""} ${mapped.last || ""}`.trim() || mapped.name || "Sans nom";
    if (!mapped.email) missingEmail += 1;
    const match = mapped.email ? existingByEmail[mapped.email.toLowerCase().trim()] : null;
    if (match) updated += 1; else created += 1;
    return { mapped, match };
  });
  return { fileName, rows: rows.length, mappedHeaders: mappedHeaders.length, unmapped, created, updated, missingEmail, preparedRecords };
}

function importPreviewHtml(p) {
  return `<div class="metric-grid">
    ${metric("Lignes lues", p.rows, "")}
    ${metric("Colonnes reconnues", `${p.mappedHeaders}/${p.mappedHeaders + p.unmapped.length}`, "")}
    ${metric("Nouvelles fiches", p.created, "")}
    ${metric("Fiches mises à jour", p.updated, "par email identique")}
  </div>
  ${p.missingEmail ? `<p class="muted-note">${p.missingEmail} ligne(s) sans email — importées quand même, à compléter ensuite.</p>` : ""}
  ${p.unmapped.length ? `<p class="muted-note">Colonnes non reconnues (ignorées) : ${p.unmapped.map(escapeHtml).join(", ")}</p>` : ""}`;
}

function confirmImport() {
  if (!pendingImport) return;
  const p = pendingImport;
  p.preparedRecords.forEach(({ mapped, match }) => {
    if (match) {
      Object.entries(mapped).forEach(([k, v]) => { if (v !== "" && !(Array.isArray(v) && !v.length)) match[k] = v; });
    } else {
      records.push({ id: nextId("C", records), kind: "Contact", source: `Import ${p.fileName}`, dateAdded: todayStr(), ...mapped });
    }
  });
  imports.unshift({ status: "Terminé", date: todayStr(), file: p.fileName, user: currentUserLabel(), type: "Contacts", rows: p.rows, errors: 0, created: p.created, updated: p.updated, duplicates: p.updated, rejected: 0 });
  logAudit(`Import de ${p.fileName} : ${p.created} créé(s), ${p.updated} mis à jour.`);
  pendingImport = null;
  dialog().close();
  saveCrmData();
  navigate("imports", "IMPORTS");
  notify("Import terminé");
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
    <img class="auth-logo" src="./assets/logo-sinai.png" alt="">
    <h1>Bienvenue sur CRM Sinaï</h1>
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
    <img class="auth-logo" src="./assets/logo-sinai.png" alt="">
    <h1>CRM Sinaï</h1>
    <p class="auth-subtitle">Connectez-vous pour accéder à votre espace.</p>
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
  const scopeNote = currentAccount.scopeMode === "tags" ? "Accès restreint par catégorie" : "Accès à tous les contacts";
  card.innerHTML = `<span class="eyebrow">${escapeHtml(currentAccount.profile)}</span><strong>${escapeHtml(name)}</strong><p>${escapeHtml(currentAccount.email)} · ${escapeHtml(scopeNote)}</p>`;
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

async function bootApp() {
  updateProfileCard();
  await refreshAccounts();
  seedFromImportedContacts();
  const server = await apiGetState();
  const backup = server || loadLocalBackup();
  if (backup) {
    records = Array.isArray(backup.records) && backup.records.length ? backup.records : records;
    payments = Array.isArray(backup.payments) ? backup.payments : payments;
    imports = Array.isArray(backup.imports) && backup.imports.length ? backup.imports : imports;
    users = Array.isArray(backup.users) && backup.users.length ? backup.users : users;
    groups = Array.isArray(backup.groups) ? backup.groups : groups;
    interactions = Array.isArray(backup.interactions) ? backup.interactions : interactions;
    linkages = Array.isArray(backup.linkages) ? backup.linkages : linkages;
    customFields = Array.isArray(backup.customFields) && backup.customFields.length ? backup.customFields : customFields;
    receiptTemplates = Array.isArray(backup.receiptTemplates) && backup.receiptTemplates.length ? backup.receiptTemplates : receiptTemplates;
    savedViews = Array.isArray(backup.savedViews) ? backup.savedViews : savedViews;
    auditLog = Array.isArray(backup.auditLog) ? backup.auditLog : auditLog;
    interactionCategories = Array.isArray(backup.interactionCategories) && backup.interactionCategories.length ? backup.interactionCategories : interactionCategories;
    tasks = Array.isArray(backup.tasks) ? backup.tasks : tasks;
    if (backup.state?.selectedRecord && records.some(r => r.id === backup.state.selectedRecord)) {
      state.selectedRecord = backup.state.selectedRecord;
    }
  }
  if (!state.selectedRecord && records.length) state.selectedRecord = records[0].id;
  state.booted = true;
  render();
  if (!server) setSaveIndicator("Mode hors ligne — dernières données locales", "warn");
  // Rappels de tâches sur cet appareil : on vérifie tout de suite puis
  // toutes les minutes si l'heure choisie est atteinte (voir Réglages).
  maybeFireTaskNotification();
  clearInterval(bootApp._notifTimer);
  bootApp._notifTimer = setInterval(maybeFireTaskNotification, 60000);
}

document.querySelector("#newRecordBtn").addEventListener("click", toggleFabMenu);
document.querySelector("#fabAdd").addEventListener("click", toggleFabMenu);
buildFabMenu();
document.querySelector("#dupBtn").addEventListener("click", () => handleAction("dedupe"));
document.querySelector("#importBtn").addEventListener("click", () => handleAction("import-new"));
document.querySelector("#exportBtn").addEventListener("click", () => handleAction("export-current"));
document.querySelector("#navToggle").addEventListener("click", () => (state.navOpen ? closeNav() : openNav()));
document.querySelector("#navScrim").addEventListener("click", closeNav);

// Doublons du haut, repris dans le tiroir de menu mobile (le bandeau de
// boutons du haut est masqué en dessous de 720px pour dégager l'écran).
document.querySelector("#dupBtnMobile")?.addEventListener("click", () => { closeNav(); handleAction("dedupe"); });
document.querySelector("#importBtnMobile")?.addEventListener("click", () => { closeNav(); handleAction("import-new"); });
document.querySelector("#exportBtnMobile")?.addEventListener("click", () => { closeNav(); handleAction("export-current"); });

// Barre de navigation mobile (bas d'écran).
document.querySelector("#bnavHome")?.addEventListener("click", () => { closeNav(); navigate("home", "Accueil"); });
document.querySelector("#bnavContacts")?.addEventListener("click", () => { closeNav(); navigate("crm", "Contacts"); });
document.querySelector("#bnavPayments")?.addEventListener("click", () => { closeNav(); navigate("pay", "Tous les paiements"); });
document.querySelector("#bnavInteractions")?.addEventListener("click", () => { closeNav(); navigate("crm", "Interactions"); });
document.querySelector("#bnavMenu")?.addEventListener("click", () => (state.navOpen ? closeNav() : openNav()));

document.querySelector("#logoutBtn")?.addEventListener("click", async () => {
  await apiLogout();
  try { localStorage.removeItem(AUTH_TOKEN_KEY); } catch { /* stockage indisponible */ }
  location.reload();
});

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

boot();
