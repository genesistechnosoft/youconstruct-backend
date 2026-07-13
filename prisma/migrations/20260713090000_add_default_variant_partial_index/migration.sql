CREATE UNIQUE INDEX "product_variants_one_default"
ON "product_variants"("productId")
WHERE "isDefault" = true AND "deletedAt" IS NULL;
