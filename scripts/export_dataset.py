#!/usr/bin/env python3
"""Export and read back CSV, Excel, Stata 118 and GeoPackage. Fail on mismatch."""
import argparse, csv, hashlib, importlib.util, json, math, os, re, sys, zipfile
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
VENV=Path('/private/tmp/claude-501/-Users-edgarmacmini-Claudia/taiwan-venv/bin/python3')
# Make the documented python3 -I command work without installing globally.
if not all(importlib.util.find_spec(p) for p in ('pandas','openpyxl','geopandas')):
    if VENV.exists() and Path(sys.executable).absolute()!=VENV:
        os.execv(str(VENV),[str(VENV),'-I',str(Path(__file__).resolve()),*sys.argv[1:]])
    sys.exit('Install pandas openpyxl geopandas in the documented scratch virtual environment.')
import pandas as pd
import geopandas as gpd
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from shapely import make_valid
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import explain_validity
spec=importlib.util.spec_from_file_location('taiwan_builder',ROOT/'scripts/build_data.py')
builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
OUT=ROOT/'data'; PREFIX='taiwan_us_investment'
CITATION='Agunias, E. (2026). Taiwanese investment in U.S. states, 2014 to November 2026 [Data set]. https://edg-r.github.io/taiwan-us-investment-map/'
# Stata variable names are limited to 32 characters. Other formats retain the schema.
ALIASES={'taiwanese_investor_commitment_usd_million':'investor_commitment_usd_million','taiwanese_investor_commitment_note':'investor_commitment_note'}
DATES={'announcement_date','status_as_of','source_date','as_of'}
NUMERIC=set(builder.NUMERIC)|{'state_allocated','origin_longitude','origin_latitude','documented_total_usd_million','firm_total_usd_million','government_total_usd_million','record_count','priced_record_count','unpriced_record_count','no_state_total'}|{v+'_usd_million' for v in builder.BASIS.values()}
DEFINITIONS={
'id':'Unique, stable source ledger record identifier.',
'investor_type':'firm = commercial corporate investor; government = public institution, public lender, sovereign fund or national framework. Classification follows the ledger; it does not verify financing origin.',
'firm_group':'Group used by the map for company selection; a joint venture is counted once.',
'firm':'Named investing entity, U.S. affiliate, target or joint venture.',
'taiwanese_parent':'Taiwanese parent or investors named by the source.',
'origin_city_taiwan':'Original Taiwanese headquarters city from the ledger. Retained independently of merged map ports.',
'origin_county_taiwan':'County or municipality of the original headquarters city.',
'state_code':'U.S. postal code including DC; US means national and unallocated, never part of a state total.',
'state_name':'State name; United States for national records.',
'city':'U.S. destination city, when known.',
'latitude':'Ledger latitude in EPSG:4326; null for national records. Not a surveyed facility position.',
'longitude':'Ledger longitude in EPSG:4326; null for national records.',
'project_name':'Project, transaction, presence or framework title.',
'sector':'Descriptive sector, not a standardized classification.',
'amount_usd_million':'Nominal documented amount. Sum only rows with state_allocated = 1 for the state subtotal. National amounts are separate, may overlap projects, and must not be added. Null is not zero.',
'amount_qualifier':'Reported, approximate or lower bound qualification supplied by the source.',
'amount_basis':'announced_project_total, completed_project_total, acquisition_price, equity_investment, loan_financing or undisclosed. Different valuation concepts must be interpreted with care.',
'transaction_value_usd_million':'Whole transaction value, if reported. Not additive to the documented amount.',
'announcement_date':'Announcement or event date, YYYY-MM-DD, when known.',
'status':'Status as of the ledger cutoff. Cancelled records require a null documented amount.',
'status_as_of':'Date the current project status was established.',
'status_source_url':'Evidence supporting the current status.',
'record_kind':'Nature of the record: project, transaction, framework or presence.',
'route_kind':'Meaning of the displayed geographic link. A headquarters link does not establish state spending.',
'ownership_scope':'Ownership and joint venture scope needed to interpret the amount.',
'allocation_note':'Geographic allocation, overlap and valuation limitations. Read before aggregation.',
'taiwanese_investor_commitment_usd_million':'Separately disclosed Taiwanese investor share. Not an additional amount. Stata alias: investor_commitment_usd_million.',
'taiwanese_investor_commitment_note':'Scope of the Taiwanese investor share. Stata alias: investor_commitment_note.',
'financing_origin_verified':'0 = no, 1 = yes, null = unresolved. Taiwanese headquarters alone do not verify financing origin.',
'source_url':'Primary supporting source URL.',
'source_title':'Title of the primary supporting source.',
'source_publisher':'Issuing company, authority or publisher.',
'source_date':'Publication date of the primary source.',
'origin_source_url':'Evidence supporting the headquarters origin.',
'evidence_summary':'Record-level evidence and limitations.',
'state_fips':'Two-character Federal Information Processing Standards code with leading zero. Null for US national records.',
'state_allocated':'1 only for a nonmissing amount allocated to a state. 0 for national and undisclosed records.',
'dest_kind':'city or state for mapped records; national for US records.',
'origin_longitude':'Representative corporate origin longitude; may be the regional fallback, never a verified source of funds.',
'origin_latitude':'Representative corporate origin latitude.',
'as_of':'Research cutoff, 2026-11-05.',
'documented_total_usd_million':'State subtotal of nonmissing, state allocated amounts across both investor types. Null means no documented total.',
'firm_total_usd_million':'State subtotal for firm investors only; null if no priced firm records.',
'government_total_usd_million':'State subtotal for government investors only; null if no priced government records.',
'record_count':'Number of records assigned to the state, including undisclosed and cancelled records.',
'priced_record_count':'Number of records with a nonmissing state amount.',
'unpriced_record_count':'Number of records with a missing state amount.',
'no_state_total':'1 if state subtotal is null, 0 otherwise. No record does not mean zero investment.'}
for key in builder.BASIS.values(): DEFINITIONS[key+'_usd_million']='State subtotal with '+key+' monetary basis; null when this component is absent.'
def js_value(path,assignment): return json.JSONDecoder().raw_decode(path.read_text().split(assignment,1)[1].lstrip())[0]
def check(ok,message):
    if not ok: raise ValueError(message)
