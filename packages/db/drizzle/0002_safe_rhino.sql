CREATE TYPE "public"."measure_source" AS ENUM('introspected', 'curated');--> statement-breakpoint
ALTER TABLE "dataset_measures" ADD COLUMN "source" "measure_source" DEFAULT 'curated' NOT NULL;--> statement-breakpoint
ALTER TABLE "datasets" ADD COLUMN "extra_context" text DEFAULT '' NOT NULL;