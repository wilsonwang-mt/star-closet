CREATE TABLE "usage_counter" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counter_user_id_day_kind_pk" PRIMARY KEY("user_id","day","kind")
);
--> statement-breakpoint
ALTER TABLE "usage_counter" ADD CONSTRAINT "usage_counter_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;