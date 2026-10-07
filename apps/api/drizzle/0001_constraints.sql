CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- No overlapping effective periods for the same applicable key
ALTER TABLE material_price_versions ADD CONSTRAINT mpv_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, material_id WITH =, plant_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);--> statement-breakpoint
ALTER TABLE plant_cost_versions ADD CONSTRAINT pcv_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, plant_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&) WHERE (status = 'published');--> statement-breakpoint
ALTER TABLE forecast_volumes ADD CONSTRAINT fv_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, plant_id WITH =, daterange(valid_from, valid_to, '[)') WITH &&);--> statement-breakpoint
ALTER TABLE commercial_pricing_policies ADD CONSTRAINT cpp_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, (coalesce(plant_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
  (coalesce(mix_id, '00000000-0000-0000-0000-000000000000'::uuid)) WITH =, daterange(valid_from, valid_to, '[)') WITH &&);--> statement-breakpoint
ALTER TABLE tax_policy_versions ADD CONSTRAINT tpv_no_overlap EXCLUDE USING gist (
  tenant_id WITH =, policy_key WITH =, daterange(valid_from, valid_to, '[)') WITH &&) WHERE (status in ('verified','demo'));--> statement-breakpoint

-- Immutability: published versions may only be closed (valid_to set once)
CREATE FUNCTION rm_close_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'published % rows are immutable and cannot be deleted', TG_TABLE_NAME USING ERRCODE = '23000'; END IF;
  IF (to_jsonb(NEW) - 'valid_to') IS DISTINCT FROM (to_jsonb(OLD) - 'valid_to') THEN
    RAISE EXCEPTION 'published % rows are immutable (only valid_to may be closed)', TG_TABLE_NAME USING ERRCODE = '23000';
  END IF;
  IF OLD.valid_to IS NOT NULL AND NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION 'valid_to already set on published % row', TG_TABLE_NAME USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER mpv_immutable BEFORE UPDATE OR DELETE ON material_price_versions FOR EACH ROW EXECUTE FUNCTION rm_close_only();--> statement-breakpoint
CREATE TRIGGER fv_immutable BEFORE UPDATE OR DELETE ON forecast_volumes FOR EACH ROW EXECUTE FUNCTION rm_close_only();--> statement-breakpoint
CREATE TRIGGER pcv_immutable BEFORE UPDATE OR DELETE ON plant_cost_versions FOR EACH ROW WHEN (OLD.status = 'published') EXECUTE FUNCTION rm_close_only();--> statement-breakpoint
CREATE TRIGGER cpp_immutable BEFORE UPDATE OR DELETE ON commercial_pricing_policies FOR EACH ROW EXECUTE FUNCTION rm_close_only();--> statement-breakpoint

-- Tax policies: verification fields and status may be updated; economics may not once verified/demo/retired
CREATE FUNCTION rm_tax_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'non-draft tax policy versions cannot be deleted' USING ERRCODE = '23000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF (to_jsonb(NEW) - 'valid_to' - 'status' - 'verified_by' - 'verified_at' - 'verification_reference') IS DISTINCT FROM
     (to_jsonb(OLD) - 'valid_to' - 'status' - 'verified_by' - 'verified_at' - 'verification_reference') THEN
    RAISE EXCEPTION 'tax policy economics are immutable once published' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tpv_immutable BEFORE UPDATE OR DELETE ON tax_policy_versions FOR EACH ROW EXECUTE FUNCTION rm_tax_immutable();--> statement-breakpoint

-- Mix revisions: recipe is immutable after approval; only status/superseded markers may change
CREATE FUNCTION rm_mixrev_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'approved mix revisions cannot be deleted' USING ERRCODE = '23000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('approved','superseded') AND
     (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'approved mix revision is immutable' USING ERRCODE = '23000';
  END IF;
  IF OLD.status IN ('approved','superseded') AND NEW.status NOT IN ('approved','superseded') THEN
    RAISE EXCEPTION 'approved mix revision cannot return to %', NEW.status USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER mixrev_immutable BEFORE UPDATE OR DELETE ON mix_revisions FOR EACH ROW EXECUTE FUNCTION rm_mixrev_immutable();--> statement-breakpoint
CREATE FUNCTION rm_mixing_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.mix_revision_id ELSE NEW.mix_revision_id END;
  SELECT status INTO st FROM mix_revisions WHERE id = rid;
  IF st IS NOT NULL AND st NOT IN ('draft') THEN RAISE EXCEPTION 'ingredients of a % mix revision cannot be changed', st USING ERRCODE = '23000'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER mixing_frozen BEFORE INSERT OR UPDATE OR DELETE ON mix_ingredients FOR EACH ROW EXECUTE FUNCTION rm_mixing_frozen();--> statement-breakpoint

-- Quotation revisions: once frozen, content is immutable
CREATE FUNCTION rm_quoterev_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.frozen_at IS NOT NULL THEN RAISE EXCEPTION 'frozen quotation revisions cannot be deleted' USING ERRCODE = '23000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.frozen_at IS NOT NULL AND (
      NEW.doc IS DISTINCT FROM OLD.doc OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.result IS DISTINCT FROM OLD.result
      OR NEW.reference IS DISTINCT FROM OLD.reference OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at) THEN
    RAISE EXCEPTION 'frozen quotation revision content is immutable' USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER quoterev_frozen BEFORE UPDATE OR DELETE ON quotation_revisions FOR EACH ROW EXECUTE FUNCTION rm_quoterev_frozen();--> statement-breakpoint
CREATE FUNCTION rm_quoteline_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fz timestamptz; rid uuid;
BEGIN
  rid := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
  SELECT frozen_at INTO fz FROM quotation_revisions WHERE id = rid;
  IF fz IS NOT NULL THEN RAISE EXCEPTION 'lines of a frozen quotation revision are immutable' USING ERRCODE = '23000'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER quoteline_frozen BEFORE INSERT OR UPDATE OR DELETE ON quotation_lines FOR EACH ROW EXECUTE FUNCTION rm_quoteline_frozen();--> statement-breakpoint
CREATE TRIGGER service_frozen BEFORE INSERT OR UPDATE OR DELETE ON service_charges FOR EACH ROW EXECUTE FUNCTION rm_quoteline_frozen();--> statement-breakpoint

-- Price batch items frozen once the batch revision was submitted
CREATE FUNCTION rm_batchitem_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; cur int; bid uuid; rev int;
BEGIN
  bid := CASE WHEN TG_OP = 'DELETE' THEN OLD.batch_id ELSE NEW.batch_id END;
  rev := CASE WHEN TG_OP = 'DELETE' THEN OLD.batch_revision ELSE NEW.batch_revision END;
  SELECT status, current_revision INTO st, cur FROM price_batches WHERE id = bid;
  IF st IS NOT NULL AND (st <> 'draft' OR rev < cur) THEN
    RAISE EXCEPTION 'items of a submitted price batch revision are immutable' USING ERRCODE = '23000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER batchitem_frozen BEFORE INSERT OR UPDATE OR DELETE ON price_batch_items FOR EACH ROW EXECUTE FUNCTION rm_batchitem_frozen();--> statement-breakpoint

-- Audit log is append-only
CREATE FUNCTION rm_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '23000'; END $$;--> statement-breakpoint
CREATE TRIGGER audit_no_update BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION rm_audit_append_only();
