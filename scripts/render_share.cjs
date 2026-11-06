/* Capture the real site after its final ledger rebuild. No rendering server created here. */
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_CORE_PATH || '/Users/edgarmacmini/Claudia/_claudia/tmp/japan-investment-browser/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true});
  try {
    // Lay out at 1600 × 840 and capture at 0.75 scale: a 1200 × 630 image with the desktop composition.
    const page = await browser.newPage({viewport:{width:1600,height:840},deviceScaleFactor:0.75,reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
    await page.goto((process.argv[2] || 'http://127.0.0.1:8768').replace(/\/$/,'')+'/?theme=light');
    await page.waitForFunction(()=>document.querySelectorAll('.state').length===51 && document.querySelectorAll('.origin').length>0);
    await page.evaluate(()=>document.fonts.ready);
    await page.screenshot({path:path.join(__dirname,'../share.png')});
    if(errors.length) throw Error(errors.join('\n'));
    console.log('Saved share.png, 1200 × 630, from the real rendered site.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