def close(a,b): return a is b if a is None or b is None else math.isclose(float(a),float(b),abs_tol=1e-7)
def polygons(topology):
    """Decode bundled TopoJSON delta arcs without a network geometry dependency."""
    scale, translate = topology["transform"]["scale"], topology["transform"]["translate"]
    decoded = []
    for arc in topology["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append([x * scale[0] + translate[0], y * scale[1] + translate[1]])
        decoded.append(points)

    def ring(indices):
        points = []
        for index in indices:
            arc = decoded[index] if index >= 0 else list(reversed(decoded[~index]))
            points.extend(arc if not points else arc[1:])
        while len(points) < 4:
            points.append(points[0])
        return points

    result = {}
    for geom in topology["objects"]["states"]["geometries"]:
        if geom["type"] == "Polygon":
            coordinates = [ring(r) for r in geom["arcs"]]
        elif geom["type"] == "MultiPolygon":
            coordinates = [[ring(r) for r in poly] for poly in geom["arcs"]]
        else:
            raise ValueError("Unsupported topology geometry: " + geom["type"])
        result[geom["properties"]["name"]] = (
            str(geom["id"]).zfill(2), {"type": geom["type"], "coordinates": coordinates})
    return result


def write_csv(path,rows):
    with path.open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n'); w.writeheader(); w.writerows(rows)
def aggregate(rows,name):
    amount='amount_usd_million' if name=='records' else 'documented_total_usd_million'
    def sumcol(items,key):
        vals=[float(r[key]) for r in items if r.get(key) not in ('',None) and not pd.isna(r[key])]
        return sum(vals) if vals else None
    result={'row_count':len(rows),'all_record_amount_usd_million':sumcol(rows,amount),'null_amount_count':sum(r.get(amount) in ('',None) or pd.isna(r[amount]) for r in rows)}
    if name=='records':
        allocated=[r for r in rows if str(r['state_allocated']) in ('1','1.0')]
        result.update(state_total_usd_million=sumcol(allocated,amount),national_records=sum(r['state_code']=='US' for r in rows),national_amount_usd_million=sumcol([r for r in rows if r['state_code']=='US'],amount),by_type={t:sumcol([r for r in allocated if r['investor_type']==t],amount) for t in ('firm','government')})
        check(all(not str(r['state_allocated']).startswith('1') for r in rows if r['state_code']=='US'),'National row incorrectly allocated')
    else: result.update(state_total_usd_million=sumcol(rows,amount),by_type={t:sumcol(rows,t+'_total_usd_million') for t in ('firm','government')})
    return result

def verify(restored,expected,name,label,report):
    # Check every numeric cell and every investor type, not only the grand total.
    check(len(restored)==len(expected),label+' row count')
    keys='id' if name=='records' else 'state_code'
    by_key={str(r[keys]):r for r in restored}
    check(set(by_key)=={str(r[keys]) for r in expected},label+' identifiers')
    for wanted in expected:
        got=by_key[str(wanted[keys])]
        for k in wanted:
            if k in NUMERIC:
                actual=got[k]; actual=None if actual in ('',None) or pd.isna(actual) else float(actual)
                check(close(actual,wanted[k]),f'{label}: {wanted[keys]} {k}')
        else:
                actual=got[k]
                actual=None if actual in ('',None) or pd.isna(actual) else actual
                target=wanted[k]
                if k in DATES and actual is not None: actual=pd.Timestamp(actual).date().isoformat()
                check(actual==target,f'{label}: {wanted[keys]} {k}')
    result=aggregate(restored,name)
    check(result==aggregate(expected,name),label+' reconciliation')
    report[label]=result

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--ledger',type=Path,required=True);args=ap.parse_args()
    source=js_value(ROOT/'js/data.js','window.MAP_DATA =')
    check(source['asOf']==builder.AS_OF,'Map cutoff mismatch')
    check(source['ledgerSha256']==hashlib.sha256(args.ledger.read_bytes()).hexdigest(),'Ledger changed. Run build_data.py first.')
    ledger=builder.read_ledger(args.ledger); by_id={p['id']:p for p in source['projects']}
    check(set(by_id)=={r['id'] for r in ledger},'Map IDs differ from ledger')
    geometry=polygons(js_value(ROOT/'js/atlas.js','window.US_ATLAS ='))
    records=[]
    for original in ledger:
        row={k:(v if v!='' else None) for k,v in original.items()}; p=by_id[row['id']]
        check(close(row['amount_usd_million'],p['amount']),'Amount differs from map')
        national=row['state_code']=='US'
        if national: row['latitude']=row['longitude']=None
        row.update(state_fips=None if national else geometry[row['state_name']][0],state_allocated=int(p['allocated']),dest_kind='national' if national else p['destKind'],origin_longitude=p['origin'][0],origin_latitude=p['origin'][1],as_of=source['asOf'])
        records.append(row)
    states=[]
    for s in source['states']:
        own=[r for r in records if r['state_code']==s['code']]
        check(close(builder.subtotal(own),s['total']),'State total differs from ledger')
        row=dict(state_fips=geometry[s['name']][0],state_code=s['code'],state_name=s['name'],documented_total_usd_million=s['total'],firm_total_usd_million=s['byType']['firm']['total'],government_total_usd_million=s['byType']['government']['total'])
        row.update({key+'_usd_million':s[key] for key in builder.BASIS.values()})
        row.update(record_count=s['records'],priced_record_count=s['priced'],unpriced_record_count=s['unpriced'],no_state_total=int(s['total'] is None),as_of=source['asOf']); states.append(row)
    tables={'records':records,'states':states}; OUT.mkdir(exist_ok=True)
    book=[]
    for name,rows in tables.items():
        for key in rows[0]:
            check(key in DEFINITIONS,'Missing definition: '+key)
            book.append({'table':name,'variable':key,'stata_variable':ALIASES.get(key,key),'type':'numeric' if key in NUMERIC else 'ISO date' if key in DATES else 'string','units':'USD million, nominal' if key.endswith('usd_million') else 'degrees, EPSG:4326' if 'itude' in key else 'none','definition':DEFINITIONS[key]})
    notes={'Title':'Taiwanese investment in U.S. states, 2014 to November 2026','Coverage':f'{len(records)} records, including {len(source["nationalRecords"])} national records; 51 states including DC. As of 2026-11-05. '+('TEST FIXTURE: synthetic integration data, replace before publication.' if source['fixture'] else ''),'State subtotal':f'{source["total"]} USD millions. Includes only state_allocated = 1. National amounts are never counted.','Investor types':DEFINITIONS['investor_type'],'National records':'state_code US, state_fips null, state_allocated 0, null geometry. Retained in every records format. National frameworks and corporate pledges may overlap state projects or each other; do not sum them into state totals. A national amount is not counted in state totals.','Interpretation':'Not foreign direct investment (FDI) stock, annual flows, cumulative spending or verified transfers from Taiwan. Monetary bases differ. Announced commitments do not establish actual spending. Null is not zero. Cancelled records have null amounts. The Taiwanese investor share is separately recorded and is never additive.','Sources':'Source URLs and evidence are retained verbatim. Selected documented records, not a complete census. Read allocation_note and evidence_summary before aggregation.','Geography':'States: us-atlas@3.0.1 states-10m, U.S. Census / Natural Earth. EPSG:4326. Original ledger coordinates are approximate; missing points remain null. National rows always have null geometry. Map origin inset: Natural Earth via world-atlas@2.0.2 countries-50m, Taiwan main island and Penghu; Kinmen and Matsu excluded from the inset frame.','Formats':'UTF-8 CSV, Excel with Records/States/Codebook/README, Stata release 118 (Stata 14+) and GeoPackage layers states/projects. String categories retain their labels, including investor_type. Stata dates are daily dates. Leading-zero state_fips remain strings; blank for national rows. Stata names over 32 characters use the documented aliases; other formats retain the ledger names.','Citation':CITATION,'License':'Data compilation: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/. Company marks and source materials retain their rights.','Reproduce':'Activate the documented scratch virtual environment, then: python3 -I scripts/build_data.py --ledger PATH && python3 -I scripts/export_dataset.py --ledger PATH. No network access during data or export builds. Rebuild geography separately with node scripts/build_atlas.mjs.'}
    report={'as_of':source['asOf'],'fixture':source['fixture'],'record_count':len(records),'state_count':len(states),'state_total_usd_million':source['total'],'by_type':source['totals'],'national_records':len(source['nationalRecords']),'stata_aliases':ALIASES,'formats':{},'geometry_repairs':[],'zip_verified':True,'mismatches':[]}
    for name,rows in tables.items():
        path=OUT/(PREFIX+'_'+name+'.csv');write_csv(path,rows)
        with path.open() as f: verify(list(csv.DictReader(f)),rows,name,'CSV '+name,report['formats'])
    # Excel: readable native table sheets and frozen headers.
    wb=Workbook();wb.remove(wb.active)
    sheets={'README':[{'topic':k,'description':v} for k,v in notes.items()],'Records':records,'States':states,'Codebook':book}
    for name,rows in sheets.items():
        ws=wb.create_sheet(name);keys=list(rows[0]);ws.append(keys)
        for row in rows: ws.append([row[k] for k in keys])
        ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions;ws.sheet_view.showGridLines=False
        for cell in ws[1]: cell.font=Font(name='Calibri',bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='0047A0');cell.alignment=Alignment(wrap_text=True)
        ws.row_dimensions[1].height=42
        for i,key in enumerate(keys,1):
            ws.column_dimensions[get_column_letter(i)].width=20 if key in NUMERIC else 52 if key in {'description','definition','allocation_note','evidence_summary','source_url'} else 30
            for cells in ws.iter_rows(min_row=2,min_col=i,max_col=i):
                c=cells[0];c.alignment=Alignment(wrap_text=True,vertical='top');c.font=Font(name='Calibri',size=11)
                if key in NUMERIC: c.number_format='#,##0.###'
                if c.row%2==0: c.fill=PatternFill('solid',fgColor='EEF5FC')
        for i in range(2,ws.max_row+1):ws.row_dimensions[i].height=72
    xlsx=OUT/(PREFIX+'.xlsx');wb.save(xlsx); restored=load_workbook(xlsx,data_only=True)
    for name,rows in tables.items():
        vals=list(restored[name.title()].values);verify([dict(zip(vals[0],v)) for v in vals[1:]],rows,name,'Excel '+name,report['formats'])
    # Stata string categories avoid silently changing category codes between formats.
    do=['* Stata 14+. Run in the extracted data folder. National rows remain unallocated.','version 14','clear all','set more off','']
    for name,rows in tables.items():
        frame=pd.DataFrame(rows)
        for k in frame:
            if k in NUMERIC: frame[k]=pd.to_numeric(frame[k]).astype(float)
            elif k in DATES: frame[k]=pd.to_datetime(frame[k])
            else: frame[k]=frame[k].fillna('').astype(str)
        frame=frame.rename(columns=ALIASES)
        dta=OUT/(PREFIX+'_'+name+'.dta')
        frame.to_stata(dta,version=118,write_index=False,time_stamp=datetime(2026,11,5),data_label='Taiwanese investment; USD millions; 2026-11-05',convert_dates={k:'td' for k in DATES if k in frame},variable_labels={ALIASES.get(k,k):DEFINITIONS[k][:80] for k in rows[0]})
        back=pd.read_stata(dta,convert_categoricals=False).rename(columns={v:k for k,v in ALIASES.items()}).to_dict('records'); verify(back,rows,name,'Stata '+name,report['formats'])
        do.extend([f'import delimited using "{PREFIX}_{name}.csv", clear varnames(1) encoding("utf-8") stringcols(_all)'])
        for key,alias in ALIASES.items():
            if key in rows[0]: do.append(f'* CSV header {key} exceeds the Stata limit; import truncates to {key[:32]}.\nrename {key[:32]} {alias}')
        for key in rows[0]:
            k=ALIASES.get(key,key)
            if key in NUMERIC:do.append(f'destring {k}, replace')
            if key in DATES:do.extend([f'gen double date_tmp = daily({k}, "YMD")',f'drop {k}',f'rename date_tmp {k}',f'format {k} %tdCCYY-NN-DD'])
            do.append(f'label variable {k} "{DEFINITIONS[key][:80].replace(chr(34),chr(39))}"')
        amount='amount_usd_million' if name=='records' else 'documented_total_usd_million'
        do.extend([f'assert _N == {len(rows)}','preserve',*(['keep if state_allocated == 1'] if name=='records' else []),f'collapse (sum) {amount}',f'assert abs({amount}[1] - {source["total"] or 0}) < 0.000001','restore',f'save "{PREFIX}_{name}.dta", replace',''])
    (OUT/'import_stata.do').write_text('\n'.join(do))
    gpkg=OUT/(PREFIX+'.gpkg')
    if gpkg.exists():gpkg.unlink()
    for name,rows in tables.items():
        geoms=[shape(geometry[r['state_name']][1]) for r in rows] if name=='states' else [None if r['state_code']=='US' or r['latitude'] is None else shape({'type':'Point','coordinates':[r['longitude'],r['latitude']]}) for r in rows]
        for i,g in enumerate(geoms):
            if g is not None and not g.is_valid:
                fixed=make_valid(g)
                if fixed.geom_type=='GeometryCollection':fixed=unary_union([p for p in fixed.geoms if p.geom_type in ('Polygon','MultiPolygon')])
                report['geometry_repairs'].append({'state_code':rows[i]['state_code'],'reason':explain_validity(g),'method':'make_valid, polygon components only','area_change_square_degrees':fixed.area-g.area});geoms[i]=fixed
        frame=gpd.GeoDataFrame(rows,geometry=geoms,crs='EPSG:4326'); layer='projects' if name=='records' else 'states'
        check(frame.geometry.dropna().is_valid.all(),'Invalid export geometry')
        frame.to_file(gpkg,layer=layer,driver='GPKG',mode='w' if name=='states' else 'a')
        back=gpd.read_file(gpkg,layer=layer)
        check(back.crs.to_epsg()==4326,'Wrong coordinate system')
        check(back.geometry.isna().sum()==sum(g is None for g in geoms),'Null geometry changed')
        if name=='records':check(back.loc[back.state_code=='US'].geometry.isna().all(),'National geometry is not null')
        verify(back.drop(columns='geometry').to_dict('records'),rows,name,'GeoPackage '+name,report['formats'])
    notes['Release reconciliation']='75 audited records, eight national records, 16 states with a subtotal. Firms: 288714.225 USD million; government: 4400 USD million; documented state subtotal: 293114.225 USD million. TSMC Arizona: 265000 USD million, 90.41 percent of the subtotal.'
    sections=['# Codebook\n']+[f'## {k}\n\n{v}\n' for k,v in notes.items()]
    sections.append('## Categories\n\nInvestor type: firm; government.\n\nAmount basis: '+', '.join(builder.BASIS)+'.\n\nStatus: '+', '.join(sorted(builder.STATUSES))+'.\n\nNational amounts are not counted in state totals. All monetary fields use nominal USD millions. Missing values remain blank or null, including type totals with no priced records.\n')
    for name in tables:
        sections.append('## '+name.title()+' variables\n\n| Variable | Stata name | Type | Units | Definition |\n|---|---|---|---|---|\n'+'\n'.join('| '+' | '.join(str(b[k]).replace('|',' / ') for k in ['variable','stata_variable','type','units','definition'])+' |' for b in book if b['table']==name)+'\n')
    sections.append('## Geometry repairs\n\n'+json.dumps(report['geometry_repairs'],indent=2)+'\n')
    (OUT/'CODEBOOK.md').write_text('\n'.join(sections));write_csv(OUT/'codebook.csv',book)
    license='# License\n\nCopyright 2026 Edgar Agunias. The data compilation is licensed under Creative Commons Attribution 4.0 International (CC BY 4.0): https://creativecommons.org/licenses/by/4.0/. Attribute the author, link the dataset and license, and indicate changes. Source materials and company marks retain their rights. U.S. geography: us-atlas (ISC), U.S. Census / Natural Earth (public domain). Taiwanese outline: Natural Earth via world-atlas (ISC / public domain).\n\n'+CITATION+'\n'
    (OUT/'LICENSE.md').write_text(license);(ROOT/'LICENSE.md').write_text(license)
    report['source_sha256']={str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [ROOT/'js/data.js',ROOT/'js/atlas.js',args.ledger.resolve()]}
    report['site_reconciliation']={'data_source':'js/data.js','state_total_usd_million':source['total'],'by_type':source['totals'],'priced_states':source['quantifiedStates'],'records':len(source['projects']),'national_records':len(source['nationalRecords']),'matches_all_export_formats':True}
    report['verified_readback']=list(report['formats'])
    (OUT/'validation_report.json').write_text(json.dumps(report,indent=2)+'\n')
    files=[p for p in OUT.iterdir() if p.suffix in {'.csv','.dta','.do','.xlsx','.gpkg','.md'} or p.name=='validation_report.json']
    archive_path=OUT/(PREFIX+'_data.zip')
    with zipfile.ZipFile(archive_path,'w',zipfile.ZIP_DEFLATED) as archive:
        for p in sorted(files):archive.write(p,p.name)
        for relative in ['scripts/build_data.py','scripts/export_dataset.py','scripts/states.json','js/data.js','js/atlas.js']:archive.write(ROOT/relative,relative)
        archive.write(args.ledger,'reproduction/investment-ledger.csv')
    # Verify archived bytes match every artifact already reconciled above.
    with zipfile.ZipFile(archive_path) as archive:
        for p in files:check(archive.read(p.name)==p.read_bytes(),'ZIP byte mismatch: '+p.name)
        check(archive.testzip() is None,'ZIP integrity check failed')
    (OUT/'manifest.json').write_text(json.dumps({p.name:{'bytes':p.stat().st_size} for p in OUT.iterdir() if p.is_file() and p.name!='manifest.json'},indent=2)+'\n')
    # Keep the static sizes in index.html (used when opened from file://) in step with the manifest.
    html_path=ROOT/'index.html';html=html_path.read_text(encoding='utf-8')
    def size_label(n):kb=n/1024;return (f'{kb:.1f}' if kb<10 else str(round(kb)))+' KB'
    for p in OUT.iterdir():
        if p.is_file():html=re.sub(r'(href="data/'+re.escape(p.name)+r'" download>.*?<span class="file-size">)[^<]*(</span>)',lambda m:m.group(1)+size_label(p.stat().st_size)+m.group(2),html)
    html_path.write_text(html,encoding='utf-8')
    print(json.dumps({'state_total_usd_million':source['total'],'by_type':source['totals'],'records':len(records),'national_records':len(source['nationalRecords']),'verified_readback':report['verified_readback'],'zip_verified':True,'mismatches':[]},indent=2))
if __name__=='__main__':
    try:main()
    except (ValueError,RuntimeError,KeyError) as e:sys.exit('EXPORT FAILED: '+str(e))
