import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShippingMethodType,
  ShippingUnitType,
} from '../../../generated/prisma/client.js';
import { haversineKm } from '../../common/utils/haversine.util';
import { OrdersRepository } from './orders.repository';

export type ShippingChargeRule = {
  methodType: ShippingMethodType;
  flatCharge: Prisma.Decimal | null;
  isFree: boolean;
  freeAboveOrderValue: Prisma.Decimal | null;
  freeWithinKm: number | null;
  chargeBeyondKm: Prisma.Decimal | null;
  unitCharge: Prisma.Decimal | null;
  unitType: ShippingUnitType | null;
  orderValueTiers?: Array<{
    minOrderValue: Prisma.Decimal;
    maxOrderValue: Prisma.Decimal | null;
    shippingCharge: Prisma.Decimal;
  }>;
};

export type ShippingQuoteLineInput = {
  variantId: string;
  productId: string;
  vendorId: string;
  quantity: number;
  sellingPrice: Prisma.Decimal;
  weightKg: number | null;
  coverageArea: number | null;
  shippingOverride: ShippingChargeRule | null;
};

export type VendorGeo = {
  latitude: number | null;
  longitude: number | null;
};

export type VendorShippingQuoteInput = {
  vendorId: string;
  vendorName: string;
  geo: VendorGeo;
  shippingMethod: ShippingChargeRule | null;
  lines: ShippingQuoteLineInput[];
};

export type AddressGeo = {
  latitude: number | null;
  longitude: number | null;
};

export type VendorShippingBreakdown = {
  vendorId: string;
  vendorName: string;
  merchandiseSubtotal: string;
  shippingCharge: string;
  methodType: ShippingMethodType | null;
  distanceKm: number | null;
  lineCharges: Array<{
    variantId: string;
    productId: string;
    shippingCharge: string;
    usedOverride: boolean;
  }>;
};

export type ShippingQuoteResult = {
  vendors: VendorShippingBreakdown[];
  shippingTotal: string;
};

@Injectable()
export class ShippingQuoteService {
  constructor(private readonly ordersRepository: OrdersRepository) {}

  async quoteForCart(
    userId: string,
    addressId: string,
  ): Promise<ShippingQuoteResult> {
    const address = await this.ordersRepository.findAddressForUser(
      userId,
      addressId,
    );
    if (!address) {
      throw new NotFoundException('Address not found');
    }

    const cart = await this.ordersRepository.findCartWithShippingData(userId);
    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    const byVendor = new Map<string, VendorShippingQuoteInput>();

    for (const item of cart.items) {
      const variant = item.variant;
      const product = variant.product;
      const vendor = product.vendor;
      const override = product.shippingOverride;

      let group = byVendor.get(vendor.id);
      if (!group) {
        group = {
          vendorId: vendor.id,
          vendorName: vendor.businessName,
          geo: {
            latitude: vendor.latitude,
            longitude: vendor.longitude,
          },
          shippingMethod: vendor.shippingMethod?.isActive
            ? {
                methodType: vendor.shippingMethod.methodType,
                flatCharge: vendor.shippingMethod.flatCharge,
                isFree: vendor.shippingMethod.isFree,
                freeAboveOrderValue: vendor.shippingMethod.freeAboveOrderValue,
                freeWithinKm: vendor.shippingMethod.freeWithinKm,
                chargeBeyondKm: vendor.shippingMethod.chargeBeyondKm,
                unitCharge: vendor.shippingMethod.unitCharge,
                unitType: vendor.shippingMethod.unitType,
                orderValueTiers: vendor.shippingMethod.orderValueTiers,
              }
            : null,
          lines: [],
        };
        byVendor.set(vendor.id, group);
      }

      group.lines.push({
        variantId: variant.id,
        productId: product.id,
        vendorId: vendor.id,
        quantity: item.quantity,
        sellingPrice: variant.sellingPrice,
        weightKg: variant.weightKg,
        coverageArea: variant.coverageArea,
        shippingOverride: override
          ? {
              methodType: override.methodType,
              flatCharge: override.flatCharge,
              isFree: override.isFree,
              freeAboveOrderValue: override.freeAboveOrderValue,
              freeWithinKm: override.freeWithinKm,
              chargeBeyondKm: override.chargeBeyondKm,
              unitCharge: override.unitCharge,
              unitType: override.unitType,
            }
          : null,
      });
    }

    return this.computeQuote([...byVendor.values()], {
      latitude: address.latitude,
      longitude: address.longitude,
    });
  }

