/*
  ╔══════════════════════════════════════════════════════════════════╗
  ║   Bookstore Management System — โครงงานระยะที่ 3                 ║
  ║   SQL Server / SSMS — สคริปต์สร้างฐานข้อมูล + ข้อมูลตัวอย่าง       ║
  ║   + Query อย่างน้อย 20 รายการ + รายงานสรุปผล 5 รายงาน             ║
  ║                                                                    ║
  ║   วิธีใช้: เปิดไฟล์นี้ใน SQL Server Management Studio แล้วกด        ║
  ║   Execute (F5) ทั้งไฟล์ จะได้ฐานข้อมูล BookstoreDB พร้อมข้อมูล      ║
  ║   ตัวอย่างสำหรับทดสอบ Query และรายงานทั้งหมดในเอกสารฉบับนี้          ║
  ╚══════════════════════════════════════════════════════════════════╝
*/

-- ══════════════════════════════════════════════════════════════════
-- ส่วนที่ 1: สร้างฐานข้อมูลและตาราง (โครงสร้างเดียวกับระยะที่ 2 — 3NF)
-- ══════════════════════════════════════════════════════════════════
IF DB_ID(N'BookstoreDB') IS NULL
BEGIN
    CREATE DATABASE BookstoreDB;
END
GO

USE BookstoreDB;
GO

IF OBJECT_ID(N'dbo.SystemUser',   N'U') IS NOT NULL DROP TABLE dbo.SystemUser;
IF OBJECT_ID(N'dbo.Shipment',     N'U') IS NOT NULL DROP TABLE dbo.Shipment;
IF OBJECT_ID(N'dbo.Payment',      N'U') IS NOT NULL DROP TABLE dbo.Payment;
IF OBJECT_ID(N'dbo.Order_Detail', N'U') IS NOT NULL DROP TABLE dbo.Order_Detail;
IF OBJECT_ID(N'dbo.Orders',       N'U') IS NOT NULL DROP TABLE dbo.Orders;
IF OBJECT_ID(N'dbo.Book_Author',  N'U') IS NOT NULL DROP TABLE dbo.Book_Author;
IF OBJECT_ID(N'dbo.Book_Category',N'U') IS NOT NULL DROP TABLE dbo.Book_Category;
IF OBJECT_ID(N'dbo.Book',         N'U') IS NOT NULL DROP TABLE dbo.Book;
IF OBJECT_ID(N'dbo.Author',       N'U') IS NOT NULL DROP TABLE dbo.Author;
IF OBJECT_ID(N'dbo.Category',     N'U') IS NOT NULL DROP TABLE dbo.Category;
IF OBJECT_ID(N'dbo.Customer',     N'U') IS NOT NULL DROP TABLE dbo.Customer;
GO

CREATE TABLE dbo.Customer (
    CustomerID   INT IDENTITY(1,1) NOT NULL,
    CustomerName NVARCHAR(100)     NOT NULL,
    Phone        VARCHAR(20)       NOT NULL,
    Email        VARCHAR(120)      NULL,
    Address      NVARCHAR(300)     NOT NULL,
    CONSTRAINT PK_Customer PRIMARY KEY (CustomerID)
);
GO
CREATE UNIQUE INDEX UQ_Customer_Email_Filtered ON dbo.Customer(Email) WHERE Email IS NOT NULL;
GO

CREATE TABLE dbo.Category (
    CategoryID   INT IDENTITY(1,1) NOT NULL,
    CategoryName NVARCHAR(80)      NOT NULL,
    CONSTRAINT PK_Category PRIMARY KEY (CategoryID),
    CONSTRAINT UQ_Category_CategoryName UNIQUE (CategoryName)
);
GO

CREATE TABLE dbo.Author (
    AuthorID   INT IDENTITY(1,1) NOT NULL,
    AuthorName NVARCHAR(120)     NOT NULL,
    CONSTRAINT PK_Author PRIMARY KEY (AuthorID),
    CONSTRAINT UQ_Author_AuthorName UNIQUE (AuthorName)
);
GO

CREATE TABLE dbo.Book (
    ISBN     VARCHAR(20)    NOT NULL,
    BookName NVARCHAR(200)  NOT NULL,
    Price    DECIMAL(10,2)  NOT NULL,
    Stock    INT            NOT NULL CONSTRAINT DF_Book_Stock DEFAULT (0),
    CONSTRAINT PK_Book PRIMARY KEY (ISBN),
    CONSTRAINT CK_Book_Price CHECK (Price >= 0),
    CONSTRAINT CK_Book_Stock CHECK (Stock >= 0)
);
GO

