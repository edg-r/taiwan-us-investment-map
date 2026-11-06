#!/usr/bin/env python3
"""Build the offline map from the research ledger. Python 3 standard library only."""
import argparse, csv, hashlib, json, math, sys
from datetime import date
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
AS_OF = '2026-11-05'
SCHEMA = 'id,investor_type,firm_group,firm,taiwanese_parent,origin_city_taiwan,origin_county_taiwan,state_code,state_name,city,latitude,longitude,project_name,sector,amount_usd_million,amount_qualifier,amount_basis,transaction_value_usd_million,announcement_date,status,status_as_of,status_source_url,record_kind,route_kind,ownership_scope,allocation_note,taiwanese_investor_commitment_usd_million,taiwanese_investor_commitment_note,financing_origin_verified,source_url,source_title,source_publisher,source_date,origin_source_url,evidence_summary'.split(',')
NUMERIC = ['latitude','longitude','amount_usd_million','transaction_value_usd_million','taiwanese_investor_commitment_usd_million','financing_origin_verified']
BASIS = {'announced_project_total':'announced','completed_project_total':'completed','acquisition_price':'acquisition','equity_investment':'equity','loan_financing':'loan','undisclosed':'undisclosed'}
STATUSES = {'announced','under_construction','operating','completed','delayed','paused','downsized','cancelled','sold','closed subsequently','unknown'}
# Representative corporate cities, not a claim about the origin of financing.
CITIES = {'Taipei':[121.5654,25.033],'New Taipei':[121.4628,25.012],'Keelung':[121.739,25.128],'Xizhi':[121.655,25.061],'Tucheng':[121.443,24.972],'Neihu':[121.589,25.069],'Taoyuan':[121.301,24.994],'Hsinchu':[120.965,24.814],'Taichung':[120.674,24.148],'Changhua':[120.544,24.075],'Tainan':[120.227,22.999],'Kaohsiung':[120.301,22.627],'Pingtung':[120.488,22.669]}
PORTS = {'Taipei/New Taipei':[121.5654,25.033],'Taoyuan':[121.301,24.994],'Hsinchu':[120.965,24.814],'Taichung':[120.674,24.148],'Tainan':[120.227,22.999],'Kaohsiung':[120.301,22.627]}
def port_for(city):
    for names,port in [('Taoyuan','Taoyuan'),('Hsinchu','Hsinchu'),('Taichung Changhua Dacun','Taichung'),('Tainan','Tainan'),('Kaohsiung Pingtung','Kaohsiung')]:
        if any(n.lower() in city.lower() for n in names.split()): return port
    return 'Taipei/New Taipei'
def number(v):
    if v in ('',None): return None
    n=float(v)
    if not math.isfinite(n): raise ValueError('Nonfinite amount or coordinate')
    return int(n) if n.is_integer() else n
def subtotal(rows):
    values=[r['amount_usd_million'] for r in rows if r['amount_usd_million'] is not None]
    # fsum plus rounding keeps state, type and overall subtotals reconcilable at ledger scale.
    return round(math.fsum(values),4) if values else None

def read_ledger(path):
    with path.open(encoding='utf-8-sig',newline='') as f:
        reader=csv.DictReader(f)
        if reader.fieldnames != SCHEMA: raise ValueError('Ledger header must match the documented schema and order')
        rows=list(reader)
    if not rows: raise ValueError('Empty ledger')
    ids=set(); states={s['code']:s['name'] for s in json.loads((ROOT/'scripts/states.json').read_text())}
    for r in rows:
        if None in r or None in r.values(): raise ValueError('Malformed CSV row')
        if not r['id'] or r['id'] in ids: raise ValueError('Missing or duplicate id: '+r['id'])
        ids.add(r['id'])
        if r['investor_type'] not in ('firm','government'): raise ValueError('Invalid investor_type: '+r['id'])
        if r['state_code'] != 'US' and states.get(r['state_code']) != r['state_name']: raise ValueError('State code/name mismatch: '+r['id'])
        if r['amount_basis'] not in BASIS or r['status'] not in STATUSES: raise ValueError('Invalid basis/status: '+r['id'])
        for key in NUMERIC: r[key]=number(r[key])
        for key in NUMERIC[2:5]:
            if r[key] is not None and r[key] < 0: raise ValueError('Negative monetary amount: '+r['id'])
        if r['status']=='cancelled' and r['amount_usd_million'] is not None: raise ValueError('Cancelled records require a null amount: '+r['id'])
        if r['amount_basis']=='undisclosed' and r['amount_usd_million'] is not None: raise ValueError('Undisclosed basis requires null amount: '+r['id'])
        if (r['latitude'] is None)!=(r['longitude'] is None): raise ValueError('Partial coordinate: '+r['id'])
        if r['latitude'] is not None and not (-90<=r['latitude']<=90 and -180<=r['longitude']<=180): raise ValueError('Coordinate out of range')
        if r['financing_origin_verified'] not in (None,0,1): raise ValueError('Invalid verification flag')
        for key in ('announcement_date','status_as_of','source_date'):
            if r[key]: date.fromisoformat(r[key])
    return rows

