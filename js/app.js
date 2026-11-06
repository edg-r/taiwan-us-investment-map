/* Taiwanese investment map.
   State color uses the documented subtotal. Blank totals stay undisclosed.
   Arc width uses a square-root scale of the state-allocated amount. */
(function () {
  /* Log ramps: more plum means more documented funding. A hatch marks records
     without a state total; states with no records use the flat fill. */
  const LIGHT = ["#efdeed", "#d5b5d2", "#b680b0", "#92518b", "#6b2e66", "#40183e"];
  const DARK = ["#392437", "#60365b", "#885080", "#b579aa", "#dca8d2", "#f4d5ee"];
  const BASIS = {
    announced_project_total: "Announced commitment",
    completed_project_total: "Completed project",
    acquisition_price: "Acquisition", equity_investment: "Equity investment", loan_financing: "Loan financing",
  };
  const STATUS = {
    announced: "Announced", cancelled: "Cancelled", delayed: "Delayed", paused: "Paused", downsized: "Downsized", sold: "Sold",
    operating: "Operating",
    completed: "Completed",
    unknown: "Status unresolved",
    under_construction: "Under construction",
    "closed subsequently": "Later closed",
    "status uncertain; models canceled": "Plans later canceled",
  };
  const ROUTE = {
    "target headquarters; deal not state-allocated":
      "Headquarters marker. This deal is not allocated to the state.",
    "company reference; spending not state-allocated":
      "Company reference. Spending is not allocated to the state.",
    "existing presence; no investment amount established":
      "Operating presence. No investment amount is established.",
    "cooperation agreement; no investment amount established":
      "Cooperation agreement. No investment amount is established.",
  };

  // Taiwan main island and Penghu frame the inset. Lanes start just off each coast.
  const TAIWAN_FIT = { north: 25.4, south: 21.8, westLane: 119.2, eastLane: 122.2 };
  // Logo URLs share the cache-busting token of this script's own URL.
  const ASSET_VERSION = new URL(document.currentScript.src).searchParams.get("v") || "dev";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const rawData = window.MAP_DATA;
  const initialParams = new URLSearchParams(location.hash.slice(1));
  let investorType = ["firm", "government"].includes(initialParams.get("type")) ? initialParams.get("type") : "all";
  function filteredData() {
    const projects = rawData.projects.filter(p => investorType === "all" || p.investorType === investorType);
    return { ...rawData, projects, nationalRecords: projects.filter(p => p.national),
      total: rawData.totals[investorType === "all" ? "overall" : investorType],
      states: rawData.states.map(s => investorType === "all" ? {...s} : {...s, ...s.byType[investorType]}) };
  }
  let data = filteredData();
  const svg = d3.select("#map");
  const stage = document.getElementById("stage");
  const panel = document.getElementById("panel");
  const tip = document.getElementById("tip");
  const legend = document.getElementById("legend");

  let stateByCode = new Map(data.states.map((s) => [s.code, s]));
  let stateByName = new Map(data.states.map((s) => [s.name, s]));
  // Decode static geography once, rather than during each camera transition.
  const stateFeatures = topojson.feature(window.US_ATLAS, window.US_ATLAS.objects.states).features
    .filter((feature) => stateByName.has(feature.properties.name));
  for (const feature of stateFeatures) {
    const record = stateByName.get(feature.properties.name);
    feature.properties.code = record.code;
    feature.properties.total = record.total;
  }
  const meshCache = new Map();
  let projectById = new Map(data.projects.map((p) => [p.id, p]));
  let projectsByState = d3.group(data.projects, (p) => p.state);
  for (const list of projectsByState.values()) {
    list.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.firm.localeCompare(b.firm));
  }

  // Use the same grouping as the map focus, including joint ventures once.
  function computeCompanies() {
    return [...d3.group(data.projects, (p) => p.firmGroup || p.firm)]
    .map(([name, records]) => {
      const allocated = records.filter((p) => p.allocated && p.amount != null);
      return { name, slug: logoSlug(name), records,
        total: allocated.length ? d3.sum(allocated, (p) => p.amount) : null,
        states: new Set(records.filter(p => !p.national).map((p) => p.state)),
        search: [name, ...records.flatMap((p) => [p.firm, p.parent])].join(" ").toLocaleLowerCase() };
    });
  }
  let companies = computeCompanies();
  let companyByName = new Map(companies.map((c) => [c.name, c]));
  let companyBySlug = new Map(companies.map((c) => [c.slug, c]));
  let maxCompanyTotal = d3.max(companies, (c) => c.total) || 1;

  let totals = data.states.map((s) => s.total).filter((v) => v != null);
  let MIN = d3.min(totals) || 1;
  let MAX = d3.max(totals) || MIN;
  const maxFlow = d3.max(data.projects, (p) => p.amount) || MAX;
  // Many arcs share the Pacific corridor; thin the idle layer as the count grows
  // so the heat map stays readable (Japan's 60 arcs used 0.27).
  const idleFlowCount = rawData.projects.filter((p) => !p.national && p.state !== "US").length;
  const idleFlowOpacity = Math.max(0.08, Math.min(0.27, 2 / Math.sqrt(idleFlowCount)));
  const widthScale = d3.scaleSqrt().domain([0, maxFlow]).range([0.65, 4]);
  const touchInput = window.matchMedia("(hover: none), (pointer: coarse)");

  const qMode = new URLSearchParams(location.search).get("mode");
  let mode = qMode === "heat" || qMode === "flows" || qMode === "both" ? qMode : "both";
  let hoverCompany = null;
  let hoveredPanelRow = null;
  let focusedPanelRow = null;
  let hoverCode = null;
  let hoverFlow = null;
  let selectedCode = null;
  let selectedFlow = null;
  let selectedCompany = null;
  let lastFocus = "NC";
  let introStarted = false;
  let introRunning = false;
  let renderedFrame = "";
  let timers = [];
  let introFrame = null;
  const motionButton = document.getElementById("flow-motion");
  const MOTION_LIMIT = 64;
  let motionPaused = false;
  try { motionPaused = localStorage.getItem("ki-flow-motion-paused") === "true"; } catch (e) {}
  let flowEls = [];
  let hits = new Map();
  let centroids = new Map();
  let originNodes = [];
  let labelNodes = [];
  const labelMetrics = new Map();
  let resizeQueued = false;
  let fontsReady = false;
  let booted = false;
  let panelView = "details";
  let companySort = "amount";
  let companyAscending = false;
  let companySearch = "";
  let lastCompany = null;
  let panelOpener = null;
  const companiesButton = document.getElementById("companies-open");
  const companyChip = document.getElementById("company-focus");
  const selectionStatus = document.getElementById("selection-status");
  let rankingSort = "amount";
  let rankingAscending = false;
  let sheetHeight = null;
  let sheetFraction = 0.4;
  let sheetDrag = null;
  const rankingButton = document.getElementById("ranking-open");

  function shareText(share) {
    const named = [[1 / 2, "about half"], [1 / 3, "about a third"], [1 / 4, "about a quarter"],
      [2 / 3, "about two thirds"], [3 / 4, "about three quarters"]];
    const near = named.find(([v]) => Math.abs(share - v) < 0.03);
    return near ? near[1] : "about " + Math.round(share * 100) + "%";
  }
  // A data-driven lede, as on the Japan map. It always describes the active investor type.
  function headlineText() {
    const ranked = data.states.filter((s) => s.total != null).sort((a, b) => b.total - a.total);
    const who = investorType === "all" ? "" : investorType === "firm" ? "firm " : "government ";
    if (!ranked.length) return "No state has a documented " + who + "total yet.";
    if (ranked.length === 1) return "Only " + ranked[0].name + " has a documented " + who + "total.";
    const largest = data.projects.filter((p) => !p.national && p.amount != null)
      .sort((a, b) => b.amount - a.amount)[0];
    const share = largest.amount / data.total;
    if (share >= 0.25) {
      return (largest.firmGroup || largest.firm) + "’s " + formatLong(largest.amount) + " program in " + stateByCode.get(largest.state).name +
        " is " + shareText(share) + " of the documented " + who + "state subtotal.";
    }
    return ranked[0].name + " leads " + ranked.length + " states with " + formatLong(ranked[0].total) +
      ", " + shareText(ranked[0].total / data.total) + " of the documented " + who + "state subtotal.";
  }
  function updateSummary() {
    document.getElementById("stat-value").textContent = formatLong(data.total);
    document.getElementById("stat-label").textContent = investorType === "all" ? "documented state subtotal" :
      investorType === "firm" ? "firms, state subtotal" : "government, state subtotal";
    document.getElementById("methods-total").textContent = "The " + formatLong(rawData.totals.overall);
    document.getElementById("headline").innerHTML = esc(headlineText());
    document.querySelectorAll("[data-type]").forEach(b => {
      const active = b.dataset.type === investorType;
      b.setAttribute("aria-checked", String(active)); b.tabIndex = active ? 0 : -1;
    });
    document.getElementById("download-coverage").textContent = rawData.projects.length + " sourced records, including " + rawData.nationalRecords.length + " national records, and 51 states including DC. Research cutoff: 5 November 2026. Amounts are in U.S. dollars, millions. Blank amounts are missing, not zero. Downloads include all investor types.";
    document.getElementById("national-about").innerHTML = nationalAbout();
  }
  function writeHash(selection = {}) {
    const params = new URLSearchParams();
    if (investorType !== "all") params.set("type", investorType);
    for (const [k,v] of Object.entries(selection)) if (v) params.set(k,v);
    history.replaceState(null, "", location.pathname + location.search + (params.size ? "#" + params.toString() : ""));
  }
  function typeChip(p) {
    return '<li class="chip type-chip type-' + p.investorType + '">' +
      (p.investorType === "government" ? "Government" : "Firm") + "</li>";
  }
  function chipList(p) {
    return '<ul class="chips">' + typeChip(p) + chipsFor(p).map((c) =>
      '<li class="chip' + (c.strong ? " strong" : "") + '">' + esc(c.text) + "</li>").join("") + "</ul>";
  }
  function sourceLink(p) {
    return '<a class="source" href="' + esc(p.sourceUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(p.sourceTitle) + "</a>";
  }
  function nationalFigure(p) {
    return '<p class="national-figure"><strong>' + esc((p.amount ?? p.transactionValue) == null ? "Amount not stated" : formatLong(p.amount ?? p.transactionValue)) +
      "</strong>, not counted in state totals</p>";
  }
  const byAmount = (a, b) => (b.amount ?? -1) - (a.amount ?? -1) || (a.firmGroup || a.firm).localeCompare(b.firmGroup || b.firm);
  const byFigure = (a, b) => ((b.amount ?? b.transactionValue) ?? -1) - ((a.amount ?? a.transactionValue) ?? -1) || (a.firmGroup || a.firm).localeCompare(b.firmGroup || b.firm);
  // National records sit beside the ranking. They never enter a state total,
  // the choropleth or the flows, and they are never summed.
  function nationalSection() {
    const rows = data.nationalRecords.slice().sort(byFigure);
    const scope = investorType === "all" ? "" : investorType === "firm" ? " from firms" : " from government investors";
    return '<section class="national-section" aria-labelledby="national-title"><h3 id="national-title">National, not allocated to states</h3>' +
      '<p class="quiet">' + (rows.length ? rows.length + (rows.length === 1 ? " record" : " records") + scope +
        " for the United States as a whole. The January 2026 MOU covers $250.00 billion of corporate investment plus up to $250.00 billion in credit guarantees, non-additive with each other and state records. The February reciprocal trade agreement adds no new tranche here. TSMC’s $265.00 billion overlaps Arizona; GlobalWafers’ $7.50 billion overlaps Sherman. These national amounts are never added to state totals."
        : "No national records" + scope + ".") + "</p>" +
      rows.map((p) => {
        const company = p.firmGroup || p.firm;
        return '<article class="record national-record">' +
          '<div class="record-top"><button type="button" class="company-btn" data-company="' + esc(company) + '" aria-label="Show ' + esc(company) + '">' +
          logoMark(company) + '<span class="name">' + esc(company) + "</span></button></div>" +
          nationalFigure(p) + '<p class="project">' + esc(p.project) + "</p>" +
          (p.firm && p.firm !== company ? '<p class="parent">' + esc(p.firm) + "</p>" : "") +
          chipList(p) + sourceLink(p) + "</article>";
      }).join("") + "</section>";
  }
  // The About dialog lists every national record, whatever the active filter.
  function nationalAbout() {
    const rows = rawData.nationalRecords.slice().sort(byFigure);
    if (!rows.length) return "";
    return '<ul class="national-list">' + rows.map((p) => '<li><button type="button" class="link-btn" data-company="' +
      esc(p.firmGroup || p.firm) + '">' + esc(p.firmGroup || p.firm) + "</button>" +
      '<span class="type-chip type-' + p.investorType + '">' + (p.investorType === "government" ? "Government" : "Firm") + "</span>" +
      '<span class="national-list-amt">' + esc((p.amount ?? p.transactionValue) == null ? "Not stated" : formatLong(p.amount ?? p.transactionValue)) + "</span></li>").join("") + "</ul>";
  }
  function recordContext(p) {
    return '<p class="parent">Headquarters: ' + esc(p.originLabel) + "</p>" +
      (p.investorCommitment != null ? '<p class="parent">Taiwanese investor share: ' + esc(formatLong(p.investorCommitment)) +
        ". Included in the project total, not added to it.</p>" : "") +
      (p.evidence ? '<p class="evidence">' + esc(p.evidence) + "</p>" : "") +
      (p.allocationNote || p.investorCommitmentNote ? '<details class="research-notes"><summary>Research notes</summary>' +
        (p.allocationNote ? "<p>" + esc(p.allocationNote) + "</p>" : "") +
        (p.investorCommitmentNote ? "<p>" + esc(p.investorCommitmentNote) + "</p>" : "") + "</details>" : "");
  }
  function changeType(next, sync = true) {
    if (!["all","firm","government"].includes(next)) next = "all";
    investorType = next; data = filteredData();
    stateByCode = new Map(data.states.map(s => [s.code,s]));
    stateByName = new Map(data.states.map(s => [s.name,s]));
    projectById = new Map(data.projects.map(p => [p.id,p]));
    projectsByState = d3.group(data.projects.filter(p => !p.national), p => p.state);
    for (const list of projectsByState.values()) list.sort((a,b) => (b.amount ?? -1) - (a.amount ?? -1));
    companies = computeCompanies(); companyByName = new Map(companies.map(c => [c.name,c])); companyBySlug = new Map(companies.map(c => [c.slug,c]));
    maxCompanyTotal = d3.max(companies,c=>c.total) || 1;
    totals = data.states.map(s=>s.total).filter(v=>v!=null); MIN=d3.min(totals)||1; MAX=d3.max(totals)||MIN;
    for (const f of stateFeatures) f.properties.total = stateByCode.get(f.properties.code).total;
    if (selectedCompany && !companyByName.has(selectedCompany)) { selectedCompany = null; panelView = "companies"; }
    if (selectedFlow && !projectById.has(selectedFlow)) selectedFlow=null;
    hoverCode=hoverFlow=null; hideTip(); updateSummary(); renderLegend();
    if (!panel.hidden) {
      if (selectedCompany) renderCompanyPanel(false);
      else if (selectedCode) renderPanel(false);
      else if (panelView === "ranking") renderRanking(false);
      else renderCompanies(false);
    }
    draw(); applyFocus();
    if (sync) writeHash(selectedCompany ? {company: companyByName.get(selectedCompany).slug} : selectedCode ? {state:selectedCode} : {});
    selectionStatus.textContent = "Showing " + (next === "all" ? "all investors" : next === "firm" ? "firms" : "government investors") + ", " + formatLong(data.total) + " in state totals.";
  }
  updateSummary();

  function theme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function reduced() {
    return reducedMotion.matches;
  }
  function norm(value) {
    return MAX === MIN ? 1 : Math.log(Math.max(value, MIN) / MIN) / Math.log(MAX / MIN);
  }
  function colorFor(total) {
    if (total == null) return "url(#unquantified)";
    const t = Math.max(0, Math.min(1, norm(total)));
    return d3.interpolateRgbBasis(theme() === "light" ? LIGHT : DARK)(t);
  }
  // Hatching means "has records, but no state total". No records at all is flat.
  function stateFill(s) {
    if (s.total == null) return s.records ? "url(#unquantified)" : "var(--flat)";
    return mode === "flows" ? "var(--flat)" : colorFor(s.total);
  }
  function formatAmount(m, long = false, tick = false) { return window.formatInvestment(m, long, tick); }
  function formatShort(m) { return formatAmount(m); }
  function formatLabel(m) { return formatAmount(m); }
  function formatTick(m) {
    return formatAmount(m, false, true);
  }
  function formatLong(m) {
    return formatAmount(m, true);
  }
  function esc(s) {
    return String(s ?? "").replace(/\u2014/g, ", ").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }
  function recordCount(s) {
    const n = s.records + (s.records === 1 ? " record" : " records");
    if (s.total == null) return n + (s.records === 1 ? ", amount not disclosed" : ", no disclosed amounts");
    return s.unpriced ? n + ", " + s.unpriced + " without an amount" : n;
  }
  function stateQualifier(code) {
    const priced = (projectsByState.get(code) || []).filter((p) => p.amount != null);
    const kinds = new Set(priced.map((p) => p.qualifier));
    if (priced.length && kinds.size === 1) {
      const q = [...kinds][0];
      if (q === "at least") return "At least";
      if (q === "about") return "About";
    }
    return "";
  }
  function chipsFor(p) {
    const chips = [];
    const basis = BASIS[p.basis];
    if (basis) chips.push({ strong: true, text: basis });
    const status = STATUS[p.status];
    const repeat =
      (p.status === "announced" && p.basis === "announced_project_total") ||
      (p.status === "completed" && p.basis === "completed_project_total");
    if (status && !repeat) chips.push({ text: status });
    if (p.qualifier === "at least") chips.push({ text: "At least" });
    if (p.qualifier === "about") chips.push({ text: "About" });
    if (p.recordKind === "existing presence") chips.push({ text: "Presence only" });
    if (p.recordKind === "cooperation agreement") chips.push({ text: "Cooperation" });
    if (p.recordKind === "ownership transfer between Taiwanese-affiliated parties") {
      chips.push({ text: "Ownership transfer" });
    }
    if (p.year) chips.push({ text: p.year });
    return chips;
  }
  function routeLine(p) {
    const state = stateByCode.get(p.state);
    const special = ROUTE[p.route];
    if (special) return special;
    if (p.destKind === "state") {
      return (p.originLabel || "Taiwan") + " → " + state.name + ". No city in the source, so the arc ends at the state center.";
    }
    const place = p.city ? p.city : state.name;
    return (p.originLabel || "Taiwan") + " → " + place;
  }

  function clearTimers() {
    if (introFrame != null) cancelAnimationFrame(introFrame);
    introFrame = null;
    timers.forEach(clearTimeout);
    timers = [];
  }

  function layout(w, h) {
    const mobile = w <= 860;
    const legendH = legend.getBoundingClientRect().height + 24;
    if (mobile) {
      const available = panel.hidden ? h : Math.max(180, window.innerHeight -
        (sheetHeight || window.innerHeight * 0.4) - stage.getBoundingClientRect().top - 12);
      const top = Math.round(Math.max(176, Math.min(236, available * 0.36)));
      return {
        mobile,
        // Leave room for the Showing chip above the inset title.
        taiwan: [12, selectedCompany ? 52 : 4, w - 12, top - 6],
        lower: [8, top, w - 8, Math.max(top + 100, available - (panel.hidden ? legendH : 12))],
      };
    }
    const pacific = !!selectedCompany;
    const available = w - (panel.hidden ? 0 : panel.getBoundingClientRect().width);
    const left = panel.hidden ? Math.min(pacific ? 310 : 280, w * 0.22) : 300;
    return {
      mobile,
      pacific,
      // The right edge extends to the U.S. coast once the U.S. projection is known.
      taiwan: [12, 14, left + 20, h - legendH - 110],
      lower: [left + 20, Math.max(84, h * 0.12), available - 20, h - 24],
    };
  }

  function fit(proj, box, feature, inset) {
    const pad = inset || 0;
    if (box[2] - box[0] < 4 || box[3] - box[1] < 4) return proj;
    proj.fitExtent(
      [
        [box[0] + pad, box[1] + pad],
        [box[2] - pad, box[3] - pad],
      ],
      feature
    );
    return proj;
  }

  function activeCode() {
    return hoverCode || selectedCode;
  }

  function renderLegend() {
    const previousGradient = legend.querySelector(".bar")?.style.background;
    const range = theme() === "light" ? LIGHT : DARK;
    const stops = [0, 0.25, 0.5, 0.75, 1]
      .map((t) => d3.interpolateRgbBasis(range)(t) + " " + t * 100 + "%")
      .join(", ");
    const at = (t) => MIN * Math.pow(MAX / MIN, t);
    legend.innerHTML =
      '<div class="heat-key">' +
      '<p class="legend-title">' + (investorType === 'all' ? 'State amount' : investorType === 'firm' ? 'Firms, state amount' : 'Government, state amount') + ', log scale</p>' +
      '<div class="bar" style="background:linear-gradient(90deg,' + stops + ')"></div>' +
      '<div class="ticks"><span>' + formatTick(at(0)) + "</span><span>" + formatTick(at(0.5)) + "</span><span>" + formatTick(at(1)) + "</span></div>" +
      '<div class="key-pair"><div class="key-row"><span class="swatch"></span><span>Records, no state total</span></div>' +
      (data.states.some((s) => !s.records) ? '<div class="key-row"><span class="swatch is-flat"></span><span>No records</span></div>' : "") +
      "</div>" +
      "</div>" +
      '<div class="flow-key">' +
      '<div class="key-row"><span class="strokes" aria-hidden="true"><i style="height:0.65px"></i><i style="height:2px"></i><i style="height:4px"></i></span><span>Width follows amount</span></div>' +
      '<div class="key-row"><span class="dash-sample" aria-hidden="true"></span><span>No amount</span></div>' +
      '<p class="motion-note">Moving dots show direction of investment, not traced transfers.</p>' +
      "</div>";
    const bar = legend.querySelector(".bar");
    if (previousGradient && previousGradient !== bar.style.background && !reduced()) {
      const fading = document.createElement("span");
      fading.style.cssText = "position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:" + previousGradient;
      bar.appendChild(fading);
      fading.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease" })
        .onfinish = () => fading.remove();
    }
    legend.classList.toggle("is-heat-off", mode === "flows");
    legend.classList.toggle("is-flow-off", mode === "heat");
  }

  function companyStates() {
    if (!selectedCompany) return null;
    return companyByName.get(selectedCompany).states;
  }

  function applyFocus() {
    companyChip.hidden = !selectedCompany;
    document.getElementById("company-focus-label").textContent = selectedCompany ? "Showing: " + selectedCompany : "";
    const company = hoverCompany || selectedCompany;
    // A temporary state preview takes precedence over a selected company.
    const states = hoverCompany ? companyByName.get(hoverCompany).states : hoverCode ? null : companyStates();
    const code = states ? null : activeCode();
    const flowId = states ? null : (hoverFlow || selectedFlow);
    svg.selectAll(".state").each(function (d) {
      const id = d.properties.code;
      const on = states ? states.has(id) : !code || id === code;
      this.style.opacity = on ? "1" : "0.22";
    });
    svg.selectAll(".active-ring").attr("display", code ? null : "none");
    if (code) {
      const visual = svg.select('.state[data-state="' + code + '"]');
      if (!visual.empty()) {
        svg.selectAll(".active-ring").attr("d", visual.attr("d"));
        visual.node().parentNode.appendChild(visual.node());
      }
    }
    const hotOrigins = new Set();
    for (const f of flowEls) {
      const mine = states ? f.firmGroup === company : !code || f.state === code;
      const hot = flowId ? f.id === flowId : mine && (!!code || !!states);
      if (hot) hotOrigins.add(f.originKey);
      let op = idleFlowOpacity;
      let w = f.amount == null ? 0.8 : widthScale(f.amount);
      if ((code || states) && !mine) op = 0.04;
      if (hot) {
        op = 1;
        w += 1;
      }
      if (f.quiet && !f.revealed) op = 0;
      // Red is reserved for the one arc under the pointer or selected; a state or
      // company highlight stays in the plum family.
      const color = hot ? (flowId ? "var(--accent)" : "var(--flow-hot)") : f.quiet ? "var(--flow-quiet)" : "var(--flow)";
      f.path.style.stroke = color;
      if (f.mark) f.mark.style.fill = f.quiet && !hot ? "var(--flow-quiet)" : color;
      if (f.motion) f.motion.style.stroke = color;
      f.path.style.strokeOpacity = String(op);
      f.path.style.strokeWidth = w + "px";
      if (f.mark) f.mark.style.opacity = f.revealed ? String(op) : "0";
      if (f.motion) {
        f.motion.style.opacity = String(hot ? 0.85 : (code || states) && !mine ? 0.025 : idleFlowOpacity + 0.08);
        f.animation.updatePlaybackRate(hot ? 1.2 : 1);
      }
      if (hot) f.group.raise();
    }
    for (const o of originNodes) {
      const hot = o.keys.some((key) => hotOrigins.has(key));
      const idle = !code && !states;
      o.node.style.opacity = idle || hot ? "1" : "0.25";
      o.node.setAttribute("r", String(hot && (code || states) ? o.r + 1.5 : o.r));
    }
    const showFlows = mode !== "heat";
    svg.select(".flows").attr("visibility", showFlows ? "visible" : "hidden");
    svg.select(".flows").style("pointer-events", showFlows ? "auto" : "none");
    svg.selectAll(".state").each(function (d) {
      this.style.fill = stateFill(stateByCode.get(d.properties.code));
    });
    svg.selectAll(".state-dot").each(function () {
      const s = stateByCode.get(this.getAttribute("data-state"));
      this.setAttribute("fill", stateFill(s));
    });
    for (const hit of hits.values()) {
      hit.setAttribute("aria-expanded", hit.getAttribute("data-state") === selectedCode ? "true" : "false");
    }
    legend.classList.toggle("is-heat-off", mode === "flows");
    legend.classList.toggle("is-flow-off", mode === "heat");
    syncFlowMotion();
  }

  // One native dash animation per priced arc, capped independently of ledger size.
  // Negative offsets carry the mark forward along the Japan-to-state path.
  function syncFlowMotion() {
    const available = !reduced() && mode !== "heat" && !introRunning && introStarted;
    const running = available && !motionPaused && !document.hidden;
    for (const f of flowEls) {
      if (!f.animation) continue;
      f.motion.style.visibility = available ? "visible" : "hidden";
      if (running && f.animation.playState !== "running") f.animation.play();
      else if (!running && f.animation.playState !== "paused") f.animation.pause();
    }
    const label = motionPaused ? "Play motion" : "Pause motion";
    motionButton.setAttribute("aria-label", label);
    motionButton.setAttribute("aria-pressed", String(motionPaused));
    motionButton.title = label;
    motionButton.querySelector(".control-tip").textContent = label;
    motionButton.disabled = reduced();
    if (reduced()) {
      motionButton.setAttribute("aria-label", "Motion off: reduced motion preference");
      motionButton.title = "Motion off: reduced motion preference";
      motionButton.querySelector(".control-tip").textContent = motionButton.title;
    }
  }

  function armAnimation() {
    clearTimers();
    introRunning = !reduced();
    for (const f of flowEls) {
      if (f.animation) f.animation.currentTime = f.motionPhase;
    }
    syncFlowMotion();
    const items = flowEls.slice().sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const stateLayers = svg.selectAll(".fills,.border,.coast,.taiwan,.origins,.place,.inset-label,.state-dot").interrupt("intro");
    const labels = svg.select(".labels").interrupt("intro");
    if (reduced()) {
      stateLayers.style("opacity", null);
      labels.style("opacity", null);
      for (const f of items) {
        f.revealed = true;
        f.path.style.transition = "none";
        f.path.style.strokeDasharray = f.quiet ? "2.2 3.4" : "none";
        f.path.style.strokeDashoffset = "0";
      }
      applyFocus();
      return;
    }
    stateLayers.style("opacity", 0).transition("intro").duration(360).style("opacity", null);
    labels.style("opacity", 0).transition("intro").delay(380)
      .duration(240).style("opacity", 1);
    items.forEach((f) => {
      f.revealed = false;
      const len = f.path.getTotalLength();
      f.path.style.transition = "none";
      if (f.quiet) {
        f.path.style.strokeDasharray = "2.2 3.4";
        f.path.style.strokeDashoffset = "0";
      } else {
        f.path.style.strokeDasharray = String(len);
        f.path.style.strokeDashoffset = String(len);
      }
    });
    applyFocus();
    introFrame = requestAnimationFrame(() => {
      introFrame = null;
      items.forEach((f, i) => {
        const delay = 360 + i / Math.max(1, items.length - 1) * 650;
        if (!f.quiet) {
          f.path.style.transition = "stroke-dashoffset 820ms cubic-bezier(.22,.61,.36,1) " + delay +
            "ms, stroke-opacity 150ms ease, stroke-width 150ms ease, stroke 260ms ease";
          f.path.style.strokeDashoffset = "0";
        }
        timers.push(setTimeout(() => {
          f.revealed = true;
          if (!f.quiet) {
            f.path.style.transition = "";
            f.path.style.strokeDasharray = "none";
            f.path.style.strokeDashoffset = "0";
          }
          applyFocus();
        }, delay + 820));
      });
      timers.push(setTimeout(() => { introRunning = false; syncFlowMotion(); }, 2100));
    });
  }

  function neighbor(code, dir) {
    const cur = centroids.get(code);
    if (!cur) return null;
    const v = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] }[dir];
    let best = null;
    let bestScore = Infinity;
    for (const [c, p] of centroids) {
      if (c === code) continue;
      const dx = p[0] - cur[0];
      const dy = p[1] - cur[1];
      const along = dx * v[0] + dy * v[1];
      if (along < 10) continue;
      const cross = Math.abs(dx * v[1] - dy * v[0]);
      const score = cross * 1.35 + along;
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  function focusState(code) {
    const hit = hits.get(code);
    if (!hit) return;
    lastFocus = code;
    for (const [c, node] of hits) node.setAttribute("tabindex", c === code ? "0" : "-1");
    hit.focus({ preventScroll: true });
    hoverFlow = null;
    hoverCode = code;
    applyFocus();
    showStateTip(code);
    const box = hit.getBoundingClientRect();
    moveTip({ clientX: box.left + box.width / 2, clientY: box.top + Math.min(24, box.height / 2) });
  }

  function showStateTip(code) {
    if (touchInput.matches) return;
    const s = stateByCode.get(code);
    const q = stateQualifier(code);
    tip.hidden = false;
    tip.innerHTML =
      '<p class="tip-name">' + esc(s.name) + "</p>" +
      '<p class="tip-total">' + esc(s.records ? (q ? q + " " : "") + formatLong(s.total) : "No documented records") + "</p>" +
      (s.records ? '<p class="tip-meta">' + esc(recordCount(s)) + "</p>" : "") +
      (investorType !== "all" ? '<p class="tip-meta">' + (investorType === "firm" ? "Firms only" : "Government investors only") + "</p>" : "");
  }
  function showFlowTip(id) {
    if (touchInput.matches) return;
    const p = projectById.get(id);
    const s = stateByCode.get(p.state);
    const where = p.city || (p.destKind === "state" ? "State reference" : s.name);
    tip.hidden = false;
    tip.innerHTML =
      '<p class="tip-name">' + esc(p.firm) + "</p>" +
      '<p class="tip-total">' + esc(p.amount == null ? "Undisclosed" : (p.qualifier === "about" ? "About " : p.qualifier === "at least" ? "At least " : "") + formatLong(p.amount)) + "</p>" +
      '<p class="tip-meta">' + esc(p.project) + "</p>" +
      '<p class="tip-meta">' + esc(where) + ", " + esc(s.name) + "</p>";
  }
  function moveTip(event) {
    if (tip.hidden) return;
    const rect = tip.getBoundingClientRect();
    let x = event.clientX + 16;
    let y = event.clientY + 18;
    if (x + rect.width > window.innerWidth - 8) x = event.clientX - rect.width - 14;
    if (y + rect.height > window.innerHeight - 8) y = event.clientY - rect.height - 12;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }
  function hideTip() {
    tip.hidden = true;
  }

  function sheetHandle() {
    return '<button type="button" class="grabber" aria-label="Expand details; drag or use arrow keys to resize" aria-expanded="false"></button>';
  }

  function frameBesidePanel() {
    if (renderedFrame !== frameKey()) draw(!sheetDrag);
  }

  function frameKey() {
    return [stage.clientWidth, stage.clientHeight, panel.hidden,
      stage.clientWidth <= 860 ? Math.round(sheetHeight || 0) : panel.offsetWidth,
      selectedCompany || ""].join(":");
  }

  // Read the shared panel timing so subsequent CSS changes keep the camera in sync.
  function panelMotion() {
    const style = getComputedStyle(panel);
    const index = Math.max(0, style.transitionProperty.split(",").map((s) => s.trim()).indexOf("transform"));
    const durations = style.transitionDuration.split(",");
    const duration = durations[index % durations.length].trim();
    const easings = style.transitionTimingFunction.match(/cubic-bezier\([^)]+\)|[a-z-]+/g) || ["ease"];
    const easing = easings[index % easings.length];
    const presets = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1],
      "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1] };
    const controls = presets[easing] || (easing.match(/[\d.]+/g) || []).map(Number);
    return { duration: parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000),
      ease: (t) => panelEase(t, ...(controls.length === 4 ? controls : presets.ease)) };
  }

  // Interpolate screen coordinates, never type size, with the panel's cubic Bezier.
  function panelEase(t, x1, y1, x2, y2) {
    const bezier = (s, a, b) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
    let low = 0, high = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (low + high) / 2;
      if (bezier(mid, x1, x2) < t) low = mid;
      else high = mid;
    }
    return bezier((low + high) / 2, y1, y2);
  }

  function mapGeometry() {
    const counts = new Map();
    return [...svg.node().querySelectorAll("path,rect,circle,line,text")]
      .filter((node) => !node.closest("defs"))
      .map((node) => {
        const base = [node.tagName, node.getAttribute("class"), node.getAttribute("data-state"),
          node.parentNode.getAttribute("data-flow"), node.tagName === "text" ? node.textContent : ""].join(":");
        const n = counts.get(base) || 0;
        counts.set(base, n + 1);
        const attrs = {};
        for (const attr of ["d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "width", "height", "opacity"]) {
          if (node.hasAttribute(attr)) attrs[attr] = node.getAttribute(attr);
        }
        return [base + ":" + n, { node, attrs }];
      });
  }

  function setSheetHeight(height) {
    sheetHeight = Math.max(window.innerHeight * 0.2, Math.min(window.innerHeight * 0.94, height));
    sheetFraction = sheetHeight / window.innerHeight;
    panel.style.setProperty("--sheet-height", sheetHeight + "px");
    const expanded = sheetHeight > window.innerHeight * 0.65;
    document.body.classList.toggle("company-sheet-expanded", expanded);
    const handle = panel.querySelector(".grabber");
    if (handle) {
      handle.setAttribute("aria-expanded", String(expanded));
      handle.setAttribute("aria-label", expanded ? "Collapse details; drag or use arrow keys to resize" : "Expand details; drag or use arrow keys to resize");
    }
    frameBesidePanel();
  }

  function resetPanelPreview() {
    hoverCompany = null;
    hoveredPanelRow = focusedPanelRow = null;
    hoverCode = hoverFlow = null;
  }

  function showPanel(view) {
    resetPanelPreview();
    const wasHidden = panel.hidden;
    const changedView = panelView !== view;
    panelView = view;
    rankingButton.setAttribute("aria-expanded", String(view === "ranking"));
    companiesButton.setAttribute("aria-expanded", String(view === "companies" || view === "company"));
    document.body.classList.add("has-panel");
    panel.hidden = false;
    if (wasHidden || changedView) sheetHeight = null;
    setSheetHeight(sheetHeight || window.innerHeight * 0.4);
    // Commit the offscreen position before starting the opaque slide.
    if (wasHidden) panel.getBoundingClientRect();
    requestAnimationFrame(() => { if (!panel.hidden) panel.classList.add("is-in"); });
  }

  function renderRanking(focusTitle = true) {
    // Quantified states first, then states with records but no total. States
    // without any record for the active investor type are listed once, below.
    const rows = data.states.filter((s) => s.records > 0).sort((a, b) => {
      if (rankingSort === "amount" && (a.total == null) !== (b.total == null)) return a.total == null ? 1 : -1;
      const diff = rankingSort === "state" ? a.name.localeCompare(b.name) :
        rankingSort === "records" ? a.records - b.records : (a.total ?? 0) - (b.total ?? 0);
      return (rankingAscending ? diff : -diff) || a.name.localeCompare(b.name);
    });
    const empty = data.states.filter((s) => !s.records).map((s) => s.name).sort();
    const quantified = rows.filter((s) => s.total != null).length;
    const scope = investorType === "all" ? "" : investorType === "firm" ? " for firms" : " for government investors";
    const column = (key, label) => '<th scope="col" aria-sort="' +
      (rankingSort === key ? (rankingAscending ? "ascending" : "descending") : "none") +
      '"><button type="button" data-sort="' + key + '">' + label +
      (rankingSort === key ? (rankingAscending ? " ↑" : " ↓") : "") + '</button></th>';
    panel.innerHTML = sheetHandle() + '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close ranking">×</button>' +
      '<h2 id="panel-title" tabindex="-1">State ranking</h2>' +
      '<p class="quiet">' + quantified + (quantified === 1 ? " state has" : " states have") + " a documented total" + scope +
      (rows.length > quantified ? "; " + (rows.length - quantified) + " more " + (rows.length - quantified === 1 ? "has" : "have") + " records without one" : "") +
      ". Select a state to see its records.</p></div>" +
      '<div class="panel-scroll"><table class="ranking-table"><caption class="sr">States ranked by documented amount' + scope +
      '. States with records but no total follow quantified states.</caption><thead><tr>' +
      column("state", "State") + column("amount", "Amount") + column("records", "Records") +
      '</tr></thead><tbody>' + rows.map((s) => '<tr data-ranking-state="' + s.code + '"><td><button type="button" data-select-state="' + s.code +
        '" aria-label="Open ' + esc(s.name) + ', ' + esc(formatLong(s.total)) + ', ' + esc(recordCount(s)) + '">' + esc(s.name) +
        '</button></td><td class="ranking-amount' + (s.total == null ? ' no-total' : '') + '">' + esc(s.total == null ? "No state total" : formatShort(s.total)) +
        (s.total == null ? '' : '<span class="ranking-bar" aria-hidden="true"><i style="width:' + Math.max(1.5, s.total / MAX * 100) + '%"></i></span>') +
        '</td><td>' + s.records + '</td></tr>').join("") + '</tbody></table>' +
      (empty.length ? '<details class="ranking-empty"><summary>' + empty.length + (empty.length === 1 ? " state has" : " states have") +
        " no documented records" + scope + "</summary><p>" + esc(empty.join(", ")) + ".</p></details>" : "") +
      nationalSection() + '</div>';
    showPanel("ranking");
    if (focusTitle) document.getElementById("panel-title").focus({ preventScroll: true });
  }

  function openRanking() {
    if (!panel.hidden && panelView === "ranking") { closePanel(); return; }
    panelOpener = rankingButton;
    selectedCode = selectedFlow = selectedCompany = hoverCode = hoverFlow = null;
    hideTip();
    writeHash();
    renderRanking();
    frameBesidePanel();
    applyFocus();
  }

  function renderCompanyRows() {
    resetPanelPreview();
    const rows = companies.filter((c) => c.search.includes(companySearch.trim().toLocaleLowerCase()))
      .sort((a, b) => {
        if (companySort === "amount" && (a.total == null) !== (b.total == null)) return a.total == null ? 1 : -1;
        const diff = companySort === "name" ? a.name.localeCompare(b.name) :
          companySort === "states" ? a.states.size - b.states.size : (a.total || 0) - (b.total || 0);
        return (companyAscending ? diff : -diff) || a.name.localeCompare(b.name);
      });
    document.getElementById("company-count").textContent = rows.length + " of " + companies.length + " companies";
    document.getElementById("company-list").innerHTML = rows.map((c) =>
      '<li><button type="button" class="company-row" data-company="' + esc(c.name) + '">' + logoMark(c.name) +
      '<span class="company-row-body"><span class="company-row-name">' + esc(c.name) + '</span>' +
      '<span class="company-row-metrics"><span>' + esc(formatLong(c.total)) + '</span><span>' + c.states.size +
      (c.states.size === 1 ? ' state' : ' states') + (c.records.some(p=>p.national) ? ' · ' + c.records.filter(p=>p.national).length + ' national' : '') + '</span></span>' +
      '<span class="ranking-bar" aria-hidden="true"><i style="width:' + ((c.total || 0) / maxCompanyTotal * 100) +
      '%"></i></span></span></button></li>').join("");
    document.getElementById("company-empty").hidden = !!rows.length;
    applyFocus();
  }

  function renderCompanies(focusTitle = true) {
    const sortButton = (key, label) => '<button type="button" data-company-sort="' + key +
      '" aria-pressed="' + (companySort === key) + '" aria-label="Sort by ' + label.toLowerCase() +
      (companySort === key ? (companyAscending ? ', ascending' : ', descending') : '') + '">' + label +
      (companySort === key ? (companyAscending ? ' ↑' : ' ↓') : '') + '</button>';
    panel.innerHTML = sheetHandle() + '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close companies">×</button>' +
      '<h2 id="panel-title" tabindex="-1">Companies</h2>' +
      '<p class="quiet">Select a company to see its U.S. investments.</p></div>' +
      '<div class="company-controls"><label for="company-search">Search companies or Taiwanese parents</label>' +
      '<input type="search" id="company-search" autocomplete="off" placeholder="Company or parent name" value="' + esc(companySearch) + '">' +
      '<div class="company-sort" role="group" aria-label="Sort companies">' + sortButton("amount", "Total") +
      sortButton("name", "Name") + sortButton("states", "States") + '</div>' +
      '<p id="company-count" class="quiet" role="status" aria-live="polite"></p></div>' +
      '<div class="panel-scroll"><ul id="company-list" class="company-list" aria-label="Companies"></ul>' +
      '<p id="company-empty" class="quiet" hidden>No matching companies. Try another name.</p></div>';
    renderCompanyRows();
    showPanel("companies");
    if (focusTitle) document.getElementById("panel-title").focus({ preventScroll: true });
  }

  function openCompanies() {
    if (!panel.hidden && (panelView === "companies" || panelView === "company")) { closePanel(); return; }
    panelOpener = companiesButton;
    selectedCompany = selectedCode = selectedFlow = hoverCode = hoverFlow = null;
    hideTip();
    writeHash();
    renderCompanies();
    frameBesidePanel();
    applyFocus();
  }

  function clearCompany() {
    if (!selectedCompany) return;
    selectedCompany = selectedCode = selectedFlow = hoverCode = hoverFlow = null;
    hideTip();
    writeHash();
    renderCompanies(false);
    frameBesidePanel();
    applyFocus();
    selectionStatus.textContent = "Company focus cleared. Showing all investments.";
    const row = [...panel.querySelectorAll("[data-company]")].find((el) => el.dataset.company === lastCompany);
    (row || document.getElementById("company-search")).focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
  }

  function renderPanel(focusTitle) {
    const s = stateByCode.get(selectedCode);
    if (!s) return;
    const rows = projectsByState.get(selectedCode) || [];
    const q = stateQualifier(selectedCode);
    const parts = [
      ["Announced", s.announced, "var(--mix-ann)"],
      ["Completed", s.completed, "var(--mix-comp)"],
      ["Acquisition", s.acquisition, "var(--mix-acq)"], ["Equity", s.equity, "var(--mix-comp)"], ["Loans", s.loan, "var(--mix-ann)"],
    ].filter((d) => d[1]);
    let count = rows.length ? rows.length + " record" + (rows.length === 1 ? "" : "s") : "";
    if (s.total != null && s.unpriced) count += " · " + s.unpriced + " not in the total";
    const mix = parts.length > 1
      ? '<div class="mix">' + parts.map((d) =>
          '<span style="width:' + (d[1] / s.total) * 100 + "%;background:" + d[2] + '"></span>'
        ).join("") + "</div>" +
        '<p class="mix-label">' + parts.map((d) => esc(formatShort(d[1]) + " " + d[0].toLowerCase())).join(" · ") + "</p>"
      : "";
    panel.innerHTML =
      sheetHandle() +
      '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close details">×</button>' +
      "<h2 id=\"panel-title\" tabindex=\"-1\">" + esc(s.name) + "</h2>" +
      (q ? '<p class="kicker">' + esc(q) + "</p>" : "") +
      '<p class="big" id="panel-total">' + esc(rows.length ? formatLong(s.total) : "No records") + "</p>" +
      (count ? '<p class="quiet">' + esc(count) + "</p>" : "") +
      mix +
      "</div>" +
      '<div class="panel-scroll">' +
      (rows.length ? "" : '<p class="quiet empty-state">No documented ' +
        (investorType === "all" ? "" : investorType === "firm" ? "firm " : "government ") +
        "records in " + esc(s.name) + ". A blank map is not evidence of zero investment.</p>") +
      rows.map((p) => {
        const company = p.firmGroup || p.firm;
        return (
          '<article class="record' + (p.id === selectedFlow ? " is-current" : "") + '" id="rec-' + esc(p.id) + '">' +
          '<div class="record-top">' +
          '<button type="button" class="company-btn" data-company="' + esc(company) + '" aria-label="Show ' + esc(company) + ' across the Pacific">' +
          logoMark(company) +
          '<span class="name">' + esc(company) + "</span></button>" +
          '<p class="amt">' + esc(p.amount == null ? "Undisclosed" : formatLong(p.amount)) + "</p></div>" +
          '<p class="project">' + esc(p.project) + "</p>" +
          (p.firm && p.firm !== company ? '<p class="parent">' + esc(p.firm) + "</p>" : "") +
          recordContext(p) + chipList(p) + sourceLink(p) +
          "</article>"
        );
      }).join("") +
      "</div>";
    showPanel("details");
    if (focusTitle) {
      const title = document.getElementById("panel-title");
      if (title) title.focus({ preventScroll: true });
    }
    if (selectedFlow) {
      const el = document.getElementById("rec-" + selectedFlow);
      if (el) el.scrollIntoView({ block: "nearest" });
    }
  }

  function monogram(name) {
    const parts = String(name).split(/[^A-Za-z0-9]+/).filter((w) => w && !/^(of|and|the|for)$/i.test(w));
    return ((parts[0] || "?").slice(0, 1) + (parts[1] ? parts[1].slice(0, 1) : "")).toUpperCase();
  }

  const LOGO_READY = new Set(Object.keys(window.COMPANY_LOGOS || {}));

  function logoSlug(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function logoMark(company) {
    const mono = esc(monogram(company));
    const slug = logoSlug(company);
    if (!LOGO_READY.has(slug)) {
      return '<span class="logo is-fallback" aria-hidden="true"><span class="mono">' + mono + "</span></span>";
    }
    // Wide wordmarks get less inset so they fill their box. A failed file falls
    // back to the monogram tile instead of a broken image.
    return '<span class="logo" data-logo="' + slug + '" aria-hidden="true"><img src="logos/' + esc(window.COMPANY_LOGOS[slug]) + "?v=" + ASSET_VERSION +
      '" width="88" height="60" alt="" onload="this.naturalWidth / this.naturalHeight > 4 && this.parentNode.classList.add(\'is-wide\')"' +
      ' onerror="this.parentNode.classList.add(\'is-fallback\')"><span class="mono">' + mono + "</span></span>";
  }

  function projectsForCompany(name) {
    return (companyByName.get(name)?.records || [])
      .slice()
      .sort((a, b) => a.national - b.national || (b.amount ?? -1) - (a.amount ?? -1) || a.state.localeCompare(b.state));
  }
  function companySummary(c) {
    const national = c.records.filter((p) => p.national).length;
    const parts = [];
    if (c.states.size) parts.push(c.states.size + (c.states.size === 1 ? " state" : " states"));
    parts.push(c.records.length + (c.records.length === 1 ? " record" : " records"));
    if (national) parts.push(national + " national, not in state totals");
    return parts.join(" · ");
  }

  function renderCompanyPanel(focusTitle) {
    const rows = projectsForCompany(selectedCompany);
    const { total, states } = companyByName.get(selectedCompany);
    panel.innerHTML =
      sheetHandle() +
      '<div class="panel-head">' +
      '<button type="button" class="panel-close" data-close aria-label="Close details">×</button>' +
      '<button type="button" class="text-btn" data-company-back>← All companies</button>' +
      '<p class="kicker">Company</p>' +
      '<div class="company-lockup">' + logoMark(selectedCompany) +
      "<h2 id=\"panel-title\" tabindex=\"-1\">" + esc(selectedCompany) + "</h2></div>" +
      '<p class="big">' + esc(formatLong(total)) + "</p>" +
      '<p class="quiet">' + esc(companySummary(companyByName.get(selectedCompany))) + "</p>" +
      "</div>" +
      '<div class="panel-scroll">' +
      rows.map((p) => {
        const state = stateByCode.get(p.state);
        return (
          '<article class="record' + (p.national ? " national-record" : "") + '"' + (p.national ? "" : ' data-preview-state="' + esc(p.state) + '"') + ">" +
          '<div class="record-top"><h3>' + (p.national ? "United States, not allocated" :
            '<button type="button" class="state-link" data-company-state="' + esc(p.state) + '">' + esc(state.name) + "</button>") + "</h3>" +
          (p.national ? "" : '<p class="amt">' + esc(p.amount == null ? "Undisclosed" : formatLong(p.amount)) + "</p>") + "</div>" +
          (p.national ? nationalFigure(p) : "") +
          '<p class="project">' + esc(p.project) + "</p>" +
          '<p class="parent">Status: ' + esc(STATUS[p.status] || p.status || "Status unresolved") + "</p>" +
          recordContext(p) + chipList(p) + sourceLink(p) +
          "</article>"
        );
      }).join("") +
      "</div>";
    showPanel("company");
    if (focusTitle) {
      const title = document.getElementById("panel-title");
      if (title) title.focus({ preventScroll: true });
    }
  }

  function openCompany(name, focusTitle) {
    const company = companyByName.get(name);
    if (!company) return;
    if (panel.hidden) panelOpener = companiesButton;
    selectedCompany = lastCompany = name;
    selectedCode = selectedFlow = hoverCode = hoverFlow = null;
    hideTip();
    renderCompanyPanel(focusTitle !== false);
    writeHash({company: company.slug});
    selectionStatus.textContent = "Showing: " + name + ", " + formatLong(company.total) + ", " + company.states.size +
      (company.states.size === 1 ? " state." : " states.");
    frameBesidePanel();
    applyFocus();
  }

  function openState(code, focusTitle) {
    if (panel.hidden) panelOpener = null;
    selectedCompany = hoverCode = hoverFlow = null;
    selectedCode = code;
    selectedFlow = null;
    lastFocus = code;
    hideTip();
    renderPanel(focusTitle !== false);
    writeHash({state:code});
    frameBesidePanel();
    applyFocus();
  }
  function openRecord(id, focusTitle) {
    const p = projectById.get(id);
    if (!p) return;
    if (p.national) { openCompany(p.firmGroup || p.firm, focusTitle); return; }
    if (panel.hidden) panelOpener = null;
    selectedCompany = hoverCode = hoverFlow = null;
    selectedCode = p.state;
    selectedFlow = id;
    lastFocus = p.state;
    hideTip();
    renderPanel(focusTitle !== false);
    writeHash({record:id});
    frameBesidePanel();
    applyFocus();
  }
  function closePanel() {
    resetPanelPreview();
    selectedCompany = hoverCode = hoverFlow = null;
    selectedCode = null;
    selectedFlow = null;
    panel.classList.remove("is-in");
    panel.hidden = true;
    document.body.classList.remove("has-panel");
    rankingButton.setAttribute("aria-expanded", "false");
    companiesButton.setAttribute("aria-expanded", "false");
    writeHash();
    frameBesidePanel();
    applyFocus();
    const hit = hits.get(lastFocus);
    if (panelOpener) panelOpener.focus({ preventScroll: true });
    else if (hit) {
      for (const [c, node] of hits) node.setAttribute("tabindex", c === lastFocus ? "0" : "-1");
      hit.focus({ preventScroll: true });
    }
    hoverCode = hoverFlow = null;
    applyFocus();
    hideTip();
    selectionStatus.textContent = "Showing all investments.";
  }

  function curve(a, b, fan, inset) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dist = Math.hypot(dx, dy) || 1;
    // Mobile stacks Taiwan above the U.S., so a plain downward bow reads best.
    if (!inset && stage.clientWidth <= 860) {
      const side = 24 + fan * 22;
      const m1 = [a[0] + dx * 0.2 + side, a[1] + dy * 0.45];
      const m2 = [b[0] + side * 0.6, b[1] - dy * 0.35];
      return {
        c: m2,
        d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
          " C" + m1[0].toFixed(1) + "," + m1[1].toFixed(1) +
          " " + m2[0].toFixed(1) + "," + m2[1].toFixed(1) +
          " " + b[0].toFixed(1) + "," + b[1].toFixed(1),
      };
    }
    // Leave the Taiwan inset to the right before turning toward the western insets.
    if (inset) {
      const bend = Math.min(80, dist * 0.25);
      const outer = stage.clientWidth <= 860 ? stage.clientWidth - 24 : Math.max(318, a[0] + 135);
      const turn = [outer, a[1] + 90];
      const c1 = [a[0] + 65, a[1] - 42];
      const c = [b[0] + bend + fan * 18, b[1] - bend];
      return {
        c,
        d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
          " C" + c1[0].toFixed(1) + "," + c1[1].toFixed(1) +
          " " + outer.toFixed(1) + "," + (a[1] - 50).toFixed(1) +
          " " + turn[0].toFixed(1) + "," + turn[1].toFixed(1) +
          " C" + outer.toFixed(1) + "," + (a[1] + 180).toFixed(1) +
          " " + c[0].toFixed(1) + "," + c[1].toFixed(1) +
          " " + b[0].toFixed(1) + "," + b[1].toFixed(1),
      };
    }
    const band = 14 + (fan + 0.5) * Math.min(78, stage.clientHeight * 0.12);
    const c1 = [a[0] + dx * 0.22, band];
    const c2 = [a[0] + dx * 0.78 + fan * 24, band];
    return {
      c: c2,
      d: "M" + a[0].toFixed(1) + "," + a[1].toFixed(1) +
        " C" + c1[0].toFixed(1) + "," + c1[1].toFixed(1) +
        " " + c2[0].toFixed(1) + "," + c2[1].toFixed(1) +
        " " + b[0].toFixed(1) + "," + b[1].toFixed(1),
    };
  }
  function arrowPath(c, b, size) {
    const tx = b[0] - c[0];
    const ty = b[1] - c[1];
    const len = Math.hypot(tx, ty) || 1;
    const ux = tx / len;
    const uy = ty / len;
    const px = -uy;
    const py = ux;
    const bx = b[0] - ux * size;
    const by = b[1] - uy * size;
    const w = size * 0.42;
    return "M" + b[0].toFixed(1) + "," + b[1].toFixed(1) +
      " L" + (bx + px * w).toFixed(1) + "," + (by + py * w).toFixed(1) +
      " L" + (bx - px * w).toFixed(1) + "," + (by + py * w).toFixed(1) + " Z";
  }

  function draw(animateRefit = false) {
    const w = Math.round(stage.clientWidth);
    const h = Math.round(stage.clientHeight);
    if (w < 40 || h < 40) return;
    const previous = animateRefit && !reduced() ? new Map(mapGeometry()) : null;
    renderedFrame = frameKey();
    clearTimers();
    for (const f of flowEls) f.animation?.cancel();
    const box = layout(w, h);
    const usTopo = window.US_ATLAS;
    const matched = stateFeatures;
    if (matched.length !== 51) {
      stage.insertAdjacentHTML("beforeend", '<p class="noscript">The state shapes did not match the ledger.</p>');
      return;
    }
    const lowerFeatures = matched.filter((f) => f.properties.code !== "AK" && f.properties.code !== "HI");
    const alaskaFeature = matched.find((f) => f.properties.code === "AK");
    const hawaiiFeature = matched.find((f) => f.properties.code === "HI");
    const lowerGeo = { type: "FeatureCollection", features: lowerFeatures };

    const usProj = fit(d3.geoAlbers(), box.lower, lowerGeo, 2);
    // Reserve the space above the desktop legend, independently of the map camera.
    const usBounds = d3.geoPath(usProj).bounds(lowerGeo);
    const usW = usBounds[1][0] - usBounds[0][0];
    const usH = usBounds[1][1] - usBounds[0][1];
    const insetBottom = usBounds[1][1] - 6;
    box.alaska = [usBounds[0][0] + usW * 0.01, insetBottom - usH * 0.23,
      usBounds[0][0] + usW * 0.20, insetBottom];
    box.hawaii = [usBounds[0][0] + usW * 0.22, insetBottom - usH * 0.13,
      usBounds[0][0] + usW * 0.33, insetBottom];
    let legendTop = h;
    if (!box.mobile) {
      legendTop = legend.getBoundingClientRect().top - stage.getBoundingClientRect().top;
      const bottom = legendTop - 30;
      // As on the Japan map, Alaska and Hawaii sit under the origin inset when
      // there is room. On shorter screens they move to the conventional spot
      // southwest of the lower 48, so the Taiwanese inset keeps a legible size.
      if (bottom - 78 - box.taiwan[1] >= 330) {
        box.alaska = [24, bottom - 78, 142, bottom];
        box.hawaii = [174, bottom - 43, 222, bottom];
      } else {
        const clear = legend.getBoundingClientRect().right - stage.getBoundingClientRect().left + 14 - box.alaska[0];
        if (clear > 0) for (const b of [box.alaska, box.hawaii]) { b[0] += clear; b[2] += clear; }
      }
    }
    const akProj = fit(
      d3.geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65]),
      box.alaska,
      alaskaFeature,
      1
    );
    const hiProj = fit(
      d3.geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18]),
      box.hawaii,
      hawaiiFeature,
      1
    );
    // Taiwan is fit to its main island and Penghu, between two label lanes that
    // are measured from the actual port names. Offshore islands outside the frame are omitted.
    const kpFrame = box.taiwan.slice();
    if (!box.mobile) {
      kpFrame[2] = Math.max(kpFrame[2], usBounds[0][0] - 8);
      kpFrame[3] = Math.max(kpFrame[1] + 90, box.alaska[0] < box.taiwan[2] ? box.alaska[1] - 14 : legendTop - 16);
    }
    const portNames = Object.keys(rawData.ports);
    const sideOf = (name) => ["Hsinchu", "Taichung", "Tainan"].includes(name) ? "west" : "east";
    const probe = svg.append("text").attr("class", "origin-label");
    const portWidth = new Map(portNames.map((name) => [name, probe.text(name).node().getComputedTextLength() + 2]));
    const laneRow = Math.ceil(probe.node().getBBox().height) + 2;
    probe.remove();
    const laneWidth = (side) => d3.max(portNames.filter((n) => sideOf(n) === side), (n) => portWidth.get(n)) || 0;
    const westW = laneWidth("west"), eastW = laneWidth("east");
    const gap = box.mobile ? 10 : 12;
    const titleH = box.mobile ? 22 : 30;
    const unit = d3.geoMercator().scale(1).translate([0, 0]);
    const ux = (lon) => unit([lon, 36])[0], uy = (lat) => unit([127, lat])[1];
    const skSpan = uy(TAIWAN_FIT.south) - uy(TAIWAN_FIT.north);
    const laneSpan = ux(TAIWAN_FIT.eastLane) - ux(TAIWAN_FIT.westLane);
    const frameW = kpFrame[2] - kpFrame[0], frameH = kpFrame[3] - kpFrame[1];
    const nkMin = box.mobile ? 10 : 24;
    const k = Math.max(1, Math.min(
      (frameW - westW - eastW - gap * 2) / laneSpan,
      (frameH - titleH - nkMin - 6) / skSpan,
      (box.mobile ? 150 : 330) / skSpan));
    const groupW = westW + gap * 2 + eastW + k * laneSpan;
    const westX = kpFrame[0] + Math.max(0, (frameW - groupW) / 2) + westW + gap;
    const nkShow = Math.max(nkMin, Math.min(k * (uy(TAIWAN_FIT.north) - uy(25.6)),
      frameH - titleH - 6 - k * skSpan));
    const skTop = kpFrame[1] + titleH + nkShow;
    const kpProj = d3.geoMercator().scale(k)
      .translate([westX - k * ux(TAIWAN_FIT.westLane), skTop - k * uy(TAIWAN_FIT.north)]);
    const eastX = kpProj([TAIWAN_FIT.eastLane, 36])[0];

    function projFor(code) {
      if (code === "AK") return akProj;
      if (code === "HI") return hiProj;
      return usProj;
    }
    function subset(features) {
      const ids = new Set(features.map((f) => String(f.id).padStart(2, "0")));
      return {
        type: "GeometryCollection",
        geometries: usTopo.objects.states.geometries.filter((g) => ids.has(String(g.id).padStart(2, "0"))),
      };
    }

    svg.attr("viewBox", "0 0 " + w + " " + h).attr("width", w).attr("height", h);
    svg.selectAll("*").remove();
    hits = new Map();
    centroids = new Map();
    originNodes = [];
    labelNodes = [];
    flowEls = [];

    const defs = svg.append("defs");
    const pattern = defs.append("pattern")
      .attr("id", "unquantified")
      .attr("width", 6)
      .attr("height", 6)
      .attr("patternUnits", "userSpaceOnUse")
      .attr("patternTransform", "rotate(32)");
    pattern.append("rect").attr("width", 6).attr("height", 6).attr("fill", "var(--unq)");
    pattern.append("line")
      .attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 6)
      .attr("stroke", "var(--unq-line)").attr("stroke-width", 1.35);

    svg.append("rect")
      .attr("class", "ocean-hit")
      .attr("width", w)
      .attr("height", h)
      .attr("fill", "transparent")
      .on("click", () => { if (selectedCode) closePanel(); });

    const kpPath = d3.geoPath(kpProj);
    svg.append("path")
      .attr("class", "taiwan")
      .attr("d", kpPath(window.TAIWAN_SOUTH));
    const skCenter = (kpProj([119.2, 24])[0] + kpProj([122.2, 24])[0]) / 2;
    svg.append("text")
      .attr("class", "place")
      .attr("text-anchor", "middle")
      .attr("x", skCenter)
      .attr("y", kpFrame[1] + titleH - (box.mobile ? 8 : 12))
      .text("Taiwan");
    const fills = svg.append("g").attr("class", "fills");
    function addStates(features, projection) {
      const path = d3.geoPath(projection);
      fills.selectAll(null)
        .data(features)
        .join("path")
        .attr("class", "state")
        .attr("data-state", (d) => d.properties.code)
        .attr("fill", (d) => stateFill(stateByCode.get(d.properties.code)))
        .attr("d", path)
        .each(function (d) {
          const c = path.centroid(d);
          if (Number.isFinite(c[0]) && Number.isFinite(c[1])) centroids.set(d.properties.code, c);
        });
      const meshKey = features.map((f) => f.id).join(",");
      if (!meshCache.has(meshKey)) {
        const obj = subset(features);
        meshCache.set(meshKey, [topojson.mesh(usTopo, obj, (a, b) => a !== b),
          topojson.mesh(usTopo, obj, (a, b) => a === b)]);
      }
      const [border, coast] = meshCache.get(meshKey);
      svg.append("path").attr("class", "border").attr("d", path(border));
      svg.append("path").attr("class", "coast").attr("d", path(coast));
    }
    addStates(lowerFeatures, usProj);
    addStates([alaskaFeature], akProj);
    addStates([hawaiiFeature], hiProj);
    for (const code of ["AK", "HI"]) {
      const feature = code === "AK" ? alaskaFeature : hawaiiFeature;
      const bounds = d3.geoPath(projFor(code)).bounds(feature);
      svg.append("text").attr("class", "inset-label")
        .attr("x", bounds[1][0] + (box.mobile ? 3 : 7))
        .attr("y", (bounds[0][1] + bounds[1][1]) / 2 + 4).text(code);
    }

    const flowData = [];
    for (const p of data.projects) {
      if (p.national) continue;
      const origin = kpProj(p.origin);
      if (!origin) continue;
      let dest = null;
      if (p.dest) dest = projFor(p.state)(p.dest);
      if (!dest || !Number.isFinite(dest[0])) dest = centroids.get(p.state);
      if (!dest) continue;
      flowData.push({
        id: p.id,
        state: p.state,
        firmGroup: p.firmGroup || p.firm,
        amount: p.amount,
        quiet: p.amount == null,
        originKey: p.origin.map((n) => n.toFixed(2)).join(","),
        originLabel: p.originLabel,
        origin,
        xy: dest.slice(),
      });
    }
    const regions = d3.group(flowData, d => projectById.get(d.id).originRegion);
    const ports = [...regions].sort((a,b) => a[0].localeCompare(b[0]));
    ports.forEach(([name, rows]) => {
      const port = kpProj(rawData.ports[name]);
      rows.forEach(d => { d.origin = port; d.originRegion = name; });
    });
    const piles = d3.group(flowData, (d) => Math.round(d.xy[0] / 2) + ":" + Math.round(d.xy[1] / 2));
    for (const arr of piles.values()) {
      if (arr.length < 2) continue;
      arr.forEach((d, i) => {
        d.xy[0] += (i - (arr.length - 1) / 2) * 6;
      });
    }
    const fans = d3.group(flowData, (d) => d.originKey);
    for (const arr of fans.values()) {
      arr.sort((a, b) => a.xy[0] - b.xy[0] || a.xy[1] - b.xy[1]);
      arr.forEach((d, i) => {
        d.fan = arr.length === 1 ? 0 : i / (arr.length - 1) - 0.5;
      });
    }
    flowData.sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));

    const flows = svg.append("g").attr("class", "flows").attr("aria-hidden", "true");
    const flowColor = theme() === "light" ? "var(--flow)" : "var(--flow)";
    let movingMarks = 0;
    for (const [index, d] of flowData.entries()) {
      const shape = curve(d.origin, d.xy, d.fan, d.state === "AK" || d.state === "HI");
      const g = flows.append("g").attr("data-flow", d.id).attr("data-state", d.state);
      g.append("path")
        .attr("class", "flow-hit")
        .attr("d", shape.d)
        .attr("stroke", "#000")
        .attr("stroke-opacity", 0)
        .attr("stroke-width", 10)
        .on("pointerenter", (event) => {
          if (touchInput.matches || event.pointerType === "touch") return;
          hoverFlow = d.id;
          hoverCode = d.state;
          applyFocus();
          showFlowTip(d.id);
          moveTip(event);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", () => {
          hoverFlow = null;
          hoverCode = null;
          applyFocus();
          hideTip();
        })
        .on("click", (event) => {
          event.stopPropagation();
          if (selectedFlow === d.id) closePanel();
          else openRecord(d.id);
        });
      const path = g.append("path")
        .attr("class", "flow-line")
        .attr("d", shape.d)
        .attr("stroke", d.quiet ? "var(--flow-quiet)" : flowColor)
        .attr("stroke-opacity", idleFlowOpacity)
        .attr("stroke-width", d.quiet ? 0.8 : widthScale(d.amount))
        .node();
      let mark;
      if (d.quiet) {
        mark = g.append("circle")
          .attr("class", "mark")
          .attr("cx", d.xy[0])
          .attr("cy", d.xy[1])
          .attr("r", 2.2)
          .attr("fill", "var(--flow-quiet)")
          .node();
      } else {
        const size = Math.max(4, Math.min(9, widthScale(d.amount) * 1.8));
        mark = g.append("path")
          .attr("class", "arrow mark")
          .attr("d", arrowPath(shape.c, d.xy, size))
          .attr("fill", flowColor)
          .node();
      }
      let motion, animation, motionPhase;
      if (!d.quiet && movingMarks < MOTION_LIMIT) {
        movingMarks++;
        const length = path.getTotalLength();
        motion = g.append("path").attr("class", "flow-motion")
          .attr("d", shape.d).attr("stroke", flowColor)
          .attr("stroke-dasharray", "1.8 " + Math.max(0, length - 1.8))
          .style("visibility", "hidden").node();
        const duration = 5400 + (index * 431 % 1500);
        animation = motion.animate([
          { strokeDashoffset: "0px" }, { strokeDashoffset: -length + "px" },
        ], { duration, iterations: Infinity, easing: "linear" });
        animation.pause();
        motionPhase = (index * 0.61803398875 % 1) * duration;
        animation.currentTime = motionPhase;
      }
      flowEls.push({
        motion, animation, motionPhase,
        id: d.id,
        state: d.state,
        firmGroup: d.firmGroup,
        amount: d.amount,
        quiet: d.quiet,
        originKey: d.originKey,
        path,
        mark,
        group: g,
        revealed: introStarted || reduced(),
      });
    }

    const origins = svg.append("g").attr("class", "origins").attr("aria-hidden", "true");
    // Each coast has one label lane. Labels keep the north-to-south order of
    // their ports, so leaders never cross. East labels sit slightly south of
    // their ports, away from the arcs that leave toward the northeast.
    const lanes = new Map();
    for (const side of ["west", "east"]) {
      const items = portNames.filter((n) => sideOf(n) === side)
        .map((name) => ({ name, dot: kpProj(rawData.ports[name]) }))
        .sort((a, b) => a.dot[1] - b.dot[1]);
      let y = -Infinity;
      for (const it of items) {
        it.y = Math.max(it.dot[1] + (side === "east" ? 7 : 4), y + laneRow);
        y = it.y;
      }
      const overflow = y - (kpFrame[3] - 2);
      if (overflow > 0) items.forEach((it) => { it.y -= overflow; });
      items.forEach((it) => lanes.set(it.name, { side, y: it.y }));
    }
    const presentPorts = new Map(ports);
    for (const name of portNames) {
      const rows = presentPorts.get(name);
      if (!rows) continue;
      const d = rows[0], r = box.mobile ? 2.5 : 3;
      const node = origins.append("circle").attr("class", "origin").attr("data-origin", name)
        .attr("cx", d.origin[0]).attr("cy", d.origin[1]).attr("r", r).attr("fill", "var(--origin-line)").node();
      originNodes.push({ keys: rows.map((d) => d.originKey), node, r });
      const lane = lanes.get(name);
      const west = lane.side === "west";
      const x = west ? westX - gap : eastX + gap;
      origins.append("text").attr("class", "origin-label").attr("data-origin", name)
        .attr("text-anchor", west ? "end" : "start").attr("x", x).attr("y", lane.y).text(name);
      const end = [west ? x + 3 : x - 3, lane.y - 4];
      const vx = end[0] - d.origin[0], vy = end[1] - d.origin[1];
      const distance = Math.hypot(vx, vy) || 1;
      origins.insert("line", "circle").attr("class", "origin-leader").attr("data-origin", name)
        .attr("x1", d.origin[0] + vx / distance * (r + 1.5)).attr("y1", d.origin[1] + vy / distance * (r + 1.5))
        .attr("x2", end[0]).attr("y2", end[1]);
    }

    const top = data.states.filter((s) => s.total != null).sort((a, b) => b.total - a.total).slice(0, w < 600 ? 3 : 10);
    const labels = svg.append("g").attr("class", "labels");
    const placedLabels = [];
    const placedLeaders = [];
    const crosses = (a, z, b, pad = 5) => {
      for (let t = 0; t <= 1; t += 0.025) {
        const x = a[0] + (z[0] - a[0]) * t, y = a[1] + (z[1] - a[1]) * t;
        if (x > b.x - pad && x < b.x + b.width + pad && y > b.y - pad && y < b.y + b.height + pad) return true;
      }
      return false;
    };
    for (const s of top) {
      const c = centroids.get(s.code);
      if (!c) continue;
      const statePath = svg.select('.state[data-state="' + s.code + '"]').node();
      const node = labels.append("text")
        .attr("class", "state-label")
        .attr("data-state", s.code)
        .attr("text-anchor", "middle")
        .attr("x", c[0])
        .attr("y", c[1] + 4)
        .attr("fill", "var(--ink)")
        .attr("stroke", "var(--bg)")
        .text(s.code + "  " + formatLabel(s.total))
        .node();
      // Measure once per text size. Candidate placement is numeric, so moving
      // the camera does not force SVG text layout for every trial position.
      const metricKey = (w < 600 ? "small:" : "desktop:") + node.textContent;
      let metrics = labelMetrics.get(metricKey);
      if (!metrics) {
        const b = node.getBBox();
        metrics = { left: b.x - c[0], top: b.y - (c[1] + 4), width: b.width, height: b.height };
        labelMetrics.set(metricKey, metrics);
      }
      const preferred = { OH: [8, -10], IN: [0, 0], KY: [22, 8], TN: [-15, 14], AL: [0, 8] }[s.code] || [0, 0];
      const candidates = [preferred, [0, 0], [0, -32], [0, 32], [-44, 0], [44, 0],
        [0, -56], [0, 56], [-48, -32], [48, 32], [-72, 0], [72, 0], [-48, 32], [48, -32],
        ...[56, 80, 104, 128, 152, 176, 200].flatMap((radius) => d3.range(8).map((n) =>
          [Math.round(Math.cos(n * Math.PI / 4) * radius), Math.round(Math.sin(n * Math.PI / 4) * radius)]))];
      let placed = false;
      for (const [dx, dy] of candidates) {
        const b = { x: c[0] + dx + metrics.left, y: c[1] + 4 + dy + metrics.top,
          width: metrics.width, height: metrics.height };
        // Keep every top state's anchor available for its own label/leader.
        if (top.some((other) => {
          const anchor = centroids.get(other.code);
          return other.code !== s.code && anchor && anchor[0] > b.x - 6 && anchor[0] < b.x + b.width + 6 &&
            anchor[1] > b.y - 6 && anchor[1] < b.y + b.height + 6;
        })) continue;
        if (b.x < 16 || b.x + b.width > box.lower[2] - 4 || placedLabels.some((p) =>
          b.x < p.x + p.width + 12 && b.x + b.width + 12 > p.x &&
          b.y < p.y + p.height + 12 && b.y + b.height + 12 > p.y)) continue;
        // Check the whole text rectangle against the actual state path, rather
        // than its bounding box. Narrow states get an explicit callout instead.
        const inside = [0, 0.5, 1].every((x) => [0, 0.5, 1].every((y) =>
          statePath.isPointInFill(new DOMPoint(b.x - 2 + (b.width + 4) * x, b.y - 2 + (b.height + 4) * y))));
        if (!inside && Math.hypot(dx, dy) < 32) continue;
        const center = [b.x + b.width / 2, b.y + b.height / 2];
        const vx = c[0] - center[0], vy = c[1] - center[1];
        const edge = Math.min((b.width / 2 + 6) / (Math.abs(vx) || 1e-6), (b.height / 2 + 6) / (Math.abs(vy) || 1e-6));
        const end = [center[0] + vx * edge, center[1] + vy * edge];
        if (placedLeaders.some(([a, z]) => crosses(a, z, b))) continue;
        if (!inside && placedLabels.some((p) => crosses(c, end, p))) continue;
        placedLabels.push(b);
        placed = true;
        node.setAttribute("x", c[0] + dx);
        node.setAttribute("y", c[1] + 4 + dy);
        node.setAttribute("data-contained", String(inside));
        // Retain invisible leaders for contained labels. Their coordinates and
        // opacity can then interpolate with the camera on panel open/close.
        labels.insert("line", "text")
          .attr("class", "label-leader").attr("data-state", s.code).attr("opacity", inside ? 0 : 1)
          .attr("x1", c[0]).attr("y1", c[1]).attr("x2", inside ? c[0] : end[0]).attr("y2", inside ? c[1] : end[1]);
        labels.insert("circle", "text").attr("class", "label-anchor").attr("data-state", s.code)
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 2).attr("fill", "var(--ink)").attr("opacity", inside ? 0 : 1);
        if (!inside) placedLeaders.push([c, end]);
        break;
      }
      if (!placed) { node.remove(); continue; }
      labelNodes.push({ code: s.code, total: s.total, node });
    }

    const ringUnder = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", "var(--bg)").attr("stroke-width", 4.5);
    const ring = svg.append("path").attr("class", "active-ring").attr("fill", "none")
      .attr("stroke", "var(--ink)").attr("stroke-width", 1.5);
    ringUnder.attr("display", "none");
    ring.attr("display", "none");
    labels.raise();

    const interaction = svg.append("g").attr("class", "interaction");
    svg.selectAll(".state").each(function (d) {
      const code = d.properties.code;
      const s = stateByCode.get(code);
      const q = stateQualifier(code);
      const label = s.name + ", " + (s.records ? (q ? q + " " : "") + formatLong(s.total) + ", " + recordCount(s) :
        "no documented records");
      const hit = interaction.append("path")
        .attr("class", "hit")
        .attr("data-state", code)
        .attr("d", this.getAttribute("d"))
        .attr("fill", "transparent")
        .attr("role", "button")
        .attr("tabindex", code === lastFocus ? 0 : -1)
        .attr("aria-label", label)
        .attr("aria-describedby", "tip")
        .attr("aria-expanded", "false")
        .on("pointerenter", (event) => {
          if (touchInput.matches || event.pointerType === "touch") return;
          hoverFlow = null;
          hoverCode = code;
          applyFocus();
          showStateTip(code);
          moveTip(event);
        })
        .on("pointermove", moveTip)
        .on("pointerleave", () => {
          if (hoverCode === code) hoverCode = null;
          applyFocus();
          hideTip();
        })
        .on("click", (event) => {
          event.stopPropagation();
          lastFocus = code;
          if (selectedCode === code && !selectedFlow) closePanel();
          else openState(code);
        })
        .on("keydown", (event) => {
          const dir = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" }[event.key];
          if (dir) {
            event.preventDefault();
            const next = neighbor(code, dir);
            if (next) focusState(next);
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (selectedCode === code && !selectedFlow) closePanel();
            else openState(code);
          }
        })
        .on("focus", () => {
          lastFocus = code;
          hoverCode = code;
          hoverFlow = null;
          applyFocus();
          showStateTip(code);
          const b = hit.getBoundingClientRect();
          moveTip({ clientX: b.left + b.width / 2, clientY: b.top + Math.min(24, b.height / 2) });
        })
        .on("blur", () => {
          if (hoverCode === code) hoverCode = null;
          applyFocus();
          hideTip();
        })
        .node();
      hits.set(code, hit);
      const box = this.getBBox();
      if (box.width < 16 || box.height < 16) {
        const c = centroids.get(code);
        if (!c) return;
        fills.append("circle")
          .attr("class", "state-dot")
          .attr("data-state", code)
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 3.2)
          .attr("fill", stateFill(s))
          .attr("stroke", "var(--line-strong)").attr("stroke-width", 0.6)
          .attr("pointer-events", "none");
        interaction.append("circle")
          .attr("cx", c[0]).attr("cy", c[1]).attr("r", 11)
          .attr("fill", "transparent")
          .attr("role", "presentation")
          .on("pointerenter", (event) => {
            if (touchInput.matches || event.pointerType === "touch") return;
            hoverCode = code;
            hoverFlow = null;
            applyFocus();
            showStateTip(code);
            moveTip(event);
          })
          .on("pointermove", moveTip)
          .on("pointerleave", () => {
            if (hoverCode === code) hoverCode = null;
            applyFocus();
            hideTip();
          })
          .on("click", (event) => {
            event.stopPropagation();
            lastFocus = code;
            if (selectedCode === code && !selectedFlow) closePanel();
            else openState(code);
          });
      }
    });

    applyFocus();
    if (!introStarted || introRunning) {
      introStarted = true;
      armAnimation();
    } else {
      for (const f of flowEls) {
        f.revealed = true;
        f.path.style.strokeDasharray = f.quiet ? "2.2 3.4" : "none";
      }
      applyFocus();
    }

    if (!booted) {
      booted = true;
      openHash();
    } else if (selectedCode) {
      applyFocus();
    }
    if (previous) {
      const motion = panelMotion();
      for (const [key, { node, attrs }] of mapGeometry()) {
        const old = previous.get(key);
        if (!old) continue;
        const transition = d3.select(node).transition("frame").duration(motion.duration).ease(motion.ease);
        for (const [attr, target] of Object.entries(attrs)) {
          if (old.attrs[attr] == null || old.attrs[attr] === target) continue;
          node.setAttribute(attr, old.attrs[attr]);
          transition.attr(attr, target);
        }
      }
    }
    frameBesidePanel();
  }

  function schedule() {
    if (!fontsReady || resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      draw();
      renderLegend();
    });
  }

  function setMode(next) {
    mode = next;
    document.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.setAttribute("aria-checked", btn.getAttribute("data-mode") === mode ? "true" : "false");
    });
    if (mode !== "heat" && flowEls.some((f) => !f.revealed)) armAnimation();
    applyFocus();
    renderLegend();
  }

  function setTheme(next) {
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("ki-theme-v1", next); } catch (e) {}
    document.getElementById("theme").setAttribute(
      "aria-label",
      next === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    applyFocus();
    renderLegend();
  }

  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.getAttribute("data-mode")));
  });
  document.querySelector(".layer-toggle").addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...document.querySelectorAll("[data-mode]")];
    let i = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    i = (i + (forward ? 1 : buttons.length - 1)) % buttons.length;
    buttons[i].click();
    buttons[i].focus();
  });
  document.getElementById("theme").addEventListener("click", () => {
    setTheme(theme() === "dark" ? "light" : "dark");
  });
  document.getElementById("theme").setAttribute(
    "aria-label",
    theme() === "dark" ? "Switch to light theme" : "Switch to dark theme"
  );
  document.getElementById("replay").addEventListener("click", () => {
    if (mode === "heat") setMode("both");
    introStarted = true;
    armAnimation();
  });
  motionButton.addEventListener("click", () => {
    motionPaused = !motionPaused;
    try { localStorage.setItem("ki-flow-motion-paused", String(motionPaused)); } catch (e) {}
    syncFlowMotion();
  });
  document.addEventListener("visibilitychange", syncFlowMotion);
  function openHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    const next = ["firm","government"].includes(params.get("type")) ? params.get("type") : "all";
    if (next !== investorType) changeType(next, false);
    let legacy = ""; try { legacy = decodeURIComponent(location.hash.slice(1)); } catch {}
    const slug = params.get("company");
    if (slug) { const company = companyBySlug.get(slug); if (company) openCompany(company.name,false); }
    else if (params.get("record") && projectById.has(params.get("record"))) openRecord(params.get("record"),false);
    else if (params.get("state") && stateByCode.has(params.get("state"))) openState(params.get("state"),false);
    else if (stateByCode.has(legacy)) openState(legacy,false);
    else if (projectById.has(legacy)) openRecord(legacy,false);
  }
  document.querySelectorAll("[data-type]").forEach(button => button.addEventListener("click", () => changeType(button.dataset.type)));
  document.querySelector(".investor-toggle").addEventListener("keydown", event => {
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End"].includes(event.key)) return;
    event.preventDefault();
    const buttons=[...document.querySelectorAll("[data-type]")], index=buttons.indexOf(document.activeElement);
    const next=event.key === "Home" ? 0 : event.key === "End" ? 2 : (index+(["ArrowRight","ArrowDown"].includes(event.key)?1:2))%3;
    buttons[next].click(); buttons[next].focus();
  });
  document.getElementById("national-about").addEventListener("click", event => {
    const button=event.target.closest("[data-company]");
    if (button) { document.getElementById("notes").close(); openCompany(button.dataset.company); }
  });
  window.addEventListener("hashchange", openHash);
  rankingButton.addEventListener("click", openRanking);
  companiesButton.addEventListener("click", openCompanies);
  document.getElementById("company-clear").addEventListener("click", clearCompany);
  panel.addEventListener("input", (event) => {
    if (event.target.id !== "company-search") return;
    companySearch = event.target.value;
    renderCompanyRows();
  });
  // Delegate all panel previews to the existing map focus path. Pointer previews
  // are mouse-only; keyboard focus still works on devices with a touch screen.
  const previewRowSelector = "[data-ranking-state],.company-row[data-company],[data-preview-state]";
  function previewPanelRow() {
    const row = hoveredPanelRow?.isConnected ? hoveredPanelRow :
      focusedPanelRow?.isConnected ? focusedPanelRow : null;
    hoverCompany = row?.dataset.company || null;
    hoverCode = row?.dataset.rankingState || row?.dataset.previewState || null;
    hoverFlow = null;
    applyFocus();
  }
  panel.addEventListener("pointerover", (event) => {
    if (touchInput.matches || event.pointerType !== "mouse") return;
    const row = event.target.closest(previewRowSelector);
    if (!row || row.contains(event.relatedTarget)) return;
    hoveredPanelRow = row;
    previewPanelRow();
  });
  panel.addEventListener("pointerout", (event) => {
    if (touchInput.matches || event.pointerType !== "mouse") return;
    const row = event.target.closest(previewRowSelector);
    if (!row || row.contains(event.relatedTarget)) return;
    hoveredPanelRow = event.relatedTarget?.closest?.(previewRowSelector) || null;
    previewPanelRow();
  });
  panel.addEventListener("focusin", (event) => {
    // A tap focuses a button too; reserve previews for visible keyboard focus.
    const row = event.target.closest(previewRowSelector);
    focusedPanelRow = row && event.target.matches(":focus-visible") ? row : null;
    if (focusedPanelRow) hoveredPanelRow = null;
    previewPanelRow();
  });
  panel.addEventListener("focusout", (event) => {
    focusedPanelRow = null;
    previewPanelRow();
  });
  let suppressHandleClick = false;
  panel.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".grabber") || window.innerWidth > 860) return;
    sheetDrag = { y: event.clientY, height: panel.getBoundingClientRect().height, moved: false };
    suppressHandleClick = false;
    event.target.closest(".grabber").setPointerCapture(event.pointerId);
    panel.classList.add("is-dragging");
  });
  panel.addEventListener("pointermove", (event) => {
    if (!sheetDrag) return;
    const distance = sheetDrag.y - event.clientY;
    if (Math.abs(distance) > 6) sheetDrag.moved = true;
    setSheetHeight(sheetDrag.height + distance);
  });
  // On phones the expanded sheet dims the page behind it; a tap there collapses it.
  document.querySelector(".map-view").addEventListener("click", (event) => {
    if (!document.body.classList.contains("company-sheet-expanded") || panel.contains(event.target)) return;
    if (event.target !== event.currentTarget) return;
    setSheetHeight(window.innerHeight * 0.4);
  });
  function finishSheetDrag(event) {
    if (!sheetDrag) return;
    const drag = sheetDrag;
    sheetDrag = null;
    panel.classList.remove("is-dragging");
    const handle = panel.querySelector(".grabber");
    if (handle && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    suppressHandleClick = drag.moved;
    if (!drag.moved || event.type === "pointercancel") { setSheetHeight(drag.height); return; }
    if (sheetHeight < window.innerHeight * 0.28) closePanel();
    else {
      const upward = drag.y - event.clientY > 35;
      const downward = event.clientY - drag.y > 35;
      setSheetHeight(window.innerHeight * (upward ? 0.94 : downward ? 0.4 : sheetHeight > window.innerHeight * 0.67 ? 0.94 : 0.4));
    }
  }
  panel.addEventListener("pointerup", finishSheetDrag);
  panel.addEventListener("pointercancel", finishSheetDrag);
  panel.addEventListener("keydown", (event) => {
    if (event.target.closest(".grabber") && ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (event.key === "ArrowDown" && sheetHeight <= window.innerHeight * 0.41) closePanel();
      else setSheetHeight(window.innerHeight * (["ArrowUp", "End"].includes(event.key) ? 0.94 : 0.4));
      return;
    }
    const selector = panelView === "companies" ? "[data-company]" : panelView === "company" ? "[data-company-state]" : "[data-select-state]";
    const row = event.target.closest(selector);
    if (!row || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...panel.querySelectorAll(selector)];
    const index = buttons.indexOf(row);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + (event.key === "ArrowDown" ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next].focus();
  });
  panel.addEventListener("click", (event) => {
    if (event.target.closest(".grabber")) {
      if (!suppressHandleClick) setSheetHeight(window.innerHeight * (sheetHeight > window.innerHeight * 0.65 ? 0.4 : 0.94));
      suppressHandleClick = false;
      return;
    }
    const companySortButton = event.target.closest("[data-company-sort]");
    if (companySortButton) {
      const key = companySortButton.dataset.companySort;
      companyAscending = companySort === key ? !companyAscending : key === "name";
      companySort = key;
      renderCompanies(false);
      panel.querySelector('[data-company-sort="' + key + '"]').focus({ preventScroll: true });
      return;
    }
    if (event.target.closest("[data-company-back]")) { clearCompany(); return; }
    const companyState = event.target.closest("[data-company-state]");
    if (companyState) { openState(companyState.dataset.companyState); return; }
    const sort = event.target.closest("[data-sort]");
    if (sort) {
      const key = sort.getAttribute("data-sort");
      rankingAscending = rankingSort === key ? !rankingAscending : key === "state";
      rankingSort = key;
      renderRanking(false);
      panel.querySelector('[data-sort="' + key + '"]').focus({ preventScroll: true });
      return;
    }
    const stateRow = event.target.closest("[data-ranking-state]");
    if (stateRow) { openState(stateRow.getAttribute("data-ranking-state")); return; }
    if (event.target.closest("[data-close]")) {
      closePanel();
      return;
    }
    const company = event.target.closest("[data-company]");
    if (company) openCompany(company.getAttribute("data-company"));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden && !document.querySelector("dialog[open]")) {
      event.preventDefault();
      if (selectedCompany) clearCompany();
      else closePanel();
    }
    if (event.key === "Escape") hideTip();
  });
  setMode(mode);
  new ResizeObserver(schedule).observe(stage);
  Promise.all([document.fonts.ready, document.fonts.load("600 12.5px Inter")]).then(() => {
    fontsReady = true;
    schedule();
  });
  const panelObserver = new ResizeObserver(frameBesidePanel);
  panelObserver.observe(stage);
  panelObserver.observe(panel);
  reducedMotion.addEventListener("change", () => {
    if (reduced()) { svg.selectAll("*").interrupt("frame"); draw(); armAnimation(); }
    syncFlowMotion();
  });
  window.addEventListener("resize", () => {
    if (!panel.hidden && window.innerWidth <= 860) setSheetHeight(window.innerHeight * sheetFraction);
    else frameBesidePanel();
  });
  renderLegend();
  schedule();
})();
