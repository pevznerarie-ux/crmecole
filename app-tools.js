/* =========================================================================
   CRM Sinaï — outils d'interface (chargé en dernier, après app.js et
   app-views.js ; les trois fichiers partagent les mêmes variables globales)
   Sections :
     A. Boîtes de dialogue intégrées (confirmer / saisir) — remplacent
        window.confirm / window.prompt
     B. Menus contextuels
     C. Recherche globale (Ctrl/Cmd + K)
     D. Adresse de page (bouton Retour du navigateur / du téléphone)
     E. Exports (Excel / CSV) et envoi d'emails groupés
     F. Actions groupées sur les contacts sélectionnés
     G. Écouteurs globaux et démarrage
   ========================================================================= */

/* ---------- A. Boîtes de dialogue intégrées ----------------------------- */

const askDialog = () => document.querySelector("#askDialog");

// Confirmation dans le style de l'app (au lieu de la fenêtre grise du
// navigateur). Renvoie une promesse : true si l'utilisateur confirme.
function uiConfirm(message, opts = {}) {
  return new Promise(resolve => {
    const d = askDialog();
    if (d.open) d.close();
    d.innerHTML = `<div class="ask${opts.danger ? " ask-danger" : ""}">
      <div class="ask-icon">${icon(opts.danger ? "trash" : "help", 20)}</div>
      <h2>${escapeHtml(opts.title || "Confirmer")}</h2>
      <p>${escapeHtml(message).replace(/\n/g, "<br>")}</p>
      <footer><button type="button" data-ask="0">${escapeHtml(opts.cancelLabel || "Annuler")}</button><button type="button" class="${opts.danger ? "danger-btn" : "primary-btn"}" data-ask="1">${escapeHtml(opts.okLabel || "Confirmer")}</button></footer>
    </div>`;
    const done = value => { d.oncancel = null; if (d.open) d.close(); resolve(value); };
    d.querySelectorAll("[data-ask]").forEach(btn => { btn.onclick = () => done(btn.dataset.ask === "1"); });
    d.oncancel = e => { e.preventDefault(); done(false); };
    d.showModal();
    d.querySelector('[data-ask="1"]').focus();
  });
}

// Saisie d'une valeur courte (nom d'un segment, d'une catégorie...). Renvoie
// le texte saisi, ou null si l'utilisateur annule.
function uiPrompt(label, value = "", opts = {}) {
  return new Promise(resolve => {
    const d = askDialog();
    if (d.open) d.close();
    d.innerHTML = `<form class="ask">
      <h2>${escapeHtml(opts.title || label)}</h2>
      ${opts.title ? `<p>${escapeHtml(label)}</p>` : ""}
      <input type="text" name="value" value="${escapeHtml(value)}" placeholder="${escapeHtml(opts.placeholder || "")}" autocomplete="off" ${opts.list ? `list="askList"` : ""}>
      ${opts.list ? `<datalist id="askList">${opts.list.map(v => `<option value="${escapeHtml(v)}">`).join("")}</datalist>` : ""}
      <footer><button type="button" data-ask="0">Annuler</button><button type="submit" class="primary-btn">${escapeHtml(opts.okLabel || "Valider")}</button></footer>
    </form>`;
    const input = d.querySelector("input");
    const done = v => { d.oncancel = null; if (d.open) d.close(); resolve(v); };
    d.querySelector("form").onsubmit = e => { e.preventDefault(); done(input.value.trim() || null); };
    d.querySelector('[data-ask="0"]').onclick = () => done(null);
    d.oncancel = e => { e.preventDefault(); done(null); };
    d.showModal();
    input.focus();
    input.select();
  });
}

/* ---------- B. Menus contextuels ---------------------------------------- */

let openMenuAnchor = null;

function closeMenu() {
  document.querySelector(".menu")?.remove();
  document.querySelector(".menu-scrim")?.remove();
  openMenuAnchor = null;
}

