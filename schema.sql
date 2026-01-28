


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."consumables_model_type" AS ENUM (
    'FIXED',
    'PER_IN2',
    'PER_FT2',
    'PER_SIZE'
);


ALTER TYPE "public"."consumables_model_type" OWNER TO "postgres";


CREATE TYPE "public"."correction_level_enum" AS ENUM (
    'one_step',
    'two_step',
    'multi_step'
);


ALTER TYPE "public"."correction_level_enum" OWNER TO "postgres";


CREATE TYPE "public"."discount_type" AS ENUM (
    'PERCENT',
    'FIXED_MXN'
);


ALTER TYPE "public"."discount_type" OWNER TO "postgres";


CREATE TYPE "public"."ppf_finish" AS ENUM (
    'GLOSS',
    'MATTE'
);


ALTER TYPE "public"."ppf_finish" OWNER TO "postgres";


CREATE TYPE "public"."ppf_material_kind" AS ENUM (
    'CLEAR',
    'SPECIAL'
);


ALTER TYPE "public"."ppf_material_kind" OWNER TO "postgres";


CREATE TYPE "public"."ppf_multiplier_mode" AS ENUM (
    'MATERIAL',
    'FIXED'
);


ALTER TYPE "public"."ppf_multiplier_mode" OWNER TO "postgres";


CREATE TYPE "public"."price_source_enum" AS ENUM (
    'msrp',
    'cost'
);


ALTER TYPE "public"."price_source_enum" OWNER TO "postgres";


CREATE TYPE "public"."pricing_model" AS ENUM (
    'AREA_IN2',
    'SIZE_ONLY',
    'FIXED',
    'PRODUCT_TIER'
);


ALTER TYPE "public"."pricing_model" OWNER TO "postgres";


CREATE TYPE "public"."pricing_model_enum" AS ENUM (
    'fixed',
    'derived_from_product',
    'quote_only'
);


ALTER TYPE "public"."pricing_model_enum" OWNER TO "postgres";


CREATE TYPE "public"."protection_type_enum" AS ENUM (
    'ceramic_coating',
    'wax',
    'sealant',
    'glass_coating',
    'trim_coating',
    'wheel_coating',
    'interior_coating'
);


ALTER TYPE "public"."protection_type_enum" OWNER TO "postgres";


CREATE TYPE "public"."quote_status" AS ENUM (
    'DRAFT',
    'SENT',
    'ACCEPTED',
    'REJECTED',
    'ARCHIVED'
);


ALTER TYPE "public"."quote_status" OWNER TO "postgres";


CREATE TYPE "public"."service_family" AS ENUM (
    'PPF',
    'CER',
    'SWI',
    'ADDON',
    'TINT'
);


ALTER TYPE "public"."service_family" OWNER TO "postgres";


CREATE TYPE "public"."service_family_enum" AS ENUM (
    'ppf',
    'ceramic',
    'swissvax',
    'detailing'
);


ALTER TYPE "public"."service_family_enum" OWNER TO "postgres";


CREATE TYPE "public"."service_zone" AS ENUM (
    'EXTERIOR',
    'INTERIOR',
    'WHEELS',
    'GLASS',
    'PLASTICS',
    'TRIM',
    'PIANO_BLACK',
    'TRUNK',
    'OTHER'
);


ALTER TYPE "public"."service_zone" OWNER TO "postgres";


CREATE TYPE "public"."surface_enum" AS ENUM (
    'paint',
    'glass',
    'wheels',
    'trim_plastics',
    'metal',
    'interior_plastics',
    'leather',
    'fabric_alcantara',
    'screens_piano_black',
    'wrap',
    'ppf',
    'fabric',
    'paint_matte',
    'ppf_stek_film',
    'ppf_existing_film'
);


ALTER TYPE "public"."surface_enum" OWNER TO "postgres";


CREATE TYPE "public"."vehicle_size_enum" AS ENUM (
    'S',
    'M',
    'L',
    'XL'
);


ALTER TYPE "public"."vehicle_size_enum" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_offer_price_mxn"("p_offer_id" "uuid", "p_vehicle_size" "public"."vehicle_size_enum", "p_correction_level" "public"."correction_level_enum" DEFAULT 'one_step'::"public"."correction_level_enum") RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  v_pricing_model pricing_model_enum;
  v_price_source price_source_enum;
  v_product_msrp numeric(12,2);
  v_product_cost numeric(12,2);
  v_product_base numeric(12,2);

  v_fixed numeric(12,2);
  v_mult numeric(10,4);
  v_labor numeric(12,2);
  v_base numeric(12,2);

  v_delta numeric(12,2);
begin
  select so.pricing_model, so.product_price_source
    into v_pricing_model, v_price_source
  from public.service_offers so
  where so.id = p_offer_id;

  if v_pricing_model is null then
    raise exception 'Offer not found: %', p_offer_id;
  end if;

  select ops.fixed_price_mxn, ops.multiplier, ops.labor_mxn
    into v_fixed, v_mult, v_labor
  from public.offer_pricing_by_size ops
  where ops.service_offer_id = p_offer_id
    and ops.vehicle_size = p_vehicle_size
    and ops.active = true;

  if v_pricing_model = 'fixed' then
    if v_fixed is null then
      raise exception 'Missing fixed_price_mxn for offer % size %', p_offer_id, p_vehicle_size;
    end if;
    v_base := v_fixed;

  elsif v_pricing_model = 'derived_from_product' then
    select p.msrp_mxn, p.cost_mxn
      into v_product_msrp, v_product_cost
    from public.service_offers so
    join public.products p on p.id = so.protection_product_id
    where so.id = p_offer_id;

    v_product_base :=
      case v_price_source
        when 'cost' then coalesce(v_product_cost, v_product_msrp)
        else coalesce(v_product_msrp, v_product_cost)
      end;

    if v_product_base is null then
      raise exception 'Missing product MSRP/cost for derived offer %', p_offer_id;
    end if;

    v_base := (v_product_base * coalesce(v_mult, 1.0)) + coalesce(v_labor, 0);

  else
    raise exception 'Offer is quote_only; no computable price';
  end if;

  select coalesce(cpd.delta_mxn, 0)
    into v_delta
  from public.correction_packages cp
  left join public.correction_price_delta_by_size cpd
    on cpd.correction_package_id = cp.id
   and cpd.service_offer_id = p_offer_id
   and cpd.vehicle_size = p_vehicle_size
  where cp.level = p_correction_level;

  return round(v_base + coalesce(v_delta, 0), 2);
end $$;


