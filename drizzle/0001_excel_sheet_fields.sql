CREATE TYPE "public"."export_format" AS ENUM('pptx', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."release_date_type" AS ENUM('target', 'actual');--> statement-breakpoint
CREATE TYPE "public"."status_label" AS ENUM('To Start', 'On track', 'At risk', 'Blocked', 'Done');--> statement-breakpoint
ALTER TABLE "export_run" ADD COLUMN "format" "export_format" DEFAULT 'pptx' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "owner_short_name" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status_label" "status_label";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "release_date" date;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "release_date_type" "release_date_type";--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "release_date_note" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "queue_order" integer;--> statement-breakpoint
ALTER TABLE "weekly_update" ADD COLUMN "progress_this_week" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "owner_full_name" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "brand_config" jsonb DEFAULT '{}'::jsonb NOT NULL;