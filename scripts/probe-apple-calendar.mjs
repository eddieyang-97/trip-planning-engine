import {createServer} from 'node:http';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {networkInterfaces} from 'node:os';
import assert from 'node:assert/strict';

// Standalone transport probe. Does not load the app, accounts or trip database.
const args=process.argv.slice(2);
if(args.some(arg=>!['--serve','--lan'].includes(arg))||args.includes('--lan')&&!args.includes('--serve')){
  console.error('Usage: node scripts/probe-apple-calendar.mjs [--serve [--lan]]');
  process.exit(1);
}
const events=[
  ['BEGIN:VEVENT','UID:calendar-probe-meeting-v1@trip-planning.example',
    'DTSTAMP:20261014T120000Z','DTSTART:20261015T090000Z','DTEND:20261015T093000Z',
    'SUMMARY:TEST - calendar handoff','LOCATION:London - fictional test',
    'DESCRIPTION:Fictional test. Expected 15 Oct 2026 at 10:00-10:30 London.',
    'TRANSP:TRANSPARENT','END:VEVENT'],
  ['BEGIN:VEVENT','UID:calendar-probe-flight-v1@trip-planning.example',
    'DTSTAMP:20261014T120000Z','DTSTART:20261015T092000Z','DTEND:20261015T110000Z',
    'SUMMARY:TEST - London to Zurich flight','LOCATION:LGW to ZRH - fictional',
    'DESCRIPTION:Fictional flight. Departs 10:20 London\\, arrives 13:00 Zurich.',
    'TRANSP:TRANSPARENT','END:VEVENT'],
  ['BEGIN:VEVENT','UID:calendar-probe-stay-v1@trip-planning.example',
    'DTSTAMP:20261014T120000Z','DTSTART;VALUE=DATE:20261015',
    'DTEND;VALUE=DATE:20261017','SUMMARY:TEST - two-night hotel stay',
    'LOCATION:Zurich - fictional test hotel',
    'DESCRIPTION:Fictional stay. Nights 15 and 16 Oct. Checkout 17 Oct 2026.',
    'TRANSP:TRANSPARENT','END:VEVENT'],
];
function calendar(rows){return ['BEGIN:VCALENDAR','VERSION:2.0',
  'PRODID:-//Trip Planning//Apple Calendar Probe//EN','CALSCALE:GREGORIAN',
  'X-WR-CALNAME:Trip Planning TEST',...rows.flat(),'END:VCALENDAR',''].join('\r\n');}
const single=calendar([events[0]]),multiple=calendar(events);
for(const [body,count] of [[single,1],[multiple,3]]){
  assert.equal((body.match(/BEGIN:VEVENT/g)||[]).length,count);
  assert.equal((body.match(/END:VEVENT/g)||[]).length,count);
  assert.ok(body.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!body.replaceAll('\r\n','').includes('\n'));
  for(const line of body.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
}
assert.ok(multiple.includes('DTSTART:20261015T092000Z\r\nDTEND:20261015T110000Z'));
assert.ok(multiple.includes('DTEND;VALUE=DATE:20261017'));
const directory=resolve('.data/apple-calendar-probe');await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'single.ics'),single);
await writeFile(resolve(directory,'multiple.ics'),multiple);
console.log(`Generated and checked fictional .ics fixtures in ${directory}`);
if(!args.includes('--serve'))process.exit(0);

const page=`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apple Calendar test</title><style>
body{font:17px/1.6 system-ui,sans-serif;max-width:660px;margin:40px auto;padding:0 22px;color:#183b35;background:#fafbf7}
a{display:block;margin:12px 0;padding:12px 16px;border:1px solid #8dada2;border-radius:8px;color:#183b35;text-decoration:none}
small{display:block}li{margin-bottom:10px}h1{line-height:1.2}
</style></head><body><h1>Apple Calendar test</h1>
<p>Fictional events only. First create a calendar named <strong>Trip Planning TEST</strong> in Apple Calendar and choose it for imports.</p>
<h2>1. Open a calendar file</h2>
<a href="/single.ics">Open one event <small>15 October 2026, 10:00-10:30 London time</small></a>
<a href="/multiple.ics">Open three events <small>Meeting, flight and two-night hotel stay</small></a>
<p>Record whether this offers Add/Add All, only previews the file, or downloads it.</p>
<h2>2. Compare a forced download</h2>
<a href="/single.ics?download=1">Download one event</a>
<a href="/multiple.ics?download=1">Download three events</a>
<p>On Mac, open the file with Calendar or use File &gt; Import. On iPhone, record whether opening the download offers an import action.</p>
<h2>3. Optional subscription test</h2>
<a href="webcal://CALENDAR_PROBE_HOST/multiple.ics">Subscribe to the test calendar</a>
<p>This tests a separate read-only calendar feed. It does not prove that events can be imported into your own editable calendar. This local feed stops working when the probe server stops.</p>
<h2>Check the imported events</h2><ul>
<li>Single file: one meeting. Multi-event file: three events.</li>
<li>Meeting: 15 October, 10:00-10:30 London (09:00-09:30 UTC).</li>
<li>Flight: 15 October, 10:20 London departure and 13:00 Zurich arrival (09:20-11:00 UTC). Calendar displays these in its configured time zone.</li>
<li>Hotel: all day on 15 and 16 October; checkout on 17 October. It should not occupy the night of 17 October.</li>
</ul><p>Use a fresh test calendar for each import attempt to keep counts clear. Delete test calendars afterwards. No alerts, invitations or real bookings are included.</p>
</body></html>`;
const port=3091,host=args.includes('--lan')?'0.0.0.0':'127.0.0.1';
const server=createServer((req,res)=>{
  const url=new URL(req.url||'/','http://localhost');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
  let body;
  if(url.pathname==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    // Only a validated local authority is reflected into the subscription link.
    const authority=req.headers.host||`127.0.0.1:${port}`;
    if(!/^[a-zA-Z0-9.:-]+$/.test(authority)){res.writeHead(400);res.end();return;}
    body=page.replace('CALENDAR_PROBE_HOST',authority);
  }else if(url.pathname==='/single.ics'||url.pathname==='/multiple.ics'){
    res.setHeader('Content-Type','text/calendar; charset=utf-8');
    const filename=url.pathname.slice(1);
    res.setHeader('Content-Disposition',`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename="${filename}"`);
    body=filename==='single.ics'?single:multiple;
  }else{res.writeHead(404);res.end();return;}
  res.writeHead(200);res.end(req.method==='HEAD'?undefined:body);
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(port,host,()=>{
  console.log(`Probe page: http://127.0.0.1:${port}/`);
  if(args.includes('--lan'))for(const addresses of Object.values(networkInterfaces()))for(const address of addresses||[]){
    if(address.family==='IPv4'&&!address.internal)console.log(`Same-network candidate: http://${address.address}:${port}/`);
  }
});
process.on('SIGINT',()=>server.close());
process.on('SIGTERM',()=>server.close());
