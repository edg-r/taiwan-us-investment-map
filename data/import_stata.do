* Stata 14+. Run in the extracted data folder. National rows remain unallocated.
version 14
clear all
set more off

import delimited using "taiwan_us_investment_records.csv", clear varnames(1) encoding("utf-8") stringcols(_all)
* CSV header taiwanese_investor_commitment_usd_million exceeds the Stata limit; import truncates to taiwanese_investor_commitment_us.
rename taiwanese_investor_commitment_us investor_commitment_usd_million
* CSV header taiwanese_investor_commitment_note exceeds the Stata limit; import truncates to taiwanese_investor_commitment_no.
rename taiwanese_investor_commitment_no investor_commitment_note
label variable id "Unique, stable source ledger record identifier."
label variable investor_type "firm = commercial corporate investor; government = public institution, public le"
label variable firm_group "Group used by the map for company selection; a joint venture is counted once."
label variable firm "Named investing entity, U.S. affiliate, target or joint venture."
label variable taiwanese_parent "Taiwanese parent or investors named by the source."
label variable origin_city_taiwan "Original Taiwanese headquarters city from the ledger. Retained independently of "
label variable origin_county_taiwan "County or municipality of the original headquarters city."
label variable state_code "U.S. postal code including DC; US means national and unallocated, never part of "
label variable state_name "State name; United States for national records."
label variable city "U.S. destination city, when known."
destring latitude, replace
label variable latitude "Ledger latitude in EPSG:4326; null for national records. Not a surveyed facility"
destring longitude, replace
label variable longitude "Ledger longitude in EPSG:4326; null for national records."
label variable project_name "Project, transaction, presence or framework title."
label variable sector "Descriptive sector, not a standardized classification."
destring amount_usd_million, replace
label variable amount_usd_million "Nominal documented amount. Sum only rows with state_allocated = 1 for the state "
label variable amount_qualifier "Reported, approximate or lower bound qualification supplied by the source."
label variable amount_basis "announced_project_total, completed_project_total, acquisition_price, equity_inve"
destring transaction_value_usd_million, replace
label variable transaction_value_usd_million "Whole transaction value, if reported. Not additive to the documented amount."
gen double date_tmp = daily(announcement_date, "YMD")
drop announcement_date
rename date_tmp announcement_date
format announcement_date %tdCCYY-NN-DD
label variable announcement_date "Announcement or event date, YYYY-MM-DD, when known."
label variable status "Status as of the ledger cutoff. Cancelled records require a null documented amou"
gen double date_tmp = daily(status_as_of, "YMD")
drop status_as_of
rename date_tmp status_as_of
format status_as_of %tdCCYY-NN-DD
label variable status_as_of "Date the current project status was established."
label variable status_source_url "Evidence supporting the current status."
label variable record_kind "Nature of the record: project, transaction, framework or presence."
label variable route_kind "Meaning of the displayed geographic link. A headquarters link does not establish"
label variable ownership_scope "Ownership and joint venture scope needed to interpret the amount."
label variable allocation_note "Geographic allocation, overlap and valuation limitations. Read before aggregatio"
destring investor_commitment_usd_million, replace
label variable investor_commitment_usd_million "Separately disclosed Taiwanese investor share. Not an additional amount. Stata a"
label variable investor_commitment_note "Scope of the Taiwanese investor share. Stata alias: investor_commitment_note."
destring financing_origin_verified, replace
label variable financing_origin_verified "0 = no, 1 = yes, null = unresolved. Taiwanese headquarters alone do not verify f"
label variable source_url "Primary supporting source URL."
label variable source_title "Title of the primary supporting source."
label variable source_publisher "Issuing company, authority or publisher."
gen double date_tmp = daily(source_date, "YMD")
drop source_date
rename date_tmp source_date
format source_date %tdCCYY-NN-DD
label variable source_date "Publication date of the primary source."
label variable origin_source_url "Evidence supporting the headquarters origin."
label variable evidence_summary "Record-level evidence and limitations."
label variable state_fips "Two-character Federal Information Processing Standards code with leading zero. N"
destring state_allocated, replace
label variable state_allocated "1 only for a nonmissing amount allocated to a state. 0 for national and undisclo"
label variable dest_kind "city or state for mapped records; national for US records."
destring origin_longitude, replace
label variable origin_longitude "Representative corporate origin longitude; may be the regional fallback, never a"
destring origin_latitude, replace
label variable origin_latitude "Representative corporate origin latitude."
gen double date_tmp = daily(as_of, "YMD")
drop as_of
rename date_tmp as_of
format as_of %tdCCYY-NN-DD
label variable as_of "Research cutoff, 2026-11-05."
assert _N == 75
preserve
keep if state_allocated == 1
collapse (sum) amount_usd_million
assert abs(amount_usd_million[1] - 293114.225) < 0.000001
restore
save "taiwan_us_investment_records.dta", replace

import delimited using "taiwan_us_investment_states.csv", clear varnames(1) encoding("utf-8") stringcols(_all)
label variable state_fips "Two-character Federal Information Processing Standards code with leading zero. N"
label variable state_code "U.S. postal code including DC; US means national and unallocated, never part of "
label variable state_name "State name; United States for national records."
destring documented_total_usd_million, replace
label variable documented_total_usd_million "State subtotal of nonmissing, state allocated amounts across both investor types"
destring firm_total_usd_million, replace
label variable firm_total_usd_million "State subtotal for firm investors only; null if no priced firm records."
destring government_total_usd_million, replace
label variable government_total_usd_million "State subtotal for government investors only; null if no priced government recor"
destring announced_usd_million, replace
label variable announced_usd_million "State subtotal with announced monetary basis; null when this component is absent"
destring completed_usd_million, replace
label variable completed_usd_million "State subtotal with completed monetary basis; null when this component is absent"
destring acquisition_usd_million, replace
label variable acquisition_usd_million "State subtotal with acquisition monetary basis; null when this component is abse"
destring equity_usd_million, replace
label variable equity_usd_million "State subtotal with equity monetary basis; null when this component is absent."
destring loan_usd_million, replace
label variable loan_usd_million "State subtotal with loan monetary basis; null when this component is absent."
destring undisclosed_usd_million, replace
label variable undisclosed_usd_million "State subtotal with undisclosed monetary basis; null when this component is abse"
destring record_count, replace
label variable record_count "Number of records assigned to the state, including undisclosed and cancelled rec"
destring priced_record_count, replace
label variable priced_record_count "Number of records with a nonmissing state amount."
destring unpriced_record_count, replace
label variable unpriced_record_count "Number of records with a missing state amount."
destring no_state_total, replace
label variable no_state_total "1 if state subtotal is null, 0 otherwise. No record does not mean zero investmen"
gen double date_tmp = daily(as_of, "YMD")
drop as_of
rename date_tmp as_of
format as_of %tdCCYY-NN-DD
label variable as_of "Research cutoff, 2026-11-05."
assert _N == 51
preserve
collapse (sum) documented_total_usd_million
assert abs(documented_total_usd_million[1] - 293114.225) < 0.000001
restore
save "taiwan_us_investment_states.dta", replace
