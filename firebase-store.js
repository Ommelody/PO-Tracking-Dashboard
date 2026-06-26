/* firebase-store.js — เก็บชุดข้อมูล PO/GR ที่ประมวลผลแล้วไว้บน Firestore
   - ใช้ Firestore อย่างเดียว (ไม่ใช้ Firebase Storage) → อยู่ในแพลนฟรี (Spark) ได้
   - บีบอัดข้อมูลด้วย gzip + base64 แล้วแบ่งเป็นชิ้น (chunk) เก็บข้ามเอกสาร เผื่อข้อมูลใหญ่เกิน 1MB
   ต้องโหลด firebase-app-compat.js + firebase-firestore-compat.js และ firebase-config.js มาก่อนไฟล์นี้ */
(function (global) {
  'use strict';
  let db = null, ready = false;
  const COL = 'po_datasets';   // collection
  const DOC = 'current';       // เอกสารชุดข้อมูลปัจจุบัน
  const CHUNK = 700000;        // ขนาดต่อชิ้น (อักขระ) ~0.7MB < ลิมิต 1MB/เอกสาร

  function configured(cfg) {
    return !!(cfg && cfg.projectId && cfg.apiKey && !/YOUR_/.test(cfg.apiKey) && !/YOUR_/.test(cfg.projectId));
  }

  function init() {
    if (ready) return true;
    const cfg = global.FIREBASE_CONFIG;
    if (!global.firebase || !global.firebase.firestore || !configured(cfg)) return false;
    if (!global.firebase.apps || !global.firebase.apps.length) global.firebase.initializeApp(cfg);
    db = global.firebase.firestore();
    ready = true;
    return true;
  }

  // ---------- gzip + base64 ----------
  async function gzipB64(str) {
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    w.write(new TextEncoder().encode(str)); w.close();
    const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
    let bin = ''; const step = 0x8000;
    for (let i = 0; i < buf.length; i += step) bin += String.fromCharCode.apply(null, buf.subarray(i, i + step));
    return btoa(bin);
  }
  async function gunzipB64(b64) {
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const ds = new DecompressionStream('gzip');
    const w = ds.writable.getWriter(); w.write(buf); w.close();
    return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
  }

  // ---------- โหลดชุดข้อมูลปัจจุบัน ----------
  async function loadCurrent() {
    if (!init()) return null;
    const metaSnap = await db.collection(COL).doc(DOC).get();
    if (!metaSnap.exists) return null;
    const meta = metaSnap.data();
    const n = meta.chunkCount || 0;
    if (!n) return null;
    const parts = [];
    for (let i = 0; i < n; i++) {
      const c = await db.collection(COL).doc(DOC).collection('chunks').doc(String(i)).get();
      parts.push((c.data() || {}).b || '');
    }
    const b64 = parts.join('');
    const json = meta.gzip ? await gunzipB64(b64) : atob(b64);
    return { data: JSON.parse(json), meta };
  }

  // ---------- บันทึกชุดข้อมูลใหม่ (กลายเป็นข้อมูลกลางที่ทุกคนเห็น) ----------
  async function saveCurrent(dataset, note) {
    if (!init()) throw new Error('ยังไม่ได้ตั้งค่า Firebase (firebase-config.js)');
    const b64 = await gzipB64(JSON.stringify(dataset));
    const parts = [];
    for (let i = 0; i < b64.length; i += CHUNK) parts.push(b64.slice(i, i + CHUNK));

    const ref = db.collection(COL).doc(DOC);
    const prev = await ref.get();
    const prevCount = prev.exists ? (prev.data().chunkCount || 0) : 0;

    // เขียนชิ้นข้อมูล
    for (let i = 0; i < parts.length; i++) {
      await ref.collection('chunks').doc(String(i)).set({ b: parts[i] });
    }
    // ลบชิ้นเก่าที่เกินมา
    for (let i = parts.length; i < prevCount; i++) {
      await ref.collection('chunks').doc(String(i)).delete().catch(function () {});
    }

    const s = dataset.summary || {};
    const meta = {
      chunkCount: parts.length, gzip: true,
      totalPO: s.totalPO || 0, totalGR: s.totalGR || 0,
      dateMin: s.dateMin || '', dateMax: s.dateMax || '',
      note: note || '',
      updatedAtClient: new Date().toISOString(),
      updatedAt: global.firebase.firestore.FieldValue.serverTimestamp()
    };
    await ref.set(meta);
    // เก็บประวัติย้อนหลัง (เฉพาะ metadata)
    await ref.collection('history').add(meta).catch(function () {});
    return meta;
  }

  global.FBStore = {
    init: init,
    isConfigured: function () { return configured(global.FIREBASE_CONFIG); },
    loadCurrent: loadCurrent,
    saveCurrent: saveCurrent
  };
})(window);
