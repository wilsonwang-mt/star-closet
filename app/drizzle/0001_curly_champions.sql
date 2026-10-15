CREATE TABLE "avatar_job" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"provider" text DEFAULT 'mock' NOT NULL,
	"input_photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consent_version" text,
	"consent_at" timestamp with time zone,
	"result_glb_key" text,
	"result_preview_key" text,
	"fidelity_note" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "avatar_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"slot" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer,
	"height" integer,
	"bytes" integer,
	"quality_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"display_name" text,
	"bio" text,
	"style_tags" text[] DEFAULT '{}' NOT NULL,
	"favorite_colors" text[] DEFAULT '{}' NOT NULL,
	"size_top" text,
	"size_bottom" text,
	"size_shoe" text,
	"height_cm" integer,
	"weight_kg" integer,
	"body_data_consent" boolean DEFAULT false NOT NULL,
	"body_data_consent_at" timestamp with time zone,
	"budget_min" integer,
	"budget_max" integer,
	"city" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "avatar_job" ADD CONSTRAINT "avatar_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "avatar_photo" ADD CONSTRAINT "avatar_photo_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "avatar_job_user_idx" ON "avatar_job" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "avatar_photo_user_idx" ON "avatar_photo" USING btree ("user_id");