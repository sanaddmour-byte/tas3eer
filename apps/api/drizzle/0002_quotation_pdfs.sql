CREATE TABLE "quotation_pdfs" (
	"revision_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"sha256" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotation_pdfs" ADD CONSTRAINT "quotation_pdfs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_pdfs" ADD CONSTRAINT "quotation_pdfs_tenant_id_revision_id_quotation_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","revision_id") REFERENCES "public"."quotation_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;