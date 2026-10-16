CREATE TABLE "tryon" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_look_id" text,
	"source_outfit_id" text,
	"outfit_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"item_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applied_categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"result_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tryon_consent" (
	"user_id" text PRIMARY KEY NOT NULL,
	"consent_version" text NOT NULL,
	"consent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tryon" ADD CONSTRAINT "tryon_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tryon_consent" ADD CONSTRAINT "tryon_consent_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tryon_user_idx" ON "tryon" USING btree ("user_id");