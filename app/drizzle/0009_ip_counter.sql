CREATE TABLE "ip_counter" (
	"ip_hash" text NOT NULL,
	"day" text NOT NULL,
	"kind" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ip_counter_ip_hash_day_kind_pk" PRIMARY KEY("ip_hash","day","kind")
);
