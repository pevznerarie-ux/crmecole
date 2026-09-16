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
const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8766" : "";
const AUDIT_LIMIT = 200;

function todayStr() {
  return new Date().toLocaleDateString("fr-FR");
}
function nowIso() {
  return new Date().toISOString();
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

async function apiGetState() {
  try {
    const res = await fetch(`${API_BASE}/api/state?ts=${Date.now()}`, { cache: "no-store" });
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
    customFields, receiptTemplates, savedViews, auditLog,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaveIndicator(res.ok ? "Enregistré" : "Enregistré localement seulement", res.ok ? "ok" : "warn");
  } catch {
    setSaveIndicator("Hors ligne — enregistré sur cet appareil", "warn");
  } finally {
    saveInFlight = false;
    if (savePending) { savePending = false; saveCrmData(); }
  }
}

function logAudit(text) {
  auditLog.unshift({ id: `AUD-${Date.now().toString(36)}`, date: todayStr(), at: nowIso(), text, user: "Vous" });
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
let receiptTemplates = [
  { name: "Don standard", entity: "Réseau Sinaï", mode: "Automatique", signature: "Direction", active: "Oui" },
];
let savedViews = [];
let auditLog = [];

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
  ["settings", "PARAMÈTRES", ["Champs personnalisés", "Reçus"]],
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
  if (state.view === "admin") return users;
  if (state.view === "settings") return customFields;
  return filteredRecords();
}

function renderNav() {
  nav().innerHTML = navTree.map(([id, label, children]) => `
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
}

function metric(label, value, note) {
  return `<div class="metric"><span class="eyebrow">${label}</span><strong>${value}</strong><p>${note}</p></div>`;
}

function toolbar(placeholder = "Rechercher un nom, un email ou une ville") {
  return `<div class="toolbar">
    <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="${placeholder}" />
    <div class="row-actions">
      ${action("Réinitialiser", "reset-filters")}
      ${action("Actions", "open-actions")}
    </div>
  </div>`;
}

function home() {
  const contacts = records.filter(r => r.kind === "Contact").length;
  const structures = records.filter(r => r.kind === "Structure").length;
  const totalDons = records.reduce((s, r) => s + recordTotalAmount(r), 0) || payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const missingEmail = records.filter(r => !r.email).length;
  const recentInteractions = [...interactions].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 5);
  return `
    <div class="workspace-hero">
      <div>
        <span class="eyebrow">Les institutions Sinaï</span>
        <h2>Pilotage Sinaï</h2>
        <p>Contacts, familles, structures, dons et suivi des interactions, centralisés et à jour.</p>
      </div>
      <div class="hero-actions">
        ${action("Nouveau contact", "add-contact", "primary-btn")}
        ${action("Nouveau don", "add-payment:Don")}
      </div>
    </div>
    <div class="metric-grid">
      ${metric("Contacts", contacts.toLocaleString("fr-FR"), "Fiches individuelles")}
      ${metric("Structures", structures.toLocaleString("fr-FR"), "Personnes morales")}
      ${metric("Montant total", euro(totalDons), "Historique importé + dons enregistrés")}
      ${metric("Emails manquants", missingEmail.toLocaleString("fr-FR"), "À compléter pour l'emailing")}
    </div>
    <div class="home-grid">
      ${card("Contacts et familles", [["Ajouter un contact", "add-contact"], ["Ajouter une structure", "add-structure"], ["Rechercher les doublons", "dedupe"]])}
      ${card("Collecte", [["Ajouter un don", "add-payment:Don"], ["Ajouter une adhésion", "add-payment:Adhésion"], ["Reçus", "goto-receipts"]])}
      ${card("Suivi", [["Ajouter une interaction", "add-interaction"], ["Voir les interactions", "goto-interactions"], ["Voir le journal", "goto-audit"]])}
      ${card("Import", [["Importer un fichier", "import-new"], ["Exporter la vue active", "export-current"]])}
    </div>
    ${recentInteractions.length ? `<section class="panel pad">
      <div class="toolbar clean"><h2>Activité récente</h2>${action("Voir tout", "goto-interactions")}</div>
      <div class="timeline">${recentInteractions.map(i => activityItem(i)).join("")}</div>
    </section>` : ""}`;
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
  return `<div class="records-layout${showDetail ? "" : " no-detail"}">
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
        <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Rechercher un nom, un email ou une ville" />
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
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Contact / structure</th><th>Catégorie</th><th>Libellé</th><th>Type</th><th>Note</th><th>Utilisateur</th></tr></thead><tbody>${rows.map(r=>{
      const rec = recordById(r.recordId);
      return `<tr class="row-click" data-action="open-record:${r.recordId}"><td>${r.date}</td><td>${escapeHtml(rec ? rec.name : (r.target || "-"))}</td><td>${r.category||"-"}</td><td>${escapeHtml(r.label||"-")}</td><td>${r.type==="Commentaire"?tag("Commentaire","violet"):r.type}</td><td>${escapeHtml(r.note||"-")}</td><td>${r.user}</td></tr>`;
    }).join("")}</tbody></table></div>` : emptyState("Aucune interaction enregistrée pour l'instant.", "Ajouter une interaction", "add-interaction")}
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
    ${rows.length ? `<p class="muted-note">${rows.length.toLocaleString("fr-FR")} paiement(s)${state.query ? " correspondant à la recherche" : ""}.</p><div class="table-wrap"><table><thead><tr><th>Date</th><th>Nom</th><th>Montant</th><th>Type</th><th>Statut</th><th>Moyen</th><th>Reçu</th></tr></thead>
    <tbody>${visible.map(p => `<tr class="row-click" data-action="open-record:${p.recordId}"><td>${p.date}</td><td>${escapeHtml(p.payer)}</td><td>${euro(p.amount)}</td><td>${p.type}</td><td>${status(p.status)}</td><td>${p.method}</td><td>${status(p.receipt)}</td></tr>`).join("")}</tbody></table>${loadMore}</div>` : emptyState("Aucun paiement enregistré pour l'instant.", "Ajouter un don", "add-payment:Don")}
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
    ${rows.length ? `<p class="muted-note">${rows.length.toLocaleString("fr-FR")} don(s)/adhésion(s).</p><div class="table-wrap"><table><thead><tr><th>Reçu</th><th>Payeur</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${visible.map((p,i)=>`<tr><td>${p.receipt==="Genere"||p.receipt==="Généré"||p.receipt==="Disponible" ? `RF-${new Date().getFullYear()}-${1000+i}` : "-"}</td><td>${escapeHtml(p.payer)}</td><td>${euro(p.amount)}</td><td>${status(p.receipt)}</td></tr>`).join("")}</tbody></table>${loadMore}</div>` : emptyState("Aucun don ou adhésion pour l'instant.")}
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
  return `<div class="split"><section class="panel"><div class="toolbar"><h2>Champs personnalisés</h2>${action("Créer un champ", "add-field", "primary-btn")}</div>
    <div class="table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Valeur(s)</th><th>Obligatoire ?</th><th>Profils</th></tr></thead><tbody>${customFields.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.type}</td><td>${escapeHtml(r.values)}</td><td>${r.required}</td><td>${r.profile}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel pad"><span class="eyebrow">Configuration Sinaï</span><h2>Réglages</h2><div class="timeline"><button class="timeline-item" type="button" data-action="add-receipt-template"><strong>Reçus fiscaux</strong><p>Modèles, signatures, entités émettrices.</p></button></div></section></div>`;
}

function admin() {
  if (state.section === "Journal d'activité") return auditView();
  return `<section class="panel"><div class="toolbar"><h2>Utilisateurs</h2>${action("Ajouter un utilisateur","add-user","primary-btn")}</div>
    <div class="table-wrap"><table><thead><tr><th>Email</th><th>Prénom</th><th>Nom</th><th>Profil</th><th>Dernière activité</th></tr></thead><tbody>${users.map(r=>`<tr><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.first)}</td><td>${escapeHtml(r.last)}</td><td>${r.profile}</td><td>${r.lastSeen}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function auditView() {
  return `<section class="panel pad"><h2>Journal d'activité</h2>${auditLog.length ? `<div class="timeline">${auditLog.map(a=>`<div class="timeline-item"><strong>${a.date}</strong><p>${escapeHtml(a.text)} — ${escapeHtml(a.user)}</p></div>`).join("")}</div>` : emptyState("Aucune activité enregistrée pour l'instant.")}</section>`;
}

function render() {
  rebuildIndexes();
  setHeader();
  renderNav();
  const views = { home, stats, crm, pay: paymentsView, imports: importsView, apps: appsView, settings: settingsView, admin };
  content().innerHTML = (views[state.view] || home)();
  renderDrawer();
  bind();
}

/* ---------- 7. Fiche détail ------------------------------------------- */

function recordDetail(r) {
  const tabs = ["Details", "Activité", "Paiements", "Categorisation", "Relations"];
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
      ${action("+ Commentaire", `quick-comment:${r.id}`)}
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
    return `${importedNote}${feed.length ? `<div class="timeline">${feed.map(i => `<div class="timeline-item"><strong>${i.type === "Commentaire" ? "Commentaire" : i.type}${i.label ? " — " + escapeHtml(i.label) : ""}</strong>${i.note ? `<p>${escapeHtml(i.note)}</p>` : ""}<span class="timeline-date">${i.date} · ${escapeHtml(i.user)}</span></div>`).join("")}</div>` : emptyState("Aucune interaction ou commentaire enregistré pour l'instant.")}`;
  }
  if (state.tab === "Paiements") {
    const feed = recordLivePayments(r.id);
    const importedNote = r.importedAmount ? `<p class="muted-note">+ ${euro(r.importedAmount)} sur ${r.importedPaymentsCount || 0} paiement(s) historiques importés avant le CRM.</p>` : "";
    return `${importedNote}${feed.length ? `<div class="timeline">${feed.map(p => `<div class="timeline-item"><strong>${euro(p.amount)} — ${p.type}</strong><p>${p.method} · ${status(p.status)} · Reçu : ${status(p.receipt)}</p><span class="timeline-date">${p.date}</span></div>`).join("")}</div>` : emptyState("Aucun don enregistré pour l'instant.")}`;
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
}
function closeNav() {
  state.navOpen = false;
  document.querySelector("#sidebar")?.classList.remove("open");
  document.querySelector("#navScrim")?.classList.remove("show");
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
    closeNav();
    render();
  }));
  document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => handleAction(el.dataset.action)));
  document.querySelectorAll("[data-record]").forEach(el => el.addEventListener("click", () => { state.selectedRecord = el.dataset.record; state.showDetail = true; state.tab = "Details"; render(); }));
  document.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => { state.tab = el.dataset.tab; render(); }));
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
  state.recordsPage = PAGE_STEP;
  state.paymentsPage = PAGE_STEP;
  render();
}

