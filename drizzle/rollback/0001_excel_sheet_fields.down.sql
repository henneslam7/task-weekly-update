-- Manual rollback for 0001_excel_sheet_fields (NOT applied by drizzle-kit; run by hand if needed).
-- Drops only the columns/types added by 0001. Existing weekly updates, projects and exports are untouched;
-- the data that lived in the dropped columns (status_label, release date, progress_this_week ...) is lost.
ALTER TABLE "workspace" DROP COLUMN "brand_config";
ALTER TABLE "workspace" DROP COLUMN "owner_full_name";
ALTER TABLE "weekly_update" DROP COLUMN "progress_this_week";
ALTER TABLE "project" DROP COLUMN "queue_order";
ALTER TABLE "project" DROP COLUMN "release_date_note";
ALTER TABLE "project" DROP COLUMN "release_date_type";
ALTER TABLE "project" DROP COLUMN "release_date";
ALTER TABLE "project" DROP COLUMN "status_label";
ALTER TABLE "project" DROP COLUMN "owner_short_name";
ALTER TABLE "export_run" DROP COLUMN "format";
DROP TYPE "public"."status_label";
DROP TYPE "public"."release_date_type";
DROP TYPE "public"."export_format";
-- Also remove the journal row so drizzle-kit would re-apply it: DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
