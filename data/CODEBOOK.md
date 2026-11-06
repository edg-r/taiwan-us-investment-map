# Codebook

## Title

Taiwanese investment in U.S. states, 2014 to November 2026

## Coverage

76 records, including 8 national records; 51 states including DC. As of 2026-11-05. 

## State subtotal

293544.225 USD millions. Includes only state_allocated = 1. National amounts are never counted.

## Investor types

firm = commercial corporate investor; government = public institution, public lender, sovereign fund or national framework. Classification follows the ledger; it does not verify financing origin.

## National records

state_code US, state_fips null, state_allocated 0, null geometry. Retained in every records format. National frameworks and corporate pledges may overlap state projects or each other; do not sum them into state totals. A national amount is not counted in state totals.

## Interpretation

Not foreign direct investment (FDI) stock, annual flows, cumulative spending or verified transfers from Taiwan. Monetary bases differ. Announced commitments do not establish actual spending. Null is not zero. Cancelled records have null amounts. The Taiwanese investor share is separately recorded and is never additive.

## Sources

Source URLs and evidence are retained verbatim. Selected documented records, not a complete census. Read allocation_note and evidence_summary before aggregation.

## Geography

States: us-atlas@3.0.1 states-10m, U.S. Census / Natural Earth. EPSG:4326. Original ledger coordinates are approximate; missing points remain null. National rows always have null geometry. Map origin inset: Natural Earth via world-atlas@2.0.2 countries-50m, Taiwan main island and Penghu; Kinmen and Matsu excluded from the inset frame.

## Formats

UTF-8 CSV, Excel with Records/States/Codebook/README, Stata release 118 (Stata 14+) and GeoPackage layers states/projects. String categories retain their labels, including investor_type. Stata dates are daily dates. Leading-zero state_fips remain strings; blank for national rows. Stata names over 32 characters use the documented aliases; other formats retain the ledger names.

## Citation

Agunias, E. (2026). Taiwanese investment in U.S. states, 2014 to November 2026 [Data set]. https://edg-r.github.io/taiwan-us-investment-map/

## License

Data compilation: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/. Company marks and source materials retain their rights.

## Reproduce

Activate the documented scratch virtual environment, then: python3 -I scripts/build_data.py --ledger PATH && python3 -I scripts/export_dataset.py --ledger PATH. No network access during data or export builds. Rebuild geography separately with node scripts/build_atlas.mjs.

## Release reconciliation

76 audited records, eight national records, 17 states with a subtotal. Firms: 289144.225 USD million; government: 4400 USD million; documented state subtotal: 293544.225 USD million. TSMC Arizona: 265000 USD million, 90.28 percent of the subtotal.

## Categories

Investor type: firm; government.

Amount basis: announced_project_total, completed_project_total, acquisition_price, equity_investment, loan_financing, undisclosed.

Status: announced, cancelled, closed subsequently, completed, delayed, downsized, operating, paused, sold, under_construction, unknown.

National amounts are not counted in state totals. All monetary fields use nominal USD millions. Missing values remain blank or null, including type totals with no priced records.

## Records variables

