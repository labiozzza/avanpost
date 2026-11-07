import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PeaceLiteItemCatalogSchema, PeaceLiteItemIdSchema } from '@avanpost/peace-v2-shared';

describe('Peace Lite item catalog', () => {
  it('loads exactly seven versioned item definitions with a matching content hash', async () => {
    const catalog = JSON.parse(await readFile(resolve(process.cwd(), 'content/peace-lite-v1/items.json'), 'utf8')) as unknown;
    const parsed = PeaceLiteItemCatalogSchema.parse(catalog);
    const actualHash = createHash('sha256').update(JSON.stringify(parsed.items)).digest('hex');

    expect(actualHash).toBe(parsed.contentHash);
    expect(parsed.items.map((item) => item.id).sort()).toEqual([...PeaceLiteItemIdSchema.options].sort());
  });
});
