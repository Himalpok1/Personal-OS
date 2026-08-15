CREATE TABLE "worker_heartbeat" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_beat_at" timestamp with time zone,
	"status" text DEFAULT 'unknown' NOT NULL,
	CONSTRAINT "worker_heartbeat_singleton" CHECK ("worker_heartbeat"."id" = 1)
);