ALTER FUNCTION "public"."compute_offer_price_mxn"("p_offer_id" "uuid", "p_vehicle_size" "public"."vehicle_size_enum", "p_correction_level" "public"."correction_level_enum") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_auth_user_app_users"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  cols text[] := array['id'];
  vals text[] := array['$1'];
  has_email boolean := false;
  sql text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_users' and column_name='email'
  ) then
    cols := array_append(cols, 'email');
    vals := array_append(vals, '$2');
    has_email := true;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_users' and column_name='is_active'
  ) then
    cols := array_append(cols, 'is_active');
    vals := array_append(vals, 'true');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_users' and column_name='created_at'
  ) then
    cols := array_append(cols, 'created_at');
    vals := array_append(vals, 'now()');
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='app_users' and column_name='updated_at'
  ) then
    cols := array_append(cols, 'updated_at');
    vals := array_append(vals, 'now()');
  end if;

  sql := format(
    'insert into public.app_users (%s) values (%s) on conflict (id) do nothing',
    array_to_string(cols, ', '),
    array_to_string(vals, ', ')
  );

  if has_email then
    execute sql using new.id, new.email;
  else
    execute sql using new.id;
  end if;

  return new;
end;
$_$;


ALTER FUNCTION "public"."handle_new_auth_user_app_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.app_users u
    where u.id = auth.uid() and u.role = 'owner'
  );
$$;


ALTER FUNCTION "public"."is_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ppf_calc_line_item"("p_rule_version_id" "uuid", "p_bundle_template_id" "uuid", "p_material_code" "text", "p_width_in" numeric, "p_length_in" numeric, "p_hours" numeric, "p_size_code" "text", "p_difficulty" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  sku record;
  pr record;
  bp record;
  sdm record;

  width numeric;
  length numeric;
  hours numeric;

  area_in2 numeric;
  raw_cost_mxn numeric;
  cost_with_waste_mxn numeric;

  base_multiplier numeric;
  film_multiplier numeric;
  film_price_mxn numeric;
  labor_price_mxn numeric;

  total_before_size_mxn numeric;
  size_mult numeric;
  final_price_mxn numeric;

  inferred_kind public.ppf_material_kind;
  inferred_finish public.ppf_finish;

begin
  if p_rule_version_id is null then
    raise exception 'ppf_calc_line_item: rule_version_id required';
  end if;
  if p_bundle_template_id is null then
    raise exception 'ppf_calc_line_item: bundle_template_id required';
  end if;
  if coalesce(p_material_code,'') = '' then
    raise exception 'ppf_calc_line_item: material_code required';
  end if;

  width := coalesce(p_width_in, 0);
  length := coalesce(p_length_in, 0);
  hours := coalesce(p_hours, 0);

  if width <= 0 then raise exception 'Width must be > 0'; end if;
  if length <= 0 then raise exception 'Length must be > 0'; end if;

  select * into pr
  from public.ppf_pricing_rules
  where rule_version_id = p_rule_version_id
  limit 1;

  if pr is null then
    raise exception 'No ppf_pricing_rules row for rule_version_id=%', p_rule_version_id;
  end if;

  select * into bp
  from public.ppf_bundle_pricing
  where rule_version_id = p_rule_version_id
    and bundle_template_id = p_bundle_template_id
    and is_active = true
  limit 1;

  if bp is null then
    raise exception 'No ppf_bundle_pricing row for rule_version_id=% bundle_template_id=%', p_rule_version_id, p_bundle_template_id;
  end if;

  if bp.requires_hours = true and hours <= 0 then
    raise exception 'This service requires hours > 0';
  end if;

  select * into sdm
  from public.size_difficulty_multipliers
  where rule_version_id = p_rule_version_id
    and is_active = true
    and size_code = p_size_code
    and difficulty = p_difficulty
  limit 1;

  if sdm is null then
    raise exception 'Size/difficulty multiplier not found for size=%, difficulty=%', p_size_code, p_difficulty;
  end if;

  -- Pick roll SKU: prefer warning_only=false, else fallback
  select *
  into sku
  from public.roll_skus
  where rule_version_id = p_rule_version_id
    and material_code = p_material_code
    and width_in = width
    and is_active = true
  order by warning_only asc, updated_at desc
  limit 1;

  if sku is null then
    raise exception 'No active roll_sku for material=% width=%', p_material_code, width;
  end if;

  if sku.max_length_in is not null and length > sku.max_length_in then
    raise exception 'Length % exceeds max_length_in % for this roll', length, sku.max_length_in;
  end if;

  -- Inference if columns not filled yet
  inferred_kind := sku.material_kind;
  if inferred_kind is null then
    if p_material_code = 'DYNOshield' or p_material_code ~* 'DYNOshield$' then
      inferred_kind := 'CLEAR';
    else
      inferred_kind := 'SPECIAL';
    end if;
  end if;

  inferred_finish := sku.finish;
  if inferred_finish is null then
    if lower(p_material_code) like '%matte%' or lower(p_material_code) like 'dynomatte%' then
      inferred_finish := 'MATTE';
    else
      inferred_finish := 'GLOSS';
    end if;
  end if;

  -- Base multiplier
  if bp.multiplier_mode = 'FIXED' then
    base_multiplier := coalesce(bp.fixed_multiplier, pr.clear_multiplier);
  else
    if inferred_kind = 'CLEAR' then
      base_multiplier := pr.clear_multiplier;
    else
      base_multiplier := pr.special_multiplier;
    end if;
  end if;

  film_multiplier := base_multiplier * coalesce(bp.extra_multiplier, 1);

  area_in2 := width * length;
  raw_cost_mxn := area_in2 * coalesce(sku.cost_per_in2_mxn, 0);
  cost_with_waste_mxn := raw_cost_mxn * (1 + coalesce(pr.waste_pct, 0));

  film_price_mxn := cost_with_waste_mxn * film_multiplier;

  -- Matte multiplier
  if bp.apply_matte_multiplier = true and inferred_finish = 'MATTE' then
    film_price_mxn := film_price_mxn * coalesce(pr.matte_multiplier, 1.25);
  end if;

  -- Headlight-specific uplift (applies if SKU is flagged)
  if sku.is_headlight_specific = true then
    film_price_mxn := film_price_mxn * coalesce(bp.headlight_material_multiplier, 1.25);
  end if;

  labor_price_mxn := hours * coalesce(bp.labor_rate_mxn_per_hour, 0);

  total_before_size_mxn := film_price_mxn + labor_price_mxn;
  size_mult := coalesce(sdm.multiplier, 1);
  final_price_mxn := total_before_size_mxn * size_mult;

  return jsonb_build_object(
    'inputs', jsonb_build_object(
      'material_code', p_material_code,
      'width_in', width,
      'length_in', length,
      'hours', hours,
      'size_code', p_size_code,
      'difficulty', p_difficulty
    ),
    'sku', jsonb_build_object(
      'roll_sku_id', sku.id,
      'warning_only', sku.warning_only,
      'max_length_in', sku.max_length_in
    ),
    'derived', jsonb_build_object(
      'material_kind', inferred_kind,
      'finish', inferred_finish
    ),
    'numbers', jsonb_build_object(
      'area_in2', area_in2,
      'cost_per_in2_mxn', coalesce(sku.cost_per_in2_mxn, 0),
      'raw_cost_mxn', raw_cost_mxn,
      'waste_pct', coalesce(pr.waste_pct, 0),
      'cost_with_waste_mxn', cost_with_waste_mxn,
      'base_multiplier', base_multiplier,
      'extra_multiplier', coalesce(bp.extra_multiplier, 1),
      'film_multiplier', film_multiplier,
      'matte_multiplier', coalesce(pr.matte_multiplier, 1.25),
      'headlight_material_multiplier', coalesce(bp.headlight_material_multiplier, 1.25),
      'film_price_mxn', film_price_mxn,
      'labor_rate_mxn_per_hour', coalesce(bp.labor_rate_mxn_per_hour, 0),
      'labor_price_mxn', labor_price_mxn,
      'total_before_size_mxn', total_before_size_mxn,
      'size_difficulty_multiplier', size_mult,
      'final_price_mxn', final_price_mxn
    )
  );
end $_$;


ALTER FUNCTION "public"."ppf_calc_line_item"("p_rule_version_id" "uuid", "p_bundle_template_id" "uuid", "p_material_code" "text", "p_width_in" numeric, "p_length_in" numeric, "p_hours" numeric, "p_size_code" "text", "p_difficulty" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end $$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."app_users" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "role" "text" DEFAULT 'owner'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."app_users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bundle_template_lines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bundle_template_id" "uuid" NOT NULL,
    "service_item_id" "uuid" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "quantity" numeric(12,4) DEFAULT 1 NOT NULL,
    "preset_inputs" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "bundle_template_lines_quantity_check" CHECK (("quantity" > (0)::numeric))
);


ALTER TABLE "public"."bundle_template_lines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bundle_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "family" "public"."service_family" NOT NULL,
    "zone" "public"."service_zone" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."bundle_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ceramic_offer_discounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "layers_required" integer DEFAULT 3 NOT NULL,
    "cheapest_discount_pct" numeric DEFAULT 0.07 NOT NULL,
    "second_discount_pct" numeric DEFAULT 0.05 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ceramic_offer_discounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ceramic_pricing_rules" (
    "rule_version_id" "uuid" NOT NULL,
    "special_paint_multiplier" numeric DEFAULT 1.10 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ceramic_pricing_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ceramic_systems" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "system_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "min_coats" smallint DEFAULT 1 NOT NULL,
    "max_coats" smallint DEFAULT 1 NOT NULL,
    "is_topcoat_only" boolean DEFAULT false NOT NULL,
    "for_ppf_only" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_id" "uuid",
    CONSTRAINT "ceramic_systems_check" CHECK (("max_coats" >= "min_coats")),
    CONSTRAINT "ceramic_systems_min_coats_check" CHECK (("min_coats" >= 1))
);


