/* Exact-size Chrome screenshots and source-backed interaction checks.
   Usage: node scripts/verify_site.cjs [http://127.0.0.1:8768]
   Writes .qa/*.png and .qa/verification.json. Exits nonzero on any failed check. */
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || '/Users/edgarmacmini/Claudia/_claudia/tmp/japan-investment-browser/node_modules/playwright-core');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), out = path.join(root, '.qa');
fs.mkdirSync(out, {recursive: true});
const base = (process.argv[2] || 'http://127.0.0.1:8768').replace(/\/$/, '');
const checks = {}, screenshots = [], errors = [];
const assert = (ok, name) => { if (!ok) throw Error('Check failed: ' + name); checks[name] = true; };
const slugOf = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true});
  try {
    const context = await browser.newContext({viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, reducedMotion: 'reduce'});
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('favicon.ico')) errors.push(r.status() + ' ' + r.url()); });

    async function load(theme = 'light', hash = '') {
      await page.goto('about:blank'); // a hash-only change would not reload the page
      await page.goto(base + '/?theme=' + theme + hash);
      await page.waitForFunction(() => document.querySelectorAll('.state').length === 51 && document.querySelector('#legend .bar'));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
    }
    async function shot(name) { await page.screenshot({path: path.join(out, name), animations: 'disabled'}); screenshots.push(name); }
    async function fits() { return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth); }
    // Port labels: no overlap with each other, with another port's dot, the
    // inset title or the viewport edge.
    async function originLayout() {
      return page.evaluate(() => {
        const labels = [...document.querySelectorAll('.origin-label')].map((n) => n.getBBox());
        const dots = [...document.querySelectorAll('.origin')].map((n) => ({x: +n.getAttribute('cx'), y: +n.getAttribute('cy')}));
        const title = document.querySelector('.place').getBBox();
        const hit = (a, z, pad = 1) => a.x < z.x + z.width + pad && a.x + a.width + pad > z.x && a.y < z.y + z.height + pad && a.y + a.height + pad > z.y;
        const problems = [];
        labels.forEach((a, i) => {
          if (labels.slice(i + 1).some((z) => hit(a, z))) problems.push('label overlap');
          if (dots.some((d) => d.x > a.x - 2 && d.x < a.x + a.width + 2 && d.y > a.y - 2 && d.y < a.y + a.height + 2)) problems.push('label over dot');
          if (hit(a, title, 2)) problems.push('label over title');
          if (a.x < 2 || a.x + a.width > innerWidth - 2) problems.push('label off screen');
        });
        const south = document.querySelector('.taiwan').getBBox();
        return {ok: !problems.length, problems, labels: labels.length, southTaiwan: [Math.round(south.width), Math.round(south.height)]};
      });
    }

    await load();
    const data = await page.evaluate(() => window.MAP_DATA);
    const fmt = (m, prose = true) => page.evaluate(([m, p]) => window.formatInvestment(m, p), [m, prose]);
    const version = await page.evaluate(() => new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get('v'));

    // Formatting rules.
    const formatCases = await page.evaluate(() => [[17100, false], [41040, true], [250, false], [250, true], [13.8, true], [999.96, true], [350000, true]]
      .map(([m, p]) => window.formatInvestment(m, p)));
    assert(JSON.stringify(formatCases) === JSON.stringify(['$17.10B', '$41.04 billion', '$250M', '$250 million', '$13.8 million', '$999.96 million', '$350.00 billion']), 'Number formatting');
    // Cache-busting on every CSS, JS and logo URL.
    const urls = await page.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet][href^="css"],script[src]')].map((n) => n.getAttribute('href') || n.getAttribute('src')));
    assert(urls.length >= 9 && urls.every((u) => u.endsWith('?v=' + version)), 'Cache-busting on CSS and JS');

    // Default view.
    assert(await page.locator('#stat-value').innerText() === await fmt(data.total), 'All state subtotal');
    assert(await page.locator('.flows>g').count() === data.projects.filter((p) => !p.national).length, 'National excluded from flows');
    const fills = await page.evaluate(() => [...document.querySelectorAll('.state')].map((n) => [n.dataset.state, n.style.fill]));
    const byCode = new Map(data.states.map((s) => [s.code, s]));
    assert(fills.every(([code, fill]) => { const s = byCode.get(code); return s.total == null ? (s.records ? fill.includes('unquantified') : fill === 'var(--flat)') : fill.startsWith('rgb'); }), 'Hatch only for records without a total');
    assert((await page.locator('#legend').innerText()).includes('Records, no state total'), 'Legend explains hatching');
    const topTen = data.states.filter((s) => s.total != null).length;
    assert(await page.locator('.state-label').count() === Math.min(10, topTen), 'Top state labels');
    let layout = await originLayout(); assert(layout.labels === 6 && layout.southTaiwan[1] >= 190, 'Six Taiwan ports and desktop inset size'); assert(layout.ok, 'Origin labels 1440: ' + layout.problems.join());
    assert(await fits(), 'Desktop width');
    const headerH = await page.evaluate(() => document.querySelector('header').getBoundingClientRect().height);
    assert(headerH <= 140, 'Compact desktop header');
    await shot('desktop-light.png');

    // Keyboard focus tooltip on a state.
    const tipState = data.states.filter((s) => s.total != null).sort((a, b) => b.total - a.total)[0].code;
    await page.locator('.hit[data-state="' + tipState + '"]').focus();
    assert(await page.locator('#tip').isVisible(), 'Keyboard focus tooltip');
    await shot('keyboard-tooltip.png');
    await page.keyboard.press('ArrowLeft');
    assert(await page.evaluate((c) => document.activeElement.dataset.state !== c, tipState), 'Arrow keys move between states');
    await page.keyboard.press('Enter');
    assert(await page.locator('#panel').isVisible(), 'Keyboard opens detail');
    await page.keyboard.press('Escape');

    // States ranking: every state with records, quantified first by amount.
    await page.locator('#ranking-open').click();
    const ranking = await page.evaluate(() => [...document.querySelectorAll('[data-ranking-state]')].map((r) => r.dataset.rankingState));
    const expected = data.states.filter((s) => s.records > 0).sort((a, b) => ((a.total == null) - (b.total == null)) || (b.total ?? 0) - (a.total ?? 0) || a.name.localeCompare(b.name)).map((s) => s.code);
    assert(JSON.stringify(ranking) === JSON.stringify(expected), 'States ranking order');
    await shot('states-tab.png');
    await page.locator('#panel .national-section').evaluate(n => { const sc = n.closest('.panel-scroll'); sc.scrollTop = n.offsetTop - sc.offsetTop; });
    const national = await page.locator('#panel .national-section').innerText();
    for (const p of data.nationalRecords) {
      const v = p.amount ?? p.transactionValue; const figure = (v == null ? 'Amount not stated' : await fmt(v)) + ', not counted in state totals';
      assert(national.includes(figure), 'National figure: ' + figure);
    }
    assert(await page.locator('#panel .national-record .type-chip').count() === data.nationalRecords.length, 'National type badges');
    await shot('national-records.png');

    // Companies tab, search and logos.
    await page.locator('#companies-open').click();
    const groups = new Set(data.projects.map((p) => p.firmGroup || p.firm));
    assert(await page.locator('#company-list [data-company]').count() === groups.size, 'Companies list');
    await page.waitForTimeout(300);
    const broken = await page.evaluate(() => [...document.querySelectorAll('#company-list img')].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
    assert(broken.length === 0, 'All logos render');
    const logoUrls = await page.evaluate(() => [...document.querySelectorAll('#company-list img')].map((i) => i.getAttribute('src')));
    assert(logoUrls.every((u) => u.endsWith('?v=' + version)), 'Cache-busting on logos');
    const top = [...groups].sort()[0];
    const term = top.slice(0, 3);
    await page.locator('#company-search').fill(term);
    const shown = await page.locator('#company-list [data-company]').count();
    const wanted = [...groups].filter((g) => [g, ...data.projects.filter((p) => (p.firmGroup || p.firm) === g).flatMap((p) => [p.firm, p.parent])]
      .join(' ').toLowerCase().includes(term.toLowerCase())).length;
    assert(shown >= 1 && shown === wanted, 'Company search');
    await shot('companies-search.png');

    // Government filter: totals, flows, ranking, companies and hash.
    await load('light', '#type=government');
    assert(await page.locator('#stat-value').innerText() === await fmt(data.totals.government), 'Government state subtotal');
    assert(await page.locator('.flows>g').count() === data.projects.filter((p) => !p.national && p.investorType === 'government').length, 'Government flows');
    layout = await originLayout(); assert(layout.ok, 'Origin labels with filter');
    await page.locator('#ranking-open').click();
    const govRank = await page.evaluate(() => [...document.querySelectorAll('[data-ranking-state]')].map((r) => r.dataset.rankingState));
    const govExpected = data.states.map((s) => ({...s, ...s.byType.government})).filter((s) => s.records > 0)
      .sort((a, b) => ((a.total == null) - (b.total == null)) || (b.total ?? 0) - (a.total ?? 0) || a.name.localeCompare(b.name)).map((s) => s.code);
    assert(JSON.stringify(govRank) === JSON.stringify(govExpected), 'Government ranking order');
    await shot('government-filter.png');
    await page.locator('#companies-open').click();
    const govCount = await page.locator('#company-list [data-company]').count();
    assert(govCount === new Set(data.projects.filter((p) => p.investorType === 'government').map((p) => p.firmGroup)).size, 'Government company list ' + govCount);
    // Radiogroup keyboard support.
    await page.locator('[data-type="government"]').focus();
    await page.keyboard.press('ArrowLeft');
    assert(page.url().includes('type=firm') && await page.locator('[data-type="firm"]').getAttribute('aria-checked') === 'true', 'Investor radiogroup arrow keys');
    await page.keyboard.press('Home');
    assert(!page.url().includes('type=') && await page.evaluate(() => document.activeElement.dataset.type === 'all'), 'Investor radiogroup Home key');

    // Company deep link combined with a type.
    const company = [...groups].map((name) => ({name, total: data.projects.filter((p) => (p.firmGroup || p.firm) === name && p.allocated).reduce((a, p) => a + p.amount, 0), type: data.projects.find((p) => (p.firmGroup || p.firm) === name).investorType}))
      .sort((a, b) => b.total - a.total)[0];
    await load('light', '#type=' + company.type + '&company=' + slugOf(company.name));
    assert(await page.locator('#company-focus-label').innerText() === 'Showing: ' + company.name, 'Combined type/company deep link');
    layout = await originLayout(); assert(layout.ok, 'Company-panel origin labels');
    await shot('company-deep-link.png');
    await page.locator('#company-clear').click();
    assert(page.url().includes('type=' + company.type), 'Clearing company preserves type');
    const nationalOnly = data.projects.find((p) => p.national && !data.projects.some((q) => q.firmGroup === p.firmGroup && !q.national));
    if (nationalOnly) {
      await load('light', '#company=' + slugOf(nationalOnly.firmGroup));
      assert((await page.locator('#panel').innerText()).includes('not counted in state totals'), 'National-only company');
    }

    // Layer modes, reduced-motion replay, theme toggle.
    await load();
    await page.locator('[data-mode="heat"]').click(); assert(await page.locator('.flows').getAttribute('visibility') === 'hidden', 'Heat mode');
    await page.locator('[data-mode="flows"]').click();
    const quantified = data.states.find((s) => s.total != null).code;
    assert(await page.locator('.state[data-state="' + quantified + '"]').evaluate((n) => n.style.fill) === 'var(--flat)', 'Flows mode');
    await page.locator('[data-mode="both"]').click(); await page.locator('#replay').click();
    assert(await page.locator('.flow-line').evaluateAll((nodes) => nodes.every((n) => !n.style.strokeDashoffset || n.style.strokeDashoffset === '0')), 'Reduced motion replay draws at once');
    assert(await page.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running')), 'No running animation with reduced motion');
    assert(await page.locator('#flow-motion').isDisabled(), 'Motion control disabled with reduced motion');
    await page.locator('#theme').click(); assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Theme toggle');

    // Data dialog.
    await load();
    await page.locator('#download-data').click(); assert(await page.locator('#downloads').isVisible(), 'Download dialog tab');
    await shot('download-dialog.png');
    await page.locator('#about-tab').click();
    const about = await page.locator('#about-figures').innerText();
    assert(about.includes('National records') && about.includes('Investor type'), 'About explains national records and investor type');
    await shot('about-dialog.png');
    await page.keyboard.press('Escape');
    assert(await page.locator('#download-data').evaluate((n) => document.activeElement === n), 'Dialog restores focus');
    await load('dark'); layout = await originLayout(); assert(layout.ok, 'Dark origin labels'); await shot('desktop-dark.png');

    // The inset at other widths.
    const insets = {1440: layout.southTaiwan};
    for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]]) {
      await page.setViewportSize({width: w, height: h}); await load();
      layout = await originLayout(); assert(layout.ok, 'Origin labels ' + w + ': ' + layout.problems.join());
      assert(await fits(), 'No horizontal scroll ' + w);
      insets[w] = layout.southTaiwan; await shot('inset-' + w + '.png');
    }

    // Phone.
    await page.setViewportSize({width: 390, height: 844});
    for (const theme of ['light', 'dark']) {
      await load(theme);
      assert(await fits(), 'Mobile ' + theme + ' no horizontal scroll');
      layout = await originLayout(); assert(layout.ok, 'Mobile ' + theme + ' origin labels: ' + layout.problems.join());
      await shot('mobile-' + theme + '.png');
    }
    insets[390] = layout.southTaiwan; assert(layout.labels === 6 && layout.southTaiwan[1] >= 130, 'Six Taiwan ports and mobile inset size');
    await load('light', '#company=' + slugOf(company.name));
    assert(await fits(), 'Mobile company no horizontal scroll');
    layout = await originLayout(); assert(layout.ok, 'Mobile sheet origin labels');
    const chipClear = await page.evaluate(() => document.querySelector('#company-focus').getBoundingClientRect().bottom <= document.querySelector('.place').getBoundingClientRect().top);
    assert(chipClear, 'Showing chip clears the inset title');
    await shot('mobile-sheet.png');
    await page.locator('.grabber').click();
    assert(await page.locator('.grabber').getAttribute('aria-expanded') === 'true', 'Mobile sheet expands');
    assert(await page.evaluate(() => getComputedStyle(document.querySelector('header')).opacity === '0'), 'Expanded sheet hides clipped header');
    assert(await fits(), 'Expanded mobile sheet no horizontal scroll');
    await shot('mobile-sheet-expanded.png');
    await page.locator('.grabber').click();
    assert(await page.locator('.grabber').getAttribute('aria-expanded') === 'false', 'Mobile sheet collapses');
    await page.locator('#panel [data-close]').click();
    assert(await page.locator('#panel').isHidden(), 'Mobile sheet closes');
    await page.locator('#download-data').click(); assert(await page.locator('#downloads').isVisible(), 'Mobile Download dialog');
    await shot('mobile-download-dialog.png');

    // Copy: no em dash anywhere in rendered text, labels or generated SVG.
    const copy = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('[aria-label],[title],text')].map((n) => (n.getAttribute('aria-label') || '') + (n.getAttribute('title') || '') + n.textContent).join(' ') + document.head.innerHTML);
    assert(!copy.includes('\u2014'), 'No em dashes');
    assert(await page.evaluate(() => [...document.querySelectorAll('path')].every((n) => !(n.getAttribute('d') || '').includes('NaN'))), 'Valid map geometry');
    // Text and focus ring contrast against background and panel colors.
    const contrast = await page.evaluate(() => {
      function l(h) { const s = h.trim().slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return s[0] * 0.2126 + s[1] * 0.7152 + s[2] * 0.0722; }
      const result = {};
      for (const t of ['light', 'dark']) {
        document.documentElement.dataset.theme = t; const s = getComputedStyle(document.documentElement); result[t] = {};
        for (const bg of ['--bg', '--panel']) for (const ink of ['--ink', '--muted', '--control-focus', '--flow', '--origin-line']) {
          const a = l(s.getPropertyValue(bg)), b = l(s.getPropertyValue(ink)); result[t][ink + ' on ' + bg] = +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
        }
      }
      return result;
    });
    assert(Object.values(contrast).every((v) => Object.entries(v).every(([key, n]) => n >= ((key.includes('focus') || key.includes('flow') || key.includes('origin')) ? 3 : 4.5))), 'WCAG text and control focus contrast');

    // Motion on: flow marks animate unless the user pauses them.
    const moving = await browser.newPage({viewport: {width: 1440, height: 900}, reducedMotion: 'no-preference'});
    moving.on('pageerror', (e) => errors.push(String(e)));
    await moving.goto(base + '/?theme=light');
    await moving.waitForFunction(() => document.querySelectorAll('.state').length === 51);
    await moving.waitForTimeout(2600);
    assert(await moving.evaluate(() => document.getAnimations().some((a) => a.playState === 'running')), 'Flow motion runs without reduced motion');
    await moving.locator('#flow-motion').click();
    assert(await moving.evaluate(() => document.getAnimations().every((a) => a.playState !== 'running')), 'Pause motion');
    await moving.close();

    assert(errors.length === 0, 'Zero console or network errors');
    const report = {checkedAt: new Date().toISOString(), fixture: data.fixture, assetVersion: version, records: data.projects.length,
      checks: Object.keys(checks), screenshots, consoleErrors: errors, southTaiwanInsetPx: insets, contrast, viewports: [[1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844]]};
    fs.writeFileSync(path.join(out, 'verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({passed: report.checks.length, screenshots: screenshots.length, southTaiwanInsetPx: insets, errors}, null, 2));
  } finally { await browser.close(); }
})().catch((e) => { console.error(e.message || e); if (errors.length) console.error(errors); process.exitCode = 1; });
