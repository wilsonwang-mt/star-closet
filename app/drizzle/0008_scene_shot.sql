CREATE TABLE "scene_shot" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"tryon_id" text NOT NULL,
	"outfit_id" text,
	"scene_id" text,
	"pose" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"image_key" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spend_day" (
	"day" text NOT NULL,
	"bucket" text NOT NULL,
	"micro_usd" integer DEFAULT 0 NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "spend_day_day_bucket_pk" PRIMARY KEY("day","bucket")
);
--> statement-breakpoint
ALTER TABLE "scene_shot" ADD CONSTRAINT "scene_shot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_shot_user_tryon_idx" ON "scene_shot" USING btree ("user_id","tryon_id");--> statement-breakpoint
CREATE INDEX "scene_shot_user_outfit_idx" ON "scene_shot" USING btree ("user_id","outfit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scene_shot_one_processing_idx" ON "scene_shot" USING btree ("user_id") WHERE "scene_shot"."status" = 'processing';