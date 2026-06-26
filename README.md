# ระบบติดตามสถานะใบสั่งซื้อ (PO Tracking Dashboard)

Dashboard ติดตามสถานะใบสั่งซื้อ (PO) และการรับของ (GR) จาก SAP Business One
เก็บข้อมูลกลางบน **Firebase (Firestore)** และเผยแพร่ผ่าน **GitHub Pages**

> เปิดไฟล์เดียว ใช้งานได้ทันที — ผู้ใช้อัปโหลดไฟล์ PO/GR (.xlsx) ระบบประมวลผลในเบราว์เซอร์
> แล้วบันทึกขึ้นฐานข้อมูลกลาง ทุกคนที่เปิดระบบจะเห็นข้อมูลชุดล่าสุดเหมือนกัน

---

## ไฟล์ในโฟลเดอร์นี้ (`site/`)

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าหลักของ Dashboard |
| `support.js` | รันไทม์ของหน้า (ต้องมี) |
| `po-data.js` | ข้อมูลตั้งต้นที่ฝังมา (ใช้ตอนยังไม่เชื่อม Firebase / โหลดสำรอง) |
| `xlsx-parse.js` | ตัวอ่านไฟล์ Excel + ประมวลผล PO/GR |
| `firebase-store.js` | ตัวอ่าน/เขียนข้อมูลกับ Firestore |
| `firebase-config.js` | **ไฟล์ที่คุณต้องแก้** — ใส่คอนฟิก Firebase ของคุณ |
| `firestore.rules` | กฎความปลอดภัยของ Firestore (นำไปวางใน Firebase Console) |
| `.nojekyll` | บอก GitHub Pages ไม่ต้องประมวลผลด้วย Jekyll |

---

## ส่วนที่ 1 — ตั้งค่า Firebase (ฐานข้อมูลกลาง)

1. เข้า <https://console.firebase.google.com> → **Add project** → ตั้งชื่อ (เช่น `po-tracking`) → สร้างให้เสร็จ (ปิด Google Analytics ได้)
2. เมนูซ้าย **Build → Firestore Database** → **Create database**
   - ⚠️ **ต้องเป็น "Cloud Firestore" เท่านั้น — ไม่ใช่ "Realtime Database"** (เป็นคนละตัว ใช้กฎคนละแบบ ถ้าวางกฎผิดหน้าจะขึ้น *Parse error*)
   - เลือก **Start in production mode** → เลือก location `asia-southeast1 (Singapore)` → Enable
3. ในหน้า **Firestore** ไปแท็บ **Rules** วางเนื้อหาจากไฟล์ `firestore.rules` แล้วกด **Publish**
   - หน้าที่ถูกต้องหัวข้อจะเขียนว่า **"Cloud Firestore"** และข้อมูลเป็นแบบ collection / document
4. หา **คอนฟิกเว็บ**: คลิกไอคอนเฟือง ⚙️ → **Project settings** → เลื่อนลงหัวข้อ *Your apps* → คลิกไอคอน `</>` (Web)
   - ตั้งชื่อ app → **Register app** → จะเห็นออบเจกต์ `firebaseConfig { apiKey, authDomain, ... }`
5. เปิดไฟล์ **`firebase-config.js`** แล้วแทนค่าทั้งหมดด้วยค่าจริงของคุณ:

```js
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "po-tracking.firebaseapp.com",
  projectId: "po-tracking",
  storageBucket: "po-tracking.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc123"
};
```

> ใช้ **Firestore อย่างเดียว ไม่ต้องเปิด Firebase Storage** — อยู่ในแพลนฟรี (Spark) ได้
> ข้อมูลถูกบีบอัด (gzip) ก่อนเก็บ จึงประหยัดพื้นที่และอยู่ในลิมิตเอกสารของ Firestore

---

## ส่วนที่ 2 — เผยแพร่ด้วย GitHub Pages

