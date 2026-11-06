// Build time downloads only. Exact package versions are pinned.
import fs from 'node:fs';
import vm from 'node:vm';
const root = new URL('../', import.meta.url);
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('vendor/topojson-client.min.js', root), 'utf8'), ctx);
const sources = {
  states: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json',
  taiwan: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-50m.json',
};
async function get(url) { const r = await fetch(url); if (!r.ok) throw Error(url + ': ' + r.status); return r.json(); }
const us = await get(sources.states), world = await get(sources.taiwan);
const features = ctx.topojson.feature(world, world.objects.countries).features;
const taiwan = features.find(f => +f.id === 158);
if (!taiwan) throw Error('Missing Taiwan geography');
// Keep main island and Penghu. Offshore Kinmen/Matsu are outside this inset.
if (taiwan.geometry.type === 'MultiPolygon') taiwan.geometry.coordinates = taiwan.geometry.coordinates.filter(p => p.flat().some(c => c[0] > 119.2 && c[1] < 25.5));
fs.writeFileSync(new URL('js/atlas.js',root),'// Offline geography. '+JSON.stringify(sources)+'\nwindow.US_ATLAS = '+JSON.stringify(us)+';\nwindow.TAIWAN_SOUTH = '+JSON.stringify(taiwan)+';\n');
console.log('Bundled U.S. states and Taiwan main island / Penghu.');