  computeQuote(
    vendors: VendorShippingQuoteInput[],
    address: AddressGeo,
  ): ShippingQuoteResult {
    const breakdowns: VendorShippingBreakdown[] = [];
    let shippingTotal = new Prisma.Decimal(0);

    for (const vendor of vendors) {
      const breakdown = this.computeVendorShipping(vendor, address);
      breakdowns.push(breakdown);
      shippingTotal = shippingTotal.add(breakdown.shippingCharge);
    }

    return {
      vendors: breakdowns,
      shippingTotal: shippingTotal.toFixed(2),
    };
  }

  computeVendorShipping(
    vendor: VendorShippingQuoteInput,
    address: AddressGeo,
  ): VendorShippingBreakdown {
    const lineCharges: VendorShippingBreakdown['lineCharges'] = [];
    let merchandiseSubtotal = new Prisma.Decimal(0);
    let vendorMethodSubtotal = new Prisma.Decimal(0);
    const vendorMethodLines: ShippingQuoteLineInput[] = [];
    let shippingCharge = new Prisma.Decimal(0);
    let distanceKm: number | null = null;
    let methodType: ShippingMethodType | null =
      vendor.shippingMethod?.methodType ?? null;

    for (const line of vendor.lines) {
      const lineSubtotal = line.sellingPrice.mul(line.quantity);
      merchandiseSubtotal = merchandiseSubtotal.add(lineSubtotal);

      if (line.shippingOverride) {
        const charge = this.computeRuleCharge(line.shippingOverride, {
          merchandiseSubtotal: lineSubtotal,
          lines: [line],
          vendorGeo: vendor.geo,
          address,
        });
        if (charge.distanceKm !== null) {
          distanceKm = charge.distanceKm;
        }
        shippingCharge = shippingCharge.add(charge.amount);
        lineCharges.push({
          variantId: line.variantId,
          productId: line.productId,
          shippingCharge: charge.amount.toFixed(2),
          usedOverride: true,
        });
      } else {
        vendorMethodSubtotal = vendorMethodSubtotal.add(lineSubtotal);
        vendorMethodLines.push(line);
        lineCharges.push({
          variantId: line.variantId,
          productId: line.productId,
          shippingCharge: '0.00',
          usedOverride: false,
        });
      }
    }

    if (vendorMethodLines.length > 0) {
      if (!vendor.shippingMethod || !vendor.shippingMethod) {
        throw new BadRequestException(
          `Vendor ${vendor.vendorName} has no active shipping method`,
        );
      }

      const methodCharge = this.computeRuleCharge(vendor.shippingMethod, {
        merchandiseSubtotal: vendorMethodSubtotal,
        lines: vendorMethodLines,
        vendorGeo: vendor.geo,
        address,
      });
      if (methodCharge.distanceKm !== null) {
        distanceKm = methodCharge.distanceKm;
      }
      methodType = vendor.shippingMethod.methodType;
      shippingCharge = shippingCharge.add(methodCharge.amount);

      // Allocate vendor-method shipping across non-override lines by qty share
      this.allocateLineCharges(
        lineCharges,
        vendorMethodLines,
        methodCharge.amount,
      );
    }

    return {
      vendorId: vendor.vendorId,
      vendorName: vendor.vendorName,
      merchandiseSubtotal: merchandiseSubtotal.toFixed(2),
      shippingCharge: shippingCharge.toFixed(2),
      methodType,
      distanceKm,
      lineCharges,
    };
  }

  private allocateLineCharges(
    lineCharges: VendorShippingBreakdown['lineCharges'],
    vendorMethodLines: ShippingQuoteLineInput[],
    total: Prisma.Decimal,
  ) {
    const totalQty = vendorMethodLines.reduce((sum, l) => sum + l.quantity, 0);
    if (totalQty <= 0 || total.isZero()) {
      return;
    }

    let allocated = new Prisma.Decimal(0);
    vendorMethodLines.forEach((line, index) => {
      const isLast = index === vendorMethodLines.length - 1;
      const share = isLast
        ? total.sub(allocated)
        : total.mul(line.quantity).div(totalQty).toDecimalPlaces(2);
      allocated = allocated.add(share);
      const entry = lineCharges.find((c) => c.variantId === line.variantId);
      if (entry) {
        entry.shippingCharge = share.toFixed(2);
      }
    });
  }

