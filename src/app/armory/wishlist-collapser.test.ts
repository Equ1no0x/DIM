import { TierType } from 'bungie-api-ts/destiny2';
import { consolidateRollsForOneWeapon, consolidateSecondaryPerks } from './wishlist-collapser';

describe('perkConsolidator', () => {
  const makeDefs = (traitHashes: number[]) =>
    ({
      InventoryItem: {
        get: (h: number) =>
          traitHashes.includes(h)
            ? { inventory: { tierType: TierType.Common }, itemCategoryHashes: [] }
            : undefined,
      },
    }) as any;

  it('does its thing', () => {
    expect(
      consolidateSecondaryPerks([
        {
          primaryPerksList: [],
          primarySocketIndices: [],
          primaryPerkIdentifier: '',
          primaryPerkIdentifierNormalized: '',
          secondaryPerksMap: { 1: 4134353779, 2: 1482024992 },
          secondarySocketIndices: [1, 2],
        },

        {
          primaryPerksList: [],
          primarySocketIndices: [],
          primaryPerkIdentifier: '',
          primaryPerkIdentifierNormalized: '',
          secondaryPerksMap: { 1: 4134353779, 2: 1467527085 },
          secondarySocketIndices: [1, 2],
        },

        {
          primaryPerksList: [],
          primarySocketIndices: [],
          primaryPerkIdentifier: '',
          primaryPerkIdentifierNormalized: '',
          secondaryPerksMap: { 1: 106909392, 2: 1332244541 },
          secondarySocketIndices: [1, 2],
        },

        {
          primaryPerksList: [],
          primarySocketIndices: [],
          primaryPerkIdentifier: '',
          primaryPerkIdentifierNormalized: '',
          secondaryPerksMap: { 1: 106909392, 2: 1467527085 },
          secondarySocketIndices: [1, 2],
        },
      ]),
    ).toMatchInlineSnapshot(`
      [
        [
          [
            4134353779,
          ],
          [
            1482024992,
          ],
        ],
        [
          [
            106909392,
          ],
          [
            1332244541,
          ],
        ],
        [
          [
            106909392,
            4134353779,
          ],
          [
            1467527085,
          ],
        ],
      ]
    `);
  });

  it('groups rolls with the same perk into one group under that primary perk', () => {
    const defs = makeDefs([1000]);
    const stubItem: any = {
      sockets: {
        allSockets: [
          { isReusable: true, socketIndex: 1, plugOptions: [{ plugDef: { hash: 1000 } }] },
        ],
      },
    };
    const rolls: any[] = [{ recommendedPerks: [1000] }, { recommendedPerks: [1000] }];

    const result = consolidateRollsForOneWeapon(defs, stubItem, rolls);
    // Both rolls share socket 1 perk 1000 (primary), so one group with primary = [1000]
    expect(result).toHaveLength(1);
    expect(result[0].commonPrimaryPerks).toEqual([1000]);
    expect(result[0].rolls).toHaveLength(2);
  });

  it('does not collide on unmatched wishlist perks (regression: undefined-key collision)', () => {
    // Stub DimItem whose only available perk hashes are 10 and 20, mapped to socket indices 1 and 2.
    // 10 is a primary perk (trait), so should go to primaryPerksList
    const defs = makeDefs([10]);
    const stubItem: any = {
      sockets: {
        allSockets: [
          { isReusable: true, socketIndex: 0, plugOptions: [] },
          { isReusable: true, socketIndex: 1, plugOptions: [{ plugDef: { hash: 10 } }] },
          { isReusable: true, socketIndex: 2, plugOptions: [{ plugDef: { hash: 20 } }] },
        ],
      },
    };

    // Single roll with two unmatched wishlist perk hashes (8888, 9999) plus one matched (10 = primary, 20 = secondary).
    const rolls: any[] = [{ recommendedPerks: new Set([10, 8888, 9999, 20]) }];

    const result = consolidateRollsForOneWeapon(defs, stubItem, rolls);
    const roll = result[0].rolls[0];

    // Primary perk 10 goes to primaryPerksList
    expect(roll.primaryPerksList).toContain(10);

    // Secondary perks: 20 matched to socket 2, 8888 and 9999 unmatched (sentinels)
    const map = roll.secondaryPerksMap;
    expect(map[2]).toBe(20);
    expect(map[-8888]).toBe(8888);
    expect(map[-9999]).toBe(9999);
    expect((map as Record<string, number | undefined>)['undefined']).toBeUndefined();
  });

  it('does not merge rolls with disjoint/sparse perk specs (regression: empty-column false-match)', () => {
    // Item with 4 socket columns: indices 0, 1, 2, 3. None are traits (all secondary).
    const defs = makeDefs([]);
    const stubItem: any = {
      sockets: {
        allSockets: [
          { isReusable: true, socketIndex: 0, plugOptions: [{ plugDef: { hash: 100 } }] },
          { isReusable: true, socketIndex: 1, plugOptions: [{ plugDef: { hash: 200 } }] },
          { isReusable: true, socketIndex: 2, plugOptions: [{ plugDef: { hash: 300 } }] },
          { isReusable: true, socketIndex: 3, plugOptions: [{ plugDef: { hash: 400 } }] },
        ],
      },
    };

    // Three rolls, each specifying only 2 of the 4 available socket columns:
    // All perks are secondary (not traits)
    const rolls: any[] = [
      { recommendedPerks: [100, 200] },
      { recommendedPerks: [300, 400] },
      { recommendedPerks: [100, 300] },
    ];

    const result = consolidateRollsForOneWeapon(defs, stubItem, rolls);
    const consolidated = consolidateSecondaryPerks(result[0].rolls);

    // With no primary perks, rolls group together and consolidateSecondaryPerks handles them
    // No columns match across these two rolls
    // → 2+ bundles, not merged. consolidated.length > 1.
    expect(consolidated.length).toBeGreaterThan(1);

    // Sanity check: each bundle should contain realistic perk groups
    const flatPerks = consolidated.flatMap((bundle) => bundle.flatMap((col) => col)).sort();
    expect(new Set(flatPerks).size).toBeLessThanOrEqual(6);
  });
});
