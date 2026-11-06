#!/usr/bin/env python3
"""Download clearly licensed Commons marks, retain metadata, trim white/alpha padding.
Build-time utility only, requires Pillow in the scratch virtual environment.
"""
import io,json,re,urllib.parse,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
UA='SouthTaiwaneseInvestmentMap/1.0 (educational data visualization; local build)'
def get(url):
    return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=45).read()
def query(params):
    return json.loads(get('https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode({'action':'query','format':'json',**params})))
def slug(s):return re.sub(r'[^a-z0-9]+','-',s.lower()).strip('-')
def main():
    from PIL import Image,ImageChops  # only needed for downloads
    catalog=json.loads((ROOT/'scripts/logo_sources.json').read_text())
    filenames={name:re.sub(r'^File:','',value).split('{{')[0] for name,value in catalog.items()}
    d=query({'titles':'|'.join('File:'+f for f in filenames.values()),'prop':'imageinfo','iiprop':'url|extmetadata','iiurlwidth':500})
    pages={p['title']:p for p in d.get('query',{}).get('pages',{}).values()}
    # MediaWiki normalizes spaces and underscore spellings.
    for n in d.get('query',{}).get('normalized',[]):
        if n['to'] in pages: pages[n['from']]=pages[n['to']]
    ready={};provenance=[]
    for name,f in filenames.items():
        page=pages.get('File:'+f,{})
        info=page.get('imageinfo',[{}])[0];meta=info.get('extmetadata',{})
        license=meta.get('LicenseShortName',{}).get('value','')
        if not info or not license:
            print(name+': no licensed Commons file, using fallback',flush=True);continue
        try:
            url=info.get('thumburl',info['url']).split('?')[0]
            raw=get(url)
            image=Image.open(io.BytesIO(raw)).convert('RGBA')
            # Composite against white before finding the visible mark. Retain alpha.
            white=Image.new('RGBA',image.size,'white');white.alpha_composite(image)
            diff=ImageChops.difference(white.convert('RGB'),Image.new('RGB',image.size,'white')).convert('L').point(lambda v:255 if v>18 else 0)
            box=diff.getbbox()
            if box:image=image.crop(box)
            image.thumbnail((520,260))
            image.save(ROOT/'logos'/(slug(name)+'.png'))
            ready[slug(name)]=slug(name)+'.png'
            provenance.append({'company':name,'file':slug(name)+'.png','commons':info['descriptionurl'],'source':info['url'].split('?')[0],'license':license,'license_url':meta.get('LicenseUrl',{}).get('value',''),'artist':meta.get('Artist',{}).get('value',''),'credit':meta.get('Credit',{}).get('value',''),'changes':'Rasterized from Commons thumbnail when necessary; white or transparent padding trimmed; resized proportionally.'})
            print(name+': '+license,flush=True)
        except Exception as e:print(name+': '+str(e),flush=True)
    (ROOT/'js/logos.js').write_text('window.COMPANY_LOGOS = '+json.dumps(ready,sort_keys=True)+';\n')
    (ROOT/'logos/provenance.json').write_text(json.dumps(provenance,indent=2,ensure_ascii=False)+'\n')
    write_readme(provenance,catalog)

def strip_html(v):
    t=re.sub(r'\s+',' ',re.sub(r'<[^>]+>','',v or '')).replace('&amp;','&').strip()
    half=len(t)//2
    return t[:half] if len(t)%2==0 and t[:half]==t[half:] else t  # Commons repeats some labels

def write_readme(provenance,catalog):
    """Write logos/README.md from provenance.json. Rerun with --readme-only, no network."""
    lines=['# Company marks','',
      'Company marks are trademarks of their owners. The data compilation license (CC BY 4.0) does not relicense them. Files come from Wikimedia Commons or the official company websites linked below, under the terms shown. Full credit and license metadata are in `provenance.json`.','',
      'Changes to every file: rasterized from the Commons thumbnail where the original is SVG, white or transparent padding trimmed, resized proportionally. No mark is recolored or redrawn.','',
      '| Company | File and source | License | Author |','|---|---|---|---|']
    for item in provenance:
        lic=item['license']; url=item.get('license_url')
        lines.append('| '+item['company']+' | ['+item['file']+']('+item['commons']+') | '+('['+lic+']('+url+')' if url else lic)+' | '+strip_html(item.get('artist'))+' |')
    terms=[i for i in provenance if i['license']!='Public domain' and not i['license'].startswith('Official')]
    if terms:
        lines+=['','## Attribution and share-alike terms','']
        for i in terms:
            note={'Attribution':'Attribution-only license: use for any purpose with credit to the copyright holder.',
                  'CC0':'CC0 1.0 public domain dedication by the uploader; credit given as a courtesy.'}.get(i['license'],
                  'The trimmed file is a modified version and is shared under the same license, '+i['license']+'.')
            lines.append('- **'+i['company']+'** (`'+i['file']+'`): '+strip_html(i.get('artist'))+', via Wikimedia Commons. '+note)
    missing=sorted(set(catalog)-{p['company'] for p in provenance})
    lines+=['','## Fallback tiles','',
      'Any company without a file here is shown with a two-letter monogram on a plum tile. This includes companies outside `scripts/logo_sources.json`'+
      (' and these catalog entries without a clearly licensed Commons file: '+', '.join(missing) if missing else '')+'.','']
    (ROOT/'logos/README.md').write_text('\n'.join(lines))

if __name__=='__main__':
    import sys
    if '--readme-only' in sys.argv:
        write_readme(json.loads((ROOT/'logos/provenance.json').read_text()),json.loads((ROOT/'scripts/logo_sources.json').read_text()))
    else: main()
