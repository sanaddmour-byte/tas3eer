CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"reasons" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	CONSTRAINT "ar_status" CHECK ("approval_requests"."status" in ('pending','approved','returned','cancelled','invalidated'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_label" text,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tax_number" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"contacts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "forecast_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	"monthly_m3" numeric(18, 3) NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "forecast_volumes_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "fv_positive" CHECK ("forecast_volumes"."monthly_m3" > 0),
	CONSTRAINT "fv_range" CHECK ("forecast_volumes"."valid_to" is null or "forecast_volumes"."valid_to" > "forecast_volumes"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"plant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"all_plants" boolean DEFAULT false NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "material_price_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"basis" text NOT NULL,
	"freight" numeric(18, 6),
	"valid_from" date NOT NULL,
	"valid_to" date,
	"source" text DEFAULT '' NOT NULL,
	"batch_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "material_price_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "mpv_price" CHECK ("material_price_versions"."price" >= 0),
	CONSTRAINT "mpv_basis" CHECK ("material_price_versions"."basis" in ('ex_source','delivered_plant')),
	CONSTRAINT "mpv_freight" CHECK ("material_price_versions"."basis" = 'delivered_plant' or "material_price_versions"."freight" is not null),
	CONSTRAINT "mpv_range" CHECK ("material_price_versions"."valid_to" is null or "material_price_versions"."valid_to" > "material_price_versions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"purchase_unit" text NOT NULL,
	"dosage_unit" text NOT NULL,
	"conversion_factor" numeric(18, 8),
	"density_kg_m3" numeric(18, 4),
	"wastage_pct" numeric(8, 4) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "materials_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "materials_wastage" CHECK ("materials"."wastage_pct" >= 0 and "materials"."wastage_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"grant_caps" text[] DEFAULT '{}' NOT NULL,
	"revoke_caps" text[] DEFAULT '{}' NOT NULL,
	"all_plants" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_tenant_id_user_id_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "memberships_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "memberships_role" CHECK ("memberships"."role" in ('admin','pricing','technical','sales','viewer'))
);
--> statement-breakpoint
CREATE TABLE "mix_ingredients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mix_revision_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"dosage" numeric(18, 6) NOT NULL,
	CONSTRAINT "mix_ingredients_mix_revision_id_material_id_unique" UNIQUE("mix_revision_id","material_id"),
	CONSTRAINT "mi_dosage" CHECK ("mix_ingredients"."dosage" > 0)
);
--> statement-breakpoint
CREATE TABLE "mix_plants" (
	"tenant_id" uuid NOT NULL,
	"mix_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	CONSTRAINT "mix_plants_mix_id_plant_id_pk" PRIMARY KEY("mix_id","plant_id")
);
--> statement-breakpoint
CREATE TABLE "mix_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mix_id" uuid NOT NULL,
	"rev_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"submitted_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mix_revisions_mix_id_rev_no_unique" UNIQUE("mix_id","rev_no"),
	CONSTRAINT "mix_revisions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "mr_status" CHECK ("mix_revisions"."status" in ('draft','pending_technical','approved','superseded','rejected'))
);
--> statement-breakpoint
CREATE TABLE "mixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text DEFAULT '' NOT NULL,
	"grade" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mixes_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "mixes_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"last" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "number_sequences_tenant_id_key_pk" PRIMARY KEY("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "plant_assignments" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	CONSTRAINT "plant_assignments_membership_id_plant_id_pk" PRIMARY KEY("membership_id","plant_id")
);
--> statement-breakpoint
CREATE TABLE "plant_cost_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"fixed_costs" jsonb NOT NULL,
	"variable_costs" jsonb NOT NULL,
	"corporate_overhead_per_m3" numeric(18, 6) NOT NULL,
	"risk_provision_per_m3" numeric(18, 6) NOT NULL,
	"delivery" jsonb NOT NULL,
	"pumping" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"published_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plant_cost_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "pcv_status" CHECK ("plant_cost_versions"."status" in ('draft','published')),
	CONSTRAINT "pcv_range" CHECK ("plant_cost_versions"."valid_to" is null or "plant_cost_versions"."valid_to" > "plant_cost_versions"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "plants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plants_tenant_id_code_unique" UNIQUE("tenant_id","code"),
	CONSTRAINT "plants_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "price_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"batch_revision" integer DEFAULT 1 NOT NULL,
	"row_no" integer DEFAULT 0 NOT NULL,
	"material_id" uuid NOT NULL,
	"plant_id" uuid NOT NULL,
	"base_version_id" uuid,
	"base_price" numeric(18, 6),
	"base_basis" text,
	"base_freight" numeric(18, 6),
	"proposed_price" numeric(18, 6) NOT NULL,
	"proposed_basis" text NOT NULL,
	"proposed_freight" numeric(18, 6),
	"effective_from" date NOT NULL,
	"impact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "price_batch_items_batch_id_batch_revision_material_id_plant_id_unique" UNIQUE("batch_id","batch_revision","material_id","plant_id"),
	CONSTRAINT "pbi_price" CHECK ("price_batch_items"."proposed_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "price_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"plant_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_revision" integer DEFAULT 1 NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"file_name" text,
	"effective_from" date NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_comment" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "price_batches_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "price_batches_status" CHECK ("price_batches"."status" in ('draft','submitted','published','rejected','returned'))
);
--> statement-breakpoint
CREATE TABLE "commercial_pricing_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"mode" text NOT NULL,
	"pct" numeric(9, 4) NOT NULL,
	"min_margin_pct" numeric(9, 4) NOT NULL,
	"plant_id" uuid,
	"mix_id" uuid,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commercial_pricing_policies_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "cpp_mode" CHECK ("commercial_pricing_policies"."mode" in ('gross_margin','markup')),
	CONSTRAINT "cpp_pct" CHECK (("commercial_pricing_policies"."mode" = 'gross_margin' and "commercial_pricing_policies"."pct" >= 0 and "commercial_pricing_policies"."pct" < 100) or ("commercial_pricing_policies"."mode" = 'markup' and "commercial_pricing_policies"."pct" >= 0 and "commercial_pricing_policies"."pct" <= 1000))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"site_address" text DEFAULT '' NOT NULL,
	"site_contact" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_plant_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"mix_revision_id" uuid NOT NULL,
	"quantity_m3" numeric(18, 3),
	"price_override" jsonb,
	"cost_override" jsonb,
	CONSTRAINT "quotation_lines_revision_id_id_pk" PRIMARY KEY("revision_id","id")
);
--> statement-breakpoint
CREATE TABLE "quotation_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"rev_no" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"doc" jsonb NOT NULL,
	"result" jsonb,
	"reference" jsonb,
	"snapshot" jsonb,
	"snapshot_hash" text,
	"frozen_at" timestamp with time zone,
	"submitted_by" uuid,
	"issued_at" timestamp with time zone,
	"issued_by" uuid,
	"valid_until" date,
	"pdf_sha256" text,
	"parent_rev_no" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_revisions_quotation_id_rev_no_unique" UNIQUE("quotation_id","rev_no"),
	CONSTRAINT "quotation_revisions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "qr_status" CHECK ("quotation_revisions"."status" in ('draft','pending_approval','approved','returned','issued','accepted','declined','expired','cancelled','superseded'))
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"client_id" uuid,
	"project_id" uuid,
	"plant_id" uuid,
	"owner_membership_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"latest_rev_no" integer DEFAULT 1 NOT NULL,
	"lost_reason" text,
	"competitor_note" text,
	"outcome_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_tenant_id_id_unique" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "service_charges" (
	"id" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"params" jsonb NOT NULL,
	"amount" numeric(18, 3),
	CONSTRAINT "service_charges_revision_id_id_pk" PRIMARY KEY("revision_id","id"),
	CONSTRAINT "sc_type" CHECK ("service_charges"."type" in ('delivery','pumping','other'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"csrf_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "sync_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"op_type" text NOT NULL,
	"entity_id" text,
	"status" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_operations_tenant_id_user_id_idempotency_key_unique" UNIQUE("tenant_id","user_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "tax_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"policy_key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rate_pct" numeric(9, 4) NOT NULL,
	"taxable_components" jsonb NOT NULL,
	"deduction_amount" numeric(18, 6) DEFAULT '0' NOT NULL,
	"deduction_basis" text DEFAULT 'per_document' NOT NULL,
	"non_negative_base" boolean DEFAULT true NOT NULL,
	"exemption_note" text DEFAULT '' NOT NULL,
	"source_reference" text DEFAULT '' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"verification_reference" text,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_policy_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tpv_status" CHECK ("tax_policy_versions"."status" in ('draft','demo','verified','retired')),
	CONSTRAINT "tpv_basis" CHECK ("tax_policy_versions"."deduction_basis" in ('per_m3','per_line','per_document')),
	CONSTRAINT "tpv_rate" CHECK ("tax_policy_versions"."rate_pct" >= 0 and "tax_policy_versions"."rate_pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "terms_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"clauses" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_placeholder" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_versions_tenant_id_version_unique" UNIQUE("tenant_id","version"),
	CONSTRAINT "terms_versions_tenant_id_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "tv_status" CHECK ("terms_versions"."status" in ('draft','approved','retired'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_revision_id_quotation_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","revision_id") REFERENCES "public"."quotation_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_quotation_id_quotations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "public"."quotations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_volumes" ADD CONSTRAINT "forecast_volumes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_volumes" ADD CONSTRAINT "forecast_volumes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_volumes" ADD CONSTRAINT "forecast_volumes_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_versions" ADD CONSTRAINT "material_price_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_versions" ADD CONSTRAINT "material_price_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_versions" ADD CONSTRAINT "material_price_versions_tenant_id_material_id_materials_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_versions" ADD CONSTRAINT "material_price_versions_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_price_versions" ADD CONSTRAINT "material_price_versions_tenant_id_batch_id_price_batches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."price_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_ingredients" ADD CONSTRAINT "mix_ingredients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_ingredients" ADD CONSTRAINT "mix_ingredients_tenant_id_mix_revision_id_mix_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","mix_revision_id") REFERENCES "public"."mix_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_ingredients" ADD CONSTRAINT "mix_ingredients_tenant_id_material_id_materials_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_plants" ADD CONSTRAINT "mix_plants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_plants" ADD CONSTRAINT "mix_plants_tenant_id_mix_id_mixes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","mix_id") REFERENCES "public"."mixes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_plants" ADD CONSTRAINT "mix_plants_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_revisions" ADD CONSTRAINT "mix_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_revisions" ADD CONSTRAINT "mix_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_revisions" ADD CONSTRAINT "mix_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_revisions" ADD CONSTRAINT "mix_revisions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mix_revisions" ADD CONSTRAINT "mix_revisions_tenant_id_mix_id_mixes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","mix_id") REFERENCES "public"."mixes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mixes" ADD CONSTRAINT "mixes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_assignments" ADD CONSTRAINT "plant_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_assignments" ADD CONSTRAINT "plant_assignments_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_assignments" ADD CONSTRAINT "plant_assignments_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_cost_versions" ADD CONSTRAINT "plant_cost_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_cost_versions" ADD CONSTRAINT "plant_cost_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_cost_versions" ADD CONSTRAINT "plant_cost_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plant_cost_versions" ADD CONSTRAINT "plant_cost_versions_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plants" ADD CONSTRAINT "plants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batch_items" ADD CONSTRAINT "price_batch_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batch_items" ADD CONSTRAINT "price_batch_items_tenant_id_batch_id_price_batches_tenant_id_id_fk" FOREIGN KEY ("tenant_id","batch_id") REFERENCES "public"."price_batches"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batch_items" ADD CONSTRAINT "price_batch_items_tenant_id_material_id_materials_tenant_id_id_fk" FOREIGN KEY ("tenant_id","material_id") REFERENCES "public"."materials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batch_items" ADD CONSTRAINT "price_batch_items_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batch_items" ADD CONSTRAINT "price_batch_items_tenant_id_base_version_id_material_price_versions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","base_version_id") REFERENCES "public"."material_price_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batches" ADD CONSTRAINT "price_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batches" ADD CONSTRAINT "price_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batches" ADD CONSTRAINT "price_batches_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_batches" ADD CONSTRAINT "price_batches_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_pricing_policies" ADD CONSTRAINT "commercial_pricing_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_pricing_policies" ADD CONSTRAINT "commercial_pricing_policies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_pricing_policies" ADD CONSTRAINT "commercial_pricing_policies_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commercial_pricing_policies" ADD CONSTRAINT "commercial_pricing_policies_tenant_id_mix_id_mixes_tenant_id_id_fk" FOREIGN KEY ("tenant_id","mix_id") REFERENCES "public"."mixes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_client_id_clients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_default_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","default_plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tenant_id_revision_id_quotation_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","revision_id") REFERENCES "public"."quotation_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tenant_id_mix_revision_id_mix_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","mix_revision_id") REFERENCES "public"."mix_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_tenant_id_quotation_id_quotations_tenant_id_id_fk" FOREIGN KEY ("tenant_id","quotation_id") REFERENCES "public"."quotations"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_client_id_clients_tenant_id_id_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_project_id_projects_tenant_id_id_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_plant_id_plants_tenant_id_id_fk" FOREIGN KEY ("tenant_id","plant_id") REFERENCES "public"."plants"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_owner_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","owner_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_charges" ADD CONSTRAINT "service_charges_tenant_id_revision_id_quotation_revisions_tenant_id_id_fk" FOREIGN KEY ("tenant_id","revision_id") REFERENCES "public"."quotation_revisions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_membership_id_memberships_tenant_id_id_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_operations" ADD CONSTRAINT "sync_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_policy_versions" ADD CONSTRAINT "tax_policy_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_policy_versions" ADD CONSTRAINT "tax_policy_versions_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_policy_versions" ADD CONSTRAINT "tax_policy_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD CONSTRAINT "terms_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms_versions" ADD CONSTRAINT "terms_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity" ON "audit_events" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_time" ON "audit_events" USING btree ("tenant_id","at");--> statement-breakpoint
CREATE INDEX "mpv_lookup" ON "material_price_versions" USING btree ("tenant_id","plant_id","material_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_number" ON "quotations" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower" ON "users" USING btree (lower("email"));