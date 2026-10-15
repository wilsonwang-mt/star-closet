ALTER TABLE "avatar_job" ADD COLUMN "provider_task_id" text;--> statement-breakpoint
ALTER TABLE "avatar_job" ADD COLUMN "provider_status_url" text;--> statement-breakpoint
ALTER TABLE "avatar_photo" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "gender" text DEFAULT '女装' NOT NULL;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "style_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "palette" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "avatar" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "cover_wide" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "video" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "video_poster" text;--> statement-breakpoint
ALTER TABLE "curator" ADD COLUMN "persona_note" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "curator_id" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "gender" text DEFAULT '女装' NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "display_category" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "subcategory" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "color_family" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "material" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "fit" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "heel" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "sizes" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "style_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "occasion_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "search_keyword" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "buy_label" text;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "price_note" text;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "gender" text DEFAULT '女装' NOT NULL;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "style_tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "season" text;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "budget_tier" text;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "outfit" ADD COLUMN "cover_note" text;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_curator_id_curator_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "item_curator_idx" ON "item" USING btree ("curator_id");--> statement-breakpoint
CREATE INDEX "item_gender_idx" ON "item" USING btree ("gender");--> statement-breakpoint
CREATE INDEX "outfit_curator_idx" ON "outfit" USING btree ("curator_id");