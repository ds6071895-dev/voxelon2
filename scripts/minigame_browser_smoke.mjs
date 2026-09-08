// Optional end-to-end check against a disposable production server.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TEST_URL=http://localhost:18080 node scripts/minigame_browser_smoke.mjs
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE??'/tmp/voxelon-browser/node_modules/playwright/index.mjs').href);
const url=process.env.TEST_URL??'http://127.0.0.1:18080';
const artifacts=process.env.TEST_ARTIFACTS??'/tmp/voxelon-browser/artifacts';await mkdir(artifacts,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const errors=new Set();
async function client(){
  const context=await browser.newContext({viewport:{width:1280,height:800}});
  await context.addInitScript(({url})=>{
    localStorage.setItem('voxelon.tutorialSeen','1');
    const Native=window.WebSocket;window.__messages=[];window.__sent=[];window.__latest={};window.__ws=null;
    window.WebSocket=class extends Native{
      constructor(_url,protocols){super(url.replace(/^http/,'ws'),protocols);window.__ws=this;
        this.addEventListener('message',e=>{try{const m=JSON.parse(e.data);window.__latest[m.t]=m;window.__messages.push(m);if(window.__messages.length>500)window.__messages.shift();}catch{}});
      }
      send(data){try{window.__sent.push(JSON.parse(data));if(window.__sent.length>500)window.__sent.shift();}catch{}super.send(data);}
    };
  },{url});
  const page=await context.newPage();page.on('pageerror',e=>errors.add(e.stack));
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__ws?.readyState===1,undefined,{timeout:60000});
  await page.locator('#auth-pass').fill('BrowserTest123!');await page.locator('#submit-btn').click();
  await page.waitForFunction(()=>window.__latest.welcome,undefined,{timeout:60000});
  await page.locator('#minigames-btn').click();return page;
}
const send=(page,msg)=>page.evaluate(msg=>window.__ws.send(JSON.stringify(msg)),msg);
try{
  const a=await client(),b=await client();console.log('Two browser clients registered.');
  await a.screenshot({path:`${artifacts}/menu.png`});
  await a.locator('#parkour-card-action').click();await b.locator('#parkour-card-action').click();
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__latest.partyLobby?.snapshot.phase==='running',undefined,{timeout:90000})));
  const s=await a.evaluate(()=>window.__latest.partyLobby.snapshot),other=await b.evaluate(()=>window.__latest.partyLobby.snapshot);
  if(s.arena.seed!==other.arena.seed||s.round.endsAt!==other.round.endsAt)throw Error('Race state disagrees');
  console.log('Parkour: same course and start clock in both browsers.');
  await a.screenshot({path:`${artifacts}/parkour.png`});
  await a.bringToFront();await a.locator('canvas').first().click({position:{x:640,y:400},force:true});
  const before=await a.evaluate(()=>window.__sent.filter(m=>m.t==='xform').at(-1));
  await a.keyboard.down('w');await a.keyboard.down('Control');await a.waitForTimeout(600);await a.keyboard.up('w');await a.keyboard.up('Control');
  const after=await a.evaluate(()=>window.__sent.filter(m=>m.t==='xform').at(-1));
  if(!after||Math.hypot(after.x-before.x,after.z-before.z)<.2)throw Error('Keyboard movement did not reach server');
  await a.keyboard.press('Escape');await a.locator('#quit-btn').click({timeout:10000});
  await a.waitForFunction(()=>window.__latest.arenaRestored,undefined,{timeout:10000});
  await a.locator('#parkour-card-action').click();await a.waitForFunction(()=>window.__latest.partyQueue?.queued,undefined,{timeout:10000});
  await b.locator('.pg-result-actions button').first().click({timeout:10000});
  await Promise.all([a,b].map(p=>p.waitForFunction(seed=>window.__latest.partyLobby?.snapshot.phase==='running'&&window.__latest.partyLobby.snapshot.arena.seed!==seed,s.arena.seed,{timeout:90000})));
  const next=await a.evaluate(()=>window.__latest.partyLobby.snapshot.arena.seed);
  if(next%8===s.arena.seed%8)throw Error('Consecutive theme repeated');
  console.log('Parkour: Quit, Play again, new route and different theme passed.');
  await a.screenshot({path:`${artifacts}/parkour-next-theme.png`});
  await send(a,{t:'partyLeave'});await send(b,{t:'partyLeave'});await a.waitForTimeout(1200);
  await a.locator('#party-card-action').click();await b.locator('#party-card-action').click();
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>window.__latest.partyLobby?.snapshot.phase==='running'&&window.__latest.partyLobby.snapshot.mode==='bridge',undefined,{timeout:90000})));
  const bridge=await a.evaluate(()=>window.__latest.partyLobby.snapshot);
  const sides=new Set(bridge.participants.map(p=>p.team));
  if(sides.size!==2)throw Error('The Bridge did not pick two sides');
  if(bridge.teamScores.join()!=='0,0')throw Error('The Bridge did not kick off level');
  console.log('The Bridge matchmaking: two sides, scoreline',bridge.teamScores.join(' - '));
  await a.screenshot({path:`${artifacts}/bridge.png`});
  await send(a,{t:'partyLeave'});await send(b,{t:'partyLeave'});await a.waitForTimeout(1200);
  // Private invitation, visible ready/start controls and capacity are separate from quick play.
  await a.locator('#party-private-action').click();
  await a.locator('.pg-invite-link').waitFor();
  const token=await a.evaluate(()=>window.__latest.partyLobby.inviteToken);
  await send(b,{t:'partyJoin',token});
  await Promise.all([a,b].map(p=>p.locator('.pg-lobby').getByRole('button',{name:'Ready up',exact:true}).click()));
  await a.locator('.pg-lobby').getByRole('button',{name:'Start match',exact:true}).click();
  await a.waitForFunction(()=>window.__latest.partyLobby?.snapshot.phase==='running',undefined,{timeout:90000});
  if((await a.evaluate(()=>window.__latest.partyLobby.snapshot.capacity))!==2)throw Error('Private capacity');
  console.log('Private Bridge lobby: invite, ready and host start passed.');
  await send(a,{t:'partyLeave'});await send(b,{t:'partyLeave'});await a.waitForTimeout(1200);
  await a.locator('#duels-card-action').click();await b.locator('#duels-card-action').click();
  await a.waitForFunction(()=>window.__latest.duelLobby?.snapshot.phase==='running',undefined,{timeout:90000});
  await a.bringToFront();await a.keyboard.press('Escape');
  // A background tab may already be paused; either way the real exit is clickable.
  await a.locator('#quit-btn').click({timeout:10000});
  await a.locator('#duels-card-action').click();
  await a.waitForFunction(()=>window.__latest.duelQueue?.queued,undefined,{timeout:10000});
  console.log('Duels: exit and Play queues again.');
  if(errors.size)throw Error([...errors].join('\n'));
  console.log('Browser smoke passed with no JavaScript errors.');
}finally{await browser.close();}
