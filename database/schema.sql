-- โครงสร้างฐานข้อมูลของระบบลงเวลาทำงานและการลา (สำหรับ HR)
-- docker compose จะรันไฟล์นี้ให้อัตโนมัติตอนสร้างฐานข้อมูลครั้งแรก
-- ถ้าติดตั้ง MySQL เอง ให้ import ไฟล์นี้ผ่าน phpMyAdmin หรือ: mysql -u root -p < database/schema.sql
-- บัญชีผู้ดูแลระบบคนแรกจะถูกสร้างโดยเซิร์ฟเวอร์ตอนเริ่มทำงานครั้งแรก (ดู README)

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS `webdb`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `webdb`;

-- บัญชีผู้ใช้ของ HR (role: admin จัดการผู้ใช้/ตั้งค่า/ดู audit log ได้, hr ใช้งานทั่วไป)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(50) NOT NULL,
  `password_hash` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(100) NOT NULL,
  `role` ENUM('admin', 'hr') NOT NULL DEFAULT 'hr',
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `last_login_at` DATETIME NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ข้อมูลพนักงาน (ไม่ลบจริง ใช้ active = 0 เมื่อพนักงานลาออก)
CREATE TABLE IF NOT EXISTS `employees` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_code` VARCHAR(20) NOT NULL,
  `first_name` VARCHAR(100) NOT NULL,
  `last_name` VARCHAR(100) NOT NULL,
  `department` VARCHAR(100) NULL DEFAULT NULL,
  `position` VARCHAR(100) NULL DEFAULT NULL,
  `start_date` DATE NULL DEFAULT NULL,
  `active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_employees_code` (`employee_code`),
  KEY `idx_employees_department` (`department`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- การลงเวลาเข้า-ออกงาน (1 คน 1 รายการต่อวัน, ลบแบบ soft delete ด้วย deleted_at)
CREATE TABLE IF NOT EXISTS `attendance` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `date` DATE NOT NULL,
  `time_in` TIME NOT NULL,
  `time_out` TIME NULL DEFAULT NULL,
  `note` VARCHAR(255) NULL DEFAULT NULL,
  `source` ENUM('manual', 'import') NOT NULL DEFAULT 'manual',
  `created_by` INT NULL DEFAULT NULL,
  `updated_by` INT NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `deleted_by` INT NULL DEFAULT NULL,
  -- ค่าเป็น 1 เมื่อยังไม่ถูกลบ และเป็น NULL เมื่อถูกลบ เพื่อให้ unique key ด้านล่างนับเฉพาะรายการที่ยังใช้งาน
  `active_flag` TINYINT GENERATED ALWAYS AS (IF(`deleted_at` IS NULL, 1, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_employee_day` (`employee_id`, `date`, `active_flag`),
  KEY `idx_attendance_date` (`date`),
  CONSTRAINT `fk_attendance_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- คำขอลา (สถานะ: pending รออนุมัติ / approved อนุมัติ / rejected ไม่อนุมัติ)
-- การอนุมัติเกิดนอกระบบ (เช่น หัวหน้าเซ็นใบลา) HR เป็นผู้บันทึกผล:
--   approver_name = ผู้อนุมัติจริง (เช่น หัวหน้างาน), decided_by = บัญชี HR ที่บันทึกผล
CREATE TABLE IF NOT EXISTS `leave_requests` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `employee_id` INT NOT NULL,
  `leave_type` VARCHAR(50) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `half_day` TINYINT(1) NOT NULL DEFAULT 0,
  `reason` TEXT NOT NULL,
  `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  `status_note` VARCHAR(255) NULL DEFAULT NULL,
  `approver_name` VARCHAR(100) NULL DEFAULT NULL,
  `decided_by` INT NULL DEFAULT NULL,
  `decided_at` DATETIME NULL DEFAULT NULL,
  `created_by` INT NULL DEFAULT NULL,
  `updated_by` INT NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `deleted_by` INT NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_leave_employee_dates` (`employee_id`, `start_date`, `end_date`),
  KEY `idx_leave_status` (`status`),
  CONSTRAINT `fk_leave_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- วันหยุดนักขัตฤกษ์/วันหยุดบริษัท (ไม่นับเป็นวันทำงานและวันลา)
CREATE TABLE IF NOT EXISTS `holidays` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `date` DATE NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_holidays_date` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- การตั้งค่าระบบ เก็บเป็น key / ค่า JSON (ค่าเริ่มต้นอยู่ใน server/src/settings.js)
CREATE TABLE IF NOT EXISTS `settings` (
  `key` VARCHAR(50) NOT NULL,
  `value` TEXT NOT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- บันทึกว่าใครทำอะไรกับข้อมูลไหน เมื่อไหร่ (audit log)
CREATE TABLE IF NOT EXISTS `audit_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` INT NULL DEFAULT NULL,
  `username` VARCHAR(50) NULL DEFAULT NULL,
  `action` VARCHAR(30) NOT NULL,
  `entity` VARCHAR(30) NOT NULL,
  `entity_id` INT NULL DEFAULT NULL,
  `details` JSON NULL,
  `ip` VARCHAR(45) NULL DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_entity` (`entity`, `entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
