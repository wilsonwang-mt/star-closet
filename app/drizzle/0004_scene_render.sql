CREATE TABLE "scene_render" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"scene_id" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"image_key" text,
	"video_key" text,
	"video_status_url" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scene_render" ADD CONSTRAINT "scene_render_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scene_render_user_item_idx" ON "scene_render" USING btree ("user_id","item_id");