import * as vscode from "vscode";

/** Self-contained sidebar UI (no remote content, strict CSP). Presentational only: it sends validated intents to the host. */
export function renderHtml(webview: vscode.Webview, nonce: string): string {
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1">
<style nonce="${nonce}">
:root{--accent:#f5792a;--b:var(--vscode-panel-border,#2e3540)}
body{font:13px var(--vscode-font-family);color:var(--vscode-foreground);padding:0;margin:0;display:flex;flex-direction:column;height:100vh}
header{display:flex;gap:6px;align-items:center;padding:6px 8px;border-bottom:1px solid var(--b)}
.chip{padding:1px 8px;border-radius:9999px;border:1px solid var(--b);font-size:11px}
.ok{color:var(--vscode-testing-iconPassed,#3fb950)}.bad{color:var(--vscode-errorForeground,#f85149)}.warn{color:var(--vscode-editorWarning-foreground,#d29922)}
nav{display:flex;border-bottom:1px solid var(--b)}nav button{flex:1;background:none;border:0;color:inherit;padding:6px;cursor:pointer;border-bottom:2px solid transparent}
nav button[aria-selected=true]{border-bottom-color:var(--accent);font-weight:600}
main{flex:1;overflow:auto;padding:8px}
.card{border:1px solid var(--b);border-radius:6px;padding:8px;margin:6px 0}
.row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
button.p{background:var(--accent);color:#1a0e05;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:600}
button.s{background:none;color:inherit;border:1px solid var(--b);border-radius:4px;padding:3px 8px;cursor:pointer}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
button:disabled{opacity:.5;cursor:not-allowed}
pre{margin:4px 0;white-space:pre-wrap;word-break:break-word;font:12px var(--vscode-editor-font-family)}
.add{background:rgba(63,185,80,.16)}.del{background:rgba(248,81,73,.16)}.muted{opacity:.7}
footer{border-top:1px solid var(--b);padding:8px;display:flex;gap:6px}textarea{flex:1;resize:none;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--b);border-radius:4px;padding:6px;font:inherit}
</style></head><body>
<header><strong>FORGE</strong><span id="conn" class="chip">checking…</span><span id="model" class="chip muted"></span></header>
<nav role="tablist"><button role="tab" data-t="agent" aria-selected="true">Agent</button><button role="tab" data-t="context" aria-selected="false">Context</button><button role="tab" data-t="plan" aria-selected="false">Plan</button><button role="tab" data-t="review" aria-selected="false">Review</button><button role="tab" data-t="timeline" aria-selected="false">Timeline</button></nav>
<div id="banner"></div><main id="main" aria-live="polite"></main>
<footer><textarea id="in" rows="3" aria-label="Describe a task. Type @ to mention files or symbols" placeholder="Describe a task. Use @path/to/file.py or @symbol:Name to mention code."></textarea><div><button class="p" id="send">Send</button><button class="s" id="stop" hidden>Stop</button></div></footer>
<script nonce="${nonce}">
const vs=acquireVsCodeApi();let S={},tab='agent',n=0;const id=()=>String(++n);
const send=m=>vs.postMessage({v:1,id:id(),...m});
const esc=s=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{tab=b.dataset.t;document.querySelectorAll('nav button').forEach(x=>x.setAttribute('aria-selected',String(x===b)));render()});
document.getElementById('send').onclick=()=>{const t=document.getElementById('in');const v=t.value.trim();if(!v)return;send({type:'task.submit',text:v,mentions:[]});t.value=''};
document.getElementById('in').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('send').click()}if(e.key==='Escape')send({type:'turn.cancel',sessionId:S.sessionId||'-'})};
document.getElementById('stop').onclick=()=>send({type:'turn.cancel',sessionId:S.sessionId||'-'});
window.addEventListener('message',e=>{const m=e.data;if(m.type==='state.snapshot'){S=m.state;render()}else if(m.type==='stream.delta'){S.stream=(S.stream||'')+m.text;if(tab==='agent')render()}});
function review(){const q=S.review;if(!q||!q.proposals.length)return'<p class="muted">Nothing to review.</p>';
 let h='<div class="row"><button class="p" data-a="apply">Apply accepted</button><button class="s" data-a="acceptAll">Accept all</button><button class="s" data-a="rejectAll">Reject all</button><button class="s" data-a="undo" '+(q.canUndo?'':'disabled')+'>Undo last batch</button></div>';
 for(const p of q.proposals){h+='<div class="card"><div class="row"><strong>'+esc(p.path)+'</strong><span class="chip">'+p.kind+'</span><span class="add chip">+'+p.linesAdded+'</span><span class="del chip">−'+p.linesRemoved+'</span><button class="s" data-diff="'+p.id+'">Open diff</button></div><div class="muted">'+esc(p.rationale)+'</div>';
  for(const k of p.hunks){h+='<div class="card"><div class="row"><code>'+esc(k.header)+'</code><span class="chip">'+k.state+'</span>'+(['applied','undone'].includes(k.state)?'':'<button class="s" data-h="'+p.id+'|'+k.id+'|accept">Accept</button><button class="s" data-h="'+p.id+'|'+k.id+'|reject">Reject</button>')+'</div><pre>'+k.lines.map(l=>'<span class="'+(l.kind==='add'?'add':l.kind==='del'?'del':'')+'">'+(l.kind==='add'?'+ ':l.kind==='del'?'− ':'  ')+esc(l.text)+'</span>').join('\\n')+'</pre></div>'}
  h+='</div>'}return h}
function render(){const c=document.getElementById('conn');c.textContent=S.connection==='ok'?'TrueForge ● connected':S.connection==='down'?'TrueForge ○ unreachable':'checking…';c.className='chip '+(S.connection==='ok'?'ok':S.connection==='down'?'bad':'');
 document.getElementById('model').textContent=S.model||'no model';document.getElementById('send').disabled=!!S.running;document.getElementById('stop').hidden=!S.running;
 document.getElementById('banner').innerHTML=S.notice?'<div class="card '+(S.notice.level==='error'?'bad':'warn')+'" role="alert"><strong>'+esc(S.notice.title)+'</strong><div>'+esc(S.notice.message)+'</div>'+(S.notice.action?'<button class="s" data-cmd="'+S.notice.action.command+'">'+esc(S.notice.action.label)+'</button>':'')+'</div>':'';
 let h='';
 if(tab==='agent'){if(S.approval)h+='<div class="card" role="alertdialog" aria-label="Approval needed"><strong>Approval needed: '+esc(S.approval.tool)+'</strong><pre>'+esc(S.approval.detail)+'</pre><div class="row"><button class="p" data-ap="allow">'+(S.approval.tool==='submit_changes'?'Apply accepted':'Allow')+'</button><button class="s" data-ap="deny">Deny</button></div></div>';
  for(const m of S.messages||[])h+='<div class="card"><div class="muted">'+m.role+'</div><pre>'+esc(m.text)+'</pre></div>';
  if(S.stream)h+='<div class="card"><div class="muted">assistant</div><pre>'+esc(S.stream)+'▍</pre></div>';if(!h)h='<p class="muted">Describe a task. FORGE finds the files itself and shows every change for review before it touches disk.</p>'}
 if(tab==='context'){const c=S.context;h=!c?'<p class="muted">Context appears when the agent starts looking at your code.</p>':'<div class="muted">'+c.used+' / '+c.budget+' tokens</div><progress max="'+c.budget+'" value="'+c.used+'" style="width:100%"></progress>'+c.items.map(i=>'<div class="card"><div class="row"><code>'+esc(i.path)+'</code><span class="chip">'+i.tier+'</span><span class="chip">'+i.tokens+' tok</span></div><div class="muted">'+esc(i.reasons.join(' · '))+'</div></div>').join('')+(c.excluded.length?'<details><summary>Excluded ('+c.excluded.length+')</summary>'+c.excluded.map(x=>'<div class="muted">'+esc(x.path)+' — '+esc(x.reason)+'</div>').join('')+'</details>':'')}
 if(tab==='plan')h=(S.plan||[]).length?'<ol>'+S.plan.map(s=>'<li>'+({done:'✓',in_progress:'…',pending:'○',skipped:'–'}[s.status])+' '+esc(s.title)+'</li>').join('')+'</ol>':'<p class="muted">No plan yet.</p>';
 if(tab==='review')h=review();
 if(tab==='timeline')h=(S.timeline||[]).length?(S.timeline).map(e=>'<div class="row"><span class="muted">'+new Date(e.at).toLocaleTimeString()+'</span><span>'+esc(e.title)+'</span><span class="muted">'+esc(e.detail||'')+'</span><span class="chip '+(e.status==='error'?'bad':'')+'">'+(e.status||'')+'</span></div>').join(''):'<p class="muted">No activity yet.</p>';
 document.getElementById('main').innerHTML=h;
 document.querySelectorAll('[data-ap]').forEach(b=>b.onclick=()=>send({type:'approval.decide',callId:S.approval.callId,decision:b.dataset.ap}));
 document.querySelectorAll('[data-h]').forEach(b=>b.onclick=()=>{const[p,hh,a]=b.dataset.h.split('|');send({type:'review.hunk',proposalId:p,hunkId:hh,action:a})});
 document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>send({type:'review.bulk',action:b.dataset.a}));
 document.querySelectorAll('[data-diff]').forEach(b=>b.onclick=()=>send({type:'review.openDiff',proposalId:b.dataset.diff}));
 document.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>send({type:'command.run',command:b.dataset.cmd}));
}
send({type:'ready'});
</script></body></html>`;
}
