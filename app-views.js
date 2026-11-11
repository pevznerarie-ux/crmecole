/* =========================================================================
   CRM Sinaï — affichage des pages (chargé après app.js, avant app-tools.js)
   Sections :
     1. Icônes, avatars, petits graphiques
     2. Menu latéral et en-tête
     3. Tableau de bord
     4. Répertoire (contacts / structures) et fiche en pleine page
     5. Suivi : tâches, interactions
     6. Collecte : paiements, promesses, campagnes, reçus fiscaux
     7. Statistiques
     8. Imports, paramètres, administration
   ========================================================================= */

/* ---------- 1. Icônes, avatars, petits graphiques ----------------------- */

const ICON_PATHS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.8c2 .7 3.2 2.4 3.6 5.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6"/>',
  "user-plus": '<circle cx="10" cy="8" r="4"/><path d="M2.5 20.5c.8-4 3.8-6 7.5-6 1.6 0 3 .4 4.2 1"/><path d="M19 14v6M16 17h6"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 21v-4h6v4M8 7h2M14 7h2M8 11h2M14 11h2"/>',
  chart: '<path d="M4 20V11M10 20V4M16 20v-7M21 20H3"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.3A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 7.5 2.6c0 5.7-7.5 10.3-7.5 10.3Z"/>',
  tasks: '<rect x="3.5" y="3.5" width="17" height="17" rx="4.5"/><path d="m8 12.3 2.8 2.8L16 9.4"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  cake: '<path d="M4 20.5h16M5.5 20.5v-7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v7M5.5 16c1.6 0 1.6 1.2 3.2 1.2s1.7-1.2 3.3-1.2 1.6 1.2 3.2 1.2 1.7-1.2 3.3-1.2M12 11.5V8.5"/><path d="M12 5.5c.8-1 .8-1.7 0-2.5-.8.8-.8 1.5 0 2.5Z"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  upload: '<path d="M12 16V4M7 8.5 12 4l5 4.5M4 20h16"/>',
  download: '<path d="M12 4v12M7 11.5 12 16l5-4.5M4 20h16"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  shield: '<path d="M12 3 4.5 6v5.5c0 4.5 3.1 8 7.5 9.5 4.4-1.5 7.5-5 7.5-9.5V6Z"/>',
  phone: '<path d="M5 4h3.5l1.5 4.5-2 1.5a12 12 0 0 0 6 6l1.5-2 4.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4Z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7.5 8 6 8-6"/>',
  chat: '<path d="M20.5 12a8.5 8.5 0 0 1-12.5 7.5L3.5 20.5l1-4.5A8.5 8.5 0 1 1 20.5 12Z"/>',
  note: '<path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5H6a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5Z"/><path d="M9 12h6M9 16h4M14.5 3.5V8H19"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16ZM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  "chevron-left": '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  "chevron-right": '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  chevrons: '<path d="m8 9.5 4-4 4 4M8 14.5l4 4 4-4"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
  "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9"/>',
  receipt: '<path d="M6 3.5h12V21l-3-2-3 2-3-2-3 2ZM9 8.5h6M9 12.5h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15ZM10 21h4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6A2.5 2.5 0 0 0 13 3.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M4.5 4.5l1.8 1.8M17.7 17.7l1.8 1.8M2.5 12H5M19 12h2.5M4.5 19.5l1.8-1.8M17.7 6.3l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
  logout: '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
  tag: '<path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8a1.5 1.5 0 0 1 0 2.1l-6.9 6.9a1.5 1.5 0 0 1-2.1 0Z"/><circle cx="8" cy="8" r="1.2"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8ZM3.5 12.5l8.5 4.5 8.5-4.5M3.5 17l8.5 4.5 8.5-4.5"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17v.1"/>',
  alert: '<path d="M12 4 2.5 20h19ZM12 10v4.5M12 17.5v.1"/>',
  flag: '<path d="M5 21V4M5 4.5c5-2.5 8 2.5 14 0v9c-6 2.5-9-2.5-14 0"/>',
  gift: '<rect x="3.5" y="9" width="17" height="11.5" rx="2"/><path d="M3.5 13h17M12 9v11.5M12 9S10.5 3.5 8 4.5 8.5 9 12 9ZM12 9s1.5-5.5 4-4.5S15.5 9 12 9Z"/>',
  sparkle: '<path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.9L12 18.5l-1.8-5.8L4.5 10.8 10.2 9ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/>',
  wifi: '<path d="M3 9.5a13 13 0 0 1 18 0M6 13a8.5 8.5 0 0 1 12 0M9 16.5a4 4 0 0 1 6 0M12 20v.1"/>',
};
function icon(name, size = 16) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ""}</svg>`;
}

function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
// Teinte stable par nom : la même personne garde toujours la même couleur.
function hueOf(text) {
  let h = 0;
  for (const ch of String(text || "")) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
function avatar(r, size = "") {
  const structure = r.kind === "Structure";
  return `<span class="avatar${size ? ` avatar-${size}` : ""}${structure ? " avatar-org" : ""}" style="--h:${hueOf(r.name)}" aria-hidden="true">${structure ? icon("building", size === "xl" ? 26 : 15) : escapeHtml(initialsOf(r.name))}</span>`;
}
function toneBadge(label, tone = "") {
  return `<span class="badge${tone ? ` badge-${tone}` : ""}"><i></i>${escapeHtml(label)}</span>`;
}
function stageBadge(r) {
  const stage = donorStage(r);
  return stage ? toneBadge(stage.label, stage.tone) : "";
}
// Statut d'un paiement, ramené à trois cas lisibles quel que soit le libellé
// d'origine (les imports historiques en ont une dizaine).
function paymentBadge(p) {
  if (paymentIsFailed(p)) return toneBadge(p.status || "Échoué", "bad");
  if (paymentIsPending(p)) return toneBadge(p.status === "Promis" ? "Promis" : (p.status || "En attente"), "warn");
  return toneBadge(p.status === "Reçu" ? "Reçu" : (p.status || "Reçu"), "ok");
}
function receiptBadge(p) {
  const v = p.receipt || "";
  if (/^g[ée]n[ée]r[ée]$/i.test(v)) return toneBadge(p.receiptNumber || "Généré", "ok");
  if (/g[ée]n[ée]rer/i.test(v)) return toneBadge("À générer", "warn");
  if (/ailleurs/i.test(v)) return toneBadge("Émis ailleurs", "");
  return `<span class="muted">—</span>`;
}
function shortEuro(value) {
  const v = Number(value || 0);
  if (Math.abs(v) >= 1000000) return `${(v / 1000000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M€`;
  if (Math.abs(v) >= 10000) return `${Math.round(v / 1000).toLocaleString("fr-FR")} k€`;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€`;
  return `${Math.round(v).toLocaleString("fr-FR")} €`;
}
function plural(n, one, many) {
  return `${Number(n).toLocaleString("fr-FR")} ${n > 1 ? (many || `${one}s`) : one}`;
}
function relativeDays(iso) {
  if (!iso) return "";
  const days = daysBetweenIso(iso, todayIso());
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "hier";
  if (days < 31) return `il y a ${days} j`;
  if (days < 365) return `il y a ${Math.round(days / 30.4)} mois`;
  const years = Math.floor(days / 365);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

// Histogramme vertical. data : [{ label, value, compare?, hint? }]. La série
// "compare" (même période un an plus tôt) s'affiche en clair derrière.
function barChart(data, opts = {}) {
  const max = Math.max(1, ...data.map(d => Math.max(d.value || 0, d.compare || 0)));
  const format = opts.format || shortEuro;
  return `<div class="bars${opts.compact ? " bars-compact" : ""}" role="img" aria-label="${escapeHtml(opts.label || "Graphique")}">${data.map(d => `
    <div class="bar-col${d.current ? " is-current" : ""}" title="${escapeHtml(d.hint || `${d.label} : ${euro(d.value)}`)}">
      <span class="bar-val">${d.value ? format(d.value) : ""}</span>
      <div class="bar-track">
        ${d.compare !== undefined ? `<i class="bar-fill bar-compare" style="height:${Math.max(d.compare ? 2 : 0, (d.compare / max) * 100)}%"></i>` : ""}
        <i class="bar-fill" style="height:${Math.max(d.value ? 2 : 0, (d.value / max) * 100)}%"></i>
      </div>
      <span class="bar-label">${escapeHtml(d.label)}</span>
    </div>`).join("")}</div>`;
}
// Barres horizontales classées. items : [{ label, value, sub?, action? }].
function hbarList(items, opts = {}) {
  if (!items.length) return `<p class="muted-note">${escapeHtml(opts.empty || "Pas encore de données.")}</p>`;
  const max = Math.max(1, ...items.map(i => i.value));
  const format = opts.format || euro;
  return `<div class="hbars">${items.map(i => {
    const inner = `<span class="hbar-label">${escapeHtml(i.label)}${i.sub ? `<em>${escapeHtml(i.sub)}</em>` : ""}</span><span class="hbar-value">${format(i.value)}</span><span class="hbar-track"><i style="width:${Math.max(1.5, (i.value / max) * 100)}%"></i></span>`;
    return i.action ? `<button type="button" class="hbar" data-action="${escapeHtml(i.action)}">${inner}</button>` : `<div class="hbar">${inner}</div>`;
  }).join("")}</div>`;
}
function progressBar(ratio, tone = "") {
  const pct = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return `<span class="progress${tone ? ` progress-${tone}` : ""}"><i style="width:${pct}%"></i></span>`;
}
function kpi(label, value, note = "", extra = "") {
  return `<div class="kpi"><span class="kpi-label">${escapeHtml(label)}</span><strong class="kpi-value">${value}</strong>${extra}${note ? `<span class="kpi-note">${escapeHtml(note)}</span>` : ""}</div>`;
}
function deltaChip(current, previous, suffix) {
  if (!previous) return "";
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return `<span class="delta ${up ? "delta-up" : "delta-down"}">${icon(up ? "arrow-up" : "arrow-down", 12)}${Math.abs(pct)} %<em>${escapeHtml(suffix)}</em></span>`;
}
function sectionHead(title, right = "", sub = "") {
  return `<div class="card-head"><div><h2>${escapeHtml(title)}</h2>${sub ? `<p>${escapeHtml(sub)}</p>` : ""}</div>${right ? `<div class="card-head-actions">${right}</div>` : ""}</div>`;
}
function btn(label, key, cls = "", iconName = "") {
  return `<button type="button" class="${cls}" data-action="${escapeHtml(key)}">${iconName ? icon(iconName) : ""}${escapeHtml(label)}</button>`;
}
function loadMoreButton(remaining, key) {
  return remaining ? `<button type="button" class="load-more" data-action="${key}">Afficher ${Math.min(remaining, PAGE_STEP)} de plus <span>(${remaining.toLocaleString("fr-FR")} restants)</span></button>` : "";
}

/* ---------- 2. Menu latéral et en-tête ---------------------------------- */

const SECTION_LABELS = { "Tous les paiements": "Paiements", "Reçus": "Reçus fiscaux", "Portefeuille": "Mon portefeuille" };
function sectionLabel(section) {
  return SECTION_LABELS[section] || section;
}
function isMyTask(t) {
  const me = normalizeAgentCode(myFirstName());
  return !t.assignedTo || !me || normalizeAgentCode(t.assignedTo) === me;
}
function myDueTasksCount() {
  const today = todayIso();
  return tasks.filter(t => t.status !== "fait" && t.dueDate && t.dueDate <= today && isMyTask(t)).length;
}

function renderNav() {
  const isAdmin = currentAccount && currentAccount.profile === "Administrateur";
  const due = myDueTasksCount();
  nav().innerHTML = navTree.filter(([id]) => id !== "admin" || isAdmin).map(([id, label, children, ic]) => {
    const active = state.view === id;
    const badge = id === "follow" && due ? `<span class="nav-badge" title="${due} tâche(s) à traiter aujourd'hui ou en retard">${due}</span>` : "";
    return `<div class="nav-group${active ? " open" : ""}">
      <button type="button" class="nav-btn${active ? " active" : ""}" data-view="${id}" data-section="${escapeHtml(children[0] || defaultSection(id))}">${icon(ic, 18)}<span>${escapeHtml(label)}</span>${badge}</button>
      ${children.length ? `<div class="subnav">${children.map(child => `<button type="button" class="subnav-btn${active && state.section === child ? " current" : ""}" data-view="${id}" data-section="${escapeHtml(child)}">${escapeHtml(sectionLabel(child))}</button>`).join("")}</div>` : ""}
    </div>`;
  }).join("");
}

const PAGE_SUBTITLES = {
  "home": "Vue d'ensemble de la collecte et du suivi",
  "Contacts": "Familles, donateurs et anciens élèves",
  "Structures": "Entreprises, fondations et associations",
  "Segments": "Listes dynamiques réutilisables",
  "Groupes": "Regroupements de fiches",
  "Liaisons": "Liens familiaux et professionnels entre fiches",
  "Tâches": "Ce qu'il y a à faire, par échéance",
  "Interactions": "Appels, emails, rendez-vous et notes",
  "Portefeuille": "Les donateurs que vous suivez personnellement",
  "Anniversaires": "Civils et hébraïques",
  "Tous les paiements": "Dons, adhésions et billetterie",
  "Promesses": "Dons promis qui restent à encaisser",
  "Campagnes": "Objectifs et avancement de la collecte",
  "Reçus": "Reçus fiscaux CERFA",
  "stats": "Chiffres de la collecte et des donateurs",
  "imports": "Contacts et paiements importés depuis un fichier",
  "Mon compte": "Mot de passe, apparence et rappels",
  "Champs personnalisés": "Informations supplémentaires sur les fiches",
  "Catégories d'interaction": "Libellés pour classer les échanges",
  "Intégrations": "Connexions avec d'autres outils",
  "Utilisateurs": "Comptes de l'équipe et droits d'accès",
  "Journal d'activité": "Qui a fait quoi, et quand",
};
function setHeader() {
  const entry = navTree.find(([id]) => id === state.view);
  const hasSections = entry && entry[2].length;
  const title = hasSections ? sectionLabel(state.section) : (entry ? entry[1] : "CRM Sinaï");
  viewTitle().textContent = title;
  viewSubtitle().textContent = PAGE_SUBTITLES[hasSections ? state.section : state.view] || "";
  document.title = `${title} · CRM Sinaï`;
}

function bottomNavKey() {
  if (state.view === "home") return "home";
  if (state.view === "pay") return "payments";
  if (state.view === "crm") return "contacts";
  return "";
}
function syncBottomNav() {
  const activeKey = bottomNavKey();
  document.querySelectorAll(".bnav-btn[data-bnav]").forEach(el => el.classList.toggle("active", el.dataset.bnav === activeKey));
  document.querySelector("#bnavMenu")?.classList.toggle("active", !!state.navOpen || !activeKey);
}

/* ---------- 3. Tableau de bord ------------------------------------------ */

// Tous les chiffres de collecte en un seul passage sur les paiements.
function collectNumbers() {
  const today = todayIso();
  const year = today.slice(0, 4);
  const prevYear = String(Number(year) - 1);
  const sameDayLastYear = `${prevYear}${today.slice(4)}`;
  const byMonth = new Map();
  const byYear = new Map();
  let ytd = 0, lastYtd = 0, lastYearTotal = 0, countThisYear = 0;
  const donorsThisYear = new Set();
  const donorsLastYear = new Set();
  payments.forEach(p => {
    const got = paymentReceivedAmount(p);
    if (!(got > 0)) return;
    const iso = paymentIso(p);
    if (!iso) return;
    const y = iso.slice(0, 4);
    byMonth.set(iso.slice(0, 7), (byMonth.get(iso.slice(0, 7)) || 0) + got);
    byYear.set(y, (byYear.get(y) || 0) + got);
    if (y === year) { ytd += got; countThisYear += 1; if (p.recordId) donorsThisYear.add(p.recordId); }
    else if (y === prevYear) { lastYearTotal += got; if (iso <= sameDayLastYear) lastYtd += got; if (p.recordId) donorsLastYear.add(p.recordId); }
  });
  const pending = payments.filter(p => paymentIsPending(p) && paymentRemaining(p) > 0);
  const kept = [...donorsLastYear].filter(id => donorsThisYear.has(id)).length;
  return {
    today, year, prevYear, byMonth, byYear, ytd, lastYtd, lastYearTotal, countThisYear, donorsThisYear, donorsLastYear,
    pending, pendingAmount: pending.reduce((s, p) => s + paymentRemaining(p), 0),
    retention: donorsLastYear.size ? kept / donorsLastYear.size : null,
  };
}
function lastMonthsSeries(n, byMonth) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - i, 1));
    const ym = d.toISOString().slice(0, 7);
    const prev = `${Number(ym.slice(0, 4)) - 1}${ym.slice(4)}`;
    const label = d.toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" }).replace(".", "");
    out.push({ label, value: byMonth.get(ym) || 0, compare: byMonth.get(prev) || 0, current: i === 0,
      hint: `${d.toLocaleDateString("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" })} : ${euro(byMonth.get(ym) || 0)} (un an plus tôt : ${euro(byMonth.get(prev) || 0)})` });
  }
  return out;
}