/* ---------- 9. Modales & actions rapides -------------------------------- */

function handleAction(key) {
  if (!key) return;
  if (key.startsWith("open-record:")) { const id = key.split(":")[1]; if (recordById(id)) { navigate("crm", recordById(id).kind === "Structure" ? "Structures" : "Contacts"); state.selectedRecord = id; state.showDetail = true; state.tab = "Details"; render(); } return; }
  if (key.startsWith("quick-interaction:")) return openQuickForRecord(key.split(":")[1], "interaction");
  if (key.startsWith("quick-payment:")) return openQuickForRecord(key.split(":")[1], "payment");
  if (key.startsWith("quick-comment:")) return openQuickForRecord(key.split(":")[1], "comment");
  if (key.startsWith("add-payment:")) return openModal("payment", { type: key.split(":")[1] || "Don" });
  if (key.startsWith("add-linkage:")) return openModal("linkage", { recordId: key.split(":")[1] });
  if (key.startsWith("apply-segment:")) { state.query = key.split(":")[1]; navigate("crm", "Contacts"); return; }
  if (key.startsWith("notify-app:")) return notify(`Nous vous préviendrons pour ${key.split(":")[1]} dès que la connexion sera disponible.`);

  const actions = {
    "add-contact": () => openModal("contact"),
    "add-structure": () => openModal("structure"),
    "add-user": () => openModal("user"),
    "add-field": () => openModal("field"),
    "add-group": () => openModal("group"),
    "add-interaction": () => openModal("interaction"),
    "add-linkage": () => openModal("linkage"),
    "add-receipt-template": () => openModal("receiptTemplate"),
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
    "close-detail": () => { state.showDetail = false; render(); },
    "open-detail": () => { state.showDetail = true; render(); },
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
  dialogContent().querySelector("input, select, textarea")?.focus();
}

function openQuickForRecord(recordId, kind) {
  const r = recordById(recordId);
  if (!r) return notify("Fiche introuvable");
  if (kind === "payment") return modalShell("payment", "Don pour " + r.name, "Ajouter un don / paiement",
    `<input type="hidden" name="recordId" value="${r.id}">
     ${field("Montant (€)", "amount", "", "number", "min='0' step='1' required")}
     ${selectField("Type", "type", ["Don","Adhésion","Billetterie"], "Don")}
     ${selectField("Moyen", "method", ["CB","Chèque","Virement","SEPA","Espèces"], "CB")}
     ${selectField("Statut", "status", ["Validé","En attente"], "Validé")}`);
  if (kind === "interaction") return modalShell("interaction", "Interaction avec " + r.name, "Ajouter une interaction",
    `<input type="hidden" name="recordId" value="${r.id}">
     ${selectField("Catégorie", "category", ["Collecte","Comptabilité","Bénévolat","Événement","Scolarité"], "Collecte")}
     ${selectField("Type", "type", ["Email","Appel","Rendez-vous","Note"], "Appel")}
     ${field("Libellé", "label", "", "text", "placeholder='Ex : relance annuelle'")}
     ${textareaField("Détail (optionnel)", "note", "")}`);
  return modalShell("comment", "Commentaire sur " + r.name, "Ajouter un commentaire",
    `<input type="hidden" name="recordId" value="${r.id}">
     ${textareaField("Commentaire", "note", "", "required placeholder='Notez ici une information utile sur ce contact...'")}`, "Ajouter le commentaire");
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
      `${selectField("Payeur", "payer", records.map(r => r.name), selected ? selected.name : "")}
       ${field("Montant (€)", "amount", "", "number", "min='0' step='1' required")}
       ${selectField("Type", "type", ["Don","Adhésion","Billetterie"], options.type || "Don")}
       ${selectField("Moyen", "method", ["CB","Chèque","Virement","SEPA","Espèces"], "CB")}
       ${selectField("Statut", "status", ["Validé","En attente"], "Validé")}`),
    user: () => modalShell("user", "Administration", "Ajouter un utilisateur",
      `${field("Email", "email", "", "email", "required placeholder='prenom@sinai.fr'")}${field("Prénom", "first", "")}${field("Nom", "last", "")}${selectField("Profil", "profile", ["Administrateur","Collecte","Comptabilité","Lecture seule"], "Lecture seule")}`),
    field: () => modalShell("field", "Paramètres", "Ajouter un champ personnalisé",
      `${field("Nom du champ", "name", "", "text", "required")}${selectField("Type", "type", ["Texte","Date","Montant","Liste","Case à cocher"], "Texte")}${field("Valeurs", "values", "Libre")}${selectField("Obligatoire", "required", ["Oui","Non"], "Non")}`),
    group: () => modalShell("group", "Groupe", "Créer un groupe",
      `${field("Nom du groupe", "name", "", "text", "required")}${selectField("Type", "type", ["Équipe","Famille","Gouvernance","Mécénat","Événement"], "Équipe")}${field("Établissement", "establishment", "Sinaï")}`),
    interaction: () => modalShell("interaction", "Interaction", "Ajouter une interaction",
      `${selectField("Contact / structure", "recordName", records.map(r => r.name), selected ? selected.name : "")}
       ${selectField("Catégorie", "category", ["Collecte","Comptabilité","Bénévolat","Événement","Scolarité"], "Collecte")}
       ${selectField("Type", "type", ["Email","Appel","Rendez-vous","Note"], "Email")}
       ${field("Libellé", "label", "")}
       ${textareaField("Détail (optionnel)", "note", "")}`),
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
      const p = { id: nextId("PAY-SIN", payments), recordId: payer.id, date: todayStr(), at: nowIso(), payer: payer.name, email: payer.email, amount: Number(data.amount), type: data.type, status: data.status, method: data.method, receipt: data.type === "Don" ? "À générer" : "Non éligible" };
      payments.unshift(p);
      logAudit(`${data.type} de ${euro(p.amount)} ajouté pour ${payer.name}.`);
      state.selectedRecord = payer.id; state.tab = "Paiements";
      navigate("crm", payer.kind === "Structure" ? "Structures" : "Contacts");
    },
    interaction: () => {
      const rec = data.recordId ? recordById(data.recordId) : records.find(r => r.name === data.recordName);
      if (!rec) { notify("Contact introuvable"); return; }
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: todayStr(), at: nowIso(), target: rec.name, category: data.category || "Suivi", label: data.label, type: data.type, note: data.note, user: "Vous" });
      logAudit(`Interaction ajoutée pour ${rec.name}.`);
      state.selectedRecord = rec.id; state.tab = "Activité";
      navigate("crm", rec.kind === "Structure" ? "Structures" : "Contacts");
    },
    comment: () => {
      const rec = recordById(data.recordId);
      if (!rec) { notify("Contact introuvable"); return; }
      interactions.unshift({ id: nextId("I", interactions), recordId: rec.id, date: todayStr(), at: nowIso(), target: rec.name, category: "Suivi", label: "Commentaire", type: "Commentaire", note: data.note, user: "Vous" });
      logAudit(`Commentaire ajouté pour ${rec.name}.`);
      state.selectedRecord = rec.id; state.tab = "Activité";
      navigate("crm", rec.kind === "Structure" ? "Structures" : "Contacts");
    },
    user: () => { users.unshift({ email: data.email, first: data.first, last: data.last, profile: data.profile, lastSeen: "Invité" }); logAudit(`Utilisateur ajouté : ${data.email}.`); navigate("admin", "Utilisateurs"); },
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
  imports.unshift({ status: "Terminé", date: todayStr(), file: p.fileName, user: "Vous", type: "Contacts", rows: p.rows, errors: 0, created: p.created, updated: p.updated, duplicates: p.updated, rejected: 0 });
  logAudit(`Import de ${p.fileName} : ${p.created} créé(s), ${p.updated} mis à jour.`);
  pendingImport = null;
  dialog().close();
  saveCrmData();
  navigate("imports", "IMPORTS");
  notify("Import terminé");
}

/* ---------- 12. Démarrage ------------------------------------------------ */

async function boot() {
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
    if (backup.state?.selectedRecord && records.some(r => r.id === backup.state.selectedRecord)) {
      state.selectedRecord = backup.state.selectedRecord;
    }
  }
  if (!state.selectedRecord && records.length) state.selectedRecord = records[0].id;
  state.booted = true;
  render();
  if (!server) setSaveIndicator("Mode hors ligne — dernières données locales", "warn");
}

document.querySelector("#newRecordBtn").addEventListener("click", () => handleAction("add-contact"));
document.querySelector("#fabAdd").addEventListener("click", () => handleAction("add-contact"));
document.querySelector("#dupBtn").addEventListener("click", () => handleAction("dedupe"));
document.querySelector("#importBtn").addEventListener("click", () => handleAction("import-new"));
document.querySelector("#exportBtn").addEventListener("click", () => handleAction("export-current"));
document.querySelector("#navToggle").addEventListener("click", () => (state.navOpen ? closeNav() : openNav()));
document.querySelector("#navScrim").addEventListener("click", closeNav);

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

boot();