// items : [{ label, action, icon, danger, hint }] ou "-" pour un séparateur.
// Sur téléphone, le menu devient une feuille qui monte du bas de l'écran.
function openMenu(anchor, items, title) {
  const sameAnchor = openMenuAnchor === anchor;
  closeMenu();
  if (sameAnchor || !items || !items.length) return;
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `${title ? `<div class="menu-title">${escapeHtml(title)}</div>` : ""}${items.map(it => it === "-" ? `<hr>` :
    `<button type="button" role="menuitem" class="menu-item${it.danger ? " danger" : ""}" data-action="${escapeHtml(it.action)}">${it.icon ? icon(it.icon) : ""}<span>${escapeHtml(it.label)}</span>${it.hint ? `<kbd>${escapeHtml(it.hint)}</kbd>` : ""}</button>`).join("")}`;
  const sheet = window.matchMedia("(max-width: 720px)").matches;
  if (sheet) {
    const scrim = document.createElement("div");
    scrim.className = "menu-scrim";
    scrim.addEventListener("click", closeMenu);
    document.body.appendChild(scrim);
    menu.classList.add("menu-sheet");
  }
  document.body.appendChild(menu);
  if (!sheet) {
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth, height = menu.offsetHeight;
    let left = Math.min(rect.left, window.innerWidth - width - 12);
    if (rect.right - width > 12 && rect.left + width > window.innerWidth - 12) left = rect.right - width;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 6);
    menu.style.left = `${Math.max(12, left)}px`;
    menu.style.top = `${top}px`;
  }
  openMenuAnchor = anchor;
}

const MENUS = {
  new: () => [
    { label: "Contact", action: "add-contact", icon: "user-plus" },
    { label: "Structure", action: "add-structure", icon: "building" },
    "-",
    { label: "Don / paiement", action: "add-payment:Don", icon: "heart" },
    { label: "Promesse de don", action: "add-pledge", icon: "clock" },
    "-",
    { label: "Interaction", action: "add-interaction", icon: "chat" },
    { label: "Tâche", action: "add-task", icon: "tasks" },
    { label: "Note sur un contact", action: "add-comment", icon: "note" },
  ],
  "records-actions": () => [
    { label: "Exporter en Excel", action: "export-records:xlsx", icon: "download" },
    { label: "Exporter en CSV", action: "export-records:csv", icon: "download" },
    { label: "Écrire à ces contacts", action: "email-list", icon: "mail" },
    "-",
    { label: "Enregistrer comme segment", action: "save-segment", icon: "layers" },
    { label: "Importer un fichier", action: "import-new", icon: "upload" },
    { label: "Rechercher les doublons", action: "dedupe", icon: "copy" },
  ],
  "payments-actions": () => [
    { label: "Exporter en Excel", action: "export-payments:xlsx", icon: "download" },
    { label: "Exporter en CSV", action: "export-payments:csv", icon: "download" },
    "-",
    { label: "Générer les reçus manquants", action: "generate-receipts", icon: "receipt" },
    { label: "Importer des paiements", action: "import-new", icon: "upload" },
  ],
  "record-more": () => {
    const r = recordById(state.selectedRecord);
    if (!r) return [];
    return [
      { label: "Modifier la fiche", action: "edit-record", icon: "edit" },
      { label: isInMyPortfolio(r) ? "Retirer de mon portefeuille" : "Ajouter à mon portefeuille", action: `toggle-portfolio:${r.id}`, icon: "star" },
      { label: "Ajouter une liaison", action: `add-linkage:${r.id}`, icon: "link" },
      ...(isRecordDuplicated(r.id) ? [{ label: "Voir les doublons", action: `dedupe-focus:${r.id}`, icon: "copy" }] : []),
      "-",
      { label: "Supprimer la fiche", action: "delete-record", icon: "trash", danger: true },
    ];
  },
  account: () => [
    { label: "Mon compte", action: "goto-account", icon: "user" },
    { label: getEffectiveTheme() === "dark" ? "Passer en mode clair" : "Passer en mode sombre", action: "toggle-theme", icon: getEffectiveTheme() === "dark" ? "sun" : "moon" },
    "-",
    { label: "Se déconnecter", action: "logout", icon: "logout", danger: true },
  ],
};

/* ---------- C. Recherche globale (Ctrl/Cmd + K) -------------------------- */

