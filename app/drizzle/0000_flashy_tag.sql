CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curator" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"closet_type" text NOT NULL,
	"closet_name" text NOT NULL,
	"intro" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text NOT NULL,
	"price" integer NOT NULL,
	"currency" text NOT NULL,
	"price_checked_at" text,
	"buy_url" text NOT NULL,
	"image" text,
	"image_rights" text,
	"image_rights_note" text,
	"size_note" text,
	"tags" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "look" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"source_outfit_id" text,
	"title" text NOT NULL,
	"request" text,
	"summary" text,
	"mode" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "look_item" (
	"look_id" text NOT NULL,
	"item_id" text NOT NULL,
	"position" integer NOT NULL,
	"reason" text,
	CONSTRAINT "look_item_look_id_item_id_pk" PRIMARY KEY("look_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "outfit" (
	"id" text PRIMARY KEY NOT NULL,
	"curator_id" text NOT NULL,
	"name" text NOT NULL,
	"style_note" text NOT NULL,
	"occasion_tags" text[] DEFAULT '{}' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outfit_item" (
	"outfit_id" text NOT NULL,
	"item_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "outfit_item_outfit_id_item_id_pk" PRIMARY KEY("outfit_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look" ADD CONSTRAINT "look_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look" ADD CONSTRAINT "look_source_outfit_id_outfit_id_fk" FOREIGN KEY ("source_outfit_id") REFERENCES "public"."outfit"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look_item" ADD CONSTRAINT "look_item_look_id_look_id_fk" FOREIGN KEY ("look_id") REFERENCES "public"."look"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "look_item" ADD CONSTRAINT "look_item_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit" ADD CONSTRAINT "outfit_curator_id_curator_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curator"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_item" ADD CONSTRAINT "outfit_item_outfit_id_outfit_id_fk" FOREIGN KEY ("outfit_id") REFERENCES "public"."outfit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outfit_item" ADD CONSTRAINT "outfit_item_item_id_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."item"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;