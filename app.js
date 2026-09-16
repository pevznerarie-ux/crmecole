const state = {
  view: "home",
  section: "ACCUEIL",
  query: "",
  selectedRecord: "C-1001",
  tab: "Details",
  drawer: null,
  toastTimer: null,
  showDetail: true,
};

const today = "21/07/2026";
const importReport = window.SINAI_IMPORT_REPORT || null;
const importedContacts = window.SINAI_IMPORTED_CONTACTS || [];
const STORAGE_KEY = "sinai-crm-local-state-v1";
const API_BASE = location.protocol === "file:" ? "http://127.0.0.1:8766" : "";
const savedData = loadSavedData();

const demoRecords = [
  { id: "C-1001", kind: "Contact", civility: "Mme", first: "Lea", last: "Cohen", name: "Lea Cohen", email: "lea.cohen@example.org", phone: "+33 6 11 22 33 44", tags: ["Parent", "Donateur"], groups: ["Membres du conseil d'administration"], segments: ["Donateurs 2026"], amount: 12400, payments: 18, interactions: 12, address: "Paris 16", receipt: "Email", source: "CRM Sinai", family: "Famille Cohen", role: "Mere" },
  { id: "C-1002", kind: "Contact", civility: "M.", first: "David", last: "Benhamou", name: "David Benhamou", email: "david@example.org", phone: "+33 6 45 19 87 21", tags: ["Adherent"], groups: ["Parents"], segments: ["Adhesions actives"], amount: 2500, payments: 6, interactions: 5, address: "Neuilly-sur-Seine", receipt: "Courrier", source: "Import", family: "Famille Benhamou", role: "Pere" },
  { id: "C-1003", kind: "Contact", civility: "Mme", first: "Sarah", last: "Attal", name: "Sarah Attal", email: "sarah@example.org", phone: "+33 7 10 44 28 03", tags: ["Benevole"], groups: ["Corps enseignant"], segments: ["Benevoles actifs"], amount: 750, payments: 2, interactions: 17, address: "Boulogne", receipt: "Email", source: "Google Forms", family: "Famille Attal", role: "Professeur" },
  { id: "S-2101", kind: "Structure", name: "BSM PATRIMOINE", email: "contact@bsm.example", phone: "+33 1 40 00 00 00", tags: ["Structure", "Partenaire"], groups: ["Entreprises"], segments: ["Structures donatrices"], amount: 68000, payments: 21, interactions: 8, address: "Paris 8", siren: "812445771", legal: "SAS", source: "Manuel" },
  { id: "S-2102", kind: "Structure", name: "Fondation Sinai", email: "fondation@example.org", phone: "+33 1 42 00 00 10", tags: ["Fondation"], groups: ["Mecenes"], segments: ["Grands donateurs"], amount: 125000, payments: 9, interactions: 14, address: "Paris 17", siren: "493228004", legal: "Fondation", source: "iRaiser" },
];

const defaultRecords = importedContacts.length
  ? [...importedContacts, ...demoRecords.filter(record => record.kind === "Structure")]
  : demoRecords;
const records = restoreList(savedData?.records, defaultRecords);

if (savedData?.state?.selectedRecord && records.some(record => record.id === savedData.state.selectedRecord)) {
  state.selectedRecord = savedData.state.selectedRecord;
} else if (importedContacts.length) {
  state.selectedRecord = importedContacts[0].id;
}

const defaultPayments = [
  { id: "PAY-SIN-11205", date: today, payer: "Lea Cohen", email: "lea.cohen@example.org", amount: 500, type: "Don", status: "Valide", recurrence: "Ponctuel", method: "CB", source: "HelloAsso", receipt: "Genere", send: "Envoye", model: "Don standard" },
  { id: "PAY-SIN-11206", date: "20/07/2026", payer: "BSM PATRIMOINE", email: "contact@bsm.example", amount: 12000, type: "Don", status: "Valide", recurrence: "Ponctuel", method: "Virement", source: "Manuel", receipt: "A generer", send: "Non envoye", model: "Structure" },
  { id: "PAY-SIN-11207", date: "18/07/2026", payer: "David Benhamou", email: "david@example.org", amount: 240, type: "Adhesion", status: "En attente", recurrence: "Annuel", method: "Cheque", source: "Import", receipt: "Non eligible", send: "-", model: "Adhesion" },
  { id: "PAY-SIN-11208", date: "15/07/2026", payer: "Sarah Attal", email: "sarah@example.org", amount: 80, type: "Billetterie", status: "Valide", recurrence: "Ponctuel", method: "CB", source: "Weezevent", receipt: "Attestation", send: "Envoye", model: "Evenement" },
  { id: "PAY-SIN-11209", date: "12/07/2026", payer: "Fondation Sinai", email: "fondation@example.org", amount: 25000, type: "Crowdfunding", status: "Valide", recurrence: "Engagement", method: "Virement", source: "iRaiser", receipt: "Genere", send: "A envoyer", model: "Grand donateur" },
];
const payments = restoreList(savedData?.payments, defaultPayments);

const defaultImports = [
  { status: "Termine", date: today, file: "contacts-sinai-demo-100.csv", user: "Equipe Sinai", type: "Contacts", rows: 100, errors: 2, created: 94, updated: 4, duplicates: 1, rejected: 2 },
  { status: "A reprendre", date: "18/07/2026", file: "paiements-juillet.xlsx", user: "Equipe Sinai", type: "Paiements", rows: 840, errors: 17, created: 721, updated: 102, duplicates: 0, rejected: 17 },
  { status: "Erreur", date: "11/07/2026", file: "structures-brouillon.csv", user: "Equipe admin", type: "Structures", rows: 211, errors: 39, created: 150, updated: 22, duplicates: 5, rejected: 39 },
];
const imports = restoreList(savedData?.imports, defaultImports);

if (importReport && !imports.some(item => item.report)) {
  imports.unshift({
    status: "Analyse terminee",
    date: today,
    file: "Export de contacts - 2026-07-21.xlsx",
    user: "Equipe Sinai",
    type: "Contacts",
    rows: importReport.source.rows,
    errors: importReport.quality.blockingRowsEstimate,
    created: importReport.quality.readyRowsEstimate,
    updated: 0,
    duplicates: importReport.quality.duplicateEmailGroups + importReport.quality.duplicatePhoneGroups,
    rejected: importReport.quality.blockingRowsEstimate,
    report: true,
  });
}

const defaultUsers = [
  { email: "admin@sinai.example", first: "Admin", last: "Sinai", profile: "Administrateur", lastSeen: "Aujourd'hui" },
  { email: "collecte@sinai.example", first: "Equipe", last: "Collecte", profile: "Collecte", lastSeen: "Hier" },
  { email: "compta@sinai.example", first: "Equipe", last: "Compta", profile: "Comptabilite", lastSeen: "18/07/2026" },
];
const users = restoreList(savedData?.users, defaultUsers);

const defaultGroups = [
  { name: "CORPS ENSEIGNANT", contacts: 45, structures: 0, date: "01/02/2026", type: "Equipe", establishment: "Sinai" },
  { name: "Membres du conseil d'administration", contacts: 12, structures: 2, date: "13/01/2026", type: "Gouvernance", establishment: "Sinai" },
  { name: "Parents", contacts: 312, structures: 0, date: "04/01/2026", type: "Famille", establishment: "Ecole" },
];
const groups = restoreList(savedData?.groups, defaultGroups);

const defaultInteractions = [
  { id: "I-204", date: today, target: "Lea Cohen", category: "Collecte", label: "Relance", type: "Email", user: "Equipe Sinai" },
  { id: "I-205", date: "20/07/2026", target: "BSM PATRIMOINE", category: "Comptabilite", label: "Recu", type: "Appel", user: "Equipe admin" },
  { id: "I-206", date: "18/07/2026", target: "Sarah Attal", category: "Benevolat", label: "Disponibilite", type: "Rendez-vous", user: "Equipe Sinai" },
];
const interactions = restoreList(savedData?.interactions, defaultInteractions);

const defaultLinkages = [
  { a: "Lea Cohen", roleA: "Parent", b: "David Benhamou", roleB: "Parent", type: "Famille" },
  { a: "Sarah Attal", roleA: "Professeur", b: "Lea Cohen", roleB: "Parent", type: "Ecole" },
  { a: "BSM PATRIMOINE", roleA: "Structure", b: "Fondation Sinai", roleB: "Partenaire", type: "Mecenat" },
];
const linkages = restoreList(savedData?.linkages, defaultLinkages);

const defaultCustomFields = [
  { name: "Etablissement", type: "Liste", values: "Sinai, Ecole, Fondation", required: "Oui", profile: "Tous" },
  { name: "Mode d'envoi recu", type: "Liste", values: "Email, Courrier", required: "Non", profile: "Comptabilite" },
  { name: "Point de remise", type: "Texte", values: "Libre", required: "Non", profile: "Administrateur" },
];
const customFields = restoreList(savedData?.customFields, defaultCustomFields);