| Variable | Stata name | Type | Units | Definition |
|---|---|---|---|---|
| id | id | string | none | Unique, stable source ledger record identifier. |
| investor_type | investor_type | string | none | firm = commercial corporate investor; government = public institution, public lender, sovereign fund or national framework. Classification follows the ledger; it does not verify financing origin. |
| firm_group | firm_group | string | none | Group used by the map for company selection; a joint venture is counted once. |
| firm | firm | string | none | Named investing entity, U.S. affiliate, target or joint venture. |
| taiwanese_parent | taiwanese_parent | string | none | Taiwanese parent or investors named by the source. |
| origin_city_taiwan | origin_city_taiwan | string | none | Original Taiwanese headquarters city from the ledger. Retained independently of merged map ports. |
| origin_county_taiwan | origin_county_taiwan | string | none | County or municipality of the original headquarters city. |
| state_code | state_code | string | none | U.S. postal code including DC; US means national and unallocated, never part of a state total. |
| state_name | state_name | string | none | State name; United States for national records. |
| city | city | string | none | U.S. destination city, when known. |
| latitude | latitude | numeric | degrees, EPSG:4326 | Ledger latitude in EPSG:4326; null for national records. Not a surveyed facility position. |
| longitude | longitude | numeric | degrees, EPSG:4326 | Ledger longitude in EPSG:4326; null for national records. |
| project_name | project_name | string | none | Project, transaction, presence or framework title. |
| sector | sector | string | none | Descriptive sector, not a standardized classification. |
| amount_usd_million | amount_usd_million | numeric | USD million, nominal | Nominal documented amount. Sum only rows with state_allocated = 1 for the state subtotal. National amounts are separate, may overlap projects, and must not be added. Null is not zero. |
| amount_qualifier | amount_qualifier | string | none | Reported, approximate or lower bound qualification supplied by the source. |
| amount_basis | amount_basis | string | none | announced_project_total, completed_project_total, acquisition_price, equity_investment, loan_financing or undisclosed. Different valuation concepts must be interpreted with care. |
| transaction_value_usd_million | transaction_value_usd_million | numeric | USD million, nominal | Whole transaction value, if reported. Not additive to the documented amount. |
| announcement_date | announcement_date | ISO date | none | Announcement or event date, YYYY-MM-DD, when known. |
| status | status | string | none | Status as of the ledger cutoff. Cancelled records require a null documented amount. |
| status_as_of | status_as_of | ISO date | none | Date the current project status was established. |
| status_source_url | status_source_url | string | none | Evidence supporting the current status. |
| record_kind | record_kind | string | none | Nature of the record: project, transaction, framework or presence. |
| route_kind | route_kind | string | none | Meaning of the displayed geographic link. A headquarters link does not establish state spending. |
| ownership_scope | ownership_scope | string | none | Ownership and joint venture scope needed to interpret the amount. |
| allocation_note | allocation_note | string | none | Geographic allocation, overlap and valuation limitations. Read before aggregation. |
| taiwanese_investor_commitment_usd_million | investor_commitment_usd_million | numeric | USD million, nominal | Separately disclosed Taiwanese investor share. Not an additional amount. Stata alias: investor_commitment_usd_million. |
| taiwanese_investor_commitment_note | investor_commitment_note | string | none | Scope of the Taiwanese investor share. Stata alias: investor_commitment_note. |
| financing_origin_verified | financing_origin_verified | numeric | none | 0 = no, 1 = yes, null = unresolved. Taiwanese headquarters alone do not verify financing origin. |
| source_url | source_url | string | none | Primary supporting source URL. |
| source_title | source_title | string | none | Title of the primary supporting source. |
| source_publisher | source_publisher | string | none | Issuing company, authority or publisher. |
| source_date | source_date | ISO date | none | Publication date of the primary source. |
| origin_source_url | origin_source_url | string | none | Evidence supporting the headquarters origin. |
| evidence_summary | evidence_summary | string | none | Record-level evidence and limitations. |
| state_fips | state_fips | string | none | Two-character Federal Information Processing Standards code with leading zero. Null for US national records. |
| state_allocated | state_allocated | numeric | none | 1 only for a nonmissing amount allocated to a state. 0 for national and undisclosed records. |
| dest_kind | dest_kind | string | none | city or state for mapped records; national for US records. |
| origin_longitude | origin_longitude | numeric | degrees, EPSG:4326 | Representative corporate origin longitude; may be the regional fallback, never a verified source of funds. |
| origin_latitude | origin_latitude | numeric | degrees, EPSG:4326 | Representative corporate origin latitude. |
| as_of | as_of | ISO date | none | Research cutoff, 2026-11-05. |

## States variables

| Variable | Stata name | Type | Units | Definition |
|---|---|---|---|---|
| state_fips | state_fips | string | none | Two-character Federal Information Processing Standards code with leading zero. Null for US national records. |
| state_code | state_code | string | none | U.S. postal code including DC; US means national and unallocated, never part of a state total. |
| state_name | state_name | string | none | State name; United States for national records. |
| documented_total_usd_million | documented_total_usd_million | numeric | USD million, nominal | State subtotal of nonmissing, state allocated amounts across both investor types. Null means no documented total. |
| firm_total_usd_million | firm_total_usd_million | numeric | USD million, nominal | State subtotal for firm investors only; null if no priced firm records. |
| government_total_usd_million | government_total_usd_million | numeric | USD million, nominal | State subtotal for government investors only; null if no priced government records. |
| announced_usd_million | announced_usd_million | numeric | USD million, nominal | State subtotal with announced monetary basis; null when this component is absent. |
| completed_usd_million | completed_usd_million | numeric | USD million, nominal | State subtotal with completed monetary basis; null when this component is absent. |
| acquisition_usd_million | acquisition_usd_million | numeric | USD million, nominal | State subtotal with acquisition monetary basis; null when this component is absent. |
| equity_usd_million | equity_usd_million | numeric | USD million, nominal | State subtotal with equity monetary basis; null when this component is absent. |
| loan_usd_million | loan_usd_million | numeric | USD million, nominal | State subtotal with loan monetary basis; null when this component is absent. |
| undisclosed_usd_million | undisclosed_usd_million | numeric | USD million, nominal | State subtotal with undisclosed monetary basis; null when this component is absent. |
| record_count | record_count | numeric | none | Number of records assigned to the state, including undisclosed and cancelled records. |
| priced_record_count | priced_record_count | numeric | none | Number of records with a nonmissing state amount. |
| unpriced_record_count | unpriced_record_count | numeric | none | Number of records with a missing state amount. |
| no_state_total | no_state_total | numeric | none | 1 if state subtotal is null, 0 otherwise. No record does not mean zero investment. |
| as_of | as_of | ISO date | none | Research cutoff, 2026-11-05. |

## Geometry repairs

[
  {
    "state_code": "DE",
    "reason": "Too few points in geometry component[-75.5603153637536 39.630063805328]",
    "method": "make_valid, polygon components only",
    "area_change_square_degrees": -1.1102230246251565e-16
  },
  {
    "state_code": "OR",
    "reason": "Ring Self-intersection[-119.999364290343 41.9950551335413]",
    "method": "make_valid, polygon components only",
    "area_change_square_degrees": -1.4210854715202004e-14
  }
]