  private computeRuleCharge(
    rule: ShippingChargeRule,
    ctx: {
      merchandiseSubtotal: Prisma.Decimal;
      lines: ShippingQuoteLineInput[];
      vendorGeo: VendorGeo;
      address: AddressGeo;
    },
  ): { amount: Prisma.Decimal; distanceKm: number | null } {
    if (
      rule.freeAboveOrderValue &&
      ctx.merchandiseSubtotal.greaterThanOrEqualTo(rule.freeAboveOrderValue)
    ) {
      if (
        rule.methodType === ShippingMethodType.FLAT ||
        rule.methodType === ShippingMethodType.FREE ||
        rule.isFree
      ) {
        return { amount: new Prisma.Decimal(0), distanceKm: null };
      }
    }

    if (rule.isFree || rule.methodType === ShippingMethodType.FREE) {
      return { amount: new Prisma.Decimal(0), distanceKm: null };
    }

    switch (rule.methodType) {
      case ShippingMethodType.FLAT:
        return {
          amount: rule.flatCharge ?? new Prisma.Decimal(0),
          distanceKm: null,
        };

      case ShippingMethodType.DISTANCE_BASED: {
        if (
          ctx.vendorGeo.latitude == null ||
          ctx.vendorGeo.longitude == null ||
          ctx.address.latitude == null ||
          ctx.address.longitude == null
        ) {
          throw new BadRequestException(
            'Latitude and longitude are required for distance-based shipping',
          );
        }
        const distanceKm = haversineKm(
          ctx.vendorGeo.latitude,
          ctx.vendorGeo.longitude,
          ctx.address.latitude,
          ctx.address.longitude,
        );
        if (rule.freeWithinKm != null && distanceKm <= rule.freeWithinKm) {
          return { amount: new Prisma.Decimal(0), distanceKm };
        }
        return {
          amount: rule.chargeBeyondKm ?? new Prisma.Decimal(0),
          distanceKm,
        };
      }

      case ShippingMethodType.UNIT_BASED: {
        const units = this.sumShippingUnits(ctx.lines, rule.unitType);
        const charge = (rule.unitCharge ?? new Prisma.Decimal(0)).mul(units);
        return {
          amount: charge.toDecimalPlaces(2),
          distanceKm: null,
        };
      }

      case ShippingMethodType.ORDER_VALUE_BASED: {
        const tiers = rule.orderValueTiers ?? [];
        const matched = tiers.find((tier) => {
          const aboveMin = ctx.merchandiseSubtotal.greaterThanOrEqualTo(
            tier.minOrderValue,
          );
          const belowMax =
            tier.maxOrderValue == null ||
            ctx.merchandiseSubtotal.lessThanOrEqualTo(tier.maxOrderValue);
          return aboveMin && belowMax;
        });
        if (!matched) {
          throw new BadRequestException(
            'No shipping tier matches the order value',
          );
        }
        return { amount: matched.shippingCharge, distanceKm: null };
      }

      default:
        return { amount: new Prisma.Decimal(0), distanceKm: null };
    }
  }

  private sumShippingUnits(
    lines: ShippingQuoteLineInput[],
    unitType: ShippingUnitType | null,
  ): Prisma.Decimal {
    if (unitType === ShippingUnitType.KG) {
      return lines.reduce((sum, line) => {
        const weight = line.weightKg ?? 0;
        return sum.add(new Prisma.Decimal(weight).mul(line.quantity));
      }, new Prisma.Decimal(0));
    }

    if (unitType === ShippingUnitType.CBM) {
      return lines.reduce((sum, line) => {
        if (line.coverageArea != null) {
          return sum.add(
            new Prisma.Decimal(line.coverageArea).mul(line.quantity),
          );
        }
        return sum.add(line.quantity);
      }, new Prisma.Decimal(0));
    }

    // UNIT (default): sum quantity
    return lines.reduce(
      (sum, line) => sum.add(line.quantity),
      new Prisma.Decimal(0),
    );
  }
}