### วิธีที่ A — ผ่านหน้าเว็บ GitHub (ง่ายสุด ไม่ต้องใช้คำสั่ง)
1. สร้าง repository ใหม่ที่ <https://github.com/new> (เช่น `po-tracking`) → ตั้งเป็น Public
2. ในหน้า repo กด **Add file → Upload files** แล้วลาก **ไฟล์ทั้งหมดในโฟลเดอร์ `site/`** (ไม่ใช่ตัวโฟลเดอร์ — เอาเฉพาะไฟล์ข้างใน) เข้าไป → **Commit changes**
3. ไปที่ **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** / โฟลเดอร์ **/ (root)** → **Save**
4. รอ ~1 นาที แล้วเปิดลิงก์ที่แสดง: `https://<ชื่อผู้ใช้>.github.io/po-tracking/`

### วิธีที่ B — ผ่าน Git (คำสั่ง)
```bash
git init
git add .
git commit -m "PO tracking dashboard"
git branch -M main
git remote add origin https://github.com/<ชื่อผู้ใช้>/po-tracking.git
git push -u origin main
```
จากนั้นเปิด **Settings → Pages** แล้วตั้ง Source เป็น branch `main` / root เหมือนวิธี A

> ใส่ไฟล์ `firebase-config.js` ที่กรอกค่าจริงแล้วขึ้นไปด้วย ระบบจึงจะเชื่อมฐานข้อมูลกลาง
> ป้ายสถานะมุมขวาบนจะเปลี่ยนจาก *“ยังไม่เชื่อม Firebase”* เป็น *“เชื่อมฐานข้อมูลกลาง”*

---

## การใช้งานประจำวัน
1. ส่งออกไฟล์ **Purchase Order** และ **Goods Receipt PO** จาก SAP เป็น `.xlsx` (และ **A/P Invoice** ถ้าต้องการติดตามขั้นตั้งหนี้)
2. เปิด Dashboard → ปุ่ม **อัปโหลดข้อมูล PO / GR / Invoice** (มุมขวาบน)
3. เลือกไฟล์ PO และ GR (จำเป็น) — แนบ A/P Invoice ได้ (ไม่บังคับ) → ใส่หมายเหตุรอบข้อมูล (ถ้าต้องการ) → **ประมวลผลข้อมูล**
4. ระบบบันทึกขึ้นฐานข้อมูลกลางให้อัตโนมัติ — คนอื่นกดปุ่มรีเฟรช ⟳ หรือเปิดใหม่ก็เห็นข้อมูลล่าสุด

> **A/P Invoice** เชื่อมโยงกับใบรับของผ่าน `Base Document Reference` (ชนิด Goods Receipt PO) ทำให้ติดตามได้ครบสาย
> **PO → รับของ (GR) → ตั้งหนี้ (Invoice)** — ถ้าไม่แนบไฟล์นี้ ระบบจะประเมินขั้นตั้งหนี้จากสถานะของใบรับของแทน
> รองรับการเปิดบนมือถือ แท็บเล็ต และคอมพิวเตอร์ (responsive)

ระบบจับคู่คอลัมน์อัตโนมัติตามชื่อหัวตาราง คอลัมน์ที่ใช้: `Document Number, Document Status,
Prefix String, Posting/Delivery Date, Customer/Vendor Code/Name, Item No./Description, Quantity,
Remaining Open Quantity, Gross Total/Price, Warehouse Code, Department, Base Document Reference, First Name, Last Name`

---

## ความปลอดภัย (แนะนำให้ทำเมื่อพร้อม)
กฎเริ่มต้นเปิดให้อ่าน/เขียนได้ทุกคนที่รู้ลิงก์ เพื่อให้เริ่มใช้ได้ทันที หากต้องการจำกัดสิทธิ์:
- เปิด **Authentication → Sign-in method → Anonymous** (หรือ Google) แล้วแก้ rules เป็น `allow read, write: if request.auth != null;`
- หรือจำกัดเฉพาะอ่านสาธารณะ + เขียนเมื่อผ่านการยืนยันตัวตน: `allow read: if true; allow write: if request.auth != null;`
- พิจารณาเปิด **App Check** เพื่อกันการเรียกจากนอกแอป

> หมายเหตุ: ค่าใน `firebase-config.js` ไม่ใช่ความลับ (เป็นค่าฝั่งเว็บปกติ) ความปลอดภัยจริงอยู่ที่ **Firestore Rules**
