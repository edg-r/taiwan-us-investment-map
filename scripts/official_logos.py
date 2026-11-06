"""Refresh selected trimmed PNG marks from official company websites, after download_logos.py. Bora and PharmaEssentia provenance retains their exact separately fetched source URLs."""
import sys,json,io
from pathlib import Path
from PIL import Image,ImageChops
sys.path.insert(0,str(Path(__file__).parent))
from download_logos import get,slug,write_readme
ROOT=Path(__file__).resolve().parents[1]
SOURCES={
'Cathay Financial / Cathay Life':('https://www.cathayholdings.com/en/holdings/intro/intro/about','https://www.cathayholdings.com/holdings/web/img/common/logo.png'),
'GlobalWafers':('https://www.sas-globalwafers.com/','https://www.sas-globalwafers.com/wp-content/uploads/2019/11/logo-1.png'),
'ASE':('https://www.aseglobal.com/','https://cdn.prod.website-files.com/6a4c7cf038139cd8999ff317/6a4c7cf038139cd8999ff343_ASE_logo.png'),
'Lotus Pharmaceutical':('https://www.lotuspharm.com/','https://api.lotuspharm.com/storage/site/01KAWVCV72Q3H0K0K5DVEJJWQP.png')}
provenance=json.loads((ROOT/'logos/provenance.json').read_text())
ready=json.loads((ROOT/'js/logos.js').read_text().split(' = ')[1].rstrip(';\n'))
for name,(site,url) in SOURCES.items():
 try:
  im=Image.open(io.BytesIO(get(url))).convert('RGBA'); white=Image.new('RGBA',im.size,'white');white.alpha_composite(im)
  box=ImageChops.difference(white.convert('RGB'),Image.new('RGB',im.size,'white')).convert('L').point(lambda v:255 if v>18 else 0).getbbox()
  if box: im=im.crop(box)
  im.thumbnail((520,260)); file=slug(name)+'.png';im.save(ROOT/'logos'/file);ready[slug(name)]=file
  provenance=[p for p in provenance if p['company']!=name]
  provenance.append(dict(company=name,file=file,commons=site,source=url,license='Official trademark; rights reserved',license_url=site,artist=name,credit=site,changes='White or transparent padding trimmed; resized proportionally.'))
  print(name,'saved')
 except Exception as e:print(name,e)
(ROOT/'logos/provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
(ROOT/'js/logos.js').write_text('window.COMPANY_LOGOS = '+json.dumps(ready,sort_keys=True)+';\n')
write_readme(provenance,json.loads((ROOT/'scripts/logo_sources.json').read_text()))
