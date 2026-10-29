CREATE TABLE "product_specs" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "attributeId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "product_specs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_specs_productId_attributeId_key" ON "product_specs" ("productId", "attributeId");
CREATE INDEX "product_specs_attributeId_idx" ON "product_specs" ("attributeId");

ALTER TABLE "product_specs"
ADD CONSTRAINT "product_specs_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_specs"
ADD CONSTRAINT "product_specs_attributeId_fkey"
FOREIGN KEY ("attributeId") REFERENCES "attribute_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_options" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "attributeId" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_options_productId_attributeId_key" ON "product_options" ("productId", "attributeId");
CREATE INDEX "product_options_attributeId_idx" ON "product_options" ("attributeId");

ALTER TABLE "product_options"
ADD CONSTRAINT "product_options_productId_fkey"
FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_options"
ADD CONSTRAINT "product_options_attributeId_fkey"
FOREIGN KEY ("attributeId") REFERENCES "attribute_definitions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "product_option_values" (
  "id" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "product_option_values_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_option_values_optionId_idx" ON "product_option_values" ("optionId");

ALTER TABLE "product_option_values"
ADD CONSTRAINT "product_option_values_optionId_fkey"
FOREIGN KEY ("optionId") REFERENCES "product_options" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Classify existing pack attributes once.
-- A value identical on every alive pack is a spec, unless that text is in every pack name.
-- A product with one pack turns every attribute into a spec.
CREATE TEMP TABLE "_pack" (
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  variant_name TEXT NOT NULL,
  ord INTEGER NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE "_attr" (
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  value TEXT NOT NULL,
  ord INTEGER NOT NULL
) ON COMMIT DROP;

INSERT INTO "_pack" (product_id, variant_id, variant_name, ord)
SELECT
  v."productId",
  v.id,
  COALESCE(v.name, ''),
  ROW_NUMBER() OVER (
    PARTITION BY v."productId"
    ORDER BY v."isDefault" DESC, v."createdAt" ASC, v.id
  )
FROM "product_variants" v
WHERE v."deletedAt" IS NULL;

INSERT INTO "_attr" (product_id, variant_id, attribute_id, value, ord)
SELECT p.product_id, p.variant_id, va."attributeId", va.value, p.ord
FROM "_pack" p
JOIN "variant_attributes" va ON va."variantId" = p.variant_id;

DO $$
DECLARE
  current_product TEXT;
  pack_count INT;
  current_attribute TEXT;
  spec_position INT;
  option_position INT;
  value_position INT;
  shared_value TEXT;
  all_same BOOLEAN;
  named_in_every BOOLEAN;
  option_id TEXT;
  seen_value TEXT;
  attr_value TEXT;
BEGIN
  FOR current_product IN SELECT DISTINCT p.product_id FROM "_pack" p LOOP
    SELECT COUNT(*) INTO pack_count FROM "_pack" p WHERE p.product_id = current_product;
    spec_position := 0;
    option_position := 0;

    FOR current_attribute IN
      SELECT a.attribute_id
      FROM "_attr" a
      WHERE a.product_id = current_product
      GROUP BY a.attribute_id
      ORDER BY MIN(a.ord), a.attribute_id
    LOOP
      SELECT COUNT(*) = pack_count
        AND COUNT(DISTINCT lower(btrim(a.value))) = 1
        AND COUNT(*) FILTER (WHERE btrim(a.value) <> '') = pack_count
      INTO all_same
      FROM "_attr" a
      WHERE a.product_id = current_product AND a.attribute_id = current_attribute;

      SELECT a.value INTO shared_value
      FROM "_attr" a
      WHERE a.product_id = current_product AND a.attribute_id = current_attribute
      ORDER BY a.ord
      LIMIT 1;

      SELECT COALESCE(bool_and(parts.hit), false) INTO named_in_every
      FROM (
        SELECT EXISTS (
          SELECT 1
          FROM regexp_split_to_table(lower(p.variant_name), '/') AS part
          WHERE btrim(part) = lower(btrim(shared_value))
        ) AS hit
        FROM "_pack" p
        WHERE p.product_id = current_product
      ) parts;

      IF pack_count = 1 OR (all_same AND NOT named_in_every) THEN
        INSERT INTO "product_specs" ("id", "productId", "attributeId", "value", "position")
        VALUES (gen_random_uuid()::text, current_product, current_attribute, btrim(shared_value), spec_position);
        spec_position := spec_position + 1;

        DELETE FROM "variant_attributes" va
        USING "product_variants" v
        WHERE va."variantId" = v.id
          AND v."productId" = current_product
          AND v."deletedAt" IS NULL
          AND va."attributeId" = current_attribute;
      ELSE
        option_id := gen_random_uuid()::text;
        INSERT INTO "product_options" ("id", "productId", "attributeId", "position")
        VALUES (option_id, current_product, current_attribute, option_position);
        option_position := option_position + 1;
        value_position := 0;

        FOR attr_value IN
          SELECT a.value
          FROM "_attr" a
          WHERE a.product_id = current_product
            AND a.attribute_id = current_attribute
            AND btrim(a.value) <> ''
          ORDER BY a.ord, a.value
        LOOP
          seen_value := NULL;
          SELECT ov.value INTO seen_value
          FROM "product_option_values" ov
          WHERE ov."optionId" = option_id
            AND lower(btrim(ov.value)) = lower(btrim(attr_value))
          LIMIT 1;
          IF seen_value IS NULL THEN
            INSERT INTO "product_option_values" ("id", "optionId", "value", "position")
            VALUES (gen_random_uuid()::text, option_id, btrim(attr_value), value_position);
            value_position := value_position + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Open catalog drafts keep their own copy of pack attributes. Split those the same way.
DO $$
DECLARE
  product_row RECORD;
  draft JSONB;
  variants JSONB;
  variant JSONB;
  attribute JSONB;
  pack_count INT;
  ord INT;
  current_attribute TEXT;
  shared_value TEXT;
  all_same BOOLEAN;
  named_in_every BOOLEAN;
  spec_position INT;
  option_position INT;
  value_position INT;
  specs JSONB;
  options JSONB;
  option_values JSONB;
  next_variants JSONB;
  next_attributes JSONB;
  spec_ids TEXT[];
  seen TEXT[];
  attr_value TEXT;
  variant_name TEXT;
BEGIN
  CREATE TEMP TABLE "_dpack" (
    variant_index INT NOT NULL,
    variant_name TEXT NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE "_dattr" (
    variant_index INT NOT NULL,
    attribute_id TEXT NOT NULL,
    value TEXT NOT NULL
  ) ON COMMIT DROP;

  FOR product_row IN
    SELECT id, "catalogDraft" FROM "products" WHERE "catalogDraft" IS NOT NULL
  LOOP
    draft := product_row."catalogDraft";
    IF jsonb_typeof(draft->'specs') = 'array' AND jsonb_typeof(draft->'options') = 'array' THEN
      CONTINUE;
    END IF;
    variants := COALESCE(draft->'variants', '[]'::jsonb);
    DELETE FROM "_dpack";
    DELETE FROM "_dattr";
    ord := 0;
    FOR variant IN SELECT value FROM jsonb_array_elements(variants) LOOP
      INSERT INTO "_dpack" (variant_index, variant_name)
      VALUES (ord, COALESCE(variant->>'name', ''));
      FOR attribute IN SELECT value FROM jsonb_array_elements(COALESCE(variant->'attributes', '[]'::jsonb)) LOOP
        IF COALESCE(attribute->>'attributeId', '') <> '' THEN
          INSERT INTO "_dattr" (variant_index, attribute_id, value)
          VALUES (ord, attribute->>'attributeId', COALESCE(attribute->>'value', ''));
        END IF;
      END LOOP;
      ord := ord + 1;
    END LOOP;

    SELECT COUNT(*) INTO pack_count FROM "_dpack";
    specs := '[]'::jsonb;
    options := '[]'::jsonb;
    spec_ids := ARRAY[]::TEXT[];
    spec_position := 0;
    option_position := 0;

    IF pack_count > 0 THEN
      FOR current_attribute IN
        SELECT a.attribute_id
        FROM "_dattr" a
        GROUP BY a.attribute_id
        ORDER BY MIN(a.variant_index), a.attribute_id
      LOOP
        SELECT COUNT(*) = pack_count
          AND COUNT(DISTINCT lower(btrim(a.value))) = 1
          AND COUNT(*) FILTER (WHERE btrim(a.value) <> '') = pack_count
        INTO all_same
        FROM "_dattr" a
        WHERE a.attribute_id = current_attribute;

        SELECT a.value INTO shared_value
        FROM "_dattr" a
        WHERE a.attribute_id = current_attribute
        ORDER BY a.variant_index
        LIMIT 1;

        SELECT COALESCE(bool_and(parts.hit), false) INTO named_in_every
        FROM (
          SELECT EXISTS (
            SELECT 1
            FROM regexp_split_to_table(lower(p.variant_name), '/') AS part
            WHERE btrim(part) = lower(btrim(shared_value))
          ) AS hit
          FROM "_dpack" p
        ) parts;

        IF pack_count = 1 OR (all_same AND NOT named_in_every) THEN
          specs := specs || jsonb_build_array(jsonb_build_object(
            'attributeId', current_attribute,
            'value', btrim(shared_value),
            'position', spec_position
          ));
          spec_ids := array_append(spec_ids, current_attribute);
          spec_position := spec_position + 1;
        ELSE
          option_values := '[]'::jsonb;
          value_position := 0;
          seen := ARRAY[]::TEXT[];
          FOR attr_value IN
            SELECT a.value
            FROM "_dattr" a
            WHERE a.attribute_id = current_attribute AND btrim(a.value) <> ''
            ORDER BY a.variant_index, a.value
          LOOP
            IF NOT (lower(btrim(attr_value)) = ANY (seen)) THEN
              option_values := option_values || jsonb_build_array(to_jsonb(btrim(attr_value)));
              seen := array_append(seen, lower(btrim(attr_value)));
              value_position := value_position + 1;
            END IF;
          END LOOP;
          options := options || jsonb_build_array(jsonb_build_object(
            'attributeId', current_attribute,
            'position', option_position,
            'values', option_values
          ));
          option_position := option_position + 1;
        END IF;
      END LOOP;
    END IF;

    next_variants := '[]'::jsonb;
    ord := 0;
    FOR variant IN SELECT value FROM jsonb_array_elements(variants) LOOP
      next_attributes := '[]'::jsonb;
      FOR attribute IN SELECT value FROM jsonb_array_elements(COALESCE(variant->'attributes', '[]'::jsonb)) LOOP
        IF NOT (COALESCE(attribute->>'attributeId', '') = ANY (spec_ids)) THEN
          next_attributes := next_attributes || jsonb_build_array(attribute);
        END IF;
      END LOOP;
      next_variants := next_variants || jsonb_build_array(jsonb_set(variant, '{attributes}', next_attributes));
      ord := ord + 1;
    END LOOP;

    draft := jsonb_set(draft, '{specs}', specs, true);
    draft := jsonb_set(draft, '{options}', options, true);
    draft := jsonb_set(draft, '{variants}', next_variants, true);

    UPDATE "products"
    SET "catalogDraft" = draft
    WHERE id = product_row.id;
  END LOOP;
END $$;
