-- ---------------------------------------------------------------------------
-- Runs once, on the first initialisation of the MySQL data volume.
--
-- Schema objects are NOT created here: every table comes from a Knex migration
-- so that local, staging and production share one ordered, reversible history.
-- This file only prepares the database and the application user.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS employee_portal
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- A separate database for integration and Newman runs, so a test teardown can
-- truncate freely without touching demo data.
CREATE DATABASE IF NOT EXISTS employee_portal_test
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

-- The compose environment creates `portal` already; this grant covers the test
-- database and is idempotent.
GRANT ALL PRIVILEGES ON employee_portal.*      TO 'portal'@'%';
GRANT ALL PRIVILEGES ON employee_portal_test.* TO 'portal'@'%';

FLUSH PRIVILEGES;

-- Confirm recursive CTE support is available for the org-chart query; MySQL 8
-- has it, and this line makes a downgrade to 5.7 fail loudly at container init.
SELECT VERSION() AS mysql_version;
