/**
 * Simple, dependency-free CSV parser that handles quoted fields (RFC 4180 subset).
 * Returns an array of records as string-keyed objects based on the header row.
 */
export function parseCsv(content: string): Record<string, string>[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length < 2) return [];

  const headers = parseCsvLine(nonEmptyLines[0]);
  const records: Record<string, string>[] = [];

  for (let i = 1; i < nonEmptyLines.length; i++) {
    const values = parseCsvLine(nonEmptyLines[i]);
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? '';
    }
    records.push(record);
  }

  return records;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;

  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = '';
      while (i < line.length) {
        if (line[i] === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          field += line[i];
          i++;
        }
      }
      fields.push(field);
      if (i < line.length && line[i] === ',') i++;
    } else {
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i).trim());
        break;
      } else {
        fields.push(line.slice(i, end).trim());
        i = end + 1;
      }
    }
  }

  if (line.endsWith(',')) fields.push('');

  return fields;
}

export type CsvProductRow = {
  name: string;
  categoryId: string;
  brandId: string;
  description: string;
  shortDescription: string;
  sku: string;
  price: string;
  sellingPrice: string;
  costPrice: string;
  primaryUnitCode: string;
  quantity: string;
  tags: string;
  metaTitle: string;
  metaDescription: string;
};

export const CSV_COLUMNS = [
  'name',
  'categoryId',
  'brandId',
  'description',
  'shortDescription',
  'sku',
  'price',
  'sellingPrice',
  'costPrice',
  'primaryUnitCode',
  'quantity',
  'tags',
  'metaTitle',
  'metaDescription',
] as const;
