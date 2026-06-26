/* xlsx-parse.js — client-side XLSX reader + PO/GR tracking aggregator.
   Single source of truth: used both to pre-generate po-data.js and to process
   user uploads live in the dashboard. No dependencies (uses DecompressionStream). */
(function(global){
  'use strict';

  // ---------- zip ----------
  function unzip(buf){
    const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
    let eocd=-1;
    for(let i=buf.length-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;} }
    if(eocd<0) throw new Error('ไม่พบโครงสร้างไฟล์ ZIP (ไฟล์อาจไม่ใช่ .xlsx)');
    const cdCount=dv.getUint16(eocd+10,true);
    let p=dv.getUint32(eocd+16,true);
    const files={};
    for(let n=0;n<cdCount;n++){
      if(dv.getUint32(p,true)!==0x02014b50) break;
      const method=dv.getUint16(p+10,true),compSize=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),
        extraLen=dv.getUint16(p+30,true),commentLen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true);
      const name=new TextDecoder().decode(buf.subarray(p+46,p+46+nameLen));
      const lnameLen=dv.getUint16(lho+26,true),lextraLen=dv.getUint16(lho+28,true);
      const start=lho+30+lnameLen+lextraLen;
      files[name]={method,comp:buf.subarray(start,start+compSize)};
      p+=46+nameLen+extraLen+commentLen;
    }
    return files;
  }
  async function inflate(e){
    if(e.method===0) return e.comp;
    const ds=new DecompressionStream('deflate-raw');
    const w=ds.writable.getWriter(); w.write(e.comp); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }
  async function entryText(files,name){ return new TextDecoder().decode(await inflate(files[name])); }

  // ---------- shared strings ----------
  function parseStrings(xml){
    const out=[]; const re=/<si>([\s\S]*?)<\/si>/g; let m;
    while(m=re.exec(xml)) out.push(m[1].replace(/<[^>]+>/g,'').trim());
    return out;
  }
  function colNum(c){ let n=0; for(const ch of c) n=n*26+(ch.charCodeAt(0)-64); return n-1; }

  // ---------- sheet ----------
  function parseSheet(xml,ss){
    const rows=[]; let headerMap=null;
    const rowRe=/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
    while(rm=rowRe.exec(xml)){
      const rIdx=+rm[1]; const arr={};
      const cre=/<c r="([A-Z]+)\d+"(?: s="\d+")?(?: t="(\w+)")?[^>]*?>\s*(?:<v>([\s\S]*?)<\/v>|<is>([\s\S]*?)<\/is>)?\s*<\/c>/g;
      let m;
      while(m=cre.exec(rm[2])){
        const ci=colNum(m[1]); const t=m[2];
        let v=m[3];
        if(v==null && m[4]!=null){ v=m[4].replace(/<[^>]+>/g,''); }
        if(v==null) continue;
        v=v.trim();
        if(t==='s') v=ss[+v];
        arr[ci]=v;
      }
      if(rIdx===1){
        headerMap={};
        for(const k in arr){ headerMap[(arr[k]||'').trim()]=+k; }
      } else {
        rows.push(arr);
      }
    }
    return { headerMap:headerMap||{}, rows };
  }

  async function parseWorkbook(blob){
    const buf=new Uint8Array(blob instanceof Uint8Array? blob : await blob.arrayBuffer());
    const files=unzip(buf);
    const ssName=Object.keys(files).find(k=>/sharedStrings\.xml$/.test(k));
    const ss=ssName? parseStrings(await entryText(files,ssName)) : [];
    const sheetName=Object.keys(files).find(k=>/worksheets\/sheet1\.xml$/.test(k))
      || Object.keys(files).find(k=>/worksheets\/.*\.xml$/.test(k));
    if(!sheetName) throw new Error('ไม่พบ worksheet ในไฟล์');
    return parseSheet(await entryText(files,sheetName),ss);
  }

  // ---------- helpers ----------
  const num=v=>{ if(v==null) return 0; const n=parseFloat(String(v).replace(/,/g,'')); return isNaN(n)?0:n; };
  function dnum(s){ if(!s) return 0; const p=String(s).split('.'); if(p.length!==3) return 0; const[d,m,y]=p.map(Number); return (2000+y)*10000+m*100+d; }
  function ym(s){ if(!s) return null; const p=String(s).split('.'); if(p.length!==3) return null; const[d,m,y]=p.map(Number); return (2000+y)+'-'+String(m).padStart(2,'0'); }
  function get(row,map,name){ const i=map[name]; return i==null?undefined:row[i]; }

  // ---------- aggregation ----------
  function buildDataset(po, gr, opts){
    opts=opts||{};
    const TODAY = opts.today!=null ? opts.today : (function(){ const d=new Date(); return d.getFullYear()*10000+(d.getMonth()+1)*100+d.getDate(); })();
    const PH=po.headerMap, GH=gr.headerMap;
    const person=(row,map)=>{ const f=(get(row,map,'First Name')||'').trim(); const l=(get(row,map,'Last Name')||'').trim(); return (f+' '+l).trim(); };

    // GR aggregate by PO ref + GR docs
    const grByPO={}, grDocs={};
    for(const r of gr.rows){
      const ref=get(r,GH,'Base Document Reference'); const doc=get(r,GH,'Document Number');
      const q=num(get(r,GH,'Quantity')); const val=num(get(r,GH,'Gross Total'));
      if(ref){ const e=grByPO[ref]||(grByPO[ref]={q:0,val:0,docs:new Set(),list:[]}); e.q+=q; e.val+=val;
        if(!e.docs.has(doc)){ e.docs.add(doc); e.list.push({d:doc,date:get(r,GH,'Posting Date')||'',st:get(r,GH,'Document Status'),pn:person(r,GH)}); } }
      if(!grDocs[doc]) grDocs[doc]={status:get(r,GH,'Document Status'),date:get(r,GH,'Posting Date')||'',val:0};
      grDocs[doc].val+=val;
    }
    const grDocArr=Object.values(grDocs);
    const grOpen=grDocArr.filter(g=>g.status==='Open').length, grClosed=grDocArr.filter(g=>g.status==='Closed').length;

    // PO aggregate by document
    const poMap={};
    for(const r of po.rows){
      const doc=get(r,PH,'Document Number'); if(!doc) continue;
      let p=poMap[doc];
      if(!p){ p={doc,prefix:get(r,PH,'Prefix String'),status:get(r,PH,'Document Status'),
        post:get(r,PH,'Posting Date')||'',deliv:get(r,PH,'Delivery Date')||'',
        vcode:get(r,PH,'Customer/Vendor Code'),vname:get(r,PH,'Customer/Vendor Name'),
        dept:get(r,PH,'Department')||'',wh:get(r,PH,'Warehouse Code')||'',
        remark:get(r,PH,'Remark')||'',person:person(r,PH),lines:0,qty:0,openQty:0,val:0,items:[]}; poMap[doc]=p; }
      p.lines++;
      const q=num(get(r,PH,'Quantity')),oq=num(get(r,PH,'Remaining Open Quantity')),gt=num(get(r,PH,'Gross Total'));
      p.qty+=q; p.openQty+=oq; p.val+=gt;
      p.items.push({no:get(r,PH,'Item No.'),desc:(get(r,PH,'Item/Service Description')||'').slice(0,60),
        qty:q,open:oq,unit:get(r,PH,'Unit'),price:Math.round(num(get(r,PH,'Gross Price'))),total:Math.round(gt)});
    }
    const pos=Object.values(poMap);

    let cFull=0,cPartial=0,cAwait=0,cOverdue=0,valAwait=0,totalValue=0;
    for(const p of pos){
      const gx=grByPO[p.doc];
      p.grDocs=gx?gx.docs.size:0; p.grList=gx?gx.list.slice(0,10):[]; p.grVal=gx?Math.round(gx.val):0;
      p.recvPct=p.qty>0?Math.max(0,Math.min(100,Math.round((p.qty-p.openQty)/p.qty*100))):0;
      let st;
      if(p.status==='Closed'||p.openQty<=0.0001){ st='full'; cFull++; }
      else if(p.openQty<p.qty-0.0001||p.grDocs>0){ st='partial'; cPartial++; }
      else { st='await'; cAwait++; }
      p.track=st;
      p.overdue=(st!=='full' && dnum(p.deliv) && dnum(p.deliv)<TODAY);
      if(p.overdue) cOverdue++;
      if(st!=='full') valAwait += p.qty>0? p.val*(p.openQty/p.qty) : 0;
      p.val=Math.round(p.val); p.qty=Math.round(p.qty*100)/100; p.openQty=Math.round(p.openQty*100)/100;
      totalValue+=p.val;
    }

    // monthly trend
    const monthly={};
    for(const p of pos){ const k=ym(p.post); if(!k) continue; (monthly[k]=monthly[k]||{po:0,val:0,recv:0}).po++; monthly[k].val+=p.val; }
    for(const g of grDocArr){ const k=ym(g.date); if(!k) continue; (monthly[k]=monthly[k]||{po:0,val:0,recv:0}).recv++; }
    const months=Object.keys(monthly).sort();

    function topBy(keyFn,n){ const m={}; for(const p of pos){ const k=keyFn(p)||'(ไม่ระบุ)'; const e=m[k]||(m[k]={count:0,val:0,open:0}); e.count++; e.val+=p.val; if(p.track!=='full') e.open++; } return Object.entries(m).map(([k,v])=>({k,...v})).sort((a,b)=>b.val-a.val).slice(0,n); }

    // dates min/max
    let dmin=null,dmax=null;
    for(const p of pos){ const d=dnum(p.post); if(!d) continue; if(dmin==null||d<dmin)dmin=d; if(dmax==null||d>dmax)dmax=d; }
    const fmtD=d=>d?String(d).slice(6,8)+'.'+String(d).slice(4,6)+'.'+String(d).slice(0,4):'';

    const summary={
      generated:new Date().toLocaleDateString('en-GB').replace(/\//g,'.'),
      totalPO:pos.length, totalGR:grDocArr.length, totalValue:Math.round(totalValue),
      track:{full:cFull,partial:cPartial,await:cAwait}, overdue:cOverdue, valAwait:Math.round(valAwait),
      grOpen, grClosed,
      byPrefix:topBy(p=>p.prefix,20), byDept:topBy(p=>p.dept,15), byVendor:topBy(p=>p.vname,15),
      byWh:topBy(p=>p.wh,12), byPerson:topBy(p=>p.person,15),
      monthly:months.map(m=>({m,...monthly[m]})), dateMin:fmtD(dmin), dateMax:fmtD(dmax)
    };

    const rows=pos.map(p=>{ const keep=p.track!=='full'; return {
      doc:p.doc, pf:p.prefix, st:p.status, tr:p.track, od:p.overdue?1:0,
      post:p.post, deliv:p.deliv, vc:p.vcode, vn:p.vname, dept:p.dept, wh:p.wh,
      pn:p.person||'', qty:p.qty, oq:p.openQty, rp:p.recvPct, val:p.val,
      gd:p.grDocs, gv:p.grVal, ln:p.lines, rm:(p.remark||'').slice(0,90),
      items:keep?p.items.slice(0,25):[], grl:p.grList
    };});

    return { summary, rows };
  }

  async function fromFiles(poBlob, grBlob, opts){
    const po=await parseWorkbook(poBlob);
    const gr=await parseWorkbook(grBlob);
    if(!po.headerMap['Document Number']) throw new Error('ไฟล์ PO ไม่พบคอลัมน์ Document Number');
    if(!gr.headerMap['Document Number']) throw new Error('ไฟล์ GR ไม่พบคอลัมน์ Document Number');
    return buildDataset(po, gr, opts);
  }

  global.XLSXTrack = { unzip, parseWorkbook, buildDataset, fromFiles };
})(typeof window!=='undefined'?window:globalThis);
