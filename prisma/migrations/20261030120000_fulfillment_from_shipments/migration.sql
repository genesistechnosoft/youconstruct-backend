CREATE TYPE "FulfillmentStage" AS ENUM (
  'PREPARING',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'PARTIALLY_DELIVERED',
  'DELIVERED',
  'CANCELLED'
);

ALTER TABLE "orders" ADD COLUMN "fulfillmentStage" "FulfillmentStage";
ALTER TABLE "orders" ADD COLUMN "fulfillmentSummary" TEXT;
ALTER TABLE "sub_orders" ADD COLUMN "fulfillmentStage" "FulfillmentStage";
ALTER TABLE "sub_orders" ADD COLUMN "fulfillmentSummary" TEXT;

CREATE OR REPLACE FUNCTION fulfillment_snapshot(
  ordered integer,
  cancelled integer,
  delivered integer,
  in_transit integer,
  out_for_delivery integer
) RETURNS TABLE(stage "FulfillmentStage", summary text)
LANGUAGE plpgsql
AS $$
DECLARE
  owed integer;
  preparing integer;
  parts text := '';
BEGIN
  owed := GREATEST(0, ordered - cancelled);
  preparing := GREATEST(0, owed - delivered - in_transit);

  IF owed = 0 THEN
    stage := 'CANCELLED';
    IF cancelled = 0 THEN
      summary := 'No items.';
    ELSIF cancelled = 1 THEN
      summary := '1 item cancelled.';
    ELSE
      summary := cancelled || ' items cancelled.';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF delivered >= owed THEN
    stage := 'DELIVERED';
    IF cancelled > 0 THEN
      summary := delivered || ' delivered · ' || cancelled || ' cancelled.';
    ELSIF delivered = 1 THEN
      summary := '1 item delivered.';
    ELSE
      summary := delivered || ' items delivered.';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF delivered > 0 THEN
    stage := 'PARTIALLY_DELIVERED';
    parts := delivered || ' of ' || ordered || ' delivered';
    IF in_transit > 0 THEN
      parts := parts || ' · ' || in_transit || ' on the way';
    END IF;
    IF preparing > 0 THEN
      parts := parts || ' · ' || preparing || ' being prepared';
    END IF;
    IF cancelled > 0 THEN
      parts := parts || ' · ' || cancelled || ' cancelled';
    END IF;
    summary := parts || '.';
    RETURN NEXT;
    RETURN;
  END IF;

  IF out_for_delivery >= owed THEN
    stage := 'OUT_FOR_DELIVERY';
    IF owed = 1 THEN
      summary := '1 item out for delivery.';
    ELSE
      summary := owed || ' items out for delivery.';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF in_transit >= owed THEN
    stage := 'SHIPPED';
    IF owed = 1 THEN
      summary := '1 item on the way.';
    ELSE
      summary := owed || ' items on the way.';
    END IF;
    RETURN NEXT;
    RETURN;
  END IF;

  IF in_transit > 0 THEN
    stage := 'PARTIALLY_SHIPPED';
    parts := in_transit || ' of ' || ordered || ' shipped · ' || preparing || ' being prepared';
    IF cancelled > 0 THEN
      parts := parts || ' · ' || cancelled || ' cancelled';
    END IF;
    summary := parts || '.';
    RETURN NEXT;
    RETURN;
  END IF;

  stage := 'PREPARING';
  IF cancelled > 0 THEN
    IF preparing = 1 THEN
      summary := '1 item being prepared · ' || cancelled || ' cancelled.';
    ELSE
      summary := preparing || ' items being prepared · ' || cancelled || ' cancelled.';
    END IF;
  ELSIF preparing = 1 THEN
    summary := '1 item being prepared.';
  ELSE
    summary := preparing || ' items being prepared.';
  END IF;
  RETURN NEXT;
END;
$$;

UPDATE sub_orders AS target
SET "fulfillmentStage" = fs.stage,
    "fulfillmentSummary" = fs.summary
FROM sub_orders AS source
LEFT JOIN (
  SELECT "subOrderId",
    CAST(SUM(quantity) AS int) AS ordered_qty,
    CAST(SUM("cancelledQuantity") AS int) AS cancelled_qty
  FROM order_items
  GROUP BY "subOrderId"
) iq ON iq."subOrderId" = source.id
LEFT JOIN (
  SELECT d."subOrderId",
    CAST(SUM(di.quantity) FILTER (WHERE d.status = 'DELIVERED') AS int) AS delivered_qty,
    CAST(SUM(di.quantity) FILTER (WHERE d.status IN ('SHIPPED', 'OUT_FOR_DELIVERY')) AS int) AS in_transit_qty,
    CAST(SUM(di.quantity) FILTER (WHERE d.status = 'OUT_FOR_DELIVERY') AS int) AS out_for_delivery_qty
  FROM deliveries d
  JOIN delivery_items di ON di."deliveryId" = d.id
  GROUP BY d."subOrderId"
) dq ON dq."subOrderId" = source.id
CROSS JOIN LATERAL fulfillment_snapshot(
  COALESCE(iq.ordered_qty, 0),
  COALESCE(iq.cancelled_qty, 0),
  COALESCE(dq.delivered_qty, 0),
  COALESCE(dq.in_transit_qty, 0),
  COALESCE(dq.out_for_delivery_qty, 0)
) AS fs
WHERE target.id = source.id;