ALTER TABLE "public"."ceramic_systems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consumables_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "model_key" "text" NOT NULL,
    "model_type" "public"."consumables_model_type" DEFAULT 'FIXED'::"public"."consumables_model_type" NOT NULL,
    "base_mxn" numeric(14,2) DEFAULT 0 NOT NULL,
    "rate_per_in2_mxn" numeric(14,6) DEFAULT 0 NOT NULL,
    "rate_per_ft2_mxn" numeric(14,6) DEFAULT 0 NOT NULL,
    "per_size_mxn" "jsonb",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "consumables_models_base_mxn_check" CHECK (("base_mxn" >= (0)::numeric)),
    CONSTRAINT "consumables_models_rate_per_ft2_mxn_check" CHECK (("rate_per_ft2_mxn" >= (0)::numeric)),
    CONSTRAINT "consumables_models_rate_per_in2_mxn_check" CHECK (("rate_per_in2_mxn" >= (0)::numeric))
);


ALTER TABLE "public"."consumables_models" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."correction_packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "level" "public"."correction_level_enum" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL
);


ALTER TABLE "public"."correction_packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."correction_price_delta_by_size" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "correction_package_id" "uuid" NOT NULL,
    "vehicle_size" "public"."vehicle_size_enum" NOT NULL,
    "delta_mxn" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "delta_minutes" integer DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."correction_price_delta_by_size" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discount_caps" (
    "rule_version_id" "uuid" NOT NULL,
    "max_stack_percent" numeric(6,4) DEFAULT 0.30 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "discount_caps_max_stack_percent_check" CHECK ((("max_stack_percent" >= (0)::numeric) AND ("max_stack_percent" <= 1.0)))
);


ALTER TABLE "public"."discount_caps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discount_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "stackable" boolean DEFAULT true NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "when_main_family" "public"."service_family",
    "when_main_zone" "public"."service_zone",
    "target_family" "public"."service_family" NOT NULL,
    "target_zone" "public"."service_zone",
    "discount_kind" "public"."discount_type" NOT NULL,
    "value" numeric(12,4) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "discount_rules_value_check" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."discount_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_correction_options" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "correction_package_id" "uuid" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "allowed" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."offer_correction_options" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_pricing_by_size" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "vehicle_size" "public"."vehicle_size_enum" NOT NULL,
    "fixed_price_mxn" numeric(12,2),
    "multiplier" numeric(10,4) DEFAULT 1.0000 NOT NULL,
    "labor_mxn" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "duration_minutes" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."offer_pricing_by_size" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_surface_coat_defaults" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "surface" "text" NOT NULL,
    "base_coats_default" integer DEFAULT 1 NOT NULL,
    "top1_coats_default" integer DEFAULT 1 NOT NULL,
    "top2_coats_default" integer DEFAULT 1 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."offer_surface_coat_defaults" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_surfaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "surface" "public"."surface_enum" NOT NULL,
    "included" boolean DEFAULT true NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."offer_surfaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."offer_usage_ml" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_offer_id" "uuid" NOT NULL,
    "vehicle_size" "public"."vehicle_size_enum" NOT NULL,
    "surface" "public"."surface_enum" NOT NULL,
    "ml_used" numeric(10,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."offer_usage_ml" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_bundle_pricing" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "bundle_template_id" "uuid" NOT NULL,
    "multiplier_mode" "public"."ppf_multiplier_mode" DEFAULT 'MATERIAL'::"public"."ppf_multiplier_mode" NOT NULL,
    "fixed_multiplier" numeric,
    "extra_multiplier" numeric DEFAULT 1 NOT NULL,
    "requires_hours" boolean DEFAULT false NOT NULL,
    "labor_rate_mxn_per_hour" numeric DEFAULT 0 NOT NULL,
    "apply_matte_multiplier" boolean DEFAULT true NOT NULL,
    "headlight_material_multiplier" numeric DEFAULT 1.25 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clear_multiplier_override" numeric,
    "special_multiplier_override" numeric
);


