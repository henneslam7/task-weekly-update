CREATE TYPE "public"."export_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."file_kind" AS ENUM('template', 'export');--> statement-breakpoint
CREATE TYPE "public"."request_outcome" AS ENUM('accepted', 'redirected', 'declined');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('green', 'amber', 'red', 'done');--> statement-breakpoint
CREATE TYPE "public"."rag" AS ENUM('green', 'amber', 'red');--> statement-breakpoint
CREATE TYPE "public"."update_kind" AS ENUM('progress', 'task', 'blocker');--> statement-breakpoint
CREATE TYPE "public"."update_status" AS ENUM('open', 'done', 'blocked');--> statement-breakpoint
CREATE TABLE "achievement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid,
	"title" text NOT NULL,
	"what_was_done" text NOT NULL,
	"metric" text,
	"period" text,
	"achieved_on" date NOT NULL,
	"cv_bullet" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"file_id" uuid,
	"status" "export_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"blob_pathname" text NOT NULL,
	"kind" "file_kind" NOT NULL,
	"original_name" text,
	"bytes" integer,
	"week_start" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" "priority" DEFAULT 'P2' NOT NULL,
	"status" "project_status" DEFAULT 'green' NOT NULL,
	"progress_pct" integer DEFAULT 0 NOT NULL,
	"due_date" date,
	"requester" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"from_person" text NOT NULL,
	"summary" text NOT NULL,
	"outcome" "request_outcome" NOT NULL,
	"redirected_to" text,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_update" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"kind" "update_kind" DEFAULT 'progress' NOT NULL,
	"title" text,
	"wins" text,
	"progress" text,
	"next_steps" text,
	"blockers" text,
	"support_needed" text,
	"rag" "rag",
	"status" "update_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievement" ADD CONSTRAINT "achievement_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "achievement" ADD CONSTRAINT "achievement_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_log" ADD CONSTRAINT "request_log_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_update" ADD CONSTRAINT "weekly_update_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_update" ADD CONSTRAINT "weekly_update_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "achievement_ws_title_day_uq" ON "achievement" USING btree ("workspace_id","title","achieved_on");--> statement-breakpoint
CREATE UNIQUE INDEX "project_ws_name_uq" ON "project" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "request_log_dedupe_uq" ON "request_log" USING btree ("workspace_id","received_on","from_person","summary");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_update_progress_uq" ON "weekly_update" USING btree ("workspace_id","project_id","week_start") WHERE "weekly_update"."kind" = 'progress';--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_update_item_uq" ON "weekly_update" USING btree ("workspace_id","project_id","week_start","kind","title") WHERE "weekly_update"."kind" <> 'progress';--> statement-breakpoint
CREATE INDEX "weekly_update_week_idx" ON "weekly_update" USING btree ("workspace_id","week_start");--> statement-breakpoint
INSERT INTO "workspace" ("id", "name") VALUES ('00000000-0000-4000-8000-000000000001', 'Default') ON CONFLICT ("id") DO NOTHING;