UPDATE orders AS target
SET "fulfillmentStage" = fs.stage,
    "fulfillmentSummary" = fs.summary
FROM orders AS source
LEFT JOIN (
  SELECT so."orderId",
    CAST(SUM(oi.quantity) AS int) AS ordered_qty,
    CAST(SUM(oi."cancelledQuantity") AS int) AS cancelled_qty
  FROM sub_orders so
  JOIN order_items oi ON oi."subOrderId" = so.id
  GROUP BY so."orderId"
) iq ON iq."orderId" = source.id
LEFT JOIN (
  SELECT so."orderId",
    CAST(SUM(di.quantity) FILTER (WHERE d.status = 'DELIVERED') AS int) AS delivered_qty,
    CAST(SUM(di.quantity) FILTER (WHERE d.status IN ('SHIPPED', 'OUT_FOR_DELIVERY')) AS int) AS in_transit_qty,
    CAST(SUM(di.quantity) FILTER (WHERE d.status = 'OUT_FOR_DELIVERY') AS int) AS out_for_delivery_qty
  FROM sub_orders so
  JOIN deliveries d ON d."subOrderId" = so.id
  JOIN delivery_items di ON di."deliveryId" = d.id
  GROUP BY so."orderId"
) dq ON dq."orderId" = source.id
CROSS JOIN LATERAL fulfillment_snapshot(
  COALESCE(iq.ordered_qty, 0),
  COALESCE(iq.cancelled_qty, 0),
  COALESCE(dq.delivered_qty, 0),
  COALESCE(dq.in_transit_qty, 0),
  COALESCE(dq.out_for_delivery_qty, 0)
) AS fs
WHERE target.id = source.id;

DROP FUNCTION fulfillment_snapshot(
  integer, integer, integer, integer, integer
);

UPDATE "orders"
SET "fulfillmentStage" = 'PREPARING',
    "fulfillmentSummary" = '0 items being prepared.'
WHERE "fulfillmentStage" IS NULL OR "fulfillmentSummary" IS NULL;

UPDATE "sub_orders"
SET "fulfillmentStage" = 'PREPARING',
    "fulfillmentSummary" = '0 items being prepared.'
WHERE "fulfillmentStage" IS NULL OR "fulfillmentSummary" IS NULL;

ALTER TABLE "orders" ALTER COLUMN "fulfillmentStage" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "fulfillmentSummary" SET NOT NULL;
ALTER TABLE "orders" ALTER COLUMN "fulfillmentStage" SET DEFAULT 'PREPARING';
ALTER TABLE "orders" ALTER COLUMN "fulfillmentSummary" SET DEFAULT '0 items being prepared.';
ALTER TABLE "sub_orders" ALTER COLUMN "fulfillmentStage" SET NOT NULL;
ALTER TABLE "sub_orders" ALTER COLUMN "fulfillmentSummary" SET NOT NULL;
ALTER TABLE "sub_orders" ALTER COLUMN "fulfillmentStage" SET DEFAULT 'PREPARING';
ALTER TABLE "sub_orders" ALTER COLUMN "fulfillmentSummary" SET DEFAULT '0 items being prepared.';

DROP INDEX "orders_status_paymentStatus_idx";
ALTER TABLE "orders" DROP COLUMN "status";
DROP TYPE "OrderStatus";

CREATE INDEX "orders_fulfillmentStage_paymentStatus_idx"
  ON "orders"("fulfillmentStage", "paymentStatus");

UPDATE "order_status_history"
SET status = 'PROCESSING'
WHERE status::text IN ('SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED');

UPDATE "sub_orders"
SET status = 'PROCESSING'
WHERE status::text IN ('SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED');

CREATE TYPE "SubOrderStatus_new" AS ENUM (
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'CANCELLED',
  'REFUNDED'
);

ALTER TABLE "sub_orders"
  ALTER COLUMN status TYPE "SubOrderStatus_new"
  USING status::text::"SubOrderStatus_new";

ALTER TABLE "order_status_history"
  ALTER COLUMN status TYPE "SubOrderStatus_new"
  USING status::text::"SubOrderStatus_new";

DROP TYPE "SubOrderStatus";
ALTER TYPE "SubOrderStatus_new" RENAME TO "SubOrderStatus";

DROP TABLE "shipments";
DROP TYPE "ShipmentStatus";
