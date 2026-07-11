import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

const units = [
  { code: 'PCS', symbol: 'Pcs', name: 'Piece', type: 'COUNT' },
  { code: 'BOX', symbol: 'Box', name: 'Box', type: 'COUNT' },
  { code: 'ROLL', symbol: 'Roll', name: 'Roll', type: 'COUNT' },
  { code: 'BUNDLE', symbol: 'Bundle', name: 'Bundle', type: 'COUNT' },
  { code: 'KG', symbol: 'Kg', name: 'Kilogram', type: 'WEIGHT' },
  { code: 'GRAM', symbol: 'g', name: 'Gram', type: 'WEIGHT' },
  { code: 'LITER', symbol: 'L', name: 'Litre', type: 'VOLUME' },
  { code: 'SQFT', symbol: 'Sq. Ft.', name: 'Square Feet', type: 'AREA' },
  { code: 'SQMT', symbol: 'Sq. Mt.', name: 'Square Meter', type: 'AREA' },
  { code: 'METER', symbol: 'Mtr', name: 'Meter', type: 'LENGTH' },
] as const;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  for (const unit of units) {
    await prisma.unit.upsert({
      where: { code: unit.code },
      update: {
        symbol: unit.symbol,
        name: unit.name,
        type: unit.type,
      },
      create: unit,
    });
  }

  console.log(`Seeded ${units.length} units`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
