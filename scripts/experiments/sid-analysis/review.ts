import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const paths = process.argv.slice(2);
if (!paths.length) throw new Error('Usage: node --experimental-strip-types scripts/experiments/sid-analysis/review.ts <report.json> [...]');
const reports: unknown[] = [];
for (const path of paths) {
  const report = JSON.parse(await readFile(path, 'utf8'));
  if (report.schemaVersion !== 1 || report.analysis?.schemaVersion !== 1) throw new Error(`Unsupported report: ${path}`);
  reports.push(report);
}
const encoded = JSON.stringify(reports).replaceAll('<', '\\u003c');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SID analysis — report review</title>
<style>
:root{color-scheme:dark;font:15px/1.5 system-ui,sans-serif;background:#0c0f1d;color:#e9eaf6}
*{box-sizing:border-box}body{margin:0}main{max-width:1150px;margin:auto;padding:30px 24px}
h1{font-size:28px;line-height:1.2;margin:6px 0 12px}h2{font-size:18px;margin:0 0 12px}
p{margin:8px 0}.muted,small{color:#a4acc8}.eyebrow{color:#b2a1ff;font-size:12px;letter-spacing:1px;text-transform:uppercase}
header{display:flex;justify-content:space-between;gap:24px;align-items:center;margin-bottom:22px}
button,select{font:inherit;color:inherit;background:#222a44;border:1px solid #596383;border-radius:6px;padding:8px 12px}
button{cursor:pointer}button:hover,button[aria-pressed=true]{background:#51447b;border-color:#b2a1ff}
:focus-visible{outline:2px solid #6ee0de;outline-offset:3px}select{max-width:340px;width:100%}
section{background:#14192c;border:1px solid #2a324f;border-radius:10px;padding:20px;margin:16px 0}
.facts{display:flex;gap:12px 28px;flex-wrap:wrap}.facts strong{display:block;font-size:22px}.facts small{display:block}
.split{display:grid;grid-template-columns:minmax(230px,1fr) minmax(260px,1.1fr);gap:24px}
#moments{display:grid;gap:6px;max-height:390px;overflow:auto}#moments button{text-align:left;display:flex;gap:15px;align-items:baseline}
#moments time{font-variant-numeric:tabular-nums;color:#6ee0de;min-width:65px}
#detail{padding:16px;background:#101526;border-radius:8px;align-self:start}#detail h3{margin:0 0 10px}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:13px}
th{color:#a4acc8;font-weight:500}td,th{padding:10px 12px;border-bottom:1px solid #2a324f;vertical-align:top}td:first-child{white-space:nowrap;color:#6ee0de}
pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto}
summary{cursor:pointer;color:#b2a1ff}#coverage{color:#6ee0de}#coverage.incomplete{color:#f3c681}
@media(max-width:680px){main{padding:20px 14px}header{display:block}header label{display:block;margin-top:20px}.split{grid-template-columns:1fr}section{padding:14px}h1{font-size:25px}}
</style></head><body><main>
<header><div><div class="eyebrow">SID analysis · headless spike</div><h1 id="title"></h1><p id="profile" class="muted"></p></div><label>Report<br><select id="report"></select></label></header>
<p>Review the output of the Node analyser. These findings come from the JSON report; playback integration is proposed separately.</p>
<section><div class="facts" id="facts"></div><p id="coverage"></p></section>
<section><h2>Changes to inspect</h2><p class="muted">Observed changes, selected by a bounded heuristic. Select a finding to inspect its evidence.</p><div class="split"><div id="moments"></div><div id="detail"></div></div></section>
<section><h2>Voice summaries</h2><p class="muted">Gate time describes a control setting, not audible duration. Waveform times overlap when bits are combined.</p><div class="table-wrap"><table><thead><tr><th>Voice</th><th>Gate on</th><th>Waveform settings</th><th>Pulse-width range</th><th>Writes / changes</th></tr></thead><tbody id="voices"></tbody></table></div></section>
<section><h2>Shared chips and output</h2><div id="chips"></div><p id="output" class="muted"></p></section>
<details><summary>Report provenance and definitions</summary><pre id="provenance"></pre></details>
</main><script type="application/json" id="reports">${encoded}</script><script>
const reports=JSON.parse(document.getElementById('reports').textContent);
const byId=id=>document.getElementById(id);
const text=(id,value)=>byId(id).textContent=value;
const number=value=>value==null?'unavailable':Number(value).toFixed(2);
const seconds=value=>value==null?'unavailable':number(value)+' s';
const time=value=>Math.floor(value/60)+':'+(value%60).toFixed(2).padStart(5,'0');
const subject=moment=>'SID '+(moment.subject.chip+1)+(moment.subject.voice==null?' shared filter':' · Voice '+(moment.subject.voice+1));
const names={'gate':'Gate change','waveform':'Waveform change','modulation':'Modulation change','filter-routing':'Filter routing change'};
function bits(value,choices){return choices.filter(([bit])=>value&bit).map(([,name])=>name).join(' + ')||'none';}
function setting(kind,value){
 if(kind==='gate')return value?'on':'off';
 if(kind==='waveform')return bits(value,[[16,'triangle'],[32,'sawtooth'],[64,'pulse'],[128,'noise']]);
 if(kind==='modulation')return bits(value,[[2,'sync'],[4,'ring'],[8,'test']]);
 return bits(value,[[1,'voice 1'],[2,'voice 2'],[4,'voice 3'],[8,'external input']]);
}
function showMoment(moment,button,definitions){
 byId('moments').querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));
 const heading=document.createElement('h3');heading.textContent=time(moment.timeSeconds)+' · '+names[moment.kind];
 const owner=document.createElement('p');owner.textContent=subject(moment);
 const change=document.createElement('p');change.textContent=setting(moment.kind,moment.before)+' → '+setting(moment.kind,moment.after);
 const evidence=document.createElement('p');evidence.className='muted';evidence.textContent=moment.kind==='waveform'?'Observed waveform settings held for at least '+(definitions.moments.waveformMinimumSeconds*1000)+' ms; brief intermediate settings are omitted from this finding.':'Observed register change. Values: '+moment.before+' → '+moment.after+'.';
 byId('detail').replaceChildren(heading,owner,change,evidence);
}
function render(index){
 const report=reports[index],data=report.analysis,info=data.profile,coverage=data.coverage;
 text('title',info.title||report.input.name);
 text('profile',info.clock+' · '+info.model+' · subtune '+info.subtune+' · '+info.installedSids+' SID'+(info.installedSids>1?'s':''));
 byId('facts').replaceChildren();
 for(const [label,value] of [['Analysed',seconds(coverage.renderedSeconds)],['Findings',data.moments.length],['Scan time',number(report.measurement.wallTimeMs/1000)+' s'],['Worker peak RSS',number(report.measurement.workerPeakRssBytes/1048576)+' MiB']]){
  const fact=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');strong.textContent=value;small.textContent=label;fact.append(strong,small);byId('facts').append(fact);
 }
 text('coverage',coverage.registerStateQuality==='complete'?'Complete register coverage for the requested interval.':'Incomplete register coverage: '+coverage.droppedWrites+' dropped writes; affected metrics are unavailable.');
 byId('coverage').classList.toggle('incomplete',coverage.registerStateQuality!=='complete');
 byId('moments').replaceChildren();byId('detail').replaceChildren();
 for(const moment of data.moments){
  const button=document.createElement('button'),stamp=document.createElement('time'),label=document.createElement('span');
  button.type='button';button.setAttribute('aria-pressed','false');stamp.textContent=time(moment.timeSeconds);label.textContent=names[moment.kind]+' · '+subject(moment);button.append(stamp,label);
  button.addEventListener('click',()=>showMoment(moment,button,data.definitions));byId('moments').append(button);
 }
 if(data.moments.length)byId('moments').firstElementChild.click();else text('detail','No qualifying changes in this interval. This does not establish silence.');
 byId('voices').replaceChildren();
 for(const voice of data.voices){
  const row=document.createElement('tr');
  const waves=voice.waveformSeconds?Object.entries(voice.waveformSeconds).filter(([,value])=>value>0).map(([name,value])=>name+' '+seconds(value)).join(', '):'unavailable';
  for(const value of ['SID '+(voice.chip+1)+' · V'+(voice.voice+1),seconds(voice.gateOnSeconds),waves,voice.pulseWidthRange?voice.pulseWidthRange.min+'–'+voice.pulseWidthRange.max:'unavailable',voice.observedWrites+' / '+(voice.valueChanges??'unavailable')]){
   const cell=document.createElement('td');cell.textContent=value;row.append(cell);
  }byId('voices').append(row);
 }
 byId('chips').replaceChildren();
 for(const chip of data.chips){
  const item=document.createElement('p');item.textContent='SID '+(chip.chip+1)+' · cutoff register '+(chip.cutoffRange?chip.cutoffRange.min+'–'+chip.cutoffRange.max:'unavailable')+' · filter routing durations V1 / V2 / V3: '+(chip.filterRoutingSeconds?chip.filterRoutingSeconds.map(seconds).join(' / '):'unavailable');byId('chips').append(item);
 }
 text('output',data.output.channels.map(channel=>'Output '+(channel.channel+1)+': peak '+number(channel.peak)+', RMS '+number(channel.rms)+', DC '+number(channel.dc)).join(' · ')+' (normalized PCM)');
 text('provenance',JSON.stringify({input:report.input,runtime:report.runtime,measurement:report.measurement,definitions:data.definitions,coverage},null,2));
}
reports.forEach((report,index)=>{const option=document.createElement('option'),info=report.analysis.profile;option.value=index;option.textContent=(info.title||report.input.name)+' · '+info.installedSids+' SID'+(info.installedSids>1?'s':'')+' · '+seconds(report.analysis.coverage.renderedSeconds);byId('report').append(option);});
byId('report').addEventListener('change',event=>render(Number(event.target.value)));render(0);
</script></body></html>`;
const destination = resolve('build/sid-analysis/index.html');
await mkdir(resolve('build/sid-analysis'), {recursive: true});
await writeFile(destination, html);
console.log(destination);
