import { DimItem, DimPlug } from 'app/inventory/item-types';
import { PlugCategoryHashes } from 'data/d2/generated-enums';
import { WishListRoll } from './types';
import { getInventoryWishListRoll } from './wishlists';

describe('getInventoryWishListRoll', () => {
  const barrelHash = 1;
  const magHash = 2;
  const trait1Hash = 3;
  const trait2Hash = 4;

  const mockPlug = (hash: number, pch: number): DimPlug =>
    ({
      plugDef: {
        hash,
        plug: {
          plugCategoryHash: pch,
        },
      },
    }) as unknown as DimPlug;

  const mockItem = (
    pluggedHashes: { hash: number; pch: number }[],
    possibleHashes: { hash: number; pch: number }[],
  ): DimItem => {
    const sockets = {
      allSockets: pluggedHashes.map((p, i) => {
        const plug = mockPlug(p.hash, p.pch);
        return {
          socketIndex: i,
          plugged: plug,
          plugOptions: [plug],
          plugSet: {
            plugs: possibleHashes.map((ph) => mockPlug(ph.hash, ph.pch)),
          },
        };
      }),
      categories: [],
    };
    return {
      hash: 100,
      itemCategoryHashes: [],
      sockets,
    } as unknown as DimItem;
  };

  const wishListRoll: WishListRoll = {
    itemHash: 100,
    recommendedPerks: new Set([barrelHash, magHash, trait1Hash, trait2Hash]),
    isExpertMode: true,
  };

  const wishListRolls = new Map<number, WishListRoll[]>([[100, [wishListRoll]]]);

  it('matches when all perks are present', () => {
    const item = mockItem(
      [
        { hash: barrelHash, pch: PlugCategoryHashes.Barrels },
        { hash: magHash, pch: PlugCategoryHashes.Magazines },
        { hash: trait1Hash, pch: PlugCategoryHashes.Frames },
        { hash: trait2Hash, pch: PlugCategoryHashes.Frames },
      ],
      [],
    );
    expect(getInventoryWishListRoll(item, wishListRolls)).toBeDefined();
  });

  it('matches when optional perks (barrel/mag) are missing but traits are present', () => {
    const item = mockItem(
      [
        { hash: 999, pch: PlugCategoryHashes.Barrels },
        { hash: 888, pch: PlugCategoryHashes.Magazines },
        { hash: trait1Hash, pch: PlugCategoryHashes.Frames },
        { hash: trait2Hash, pch: PlugCategoryHashes.Frames },
      ],
      [
        { hash: barrelHash, pch: PlugCategoryHashes.Barrels },
        { hash: magHash, pch: PlugCategoryHashes.Magazines },
      ],
    );
    expect(getInventoryWishListRoll(item, wishListRolls)).toBeDefined();
  });

  it('does NOT match when a trait is missing', () => {
    const item = mockItem(
      [
        { hash: barrelHash, pch: PlugCategoryHashes.Barrels },
        { hash: magHash, pch: PlugCategoryHashes.Magazines },
        { hash: 777, pch: PlugCategoryHashes.Frames },
        { hash: trait2Hash, pch: PlugCategoryHashes.Frames },
      ],
      [{ hash: trait1Hash, pch: PlugCategoryHashes.Frames }],
    );
    expect(getInventoryWishListRoll(item, wishListRolls)).toBeUndefined();
  });

  it('does NOT match when only optional perks were specified and they are missing', () => {
    const optionalOnlyRoll: WishListRoll = {
      itemHash: 100,
      recommendedPerks: new Set([barrelHash, magHash]),
      isExpertMode: true,
    };
    const optionalOnlyRolls = new Map<number, WishListRoll[]>([[100, [optionalOnlyRoll]]]);

    const item = mockItem(
      [
        { hash: 999, pch: PlugCategoryHashes.Barrels },
        { hash: 888, pch: PlugCategoryHashes.Magazines },
      ],
      [
        { hash: barrelHash, pch: PlugCategoryHashes.Barrels },
        { hash: magHash, pch: PlugCategoryHashes.Magazines },
      ],
    );
    expect(getInventoryWishListRoll(item, optionalOnlyRolls)).toBeUndefined();
  });

  it('aggregates multiple matching rolls', () => {
    const roll1: WishListRoll = {
      itemHash: 100,
      recommendedPerks: new Set([trait1Hash]),
      notes: 'Notes 1',
      isExpertMode: true,
    };
    const roll2: WishListRoll = {
      itemHash: 100,
      recommendedPerks: new Set([trait2Hash]),
      notes: 'Notes 2',
      isExpertMode: true,
    };
    const multipleRolls = new Map<number, WishListRoll[]>([[100, [roll1, roll2]]]);

    const item = mockItem(
      [
        { hash: trait1Hash, pch: PlugCategoryHashes.Frames },
        { hash: trait2Hash, pch: PlugCategoryHashes.Frames },
      ],
      [],
    );

    const result = getInventoryWishListRoll(item, multipleRolls);
    expect(result).toBeDefined();
    expect(result?.wishListPerks.has(trait1Hash)).toBe(true);
    expect(result?.wishListPerks.has(trait2Hash)).toBe(true);
    expect(result?.notes).toBe('Notes 1\n\n---\n\nNotes 2');
    expect(result?.matchingRolls).toHaveLength(2);
  });

  it('matches when the wishlist only needs a trait and the item has a different currently plugged perk', () => {
    const traitOnlyRoll: WishListRoll = {
      itemHash: 100,
      recommendedPerks: new Set([trait1Hash]),
      isExpertMode: true,
    };
    const multipleRolls = new Map<number, WishListRoll[]>([[100, [traitOnlyRoll]]]);

    const item = mockItem(
      [{ hash: 999, pch: PlugCategoryHashes.Frames }],
      [{ hash: trait1Hash, pch: PlugCategoryHashes.Frames }],
    );

    expect(getInventoryWishListRoll(item, multipleRolls)).toBeDefined();
  });
});