const defaultReceiptTemplates = [
  { name: "Don standard", entity: "Association Sinai", mode: "Automatique", signature: "Direction", active: "Oui" },
  { name: "Structure", entity: "Fondation Sinai", mode: "Validation", signature: "Tresorerie", active: "Oui" },
];
const receiptTemplates = restoreList(savedData?.receiptTemplates, defaultReceiptTemplates);

const defaultSavedViews = [
  { name: "Vue collecte", module: "Paiements", owner: "Equipe Sinai" },
  { name: "Vue familles", module: "Contacts", owner: "Equipe Sinai" },
];
const savedViews = restoreList(savedData?.savedViews, defaultSavedViews);

const apps = [
  ["HelloAsso", "Collecter", true], ["Stripe", "Collecter", true], ["GoCardless", "Collecter", false], ["iRaiser", "Collecter", true],
  ["Brevo", "Communiquer", true], ["Mailchimp", "Communiquer", false], ["Mailjet", "Communiquer", false], ["Gmail / Outlook IMAP", "Communiquer", true],
  ["Google Calendar", "Recruter", true], ["Gravity Forms", "Recruter", false], ["Pennylane", "Comptabilite", true], ["Zapier", "Possibilites infinies", false],
];

const navTree = [
  ["home", "ACCUEIL", []],
  ["stats", "STATS", ["Campagnes", "Statistique sinai", "Ajouter une vue"]],
  ["crm", "CONTACTS", ["Contacts", "Structures", "Interactions", "Segments", "Groupes", "Liaisons"]],
  ["pay", "PAIEMENTS", ["Tous les paiements", "Dons", "Adhesions", "Billetterie", "Crowdfunding", "Boutique", "Recus"]],
  ["docs", "DOCUMENTS", []],
  ["imports", "IMPORTS", []],
  ["apps", "APPLIS", ["Toutes les applis"]],
  ["settings", "PARAMETRES", ["Contacts", "Interactions", "Structures", "Groupes", "Liaisons", "Paiements", "Recus", "Modeles d'export", "Comptabilite", "Remise de cheques"]],
  ["admin", "ADMINISTRATION", ["Utilisateurs", "Profils", "Organisation", "Abonnement", "Journal d'audit"]],
];

const titles = {
  home: ["Accueil", "Vue generale du CRM Sinai"],
  stats: ["Stats", "Campagnes et Statistique sinai"],
  crm: ["Contacts", "Contacts, structures, interactions, segments, groupes et liaisons"],
  pay: ["Paiements", "Tous les paiements, engagements et recus"],
  docs: ["Documents", "Recus, contacts, structures, interactions, paiements, engagements et bordereaux"],
  imports: ["Imports", "Historique des imports, erreurs et reprises"],
  apps: ["Applis", "Catalogue d'applications connectables"],
  settings: ["Parametres", "CRM, paiements, recus fiscaux, exports, comptabilite et cheques"],
  admin: ["Administration", "Utilisateurs, profils, organisation, abonnement et journal d'audit"],
};

const content = document.querySelector("#content");
const nav = document.querySelector("#nav");
const viewTitle = document.querySelector("#viewTitle");
const viewSubtitle = document.querySelector("#viewSubtitle");
const dialog = document.querySelector("#recordDialog");
const dialogContent = document.querySelector("#dialogContent");
const drawer = document.querySelector("#drawer");
const toast = document.querySelector("#toast");

function euro(value) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));
}

function loadSavedData() {
  const serverData = loadServerData();
  if (serverData) return serverData;
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

function loadServerData() {
  try {
    if (typeof XMLHttpRequest === "undefined") return null;
    const xhr = new XMLHttpRequest();
    xhr.open("GET", `${API_BASE}/api/state?ts=${Date.now()}`, false);
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300 || !xhr.responseText) return null;
    const data = JSON.parse(xhr.responseText);
    return data && data.version === 1 ? data : null;
  } catch {
    return null;
  }
}

function restoreList(savedList, defaultList) {
  const list = Array.isArray(savedList) ? savedList : defaultList;
  return JSON.parse(JSON.stringify(list));
}

function currentCrmData() {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    state: {
      selectedRecord: state.selectedRecord,
    },
    records,
    payments,
    imports,
    users,
    groups,
    interactions,
    linkages,
    customFields,
    receiptTemplates,
    savedViews,
  };
}