ALTER TABLE "public"."ppf_bundle_pricing" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_full_area_by_size_zone" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "size_code" "text" NOT NULL,
    "zone" "public"."service_zone" NOT NULL,
    "area_in2" numeric NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ppf_full_area_by_size_zone" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_labor_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "label" "text" NOT NULL,
    "rate_mxn_per_hour" numeric NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ppf_labor_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_material_rules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "material_code" "text" NOT NULL,
    "tier" "text" NOT NULL,
    "finish" "text" NOT NULL,
    "is_headlight_specific" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ppf_material_rules_finish_check" CHECK (("finish" = ANY (ARRAY['GLOSS'::"text", 'MATTE'::"text"]))),
    CONSTRAINT "ppf_material_rules_tier_check" CHECK (("tier" = ANY (ARRAY['CLEAR'::"text", 'SPECIAL'::"text"])))
);


ALTER TABLE "public"."ppf_material_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_pricing_rules" (
    "rule_version_id" "uuid" NOT NULL,
    "waste_pct" numeric(6,4) DEFAULT 0.20 NOT NULL,
    "clear_multiplier" numeric(10,4) DEFAULT 3.5 NOT NULL,
    "matte_uplift_pct" numeric(6,4) DEFAULT 0.15 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "special_multiplier" numeric DEFAULT 4.5 NOT NULL,
    "matte_multiplier" numeric DEFAULT 1.25 NOT NULL,
    CONSTRAINT "ppf_pricing_rules_clear_multiplier_check" CHECK (("clear_multiplier" > (0)::numeric)),
    CONSTRAINT "ppf_pricing_rules_matte_uplift_pct_check" CHECK ((("matte_uplift_pct" >= (0)::numeric) AND ("matte_uplift_pct" <= 2.0))),
    CONSTRAINT "ppf_pricing_rules_waste_pct_check" CHECK ((("waste_pct" >= (0)::numeric) AND ("waste_pct" <= 2.0)))
);


ALTER TABLE "public"."ppf_pricing_rules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ppf_zone_labor_rates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "zone" "public"."service_zone" NOT NULL,
    "labor_rate_mxn_per_hour" numeric NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ppf_zone_labor_rates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "brand" "text" NOT NULL,
    "name" "text" NOT NULL,
    "category" "public"."protection_type_enum" NOT NULL,
    "volume_ml" integer,
    "price_mxn" numeric(12,2),
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "msrp_mxn" numeric(12,2),
    "cost_mxn" numeric(12,2)
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quote_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL
);


ALTER TABLE "public"."quote_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quote_line_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quote_id" "uuid" NOT NULL,
    "service_item_id" "uuid",
    "family" "public"."service_family" NOT NULL,
    "zone" "public"."service_zone" NOT NULL,
    "name" "text" NOT NULL,
    "is_main" boolean DEFAULT false NOT NULL,
    "is_standalone" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "inputs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "calc" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."quote_line_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."quotes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "status" "public"."quote_status" DEFAULT 'DRAFT'::"public"."quote_status" NOT NULL,
    "currency" "text" DEFAULT 'MXN'::"text" NOT NULL,
    "client_name" "text",
    "vehicle_notes" "text",
    "totals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "warnings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "webhook_url" "text",
    "webhook_status" "text" DEFAULT 'not_sent'::"text" NOT NULL,
    "webhook_last_response" "jsonb"
);


ALTER TABLE "public"."quotes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."roll_skus" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "width_in" smallint NOT NULL,
    "material_code" "text" NOT NULL,
    "cost_per_in2_mxn" numeric(14,6) NOT NULL,
    "max_length_in" integer,
    "warning_only" boolean DEFAULT true NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allowed_widths_in" integer[],
    "material_kind" "public"."ppf_material_kind",
    "finish" "public"."ppf_finish",
    "is_headlight_specific" boolean DEFAULT false NOT NULL,
    CONSTRAINT "roll_skus_cost_per_in2_mxn_check" CHECK (("cost_per_in2_mxn" >= (0)::numeric)),
    CONSTRAINT "roll_skus_width_in_check" CHECK (("width_in" = ANY (ARRAY[12, 24, 30, 36, 48, 60, 72])))
);


ALTER TABLE "public"."roll_skus" OWNER TO "postgres";


COMMENT ON COLUMN "public"."roll_skus"."allowed_widths_in" IS 'If set, UI should only allow selecting widths contained in this array for the given material_code. Null means allow widths based on roll_skus rows.';



CREATE TABLE IF NOT EXISTS "public"."rule_versions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "notes" "text",
    "is_active" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."rule_versions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "family" "public"."service_family" NOT NULL,
    "zone" "public"."service_zone" NOT NULL,
    "code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "allow_as_main" boolean DEFAULT false NOT NULL,
    "allow_as_addon" boolean DEFAULT true NOT NULL,
    "allow_as_standalone" boolean DEFAULT true NOT NULL,
    "is_main_only" boolean DEFAULT false NOT NULL,
    "pricing" "public"."pricing_model" NOT NULL,
    "time_model_id" "uuid",
    "consumables_model_id" "uuid",
    "input_schema" "jsonb",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_offers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_template_id" "uuid" NOT NULL,
    "protection_product_id" "uuid",
    "protection_type" "public"."protection_type_enum" NOT NULL,
    "pricing_model" "public"."pricing_model_enum" DEFAULT 'fixed'::"public"."pricing_model_enum" NOT NULL,
    "includes_one_step" boolean DEFAULT true NOT NULL,
    "default_correction_level" "public"."correction_level_enum" DEFAULT 'one_step'::"public"."correction_level_enum" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "display_name" "text",
    "product_price_source" "public"."price_source_enum" DEFAULT 'msrp'::"public"."price_source_enum" NOT NULL
);


