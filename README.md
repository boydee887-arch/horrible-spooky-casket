# FF SCAN CENTER

เว็บตัวอย่างที่รันได้จริงในเครื่อง/เซิร์ฟเวอร์ Node.js โดยแยก Admin และ Customer ผ่าน Backend session

## สิ่งที่มี
- Admin login แยกจาก Customer
- รหัส Admin ถูกเก็บเป็น bcrypt hash ใน SQLite (ไม่อยู่ใน frontend)
- บังคับเปลี่ยนรหัสผ่านเริ่มต้นเมื่อ login ครั้งแรก
- Rate limit สำหรับ Admin login และ Customer activation
- สร้าง License 3 ชั่วโมง, 6 ชั่วโมง, 1 วัน, 7 วัน, 30 วัน, 90 วัน, 180 วัน และ Lifetime
- เก็บ License เป็น SHA-256 hash; แสดงคีย์เต็มเฉพาะตอนสร้าง
- ค้นหา, ระงับ/เปิดใช้งาน, ดูวันหมดอายุและ device binding
- Reset device binding ต้องยืนยันรหัส Admin
- Audit log สำหรับเหตุการณ์หลัก
- Customer activation ผูกคีย์กับ browser device token
- File picker อ่านไฟล์ใน browser และคำนวณ SHA-256 โดยไม่อัปโหลดไฟล์
- แสดงข้อจำกัดของ browser อย่างชัดเจน

## เริ่มใช้งานในเครื่อง
ต้องมี Node.js 20+
```bash
npm install
cp .env.example .env
```
แก้ `.env`:
- `SESSION_SECRET` ให้เป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร
- `ADMIN_INITIAL_PASSWORD=1199xx` เป็นค่าเริ่มต้นตามที่ร้องขอ (ระบบจะบังคับเปลี่ยนทันทีหลัง login ครั้งแรก)

จากนั้น:
```bash
npm start
```
เปิด http://localhost:3000

## Deploy production
1. ใช้ VPS หรือแพลตฟอร์มที่รองรับ Node.js และ persistent disk
2. ตั้ง `NODE_ENV=production`
3. ตั้ง `SESSION_SECRET` เป็น secret สุ่มยาวอย่างน้อย 32 ตัวอักษร
4. ตั้ง `ADMIN_INITIAL_PASSWORD` ผ่านระบบ Environment Secrets ของผู้ให้บริการ ไม่ใส่ใน source code
5. ตั้ง `TRUST_PROXY=true` เฉพาะเมื่ออยู่หลัง reverse proxy ที่เชื่อถือได้
6. เปิด HTTPS ที่ reverse proxy/hosting และให้ cookie เป็น Secure
7. สำรองโฟลเดอร์ `data/` อย่างปลอดภัย

ห้ามนำ `.env` หรือ `data/` ขึ้น Git

## ข้อจำกัด / ก่อนใช้งานจริง
- Device ID เป็น browser token จาก localStorage ไม่ใช่ hardware ID; การล้าง storage/เปลี่ยน browser อาจเปลี่ยนตัวตนได้
- License key ที่แสดงครั้งเดียว หากสูญหายต้องสร้างใหม่ (ฐานข้อมูลเก็บ hash ไม่สามารถกู้คีย์เต็มได้)
- ควรเพิ่ม CSRF token, monitoring, backup/restore, security headers review และทดสอบ penetration test ก่อนเปิดบริการจริง
- ระบบนี้ไม่มี malware signature engine และไม่สามารถตรวจ Root, VPN, Shizuku, รายชื่อแอป หรือข้อมูล private ของ Android จาก Chrome ได้
- SHA-256 เป็นเพียง fingerprint ของไฟล์ ไม่ใช่ผลตัดสินว่าไฟล์ปลอดภัย
- ไม่มีการส่งไฟล์ส่วนตัวขึ้น Backend

## ทดสอบเบื้องต้น
- `/api/health` ต้องตอบ `{ "ok": true }`
- Admin login ใช้รหัสเริ่มต้นที่กำหนดใน environment และต้องเปลี่ยนรหัส
- สร้าง License แล้วนำคีย์ไป activate ใน Customer Access
- ทดลองใช้คีย์เดิมใน browser/device token อื่น ควรถูกปฏิเสธ
- Suspend แล้ว session customer จะไม่ผ่านการตรวจ session ครั้งถัดไป