function dashPledgesPanel(c) {
  const list = [...c.pending].sort((a, b) => paymentIso(a).localeCompare(paymentIso(b))).slice(0, 5);
  return `<section class="panel dash-card">
    ${sectionHead("Promesses à encaisser", c.pending.length ? btn("Tout voir", "goto-pledges", "link-btn") : "", c.pending.length ? `${euro(c.pendingAmount)} sur ${plural(c.pending.length, "promesse")}` : "")}
    ${list.length ? `<div class="rows">${list.map(p => {
      const rec = recordById(p.recordId);
      const days = daysBetweenIso(paymentIso(p) || c.today, c.today);
      return `<div class="row">
        <button type="button" class="row-main" data-action="open-record:${p.recordId}:Paiements">${rec ? avatar(rec, "sm") : ""}<span class="row-text"><strong>${escapeHtml(p.payer || "—")}</strong><span class="${days > 60 ? "text-bad" : ""}">Promis ${relativeDays(paymentIso(p))}${paymentPaidTotal(p) ? ` · ${euro(paymentPaidTotal(p))} déjà versés` : ""}</span></span></button>
        <span class="row-amount">${euro(paymentRemaining(p))}</span>
        <button type="button" class="btn-sm" data-action="mark-received:${p.id}" title="Le don est arrivé">Reçu</button>
      </div>`;
    }).join("")}</div>` : `<p class="muted-note">Aucune promesse en attente. Enregistrez un don avec le statut « Promis » pour le suivre ici.</p>`}
  </section>`;
}