const PALETTE_PAGES = [
  ["Tableau de bord", "home", "Accueil", "home"],
  ["Contacts", "crm", "Contacts", "users"],
  ["Structures", "crm", "Structures", "building"],
  ["Segments", "crm", "Segments", "layers"],
  ["Tâches", "follow", "Tâches", "tasks"],
  ["Interactions", "follow", "Interactions", "chat"],
  ["Mon portefeuille", "follow", "Portefeuille", "star"],
  ["Anniversaires", "follow", "Anniversaires", "cake"],
  ["Paiements", "pay", "Tous les paiements", "heart"],
  ["Promesses de dons", "pay", "Promesses", "clock"],
  ["Campagnes", "pay", "Campagnes", "target"],
  ["Reçus fiscaux", "pay", "Reçus", "receipt"],
  ["Statistiques", "stats", "Vue d'ensemble", "chart"],
  ["Imports", "imports", "Imports", "upload"],
  ["Paramètres", "settings", "Champs personnalisés", "settings"],
  ["Mon compte", "settings", "Mon compte", "user"],
];
const PALETTE_ACTIONS = [
  ["Nouveau contact", "add-contact", "user-plus"],
  ["Nouveau don", "add-payment:Don", "heart"],
  ["Nouvelle promesse de don", "add-pledge", "clock"],
  ["Nouvelle tâche", "add-task", "tasks"],
  ["Nouvelle interaction", "add-interaction", "chat"],
  ["Nouvelle structure", "add-structure", "building"],
  ["Importer un fichier", "import-new", "upload"],
  ["Rechercher les doublons", "dedupe", "copy"],
];

let paletteIndex = 0;
let paletteItems = [];

function paletteResults(query) {
  const q = normalizeSearchText(query).trim();
  const out = [];
  const writable = !isReadOnlyAccount();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const scored = [];
    for (const r of records) {
      const name = normalizeSearchText(r.name);
      let rank = -1;
      if (name.startsWith(q)) rank = 0;
      else if (name.includes(q)) rank = 1;
      else if (normalizeSearchText(r.email).includes(q)) rank = 2;
      else if (digits.length >= 4 && String(r.phone || "").replace(/\D/g, "").includes(digits)) rank = 2;
      else if (normalizeSearchText(r.city).includes(q) || normalizeSearchText(r.family).includes(q)) rank = 3;
      if (rank >= 0) scored.push({ r, rank });
      if (scored.length > 400) break;
    }
    scored.sort((a, b) => a.rank - b.rank || recordTotalAmount(b.r) - recordTotalAmount(a.r));
    scored.slice(0, 8).forEach(({ r }) => out.push({
      group: "Contacts", label: r.name, sub: [r.email, r.phone, r.city].filter(Boolean).join(" · "), action: `open-record:${r.id}`, record: r,
      right: recordTotalAmount(r) ? euro(recordTotalAmount(r)) : "",
    }));
  }
  if (writable) PALETTE_ACTIONS.filter(([label]) => !q || normalizeSearchText(label).includes(q)).slice(0, q ? 4 : 5)
    .forEach(([label, action, ic]) => out.push({ group: "Actions", label, action, icon: ic }));
  PALETTE_PAGES.filter(([label]) => !q || normalizeSearchText(label).includes(q)).slice(0, q ? 5 : 8)
    .forEach(([label, view, section, ic]) => out.push({ group: "Aller à", label, action: `goto:${view}:${section}`, icon: ic }));
  return out;
}