ALTER TABLE "public"."service_offers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "family" "public"."service_family_enum" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."size_difficulty_multipliers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "code" "text" NOT NULL,
    "size_code" "text" NOT NULL,
    "difficulty" smallint NOT NULL,
    "multiplier" numeric(10,4) DEFAULT 1.0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "size_difficulty_multipliers_difficulty_check" CHECK (("difficulty" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "size_difficulty_multipliers_multiplier_check" CHECK (("multiplier" > (0)::numeric)),
    CONSTRAINT "size_difficulty_multipliers_size_code_check" CHECK (("size_code" = ANY (ARRAY['S'::"text", 'M'::"text", 'L'::"text", 'XL'::"text"])))
);


ALTER TABLE "public"."size_difficulty_multipliers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_models" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "rule_version_id" "uuid" NOT NULL,
    "model_key" "text" NOT NULL,
    "base_hours_s" numeric(10,4) DEFAULT 0 NOT NULL,
    "base_hours_m" numeric(10,4) DEFAULT 0 NOT NULL,
    "base_hours_l" numeric(10,4) DEFAULT 0 NOT NULL,
    "base_hours_xl" numeric(10,4) DEFAULT 0 NOT NULL,
    "apply_difficulty" boolean DEFAULT false NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."time_models" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bundle_template_lines"
    ADD CONSTRAINT "bundle_template_lines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bundle_templates"
    ADD CONSTRAINT "bundle_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bundle_templates"
    ADD CONSTRAINT "bundle_templates_rule_version_id_code_key" UNIQUE ("rule_version_id", "code");



ALTER TABLE ONLY "public"."ceramic_offer_discounts"
    ADD CONSTRAINT "ceramic_offer_discounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ceramic_offer_discounts"
    ADD CONSTRAINT "ceramic_offer_discounts_rule_version_id_service_offer_id_la_key" UNIQUE ("rule_version_id", "service_offer_id", "layers_required");



ALTER TABLE ONLY "public"."ceramic_pricing_rules"
    ADD CONSTRAINT "ceramic_pricing_rules_pkey" PRIMARY KEY ("rule_version_id");



ALTER TABLE ONLY "public"."ceramic_systems"
    ADD CONSTRAINT "ceramic_systems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ceramic_systems"
    ADD CONSTRAINT "ceramic_systems_rule_version_id_system_code_key" UNIQUE ("rule_version_id", "system_code");



ALTER TABLE ONLY "public"."consumables_models"
    ADD CONSTRAINT "consumables_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consumables_models"
    ADD CONSTRAINT "consumables_models_rule_version_id_model_key_key" UNIQUE ("rule_version_id", "model_key");



ALTER TABLE ONLY "public"."correction_packages"
    ADD CONSTRAINT "correction_packages_level_key" UNIQUE ("level");



ALTER TABLE ONLY "public"."correction_packages"
    ADD CONSTRAINT "correction_packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."correction_price_delta_by_size"
    ADD CONSTRAINT "correction_price_delta_by_siz_service_offer_id_correction_p_key" UNIQUE ("service_offer_id", "correction_package_id", "vehicle_size");



ALTER TABLE ONLY "public"."correction_price_delta_by_size"
    ADD CONSTRAINT "correction_price_delta_by_size_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discount_caps"
    ADD CONSTRAINT "discount_caps_pkey" PRIMARY KEY ("rule_version_id");



ALTER TABLE ONLY "public"."discount_rules"
    ADD CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_correction_options"
    ADD CONSTRAINT "offer_correction_options_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_correction_options"
    ADD CONSTRAINT "offer_correction_options_service_offer_id_correction_packag_key" UNIQUE ("service_offer_id", "correction_package_id");



ALTER TABLE ONLY "public"."offer_pricing_by_size"
    ADD CONSTRAINT "offer_pricing_by_size_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_pricing_by_size"
    ADD CONSTRAINT "offer_pricing_by_size_service_offer_id_vehicle_size_key" UNIQUE ("service_offer_id", "vehicle_size");



ALTER TABLE ONLY "public"."offer_surface_coat_defaults"
    ADD CONSTRAINT "offer_surface_coat_defaults_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_surface_coat_defaults"
    ADD CONSTRAINT "offer_surface_coat_defaults_service_offer_id_surface_key" UNIQUE ("service_offer_id", "surface");



ALTER TABLE ONLY "public"."offer_surfaces"
    ADD CONSTRAINT "offer_surfaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_surfaces"
    ADD CONSTRAINT "offer_surfaces_service_offer_id_surface_key" UNIQUE ("service_offer_id", "surface");



ALTER TABLE ONLY "public"."offer_usage_ml"
    ADD CONSTRAINT "offer_usage_ml_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."offer_usage_ml"
    ADD CONSTRAINT "offer_usage_ml_service_offer_id_vehicle_size_surface_key" UNIQUE ("service_offer_id", "vehicle_size", "surface");



ALTER TABLE ONLY "public"."ppf_bundle_pricing"
    ADD CONSTRAINT "ppf_bundle_pricing_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ppf_bundle_pricing"
    ADD CONSTRAINT "ppf_bundle_pricing_rule_version_id_bundle_template_id_key" UNIQUE ("rule_version_id", "bundle_template_id");



ALTER TABLE ONLY "public"."ppf_full_area_by_size_zone"
    ADD CONSTRAINT "ppf_full_area_by_size_zone_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ppf_full_area_by_size_zone"
    ADD CONSTRAINT "ppf_full_area_by_size_zone_rule_version_id_size_code_zone_key" UNIQUE ("rule_version_id", "size_code", "zone");



ALTER TABLE ONLY "public"."ppf_labor_rates"
    ADD CONSTRAINT "ppf_labor_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ppf_labor_rates"
    ADD CONSTRAINT "ppf_labor_rates_rule_version_id_code_key" UNIQUE ("rule_version_id", "code");



ALTER TABLE ONLY "public"."ppf_material_rules"
    ADD CONSTRAINT "ppf_material_rules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ppf_material_rules"
    ADD CONSTRAINT "ppf_material_rules_rule_version_id_material_code_key" UNIQUE ("rule_version_id", "material_code");



ALTER TABLE ONLY "public"."ppf_pricing_rules"
    ADD CONSTRAINT "ppf_pricing_rules_pkey" PRIMARY KEY ("rule_version_id");



ALTER TABLE ONLY "public"."ppf_zone_labor_rates"
    ADD CONSTRAINT "ppf_zone_labor_rates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ppf_zone_labor_rates"
    ADD CONSTRAINT "ppf_zone_labor_rates_rule_version_id_zone_key" UNIQUE ("rule_version_id", "zone");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quote_events"
    ADD CONSTRAINT "quote_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."roll_skus"
    ADD CONSTRAINT "roll_skus_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rule_versions"
    ADD CONSTRAINT "rule_versions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_items"
    ADD CONSTRAINT "service_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_items"
    ADD CONSTRAINT "service_items_rule_version_id_code_key" UNIQUE ("rule_version_id", "code");



ALTER TABLE ONLY "public"."service_offers"
    ADD CONSTRAINT "service_offers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_templates"
    ADD CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."size_difficulty_multipliers"
    ADD CONSTRAINT "size_difficulty_multipliers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."size_difficulty_multipliers"
    ADD CONSTRAINT "size_difficulty_multipliers_rule_version_id_code_key" UNIQUE ("rule_version_id", "code");



ALTER TABLE ONLY "public"."time_models"
    ADD CONSTRAINT "time_models_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_models"
    ADD CONSTRAINT "time_models_rule_version_id_model_key_key" UNIQUE ("rule_version_id", "model_key");



CREATE INDEX "bundle_lines_bundle_idx" ON "public"."bundle_template_lines" USING "btree" ("bundle_template_id");



CREATE INDEX "ceramic_offer_discounts_offer_idx" ON "public"."ceramic_offer_discounts" USING "btree" ("service_offer_id");



CREATE INDEX "ceramic_systems_product_id_idx" ON "public"."ceramic_systems" USING "btree" ("product_id");



CREATE INDEX "discount_rules_rule_idx" ON "public"."discount_rules" USING "btree" ("rule_version_id");



CREATE INDEX "discount_rules_target_idx" ON "public"."discount_rules" USING "btree" ("target_family", "target_zone");



CREATE INDEX "idx_correction_packages_level" ON "public"."correction_packages" USING "btree" ("level");



CREATE INDEX "idx_offer_corr_offer" ON "public"."offer_correction_options" USING "btree" ("service_offer_id");



CREATE INDEX "idx_offer_pricing_offer" ON "public"."offer_pricing_by_size" USING "btree" ("service_offer_id");



CREATE INDEX "idx_offer_surfaces_offer" ON "public"."offer_surfaces" USING "btree" ("service_offer_id");



CREATE INDEX "idx_offer_surfaces_surface" ON "public"."offer_surfaces" USING "btree" ("surface");



CREATE INDEX "idx_offer_usage_offer" ON "public"."offer_usage_ml" USING "btree" ("service_offer_id");



CREATE INDEX "idx_offer_usage_size" ON "public"."offer_usage_ml" USING "btree" ("vehicle_size");



CREATE INDEX "idx_offer_usage_surface" ON "public"."offer_usage_ml" USING "btree" ("surface");



CREATE INDEX "idx_products_brand" ON "public"."products" USING "btree" ("brand");



CREATE INDEX "idx_products_category" ON "public"."products" USING "btree" ("category");



CREATE INDEX "idx_service_offers_product" ON "public"."service_offers" USING "btree" ("protection_product_id");



CREATE INDEX "idx_service_offers_template" ON "public"."service_offers" USING "btree" ("service_template_id");



CREATE INDEX "idx_service_offers_type" ON "public"."service_offers" USING "btree" ("protection_type");



CREATE INDEX "idx_service_templates_family" ON "public"."service_templates" USING "btree" ("family");



CREATE UNIQUE INDEX "ppf_bundle_pricing_rule_bundle_uidx" ON "public"."ppf_bundle_pricing" USING "btree" ("rule_version_id", "bundle_template_id");



CREATE INDEX "ppf_bundle_pricing_rule_idx" ON "public"."ppf_bundle_pricing" USING "btree" ("rule_version_id");



CREATE INDEX "ppf_labor_rates_rule_idx" ON "public"."ppf_labor_rates" USING "btree" ("rule_version_id");



CREATE INDEX "quote_events_quote_idx" ON "public"."quote_events" USING "btree" ("quote_id");



CREATE INDEX "quote_line_items_quote_idx" ON "public"."quote_line_items" USING "btree" ("quote_id");



CREATE INDEX "quotes_created_at_idx" ON "public"."quotes" USING "btree" ("created_at" DESC);



CREATE INDEX "quotes_rule_idx" ON "public"."quotes" USING "btree" ("rule_version_id");



CREATE INDEX "roll_skus_rule_idx" ON "public"."roll_skus" USING "btree" ("rule_version_id");



CREATE UNIQUE INDEX "roll_skus_unique_per_version" ON "public"."roll_skus" USING "btree" ("rule_version_id", "width_in", "material_code");



CREATE INDEX "roll_skus_width_idx" ON "public"."roll_skus" USING "btree" ("width_in");



CREATE UNIQUE INDEX "rule_versions_one_active" ON "public"."rule_versions" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE UNIQUE INDEX "rule_versions_one_active_idx" ON "public"."rule_versions" USING "btree" ("is_active") WHERE ("is_active" = true);



CREATE INDEX "service_items_family_zone_idx" ON "public"."service_items" USING "btree" ("family", "zone");



CREATE INDEX "service_items_rule_idx" ON "public"."service_items" USING "btree" ("rule_version_id");



CREATE OR REPLACE TRIGGER "bundle_templates_set_updated_at" BEFORE UPDATE ON "public"."bundle_templates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "ceramic_systems_set_updated_at" BEFORE UPDATE ON "public"."ceramic_systems" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "consumables_set_updated_at" BEFORE UPDATE ON "public"."consumables_models" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "discount_caps_set_updated_at" BEFORE UPDATE ON "public"."discount_caps" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "discount_rules_set_updated_at" BEFORE UPDATE ON "public"."discount_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "ppf_rules_set_updated_at" BEFORE UPDATE ON "public"."ppf_pricing_rules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "quotes_set_updated_at" BEFORE UPDATE ON "public"."quotes" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "roll_skus_set_updated_at" BEFORE UPDATE ON "public"."roll_skus" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "service_items_set_updated_at" BEFORE UPDATE ON "public"."service_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "size_diff_set_updated_at" BEFORE UPDATE ON "public"."size_difficulty_multipliers" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "time_models_set_updated_at" BEFORE UPDATE ON "public"."time_models" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."app_users"
    ADD CONSTRAINT "app_users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bundle_template_lines"
    ADD CONSTRAINT "bundle_template_lines_bundle_template_id_fkey" FOREIGN KEY ("bundle_template_id") REFERENCES "public"."bundle_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bundle_template_lines"
    ADD CONSTRAINT "bundle_template_lines_service_item_id_fkey" FOREIGN KEY ("service_item_id") REFERENCES "public"."service_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."bundle_templates"
    ADD CONSTRAINT "bundle_templates_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ceramic_offer_discounts"
    ADD CONSTRAINT "ceramic_offer_discounts_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ceramic_offer_discounts"
    ADD CONSTRAINT "ceramic_offer_discounts_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ceramic_pricing_rules"
    ADD CONSTRAINT "ceramic_pricing_rules_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ceramic_systems"
    ADD CONSTRAINT "ceramic_systems_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ceramic_systems"
    ADD CONSTRAINT "ceramic_systems_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consumables_models"
    ADD CONSTRAINT "consumables_models_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."correction_price_delta_by_size"
    ADD CONSTRAINT "correction_price_delta_by_size_correction_package_id_fkey" FOREIGN KEY ("correction_package_id") REFERENCES "public"."correction_packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."correction_price_delta_by_size"
    ADD CONSTRAINT "correction_price_delta_by_size_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discount_caps"
    ADD CONSTRAINT "discount_caps_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."discount_rules"
    ADD CONSTRAINT "discount_rules_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_correction_options"
    ADD CONSTRAINT "offer_correction_options_correction_package_id_fkey" FOREIGN KEY ("correction_package_id") REFERENCES "public"."correction_packages"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."offer_correction_options"
    ADD CONSTRAINT "offer_correction_options_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_pricing_by_size"
    ADD CONSTRAINT "offer_pricing_by_size_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_surface_coat_defaults"
    ADD CONSTRAINT "offer_surface_coat_defaults_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_surfaces"
    ADD CONSTRAINT "offer_surfaces_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."offer_usage_ml"
    ADD CONSTRAINT "offer_usage_ml_service_offer_id_fkey" FOREIGN KEY ("service_offer_id") REFERENCES "public"."service_offers"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_bundle_pricing"
    ADD CONSTRAINT "ppf_bundle_pricing_bundle_template_id_fkey" FOREIGN KEY ("bundle_template_id") REFERENCES "public"."bundle_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_bundle_pricing"
    ADD CONSTRAINT "ppf_bundle_pricing_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_full_area_by_size_zone"
    ADD CONSTRAINT "ppf_full_area_by_size_zone_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_labor_rates"
    ADD CONSTRAINT "ppf_labor_rates_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_material_rules"
    ADD CONSTRAINT "ppf_material_rules_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_pricing_rules"
    ADD CONSTRAINT "ppf_pricing_rules_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ppf_zone_labor_rates"
    ADD CONSTRAINT "ppf_zone_labor_rates_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quote_events"
    ADD CONSTRAINT "quote_events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."quote_events"
    ADD CONSTRAINT "quote_events_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."quote_line_items"
    ADD CONSTRAINT "quote_line_items_service_item_id_fkey" FOREIGN KEY ("service_item_id") REFERENCES "public"."service_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."quotes"
    ADD CONSTRAINT "quotes_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id");



