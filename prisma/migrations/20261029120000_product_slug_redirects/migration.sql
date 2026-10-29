CREATE TABLE "product_slug_redirects" (
  "slug" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "product_slug_redirects_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX "product_slug_redirects_productId_idx" ON "product_slug_redirects" ("productId");

ALTER TABLE "product_slug_redirects" ADD CONSTRAINT "product_slug_redirects_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