function renderPalette() {
  const d = document.querySelector("#paletteDialog");
  const input = d.querySelector("input");
  paletteItems = paletteResults(input.value);
  if (paletteIndex >= paletteItems.length) paletteIndex = Math.max(0, paletteItems.length - 1);
  let lastGroup = "";
  d.querySelector(".palette-results").innerHTML = paletteItems.length ? paletteItems.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="palette-group">${escapeHtml(it.group)}</div>` : "";
    lastGroup = it.group;
    return `${head}<button type="button" class="palette-item${i === paletteIndex ? " active" : ""}" data-palette="${i}">
      ${it.record ? avatar(it.record, "sm") : `<span class="palette-ic">${icon(it.icon || "arrow-right")}</span>`}
      <span class="palette-text"><strong>${escapeHtml(it.label)}</strong>${it.sub ? `<span>${escapeHtml(it.sub)}</span>` : ""}</span>
      ${it.right ? `<span class="palette-right">${escapeHtml(it.right)}</span>` : ""}
    </button>`;
  }).join("") : `<div class="palette-empty">Aucun résultat pour « ${escapeHtml(input.value)} »</div>`;
  d.querySelector(".palette-item.active")?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  const d = document.querySelector("#paletteDialog");
  if (d.open) return;
  closeMenu();
  d.innerHTML = `<div class="palette">
    <div class="palette-input">${icon("search", 18)}<input type="text" placeholder="Rechercher un contact, une page, une action…" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"><kbd>Échap</kbd></div>
    <div class="palette-results"></div>
  </div>`;
  const input = d.querySelector("input");
  paletteIndex = 0;
  input.addEventListener("input", () => { paletteIndex = 0; renderPalette(); });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); paletteIndex = Math.min(paletteItems.length - 1, paletteIndex + 1); renderPalette(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); paletteIndex = Math.max(0, paletteIndex - 1); renderPalette(); }
    else if (e.key === "Enter") { e.preventDefault(); runPaletteItem(paletteIndex); }
  });
  d.querySelector(".palette-results").addEventListener("click", e => {
    const btn = e.target.closest("[data-palette]");
    if (btn) runPaletteItem(Number(btn.dataset.palette));
  });
  // Clic sur le fond assombri (en dehors de la boîte) : on ferme.
  d.onclick = e => { if (e.target === d) d.close(); };
  d.showModal();
  renderPalette();
  input.focus();
}

function runPaletteItem(index) {
  const item = paletteItems[index];
  if (!item) return;
  document.querySelector("#paletteDialog").close();
  handleAction(item.action);
}

/* ---------- D. Adresse de page (bouton Retour) --------------------------- */

// L'adresse reflète la page affichée (#/crm/Contacts/C-1001) : le bouton
// Retour du navigateur — et le geste/bouton Retour d'un téléphone — revient
// à l'écran précédent au lieu de quitter l'app, et recharger la page rouvre
// le même écran.
let routerApplying = false;
let routerStarted = false;

function stateHash() {
  const parts = [state.view, state.section];
  if (state.view === "crm" && state.showDetail && state.selectedRecord) parts.push(state.selectedRecord);
  return "#/" + parts.map(encodeURIComponent).join("/");
}
function syncUrl() {
  const hash = stateHash();
  if (location.hash === hash) return;
  if (routerApplying || !routerStarted) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  routerStarted = true;
}
function applyHash() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(p => { try { return decodeURIComponent(p); } catch { return p; } });
  const [view, section, recordId] = parts;
  if (!view || !titles[view]) return false;
  if (view === "admin" && currentAccount?.profile !== "Administrateur") return false;
  state.view = view;
  state.section = section || defaultSection(view);
  const record = recordId ? records.find(r => r.id === recordId) : null;
  state.showDetail = !!record;
  state.mobileDetailOpen = !!record;
  if (record) state.selectedRecord = record.id;
  state.drawer = null;
  return true;
}
window.addEventListener("popstate", () => {
  if (!state.booted) return;
  closeMenu();
  routerApplying = true;
  if (applyHash()) render();
  routerApplying = false;
});

/* ---------- E. Exports et emails groupés --------------------------------- */

function recordExportColumns() {
  const year = new Date().getFullYear();
  return [
    ["Identifiant", r => r.id], ["Type", r => r.kind], ["Civilité", r => r.civility], ["Prénom", r => r.first], ["Nom", r => r.kind === "Structure" ? r.name : r.last],
    ["Nom complet", r => r.name], ["Email", r => r.email], ["Email secondaire", r => r.secondaryEmails], ["Téléphone", r => r.phone], ["Téléphone 2", r => r.phone2],
    ["Adresse", r => r.address], ["Code postal", r => r.zip], ["Ville", r => r.city], ["Pays", r => r.country],
    ["Date de naissance", r => parseDob(r.dob) ? formatFrDateFull(parseDob(r.dob)) : (r.dob || "")],
    ["Étiquettes", r => (r.tags || []).join(", ")], ["Segments", r => (r.segments || []).join(", ")], ["Groupes", r => (r.groups || []).join(", ")],
    ["Portefeuille", r => r.agent], ["Famille", r => r.family],
    ["Total donné (€)", r => recordTotalAmount(r)], [`Donné en ${year} (€)`, r => recordMetrics(r).thisYear], [`Donné en ${year - 1} (€)`, r => recordMetrics(r).lastYear],
    ["Promesses en cours (€)", r => recordMetrics(r).pending], ["Dernier don", r => recordMetrics(r).lastIso ? formatFrDateFull(recordMetrics(r).lastIso) : ""],
    ["Nombre de paiements", r => recordPaymentsCount(r)], ["Statut donateur", r => donorStage(r)?.label || ""],
    ...customFields.map(f => [f.name, r => (r.custom || {})[f.name] || ""]),
    ["Source", r => r.source], ["Ajouté le", r => r.dateAdded], ["Commentaire", r => r.comment],
  ];
}
function paymentExportColumns() {
  return [
    ["Date", p => paymentIso(p) ? formatFrDateFull(paymentIso(p)) : (p.date || "")], ["Payeur", p => p.payer], ["Email", p => p.email || recordById(p.recordId)?.email || ""],
    ["Montant (€)", p => Number(p.amount || 0)], ["Type", p => p.type], ["Statut", p => p.status], ["Moyen", p => p.method],
    ["Occasion / campagne", p => (p.occasion || []).join(", ")], ["Reçu fiscal", p => p.receipt], ["N° de reçu", p => p.receiptNumber || ""],
    ["Déjà versé (€)", p => paymentReceivedAmount(p)], ["Reste à payer (€)", p => paymentIsPending(p) ? Math.max(0, paymentRemaining(p)) : 0],
    ["Identifiant fiche", p => p.recordId], ["Identifiant paiement", p => p.id],
  ];
}

// Excel si la bibliothèque est chargée (elle sert déjà à l'import), sinon CSV.
// Le CSV utilise le point-virgule : c'est le séparateur qu'attend Excel en
// français (avec des virgules, tout arrivait dans une seule colonne).
function exportTable(basename, columns, rows, format = "xlsx") {
  if (!rows.length) return notify("Rien à exporter");
  const stamp = todayIso();
  const header = columns.map(c => c[0]);
  const body = rows.map(row => columns.map(([, get]) => { const v = get(row); return v === undefined || v === null ? "" : v; }));
  if (format === "xlsx" && window.XLSX) {
    const sheet = window.XLSX.utils.aoa_to_sheet([header, ...body]);
    sheet["!cols"] = header.map((h, i) => ({ wch: Math.min(42, Math.max(h.length + 2, ...body.slice(0, 200).map(r => String(r[i]).length + 1))) }));
    const book = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(book, sheet, "Export");
    window.XLSX.writeFile(book, `${basename}-${stamp}.xlsx`);
    notify(`${rows.length.toLocaleString("fr-FR")} ligne(s) exportée(s) en Excel`);
    return;
  }
  const csv = [header, ...body].map(line => line.map(csvCell).join(";")).join("\r\n");
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }), `${basename}-${stamp}.csv`);
  notify(`${rows.length.toLocaleString("fr-FR")} ligne(s) exportée(s) en CSV`);
}
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copyText(text, okMessage) {
  try {
    await navigator.clipboard.writeText(text);
    notify(okMessage || "Copié dans le presse-papiers");
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); notify(okMessage || "Copié dans le presse-papiers"); }
    catch { notify("Copie impossible sur cet appareil", true); }
    area.remove();
  }
}

// Écrire à une liste de contacts : le CRM n'envoie pas d'emails lui-même, il
// prépare les adresses (copie en un clic, à coller en Cci) et, pour une petite
// liste, ouvre directement la messagerie de l'appareil.
function openEmailModal(list, title) {
  const withEmail = list.filter(r => r.email);
  if (!withEmail.length) return notify("Aucun de ces contacts n'a d'adresse email");
  const emails = [...new Set(withEmail.map(r => r.email.trim()))];
  const missing = list.length - withEmail.length;
  const d = dialog();
  if (d.open) d.close();
  d.className = "";
  dialogContent().innerHTML = `<div class="modal">
    <header><div><span class="eyebrow">Email groupé</span><h2>${escapeHtml(title || "Écrire à ces contacts")}</h2></div><button class="icon-btn" type="button" data-modal-close title="Fermer">${icon("x")}</button></header>
    <div class="form-grid">
      <p class="span-2 form-note"><strong>${emails.length.toLocaleString("fr-FR")}</strong> adresse(s) prête(s)${missing ? ` — ${missing} contact(s) sans email laissé(s) de côté` : ""}. Collez-les dans le champ <strong>Cci</strong> de votre messagerie pour que les destinataires ne voient pas les autres adresses.</p>
      <label class="span-2">Adresses<textarea id="emailListArea" readonly>${escapeHtml(emails.join("; "))}</textarea></label>
      <label class="span-2">Objet (facultatif)<input type="text" id="emailSubject" placeholder="Ex : Invitation au gala annuel"></label>
    </div>
    <footer><button type="button" data-modal-close>Fermer</button>
      <div class="row-actions">${emails.length <= 40 ? `<button type="button" id="emailOpenClient">${icon("mail")}Ouvrir ma messagerie</button>` : ""}<button type="button" class="primary-btn" id="emailCopy">${icon("copy")}Copier les adresses</button></div>
    </footer>
  </div>`;
  d.showModal();
  dialogContent().querySelectorAll("[data-modal-close]").forEach(btn => btn.addEventListener("click", () => d.close()));
  dialogContent().querySelector("#emailCopy").addEventListener("click", () => copyText(emails.join("; "), `${emails.length} adresse(s) copiée(s)`));
  dialogContent().querySelector("#emailOpenClient")?.addEventListener("click", () => {
    const subject = dialogContent().querySelector("#emailSubject").value;
    location.href = `mailto:?bcc=${encodeURIComponent(emails.join(","))}${subject ? `&subject=${encodeURIComponent(subject)}` : ""}`;
  });
}

/* ---------- F. Actions groupées sur la sélection ------------------------- */

function selectedRecords() {
  return [...state.selection].map(id => recordById(id)).filter(Boolean);
}

async function bulkTag() {
  const list = selectedRecords();
  if (!list.length) return;
  const name = await uiPrompt(`Étiquette à ajouter aux ${list.length} fiche(s) sélectionnée(s)`, "", { title: "Ajouter une étiquette", placeholder: "Ex : Gala 2026", list: distinctTags(), okLabel: "Ajouter" });
  if (!name) return;
  let changed = 0;
  list.forEach(r => {
    if ((r.tags || []).some(t => t.toLowerCase() === name.toLowerCase())) return;
    r.tags = [...(r.tags || []), name];
    r.dateModified = todayStr();
    changed += 1;
  });
  logAudit(`Étiquette « ${name} » ajoutée à ${changed} fiche(s).`);
  saveCrmData();
  render();
  notify(`Étiquette ajoutée à ${changed} fiche(s)`);
}

function bulkPortfolio() {
  const mine = myAgentCode();
  if (!mine) return notify("Impossible de déterminer votre portefeuille : prénom du compte manquant.", true);
  const list = selectedRecords().filter(r => !isInMyPortfolio(r));
  if (!list.length) return notify("Ces fiches sont déjà dans votre portefeuille");
  list.forEach(r => { r.agent = mine; });
  logAudit(`${list.length} fiche(s) ajoutée(s) au portefeuille de ${currentUserLabel()}.`);
  saveCrmData();
  render();
  notify(`${list.length} fiche(s) ajoutée(s) à votre portefeuille`);
}

async function bulkDelete() {
  const list = selectedRecords();
  if (!list.length) return;
  const ids = new Set(list.map(r => r.id));
  const linkedPayments = payments.filter(p => ids.has(p.recordId)).length;
  const linkedInteractions = interactions.filter(i => ids.has(i.recordId)).length;
  const detail = [linkedPayments && `${linkedPayments} paiement(s)`, linkedInteractions && `${linkedInteractions} interaction(s)`].filter(Boolean).join(" et ");
  const ok = await uiConfirm(`Supprimer ${list.length} fiche(s) du CRM ?${detail ? `\n\n${detail} lié(s) à ces fiches seront supprimés avec elles.` : ""}`, { title: "Supprimer la sélection", danger: true, okLabel: "Supprimer" });
  if (!ok) return;
  const undo = removeRecords(ids);
  state.selection.clear();
  logAudit(`${list.length} fiche(s) supprimée(s) en une fois.`);
  saveCrmData();
  render();
  notify(`${list.length} fiche(s) supprimée(s)`, false, { label: "Annuler", run: undo });
}

/* ---------- G. Écouteurs globaux et démarrage --------------------------- */

// Un seul écouteur de clic pour toute l'app (au lieu d'en reposer un sur
// chaque bouton à chaque affichage) : il trouve le bouton cliqué grâce à ses
// attributs data-action / data-view / data-record / data-menu.
document.addEventListener("click", event => {
  const target = event.target;
  const menuButton = target.closest("[data-menu]");
  if (menuButton) {
    event.preventDefault();
    const build = MENUS[menuButton.dataset.menu];
    openMenu(menuButton, build ? build() : []);
    return;
  }
  const inMenu = !!target.closest(".menu");
  const actionEl = target.closest("[data-action]");
  if (actionEl) {
    if (actionEl.tagName === "A" && actionEl.getAttribute("href") && actionEl.dataset.action.startsWith("log-contact:")) {
      // Lien tel: / mailto: / WhatsApp : on laisse le lien s'ouvrir et on
      // propose juste de consigner l'échange.
      handleAction(actionEl.dataset.action);
      return;
    }
    event.preventDefault();
    closeMenu();
    handleAction(actionEl.dataset.action, actionEl);
    return;
  }
  if (!inMenu) closeMenu();
  const navEl = target.closest("[data-view]");
  if (navEl) {
    closeNav();
    navigate(navEl.dataset.view, navEl.dataset.section || defaultSection(navEl.dataset.view));
    scrollToTop();
    return;
  }
  const rowEl = target.closest("[data-record]");
  if (rowEl && !target.closest("input, a, button:not([data-record]), label")) {
    openRecord(rowEl.dataset.record);
  }
});

// Cases à cocher de sélection des contacts (liste et en-tête de tableau).
document.addEventListener("change", event => {
  const el = event.target;
  if (el.matches("[data-select]")) {
    if (el.checked) state.selection.add(el.dataset.select); else state.selection.delete(el.dataset.select);
    render();
  } else if (el.matches("[data-select-all]")) {
    const ids = sortedRecords(state.section === "Structures" ? "Structure" : "Contact").map(r => r.id);
    if (el.checked) ids.forEach(id => state.selection.add(id)); else state.selection.clear();
    render();
  } else if (el.matches("[data-pay-filter]")) {
    state.payFilters[el.dataset.payFilter] = el.value;
    state.paymentsPage = PAGE_STEP;
    render();
  } else if (el.matches("[data-state-select]")) {
    state[el.dataset.stateSelect] = el.value;
    render();
  }
});

document.addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    if (!state.booted || !currentAccount) return;
    event.preventDefault();
    openPalette();
  } else if (event.key === "Escape") {
    closeMenu();
    if (state.drawer && !dialog().open && !askDialog().open) { state.drawer = null; render(); }
  }
});

document.querySelector("#navToggle")?.addEventListener("click", () => (state.navOpen ? closeNav() : openNav()));
document.querySelector("#navScrim")?.addEventListener("click", closeNav);
document.querySelector("#searchTrigger")?.addEventListener("click", openPalette);
document.querySelector("#searchTriggerMobile")?.addEventListener("click", openPalette);

// Barre de navigation mobile (bas d'écran).
document.querySelector("#bnavHome")?.addEventListener("click", () => { closeNav(); navigate("home", "Accueil"); scrollToTop(); });
document.querySelector("#bnavContacts")?.addEventListener("click", () => { closeNav(); navigate("crm", "Contacts"); scrollToTop(); });
document.querySelector("#bnavPayments")?.addEventListener("click", () => { closeNav(); navigate("pay", "Tous les paiements"); scrollToTop(); });
document.querySelector("#bnavMenu")?.addEventListener("click", () => (state.navOpen ? closeNav() : openNav()));

// Retour en ligne / retour sur l'onglet : on renvoie ce qui était en attente
// et on récupère ce que les collègues ont modifié entre-temps.
window.addEventListener("online", () => { if (state.booted) saveCrmData({ silent: true }).then(() => pullIfStale()); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.booted) pullIfStale(); });
setInterval(() => { if (!document.hidden && state.booted) pullIfStale(); }, 45000);

applyTheme(getEffectiveTheme());

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

boot();