ALTER TABLE ONLY "public"."roll_skus"
    ADD CONSTRAINT "roll_skus_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rule_versions"
    ADD CONSTRAINT "rule_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."app_users"("id");



ALTER TABLE ONLY "public"."service_items"
    ADD CONSTRAINT "service_items_consumables_model_id_fkey" FOREIGN KEY ("consumables_model_id") REFERENCES "public"."consumables_models"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_items"
    ADD CONSTRAINT "service_items_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_items"
    ADD CONSTRAINT "service_items_time_model_id_fkey" FOREIGN KEY ("time_model_id") REFERENCES "public"."time_models"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_offers"
    ADD CONSTRAINT "service_offers_protection_product_id_fkey" FOREIGN KEY ("protection_product_id") REFERENCES "public"."products"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_offers"
    ADD CONSTRAINT "service_offers_service_template_id_fkey" FOREIGN KEY ("service_template_id") REFERENCES "public"."service_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."size_difficulty_multipliers"
    ADD CONSTRAINT "size_difficulty_multipliers_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."time_models"
    ADD CONSTRAINT "time_models_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "public"."rule_versions"("id") ON DELETE CASCADE;



ALTER TABLE "public"."app_users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "app_users_self_select" ON "public"."app_users" FOR SELECT USING (("id" = "auth"."uid"()));



