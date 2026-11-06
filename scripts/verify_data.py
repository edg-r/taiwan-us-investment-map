#!/usr/bin/env python3
"""Exercise ledger validation failures and national/null invariants against the fixture."""
import csv,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('builder',ROOT/'scripts/build_data.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
rows=list(csv.DictReader((ROOT/'scripts/fixture-ledger.csv').open()))
variants={
 'duplicate id':lambda r:r.append(dict(r[0])),
 'nonnumeric amount':lambda r:r[0].update(amount_usd_million='not-a-number'),
 'nonfinite amount':lambda r:r[0].update(amount_usd_million='nan'),
 'negative amount':lambda r:r[0].update(amount_usd_million='-1'),
 'cancelled amount':lambda r:r[0].update(status='cancelled'),
 'invalid investor type':lambda r:r[0].update(investor_type='other'),
 'partial coordinate':lambda r:r[0].update(latitude=''),
 'mismatched state':lambda r:r[0].update(state_name='California'),
}
qa=ROOT/'.qa';qa.mkdir(exist_ok=True)
passed=[]
for name,change in variants.items():
 altered=[dict(r) for r in rows];change(altered)
 with tempfile.NamedTemporaryFile('w',suffix='.csv',dir=qa,newline='') as f:
  w=csv.DictWriter(f,fieldnames=b.SCHEMA);w.writeheader();w.writerows(altered);f.flush()
  try:b.read_ledger(Path(f.name))
  except ValueError:passed.append(name)
  else:raise AssertionError('Accepted invalid ledger: '+name)
valid=b.read_ledger(ROOT/'scripts/fixture-ledger.csv')
state=[r for r in valid if r['state_code']!='US'];national=[r for r in valid if r['state_code']=='US']
assert b.subtotal(state)==153567.6 and len(national)==3
assert b.subtotal([r for r in valid if r['status']=='cancelled']) is None
assert all(r['amount_usd_million'] is None for r in valid if r['status']=='cancelled')
assert b.subtotal([r for r in state if r['investor_type']=='firm'])==146067.6
assert b.subtotal([r for r in state if r['investor_type']=='government'])==7500
passed+=['national exclusion','null not zero','cancelled null','type totals']
(qa/'data-tests.json').write_text(json.dumps({'passed':passed,'failures':[]},indent=2)+'\n')
print('Passed '+str(len(passed))+' ledger validation checks.')
