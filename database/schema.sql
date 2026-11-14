-- โครงสร้างฐานข้อมูลของระบบลงเวลาทำงานและการลา
-- docker compose จะรันไฟล์นี้ให้อัตโนมัติตอนสร้างฐานข้อมูลครั้งแรก
-- ถ้าติดตั้ง MySQL เอง ให้ import ไฟล์นี้ผ่าน phpMyAdmin หรือ: mysql -u root -p < database/schema.sql

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `webdb`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `webdb`;

-- ข้อมูลการลงเวลาเข้า-ออกงาน (time_out ว่างได้ = ลงเวลาเข้างานแล้วแต่ยังไม่ออกงาน)
CREATE TABLE IF NOT EXISTS `attendance` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `date` DATE NOT NULL,
  `time_in` TIME NOT NULL,
  `time_out` TIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_attendance_employee_date` (`employee_id`, `date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- คำขอลา
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `leave_type` VARCHAR(50) NOT NULL,
  `reason` TEXT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_leave_employee_start` (`employee_id`, `start_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