CREATE POLICY "app_users_self_update" ON "public"."app_users" FOR UPDATE USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "app_users_self_upsert" ON "public"."app_users" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



ALTER TABLE "public"."bundle_template_lines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bundle_template_lines_owner_all" ON "public"."bundle_template_lines" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."bundle_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bundle_templates_owner_all" ON "public"."bundle_templates" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."ceramic_systems" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ceramic_systems_owner_all" ON "public"."ceramic_systems" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."consumables_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consumables_models_owner_all" ON "public"."consumables_models" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."correction_packages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."correction_price_delta_by_size" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."discount_caps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discount_caps_owner_all" ON "public"."discount_caps" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."discount_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "discount_rules_owner_all" ON "public"."discount_rules" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."offer_pricing_by_size" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offer_surfaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."offer_usage_ml" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ppf_bundle_pricing" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ppf_bundle_pricing_select_auth" ON "public"."ppf_bundle_pricing" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."ppf_full_area_by_size_zone" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ppf_labor_rates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ppf_labor_rates_read_auth" ON "public"."ppf_labor_rates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."ppf_material_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ppf_material_rules_select_auth" ON "public"."ppf_material_rules" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."ppf_pricing_rules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ppf_pricing_rules_owner_all" ON "public"."ppf_pricing_rules" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."ppf_zone_labor_rates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."quote_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quote_events_owner_all" ON "public"."quote_events" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."quote_line_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quote_line_items_owner_all" ON "public"."quote_line_items" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."quotes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "quotes_delete_own" ON "public"."quotes" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "quotes_insert_own" ON "public"."quotes" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "quotes_owner_all" ON "public"."quotes" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



CREATE POLICY "quotes_select_own" ON "public"."quotes" FOR SELECT TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "quotes_update_own" ON "public"."quotes" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "read correction_packages (auth)" ON "public"."correction_packages" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read correction_price_delta_by_size (auth)" ON "public"."correction_price_delta_by_size" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read offer_pricing_by_size (auth)" ON "public"."offer_pricing_by_size" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read offer_surfaces (auth)" ON "public"."offer_surfaces" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read offer_usage_ml (auth)" ON "public"."offer_usage_ml" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read products (auth)" ON "public"."products" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read service_offers (auth)" ON "public"."service_offers" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read service_templates (auth)" ON "public"."service_templates" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_full_area_auth" ON "public"."ppf_full_area_by_size_zone" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "read_labor_rates_auth" ON "public"."ppf_zone_labor_rates" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."roll_skus" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "roll_skus_owner_all" ON "public"."roll_skus" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."rule_versions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rule_versions_owner_all" ON "public"."rule_versions" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



CREATE POLICY "rule_versions_read" ON "public"."rule_versions" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."service_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_items_owner_all" ON "public"."service_items" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



ALTER TABLE "public"."service_offers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."size_difficulty_multipliers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "size_difficulty_multipliers_owner_all" ON "public"."size_difficulty_multipliers" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



