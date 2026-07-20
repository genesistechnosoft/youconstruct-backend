-- CreateEnum
CREATE TYPE "ShippingMethodType" AS ENUM ('FLAT', 'FREE', 'DISTANCE_BASED', 'UNIT_BASED', 'ORDER_VALUE_BASED');

-- CreateEnum
CREATE TYPE "ShippingUnitType" AS ENUM ('UNIT', 'KG', 'CBM');

-- CreateTable
CREATE TABLE "vendor_shipping_methods" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "methodType" "ShippingMethodType" NOT NULL,
    "flatCharge" DECIMAL(10,2),
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "freeAboveOrderValue" DECIMAL(10,2),
    "freeWithinKm" DOUBLE PRECISION,
    "chargeBeyondKm" DECIMAL(10,2),
    "unitCharge" DECIMAL(10,2),
    "unitType" "ShippingUnitType",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_shipping_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_shipping_order_value_tiers" (
    "id" TEXT NOT NULL,
    "shippingMethodId" TEXT NOT NULL,
    "minOrderValue" DECIMAL(10,2) NOT NULL,
    "maxOrderValue" DECIMAL(10,2),
    "shippingCharge" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_shipping_order_value_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_shipping_overrides" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "methodType" "ShippingMethodType" NOT NULL,
    "flatCharge" DECIMAL(10,2),
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "freeAboveOrderValue" DECIMAL(10,2),
    "freeWithinKm" DOUBLE PRECISION,
    "chargeBeyondKm" DECIMAL(10,2),
    "unitCharge" DECIMAL(10,2),
    "unitType" "ShippingUnitType",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_shipping_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_shipping_methods_vendorId_key" ON "vendor_shipping_methods"("vendorId");

-- CreateIndex
CREATE INDEX "vendor_shipping_order_value_tiers_shippingMethodId_idx" ON "vendor_shipping_order_value_tiers"("shippingMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "product_shipping_overrides_productId_key" ON "product_shipping_overrides"("productId");

-- AddForeignKey
ALTER TABLE "vendor_shipping_methods" ADD CONSTRAINT "vendor_shipping_methods_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_shipping_order_value_tiers" ADD CONSTRAINT "vendor_shipping_order_value_tiers_shippingMethodId_fkey" FOREIGN KEY ("shippingMethodId") REFERENCES "vendor_shipping_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_shipping_overrides" ADD CONSTRAINT "product_shipping_overrides_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
