# Time Attendance and Leave System (ระบบบันทึกเวลาเข้างานและลาหยุด)

เว็บแอปพลิเคชันสำหรับบันทึกเวลาเข้า-ออกงาน และส่งคำขอลาหยุดของพนักงาน พร้อมหน้าดูประวัติที่แก้ไขและลบข้อมูลได้

---

## 🚀 ฟีเจอร์ (Features)

* **ลงเวลาทำงาน:** บันทึกรหัสพนักงาน วันที่ เวลาเข้างาน และเวลาออกงาน (เวลาออกงานไม่บังคับ กลับมาเพิ่มทีหลังได้)
* **คำร้องขอลางาน:** เลือกประเภทการลา (ลาป่วย / ลากิจ / ลาพักร้อน / อื่น ๆ) พร้อมเหตุผลและช่วงวันที่ลา
* **ประวัติการทำงานและการลา:** ตารางแสดงข้อมูลทั้งหมด กดแก้ไขหรือลบได้ (มีกล่องยืนยันก่อนลบ)
* **ตรวจสอบข้อมูลทั้งฝั่งหน้าเว็บและเซิร์ฟเวอร์:** เช่น รหัสพนักงานต้องเป็นตัวเลข, เวลาออกต้องหลังเวลาเข้า, วันสิ้นสุดลาต้องไม่ก่อนวันเริ่มลา

---

## 🛠️ เทคโนโลยีที่ใช้ (Tech Stack)

| ส่วน | เทคโนโลยี |
|---|---|
| Front-End | HTML5, CSS3, JavaScript (Vanilla JS + `fetch`), ฟอนต์ Kanit |
| Back-End | Node.js, Express (REST API) |
| Database | MySQL 8.0 (`utf8mb4` รองรับภาษาไทย) |
| DevOps | Docker Compose (MySQL + API + phpMyAdmin) |

---

## 💻 วิธีเริ่มใช้งาน (Quick Start)

### วิธีที่ 1: รันทั้งระบบด้วย Docker (แนะนำ)

ต้องติดตั้ง [Docker Desktop](https://www.docker.com/products/docker-desktop/) ก่อน แล้วรันที่โฟลเดอร์โปรเจกต์:

```bash
docker compose up -d --build
```

จากนั้นเปิด:

| บริการ | URL |
|---|---|
| หน้าเว็บ + API | http://localhost:3000 |
| phpMyAdmin | http://localhost:8841 |
| MySQL (สำหรับต่อจากเครื่อง) | `localhost:8840` (user `root` / password `root`) |

ตารางในฐานข้อมูลถูกสร้างให้อัตโนมัติจาก [`database/schema.sql`](database/schema.sql) ตอนรันครั้งแรก

หยุดระบบ:

```bash
docker compose down
```

ล้างฐานข้อมูลทั้งหมดแล้วเริ่มใหม่ (ข้อมูลจะหายทั้งหมด):

```bash
docker compose down -v
```

### วิธีที่ 2: รันเซิร์ฟเวอร์เองระหว่างพัฒนา

เปิดเฉพาะฐานข้อมูลด้วย Docker:

```bash
docker compose up -d db phpmyadmin
```

แล้วรัน API ด้วย Node.js (ต้องใช้ Node 18 ขึ้นไป):

```bash
cd server
npm install
npm run dev
```

`npm run dev` ใช้ nodemon รีสตาร์ทเซิร์ฟเวอร์ให้อัตโนมัติเมื่อแก้โค้ด ส่วน `npm start` รันแบบปกติ จากนั้นเปิด http://localhost:3000

ค่าการเชื่อมต่อฐานข้อมูลเปลี่ยนได้ผ่าน environment variables: `DB_HOST`, `DB_PORT` (ค่าเริ่มต้น `8840`), `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `PORT`

> เปิดไฟล์ HTML ในโฟลเดอร์ `public/` ตรงๆ หรือผ่าน Live Server ก็ได้ หน้าเว็บจะเรียก API ที่ `http://localhost:3000` ให้เอง (เซิร์ฟเวอร์ต้องเปิดอยู่)

---

## 🔌 API

| Method | Endpoint | คำอธิบาย |
|---|---|---|
| GET | `/api/attendance` | ดึงข้อมูลการลงเวลาทั้งหมด |
| GET | `/api/attendance/:id` | ดึงข้อมูลการลงเวลาตาม ID |
| POST | `/api/attendance` | เพิ่มข้อมูลการลงเวลา |
| PUT | `/api/attendance/:id` | แก้ไขข้อมูลการลงเวลา |
| DELETE | `/api/attendance/:id` | ลบข้อมูลการลงเวลา |
| GET | `/api/leave_requests` | ดึงคำขอลาทั้งหมด |
| GET | `/api/leave_requests/:id` | ดึงคำขอลาตาม ID |
| POST | `/api/leave_requests` | เพิ่มคำขอลา |
| PUT | `/api/leave_requests/:id` | แก้ไขคำขอลา |
| DELETE | `/api/leave_requests/:id` | ลบคำขอลา |

ตัวอย่างข้อมูลที่ส่ง:

```json
// POST /api/attendance
{ "employee_id": "101", "date": "2025-04-02", "time_in": "08:30", "time_out": "17:00" }

// POST /api/leave_requests
{ "employee_id": "101", "leave_type": "ลาป่วย", "reason": "ไม่สบาย", "start_date": "2025-04-03", "end_date": "2025-04-04" }
```

ถ้าข้อมูลไม่ถูกต้อง API จะตอบ `400` พร้อมรายการ `errors` และถ้าไม่พบข้อมูลจะตอบ `404`

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```
├── public/                 # หน้าบ้าน (Express เสิร์ฟโฟลเดอร์นี้)
│   ├── index.html          # หน้าแรก
│   ├── attendance.html     # หน้าลงเวลาทำงาน (เพิ่ม/แก้ไข)
│   ├── leave.html          # หน้าคำร้องขอลางาน (เพิ่ม/แก้ไข)
│   ├── history.html        # หน้าประวัติการทำงานและการลา
│   ├── about.html          # หน้าเกี่ยวกับ
│   ├── css/                # base.css (ฟอนต์) + สไตล์ของแต่ละหน้า
│   ├── js/                 # common.js (ฟังก์ชันที่ใช้ร่วมกัน) + สคริปต์ของแต่ละหน้า
│   ├── images/
│   └── fonts/              # ฟอนต์ Kanit (SIL Open Font License)
├── server/                 # หลังบ้าน (Node.js / Express)
│   ├── server.js
│   ├── package.json
│   └── Dockerfile
├── database/
│   └── schema.sql          # โครงสร้างตาราง attendance และ leave_requests
└── docker-compose.yml
```

---

## 👥 สมาชิกผู้พัฒนา (Developers)
* **Nuttaphat** ([@Catboyz-45](https://github.com/Catboyz-45))
* **Bannawat** ([@flame123-np](https://github.com/flame123-np))

*(หมายเหตุ: โปรเจกต์นี้เป็นส่วนหนึ่งของรายวิชา Internet Technology (02739241) ภาคการศึกษา 2567 กลุ่มเรียน 820)*