CREATE POLICY "size_difficulty_multipliers_read" ON "public"."size_difficulty_multipliers" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."time_models" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_models_owner_all" ON "public"."time_models" USING ("public"."is_owner"()) WITH CHECK ("public"."is_owner"());



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_offer_price_mxn"("p_offer_id" "uuid", "p_vehicle_size" "public"."vehicle_size_enum", "p_correction_level" "public"."correction_level_enum") TO "anon";
GRANT ALL ON FUNCTION "public"."compute_offer_price_mxn"("p_offer_id" "uuid", "p_vehicle_size" "public"."vehicle_size_enum", "p_correction_level" "public"."correction_level_enum") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_offer_price_mxn"("p_offer_id" "uuid", "p_vehicle_size" "public"."vehicle_size_enum", "p_correction_level" "public"."correction_level_enum") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_auth_user_app_users"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user_app_users"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_auth_user_app_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ppf_calc_line_item"("p_rule_version_id" "uuid", "p_bundle_template_id" "uuid", "p_material_code" "text", "p_width_in" numeric, "p_length_in" numeric, "p_hours" numeric, "p_size_code" "text", "p_difficulty" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."ppf_calc_line_item"("p_rule_version_id" "uuid", "p_bundle_template_id" "uuid", "p_material_code" "text", "p_width_in" numeric, "p_length_in" numeric, "p_hours" numeric, "p_size_code" "text", "p_difficulty" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ppf_calc_line_item"("p_rule_version_id" "uuid", "p_bundle_template_id" "uuid", "p_material_code" "text", "p_width_in" numeric, "p_length_in" numeric, "p_hours" numeric, "p_size_code" "text", "p_difficulty" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."app_users" TO "anon";
GRANT ALL ON TABLE "public"."app_users" TO "authenticated";
GRANT ALL ON TABLE "public"."app_users" TO "service_role";



GRANT ALL ON TABLE "public"."bundle_template_lines" TO "anon";
GRANT ALL ON TABLE "public"."bundle_template_lines" TO "authenticated";
GRANT ALL ON TABLE "public"."bundle_template_lines" TO "service_role";



GRANT ALL ON TABLE "public"."bundle_templates" TO "anon";
GRANT ALL ON TABLE "public"."bundle_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."bundle_templates" TO "service_role";



GRANT ALL ON TABLE "public"."ceramic_offer_discounts" TO "anon";
GRANT ALL ON TABLE "public"."ceramic_offer_discounts" TO "authenticated";
GRANT ALL ON TABLE "public"."ceramic_offer_discounts" TO "service_role";



GRANT ALL ON TABLE "public"."ceramic_pricing_rules" TO "anon";
GRANT ALL ON TABLE "public"."ceramic_pricing_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."ceramic_pricing_rules" TO "service_role";



GRANT ALL ON TABLE "public"."ceramic_systems" TO "anon";
GRANT ALL ON TABLE "public"."ceramic_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."ceramic_systems" TO "service_role";



GRANT ALL ON TABLE "public"."consumables_models" TO "anon";
GRANT ALL ON TABLE "public"."consumables_models" TO "authenticated";
GRANT ALL ON TABLE "public"."consumables_models" TO "service_role";



GRANT ALL ON TABLE "public"."correction_packages" TO "anon";
GRANT ALL ON TABLE "public"."correction_packages" TO "authenticated";
GRANT ALL ON TABLE "public"."correction_packages" TO "service_role";



GRANT ALL ON TABLE "public"."correction_price_delta_by_size" TO "anon";
GRANT ALL ON TABLE "public"."correction_price_delta_by_size" TO "authenticated";
GRANT ALL ON TABLE "public"."correction_price_delta_by_size" TO "service_role";



GRANT ALL ON TABLE "public"."discount_caps" TO "anon";
GRANT ALL ON TABLE "public"."discount_caps" TO "authenticated";
GRANT ALL ON TABLE "public"."discount_caps" TO "service_role";



GRANT ALL ON TABLE "public"."discount_rules" TO "anon";
GRANT ALL ON TABLE "public"."discount_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."discount_rules" TO "service_role";



GRANT ALL ON TABLE "public"."offer_correction_options" TO "anon";
GRANT ALL ON TABLE "public"."offer_correction_options" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_correction_options" TO "service_role";



GRANT ALL ON TABLE "public"."offer_pricing_by_size" TO "anon";
GRANT ALL ON TABLE "public"."offer_pricing_by_size" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_pricing_by_size" TO "service_role";



GRANT ALL ON TABLE "public"."offer_surface_coat_defaults" TO "anon";
GRANT ALL ON TABLE "public"."offer_surface_coat_defaults" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_surface_coat_defaults" TO "service_role";



GRANT ALL ON TABLE "public"."offer_surfaces" TO "anon";
GRANT ALL ON TABLE "public"."offer_surfaces" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_surfaces" TO "service_role";



GRANT ALL ON TABLE "public"."offer_usage_ml" TO "anon";
GRANT ALL ON TABLE "public"."offer_usage_ml" TO "authenticated";
GRANT ALL ON TABLE "public"."offer_usage_ml" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_bundle_pricing" TO "anon";
GRANT ALL ON TABLE "public"."ppf_bundle_pricing" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_bundle_pricing" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_full_area_by_size_zone" TO "anon";
GRANT ALL ON TABLE "public"."ppf_full_area_by_size_zone" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_full_area_by_size_zone" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_labor_rates" TO "anon";
GRANT ALL ON TABLE "public"."ppf_labor_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_labor_rates" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_material_rules" TO "anon";
GRANT ALL ON TABLE "public"."ppf_material_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_material_rules" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_pricing_rules" TO "anon";
GRANT ALL ON TABLE "public"."ppf_pricing_rules" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_pricing_rules" TO "service_role";



GRANT ALL ON TABLE "public"."ppf_zone_labor_rates" TO "anon";
GRANT ALL ON TABLE "public"."ppf_zone_labor_rates" TO "authenticated";
GRANT ALL ON TABLE "public"."ppf_zone_labor_rates" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."quote_events" TO "anon";
GRANT ALL ON TABLE "public"."quote_events" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_events" TO "service_role";



GRANT ALL ON TABLE "public"."quote_line_items" TO "anon";
GRANT ALL ON TABLE "public"."quote_line_items" TO "authenticated";
GRANT ALL ON TABLE "public"."quote_line_items" TO "service_role";



GRANT ALL ON TABLE "public"."quotes" TO "anon";
GRANT ALL ON TABLE "public"."quotes" TO "authenticated";
GRANT ALL ON TABLE "public"."quotes" TO "service_role";



GRANT ALL ON TABLE "public"."roll_skus" TO "anon";
GRANT ALL ON TABLE "public"."roll_skus" TO "authenticated";
GRANT ALL ON TABLE "public"."roll_skus" TO "service_role";



GRANT ALL ON TABLE "public"."rule_versions" TO "anon";
GRANT ALL ON TABLE "public"."rule_versions" TO "authenticated";
GRANT ALL ON TABLE "public"."rule_versions" TO "service_role";



GRANT ALL ON TABLE "public"."service_items" TO "anon";
GRANT ALL ON TABLE "public"."service_items" TO "authenticated";
GRANT ALL ON TABLE "public"."service_items" TO "service_role";



GRANT ALL ON TABLE "public"."service_offers" TO "anon";
GRANT ALL ON TABLE "public"."service_offers" TO "authenticated";
GRANT ALL ON TABLE "public"."service_offers" TO "service_role";



GRANT ALL ON TABLE "public"."service_templates" TO "anon";
GRANT ALL ON TABLE "public"."service_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."service_templates" TO "service_role";



GRANT ALL ON TABLE "public"."size_difficulty_multipliers" TO "anon";
GRANT ALL ON TABLE "public"."size_difficulty_multipliers" TO "authenticated";
GRANT ALL ON TABLE "public"."size_difficulty_multipliers" TO "service_role";



GRANT ALL ON TABLE "public"."time_models" TO "anon";
GRANT ALL ON TABLE "public"."time_models" TO "authenticated";
GRANT ALL ON TABLE "public"."time_models" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