CREATE TABLE dbo.Book_Category (
    ISBN       VARCHAR(20) NOT NULL,
    CategoryID INT         NOT NULL,
    CONSTRAINT PK_Book_Category PRIMARY KEY (ISBN, CategoryID),
    CONSTRAINT FK_Book_Category_Book     FOREIGN KEY (ISBN)       REFERENCES dbo.Book     (ISBN)       ON DELETE CASCADE,
    CONSTRAINT FK_Book_Category_Category FOREIGN KEY (CategoryID) REFERENCES dbo.Category (CategoryID) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.Book_Author (
    ISBN     VARCHAR(20) NOT NULL,
    AuthorID INT         NOT NULL,
    CONSTRAINT PK_Book_Author PRIMARY KEY (ISBN, AuthorID),
    CONSTRAINT FK_Book_Author_Book   FOREIGN KEY (ISBN)     REFERENCES dbo.Book   (ISBN)     ON DELETE CASCADE,
    CONSTRAINT FK_Book_Author_Author FOREIGN KEY (AuthorID) REFERENCES dbo.Author (AuthorID) ON DELETE CASCADE
);
GO

CREATE TABLE dbo.Orders (
    OrderID    INT IDENTITY(1,1) NOT NULL,
    OrderDate  DATE              NOT NULL CONSTRAINT DF_Orders_OrderDate DEFAULT (CONVERT(date, GETDATE())),
    CustomerID INT               NOT NULL,
    CONSTRAINT PK_Orders PRIMARY KEY (OrderID),
    CONSTRAINT FK_Orders_Customer FOREIGN KEY (CustomerID) REFERENCES dbo.Customer (CustomerID)
);
GO

CREATE TABLE dbo.Order_Detail (
    OrderID   INT           NOT NULL,
    ISBN      VARCHAR(20)   NOT NULL,
    Quantity  INT           NOT NULL,
    UnitPrice DECIMAL(10,2) NOT NULL,
    CONSTRAINT PK_Order_Detail PRIMARY KEY (OrderID, ISBN),
    CONSTRAINT FK_Order_Detail_Orders FOREIGN KEY (OrderID) REFERENCES dbo.Orders (OrderID) ON DELETE CASCADE,
    CONSTRAINT FK_Order_Detail_Book   FOREIGN KEY (ISBN)    REFERENCES dbo.Book   (ISBN),
    CONSTRAINT CK_Order_Detail_Quantity  CHECK (Quantity > 0),
    CONSTRAINT CK_Order_Detail_UnitPrice CHECK (UnitPrice >= 0)
);
GO

CREATE TABLE dbo.Payment (
    PaymentID     INT IDENTITY(1,1) NOT NULL,
    PaymentDate   DATE              NULL,
    Amount        DECIMAL(10,2)     NOT NULL,
    PaymentMethod NVARCHAR(20)      NOT NULL,
    PaymentStatus NVARCHAR(20)      NOT NULL CONSTRAINT DF_Payment_PaymentStatus DEFAULT (N'รอชำระ'),
    OrderID       INT               NOT NULL,
    SlipImage     NVARCHAR(MAX)     NULL,
    CONSTRAINT PK_Payment PRIMARY KEY (PaymentID),
    CONSTRAINT UQ_Payment_OrderID UNIQUE (OrderID),
    CONSTRAINT FK_Payment_Orders FOREIGN KEY (OrderID) REFERENCES dbo.Orders (OrderID) ON DELETE CASCADE,
    CONSTRAINT CK_Payment_Amount CHECK (Amount >= 0),
    CONSTRAINT CK_Payment_Method CHECK (PaymentMethod IN (N'เงินสด', N'โอน', N'บัตร')),
    CONSTRAINT CK_Payment_PaymentStatus CHECK (PaymentStatus IN (N'รอชำระ', N'รอตรวจสอบ', N'ยืนยันแล้ว', N'ปฏิเสธ'))
);
GO

CREATE TABLE dbo.Shipment (
    ShipmentID      INT IDENTITY(1,1) NOT NULL,
    ShipDate        DATE              NOT NULL,
    TrackingNo      VARCHAR(50)       NULL,
    Status          NVARCHAR(30)      NOT NULL,
    Address         NVARCHAR(300)     NOT NULL,
    ShippingCompany NVARCHAR(100)     NULL,
    OrderID         INT               NOT NULL,
    CONSTRAINT PK_Shipment PRIMARY KEY (ShipmentID),
    CONSTRAINT UQ_Shipment_TrackingNo UNIQUE (TrackingNo),
    CONSTRAINT UQ_Shipment_OrderID    UNIQUE (OrderID),
    CONSTRAINT FK_Shipment_Orders FOREIGN KEY (OrderID) REFERENCES dbo.Orders (OrderID) ON DELETE CASCADE,
    CONSTRAINT CK_Shipment_Status CHECK (Status IN (N'รอจัดส่ง', N'กำลังจัดส่ง', N'จัดส่งแล้ว', N'ยกเลิก'))
);
GO

CREATE TABLE dbo.SystemUser (
    UserID       INT IDENTITY(1,1) NOT NULL,
    Username     NVARCHAR(60)      NOT NULL,
    PasswordHash VARCHAR(64)       NOT NULL,
    FullName     NVARCHAR(100)     NOT NULL,
    Role         NVARCHAR(30)      NOT NULL CONSTRAINT DF_SystemUser_Role DEFAULT (N'พนักงานขาย'),
    IsActive     BIT               NOT NULL CONSTRAINT DF_SystemUser_IsActive DEFAULT (1),
    CreatedAt    DATE              NOT NULL CONSTRAINT DF_SystemUser_CreatedAt DEFAULT (CONVERT(date, GETDATE())),
    CustomerID   INT               NULL,
    CONSTRAINT PK_SystemUser PRIMARY KEY (UserID),
    CONSTRAINT UQ_SystemUser_Username UNIQUE (Username),
    CONSTRAINT CK_SystemUser_Role CHECK (Role IN (N'Admin', N'พนักงานขาย', N'พนักงานจัดส่ง', N'ลูกค้า')),
    CONSTRAINT FK_SystemUser_Customer FOREIGN KEY (CustomerID) REFERENCES dbo.Customer (CustomerID) ON DELETE SET NULL
);
GO

-- ══════════════════════════════════════════════════════════════════
-- ส่วนที่ 2: ข้อมูลตัวอย่าง (ขยายเพิ่มจากระยะที่ 2 เพื่อให้ Query/รายงาน
--            ในระยะที่ 3 มีผลลัพธ์ที่มีความหมายสำหรับการวิเคราะห์)
-- ══════════════════════════════════════════════════════════════════
INSERT INTO dbo.Category (CategoryName) VALUES
(N'นิยาย'), (N'ธุรกิจ'), (N'เทคโนโลยี'), (N'พัฒนาตนเอง'), (N'การศึกษา');
GO

INSERT INTO dbo.Author (AuthorName) VALUES
(N'ศุภชัย นักเขียน'), (N'Anna Page'), (N'ธีรภัทร Code'), (N'Maya Bloom'),
(N'วิภาวดี เล่าเรื่อง'), (N'John Carter'), (N'สมหญิง ปัญญาดี'), (N'Liam Stone');
GO

INSERT INTO dbo.Customer (CustomerName, Phone, Email, Address) VALUES
(N'นภัสสร ใจดี', N'081-234-5678', N'napasorn@example.com', N'99/8 ถ.สีลม กรุงเทพฯ'),
(N'กิตติพงษ์ อ่านเพลิน', N'089-222-1144', N'kitti@example.com', N'12 ม.4 อ.เมือง เชียงใหม่'),
(N'มินตรา บุญมาก', N'082-777-4433', N'mintra@example.com', N'55/21 ถ.มิตรภาพ ขอนแก่น'),
(N'ธนกร ศรีสุข', N'086-111-2233', N'thanakorn@example.com', N'8/3 ถ.เพชรเกษม หาดใหญ่'),
(N'ปวีณา รักเรียน', N'090-555-6677', N'paweena@example.com', N'21 ถ.นิมมาน เชียงใหม่'),
(N'อัครพล ยิ่งยง', N'091-888-9900', N'akkarapon@example.com', N'17/2 ถ.บางนา กรุงเทพฯ'),
(N'ศิริพร แสงทอง', N'092-333-4455', N'siriporn@example.com', N'30 ถ.เจริญนคร กรุงเทพฯ'),
(N'วรรณวิสา ใจงาม', N'093-666-7788', N'wanwisa@example.com', N'9 ถ.มหาไชย นครปฐม'),
(N'ชานนท์ ตั้งมั่น', N'094-999-1122', N'chanon@example.com', N'44/5 ถ.สุขุมวิท ชลบุรี'),
(N'บุญเลิศ พูนทรัพย์', N'095-444-5566', NULL, N'2 ถ.ราชดำเนิน อุดรธานี');
GO

INSERT INTO dbo.Book (ISBN, BookName, Price, Stock) VALUES
(N'9786160000011', N'Node.js สำหรับระบบร้านค้า', 390.00, 18),
(N'9786160000028', N'SQL Design Workbook', 450.00, 12),
(N'9786160000035', N'นิยายร้านหนังสือยามค่ำ', 280.00, 30),
(N'9786160000042', N'คิดแบบเจ้าของธุรกิจ', 320.00, 20),
(N'9786160000059', N'Python สำหรับวิเคราะห์ข้อมูล', 420.00, 10),
(N'9786160000066', N'เส้นทางนักเขียนมือใหม่', 250.00, 14),
(N'9786160000073', N'การตลาดยุคดิจิทัล', 360.00, 9),
(N'9786160000080', N'พัฒนาตนเองใน 30 วัน', 270.00, 7),
(N'9786160000097', N'นิยายรักในสายฝน', 300.00, 25),
(N'9786160000103', N'คู่มือระบบฐานข้อมูล', 480.00, 5),
(N'9786160000110', N'ปรัชญาการใช้ชีวิต', 260.00, 16),
(N'9786160000127', N'เรียนรู้ Cloud Computing', 510.00, 8);
GO

INSERT INTO dbo.Book_Category (ISBN, CategoryID) VALUES
(N'9786160000011', 3),
(N'9786160000011', 5),
(N'9786160000028', 3),
(N'9786160000028', 5),
(N'9786160000035', 1),
(N'9786160000035', 4),
(N'9786160000042', 2),
(N'9786160000042', 4),
(N'9786160000059', 3),
(N'9786160000059', 5),
(N'9786160000066', 1),
(N'9786160000066', 4),
(N'9786160000073', 2),
(N'9786160000080', 4),
(N'9786160000097', 1),
(N'9786160000103', 3),
(N'9786160000103', 5),
(N'9786160000110', 4),
(N'9786160000127', 3);
GO

INSERT INTO dbo.Book_Author (ISBN, AuthorID) VALUES
(N'9786160000011', 3),
(N'9786160000028', 2),
(N'9786160000035', 1),
(N'9786160000035', 4),
(N'9786160000042', 2),
(N'9786160000059', 6),
(N'9786160000066', 5),
(N'9786160000073', 7),
(N'9786160000080', 7),
(N'9786160000097', 5),
(N'9786160000103', 3),
(N'9786160000103', 8),
(N'9786160000110', 8),
(N'9786160000127', 6);
GO

INSERT INTO dbo.Orders (OrderDate, CustomerID) VALUES
(N'2026-06-20', 1),
(N'2026-06-21', 2),
(N'2026-06-25', 3),
(N'2026-06-28', 1),
(N'2026-07-02', 4),
(N'2026-07-03', 2),
(N'2026-07-05', 5),
(N'2026-07-06', 1),
(N'2026-07-09', 6),
(N'2026-07-10', 7),
(N'2026-07-12', 3),
(N'2026-07-14', 8),
(N'2026-07-15', 2),
(N'2026-07-16', 9),
(N'2026-07-17', 5),
(N'2026-07-18', 1),
(N'2026-05-15', 3),
(N'2026-05-20', 4),
(N'2026-05-22', 6),
(N'2026-04-10', 2);
GO

INSERT INTO dbo.Order_Detail (OrderID, ISBN, Quantity, UnitPrice) VALUES
(1, N'9786160000011', 3, 390.00),
(2, N'9786160000042', 2, 320.00),
(3, N'9786160000103', 1, 480.00),
(4, N'9786160000011', 2, 390.00),
(4, N'9786160000073', 1, 360.00),
(4, N'9786160000103', 2, 480.00),
(5, N'9786160000011', 2, 390.00),
(5, N'9786160000042', 4, 320.00),
(5, N'9786160000110', 4, 260.00),
(6, N'9786160000011', 3, 390.00),
(6, N'9786160000035', 3, 280.00),
(6, N'9786160000059', 4, 420.00),
(7, N'9786160000042', 3, 320.00),
(8, N'9786160000028', 4, 450.00),
(9, N'9786160000066', 3, 250.00),
(10, N'9786160000011', 4, 390.00),
(10, N'9786160000059', 1, 420.00),
(10, N'9786160000097', 1, 300.00),
(11, N'9786160000042', 2, 320.00),
(11, N'9786160000059', 1, 420.00),
(11, N'9786160000066', 1, 250.00),
(12, N'9786160000028', 1, 450.00),
(12, N'9786160000042', 4, 320.00),
(13, N'9786160000066', 3, 250.00),
(13, N'9786160000097', 2, 300.00),
(14, N'9786160000042', 1, 320.00),
(14, N'9786160000059', 2, 420.00),
(15, N'9786160000035', 3, 280.00),
(15, N'9786160000042', 4, 320.00),
(15, N'9786160000097', 2, 300.00),
(16, N'9786160000011', 1, 390.00),
(16, N'9786160000042', 3, 320.00),
(17, N'9786160000028', 3, 450.00),
(17, N'9786160000059', 2, 420.00),
(18, N'9786160000097', 4, 300.00),
(19, N'9786160000035', 2, 280.00),
(19, N'9786160000059', 2, 420.00),
(20, N'9786160000059', 3, 420.00),
(20, N'9786160000073', 2, 360.00),
(20, N'9786160000103', 4, 480.00);
GO

INSERT INTO dbo.Payment (PaymentDate, Amount, PaymentMethod, PaymentStatus, OrderID) VALUES
(N'2026-06-20', 1170.00, N'บัตร', N'ยืนยันแล้ว', 1),
(NULL, 640.00, N'เงินสด', N'รอตรวจสอบ', 2),
(N'2026-06-25', 480.00, N'เงินสด', N'ยืนยันแล้ว', 3),
(N'2026-06-28', 2100.00, N'บัตร', N'ยืนยันแล้ว', 4),
(N'2026-07-02', 3100.00, N'บัตร', N'ยืนยันแล้ว', 5),
(NULL, 3690.00, N'บัตร', N'รอตรวจสอบ', 6),
(N'2026-07-05', 960.00, N'โอน', N'ยืนยันแล้ว', 7),
(NULL, 1800.00, N'บัตร', N'รอตรวจสอบ', 8),
(NULL, 750.00, N'บัตร', N'รอตรวจสอบ', 9),
(N'2026-07-10', 2280.00, N'บัตร', N'ยืนยันแล้ว', 10),
(N'2026-07-12', 1310.00, N'บัตร', N'ยืนยันแล้ว', 11),
(N'2026-07-14', 1730.00, N'บัตร', N'ยืนยันแล้ว', 12),
(NULL, 1350.00, N'โอน', N'รอชำระ', 13),
(N'2026-07-16', 1160.00, N'เงินสด', N'ยืนยันแล้ว', 14),
(N'2026-07-17', 2720.00, N'โอน', N'ยืนยันแล้ว', 15),
(N'2026-07-18', 1350.00, N'โอน', N'ยืนยันแล้ว', 16),
(N'2026-05-15', 2190.00, N'บัตร', N'ยืนยันแล้ว', 17),
(N'2026-05-20', 1200.00, N'บัตร', N'ยืนยันแล้ว', 18),
(N'2026-05-22', 1400.00, N'บัตร', N'ยืนยันแล้ว', 19),
(N'2026-04-10', 3900.00, N'บัตร', N'ยืนยันแล้ว', 20);
GO

INSERT INTO dbo.Shipment (ShipDate, TrackingNo, Status, Address, ShippingCompany, OrderID) VALUES
(N'2026-06-20', N'TH00000001', N'กำลังจัดส่ง', N'99/8 ถ.สีลม กรุงเทพฯ', N'Flash', 1),
(N'2026-06-21', N'TH00000002', N'จัดส่งแล้ว', N'12 ม.4 อ.เมือง เชียงใหม่', N'J&T', 2),
(N'2026-06-25', N'TH00000003', N'จัดส่งแล้ว', N'55/21 ถ.มิตรภาพ ขอนแก่น', N'Kerry', 3),
(N'2026-06-28', N'TH00000004', N'กำลังจัดส่ง', N'99/8 ถ.สีลม กรุงเทพฯ', N'ไปรษณีย์ไทย', 4),
(N'2026-07-02', N'TH00000005', N'จัดส่งแล้ว', N'8/3 ถ.เพชรเกษม หาดใหญ่', N'Kerry', 5),
(N'2026-07-03', N'TH00000006', N'กำลังจัดส่ง', N'12 ม.4 อ.เมือง เชียงใหม่', N'J&T', 6),
(N'2026-07-05', N'TH00000007', N'จัดส่งแล้ว', N'21 ถ.นิมมาน เชียงใหม่', N'Kerry', 7),
(N'2026-07-06', N'TH00000008', N'จัดส่งแล้ว', N'99/8 ถ.สีลม กรุงเทพฯ', N'Kerry', 8),
(N'2026-07-09', N'TH00000009', N'จัดส่งแล้ว', N'17/2 ถ.บางนา กรุงเทพฯ', N'ไปรษณีย์ไทย', 9),
(N'2026-07-10', N'TH00000010', N'จัดส่งแล้ว', N'30 ถ.เจริญนคร กรุงเทพฯ', N'Flash', 10),
(N'2026-07-12', N'TH00000011', N'จัดส่งแล้ว', N'55/21 ถ.มิตรภาพ ขอนแก่น', N'ไปรษณีย์ไทย', 11),
(N'2026-07-14', N'TH00000012', N'จัดส่งแล้ว', N'9 ถ.มหาไชย นครปฐม', N'J&T', 12),
(N'2026-07-15', N'TH00000013', N'รอจัดส่ง', N'12 ม.4 อ.เมือง เชียงใหม่', N'Flash', 13),
(N'2026-07-16', N'TH00000014', N'จัดส่งแล้ว', N'44/5 ถ.สุขุมวิท ชลบุรี', N'J&T', 14),
(N'2026-07-17', N'TH00000015', N'รอจัดส่ง', N'21 ถ.นิมมาน เชียงใหม่', N'J&T', 15),
(N'2026-07-18', N'TH00000016', N'รอจัดส่ง', N'99/8 ถ.สีลม กรุงเทพฯ', N'ไปรษณีย์ไทย', 16),
(N'2026-05-15', N'TH00000017', N'จัดส่งแล้ว', N'55/21 ถ.มิตรภาพ ขอนแก่น', N'Flash', 17),
(N'2026-05-20', N'TH00000018', N'จัดส่งแล้ว', N'8/3 ถ.เพชรเกษม หาดใหญ่', N'Kerry', 18),
(N'2026-05-22', N'TH00000019', N'กำลังจัดส่ง', N'17/2 ถ.บางนา กรุงเทพฯ', N'Kerry', 19),
(N'2026-04-10', N'TH00000020', N'จัดส่งแล้ว', N'12 ม.4 อ.เมือง เชียงใหม่', N'Flash', 20);
GO

-- ══════════════════════════════════════════════════════════════════
-- SystemUser เริ่มต้น (Login/Role-Based Access Control)
--   admin       → admin1234
--   staff1      → staff1234
--   delivery1   → delivery1234
-- ══════════════════════════════════════════════════════════════════
INSERT INTO dbo.SystemUser (Username, PasswordHash, FullName, Role, CustomerID) VALUES
('admin',     '968cc16e10677fb8c883d6ce7a133bb32fd769dd501381451fbdeeea530f0c32', N'ผู้ดูแลระบบ',     N'Admin',           NULL),
('staff1',    '2ae1793aae38bd662693b368c927d5f511069495d3d785d093004f10f969cb0d', N'พนักงานขาย 1',    N'พนักงานขาย',      NULL),
('delivery1', '1acef28b71d81f0342002ec4dd9a50527ba685fb2684d5ae195b7bd507272777', N'พนักงานจัดส่ง 1', N'พนักงานจัดส่ง',   NULL);
GO


/* ════════════════════════════════════════════════════════════════════════════════
   ส่วนที่ 3: SQL QUERY สำหรับโครงงานระยะที่ 3 (รวม 22 Query)
   ครอบคลุม: SELECT, WHERE, LIKE, ORDER BY, GROUP BY, HAVING,
             INNER JOIN, LEFT JOIN, RIGHT JOIN, Aggregate Function, Subquery
   ════════════════════════════════════════════════════════════════════════════════ */

-- ── หมวด SELECT + WHERE ──────────────────────────────────────────
-- Query 1: หนังสือที่ราคามากกว่า 400 บาท
SELECT ISBN, BookName, Price, Stock
FROM dbo.Book
WHERE Price > 400
ORDER BY Price DESC;
GO

-- ── หมวด SELECT + WHERE + LIKE ───────────────────────────────────
-- Query 2: ค้นหาหนังสือที่ชื่อมีคำว่า "นิยาย"
SELECT ISBN, BookName, Price
FROM dbo.Book
WHERE BookName LIKE N'%นิยาย%';
GO

-- Query 3: ค้นหาลูกค้าที่เบอร์โทรศัพท์ขึ้นต้นด้วย "08"
SELECT CustomerName, Phone
FROM dbo.Customer
WHERE Phone LIKE '08%'
ORDER BY CustomerName;
GO

-- ── หมวด ORDER BY ─────────────────────────────────────────────────
-- Query 4: รายชื่อลูกค้าเรียงตามชื่อ (A-Z)
SELECT CustomerID, CustomerName, Phone
FROM dbo.Customer
ORDER BY CustomerName ASC;
GO

-- Query 5: หนังสือ 5 อันดับราคาแพงที่สุด (ORDER BY หลายคอลัมน์ + TOP)
SELECT TOP 5 BookName, Price, Stock
FROM dbo.Book
ORDER BY Price DESC, Stock ASC;
GO

-- ── หมวด GROUP BY ─────────────────────────────────────────────────
-- Query 6: ยอดขายรวม (จำนวนเล่ม) แยกตามหนังสือ
SELECT b.BookName, SUM(od.Quantity) AS TotalQty
FROM dbo.Order_Detail od
JOIN dbo.Book b ON b.ISBN = od.ISBN
GROUP BY b.BookName
ORDER BY TotalQty DESC;
GO

-- ── หมวด GROUP BY + HAVING ────────────────────────────────────────
-- Query 7: หนังสือที่มียอดขายรวมมากกว่า 5 เล่ม
SELECT b.BookName, SUM(od.Quantity) AS TotalQty
FROM dbo.Order_Detail od
JOIN dbo.Book b ON b.ISBN = od.ISBN
GROUP BY b.BookName
HAVING SUM(od.Quantity) > 5
ORDER BY TotalQty DESC;
GO

-- Query 8: ลูกค้าที่มีจำนวนคำสั่งซื้อมากกว่า 1 ครั้ง
SELECT c.CustomerName, COUNT(o.OrderID) AS OrderCount
FROM dbo.Orders o
JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
GROUP BY c.CustomerName
HAVING COUNT(o.OrderID) > 1
ORDER BY OrderCount DESC;
GO

-- ── หมวด INNER JOIN ───────────────────────────────────────────────
-- Query 9: รายการคำสั่งซื้อพร้อมชื่อลูกค้า
SELECT o.OrderID, o.OrderDate, c.CustomerName
FROM dbo.Orders o
INNER JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
ORDER BY o.OrderID;
GO

-- Query 10: รายละเอียดคำสั่งซื้อพร้อมชื่อหนังสือและชื่อลูกค้า (INNER JOIN หลายตาราง)
SELECT o.OrderID, c.CustomerName, b.BookName, od.Quantity, od.UnitPrice
FROM dbo.Order_Detail od
INNER JOIN dbo.Orders   o ON o.OrderID   = od.OrderID
INNER JOIN dbo.Customer c ON c.CustomerID = o.CustomerID
INNER JOIN dbo.Book     b ON b.ISBN      = od.ISBN
ORDER BY o.OrderID;
GO

-- ── หมวด LEFT JOIN ────────────────────────────────────────────────
-- Query 11: หนังสือทุกเล่มพร้อมยอดขายรวม (รวมเล่มที่ยังไม่เคยขายเลย)
SELECT b.BookName, ISNULL(SUM(od.Quantity), 0) AS TotalSold
FROM dbo.Book b
LEFT JOIN dbo.Order_Detail od ON od.ISBN = b.ISBN
GROUP BY b.BookName
ORDER BY TotalSold DESC;
GO

-- Query 12: ลูกค้าทุกคนพร้อมจำนวนคำสั่งซื้อ (รวมลูกค้าที่ยังไม่เคยสั่งซื้อ)
SELECT c.CustomerName, COUNT(o.OrderID) AS OrderCount
FROM dbo.Customer c
LEFT JOIN dbo.Orders o ON o.CustomerID = c.CustomerID
GROUP BY c.CustomerName
ORDER BY OrderCount DESC;
GO

-- ── หมวด RIGHT JOIN ───────────────────────────────────────────────
-- Query 13: หมวดหมู่ทั้งหมดพร้อมจำนวนหนังสือในหมวด (รวมหมวดที่ยังไม่มีหนังสือ)
SELECT cat.CategoryName, COUNT(bc.ISBN) AS BookCount
FROM dbo.Book_Category bc
RIGHT JOIN dbo.Category cat ON cat.CategoryID = bc.CategoryID
GROUP BY cat.CategoryName
ORDER BY BookCount DESC;
GO

-- Query 14: คำสั่งซื้อทั้งหมดพร้อมสถานะการชำระเงิน (คำสั่งซื้อทุกใบต้องปรากฏ)
SELECT o.OrderID, o.OrderDate, p.PaymentStatus, p.Amount
FROM dbo.Payment p
RIGHT JOIN dbo.Orders o ON o.OrderID = p.OrderID
ORDER BY o.OrderID;
GO

-- ── หมวด Aggregate Function ──────────────────────────────────────
-- Query 15: ยอดขายรวมทั้งหมด (SUM) เฉพาะรายการที่ชำระเงินยืนยันแล้ว
SELECT SUM(Amount) AS TotalRevenue
FROM dbo.Payment
WHERE PaymentStatus = N'ยืนยันแล้ว';
GO

-- Query 16: มูลค่าคำสั่งซื้อเฉลี่ยต่อออเดอร์ (AVG)
SELECT AVG(od_total) AS AvgOrderValue
FROM (
    SELECT OrderID, SUM(Quantity * UnitPrice) AS od_total
    FROM dbo.Order_Detail
    GROUP BY OrderID
) t;
GO

-- Query 17: ราคาหนังสือสูงสุดและต่ำสุด (MAX, MIN)
SELECT MAX(Price) AS MaxPrice, MIN(Price) AS MinPrice
FROM dbo.Book;
GO

-- Query 18: จำนวนคำสั่งซื้อทั้งหมดในระบบ (COUNT)
SELECT COUNT(*) AS TotalOrders
FROM dbo.Orders;
GO

-- ── หมวด Subquery ─────────────────────────────────────────────────
-- Query 19: ลูกค้าที่มียอดใช้จ่ายรวมมากกว่าค่าเฉลี่ยของลูกค้าทั้งหมด
SELECT c.CustomerName, SUM(od.Quantity * od.UnitPrice) AS TotalSpent
FROM dbo.Customer c
JOIN dbo.Orders o       ON o.CustomerID = c.CustomerID
JOIN dbo.Order_Detail od ON od.OrderID  = o.OrderID
GROUP BY c.CustomerName
HAVING SUM(od.Quantity * od.UnitPrice) > (
    SELECT AVG(t.TotalSpent)
    FROM (
        SELECT o2.CustomerID, SUM(od2.Quantity * od2.UnitPrice) AS TotalSpent
        FROM dbo.Orders o2
        JOIN dbo.Order_Detail od2 ON od2.OrderID = o2.OrderID
        GROUP BY o2.CustomerID
    ) t
)
ORDER BY TotalSpent DESC;
GO

-- Query 20: หนังสือที่ยังไม่เคยถูกสั่งซื้อเลย (Subquery + NOT IN)
SELECT BookName, Stock
FROM dbo.Book
WHERE ISBN NOT IN (SELECT DISTINCT ISBN FROM dbo.Order_Detail);
GO

-- Query 21: ลูกค้าที่มีจำนวนคำสั่งซื้อสูงสุด 5 อันดับแรก (Correlated Subquery)
SELECT TOP 5 c.CustomerName,
    (SELECT COUNT(*) FROM dbo.Orders o WHERE o.CustomerID = c.CustomerID) AS OrderCount
FROM dbo.Customer c
ORDER BY OrderCount DESC;
GO

-- Query 22: ยอดขายรวมแยกตามหมวดหมู่หนังสือ (GROUP BY + JOIN หลายตาราง)
SELECT cat.CategoryName, SUM(od.Quantity * od.UnitPrice) AS Revenue
FROM dbo.Order_Detail od
JOIN dbo.Book_Category bc ON bc.ISBN = od.ISBN
JOIN dbo.Category cat     ON cat.CategoryID = bc.CategoryID
GROUP BY cat.CategoryName
ORDER BY Revenue DESC;
GO


/* ════════════════════════════════════════════════════════════════════════════════
   ส่วนที่ 4: รายงาน (Reports) 5 รายงานตามที่กำหนด
   ════════════════════════════════════════════════════════════════════════════════ */

-- ── รายงานที่ 1: รายงานลูกค้า ─────────────────────────────────────
SELECT c.CustomerID, c.CustomerName, c.Phone, c.Email,
       COUNT(DISTINCT o.OrderID) AS OrderCount,
       ISNULL(SUM(od.Quantity * od.UnitPrice), 0) AS TotalSpent
FROM dbo.Customer c
LEFT JOIN dbo.Orders o        ON o.CustomerID = c.CustomerID
LEFT JOIN dbo.Order_Detail od ON od.OrderID   = o.OrderID
GROUP BY c.CustomerID, c.CustomerName, c.Phone, c.Email
ORDER BY TotalSpent DESC;
GO

-- ── รายงานที่ 2: รายงานสินค้า (หนังสือ) ────────────────────────────
SELECT b.ISBN, b.BookName, b.Price, b.Stock,
       STRING_AGG(cat.CategoryName, N', ') AS Categories,
       ISNULL(SUM(od.Quantity), 0) AS TotalSold
FROM dbo.Book b
LEFT JOIN dbo.Book_Category bc ON bc.ISBN = b.ISBN
LEFT JOIN dbo.Category cat     ON cat.CategoryID = bc.CategoryID
LEFT JOIN dbo.Order_Detail od  ON od.ISBN = b.ISBN
GROUP BY b.ISBN, b.BookName, b.Price, b.Stock
ORDER BY b.BookName;
GO

-- ── รายงานที่ 3: รายงานยอดขาย (สรุปยอดขายรายเดือน) ──────────────────
SELECT FORMAT(o.OrderDate, 'yyyy-MM') AS SaleMonth,
       COUNT(DISTINCT o.OrderID) AS OrderCount,
       SUM(od.Quantity * od.UnitPrice) AS Revenue
FROM dbo.Orders o
JOIN dbo.Order_Detail od ON od.OrderID = o.OrderID
GROUP BY FORMAT(o.OrderDate, 'yyyy-MM')
ORDER BY SaleMonth;
GO

-- ── รายงานที่ 4: รายงานสินค้าขายดี (Top 5 ตามจำนวนเล่มที่ขายได้) ────
SELECT TOP 5 b.BookName,
       SUM(od.Quantity) AS TotalQty,
       SUM(od.Quantity * od.UnitPrice) AS Revenue
FROM dbo.Order_Detail od
JOIN dbo.Book b ON b.ISBN = od.ISBN
GROUP BY b.BookName
ORDER BY TotalQty DESC;
GO

-- ── รายงานที่ 5: รายงานลูกค้าที่มียอดซื้อสูงสุด (Top 5) ──────────────
SELECT TOP 5 c.CustomerName,
       COUNT(DISTINCT o.OrderID) AS OrderCount,
       SUM(od.Quantity * od.UnitPrice) AS TotalSpent
FROM dbo.Customer c
JOIN dbo.Orders o        ON o.CustomerID = c.CustomerID
JOIN dbo.Order_Detail od ON od.OrderID   = o.OrderID
GROUP BY c.CustomerName
ORDER BY TotalSpent DESC;
GO
