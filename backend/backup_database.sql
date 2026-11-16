/*
  BookstoreDB backup script (SQL Server / SSMS)

  ก่อนรัน:
  1) สร้างโฟลเดอร์ C:\SQLBackups บนเครื่องที่ SQL Server ทำงานอยู่
  2) ให้บัญชี service ของ SQL Server มีสิทธิ์เขียนโฟลเดอร์ดังกล่าว
  3) เปลี่ยน @BackupDirectory ได้ตามสภาพแวดล้อมจริง
*/
USE master;
GO

DECLARE @BackupDirectory nvarchar(260) = N'C:\SQLBackups\';
DECLARE @Stamp varchar(32) =
    CONVERT(char(8), GETDATE(), 112) + '_' +
    REPLACE(CONVERT(char(8), GETDATE(), 108), ':', '');
DECLARE @BackupFile nvarchar(4000) =
    @BackupDirectory + N'BookstoreDB_' + @Stamp + N'.bak';

IF DB_ID(N'BookstoreDB') IS NULL
    THROW 50001, N'ไม่พบฐานข้อมูล BookstoreDB', 1;

BACKUP DATABASE [BookstoreDB]
TO DISK = @BackupFile
WITH COPY_ONLY, CHECKSUM, COMPRESSION, STATS = 10;

RESTORE VERIFYONLY
FROM DISK = @BackupFile
WITH CHECKSUM;

SELECT @BackupFile AS BackupFile,
       N'Backup และ VERIFYONLY สำเร็จ' AS Result;
GO
