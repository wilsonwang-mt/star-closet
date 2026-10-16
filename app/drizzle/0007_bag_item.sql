CREATE TABLE "bag_item" (
	"user_id" text NOT NULL,
	"item_id" text NOT NULL,
	"size" text DEFAULT '' NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bag_item_user_id_item_id_size_pk" PRIMARY KEY("user_id","item_id","size")
);
--> statement-breakpoint
ALTER TABLE "bag_item" ADD CONSTRAINT "bag_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;