def summarize(rows):
    priced=sum(r['amount_usd_million'] is not None for r in rows)
    result={'total':subtotal(rows),'records':len(rows),'priced':priced,'unpriced':len(rows)-priced}
    for basis,key in BASIS.items(): result[key]=subtotal([r for r in rows if r['amount_basis']==basis])
    return result

def build(path):
    rows=read_ledger(path)
    state_rows=[r for r in rows if r['state_code']!='US']
    national=[r for r in rows if r['state_code']=='US']
    states=json.loads((ROOT/'scripts/states.json').read_text())
    for s in states:
        own=[r for r in state_rows if r['state_code']==s['code']]
        s.update(summarize(own))
        s['byType']={t:summarize([r for r in own if r['investor_type']==t]) for t in ('firm','government')}
    projects=[]
    for r in rows:
        city=r['origin_city_taiwan']; port=port_for(city)
        origin=next((v for k,v in CITIES.items() if k.lower() in city.lower()),PORTS[port])
        national_record=r['state_code']=='US'
        p={'id':r['id'],'investorType':r['investor_type'],'firmGroup':r['firm_group'] or r['firm'],'firm':r['firm'],'parent':r['taiwanese_parent'],'origin':origin,'originLabel':city or 'Taiwan (HQ city not documented)','originProvince':r['origin_county_taiwan'],'originRegion':port,'state':r['state_code'],'city':r['city'],'dest':None if national_record or r['latitude'] is None else [r['longitude'],r['latitude']],'destKind':'city' if r['latitude'] is not None else 'state','project':r['project_name'],'sector':r['sector'],'amount':r['amount_usd_million'],'qualifier':r['amount_qualifier'],'basis':r['amount_basis'],'allocated':not national_record and r['amount_usd_million'] is not None,'national':national_record,'transactionValue':r['transaction_value_usd_million'],'investorCommitment':r['taiwanese_investor_commitment_usd_million'],'investorCommitmentNote':r['taiwanese_investor_commitment_note'],'allocationNote':r['allocation_note'],'ownershipScope':r['ownership_scope'],'year':r['announcement_date'][:4],'status':r['status'],'statusAsOf':r['status_as_of'],'statusSourceUrl':r['status_source_url'],'recordKind':r['record_kind'],'route':r['route_kind'],'sourceUrl':r['source_url'],'sourceTitle':r['source_title'],'sourcePublisher':r['source_publisher'],'sourceDate':r['source_date'],'originSourceUrl':r['origin_source_url'],'evidence':r['evidence_summary']}
        projects.append(p)
    total=subtotal(state_rows)
    assert math.isclose(math.fsum(s['total'] or 0 for s in states),total or 0,abs_tol=1e-3)
    data={'asOf':AS_OF,'fixture':path.resolve()==(ROOT/'scripts/fixture-ledger.csv').resolve(),'ledgerSha256':hashlib.sha256(path.read_bytes()).hexdigest(),'total':total,'totals':{'overall':total,**{t:subtotal([r for r in state_rows if r['investor_type']==t]) for t in ('firm','government')}},'nationalTotals':{t:subtotal([r for r in national if r['investor_type']==t]) for t in ('firm','government')},'quantifiedStates':sum(s['total'] is not None for s in states),'unquantifiedStates':sum(s['total'] is None for s in states),'states':states,'projects':projects,'nationalRecords':[p for p in projects if p['national']],'ports':PORTS}
    (ROOT/'js/data.js').write_text('// Generated by scripts/build_data.py. Null is not zero.\nwindow.MAP_DATA = '+json.dumps(data,ensure_ascii=False,separators=(',',':'))+';\n')
    print(json.dumps({'records':len(rows),'national_records':len(national),'state_total_usd_million':total,'by_type':data['totals'],'fixture':data['fixture']}))
    return data
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__); ap.add_argument('--ledger',required=True,type=Path)
    try: build(ap.parse_args().ledger)
    except (ValueError,KeyError) as e: sys.exit('BUILD FAILED: '+str(e))