function dashLapsedPanel(c) {
  const list = records.filter(r => { const m = recordMetrics(r); return m.lastYear > 0 && m.thisYear === 0; })
    .sort((a, b) => recordMetrics(b).lastYear - recordMetrics(a).lastYear);
  if (!list.length) return "";
  const lost = list.reduce((s, r) => s + recordMetrics(r).lastYear, 0);
  return `<section class="panel dash-card">
    ${sectionHead("Donateurs à relancer", btn("Tout voir", "goto-lapsed", "link-btn"), `${plural(list.length, "donateur")} de ${c.prevYear} n'ont pas encore donné en ${c.year} · ${euro(lost)} en jeu`)}
    <div class="rows">${list.slice(0, 5).map(r => `<div class="row">
      <button type="button" class="row-main" data-action="open-record:${r.id}:Paiements">${avatar(r, "sm")}<span class="row-text"><strong>${escapeHtml(r.name)}</strong><span>${euro(recordMetrics(r).lastYear)} en ${c.prevYear} · dernier don ${relativeDays(recordMetrics(r).lastIso)}</span></span></button>
      <button type="button" class="btn-sm" data-action="quick-task:${r.id}">Relancer</button>
    </div>`).join("")}</div>
  </section>`;
}

function dashTodoPanel() {
  const toGenerate = payments.filter(p => /g[ée]n[ée]rer/i.test(p.receipt || "") && !paymentIsPending(p)).length;
  const noEmail = records.filter(r => r.kind !== "Structure" && !r.email).length;
  const lateTasks = tasks.filter(t => t.status !== "fait" && t.dueDate && t.dueDate < todayIso()).length;
  const items = [
    lateTasks && [`${plural(lateTasks, "tâche")} en retard`, "goto-tasks", "clock", "bad"],
    toGenerate && [`${plural(toGenerate, "reçu fiscal", "reçus fiscaux")} à générer`, "goto-receipts", "receipt", "warn"],
    duplicateGroupsCache.length && [`${plural(duplicateGroupsCache.length, "doublon potentiel", "doublons potentiels")} à vérifier`, "dedupe", "copy", "warn"],
    noEmail && [`${plural(noEmail, "contact")} sans email`, "quick-filter-noemail", "mail", ""],
  ].filter(Boolean);
  if (!items.length) return "";
  return `<section class="panel dash-card">
    ${sectionHead("À traiter")}
    <div class="todo-list">${items.map(([label, key, ic, tone]) => `<button type="button" class="todo-item" data-action="${key}"><span class="todo-ic${tone ? ` tone-${tone}` : ""}">${icon(ic)}</span><span>${escapeHtml(label)}</span>${icon("chevron-right", 14)}</button>`).join("")}</div>
  </section>`;
}

function dashActivityPanel() {
  const recent = [...interactions].sort((a, b) => (b.at || "").localeCompare(a.at || "")).slice(0, 6);
  if (!recent.length) return "";
  return `<section class="panel dash-card hp-activity${panelCls("activity")}">
    <div class="hp-activity-head"><h2>Activité récente</h2><button type="button" class="link-btn" data-action="goto-interactions">Tout voir</button>${panelToggle("activity")}</div>
    <div class="timeline">${recent.map(i => interactionItem(i, true)).join("")}</div>
  </section>`;
}

function home() {
  const c = collectNumbers();
  const now = new Date();
  const hour = now.getHours();
  const greetWord = hour < 5 ? "Bonsoir" : hour < 12 ? "Bonjour" : hour < 18 ? "Bon après-midi" : "Bonsoir";
  const greetName = myFirstName();
  const todayLabel = now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const newDonors = [...c.donorsThisYear].filter(id => { const r = recordById(id); return r && donorStage(r)?.key === "new"; }).length;
  const avg = c.countThisYear ? c.ytd / c.countThisYear : 0;
  const series = lastMonthsSeries(12, c.byMonth);
  const hasGiving = series.some(d => d.value || d.compare);
  return `<div class="dash">
    <header class="dash-hero">
      <div>
        <p class="dash-date">${escapeHtml(todayLabel.charAt(0).toUpperCase() + todayLabel.slice(1))}</p>
        <h1>${greetName ? `${greetWord}, ${escapeHtml(greetName)}` : "Tableau de bord"}</h1>
      </div>
      <div class="dash-actions">
        ${btn("Don", "add-payment:Don", "primary-btn", "plus")}
        ${btn("Promesse", "add-pledge", "", "plus")}
        ${btn("Contact", "add-contact", "", "plus")}
        ${btn("Tâche", "add-task", "", "plus")}
      </div>
    </header>

    <section class="kpi-grid">
      ${kpi(`Collecté en ${c.year}`, euro(c.ytd), c.lastYtd ? "" : (c.lastYearTotal ? `${euro(c.lastYearTotal)} sur toute l'année ${c.prevYear}` : "Dons et paiements reçus"), deltaChip(c.ytd, c.lastYtd, `vs même date ${c.prevYear}`))}
      ${kpi("Promesses à encaisser", euro(c.pendingAmount), c.pending.length ? plural(c.pending.length, "promesse") + " en attente" : "Rien en attente")}
      ${kpi(`Donateurs ${c.year}`, c.donorsThisYear.size.toLocaleString("fr-FR"), newDonors ? `dont ${plural(newDonors, "nouveau", "nouveaux")}` : (c.donorsLastYear.size ? `${c.donorsLastYear.size.toLocaleString("fr-FR")} en ${c.prevYear}` : ""))}
      ${kpi("Don moyen", euro(avg), c.countThisYear ? `sur ${plural(c.countThisYear, "paiement")} cette année` : "Aucun paiement cette année")}
    </section>

    <div class="dash-grid">
      <div class="dash-col dash-col-main">
        <section class="panel dash-card dash-chart">
          ${sectionHead("Collecte sur 12 mois", btn("Statistiques", "goto-stats", "link-btn"), "")}
          ${hasGiving ? `${barChart(series, { label: "Montants reçus par mois sur les 12 derniers mois" })}
          <div class="chart-legend"><span><i class="dot"></i>Reçu ce mois-là</span><span><i class="dot dot-compare"></i>Un an plus tôt</span></div>`
            : `<p class="muted-note">Le graphique apparaîtra dès les premiers dons enregistrés.</p>`}
        </section>
        ${hpTasksPanel()}
        ${dashActivityPanel()}
      </div>
      <div class="dash-col">
        ${dashTodoPanel()}
        ${dashPledgesPanel(c)}
        ${dashLapsedPanel(c)}
        ${hpPortfolioPanel()}
        ${hpBirthdaysPanel()}
        ${hpHolidayPanel()}
      </div>
    </div>
  </div>`;
}

/* ---------- 4. Répertoire et fiche -------------------------------------- */

function crm() {
  if (state.section === "Segments") return segments();
  if (state.section === "Groupes") return groupsView();
  if (state.section === "Liaisons") return linkagesView();
  const kind = state.section === "Structures" ? "Structure" : "Contact";
  if (state.showDetail) {
    const r = recordById(state.selectedRecord);
    if (r) return recordPage(r);
  }
  return recordsView(kind);
}
function follow() {
  if (state.section === "Interactions") return interactionsView();
  if (state.section === "Portefeuille") return portfolioView();
  if (state.section === "Anniversaires") return birthdaysView();
  return tasksView();
}

function sortHeader(label, key, align = "") {
  const active = state.sort.key === key;
  return `<th class="${align}"><button type="button" class="th-sort${active ? " active" : ""}" data-action="sort:${key}">${escapeHtml(label)}${active ? icon(state.sort.dir === "asc" ? "arrow-up" : "arrow-down", 12) : ""}</button></th>`;
}

function recordsView(kind) {
  const structure = kind === "Structure";
  const noun = structure ? "structure" : "contact";
  if (!records.some(r => r.kind === kind) && !state.query && !filtersAreActive(activeFilters()) && !state.quick) {
    return `<section class="panel"><div class="empty-state empty-big">
      <span class="empty-ic">${icon(structure ? "building" : "users", 26)}</span>
      <h2>${structure ? "Aucune structure pour l'instant" : "Votre répertoire est vide"}</h2>
      <p>${structure ? "Ajoutez les entreprises, fondations et associations qui soutiennent Sinaï." : "Ajoutez un premier contact, ou importez votre fichier (CSV ou Excel) pour démarrer avec tout votre répertoire."}</p>
      <div class="row-actions">${btn(structure ? "Nouvelle structure" : "Nouveau contact", structure ? "add-structure" : "add-contact", "primary-btn", "plus")}${structure ? "" : btn("Importer un fichier", "import-new", "", "upload")}</div>
    </div></section>`;
  }
  const rows = sortedRecords(kind);
  const { visible, remaining } = visiblePage(rows, "recordsPage");
  const total = rows.reduce((sum, r) => sum + recordTotalAmount(r), 0);
  const donors = rows.filter(r => recordTotalAmount(r) > 0).length;
  const selected = state.selection.size;
  const allSelected = rows.length > 0 && rows.every(r => state.selection.has(r.id));
  const nFilters = activeFilterCount(activeFilters());
  const filtered = !!(state.query || nFilters || state.quick);
  const more = loadMoreButton(remaining, "load-more-records");
  const bulkBar = selected ? `<div class="bulk-bar">
      <strong>${plural(selected, "fiche sélectionnée", "fiches sélectionnées")}</strong>
      <div class="row-actions">
        ${btn("Étiqueter", "bulk-tag", "btn-sm", "tag")}
        ${btn("Mon portefeuille", "bulk-portfolio", "btn-sm", "star")}
        ${btn("Écrire", "bulk-emails", "btn-sm", "mail")}
        ${btn("Exporter", "bulk-export", "btn-sm", "download")}
        ${btn("Supprimer", "bulk-delete", "btn-sm danger-text", "trash")}
        <button type="button" class="icon-btn btn-sm" data-action="bulk-clear" title="Tout désélectionner">${icon("x")}</button>
      </div>
    </div>` : "";
  return `<section class="panel list-panel">
    <div class="list-head">
      <div class="list-title">
        <h2>${plural(rows.length, noun)}${filtered ? ` <span class="muted">sur ${records.filter(r => r.kind === kind).length.toLocaleString("fr-FR")}</span>` : ""}</h2>
        <p>${donors ? `${plural(donors, "donateur")} · ${euro(total)} donnés au total` : "Aucun don enregistré pour cette sélection"}</p>
      </div>
      <div class="row-actions">
        <button type="button" class="filters-btn${nFilters ? " active" : ""}" data-action="open-filters">${icon("filter")}Filtres${nFilters ? `<span class="filters-badge">${nFilters}</span>` : ""}</button>
        <button type="button" data-menu="records-actions">${icon("more")}<span class="hide-sm">Actions</span></button>
        ${btn(structure ? "Structure" : "Contact", structure ? "add-structure" : "add-contact", "primary-btn", "plus")}
      </div>
    </div>
    <div class="list-tools">
      <label class="search-field">${icon("search")}<input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Nom, email, téléphone, ville, étiquette…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      ${structure ? "" : `<div class="chips">${QUICK_FILTERS.map(([key, label]) => `<button type="button" class="chip${state.quick === key ? " active" : ""}" data-action="quick-filter:${key}">${escapeHtml(label)}</button>`).join("")}</div>`}
    </div>
    ${bulkBar}
    ${rows.length ? `
    <div class="table-wrap desktop-only"><table class="data-table records-table">
      <thead><tr>
        <th class="col-check"><input type="checkbox" data-select-all ${allSelected ? "checked" : ""} title="Tout sélectionner (${rows.length})" aria-label="Tout sélectionner"></th>
        ${sortHeader("Nom", "name")}<th>Coordonnées</th><th>Étiquettes</th>${sortHeader("Total donné", "total", "num")}${sortHeader("Dernier don", "last")}<th>Statut</th>
      </tr></thead>
      <tbody>${visible.map(r => {
        const m = recordMetrics(r);
        const tags = r.tags || [];
        return `<tr data-record="${r.id}" class="${state.selection.has(r.id) ? "is-selected" : ""}">
          <td class="col-check"><input type="checkbox" data-select="${r.id}" ${state.selection.has(r.id) ? "checked" : ""} aria-label="Sélectionner ${escapeHtml(r.name)}"></td>
          <td><div class="cell-person">${avatar(r, "sm")}<div><strong>${escapeHtml(r.name || "(sans nom)")}${isInMyPortfolio(r) ? `<span class="mark-star" title="Dans mon portefeuille">${icon("star", 12)}</span>` : ""}${isRecordDuplicated(r.id) ? `<span class="mark-warn" title="Doublon potentiel">${icon("alert", 12)}</span>` : ""}</strong><span>${escapeHtml([r.city, structure ? r.legal : r.family && r.family !== r.last ? `Famille ${r.family}` : ""].filter(Boolean).join(" · ") || r.id)}</span></div></div></td>
          <td><div class="cell-contact"><span>${escapeHtml(r.email || "—")}</span><span>${escapeHtml(r.phone || "")}</span></div></td>
          <td><div class="cell-tags">${tags.slice(0, 3).map(t => tag(t)).join("")}${tags.length > 3 ? `<span class="tag tag-more">+${tags.length - 3}</span>` : ""}</div></td>
          <td class="num"><strong class="money">${recordTotalAmount(r) ? euro(recordTotalAmount(r)) : "—"}</strong>${m.pending ? `<span class="cell-sub">+ ${euro(m.pending)} promis</span>` : ""}</td>
          <td>${m.lastIso ? `<span>${formatFrDateFull(m.lastIso)}</span><span class="cell-sub">${relativeDays(m.lastIso)}</span>` : `<span class="muted">—</span>`}</td>
          <td>${stageBadge(r)}</td>
        </tr>`;
      }).join("")}</tbody></table>${more}</div>
    <div class="record-cards mobile-only">${visible.map(r => {
      const m = recordMetrics(r);
      return `<button type="button" class="record-card" data-record="${r.id}">
        ${avatar(r)}
        <span class="record-card-body">
          <span class="record-card-head"><strong>${escapeHtml(r.name || "(sans nom)")}</strong><span class="money">${recordTotalAmount(r) ? euro(recordTotalAmount(r)) : ""}</span></span>
          <span class="record-card-sub">${escapeHtml(r.email || r.phone || r.city || "Coordonnées à compléter")}</span>
          <span class="chip-list">${stageBadge(r)}${m.pending ? toneBadge(`${euro(m.pending)} promis`, "violet") : ""}${(r.tags || []).slice(0, 2).map(t => tag(t)).join("")}</span>
        </span>
      </button>`;
    }).join("")}${more}</div>`
    : `<div class="empty-state"><span class="empty-ic">${icon("search", 22)}</span><p>Aucun ${noun} ne correspond à cette recherche.</p>${btn("Effacer la recherche et les filtres", "reset-filters")}</div>`}
  </section>`;
}

// Cases de la fiche : chacune est un bouton qui ouvre la modification de la
// fiche directement sur le bon champ. Case vide : "Ajouter".
function fieldGrid(rows) {
  return `<div class="field-grid">${rows.map(([label, value, key, hint]) => {
    const empty = !String(value ?? "").trim();
    return `<button type="button" class="field field-edit${empty ? " field-empty" : ""}" data-action="edit-record:${key}" title="Modifier">
      <span>${escapeHtml(label)}</span>
      <strong>${empty ? "Ajouter" : escapeHtml(value)}</strong>${hint ? `<em class="field-hint">${escapeHtml(hint)}</em>` : ""}
    </button>`;
  }).join("")}</div>`;
}
function birthdayHint(r) {
  if (!parseDob(r.dob)) return "";
  const today = todayIso();
  const civil = nextCivilBirthday(r, today);
  const heb = nextHebrewBirthday(r, today);
  const fmt = iso => iso === today ? "aujourd'hui" : utcNoon(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return [civil && `Prochain anniversaire civil : ${fmt(civil)}`, heb && `hébraïque : ${fmt(heb)}`].filter(Boolean).join(" · ");
}

const DETAIL_SECTIONS = [
  ["Details", "Coordonnées"],
  ["Paiements", "Dons"],
  ["Activité", "Activité"],
  ["Tâches", "Tâches"],
  ["Categorisation", "Classement"],
  ["Relations", "Relations"],
];
function detailSection(key, label, bodyHtml, right = "") {
  return `<section class="panel detail-section" data-section="${key}">
    <div class="card-head"><h2>${escapeHtml(label)}</h2>${right ? `<div class="card-head-actions">${right}</div>` : ""}</div>
    ${bodyHtml}
  </section>`;
}
// Numéro au format international sans "+", attendu par les liens WhatsApp.
function whatsappNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) return `33${digits.slice(1)}`;
  return digits;
}
const INTERACTION_ICONS = { "Appel": "phone", "Appel téléphonique": "phone", "Email": "mail", "Message": "chat", "Message (SMS/WhatsApp)": "chat", "Rendez-vous": "calendar", "Rencontre": "calendar", "Note": "note", "Commentaire": "note" };
function interactionItem(i, withName = false) {
  const rec = recordById(i.recordId);
  const title = i.type === "Commentaire" ? "Note" : (i.type || "Interaction");
  const head = `<span class="tl-ic">${icon(INTERACTION_ICONS[i.type] || "chat", 14)}</span>
    <span class="tl-body">
      <span class="tl-title">${withName ? `<strong>${escapeHtml(rec ? rec.name : (i.target || "Contact supprimé"))}</strong><span class="tl-kind">${escapeHtml(title)}</span>` : `<strong>${escapeHtml(title)}${i.label && i.label !== "Note" && i.label !== title ? ` — ${escapeHtml(i.label)}` : ""}</strong>`}</span>
      ${withName && i.label && i.label !== "Note" && i.label !== title ? `<span class="tl-text">${escapeHtml(i.label)}</span>` : ""}
      ${i.note ? `<span class="tl-text">${escapeHtml(i.note)}</span>` : ""}
      <span class="tl-meta">${escapeHtml(i.date || "")}${i.user ? ` · ${escapeHtml(i.user)}` : ""}${i.category && i.category !== "Suivi" && !withName ? ` · ${escapeHtml(i.category)}` : ""}</span>
    </span>`;
  if (withName) return `<button type="button" class="tl-item tl-link" data-action="open-record:${i.recordId}:Activité">${head}</button>`;
  return `<div class="tl-item">${head}<button type="button" class="tl-remove" data-action="delete-interaction:${i.id}" title="Supprimer" aria-label="Supprimer cette interaction">${icon("trash", 14)}</button></div>`;
}

// Un don/adhésion a un reçu associé : "Télécharger"/"Régénérer" sont proposés
// directement sur la ligne, à côté de Modifier/Supprimer.
function paymentTimelineItem(p) {
  const pending = paymentIsPending(p);
  const hasReceipt = (p.type === "Don" || p.type === "Adhésion") && !pending && !paymentIsFailed(p);
  const externe = /ailleurs/i.test(p.receipt || "");
  const receiptActions = !hasReceipt ? "" : externe ? "" :
    `${p.receiptNumber ? btn("Reçu PDF", `download-receipt-pdf:${p.id}`, "btn-sm", "download") : btn("Générer le reçu", `regenerate-receipt:${p.id}`, "btn-sm", "receipt")}`;
  return `<div class="pay-item${pending ? " is-pending" : ""}">
    <div class="pay-item-top">
      <div><strong class="money pay-amount">${euro(p.amount)}</strong><span class="pay-type">${escapeHtml(p.type || "")}</span></div>
      <div class="pay-badges">${paymentBadge(p)}${hasReceipt ? receiptBadge(p) : ""}</div>
    </div>
    <p class="pay-meta">${escapeHtml([paymentPrimaryDate(p), p.method].filter(Boolean).join(" · "))}${(p.occasion || []).length ? ` · ${p.occasion.map(o => tag(o, "violet")).join(" ")}` : ""}</p>
    ${p.note ? `<p class="pay-note">${escapeHtml(p.note)}</p>` : ""}
    ${installmentBlock(p)}
    <div class="row-actions pay-actions">
      ${pending ? btn("Marquer reçu", `mark-received:${p.id}`, "btn-sm primary-btn", "check") : ""}
      ${pending && !p.installmentPlan ? btn("Versement", `add-installment:${p.id}`, "btn-sm", "plus") : ""}
      ${receiptActions}
      ${p.receiptNumber && !externe ? btn("Régénérer", `regenerate-receipt:${p.id}`, "btn-sm") : ""}
      ${btn("Modifier", `edit-payment:${p.id}`, "btn-sm", "edit")}
      <button type="button" class="icon-btn btn-sm danger-text" data-action="delete-payment:${p.id}" title="Supprimer ce paiement">${icon("trash")}</button>
    </div>
  </div>`;
}

function recordGivingByYear(r) {
  const byYear = new Map();
  recordLivePayments(r.id).forEach(p => { const got = paymentReceivedAmount(p); const y = paymentIso(p).slice(0, 4); if (got > 0 && y) byYear.set(y, (byYear.get(y) || 0) + got); });
  if (byYear.size < 2) return "";
  const last = Number(todayIso().slice(0, 4));
  const first = Math.max(Math.min(...[...byYear.keys()].map(Number)), last - 5);
  const data = [];
  for (let y = first; y <= last; y += 1) data.push({ label: String(y), value: byYear.get(String(y)) || 0, current: y === last });
  return barChart(data, { compact: true, label: "Dons par année" });
}

function recordPage(r) {
  const m = recordMetrics(r);
  const structure = r.kind === "Structure";
  const year = todayIso().slice(0, 4);
  const from = state.detailReturn ? navTree.find(([id]) => id === state.detailReturn.view) : null;
  const back = from ? (from[2].length ? sectionLabel(state.detailReturn.section) : from[1]) : (structure ? "Structures" : "Contacts");
  const wa = whatsappNumber(r.phone);
  const meta = [structure ? r.legal : r.profession, r.city, !structure && r.family && r.family !== r.last ? `Famille ${r.family}` : ""].filter(Boolean);
  const feed = recordLiveInteractions(r.id);
  const pays = recordLivePayments(r.id);
  const recTasks = tasks.filter(t => t.recordId === r.id).sort((a, b) => (a.status === "fait") - (b.status === "fait") || ((a.dueDate || "9999") < (b.dueDate || "9999") ? -1 : 1));
  const links = recordLinkages(r);
  const family = !structure && r.family ? records.filter(x => x !== r && x.kind !== "Structure" && x.family && x.family.toLowerCase() === r.family.toLowerCase()).slice(0, 8) : [];

  const details = structure
    ? [["Nom", r.name, "name"], ["Email", r.email, "email"], ["Téléphone", r.phone, "phone"], ["Adresse", r.address, "address"], ["Code postal", r.zip, "zip"], ["Ville", r.city, "city"], ["SIREN", r.siren, "siren"], ["Forme juridique", r.legal, "legal"]]
    : [["Civilité", r.civility, "civility"], ["Nom", r.name, "last"], ["Email", r.email, "email"], ["Email secondaire", r.secondaryEmails, "secondaryEmails"], ["Téléphone", r.phone, "phone"], ["Téléphone 2", r.phone2, "phone2"], ["Adresse", r.address, "address"], ["Code postal", r.zip, "zip"], ["Ville", r.city, "city"], ["Pays", r.country, "country"], ["Date de naissance", parseDob(r.dob) || r.dob ? dobLabel(r) : "", "dob", birthdayHint(r)], ["Profession", r.profession, "profession"]];
  details.push(["Commentaire", r.comment, "comment"]);
  const classement = [["Étiquettes", (r.tags || []).join(", "), "tags"], ["Segments", (r.segments || []).join(", "), "segments"], ["Groupes", (r.groups || []).join(", "), "groups"], ["Portefeuille", r.agent, "agent"], ["Source", r.source, "source"],
    ...customFields.map(f => [f.name, (r.custom || {})[f.name] || "", `cf:${f.name}`])];
  const foyer = structure ? [] : [["Famille", r.family, "family"], ["Rôle de foyer", r.role, "role"], ["Type de foyer", r.householdType, "householdType"], ["Statut parent", r.parentStatus, "parentStatus"], ["Statut enfant", r.childStatus, "childStatus"], ["École actuelle", r.school, "school"]];

  const paymentsBody = `${recordGivingByYear(r)}
    ${Number(r.importedAmount || 0) ? `<p class="muted-note">Historique importé avant le CRM : ${euro(r.importedAmount)} sur ${r.importedPaymentsCount || 0} paiement(s).</p>` : ""}
    ${pays.length ? `<div class="pay-list">${pays.map(paymentTimelineItem).join("")}</div>` : `<div class="empty-state empty-small"><p>Aucun don enregistré pour l'instant.</p></div>`}`;
  const activityBody = `${r.importedInteractionsCount ? `<p class="muted-note">+ ${r.importedInteractionsCount} interaction(s) historiques importées avant le CRM.</p>` : ""}
    ${feed.length ? `<div class="timeline">${feed.map(i => interactionItem(i)).join("")}</div>` : `<div class="empty-state empty-small"><p>Aucun échange consigné. Notez vos appels, emails et rendez-vous pour garder le fil de la relation.</p></div>`}`;
  const tasksBody = recTasks.length ? `<div class="hp-task-list">${recTasks.map(hpTaskRow).join("")}</div>` : `<div class="empty-state empty-small"><p>Aucune tâche pour cette fiche.</p></div>`;
  const relationsBody = `${foyer.length ? fieldGrid(foyer) : ""}
    ${links.length ? `<div class="rows rows-flush">${links.map(l => {
      const other = linkageSide(l, "a") === r ? linkageSide(l, "b") : linkageSide(l, "a");
      const myRole = linkageSide(l, "a") === r ? l.roleA : l.roleB;
      const otherRole = linkageSide(l, "a") === r ? l.roleB : l.roleA;
      return `<div class="row">
        <button type="button" class="row-main" ${other ? `data-action="open-record:${other.id}"` : "disabled"}>${other ? avatar(other, "sm") : ""}<span class="row-text"><strong>${escapeHtml(other ? other.name : (linkageSide(l, "a") === r ? l.b : l.a))}</strong><span>${escapeHtml([l.type, otherRole && `${otherRole}`, myRole && `(${r.first || r.name} : ${myRole})`].filter(Boolean).join(" · "))}</span></span></button>
        <button type="button" class="icon-btn btn-sm" data-action="delete-linkage:${l.id}" title="Supprimer la liaison">${icon("x")}</button>
      </div>`;
    }).join("")}</div>` : ""}
    ${family.length ? `<p class="mini-title">Même famille « ${escapeHtml(r.family)} »</p><div class="rows rows-flush">${family.map(x => `<div class="row"><button type="button" class="row-main" data-action="open-record:${x.id}">${avatar(x, "sm")}<span class="row-text"><strong>${escapeHtml(x.name)}</strong><span>${escapeHtml([x.role, recordTotalAmount(x) ? `${euro(recordTotalAmount(x))} donnés` : ""].filter(Boolean).join(" · ") || "—")}</span></span></button></div>`).join("")}</div>` : ""}
    ${!foyer.length && !links.length && !family.length ? `<div class="empty-state empty-small"><p>Aucune liaison. Reliez cette fiche à un conjoint, un parent, un dirigeant…</p></div>` : ""}`;

  return `<div class="record-page">
    <div class="rp-top">
      <button type="button" class="back-btn" data-action="close-detail">${icon("chevron-left", 18)}<span>${escapeHtml(back || "Retour")}</span></button>
      <div class="row-actions">
        ${btn("Modifier", "edit-record", "", "edit")}
        <button type="button" class="icon-btn" data-menu="record-more" title="Plus d'actions" aria-label="Plus d'actions">${icon("more")}</button>
      </div>
    </div>
    <header class="panel rp-head">
      <div class="rp-identity">
        ${avatar(r, "xl")}
        <div class="rp-id">
          <div class="rp-badges">${toneBadge(structure ? "Structure" : "Contact")}${stageBadge(r)}${isInMyPortfolio(r) ? toneBadge("Mon portefeuille", "accent") : ""}</div>
          <h1>${escapeHtml(r.name || "(sans nom)")}</h1>
          <p class="rp-meta">${escapeHtml(meta.join(" · "))}${meta.length ? " · " : ""}<span class="rp-ref">${escapeHtml(r.id)}</span></p>
          ${(r.tags || []).length ? `<div class="chip-list">${r.tags.map(t => `<button type="button" class="tag tag-btn" data-action="apply-tag:${encodeURIComponent(t)}" title="Voir toutes les fiches « ${escapeHtml(t)} »">${escapeHtml(t)}</button>`).join("")}</div>` : ""}
        </div>
      </div>
      <div class="rp-contact">
        ${r.phone ? `<a class="btn" href="tel:${escapeHtml(String(r.phone).replace(/[^\d+]/g, ""))}" data-action="log-contact:Appel:${r.id}">${icon("phone")}Appeler</a>` : ""}
        ${r.email ? `<a class="btn" href="mailto:${escapeHtml(r.email)}" data-action="log-contact:Email:${r.id}">${icon("mail")}Email</a>` : ""}
        ${wa ? `<a class="btn" href="https://wa.me/${wa}" target="_blank" rel="noopener" data-action="log-contact:Message:${r.id}">${icon("chat")}WhatsApp</a>` : ""}
        ${!r.phone && !r.email ? `<button type="button" data-action="edit-record:email">${icon("plus")}Ajouter des coordonnées</button>` : ""}
      </div>
      ${isRecordDuplicated(r.id) ? `<div class="dup-alert">${icon("alert")}<span>Cette fiche a peut-être un doublon (même email ou même téléphone).</span>${btn("Vérifier", `dedupe-focus:${r.id}`, "btn-sm")}</div>` : ""}
      <div class="rp-kpis">
        <div><span>Total donné</span><strong>${euro(recordTotalAmount(r))}</strong></div>
        <div><span>En ${year}</span><strong>${euro(m.thisYear)}</strong></div>
        <div><span>Promesses en cours</span><strong class="${m.pending ? "text-warn" : ""}">${euro(m.pending)}</strong></div>
        <div><span>Dernier don</span><strong>${m.lastIso ? formatFrDateFull(m.lastIso) : "—"}</strong></div>
        <div><span>Paiements</span><strong>${recordPaymentsCount(r).toLocaleString("fr-FR")}</strong></div>
      </div>
      <div class="rp-quick quick-actions">
        ${btn("Don", `quick-payment:${r.id}`, "primary-btn", "plus")}
        ${btn("Promesse", `quick-pledge:${r.id}`, "", "plus")}
        ${btn("Interaction", `quick-interaction:${r.id}`, "", "plus")}
        ${btn("Tâche", `quick-task:${r.id}`, "", "plus")}
        ${btn("Note", `quick-comment:${r.id}`, "", "plus")}
      </div>
    </header>
    <nav class="detail-jumpnav">${DETAIL_SECTIONS.map(([key, label]) => `<button type="button" class="chip" data-tab="${key}">${escapeHtml(label)}</button>`).join("")}</nav>
    <div class="rp-grid">
      <div class="rp-side">
        ${detailSection("Details", "Coordonnées", fieldGrid(details))}
        ${detailSection("Categorisation", "Classement", fieldGrid(classement))}
        ${detailSection("Relations", "Relations", relationsBody, btn("Liaison", `add-linkage:${r.id}`, "btn-sm", "plus"))}
      </div>
      <div class="rp-main">
        ${detailSection("Paiements", "Dons et paiements", paymentsBody, `${btn("Don", `quick-payment:${r.id}`, "btn-sm", "plus")}`)}
        ${detailSection("Activité", "Activité", activityBody, `${btn("Interaction", `quick-interaction:${r.id}`, "btn-sm", "plus")}${btn("Note", `quick-comment:${r.id}`, "btn-sm", "plus")}`)}
        ${detailSection("Tâches", "Tâches", tasksBody, btn("Tâche", `quick-task:${r.id}`, "btn-sm", "plus"))}
      </div>
    </div>
  </div>`;
}

function groupsView() {
  const derived = new Map();
  records.forEach(r => (r.groups || []).forEach(g => { const c = derived.get(g) || { contacts: 0, structures: 0 }; c[r.kind === "Structure" ? "structures" : "contacts"] += 1; derived.set(g, c); }));
  const manual = groups.filter(g => !derived.has(g.name)).map(g => ({ name: g.name, contacts: 0, structures: 0, type: g.type || "Manuel" }));
  const rows = [...[...derived.entries()].map(([name, c]) => ({ name, ...c, type: groups.find(g => g.name === name)?.type || "Sur les fiches" })), ...manual].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return `<section class="panel">
    <div class="list-head"><div class="list-title"><h2>${plural(rows.length, "groupe")}</h2><p>Une fiche rejoint un groupe quand son champ « Groupes » porte ce nom.</p></div>${btn("Groupe", "add-group", "primary-btn", "plus")}</div>
    ${rows.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Nom</th><th class="num">Contacts</th><th class="num">Structures</th><th>Type</th></tr></thead><tbody>${rows.map(g => `<tr class="row-click" data-action="open-group:${encodeURIComponent(g.name)}"><td><strong>${escapeHtml(g.name)}</strong></td><td class="num">${g.contacts}</td><td class="num">${g.structures}</td><td>${escapeHtml(g.type)}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty-state"><span class="empty-ic">${icon("layers", 22)}</span><p>Aucun groupe pour l'instant. Les groupes apparaissent ici dès qu'une fiche en porte un.</p>${btn("Créer un groupe", "add-group", "primary-btn")}</div>`}
  </section>`;
}

function linkagesView() {
  return `<section class="panel">
    <div class="list-head"><div class="list-title"><h2>${plural(linkages.length, "liaison")}</h2><p>Conjoints, parents et enfants, dirigeants d'une structure…</p></div>${btn("Liaison", "add-linkage", "primary-btn", "plus")}</div>
    ${linkages.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Première fiche</th><th>Rôle</th><th>Deuxième fiche</th><th>Rôle</th><th>Type</th><th></th></tr></thead><tbody>${linkages.map(l => {
      const a = linkageSide(l, "a"), b = linkageSide(l, "b");
      const cell = (rec, name) => rec ? `<button type="button" class="cell-link" data-action="open-record:${rec.id}:Relations">${avatar(rec, "sm")}<strong>${escapeHtml(rec.name)}</strong></button>` : `<span class="muted">${escapeHtml(name || "Fiche supprimée")}</span>`;
      return `<tr><td>${cell(a, l.a)}</td><td>${escapeHtml(l.roleA || "—")}</td><td>${cell(b, l.b)}</td><td>${escapeHtml(l.roleB || "—")}</td><td>${tag(l.type || "Liaison")}</td><td class="num"><button type="button" class="icon-btn btn-sm" data-action="delete-linkage:${l.id}" title="Supprimer">${icon("trash")}</button></td></tr>`;
    }).join("")}</tbody></table></div>`
      : `<div class="empty-state"><span class="empty-ic">${icon("link", 22)}</span><p>Aucune liaison enregistrée. Reliez deux fiches pour retrouver d'un clic la famille ou l'entreprise d'un donateur.</p>${btn("Créer une liaison", "add-linkage", "primary-btn")}</div>`}
  </section>`;
}

/* ---------- 5. Suivi : tâches, interactions ----------------------------- */

// Ligne de tâche façon "Rappels" : case ronde, titre, puis une ligne discrète
// (échéance colorée · contact · assignée à).
function hpTaskRow(t) {
  const due = taskDueInfo(t);
  const linkedRecord = t.recordId ? recordById(t.recordId) : null;
  const done = t.status === "fait";
  const dueBtn = due.label
    ? `<button type="button" class="hp-task-date hp-task-date-${done ? "none" : due.tone}" data-action="edit-task:${t.id}" title="Modifier l'échéance">${escapeHtml(due.label)}</button>`
    : `<button type="button" class="hp-task-date hp-task-date-none" data-action="edit-task:${t.id}" title="Ajouter une échéance">Sans échéance</button>`;
  return `<div class="hp-task-row${done ? " hp-task-row-done" : ""}${t.priority === "haute" && !done ? " hp-task-row-high" : ""}">
    <input type="checkbox" class="hp-task-checkbox" data-action="toggle-task:${t.id}" ${done ? "checked" : ""} aria-label="Marquer comme faite">
    <div class="hp-task-body">
      <span class="hp-task-title">${t.priority === "haute" && !done ? `<span class="task-flag" title="Priorité haute">${icon("flag", 13)}</span>` : ""}${escapeHtml(t.title)}</span>
      ${t.note ? `<span class="hp-task-note">${escapeHtml(t.note)}</span>` : ""}
      <div class="hp-task-meta">
        ${dueBtn}
        ${linkedRecord ? `<button type="button" class="hp-task-contact-chip" data-action="open-record:${linkedRecord.id}:Tâches" title="Ouvrir la fiche">${escapeHtml(linkedRecord.name || "")}</button>` : ""}
        ${t.holidayKey ? `<button type="button" class="hp-task-contact-chip" data-action="holiday-prepare:${t.holidayKey}" title="Ouvrir la case idée">Idée à noter</button>` : ""}
        ${t.assignedTo ? `<span class="hp-task-assignee" title="Assignée à ${escapeHtml(t.assignedTo)}">${escapeHtml(t.assignedTo)}</span>` : ""}
      </div>
    </div>
    <div class="hp-task-row-icons">
      <button type="button" class="hp-task-edit" data-action="edit-task:${t.id}" title="Modifier" aria-label="Modifier">${icon("edit", 15)}</button>
      <button type="button" class="hp-task-remove" data-action="delete-task:${t.id}" title="Supprimer" aria-label="Supprimer">${icon("trash", 15)}</button>
    </div>
  </div>`;
}

function tasksView() {
  const today = todayIso();
  const weekEnd = addDaysIso(today, 7);
  const scope = state.taskScope === "all" ? "all" : "mine";
  const inScope = t => scope === "all" || isMyTask(t);
  const byDue = (a, b) => (b.priority === "haute") - (a.priority === "haute") || `${a.dueDate || "9999"} ${a.dueTime || "99"}`.localeCompare(`${b.dueDate || "9999"} ${b.dueTime || "99"}`);
  const open = tasks.filter(t => t.status !== "fait" && inScope(t)).sort(byDue);
  const done = tasks.filter(t => t.status === "fait" && inScope(t)).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
  const groupsList = [
    ["En retard", open.filter(t => t.dueDate && t.dueDate < today), "bad"],
    ["Aujourd'hui", open.filter(t => t.dueDate === today), "accent"],
    ["Dans les 7 jours", open.filter(t => t.dueDate > today && t.dueDate <= weekEnd), ""],
    ["Plus tard", open.filter(t => t.dueDate > weekEnd), ""],
    ["Sans échéance", open.filter(t => !t.dueDate), ""],
  ].filter(([, list]) => list.length);
  return `<div class="narrow-page">
    <section class="panel">
      <div class="list-head">
        <div class="list-title"><h2>${open.length ? plural(open.length, "tâche") + " en cours" : "Tout est fait"}</h2><p>${scope === "mine" ? "Les tâches qui vous sont assignées (ou sans responsable)." : "Toutes les tâches de l'équipe."}</p></div>
        <div class="row-actions">
          <div class="segmented"><button type="button" class="${scope === "mine" ? "active" : ""}" data-action="task-scope:mine">Mes tâches</button><button type="button" class="${scope === "all" ? "active" : ""}" data-action="task-scope:all">Toute l'équipe</button></div>
          ${btn("Tâche", "add-task", "primary-btn", "plus")}
        </div>
      </div>
      ${groupsList.length ? groupsList.map(([label, list, tone]) => `<div class="task-group">
        <h3 class="group-title${tone ? ` tone-${tone}` : ""}">${escapeHtml(label)}<span>${list.length}</span></h3>
        <div class="hp-task-list">${list.map(hpTaskRow).join("")}</div>
      </div>`).join("") : `<div class="empty-state"><span class="empty-ic">${icon("check", 22)}</span><p>Aucune tâche en cours. Ajoutez un rappel pour ne rien laisser passer : une relance, un appel, un remerciement…</p>${btn("Ajouter une tâche", "add-task", "primary-btn")}</div>`}
      ${done.length ? `<div class="task-group">
        <button type="button" class="link-btn" data-action="toggle-done-tasks">${state.showDoneTasks ? "Masquer" : "Afficher"} les tâches terminées (${done.length})</button>
        ${state.showDoneTasks ? `<div class="hp-task-list hp-task-list-done">${done.slice(0, 60).map(hpTaskRow).join("")}</div>` : ""}
      </div>` : ""}
    </section>
  </div>`;
}

function interactionsView() {
  const terms = normalizeSearchText(state.query).split(/\s+/).filter(Boolean);
  const types = [...new Set(interactions.map(i => i.type === "Commentaire" ? "Note" : i.type).filter(Boolean))];
  const rows = interactions.filter(i => {
    const type = i.type === "Commentaire" ? "Note" : i.type;
    if (state.interactionFilter && type !== state.interactionFilter) return false;
    if (!terms.length) return true;
    const hay = normalizeSearchText([recordById(i.recordId)?.name, i.target, i.label, i.note, i.category, i.user, i.type].join(" "));
    return terms.every(t => hay.includes(t));
  }).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const shown = rows.slice(0, 200);
  return `<section class="panel list-panel">
    <div class="list-head">
      <div class="list-title"><h2>${plural(rows.length, "interaction")}</h2><p>Chaque échange consigné avec un contact ou une structure.</p></div>
      <div class="row-actions">${btn("Exporter", "export-interactions", "", "download")}${btn("Interaction", "add-interaction", "primary-btn", "plus")}</div>
    </div>
    <div class="list-tools">
      <label class="search-field">${icon("search")}<input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Rechercher un nom, un libellé, une note…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <div class="chips"><button type="button" class="chip${!state.interactionFilter ? " active" : ""}" data-action="interaction-filter:">Tout</button>${types.map(t => `<button type="button" class="chip${state.interactionFilter === t ? " active" : ""}" data-action="interaction-filter:${encodeURIComponent(t)}">${escapeHtml(t)}</button>`).join("")}</div>
    </div>
    ${shown.length ? `<div class="timeline timeline-page">${shown.map(i => interactionItem(i, true)).join("")}</div>${rows.length > shown.length ? `<p class="muted-note pad-x">Les 200 plus récentes sont affichées. Précisez la recherche pour retrouver une interaction plus ancienne.</p>` : ""}`
      : `<div class="empty-state"><span class="empty-ic">${icon("chat", 22)}</span><p>${interactions.length ? "Aucune interaction ne correspond à cette recherche." : "Aucune interaction enregistrée pour l'instant."}</p>${interactions.length ? btn("Effacer la recherche", "reset-filters") : btn("Ajouter une interaction", "add-interaction", "primary-btn")}</div>`}
  </section>`;
}

/* ---------- 6. Collecte ------------------------------------------------- */

function paymentsView() {
  if (state.section === "Reçus") return receipts();
  if (state.section === "Promesses") return pledgesView();
  if (state.section === "Campagnes") return campaignsView();
  return paymentsList();
}

function paymentsList() {
  const rows = filteredPayments();
  const { visible, remaining } = visiblePage(rows, "paymentsPage");
  const pf = state.payFilters;
  const received = rows.reduce((s, p) => s + paymentReceivedAmount(p), 0);
  const receivedCount = rows.filter(p => paymentReceivedAmount(p) > 0).length;
  const pendingAmount = rows.reduce((s, p) => s + (paymentIsPending(p) ? Math.max(0, paymentRemaining(p)) : 0), 0);
  const years = distinctPaymentYears();
  const methods = [...new Set(payments.map(p => p.method).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const filtered = !!(state.query || pf.type || pf.year || pf.status || pf.method);
  const more = loadMoreButton(remaining, "load-more-payments");
  const select = (key, label, options) => `<select data-pay-filter="${key}" aria-label="${label}"><option value="">${label}</option>${options.map(([v, l]) => `<option value="${escapeHtml(v)}" ${pf[key] === v ? "selected" : ""}>${escapeHtml(l)}</option>`).join("")}</select>`;
  if (!payments.length) return `<section class="panel"><div class="empty-state empty-big">
    <span class="empty-ic">${icon("heart", 26)}</span><h2>Aucun paiement pour l'instant</h2>
    <p>Enregistrez un premier don, ou importez l'historique de vos paiements depuis un fichier CSV ou Excel.</p>
    <div class="row-actions">${btn("Nouveau don", "add-payment:Don", "primary-btn", "plus")}${btn("Importer des paiements", "import-new", "", "upload")}</div>
  </div></section>`;
  return `<div class="stack">
    <section class="kpi-grid">
      ${kpi(filtered ? "Reçu (sélection)" : "Total reçu", euro(received), plural(receivedCount, "paiement"))}
      ${kpi("Don moyen", euro(receivedCount ? received / receivedCount : 0), "")}
      ${kpi("En attente", euro(pendingAmount), pendingAmount ? "Promesses pas encore versées" : "Rien en attente")}
      ${kpi("Lignes", rows.length.toLocaleString("fr-FR"), filtered ? `sur ${payments.length.toLocaleString("fr-FR")}` : "au total")}
    </section>
    <section class="panel list-panel">
      <div class="list-head">
        <div class="segmented">${[["", "Tous"], ["Don", "Dons"], ["Adhésion", "Adhésions"], ["Billetterie", "Billetterie"]].map(([v, l]) => `<button type="button" class="${pf.type === v ? "active" : ""}" data-action="pay-type:${v}">${l}</button>`).join("")}</div>
        <div class="row-actions">
          <button type="button" data-menu="payments-actions">${icon("more")}<span class="hide-sm">Actions</span></button>
          ${btn("Don", "add-payment:Don", "primary-btn", "plus")}
        </div>
      </div>
      <div class="list-tools">
        <label class="search-field">${icon("search")}<input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Donateur, occasion, numéro de reçu, montant…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <div class="filter-selects">
          ${select("year", "Année", years.map(y => [y, y]))}
          ${select("status", "Statut", [["recu", "Reçus"], ["attente", "En attente"], ["echec", "Échoués"]])}
          ${select("method", "Moyen", methods.map(m => [m, m]))}
          ${filtered ? btn("Effacer", "reset-filters", "link-btn") : ""}
        </div>
      </div>
      ${rows.length ? `<div class="table-wrap desktop-only"><table class="data-table"><thead><tr><th>Date</th><th>Donateur</th><th class="num">Montant</th><th>Type</th><th>Occasion</th><th>Statut</th><th>Moyen</th><th>Reçu fiscal</th></tr></thead>
        <tbody>${visible.map(p => {
          const rec = recordById(p.recordId);
          return `<tr class="row-click" data-action="open-record:${p.recordId}:Paiements">
            <td class="nowrap">${escapeHtml(paymentPrimaryDate(p))}</td>
            <td><div class="cell-person">${rec ? avatar(rec, "sm") : ""}<strong>${escapeHtml(p.payer || rec?.name || "—")}</strong></div></td>
            <td class="num"><strong class="money">${euro(p.amount)}</strong>${paymentIsPending(p) && paymentPaidTotal(p) ? `<span class="cell-sub">${euro(paymentPaidTotal(p))} versés</span>` : ""}</td>
            <td>${escapeHtml(p.type || "")}</td>
            <td><div class="cell-tags">${(p.occasion || []).map(o => tag(o, "violet")).join("") || `<span class="muted">—</span>`}</div></td>
            <td>${paymentBadge(p)}</td>
            <td>${escapeHtml(p.method || "—")}</td>
            <td>${receiptBadge(p)}</td>
          </tr>`;
        }).join("")}</tbody></table>${more}</div>
      <div class="record-cards mobile-only">${visible.map(p => `<button type="button" class="record-card" data-action="open-record:${p.recordId}:Paiements">
        <span class="record-card-body">
          <span class="record-card-head"><strong>${escapeHtml(p.payer || "—")}</strong><span class="money">${euro(p.amount)}</span></span>
          <span class="record-card-sub">${escapeHtml([p.type, paymentPrimaryDate(p), p.method].filter(Boolean).join(" · "))}</span>
          <span class="chip-list">${paymentBadge(p)}${(p.occasion || []).map(o => tag(o, "violet")).join("")}</span>
        </span>
      </button>`).join("")}${more}</div>`
      : `<div class="empty-state"><span class="empty-ic">${icon("search", 22)}</span><p>Aucun paiement ne correspond à ces critères.</p>${btn("Effacer la recherche et les filtres", "reset-filters")}</div>`}
    </section>
  </div>`;
}

function pledgesView() {
  const today = todayIso();
  const list = payments.filter(p => paymentIsPending(p) && paymentRemaining(p) > 0).sort((a, b) => paymentIso(a).localeCompare(paymentIso(b)));
  const totalDue = list.reduce((s, p) => s + paymentRemaining(p), 0);
  const promised = list.reduce((s, p) => s + Number(p.amount || 0), 0);
  const old = list.filter(p => daysBetweenIso(paymentIso(p) || today, today) > 60);
  return `<div class="stack">
    <section class="kpi-grid">
      ${kpi("Reste à encaisser", euro(totalDue), plural(list.length, "promesse") + " en cours")}
      ${kpi("Montant promis", euro(promised), promised > totalDue ? `${euro(promised - totalDue)} déjà versés` : "Aucun versement reçu")}
      ${kpi("Depuis plus de 60 jours", old.length.toLocaleString("fr-FR"), old.length ? `${euro(old.reduce((s, p) => s + paymentRemaining(p), 0))} à relancer en priorité` : "Rien d'ancien")}
    </section>
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>Promesses de dons</h2><p>Les plus anciennes en premier. Une promesse devient un don dès qu'elle est marquée reçue.</p></div>${btn("Promesse", "add-pledge", "primary-btn", "plus")}</div>
      ${list.length ? `<div class="rows rows-padded">${list.map(p => {
        const rec = recordById(p.recordId);
        const days = daysBetweenIso(paymentIso(p) || today, today);
        const paid = paymentPaidTotal(p);
        return `<div class="row row-wide">
          <button type="button" class="row-main" data-action="open-record:${p.recordId}:Paiements">${rec ? avatar(rec) : ""}<span class="row-text"><strong>${escapeHtml(p.payer || "—")}</strong><span class="${days > 60 ? "text-bad" : ""}">Promis le ${escapeHtml(paymentPrimaryDate(p))} · ${relativeDays(paymentIso(p))}${(p.occasion || []).length ? ` · ${escapeHtml(p.occasion.join(", "))}` : ""}</span></span></button>
          <div class="pledge-progress">
            <span class="pledge-figures"><strong class="money">${euro(paymentRemaining(p))}</strong> restants sur ${euro(p.amount)}</span>
            ${progressBar(paid / Math.max(1, Number(p.amount || 0)))}
          </div>
          <div class="row-actions">
            ${btn("Versement", `add-installment:${p.id}`, "btn-sm", "plus")}
            ${btn("Reçu", `mark-received:${p.id}`, "btn-sm primary-btn", "check")}
            <button type="button" class="icon-btn btn-sm" data-action="quick-task:${p.recordId}" title="Créer une tâche de relance">${icon("bell")}</button>
          </div>
        </div>`;
      }).join("")}</div>`
        : `<div class="empty-state"><span class="empty-ic">${icon("clock", 22)}</span><p>Aucune promesse en attente. Quand un donateur s'engage sans avoir encore payé, enregistrez-le ici pour suivre l'encaissement.</p>${btn("Enregistrer une promesse", "add-pledge", "primary-btn")}</div>`}
    </section>
  </div>`;
}

// Chiffres par occasion/campagne, en un passage sur les paiements.
function occasionStats() {
  const stats = new Map();
  payments.forEach(p => (p.occasion || []).forEach(o => {
    const key = String(o).trim().toLowerCase();
    if (!key) return;
    const s = stats.get(key) || { name: o, raised: 0, pledged: 0, count: 0, donors: new Set() };
    const got = paymentReceivedAmount(p);
    s.raised += got;
    if (paymentIsPending(p)) s.pledged += Math.max(0, paymentRemaining(p));
    if (got > 0 || paymentIsPending(p)) { s.count += 1; if (p.recordId) s.donors.add(p.recordId); }
    stats.set(key, s);
  }));
  return stats;
}
function campaignsView() {
  const stats = occasionStats();
  const today = todayIso();
  const active = campaigns.filter(c => !c.archived);
  const archived = campaigns.filter(c => c.archived);
  const known = new Set(campaigns.map(c => c.name.toLowerCase()));
  const others = [...stats.entries()].filter(([key]) => !known.has(key)).map(([, s]) => s).sort((a, b) => b.raised - a.raised).slice(0, 12);
  const card = c => {
    const s = stats.get(c.name.toLowerCase()) || { raised: 0, pledged: 0, count: 0, donors: new Set() };
    const goal = Number(c.goal || 0);
    const ratio = goal ? s.raised / goal : 0;
    const daysLeft = c.endDate && c.endDate >= today ? daysBetweenIso(today, c.endDate) : null;
    const period = [c.startDate && formatFrDateFull(c.startDate), c.endDate && formatFrDateFull(c.endDate)].filter(Boolean).join(" → ");
    return `<article class="panel campaign${c.archived ? " is-archived" : ""}">
      <div class="campaign-head">
        <div><h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(period || "Sans dates")}${daysLeft !== null ? ` · ${daysLeft === 0 ? "dernier jour" : `J-${daysLeft}`}` : c.endDate && c.endDate < today ? " · terminée" : ""}</p></div>
        ${goal ? `<span class="campaign-pct${ratio >= 1 ? " is-done" : ""}">${Math.round(ratio * 100)} %</span>` : ""}
      </div>
      <div class="campaign-figures"><strong class="money">${euro(s.raised)}</strong>${goal ? `<span>sur un objectif de ${euro(goal)}</span>` : `<span>collectés</span>`}</div>
      ${goal ? progressBar(ratio, ratio >= 1 ? "ok" : "") : ""}
      <div class="campaign-stats"><span><strong>${s.donors.size.toLocaleString("fr-FR")}</strong> donateur(s)</span><span><strong>${s.count.toLocaleString("fr-FR")}</strong> don(s)</span>${s.pledged ? `<span><strong>${euro(s.pledged)}</strong> promis</span>` : ""}${goal && ratio < 1 ? `<span><strong>${euro(goal - s.raised)}</strong> restants</span>` : ""}</div>
      ${c.note ? `<p class="campaign-note">${escapeHtml(c.note)}</p>` : ""}
      <div class="row-actions">
        ${btn("Voir les dons", `open-campaign:${encodeURIComponent(c.name)}`, "btn-sm")}
        ${btn("Modifier", `edit-campaign:${c.id}`, "btn-sm", "edit")}
        ${btn(c.archived ? "Réactiver" : "Archiver", `archive-campaign:${c.id}`, "btn-sm")}
        <button type="button" class="icon-btn btn-sm danger-text" data-action="delete-campaign:${c.id}" title="Supprimer">${icon("trash")}</button>
      </div>
    </article>`;
  };
  return `<div class="stack">
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>${active.length ? plural(active.length, "campagne") + " en cours" : "Campagnes de collecte"}</h2><p>Fixez un objectif à un gala, un appel de fin d'année, un projet… et suivez son avancement en temps réel.</p></div>${btn("Campagne", "add-campaign", "primary-btn", "plus")}</div>
      ${active.length ? `<div class="campaign-grid">${active.map(card).join("")}</div>`
        : `<div class="empty-state"><span class="empty-ic">${icon("target", 22)}</span><p>Aucune campagne en cours. Créez-en une, puis indiquez son nom dans le champ « Occasion / campagne » des dons pour voir l'objectif se remplir.</p>${btn("Créer une campagne", "add-campaign", "primary-btn")}</div>`}
    </section>
    ${archived.length ? `<section class="panel"><div class="list-head"><div class="list-title"><h2>Campagnes archivées</h2></div></div><div class="campaign-grid">${archived.map(card).join("")}</div></section>` : ""}
    ${others.length ? `<section class="panel pad">
      ${sectionHead("Autres occasions de don", "", "Occasions déjà utilisées sur des dons, sans objectif. Cliquez pour voir les dons correspondants.")}
      ${hbarList(others.map(s => ({ label: s.name, sub: `${plural(s.count, "don")} · ${plural(s.donors.size, "donateur")}`, value: s.raised, action: `open-campaign:${encodeURIComponent(s.name)}` })))}
    </section>` : ""}
  </div>`;
}

function receipts() {
  const eligible = payments.filter(p => (p.type === "Don" || p.type === "Adhésion") && !paymentIsPending(p) && !paymentIsFailed(p));
  const toGenerate = eligible.filter(p => /g[ée]n[ée]rer/i.test(p.receipt || ""));
  const generated = eligible.filter(p => /^g[ée]n[ée]r[ée]$/i.test(p.receipt || ""));
  const external = eligible.filter(p => /ailleurs/i.test(p.receipt || ""));
  const filter = state.receiptsFilter || (toGenerate.length ? "todo" : "done");
  const terms = normalizeSearchText(state.query).split(/\s+/).filter(Boolean);
  const pool = { todo: toGenerate, done: generated, external, all: eligible }[filter] || eligible;
  const rows = pool.filter(p => !terms.length || terms.every(t => normalizeSearchText([p.payer, p.receiptNumber, p.amount].join(" ")).includes(t)))
    .sort((a, b) => filter === "done" ? String(b.receiptNumber || "").localeCompare(String(a.receiptNumber || "")) : paymentSortKey(b).localeCompare(paymentSortKey(a)));
  const { visible, remaining } = visiblePage(rows, "paymentsPage");
  const more = loadMoreButton(remaining, "load-more-payments");
  const chip = (key, label, n) => `<button type="button" class="chip${filter === key ? " active" : ""}" data-action="receipts-filter:${key}">${label}<span class="chip-count">${n.toLocaleString("fr-FR")}</span></button>`;
  return `<div class="split">
    <section class="panel list-panel">
      <div class="list-head">
        <div class="list-title"><h2>Reçus fiscaux</h2><p>${toGenerate.length ? `${plural(toGenerate.length, "reçu")} à générer pour ${euro(toGenerate.reduce((s, p) => s + Number(p.amount || 0), 0))}` : "Tous les reçus sont à jour"}</p></div>
        ${toGenerate.length ? btn(`Générer les ${toGenerate.length} reçus`, "generate-receipts", "primary-btn", "receipt") : ""}
      </div>
      <div class="list-tools">
        <label class="search-field">${icon("search")}<input class="search" id="pageSearch" value="${escapeHtml(state.query)}" placeholder="Donateur ou numéro de reçu…" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <div class="chips">${chip("todo", "À générer", toGenerate.length)}${chip("done", "Générés", generated.length)}${external.length ? chip("external", "Émis ailleurs", external.length) : ""}${chip("all", "Tous", eligible.length)}</div>
      </div>
      ${rows.length ? `<div class="rows rows-padded">${visible.map(p => {
        const rec = recordById(p.recordId);
        const externe = /ailleurs/i.test(p.receipt || "");
        return `<div class="row row-wide">
          <button type="button" class="row-main" data-action="open-record:${p.recordId}:Paiements">${rec ? avatar(rec, "sm") : ""}<span class="row-text"><strong>${escapeHtml(p.payer || "—")}</strong><span>${escapeHtml([p.receiptNumber || "Pas encore de numéro", paymentPrimaryDate(p), p.type].filter(Boolean).join(" · "))}${rec && !rec.address && !externe ? ` · <span class="text-warn">adresse manquante</span>` : ""}</span></span></button>
          <span class="row-amount">${euro(p.amount)}</span>
          <div class="row-actions">${externe ? `<span class="muted">Émis par l'ancien système</span>` : p.receiptNumber
            ? `${btn("PDF", `download-receipt-pdf:${p.id}`, "btn-sm", "download")}${btn("Régénérer", `regenerate-receipt:${p.id}`, "btn-sm")}`
            : btn("Générer", `regenerate-receipt:${p.id}`, "btn-sm primary-btn", "receipt")}</div>
        </div>`;
      }).join("")}</div>${more}`
        : `<div class="empty-state"><span class="empty-ic">${icon("receipt", 22)}</span><p>${filter === "todo" ? "Aucun reçu en attente : tous les dons reçus ont leur reçu fiscal." : "Aucun reçu dans cette liste."}</p></div>`}
    </section>
    <div class="stack">
      <section class="panel pad">
        ${sectionHead("Organisme émetteur")}
        <dl class="def-list">
          <div><dt>Nom</dt><dd>${escapeHtml(RECEIPT_ENTITY.name)}</dd></div>
          <div><dt>Adresse</dt><dd>${escapeHtml(RECEIPT_ENTITY.address)}</dd></div>
          <div><dt>N° d'identification</dt><dd>${escapeHtml(RECEIPT_ENTITY.siren)}</dd></div>
          <div><dt>Qualité</dt><dd>${escapeHtml(RECEIPT_ENTITY.qualite)}</dd></div>
          <div><dt>Signataire</dt><dd>${escapeHtml(RECEIPT_ENTITY.signatoryName)}, ${escapeHtml(RECEIPT_ENTITY.signatoryTitle)}</dd></div>
        </dl>
        <p class="muted-note">Un particulier reçoit un reçu au titre de l'article 200 du CGI, une structure au titre de l'article 238 bis.</p>
      </section>
      <section class="panel pad">
        ${sectionHead("Journal comptable")}
        <p class="muted-note">${receiptLog.length ? `${plural(receiptLog.length, "émission")} enregistrée(s)` : "Aucune émission enregistrée pour l'instant"} — une ligne par reçu généré ou régénéré, à remettre à l'expert-comptable.</p>
        ${btn("Exporter le journal (CSV)", "export-receipt-log", "", "download")}
      </section>
    </div>
  </div>`;
}

/* ---------- 7. Statistiques --------------------------------------------- */

function stats() {
  const c = collectNumbers();
  const years = [...c.byYear.keys()].sort();
  const year = state.statsYear && c.byYear.has(state.statsYear) ? state.statsYear : (c.byYear.has(c.year) ? c.year : (years[years.length - 1] || c.year));
  const prev = String(Number(year) - 1);
  const inYear = payments.filter(p => paymentReceivedAmount(p) > 0 && paymentIso(p).startsWith(year));
  const total = inYear.reduce((s, p) => s + paymentReceivedAmount(p), 0);
  const donors = new Set(inYear.map(p => p.recordId).filter(Boolean));
  const prevDonors = new Set(payments.filter(p => paymentReceivedAmount(p) > 0 && paymentIso(p).startsWith(prev)).map(p => p.recordId).filter(Boolean));
  const kept = [...prevDonors].filter(id => donors.has(id)).length;
  const firstTimers = [...donors].filter(id => { const r = recordById(id); return r && recordMetrics(r).firstIso.startsWith(year) && !Number(r.importedAmount || 0); }).length;
  const sumBy = keyFn => {
    const map = new Map();
    inYear.forEach(p => [].concat(keyFn(p)).forEach(k => { if (k) map.set(k, (map.get(k) || 0) + paymentReceivedAmount(p)); }));
    return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  };
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
    return { label: new Date(Date.UTC(2020, i, 1)).toLocaleDateString("fr-FR", { month: "short", timeZone: "UTC" }).replace(".", ""), value: c.byMonth.get(ym) || 0, compare: c.byMonth.get(`${prev}-${ym.slice(5)}`) || 0, current: ym === c.today.slice(0, 7) };
  });
  const byDonor = new Map();
  inYear.forEach(p => { if (p.recordId) byDonor.set(p.recordId, (byDonor.get(p.recordId) || 0) + paymentReceivedAmount(p)); });
  const top = [...byDonor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10Share = total ? top.reduce((s, [, v]) => s + v, 0) / total : 0;
  const bands = [["Moins de 100 €", 0, 100], ["100 à 499 €", 100, 500], ["500 à 999 €", 500, 1000], ["1 000 à 4 999 €", 1000, 5000], ["5 000 € et plus", 5000, Infinity]]
    .map(([label, min, max]) => { const list = [...byDonor.values()].filter(v => v >= min && v < max); return { label, sub: plural(list.length, "donateur"), value: list.reduce((s, v) => s + v, 0) }; }).filter(b => b.value);
  const contacts = records.filter(r => r.kind !== "Structure");
  const withEmail = contacts.filter(r => r.email).length;
  const tagCounts = new Map();
  records.forEach(r => (r.tags || []).forEach(t => tagCounts.set(t, (tagCounts.get(t) || 0) + 1)));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!payments.length && !records.length) return `<section class="panel"><div class="empty-state empty-big"><span class="empty-ic">${icon("chart", 26)}</span><h2>Pas encore de chiffres</h2><p>Les statistiques apparaîtront dès les premiers contacts et dons enregistrés.</p></div></section>`;
  return `<div class="stack">
    <div class="stats-bar">
      <div class="chips">${years.slice(-8).map(y => `<button type="button" class="chip${y === year ? " active" : ""}" data-action="stats-year:${y}">${y}</button>`).join("")}</div>
    </div>
    <section class="kpi-grid kpi-grid-5">
      ${kpi(`Collecté en ${year}`, euro(total), c.byYear.get(prev) ? `${euro(c.byYear.get(prev))} en ${prev}` : "", year === c.year ? deltaChip(c.ytd, c.lastYtd, "à date égale") : deltaChip(total, c.byYear.get(prev) || 0, `vs ${prev}`))}
      ${kpi("Donateurs", donors.size.toLocaleString("fr-FR"), prevDonors.size ? `${prevDonors.size.toLocaleString("fr-FR")} en ${prev}` : "")}
      ${kpi("Nouveaux donateurs", firstTimers.toLocaleString("fr-FR"), donors.size ? `${Math.round((firstTimers / donors.size) * 100)} % des donateurs` : "")}
      ${kpi("Fidélisation", prevDonors.size ? `${Math.round((kept / prevDonors.size) * 100)} %` : "—", prevDonors.size ? `${kept} donateur(s) de ${prev} ont redonné` : `Pas de donateurs en ${prev}`)}
      ${kpi("Don moyen", euro(inYear.length ? total / inYear.length : 0), plural(inYear.length, "paiement"))}
    </section>
    <div class="stats-grid">
      <section class="panel pad stats-wide">
        ${sectionHead(`Collecte par mois — ${year}`)}
        ${barChart(months, { label: `Montants reçus par mois en ${year}` })}
        <div class="chart-legend"><span><i class="dot"></i>${year}</span><span><i class="dot dot-compare"></i>${prev}</span></div>
      </section>
      <section class="panel pad">
        ${sectionHead("Collecte par année")}
        ${barChart(years.slice(-8).map(y => ({ label: y, value: c.byYear.get(y) || 0, current: y === year })), { label: "Montants reçus par année" })}
      </section>
      <section class="panel pad">
        ${sectionHead("Meilleurs donateurs", "", top.length ? `Les 10 premiers représentent ${Math.round(top10Share * 100)} % de la collecte ${year}` : "")}
        ${top.length ? `<div class="rows rows-flush">${top.map(([id, value], i) => { const r = recordById(id); return r ? `<div class="row"><span class="rank">${i + 1}</span><button type="button" class="row-main" data-action="open-record:${id}:Paiements">${avatar(r, "sm")}<span class="row-text"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.city || "")}</span></span></button><span class="row-amount">${euro(value)}</span></div>` : ""; }).join("")}</div>` : `<p class="muted-note">Aucun don reçu en ${year}.</p>`}
      </section>
      <section class="panel pad">
        ${sectionHead("Par niveau de don", "", `Total donné par donateur en ${year}`)}
        ${hbarList(bands, { empty: `Aucun don reçu en ${year}.` })}
      </section>
      <section class="panel pad">
        ${sectionHead("Par occasion / campagne")}
        ${hbarList(sumBy(p => p.occasion || []).slice(0, 8), { empty: "Aucune occasion renseignée sur les dons de cette année." })}
      </section>
      <section class="panel pad">
        ${sectionHead("Par moyen de paiement")}
        ${hbarList(sumBy(p => p.method || "Non précisé").slice(0, 8))}
      </section>
      <section class="panel pad">
        ${sectionHead("Par type")}
        ${hbarList(sumBy(p => p.type || "Autre"))}
      </section>
      <section class="panel pad">
        ${sectionHead("Par école / campus", "", "D'après les étiquettes des donateurs")}
        ${hbarList(sumBy(p => { const r = recordById(p.recordId); const cs = r ? recordCampuses(r) : []; return cs.length ? cs : ["Autre"]; }))}
      </section>
      <section class="panel pad">
        ${sectionHead("Répertoire")}
        <div class="mini-kpis">
          <div><strong>${contacts.length.toLocaleString("fr-FR")}</strong><span>contacts</span></div>
          <div><strong>${(records.length - contacts.length).toLocaleString("fr-FR")}</strong><span>structures</span></div>
          <div><strong>${contacts.length ? Math.round((withEmail / contacts.length) * 100) : 0} %</strong><span>avec email</span></div>
          <div><strong>${interactions.length.toLocaleString("fr-FR")}</strong><span>interactions</span></div>
        </div>
        ${topTags.length ? `<p class="mini-title">Étiquettes les plus utilisées</p>${hbarList(topTags.map(([label, value]) => ({ label, value, action: `apply-tag:${encodeURIComponent(label)}` })), { format: v => v.toLocaleString("fr-FR") })}` : ""}
      </section>
    </div>
  </div>`;
}

/* ---------- 8. Imports, paramètres, administration ---------------------- */

function importsView() {
  return `<div class="split">
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>Historique des imports</h2><p>${imports.length ? plural(imports.length, "import") : "Aucun import pour l'instant"}</p></div>${btn("Importer un fichier", "import-new", "primary-btn", "upload")}</div>
      ${imports.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Fichier</th><th>Type</th><th class="num">Lignes</th><th class="num">Créés</th><th class="num">Mis à jour</th><th class="num">Ignorés</th><th>Par</th></tr></thead><tbody>${imports.map(r => `<tr>
        <td class="nowrap">${escapeHtml(r.date || "")}</td><td><strong>${escapeHtml(r.file || "")}</strong></td><td>${tag(r.type || "Contacts")}</td>
        <td class="num">${Number(r.rows || 0).toLocaleString("fr-FR")}</td><td class="num">${Number(r.created || 0).toLocaleString("fr-FR")}</td><td class="num">${Number(r.updated || 0).toLocaleString("fr-FR")}</td><td class="num">${(Number(r.rejected || 0) + (r.type === "Paiements" ? Number(r.duplicates || 0) : 0)).toLocaleString("fr-FR")}</td><td>${escapeHtml(r.user || "")}</td>
      </tr>`).join("")}</tbody></table></div>`
        : `<div class="empty-state"><span class="empty-ic">${icon("upload", 22)}</span><p>Importez vos contacts ou votre historique de paiements depuis un fichier CSV ou Excel.</p>${btn("Importer un fichier", "import-new", "primary-btn")}</div>`}
    </section>
    <section class="panel pad">
      ${sectionHead("Comment préparer un fichier")}
      <p class="mini-title">Contacts</p>
      <p class="muted-note">Une ligne par personne. Colonnes reconnues : Prénom, Nom, Email, Téléphone, Adresse, Code postal, Ville, Date de naissance, Étiquettes de contact, Segments, Groupes, Agent, Commentaire… Une fiche qui a déjà le même email est mise à jour au lieu d'être créée en double.</p>
      <p class="mini-title">Paiements</p>
      <p class="muted-note">Une ligne par paiement, avec au minimum une colonne <strong>Montant</strong> et de quoi retrouver le donateur (Email, ou Prénom + Nom). Colonnes reconnues : Date, Type, Statut, Moyen de paiement, Occasion ou Campagne, N° de reçu. Un paiement déjà présent (même fiche, même montant, même date) est ignoré.</p>
    </section>
  </div>`;
}

function appsView() {
  return `<section class="panel pad">
    ${sectionHead("Intégrations", "", "Aucune de ces connexions n'est active pour l'instant : rien n'est synchronisé automatiquement. En attendant, l'import de fichiers (CSV ou Excel) permet de reprendre les données de ces outils.")}
    <div class="integration-grid">${apps.map(a => `<div class="integration"><strong>${escapeHtml(a[0])}</strong><span>${escapeHtml(a[1])}</span>${toneBadge("Non connecté")}</div>`).join("")}</div>
  </section>`;
}

function accountView() {
  const a = currentAccount || {};
  const name = `${a.first || ""} ${a.last || ""}`.trim() || a.email || "";
  const dark = getEffectiveTheme() === "dark";
  return `<div class="narrow-page stack">
    <section class="panel pad">
      <div class="account-head">${avatar({ name, kind: "Contact" }, "xl")}<div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(a.email || "")}</p><div class="chip-list">${toneBadge(a.profile || "", "accent")}${toneBadge(a.scopeMode === "tags" ? "Accès restreint par catégorie" : "Accès à tous les contacts")}</div></div></div>
    </section>
    <section class="panel pad">
      ${sectionHead("Sécurité")}
      <div class="setting-row"><div><strong>Mot de passe</strong><p>Choisissez un mot de passe d'au moins 8 caractères, que vous n'utilisez nulle part ailleurs.</p></div>${btn("Changer", "change-password")}</div>
      <div class="setting-row"><div><strong>Session</strong><p>Vous restez connecté 30 jours sur cet appareil.</p></div>${btn("Se déconnecter", "logout", "danger-text", "logout")}</div>
    </section>
    <section class="panel pad">
      ${sectionHead("Apparence")}
      <div class="setting-row"><div><strong>Thème</strong><p>${dark ? "Mode sombre activé." : "Mode clair activé."}</p></div>
        <div class="segmented"><button type="button" class="${dark ? "" : "active"}" data-action="${dark ? "toggle-theme" : "noop"}">${icon("sun")}Clair</button><button type="button" class="${dark ? "active" : ""}" data-action="${dark ? "noop" : "toggle-theme"}">${icon("moon")}Sombre</button></div>
      </div>
    </section>
    ${notifSettingsPanel()}
  </div>`;
}

function customFieldsView() {
  return `<div class="split">
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>Champs personnalisés</h2><p>Ils apparaissent dans « Classement » sur chaque fiche, et dans les exports.</p></div>${btn("Champ", "add-field", "primary-btn", "plus")}</div>
      ${customFields.length ? `<div class="rows rows-padded">${customFields.map(f => `<div class="row"><span class="row-text"><strong>${escapeHtml(f.name)}</strong><span>${escapeHtml(f.type || "Texte")}${f.type === "Liste" && f.values ? ` · ${escapeHtml(f.values)}` : ""} · renseigné sur ${plural(records.filter(r => (r.custom || {})[f.name]).length, "fiche")}</span></span><button type="button" class="icon-btn btn-sm danger-text" data-action="delete-field:${encodeURIComponent(f.name)}" title="Supprimer ce champ">${icon("trash")}</button></div>`).join("")}</div>`
        : `<div class="empty-state"><p>Aucun champ personnalisé. Ajoutez-en un pour suivre une information propre à Sinaï.</p></div>`}
    </section>
    <section class="panel pad">
      ${sectionHead("À quoi ça sert ?")}
      <p class="muted-note">Un champ personnalisé ajoute une case à toutes les fiches : l'établissement d'un parent, la classe d'un enfant, une date d'entrée… Choisissez le type « Liste » pour imposer des valeurs précises.</p>
    </section>
  </div>`;
}

function settingsView() {
  if (state.section === "Catégories d'interaction") return categoriesView();
  if (state.section === "Intégrations") return appsView();
  if (state.section === "Champs personnalisés") return customFieldsView();
  return accountView();
}

function admin() {
  if (state.section === "Journal d'activité") return auditView();
  if (!currentAccount || currentAccount.profile !== "Administrateur") {
    return emptyState("La gestion des comptes est réservée aux administrateurs.");
  }
  const scopeLabel = a => a.scopeMode === "tags"
    ? ((a.scopeTags || []).length ? (a.scopeTags || []).map(t => `<span class="tag" title="${escapeHtml(scopeTagLabel(t))}">${escapeHtml(t)}</span>`).join(" ") : `<span class="text-warn">Aucune catégorie choisie</span>`)
    : "Tous les contacts";
  const displayName = a => `${a.first || ""} ${a.last || ""}`.trim() || a.email;
  return `<div class="stack">
    <section class="panel">
      <div class="list-head"><div class="list-title"><h2>${plural(accounts.length, "compte")}</h2><p>Chaque personne se connecte avec son propre email et mot de passe. L'accès aux contacts peut être limité à certaines étiquettes.</p></div>${btn("Compte", "add-user", "primary-btn", "plus")}</div>
      ${accounts.length ? `<div class="table-wrap desktop-only"><table class="data-table"><thead><tr><th>Compte</th><th>Profil</th><th>Accès aux contacts</th><th>Dernière connexion</th><th></th></tr></thead><tbody>${accounts.map(a => `<tr>
          <td><div class="cell-person">${avatar({ name: displayName(a), kind: "Contact" }, "sm")}<div><strong>${escapeHtml(displayName(a))}${a.id === currentAccount.id ? ` <span class="muted">(vous)</span>` : ""}</strong><span>${escapeHtml(a.email)}</span></div></div></td>
          <td>${toneBadge(a.profile, a.profile === "Administrateur" ? "accent" : a.profile === "Lecture seule" ? "" : "blue")}</td>
          <td><div class="cell-tags">${scopeLabel(a)}</div></td>
          <td>${a.lastLogin ? escapeHtml(new Date(a.lastLogin).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })) : `<span class="muted">Jamais connecté</span>`}</td>
          <td class="num"><div class="row-actions"><button type="button" class="icon-btn btn-sm" data-action="edit-account:${a.id}" title="Modifier">${icon("edit")}</button>${a.id !== currentAccount.id ? `<button type="button" class="icon-btn btn-sm danger-text" data-action="delete-account:${a.id}" title="Supprimer">${icon("trash")}</button>` : ""}</div></td>
        </tr>`).join("")}</tbody></table></div>
      <div class="record-cards mobile-only">${accounts.map(a => `<div class="record-card">
          ${avatar({ name: displayName(a), kind: "Contact" })}
          <span class="record-card-body">
            <span class="record-card-head"><strong>${escapeHtml(displayName(a))}</strong>${toneBadge(a.profile, a.profile === "Administrateur" ? "accent" : "")}</span>
            <span class="record-card-sub">${escapeHtml(a.email)}</span>
            <span class="row-actions">${btn("Modifier", `edit-account:${a.id}`, "btn-sm")}${a.id !== currentAccount.id ? btn("Supprimer", `delete-account:${a.id}`, "btn-sm danger-text") : ""}</span>
          </span>
        </div>`).join("")}</div>` : emptyState("Aucun compte pour l'instant.", "Ajouter un compte", "add-user")}
    </section>
    <section class="panel pad">
      ${sectionHead("Sauvegarde")}
      <div class="setting-row"><div><strong>Télécharger toutes les données</strong><p>Un fichier JSON complet (contacts, paiements, interactions, tâches, réglages) à conserver en lieu sûr. Les mots de passe n'y figurent pas.</p></div>${btn("Télécharger la sauvegarde", "download-backup", "", "download")}</div>
    </section>
  </div>`;
}

function auditView() {
  const terms = normalizeSearchText(state.auditQuery).split(/\s+/).filter(Boolean);
  const rows = [...auditLog].sort((a, b) => (b.at || "").localeCompare(a.at || ""))
    .filter(a => !terms.length || terms.every(t => normalizeSearchText(`${a.text} ${a.user} ${a.date}`).includes(t)));
  let lastDay = "";
  return `<div class="narrow-page"><section class="panel list-panel">
    <div class="list-head"><div class="list-title"><h2>Journal d'activité</h2><p>Les ${AUDIT_LIMIT.toLocaleString("fr-FR")} dernières actions effectuées dans le CRM.</p></div>${btn("Exporter", "export-current", "", "download")}</div>
    <div class="list-tools"><label class="search-field">${icon("search")}<input class="search" id="auditSearch" value="${escapeHtml(state.auditQuery)}" placeholder="Rechercher une action, un nom, une personne de l'équipe…" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
    ${rows.length ? `<div class="audit-list">${rows.slice(0, 400).map(a => {
      const head = a.date !== lastDay ? `<h3 class="group-title">${escapeHtml(a.date || "")}</h3>` : "";
      lastDay = a.date;
      const time = a.at ? new Date(a.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
      return `${head}<div class="audit-row"><span class="audit-time">${escapeHtml(time)}</span><span class="audit-text">${escapeHtml(a.text)}</span><span class="audit-user">${escapeHtml(a.user || "")}</span></div>`;
    }).join("")}</div>` : `<div class="empty-state"><p>${auditLog.length ? "Aucune action ne correspond à cette recherche." : "Aucune activité enregistrée pour l'instant."}</p></div>`}
  </section></div>`;
}