function saveCrmData() {
  const payload = JSON.stringify(currentCrmData());
  let saved = false;
  try {
    if (typeof XMLHttpRequest !== "undefined") {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/api/state`, false);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(payload);
      saved = xhr.status >= 200 && xhr.status < 300;
    }
  } catch {
    saved = false;
  }
  try {
    if (!saved && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, payload);
      saved = true;
    }
  } catch {
    saved = false;
  }
  if (!saved) {
    notify("Sauvegarde locale impossible");
  }
}

function nextId(prefix, list) {
  const numbers = list
    .map(item => String(item.id || ""))
    .filter(id => id.startsWith(`${prefix}-`))
    .map(id => id.split("-").pop())
    .map(value => Number(value))
    .filter(Number.isFinite);
  const next = (numbers.length ? Math.max(...numbers) : 1000) + 1;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function tag(text, tone = "") {
  return `<span class="tag ${tone}">${escapeHtml(text)}</span>`;
}

function status(text) {
  const lower = String(text).toLowerCase();
  const tone = lower.includes("valide") || lower.includes("termine") || lower.includes("genere") || lower.includes("envoye") || lower.includes("pret") ? "ok" : lower.includes("erreur") || lower.includes("non eligible") ? "bad" : lower.includes("attente") || lower.includes("reprendre") || lower.includes("generer") ? "warn" : "";
  return `<span class="status ${tone}">${escapeHtml(text)}</span>`;
}

function action(label, key, cls = "") {
  return `<button class="${cls}" data-action="${escapeHtml(key || label)}">${escapeHtml(label)}</button>`;
}

function field(label, name, value = "", type = "text", extra = "") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${extra}></label>`;
}

function textareaField(label, name, value = "") {
  return `<label class="span-2">${label}<textarea name="${name}">${escapeHtml(value)}</textarea></label>`;
}

function selectField(label, name, options, value = "") {
  return `<label>${label}<select name="${name}">${options.map(o => `<option value="${escapeHtml(o)}" ${o === value ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}</select></label>`;
}

function filteredRecords() {
  const q = state.query.toLowerCase();
  return records.filter(r => !q || [r.id, r.kind, r.name, r.email, r.phone, r.address, ...(r.tags || []), ...(r.groups || [])].join(" ").toLowerCase().includes(q));
}

function filteredPayments(type) {
  const q = state.query.toLowerCase();
  return payments.filter(p => (!type || p.type === type) && (!q || Object.values(p).join(" ").toLowerCase().includes(q)));
}

function currentRows() {
  if (state.view === "pay") return filteredPayments({ Dons: "Don", Adhesions: "Adhesion", Billetterie: "Billetterie", Crowdfunding: "Crowdfunding", Boutique: "Boutique" }[state.section]);
  if (state.view === "imports") return imports;
  if (state.view === "admin") return users;
  if (state.view === "settings") return customFields;
  return filteredRecords();
}

function renderNav() {
  nav.innerHTML = navTree.map(([id, label, children]) => `
    <div class="nav-group">
      <button class="nav-btn ${state.view === id ? "active" : ""}" data-view="${id}" data-section="${children[0] || label}">
        <span>${label}</span><span class="count-pill">${children.length || ""}</span>
      </button>
      ${children.length ? `<div class="subnav">${children.map(child => `<button class="subnav-btn ${state.section === child ? "current" : ""}" data-view="${id}" data-section="${child}">${child}</button>`).join("")}</div>` : ""}
    </div>`).join("");
}

function setHeader() {
  const [title, subtitle] = titles[state.view];
  viewTitle.textContent = state.section === title.toUpperCase() ? title : state.section;
  viewSubtitle.textContent = subtitle;
}

function metric(label, value, note) {
  return `<div class="metric"><span class="eyebrow">${label}</span><strong>${value}</strong><p>${note}</p></div>`;
}

function toolbar(placeholder = "Rechercher un ID, un nom ou un email") {
  return `<div class="toolbar">
    <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="${placeholder}" />
    <div class="row-actions">
      ${action("Recherche avancee", "advanced-search")}
      ${action("Enregistrer la vue", "save-view")}
      ${action("Reinitialiser", "reset-filters")}
      ${action("Actions", "open-actions")}
    </div>
  </div>`;
}

function home() {
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const sourceRows = importReport ? importReport.source.rows.toLocaleString("fr-FR") : records.length;
  return `
    <div class="workspace-hero">
      <div>
        <span class="eyebrow">Les institutions Sinai</span>
        <h2>Pilotage Sinai</h2>
        <p>Un CRM moderne, chic et dense pour gerer contacts, familles, structures, dons, recus, imports et tableaux de bord.</p>
      </div>
      <div class="hero-actions">
        ${action("Ajouter un utilisateur", "add-user")}
        ${action("Ajouter un champ", "add-field", "primary-btn")}
        ${action("Creer une vue", "create-view")}
      </div>
    </div>
    <div class="metric-grid">
      ${metric("Contacts source", sourceRows, importReport ? "Lignes analysees depuis ton export" : "Base de demonstration")}
      ${metric("Paiements", euro(total), "Tous types de paiements centralises")}
      ${metric("Colonnes import", importReport ? importReport.source.columns : 67, "Champs detectes et mappables")}
      ${metric("Alertes qualite", importReport ? importReport.quality.warningRowsEstimate.toLocaleString("fr-FR") : imports.filter(i => i.status !== "Termine").length, "Emails, doublons, adresses ou lignes a verifier")}
    </div>
    <div class="home-grid">
      ${card("Priorites du jour", [["Recus a generer", "goto-receipts"], ["Cheques a deposer", "deposit-checks"], ["Imports a reprendre", "goto-imports"], ["Doublons a traiter", "dedupe"]])}
      ${card("Contacts et familles", [["Ajouter un contact", "add-contact"], ["Ajouter une structure", "add-structure"], ["Creer un groupe", "add-group"], ["Rechercher les doublons", "dedupe"]])}
      ${card("Collecte et paiements", [["Ajouter un don", "add-payment:Don"], ["Ajouter une adhesion", "add-payment:Adhesion"], ["Billetterie", "goto-billetterie"], ["Recus", "goto-receipts"]])}
      ${card("Pilotage interne", [["Nouvel import", "import-new"], ["Applis connectees", "goto-apps"], ["Segments emailing", "goto-segments"], ["Journal d'audit", "goto-audit"]])}
    </div>`;
}

function card(title, rows) {
  return `<section class="panel pad compact-card"><h3>${title}</h3>${rows.map(([label, key]) => action(label, key)).join("")}</section>`;
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
  const selected = records.find(r => r.id === state.selectedRecord) || rows[0] || records[0];
  state.selectedRecord = selected.id;
  const totalAmount = rows.reduce((sum, record) => sum + Number(record.amount || 0), 0);
  const missingEmail = rows.filter(record => !record.email).length;
  const recordLabel = kind === "Structure" ? "structures" : kind === "Contact" ? "contacts" : "fiches";
  const showDetail = state.showDetail && rows.length;
  return `<div class="records-layout${showDetail ? "" : " no-detail"}">
    <section class="panel records-panel">
      <div class="records-command">
        <div>
          <span class="eyebrow">Repertoire Sinai</span>
          <h2>${rows.length.toLocaleString("fr-FR")} ${recordLabel}</h2>
          <p>Vue de travail pour qualifier, segmenter, corriger et activer les relations.</p>
        </div>
        <div class="command-stats">
          <div><strong>${euro(totalAmount)}</strong><span>Montant relie</span></div>
          <div><strong>${missingEmail.toLocaleString("fr-FR")}</strong><span>Emails absents</span></div>
          <div><strong>${rows.reduce((sum, record) => sum + Number(record.interactions || 0), 0).toLocaleString("fr-FR")}</strong><span>Interactions</span></div>
        </div>
      </div>
      <div class="toolbar records-tools">
        <input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Rechercher un ID, un nom ou un email" />
        <div class="row-actions">${action("Contact", "add-contact", "primary-btn")} ${action("Structure", "add-structure")} ${action("Recherche", "advanced-search")} ${action("Actions", "open-actions")}${showDetail ? "" : action("Voir la fiche", "open-detail")}</div>
      </div><div class="table-wrap"><table class="records-table">
      <thead><tr><th>Nom</th><th>ID</th><th>Email</th><th>Telephone</th><th>Etiquettes</th><th>Segments</th><th>Groupes</th><th>Montant total</th><th>Interactions</th></tr></thead>
      <tbody>${rows.map(r => `<tr class="${showDetail && r.id === selected.id ? "selected" : ""}" data-record="${r.id}">
        <td class="name-cell"><strong>${escapeHtml(r.name)}</strong><span>${r.kind}</span></td><td>${r.id}</td><td>${escapeHtml(r.email || "-")}</td><td>${escapeHtml(r.phone || "-")}</td><td>${(r.tags || []).map((t,i)=>tag(t, ["","blue","violet"][i%3])).join(" ") || "-"}</td><td>${(r.segments || []).join(", ") || "-"}</td><td>${(r.groups || []).join(", ") || "-"}</td><td class="money-cell">${euro(r.amount)}</td><td>${Number(r.interactions || 0)}</td>
      </tr>`).join("")}</tbody></table></div></section>
    ${showDetail ? recordDetail(selected) : ""}
  </div>`;
}

function recordDetail(r) {
  const tabs = ["Details", "Interactions", "Categorisation", "Paiements", "Relations", "Fichiers"];
  const body = {
    Details: [["Civilite", r.civility || "-"], ["Nom", r.name], ["Email", r.email || "-"], ["Email secondaire", r.secondaryEmails || "-"], ["Telephone", r.phone || "-"], ["Adresse", r.address || "-"], ["Ville", r.city || "-"], ["Date naissance", r.dob || "-"], ["Famille / role", `${r.family || "-"} / ${r.role || "-"}`], ["SIREN", r.siren || "-"], ["Forme juridique", r.legal || "-"]],
    Interactions: [["Derniere interaction", "Emailing ouvert"], ["Nombre d'interactions", r.interactions], ["Categorie", "Suivi association"], ["Libelle", "Relance / appel"]],
    Categorisation: [["Etiquettes", r.tags.join(", ")], ["Segments", r.segments.join(", ")], ["Groupes", r.groups.join(", ")], ["Roles groupe", (r.groupRoles || []).join(", ") || "-"], ["Source", r.source]],
    Paiements: [["Nombre de paiements", r.payments], ["Montant total", euro(r.amount)], ["Montant 2025", euro(r.amount2025 || 0)], ["Montant 2026", euro(r.amount2026 || 0)], ["Sources paiement", (r.paymentSources || []).join(", ") || "-"], ["Moyens paiement", (r.paymentMethods || []).join(", ") || "-"], ["Mode d'envoi recu", r.receipt || "Email"], ["Format recu", r.receiptFormat || "-"]],
    Relations: [["Liaisons", "Parent / enfant, structure, groupe"], ["Groupe", r.groups.join(", ")], ["Role de foyer", r.role || "-"], ["Type de foyer", r.householdType || "-"], ["Statut parent", r.parentStatus || "-"], ["Statut enfant", r.childStatus || "-"], ["Profession", r.profession || "-"], ["Ecole actuelle", r.school || "-"]],
    Fichiers: [["Documents", "Recus, interactions, imports"], ["Dernier fichier", "recu-fiscal-2026.pdf"], ["Depot", "Documents / Recus"], ["Date ajout", r.dateAdded || "-"], ["Derniere modification", r.dateModified || "-"], ["Commentaire", r.comment || "-"]],
  }[state.tab] || [];
  const initial = r.kind === "Structure" ? "ST" : (r.first?.[0] || r.name?.[0] || "C");
  return `<aside class="panel detail-card">
    <div class="detail-head"><div class="avatar">${escapeHtml(initial)}</div><div><span class="eyebrow">${r.kind}</span><h2>${escapeHtml(r.name)}</h2><p>${r.id}</p></div><button class="icon-btn detail-close" type="button" data-action="close-detail" title="Fermer et voir toute la liste">X</button></div>
    <div class="detail-kpis">
      <div><strong>${euro(r.amount)}</strong><span>Total</span></div>
      <div><strong>${Number(r.payments || 0)}</strong><span>Paiements</span></div>
      <div><strong>${Number(r.interactions || 0)}</strong><span>Touches</span></div>
    </div>
    <div class="tabs">${tabs.map(t => `<button class="tab-btn ${state.tab === t ? "active" : ""}" data-tab="${t}">${t}</button>`).join("")}</div>
    <div class="detail-body"><div class="field-grid">${body.map(([k,v]) => `<div class="field"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join("")}</div>
    <div class="row-actions detail-actions">${action("Envoyer un email", "send-email")} ${action("Modifier toute la fiche", "edit-record", "primary-btn")} ${action("Supprimer", "delete-record")}</div></div>
  </aside>`;
}

function paymentTable(type = null) {
  const rows = filteredPayments(type);
  return `<section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Ajouter un paiement", `add-payment:${type || "Don"}`, "primary-btn")} ${action("Generer les recus", "generate-receipts")} ${action("Remise de cheques", "deposit-checks")} ${action("Exporter", "export-current")}</div></div><div class="pay-tabs">${["Tous les paiements","Dons","Adhesions","Billetterie","Crowdfunding","Boutique","Recus"].map(s => `<button class="${state.section===s ? "active" : ""}" data-view="pay" data-section="${s}">${s}</button>`).join("")}</div>
    <div class="table-wrap"><table><thead><tr><th>ID de paiement</th><th>Date</th><th>Nom</th><th>Email</th><th>Montant</th><th>Type</th><th>Statut</th><th>Moyen</th><th>Source</th><th>Modele de recu</th><th>Statut du recu</th><th>Envoi</th></tr></thead>
    <tbody>${rows.map(p => `<tr><td><strong>${p.id}</strong></td><td>${p.date}</td><td>${escapeHtml(p.payer)}</td><td>${escapeHtml(p.email)}</td><td>${euro(p.amount)}</td><td>${p.type}</td><td>${status(p.status)}</td><td>${p.method}</td><td>${p.source}</td><td>${p.model}</td><td>${status(p.receipt)}</td><td>${status(p.send)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function paymentsView() {
  const map = { Dons: "Don", Adhesions: "Adhesion", Billetterie: "Billetterie", Crowdfunding: "Crowdfunding", Boutique: "Boutique" };
  if (state.section === "Recus") return receipts();
  return `${paymentTable(map[state.section])}<div class="kanban">${["En attente","Valide","A generer","Envoye"].map(s => `<section class="stage"><h3>${s}<span>${payments.filter(p => [p.status,p.receipt,p.send].includes(s)).length}</span></h3>${payments.filter(p => [p.status,p.receipt,p.send].includes(s)).map(p => `<button class="payment-card" data-action="edit-payment:${p.id}"><strong>${p.id}</strong><p>${escapeHtml(p.payer)} - ${euro(p.amount)}</p></button>`).join("") || "<p>Aucun element.</p>"}</section>`).join("")}</div>`;
}

function receipts() {
  return `<div class="split"><section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Generer les recus manquants", "generate-receipts", "primary-btn")} ${action("Ajouter un modele", "add-receipt-template")} ${action("Exporter", "export-current")}</div></div><div class="table-wrap"><table><thead><tr><th>Recu</th><th>Paiement</th><th>Payeur</th><th>Montant</th><th>Modele</th><th>Statut</th><th>Envoi</th><th>Dernier envoi</th></tr></thead><tbody>${payments.map((p,i)=>`<tr><td>RF-2026-${1000+i}</td><td>${p.id}</td><td>${escapeHtml(p.payer)}</td><td>${euro(p.amount)}</td><td>${p.model}</td><td>${status(p.receipt)}</td><td>${status(p.send)}</td><td>${i ? "20/07/2026" : today}</td></tr>`).join("")}</tbody></table></div></section><section class="panel pad"><span class="eyebrow">Modeles de recus</span><h2>Configuration fiscale</h2><div class="timeline">${receiptTemplates.map(t => `<div class="timeline-item"><strong>${t.name}</strong><p>${t.entity} - ${t.mode} - Signature ${t.signature}</p></div>`).join("")}</div></section></div>`;
}

function segments() {
  return `<div class="split">${panelList("Mes segments", [["Donateurs 2026", "apply-segment:Donateurs 2026"], ["Adhesions actives", "apply-segment:Adhesions actives"], ["Structures donatrices", "apply-segment:Structures donatrices"], ["Parents sans paiement recent", "apply-segment:Parents sans paiement recent"]], "Creer un segment", "create-view")}${panelList("Connexion segments/listes", [["Brevo - Liste parents", "sync-list:Brevo"], ["Mailchimp - Donateurs", "sync-list:Mailchimp"], ["Mailjet - Benevoles", "sync-list:Mailjet"]], "Lier a une liste emailing", "bulk-email")}</div>`;
}

function groupsView() {
  return `<section class="panel">${toolbar("Rechercher un nom de groupe")}<div class="toolbar thin"><div class="row-actions">${action("Ajouter un groupe", "add-group", "primary-btn")} ${action("Exporter", "export-current")}</div></div><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Nombre de contacts</th><th>Nombre de structures</th><th>Date d'ajout</th><th>Type de groupe</th><th>Etablissement</th></tr></thead><tbody>${groups.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.contacts}</td><td>${r.structures}</td><td>${r.date}</td><td>${r.type}</td><td>${r.establishment}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function interactionsView() {
  return `<section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Ajouter une interaction", "add-interaction", "primary-btn")} ${action("Synchroniser emails", "sync-email")} ${action("Exporter", "export-current")}</div></div><div class="table-wrap"><table><thead><tr><th>ID</th><th>Date</th><th>Contact / structure</th><th>Categorie</th><th>Libelle</th><th>Type</th><th>Utilisateur</th></tr></thead><tbody>${interactions.map(r=>`<tr><td>${r.id}</td><td>${r.date}</td><td>${escapeHtml(r.target)}</td><td>${r.category}</td><td>${r.label}</td><td>${r.type}</td><td>${r.user}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function linkagesView() {
  return `<section class="panel">${toolbar()}<div class="toolbar thin"><div class="row-actions">${action("Ajouter une liaison", "add-linkage", "primary-btn")} ${action("Exporter", "export-current")}</div></div><div class="table-wrap"><table><thead><tr><th>Contact A</th><th>Role A</th><th>Contact / structure B</th><th>Role B</th><th>Type de liaison</th></tr></thead><tbody>${linkages.map(r=>`<tr><td>${escapeHtml(r.a)}</td><td>${r.roleA}</td><td>${escapeHtml(r.b)}</td><td>${r.roleB}</td><td>${r.type}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function panelList(title, rows, btnLabel, btnAction) {
  return `<section class="panel pad"><div class="toolbar"><h2>${title}</h2>${action(btnLabel, btnAction, "primary-btn")}</div><div class="timeline">${rows.map(([label, key])=>`<button class="timeline-item" data-action="${key}"><strong>${label}</strong><p>Recherche sauvegardee, utilisable pour exports, emailing et actions.</p></button>`).join("")}</div></section>`;
}

function documentsView() {
  const folders = [["Tous les dossiers",""],["Recus", payments.filter(p => p.receipt === "Genere").length],["Contacts","0"],["Structures","0"],["Interactions", interactions.length],["Paiements", payments.length],["Engagements","0"],["Bordereaux","1"]];
  const docs = [["Recus","recu-lea-cohen-2026.pdf","Lea Cohen",today,"Genere"],["Interactions","appel-bsm.pdf","BSM PATRIMOINE","20/07/2026","Archive"],["Bordereaux","bordereau-cheques-014.pdf","Remise de cheques","18/07/2026","Pret"]];
  return `<div class="split"><section class="panel pad"><h2>Mes documents</h2><div class="folder-grid">${folders.map(f=>`<button data-action="open-folder:${f[0]}"><strong>${f[0]}</strong><span>${f[1]}</span></button>`).join("")}</div></section><section class="panel">${toolbar("Faites une recherche rapide par contact ou structure")}<div class="toolbar thin"><div class="row-actions">${action("Generer bordereau", "deposit-checks", "primary-btn")} ${action("Exporter", "export-current")}</div></div><div class="table-wrap"><table><thead><tr><th>Dossier</th><th>Nom du fichier</th><th>Source</th><th>Date</th><th>Statut</th></tr></thead><tbody>${docs.map(r=>`<tr>${r.map((c,i)=>`<td>${i===4?status(c):escapeHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section></div>`;
}

function importReportPanel() {
  if (!importReport) return "";
  const q = importReport.quality;
  const p = importReport.payments;
  const topTags = importReport.segmentation.topTags.slice(0, 5);
  const topGroups = importReport.segmentation.topGroups.slice(0, 5);
  const keyColumns = ["Email", "Prénom", "Nom", "Téléphone", "Adresse", "Code postal", "Ville", "Étiquettes de contact", "Groupes", "Nombre de paiements", "Montant total des paiements"];
  const fillRows = keyColumns.map(name => {
    const profile = importReport.columnProfiles.find(c => c.name === name);
    return profile ? `<tr><td>${escapeHtml(name)}</td><td>${profile.nonEmpty.toLocaleString("fr-FR")}</td><td>${profile.empty.toLocaleString("fr-FR")}</td><td>${profile.fillRate}%</td></tr>` : "";
  }).join("");
  return `<section class="panel pad import-report">
    <div class="toolbar clean"><div><span class="eyebrow">Analyse reelle de l'export</span><h2>${importReport.source.rows.toLocaleString("fr-FR")} lignes retenues - ${importReport.source.columns} colonnes</h2><p>${importReport.source.availableRows.toLocaleString("fr-FR")} lignes disponibles dans le fichier complet.</p></div>${action("Creer les champs manquants", "create-fields-from-report", "primary-btn")}</div>
    <div class="metric-grid">
      ${metric("Emails manquants", q.missingEmail.toLocaleString("fr-FR"), "A garder possible, mais limite emailing et dedoublonnage")}
      ${metric("Emails invalides", q.invalidEmail.toLocaleString("fr-FR"), "Bloquant avant import final")}
      ${metric("Doublons probables", (q.duplicateEmailGroups + q.duplicatePhoneGroups).toLocaleString("fr-FR"), "Groupes email ou telephone a verifier")}
      ${metric("Montant historique", euro(p.totalAmount), `${p.contactsWithPayments.toLocaleString("fr-FR")} contacts avec paiement`)}
    </div>
    <div class="report-grid">
      <div class="mini-block"><h3>Completude champs cles</h3><div class="table-wrap"><table><thead><tr><th>Champ</th><th>Rempli</th><th>Vide</th><th>Taux</th></tr></thead><tbody>${fillRows}</tbody></table></div></div>
      <div class="mini-block"><h3>Segmentation detectee</h3><div class="chip-list">${topTags.map(t => tag(`${t.label} (${t.count})`, "blue")).join("")}${topGroups.map(t => tag(`${t.label} (${t.count})`, "violet")).join("")}</div><div class="timeline">${importReport.importSimulation.steps.map(s => `<div class="timeline-item"><strong>${escapeHtml(s.name)}</strong><p>${escapeHtml(s.detail)}</p></div>`).join("")}</div></div>
    </div>
  </section>`;
}

function importsView() {
  return `${importReportPanel()}<section class="panel"><div class="toolbar"><h2>Tous mes imports</h2><div class="row-actions">${action("Telecharger le modele", "download-template")} ${action("Nouvel import", "import-new", "primary-btn")}</div></div><div class="table-wrap"><table><thead><tr><th>Statut</th><th>Date</th><th>Nom du fichier</th><th>Utilisateur</th><th>Type</th><th>Nb. lignes</th><th>Nb. erreurs</th><th>Elements crees</th><th>Elements mis a jour</th><th>Doublons</th><th>Lignes non importees</th><th></th></tr></thead><tbody>${imports.map((r,i)=>`<tr><td>${status(r.status)}</td><td>${r.date}</td><td><strong>${escapeHtml(r.file)}</strong></td><td>${r.user}</td><td>${r.type}</td><td>${Number(r.rows).toLocaleString("fr-FR")}</td><td>${Number(r.errors).toLocaleString("fr-FR")}</td><td>${Number(r.created).toLocaleString("fr-FR")}</td><td>${Number(r.updated).toLocaleString("fr-FR")}</td><td>${Number(r.duplicates).toLocaleString("fr-FR")}</td><td>${Number(r.rejected).toLocaleString("fr-FR")}</td><td>${action("Voir erreurs", `import-errors:${i}`)}</td></tr>`).join("")}</tbody></table></div><button class="import-drop" data-action="import-new"><strong>Prochain test</strong><p>On travaille sur 100 contacts pour l'instant: mapping, erreurs, doublons et performances seront simules sur cet echantillon.</p></button></section>`;
}

function appsView() {
  return `<section class="panel pad"><div class="toolbar"><h2>Connecter les applis du CRM Sinai</h2><div class="segmented">${["Toutes","Collecter","Communiquer","Recruter","Stats","Comptabilite"].map(x=>action(x, `filter-apps:${x}`)).join("")}</div></div><div class="integration-grid">${apps.map(a=>`<div class="integration"><header><strong>${a[0]}</strong><span class="toggle ${a[2]?"on":""}"></span></header><p>${a[1]}</p>${action(a[2]?"Configurer":"Connecter", `${a[2]?"configure-app":"connect-app"}:${a[0]}`)}</div>`).join("")}</div></section>`;
}

function stats() {
  return `<div class="hero-grid"><section class="panel pad"><span class="eyebrow">Statistique sinai</span><div class="toolbar clean"><h2>Tableau de bord personnalisable</h2>${action("Ajouter une vue", "create-view", "primary-btn")}</div><div class="metric-grid">${metric("Contacts", records.filter(r=>r.kind==="Contact").length, "Segments actifs")}${metric("Structures", records.filter(r=>r.kind==="Structure").length, "Personnes morales")}${metric("Dons 2026", euro(payments.filter(p => p.type === "Don").reduce((s,p)=>s+p.amount,0)), "Progression collecte")}${metric("Taux ouverture", "42%", "Emailings connectes")}</div><div class="bar-chart"><div class="bar" style="height:35%"><span>Jan</span></div><div class="bar" style="height:54%"><span>Fev</span></div><div class="bar" style="height:65%"><span>Mar</span></div><div class="bar" style="height:82%"><span>Avr</span></div><div class="bar" style="height:78%"><span>Mai</span></div><div class="bar" style="height:92%"><span>Juin</span></div></div></section><section class="panel pad"><span class="eyebrow">Campagnes</span><h2>Comparaison de collecte</h2><div class="donut"></div><p>Direct, HelloAsso, iRaiser, Weezevent et imports manuels.</p><div class="timeline">${savedViews.map(v => `<button class="timeline-item" data-action="load-view:${v.name}"><strong>${v.name}</strong><p>${v.module} - ${v.owner}</p></button>`).join("")}</div></section></div>`;
}

function settingsView() {
  const tabs = ["Etiquettes manuelles","Etiquettes automatiques","Champs natifs","Champs personnalises & familles de champs"];
  return `<div class="split"><section class="panel"><div class="toolbar"><h2>Parametres ${state.section !== "PARAMETRES" ? state.section : ""}</h2>${action("Creer un champ", "add-field", "primary-btn")}</div><div class="tabs">${tabs.map(t=>`<button class="tab-btn ${t.includes("Champs personnalises") ? "active" : ""}" data-action="settings-tab:${t}">${t}</button>`).join("")}</div><div class="table-wrap"><table><thead><tr><th>Nom</th><th>Type</th><th>Valeur(s)</th><th>Obligatoire ?</th><th>Accessible aux profils</th></tr></thead><tbody>${customFields.map(r=>`<tr><td>${escapeHtml(r.name)}</td><td>${r.type}</td><td>${escapeHtml(r.values)}</td><td>${r.required}</td><td>${r.profile}</td></tr>`).join("")}</tbody></table></div></section><section class="panel pad"><span class="eyebrow">Configuration Sinai</span><h2>Parametres internes</h2><div class="timeline"><button class="timeline-item" data-action="add-field"><strong>Champs et familles</strong><p>Ajouter des champs aux contacts, paiements, groupes et structures.</p></button><button class="timeline-item" data-action="add-receipt-template"><strong>Recus fiscaux</strong><p>Modeles, signatures, entites emettrices et statuts d'envoi.</p></button><button class="timeline-item" data-action="deposit-checks"><strong>Remise de cheques</strong><p>Bordereaux numerotes et lots de rapprochement.</p></button></div></section></div>`;
}

function admin() {
  return `<div class="split"><section class="panel"><div class="toolbar"><h2>Utilisateurs et profils</h2>${action("Ajouter un utilisateur","add-user","primary-btn")}</div><div class="table-wrap"><table><thead><tr><th>Email</th><th>Prenom</th><th>Nom</th><th>Profil</th><th>Derniere activite</th></tr></thead><tbody>${users.map(r=>`<tr><td>${escapeHtml(r.email)}</td><td>${escapeHtml(r.first)}</td><td>${escapeHtml(r.last)}</td><td>${r.profile}</td><td>${r.lastSeen}</td></tr>`).join("")}</tbody></table></div></section><section class="panel pad"><span class="eyebrow">Organisation</span><h2>Les institutions Sinai</h2><div class="timeline"><button class="timeline-item" data-action="edit-organization"><strong>Organisation</strong><p>Coordonnees, statut legal, secteur, logo, entites emettrices.</p></button><button class="timeline-item" data-action="open-profiles"><strong>Profils granulaires</strong><p>Lecture, modification, exports, paiements, recus, comptabilite et parametrage.</p></button><button class="timeline-item" data-action="goto-audit"><strong>Journal d'audit</strong><p>Historique des imports, exports, modifications sensibles et generations de fichiers.</p></button></div></section></div>`;
}

function render() {
  setHeader();
  renderNav();
  const views = { home, stats, crm, pay: paymentsView, docs: documentsView, imports: importsView, apps: appsView, settings: settingsView, admin };
  content.innerHTML = views[state.view]();
  renderDrawer();
  bind();
}

function renderDrawer() {
  if (!state.drawer) {
    drawer.className = "drawer";
    drawer.innerHTML = "";
    return;
  }
  drawer.className = "drawer open";
  const views = {
    actions: `<h2>Actions de masse</h2><p>Operations appliquees a la vue active.</p>${action("Exporter la vue", "export-current", "primary-btn")}${action("Appliquer une etiquette", "bulk-tag")}${action("Preparer un emailing", "bulk-email")}${action("Detecter les doublons", "dedupe")}${action("Fermer", "close-drawer")}`,
    search: `<h2>Recherche avancee</h2><p>Combine criteres, tags et statuts.</p><div class="drawer-grid">${field("Contient", "contains", state.query)}${selectField("Module", "module", ["Tous","Contacts","Structures","Paiements"], "Tous")}${selectField("Statut paiement", "paymentStatus", ["Tous","Valide","En attente","A generer"], "Tous")}</div>${action("Appliquer", "apply-advanced-search", "primary-btn")}${action("Fermer", "close-drawer")}`,
    dedupe: `<h2>Doublons potentiels</h2><p>Controle avant fusion.</p><div class="timeline"><div class="timeline-item"><strong>Lea Cohen / Lea C.</strong><p>Meme email secondaire, adresse Paris 16.</p></div><div class="timeline-item"><strong>BSM PATRIMOINE</strong><p>SIREN identique, nom legerement different.</p></div></div>${action("Creer une tache de nettoyage", "create-cleanup-task", "primary-btn")}${action("Fermer", "close-drawer")}`,
    audit: `<h2>Journal d'audit</h2><div class="timeline"><div class="timeline-item"><strong>${today}</strong><p>Export CSV prepare depuis la vue active.</p></div><div class="timeline-item"><strong>18/07/2026</strong><p>Import paiements-juillet.xlsx a reprendre.</p></div><div class="timeline-item"><strong>11/07/2026</strong><p>Erreur d'import structures-brouillon.csv.</p></div></div>${action("Exporter le journal", "export-audit", "primary-btn")}${action("Fermer", "close-drawer")}`,
  };
  drawer.innerHTML = `<button class="drawer-close" data-action="close-drawer">X</button>${views[state.drawer] || ""}`;
}

function bind() {
  document.querySelectorAll("[data-view]").forEach(el => el.addEventListener("click", () => {
    state.view = el.dataset.view;
    state.section = el.dataset.section || titles[state.view][0];
    state.query = "";
    state.drawer = null;
    state.showDetail = true;
    render();
  }));
  document.querySelectorAll("[data-action]").forEach(el => el.addEventListener("click", () => handleAction(el.dataset.action)));
  document.querySelectorAll("[data-record]").forEach(el => el.addEventListener("click", () => { state.selectedRecord = el.dataset.record; state.showDetail = true; render(); }));
  document.querySelectorAll("[data-tab]").forEach(el => el.addEventListener("click", () => { state.tab = el.dataset.tab; render(); }));
  document.querySelector("#pageSearch")?.addEventListener("input", e => {
    const cursor = e.target.selectionStart || e.target.value.length;
    state.query = e.target.value;
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
  render();
}

function handleAction(key) {
  if (!key) return;
  if (key.startsWith("add-payment:")) return openModal("payment", { type: key.split(":")[1] || "Don" });
  if (key.startsWith("edit-payment:")) return openModal("payment", { id: key.split(":")[1] });
  if (key.startsWith("import-errors:")) return showImportErrors(Number(key.split(":")[1]));
  if (key.startsWith("connect-app:") || key.startsWith("configure-app:")) return openModal("app", { name: key.split(":")[1], connected: key.startsWith("configure") });
  if (key.startsWith("open-folder:")) return notify(`Dossier ${key.split(":")[1]} ouvert`);
  if (key.startsWith("settings-tab:")) return notify(`${key.split(":")[1]} selectionne`);
  if (key.startsWith("apply-segment:")) { state.query = key.split(":")[1].split(" ")[0]; return render(); }
  if (key.startsWith("sync-list:")) return notify(`Synchronisation ${key.split(":")[1]} preparee`);
  if (key.startsWith("filter-apps:")) return notify(`Filtre ${key.split(":")[1]} applique`);
  if (key.startsWith("load-view:")) return notify(`Vue ${key.split(":")[1]} chargee`);

  const actions = {
    "quick-add": () => openQuickAdd(),
    "add-contact": () => openModal("contact"),
    "add-structure": () => openModal("structure"),
    "add-user": () => openModal("user"),
    "add-field": () => openModal("field"),
    "add-group": () => openModal("group"),
    "add-interaction": () => openModal("interaction"),
    "add-linkage": () => openModal("linkage"),
    "add-receipt-template": () => openModal("receiptTemplate"),
    "create-view": () => openModal("view"),
    "import-new": () => openModal("import"),
    "download-template": () => downloadCsv("modele-import-sinai.csv", [{ prenom: "Lea", nom: "Cohen", email: "lea@example.org", telephone: "+33...", etiquette: "Parent" }]),
    "export-current": () => downloadCsv(`export-${state.view}.csv`, currentRows()),
    "export-audit": () => downloadCsv("journal-audit.csv", [{ date: today, action: "Export", utilisateur: "Equipe Sinai" }]),
    "reset-filters": () => { state.query = ""; notify("Filtres reinitialises"); render(); },
    "save-view": () => openModal("view"),
    "advanced-search": () => { state.drawer = "search"; render(); },
    "open-actions": () => { state.drawer = "actions"; render(); },
    "close-drawer": () => { state.drawer = null; render(); },
    "apply-advanced-search": () => { state.query = "Don"; state.drawer = null; notify("Recherche avancee appliquee"); render(); },
    "create-fields-from-report": () => createFieldsFromReport(),
    "dedupe": () => { state.drawer = "dedupe"; render(); },
    "create-cleanup-task": () => notify("Tache de nettoyage creee"),
    "bulk-tag": () => openModal("bulkTag"),
    "bulk-email": () => openModal("email"),
    "send-email": () => openModal("email"),
    "sync-email": () => notify("Synchronisation email lancee"),
    "generate-receipts": () => { payments.forEach(p => { if (p.receipt === "A generer") p.receipt = "Genere"; }); saveCrmData(); notify("Recus manquants generes"); render(); },
    "deposit-checks": () => openModal("deposit"),
    "edit-record": () => openModal("editRecord"),
    "delete-record": () => deleteSelectedRecord(),
    "edit-organization": () => openModal("organization"),
    "open-profiles": () => openModal("profiles"),
    "close-detail": () => { state.showDetail = false; render(); },
    "open-detail": () => { state.showDetail = true; render(); },
    "goto-receipts": () => navigate("pay", "Recus"),
    "goto-imports": () => navigate("imports", "IMPORTS"),
    "goto-apps": () => navigate("apps", "Toutes les applis"),
    "goto-segments": () => navigate("crm", "Segments"),
    "goto-audit": () => { state.drawer = "audit"; render(); },
    "goto-billetterie": () => navigate("pay", "Billetterie"),
  };
  (actions[key] || (() => notify(`${key} execute`)))();
}

function modalShell(kind, eyebrow, title, body, submit = "Enregistrer") {
  if (dialog.open) dialog.close();
  dialog.className = kind === "editRecord" ? "wide-dialog" : "";
  dialogContent.innerHTML = `<form class="modal" data-form="${kind}">
    <header><div><span class="eyebrow">${eyebrow}</span><h2>${title}</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">X</button></header>
    <div class="form-grid">${body}</div>
    <footer><button type="button" data-modal-close>Annuler</button><button class="primary-btn" type="submit">${submit}</button></footer>
  </form>`;
  dialog.showModal();
  dialogContent.querySelector("form").addEventListener("submit", submitForm);
  dialogContent.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => dialog.close()));
  dialogContent.querySelector("input, select, textarea")?.focus();
}

function openQuickAdd() {
  if (dialog.open) dialog.close();
  dialog.className = "";
  dialogContent.innerHTML = `<div class="modal">
    <header><div><span class="eyebrow">Creation rapide</span><h2>Ajouter dans le CRM Sinai</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">X</button></header>
    <div class="quick-grid">
      ${action("Contact", "add-contact", "quick-card")}
      ${action("Structure", "add-structure", "quick-card")}
      ${action("Paiement", "add-payment:Don", "quick-card")}
      ${action("Import", "import-new", "quick-card")}
      ${action("Utilisateur", "add-user", "quick-card")}
      ${action("Champ", "add-field", "quick-card")}
      ${action("Groupe", "add-group", "quick-card")}
      ${action("Interaction", "add-interaction", "quick-card")}
    </div>
  </div>`;
  dialog.showModal();
  dialogContent.querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => dialog.close()));
  dialogContent.querySelectorAll("[data-action]").forEach(btn => btn.addEventListener("click", () => handleAction(btn.dataset.action)));
}

function openModal(kind, options = {}) {
  const recordOptions = records.map(r => r.name);
  const selected = records.find(r => r.id === state.selectedRecord) || records[0];
  const modals = {
    contact: () => modalShell("contact", "Contact", "Ajouter un contact", `${selectField("Civilite", "civility", ["Mme","M.","Famille"], "Mme")}${field("Prenom", "first", "Nouveau")}${field("Nom", "last", "Contact")}${field("Email", "email", "nouveau@example.org", "email")}${field("Telephone", "phone", "+33 ")}${field("Adresse", "address", "Paris")}${field("Famille", "family", "Famille")}${selectField("Role foyer", "role", ["Mere","Pere","Enfant","Tuteur","Autre"], "Autre")}${field("Etiquettes", "tags", "Parent, Donateur")}`),
    structure: () => modalShell("structure", "Structure", "Ajouter une structure", `${field("Nom", "name", "Nouvelle structure")}${field("Email", "email", "structure@example.org", "email")}${field("Telephone", "phone", "+33 ")}${field("Adresse", "address", "Paris")}${field("SIREN", "siren", "")}${selectField("Forme juridique", "legal", ["Association","Fondation","SAS","SARL","Autre"], "Association")}${field("Etiquettes", "tags", "Structure, Partenaire")}`),
    payment: () => modalShell("payment", "Paiement", options.id ? "Modifier un paiement" : "Ajouter un paiement", `${selectField("Payeur", "payer", recordOptions, recordOptions[0])}${field("Montant", "amount", "180", "number", "min='0' step='1'")}${selectField("Type", "type", ["Don","Adhesion","Billetterie","Crowdfunding","Boutique"], options.type || "Don")}${selectField("Moyen", "method", ["CB","Cheque","Virement","SEPA","Especes"], "CB")}${selectField("Statut", "status", ["En attente","Valide"], "Valide")}${selectField("Recurrence", "recurrence", ["Ponctuel","Mensuel","Annuel","Engagement"], "Ponctuel")}${field("Source", "source", "Manuel")}${selectField("Modele de recu", "model", receiptTemplates.map(t => t.name), "Don standard")}`),
    user: () => modalShell("user", "Administration", "Ajouter un utilisateur", `${field("Email", "email", "nouveau@sinai.example", "email")}${field("Prenom", "first", "Nouveau")}${field("Nom", "last", "Utilisateur")}${selectField("Profil", "profile", ["Administrateur","Collecte","Comptabilite","Lecture seule"], "Lecture seule")}`),
    field: () => modalShell("field", "Parametres", "Ajouter un champ personnalise", `${field("Nom du champ", "name", "Nouvelle information")}${selectField("Type", "type", ["Texte","Date","Montant","Liste","Liaison","Case a cocher"], "Texte")}${field("Valeurs", "values", "Libre")}${selectField("Obligatoire", "required", ["Oui","Non"], "Non")}${selectField("Accessible aux profils", "profile", ["Tous","Administrateur","Collecte","Comptabilite"], "Tous")}`),
    group: () => modalShell("group", "Groupe", "Creer un groupe", `${field("Nom du groupe", "name", "Nouveau groupe")}${selectField("Type", "type", ["Equipe","Famille","Gouvernance","Mecenat","Evenement"], "Equipe")}${field("Etablissement", "establishment", "Sinai")}`),
    interaction: () => modalShell("interaction", "Interaction", "Ajouter une interaction", `${selectField("Contact / structure", "target", recordOptions, recordOptions[0])}${selectField("Categorie", "category", ["Collecte","Comptabilite","Benevolat","Evenement","Scolarite"], "Collecte")}${field("Libelle", "label", "Relance")}${selectField("Type", "type", ["Email","Appel","Rendez-vous","Note"], "Email")}`),
    linkage: () => modalShell("linkage", "Liaison", "Ajouter une liaison", `${selectField("Entite A", "a", recordOptions, recordOptions[0])}${field("Role A", "roleA", "Parent")}${selectField("Entite B", "b", recordOptions, recordOptions[1] || recordOptions[0])}${field("Role B", "roleB", "Parent")}${field("Type de liaison", "type", "Famille")}`),
    receiptTemplate: () => modalShell("receiptTemplate", "Recus fiscaux", "Ajouter un modele de recu", `${field("Nom du modele", "name", "Nouveau modele")}${field("Entite emettrice", "entity", "Association Sinai")}${selectField("Mode", "mode", ["Automatique","Validation","Manuel"], "Validation")}${field("Signature", "signature", "Direction")}`),
    view: () => modalShell("view", "Vue sauvegardee", "Creer une vue", `${field("Nom", "name", `Vue ${state.section}`)}${selectField("Module", "module", ["Contacts","Paiements","Imports","Administration"], state.view === "pay" ? "Paiements" : "Contacts")}${field("Proprietaire", "owner", "Equipe Sinai")}`),
    import: () => modalShell("import", "Import", "Nouvel import", `${field("Nom du fichier", "file", "contacts-sinai-import.csv")}${selectField("Type", "type", ["Contacts","Structures","Paiements","Interactions"], "Contacts")}${field("Nombre de lignes", "rows", "100", "number", "min='1'")}${selectField("Mode doublons", "mode", ["Detecter et signaler","Mettre a jour si email identique","Importer sans fusion"], "Detecter et signaler")}`, "Analyser l'import"),
    bulkTag: () => modalShell("bulkTag", "Action de masse", "Appliquer une etiquette", `${field("Etiquette", "tag", "A verifier")}${field("Nombre d'elements", "count", String(currentRows().length), "number", "readonly")}`),
    email: () => modalShell("email", "Emailing", "Preparer un email", `${field("Sujet", "subject", "Message des institutions Sinai")}${selectField("Destinataires", "target", ["Vue active","Segment donateurs","Parents","Structures"], "Vue active")}${field("Nombre de destinataires", "count", String(currentRows().length), "number", "readonly")}`),
    deposit: () => modalShell("deposit", "Remise de cheques", "Generer un bordereau", `${field("Numero de lot", "lot", `CHQ-2026-${String(imports.length + 14).padStart(3, "0")}`)}${field("Banque", "bank", "Banque Sinai")}${field("Nombre de cheques", "checks", String(payments.filter(p => p.method === "Cheque").length), "number")}`),
    editRecord: () => selected.kind === "Structure"
      ? modalShell("editRecord", "Fiche structure", `Modifier ${selected.name}`, `${field("Nom", "name", selected.name)}${field("Email", "email", selected.email || "", "email")}${field("Telephone", "phone", selected.phone || "")}${field("Adresse", "address", selected.address || "")}${field("SIREN", "siren", selected.siren || "")}${field("Forme juridique", "legal", selected.legal || "")}${field("Etiquettes", "tags", (selected.tags || []).join(", "))}${field("Groupes", "groups", (selected.groups || []).join(", "))}${field("Segments", "segments", (selected.segments || []).join(", "))}${field("Montant total", "amount", selected.amount || 0, "number", "step='0.01'")}${field("Nombre de paiements", "payments", selected.payments || 0, "number")}${field("Nombre d'interactions", "interactions", selected.interactions || 0, "number")}${field("Source", "source", selected.source || "")}`)
      : modalShell("editRecord", "Fiche contact", `Modifier ${selected.name}`, `${selectField("Civilite", "civility", ["","Mme","M.","Famille"], selected.civility || "")}${field("Prenom", "first", selected.first || "")}${field("Nom", "last", selected.last || "")}${field("Nom affiche", "name", selected.name || "")}${field("Email principal", "email", selected.email || "", "email")}${field("Emails secondaires", "secondaryEmails", selected.secondaryEmails || "")}${field("Telephone", "phone", selected.phone || "")}${field("Telephone 2", "phone2", selected.phone2 || "")}${field("Telephone pere", "fatherPhone", selected.fatherPhone || "")}${field("Telephone mere", "motherPhone", selected.motherPhone || "")}${field("Date de naissance", "dob", selected.dob || "")}${field("Adresse", "address", selected.address || "")}${field("Code postal", "zip", selected.zip || "")}${field("Ville", "city", selected.city || "")}${field("Pays", "country", selected.country || "")}${field("Nom unique famille", "family", selected.family || "")}${field("Role de foyer", "role", selected.role || "")}${field("Type de foyer", "householdType", selected.householdType || "")}${field("Statut parent", "parentStatus", selected.parentStatus || "")}${field("Statut enfant", "childStatus", selected.childStatus || "")}${field("Agent", "agent", selected.agent || "")}${field("Profession", "profession", selected.profession || "")}${field("Ecole actuelle", "school", selected.school || "")}${field("Etiquettes", "tags", (selected.tags || []).join(", "))}${field("Segments", "segments", (selected.segments || []).join(", "))}${field("Groupes", "groups", (selected.groups || []).join(", "))}${field("Roles de groupes", "groupRoles", (selected.groupRoles || []).join(", "))}${field("Montant total", "amount", selected.amount || 0, "number", "step='0.01'")}${field("Montant 2025", "amount2025", selected.amount2025 || 0, "number", "step='0.01'")}${field("Montant 2026", "amount2026", selected.amount2026 || 0, "number", "step='0.01'")}${field("Nombre de paiements", "payments", selected.payments || 0, "number")}${field("Nombre d'interactions", "interactions", selected.interactions || 0, "number")}${field("Nature du donateur", "donorNature", selected.donorNature || "")}${field("Sources paiement", "paymentSources", (selected.paymentSources || []).join(", "))}${field("Moyens paiement", "paymentMethods", (selected.paymentMethods || []).join(", "))}${field("Mode d'envoi recu", "receipt", selected.receipt || "")}${field("Format recu", "receiptFormat", selected.receiptFormat || "")}${field("Appellation courrier", "mailingName", selected.mailingName || "")}${field("Denomination export", "exportName", selected.exportName || "")}${field("Date ajout", "dateAdded", selected.dateAdded || "")}${field("Derniere modification", "dateModified", selected.dateModified || "")}${textareaField("Commentaire", "comment", selected.comment || "")}`),
    organization: () => modalShell("organization", "Organisation", "Modifier Les institutions Sinai", `${field("Nom legal", "name", "Les institutions Sinai")}${field("Adresse", "address", "Paris")}${field("Secteur", "sector", "Education, association, collecte")}${field("Email contact", "email", "contact@sinai.example", "email")}`),
    profiles: () => modalShell("profiles", "Profils", "Configurer un profil", `${selectField("Profil", "profile", ["Administrateur","Collecte","Comptabilite","Lecture seule"], "Collecte")}${selectField("Exports", "export", ["Autorise","Interdit"], "Autorise")}${selectField("Recus fiscaux", "receipt", ["Autorise","Validation requise","Interdit"], "Validation requise")}`),
    app: () => modalShell("app", "Application", `${options.connected ? "Configurer" : "Connecter"} ${options.name}`, `${field("Nom", "name", options.name)}${selectField("Mode", "mode", ["OAuth","Cle API","Webhook"], "OAuth")}${field("Frequence de sync", "sync", "Toutes les nuits")}`),
  };
  (modals[kind] || modals.contact)();
}

function submitForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const kind = form.dataset.form;
  const data = Object.fromEntries(new FormData(form).entries());
  const required = [...form.querySelectorAll("[required], [data-required='true']")].filter(el => !el.readOnly && !String(el.value).trim());
  if (required.length) {
    notify("Complete les champs obligatoires");
    return;
  }
  const handlers = {
    contact: () => {
      const record = { id: nextId("C", records), kind: "Contact", civility: data.civility, first: data.first, last: data.last, name: `${data.first} ${data.last}`.trim(), email: data.email, phone: data.phone, tags: splitTags(data.tags), groups: [], segments: [], amount: 0, payments: 0, interactions: 0, address: data.address, receipt: "Email", source: "Manuel", family: data.family, role: data.role };
      records.unshift(record); state.selectedRecord = record.id; navigate("crm", "Contacts");
    },
    structure: () => {
      const record = { id: nextId("S", records), kind: "Structure", name: data.name, email: data.email, phone: data.phone, tags: splitTags(data.tags), groups: [], segments: [], amount: 0, payments: 0, interactions: 0, address: data.address, siren: data.siren, legal: data.legal, source: "Manuel" };
      records.unshift(record); state.selectedRecord = record.id; navigate("crm", "Structures");
    },
    payment: () => {
      const payer = records.find(r => r.name === data.payer) || records[0];
      payments.unshift({ id: nextId("PAY-SIN", payments), date: today, payer: payer.name, email: payer.email, amount: Number(data.amount), type: data.type, status: data.status, recurrence: data.recurrence, method: data.method, source: data.source, receipt: data.type === "Don" ? "A generer" : "Non eligible", send: "Non envoye", model: data.model });
      payer.amount += Number(data.amount); payer.payments += 1; navigate("pay", ({ Don: "Dons", Adhesion: "Adhesions", Billetterie: "Billetterie", Crowdfunding: "Crowdfunding", Boutique: "Boutique" }[data.type] || "Tous les paiements"));
    },
    user: () => { users.unshift({ email: data.email, first: data.first, last: data.last, profile: data.profile, lastSeen: "Invite envoye" }); navigate("admin", "Utilisateurs"); },
    field: () => { customFields.unshift({ name: data.name, type: data.type, values: data.values, required: data.required, profile: data.profile }); navigate("settings", "Contacts"); },
    group: () => { groups.unshift({ name: data.name, contacts: 0, structures: 0, date: today, type: data.type, establishment: data.establishment }); navigate("crm", "Groupes"); },
    interaction: () => { interactions.unshift({ id: nextId("I", interactions), date: today, target: data.target, category: data.category, label: data.label, type: data.type, user: "Equipe Sinai" }); navigate("crm", "Interactions"); },
    linkage: () => { linkages.unshift({ a: data.a, roleA: data.roleA, b: data.b, roleB: data.roleB, type: data.type }); navigate("crm", "Liaisons"); },
    receiptTemplate: () => { receiptTemplates.unshift({ name: data.name, entity: data.entity, mode: data.mode, signature: data.signature, active: "Oui" }); navigate("pay", "Recus"); },
    view: () => { savedViews.unshift({ name: data.name, module: data.module, owner: data.owner }); navigate("stats", "Statistique sinai"); },
    import: () => { const rows = Number(data.rows); imports.unshift({ status: "A reprendre", date: today, file: data.file, user: "Equipe Sinai", type: data.type, rows, errors: Math.max(1, Math.round(rows * 0.008)), created: Math.round(rows * 0.92), updated: Math.round(rows * 0.07), duplicates: Math.round(rows * 0.004), rejected: Math.max(1, Math.round(rows * 0.008)) }); navigate("imports", "IMPORTS"); },
    bulkTag: () => notify(`Etiquette "${data.tag}" appliquee a ${data.count} elements`),
    email: () => notify(`Email "${data.subject}" prepare pour ${data.count} destinataires`),
    deposit: () => notify(`Bordereau ${data.lot} genere`),
    editRecord: () => {
      const r = records.find(item => item.id === state.selectedRecord);
      if (r) {
        [
          "civility", "first", "last", "name", "email", "secondaryEmails", "phone", "phone2",
          "fatherPhone", "motherPhone", "dob", "address", "zip", "city", "country", "family",
          "role", "householdType", "parentStatus", "childStatus", "agent", "profession", "school",
          "donorNature", "receipt", "receiptFormat", "mailingName", "exportName", "dateAdded",
          "dateModified", "comment", "siren", "legal", "source"
        ].forEach(key => {
          if (Object.prototype.hasOwnProperty.call(data, key)) r[key] = data[key];
        });
        ["tags", "segments", "groups", "groupRoles", "paymentSources", "paymentMethods"].forEach(key => {
          if (Object.prototype.hasOwnProperty.call(data, key)) r[key] = splitTags(data[key]);
        });
        ["amount", "amount2025", "amount2026", "payments", "interactions"].forEach(key => {
          if (Object.prototype.hasOwnProperty.call(data, key)) r[key] = Number(data[key] || 0);
        });
        if (!r.name && (r.first || r.last)) r.name = `${r.first || ""} ${r.last || ""}`.trim();
        state.tab = "Details";
      }
      render();
    },
    organization: () => notify("Organisation mise a jour"),
    profiles: () => notify(`Profil ${data.profile} configure`),
    app: () => notify(`${data.name} configure en mode ${data.mode}`),
  };
  dialog.close();
  (handlers[kind] || (() => notify("Action enregistree")))();
  saveCrmData();
  notify("Operation enregistree");
}

function deleteSelectedRecord() {
  const index = records.findIndex(record => record.id === state.selectedRecord);
  if (index < 0) return notify("Aucune fiche selectionnee");
  const record = records[index];
  const ok = window.confirm(`Supprimer definitivement ${record.name || record.id} du CRM Sinai ?`);
  if (!ok) return;
  records.splice(index, 1);
  state.selectedRecord = records[0]?.id || "";
  saveCrmData();
  render();
  notify("Fiche supprimee");
}

function splitTags(value) {
  return String(value || "").split(",").map(v => v.trim()).filter(Boolean);
}

function showImportErrors(index) {
  const item = imports[index];
  if (!item) return;
  const details = item.report && importReport ? [
    ["Emails manquants", `${importReport.quality.missingEmail} lignes sans email principal.`],
    ["Emails invalides", `${importReport.quality.invalidEmail} lignes a corriger avant import final.`],
    ["Doublons email", `${importReport.quality.duplicateEmailGroups} groupes detectes sur l'echantillon.`],
    ["Doublons telephone", `${importReport.quality.duplicatePhoneGroups} groupes detectes sur l'echantillon.`],
    ["Adresses manquantes", `${importReport.quality.missingAddress} lignes sans adresse.`],
  ] : [
    ["Ligne 14", "Email invalide ou manquant."],
    ["Ligne 38", "Doublon potentiel sur telephone."],
    ["Ligne 57", "Code postal non reconnu."],
  ];
  state.drawer = null;
  drawer.className = "drawer open";
  drawer.innerHTML = `<button class="drawer-close" data-action="close-drawer">X</button><h2>Erreurs d'import</h2><p>${escapeHtml(item.file)} - ${Number(item.errors).toLocaleString("fr-FR")} controles bloquants ou a verifier.</p><div class="timeline">${details.map(([title, text]) => `<div class="timeline-item"><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`).join("")}</div>${action("Telecharger erreurs CSV", "download-template", "primary-btn")}${action("Reprendre import", "import-new")}`;
  bind();
}

function createFieldsFromReport() {
  if (!importReport) return notify("Aucun rapport d'import charge");
  let added = 0;
  importReport.recommendedCustomFields.forEach(fieldInfo => {
    if (!customFields.some(f => f.name === fieldInfo.name)) {
      customFields.unshift({ name: fieldInfo.name, type: "Texte", values: `Rempli a ${fieldInfo.fillRate}%`, required: "Non", profile: "Tous" });
      added += 1;
    }
  });
  saveCrmData();
  navigate("settings", "Contacts");
  notify(`${added} champs crees depuis le rapport`);
}

function downloadCsv(filename, rows) {
  const list = rows.length ? rows : [{}];
  const headers = Object.keys(list[0]);
  const csv = [headers.join(","), ...list.map(row => headers.map(h => csvCell(row[h])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  notify(`${filename} telecharge`);
}

function csvCell(value) {
  const text = String(value ?? "").replace(/"/g, '""');
  return `"${text}"`;
}

document.querySelector("#newRecordBtn").addEventListener("click", () => handleAction("quick-add"));
document.querySelector("#dupBtn").addEventListener("click", () => handleAction("dedupe"));
document.querySelector("#importBtn").addEventListener("click", () => handleAction("import-new"));
document.querySelector("#exportBtn").addEventListener("click", () => handleAction("export-current"));

render();
