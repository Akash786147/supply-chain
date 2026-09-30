CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"repo_url" text NOT NULL,
	"branch" text DEFAULT 'main',
	"ecosystem" text DEFAULT 'npm',
	"status" text DEFAULT 'pending',
	"risk_level" text DEFAULT 'unknown',
	"last_scan_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scan_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"scan_id" integer NOT NULL,
	"name" text NOT NULL,
	"version" text,
	"ecosystem" text DEFAULT 'npm',
	"risk_score" real DEFAULT 0,
	"risk_level" text DEFAULT 'low',
	"anomaly_score" real,
	"is_anomaly" boolean DEFAULT false,
	"depth" integer DEFAULT 0,
	"pagerank" real,
	"centrality" real,
	"blast_radius" integer DEFAULT 0,
	"maintainer_count" integer,
	"age_days" integer,
	"days_since_update" integer,
	"signals_json" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"repo_url" text NOT NULL,
	"commit_hash" text,
	"ecosystem" text DEFAULT 'npm' NOT NULL,
	"overall_risk_score" real DEFAULT 0,
	"risk_level" text DEFAULT 'unknown',
	"total_deps" integer DEFAULT 0,
	"total_signals" integer DEFAULT 0,
	"total_anomalies" integer DEFAULT 0,
	"scan_duration_ms" integer,
	"ml_stats" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "scan_packages" ADD CONSTRAINT "scan_packages_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scans"("id") ON DELETE cascade ON UPDATE no action;