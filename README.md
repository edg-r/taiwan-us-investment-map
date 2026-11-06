# Taiwanese investment, by state

Static sibling of the Japan investment map (https://edg-r.github.io/japan-us-investment-map/), with the same design, interactions and data contract. Intended live URL: https://edg-r.github.io/taiwan-us-investment-map/ . This checkout is local only, with no Git remote.

Live site: https://edg-r.github.io/taiwan-us-investment-map/

## Release: 5 November 2026

The audited ledger contains 75 records, including eight national records. Sixteen states have a documented subtotal. State subtotal: $293,114.225 million, comprising firms $288,714.225 million and government $4,400 million. The site displays $293.11 billion, $288.71 billion and $4.40 billion respectively. TSMC Arizona’s $265.00 billion program represents 90.41% of the state subtotal. National records are never summed into it. This is a documented ledger, not foreign direct investment (FDI) stock.


The map uses a plum sequential ramp, with flows and accents in the same family. A hatch means records without a documented state total. Gray means no records. Neither means zero. The six origin ports are Taipei/New Taipei (Keelung, Xizhi, Tucheng, Neihu), Taoyuan, Hsinchu (city and county, including the Science Park), Taichung (including Changhua), Tainan and Kaohsiung (including Pingtung). Record details retain original cities. Labels use measured lanes in geographic order. The inset bundles Taiwan main island and Penghu from country 158 in world-atlas 2.0.2. Kinmen and Matsu are excluded from its frame; no mainland context is drawn.

**All / Firms / Government** sits under the subtotal it changes. It filters every state figure, color, ranking, record list, tooltip, company list and flow. It is a keyboard radiogroup (arrow keys, Home, End). The filter persists in the hash and combines with a company, state or record: `#type=government&company=taipower`, `#company=tsmc`, `#type=firm&state=TX`. National records (`state_code=US`) appear in their own section of the States panel, in company panels and in the About dialog, each shown with its amount and "not counted in state totals" with a Firm or Government badge. They never enter a state subtotal, the choropleth or the flows, and they are never summed.

The States ranking lists every state with records for the active type: states with a total first, by amount, then states with records but no total. States with no records are named once below the table.

## Open locally

```bash
python3 -m http.server 8768
```

Open http://127.0.0.1:8768 . Plain JavaScript files and bundled geography also allow opening index.html directly. There is no runtime geography request or application dependency installation.

The design follows the Japan map: layer modes, top-ten state labels with leader lines (top three on phones), hover and arrow-key tooltips, a detail panel that refits the map, States and Companies tabs with search, sorting and `#company=` deep links, a hover or keyboard preview of a company's states, a Showing chip, light and dark themes, flow animation with replay and a pause control, reduced-motion support (no animation at all), a draggable mobile bottom sheet that dims the page when expanded, source links, a Data & sources dialog with About and Download tabs, and copy citation. Number formats: billions always have two decimals ($17.10B, $41.04 billion); under $1 billion stays in millions, preserving a second decimal near the unit boundary and otherwise using one decimal only when needed ($250M, $13.8 million).

## Rebuild with the real research ledger

The data builder uses the Python 3 standard library only. The exporter uses pandas, openpyxl and geopandas in an isolated environment, which it uses automatically if the invoked python3 lacks them:

```bash
python3 -m venv /private/tmp/claude-501/-Users-edgarmacmini-Claudia/taiwan-venv
/private/tmp/claude-501/-Users-edgarmacmini-Claudia/taiwan-venv/bin/python3 -m pip install pandas openpyxl geopandas pillow
```

To rebuild the audited release, run these from this folder:

```bash
LEDGER=/Users/edgarmacmini/Claudia/_claudia/outputs/taiwan-us-investment-tracing/investment-ledger.csv
python3 -I scripts/build_data.py --ledger "$LEDGER"        # js/data.js; fails on any schema or value error
python3 -I scripts/export_dataset.py --ledger "$LEDGER"    # data/ downloads, read back and verified; updates sizes in index.html
python3 -I scripts/verify_data.py                          # builder rejects bad ledgers
sed -i '' 's/?v=20261105real2/?v=NEWTOKEN/g' index.html        # bump the cache token (any new string)
python3 -m http.server 8768 &
node scripts/verify_site.cjs http://127.0.0.1:8768         # screenshots and checks in .qa/
node scripts/render_share.cjs http://127.0.0.1:8768        # share.png from the real page
```

Then look at the screenshots in `.qa/`. The exporter also refreshes `data/manifest.json` and the static download sizes in `index.html`. Edit the Open Graph description by hand if the final totals deserve a mention.



The input header is defined in `scripts/build_data.py`. The builder rejects duplicate IDs, malformed rows, invalid investor types, amount bases and statuses, nonnumeric or negative amounts, invalid or partial coordinates, nonnull cancelled amounts and state code/name mismatches. All amounts are nominal U.S. dollars in millions. Empty amounts remain null, including missing type subtotals and basis components. Subtotals use `math.fsum` and are rounded to four decimals, so state, type and overall totals reconcile at ledger scale. A separately reported Taiwanese investor commitment is retained but is not added to the project total.

`window.MAP_DATA` contains the research cutoff (2026-11-05), state subtotal overall and by investor type, states with per-type totals and basis components, all project records, a separate nationalRecords list and the port coordinates. National amounts may overlap state projects or other frameworks. Never add them to state totals or assume they form a mutually exclusive national subtotal.

The inherited interaction suite is rerun against the audited Taiwan ledger at desktop, tablet and phone widths.

## Research exports

`data/` contains UTF-8 Records and States CSV, Excel, Stata release 118 (.dta, Stata 14+), `import_stata.do`, GeoPackage, codebook, license, ZIP and validation report. The ZIP includes the source ledger and offline rebuild inputs. Downloads retain all investor types regardless of the active map filter.

The records table retains `investor_type`. National rows retain `state_code=US`, blank `state_fips`, `state_allocated=0` and null geometry. The States table includes `documented_total_usd_million`, `firm_total_usd_million`, `government_total_usd_million` and each monetary basis. The Stata format has a 32-character variable-name limit, so its Taiwanese commitment fields use `investor_commitment_usd_million` and `investor_commitment_note`. Other formats retain the ledger field names. The codebook gives this mapping.

Exports fail if the ledger hash differs from the last map build. Each CSV, Excel sheet, Stata table and GeoPackage layer is read back. Verification checks identifiers, numeric cells, nulls, investor types, state totals and national exclusion. The ZIP is checked against those verified artifacts byte for byte. `data/validation_report.json` records totals by format, type and allocation scope, checksums and geometry repairs. National totals and all-record totals are reported separately for reconciliation, not as additive investment measures.

The original quantized U.S. shapes require two small polygon repairs for the GeoPackage. They are logged. The map retains the original topology.

## Geography and logos

```bash
node scripts/build_atlas.mjs
/private/tmp/claude-501/-Users-edgarmacmini-Claudia/taiwan-venv/bin/python3 scripts/download_logos.py
```

These are optional build-time network operations. Geography is pinned to `us-atlas@3.0.1/states-10m.json` and `world-atlas@2.0.2/countries-50m.json`, downloaded from cdn.jsdelivr.net. The site loads only bundled geometry. Natural Earth supplies the Taiwan main island and Penghu outline.

Company marks come from Wikimedia Commons and official company websites. `logos/README.md` and `logos/provenance.json` preserve the exact source, license, author and attribution terms; `python3 -I scripts/download_logos.py --readme-only` rewrites the README from provenance without network access. White and transparent padding are trimmed; wide wordmarks get a smaller inset so they fill their box. Unavailable or failed marks use a plum monogram tile. Marks retain their own rights; the compilation license does not relicense them.

## Final visual checks and share image

`node scripts/verify_site.cjs http://127.0.0.1:8768` drives Chrome through the real page (playwright-core from `/Users/edgarmacmini/Claudia/_claudia/tmp/japan-investment-browser/node_modules`, or set `PLAYWRIGHT_CORE_PATH`). It captures 1440×900 and 390×844 in light and dark, the inset at 1280, 1024 and 768, the States tab, Companies search, a company deep link, the Government filter, national records, the keyboard-focus tooltip, the mobile sheet open and expanded, and the About and Download tabs. It asserts formatting, totals by type, flow counts, ranking order, hatch semantics, non-colliding port labels at every width, logo loading, cache tokens, radiogroup keys, reduced motion, contrast, no em dashes, no horizontal scroll at 390 and zero console errors. Results go to `.qa/verification.json`. `.qa/` is gitignored. If Chrome reports connection resets from `http.server` under load, rerun; the standard server has a short listen queue.

`node scripts/render_share.cjs http://127.0.0.1:8768` writes `share.png` (1200×630) from the rendered page. Open Graph and Twitter metadata point to the intended Taiwan URL.

CSS, JavaScript and logo URLs carry `?v=20261105real2`. Change the token in `index.html` only: `js/app.js` (logo URLs) and `js/downloads.js` (manifest) read it from their own script URL.

## Credits and license

Data compilation: [Creative Commons Attribution 4.0 International](LICENSE.md). Source documents and company marks retain their own rights. Geography: U.S. Census / Natural Earth via us-atlas, and Natural Earth via world-atlas. Rendering: D3 and topojson-client. Type: Inter and Newsreader, SIL Open Font License.

Citation: Agunias, E. (2026). Taiwanese investment in U.S. states, 2014 to November 2026 [Data set]. https://edg-r.github.io/taiwan-us-investment-map/

## Taiwan implementation verification

The real release passes 12 ledger validation checks and 72 browser checks with zero console or network errors. Read-back reconciliation verifies Records and States CSV, Excel, Stata and GeoPackage, including investor_type and national exclusion. See data/validation_report.json and .qa/verification.json. The source ledger is read only. No repository was initialized or pushed.

All 21 requested prominent groups have bundled marks with exact ledger group names and provenance. Run `scripts/official_logos.py` after the Commons downloader to refresh official PNG marks. Bora uses the official group mark; PharmaEssentia uses its official reversed mark on a dark tile.
