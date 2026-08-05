import { D2ManifestDefinitions } from 'app/destiny2/d2-definitions';
import { DimItem } from 'app/inventory/item-types';
import { enhancedVersion, unenhancedVersion } from 'app/utils/perk-utils';
import { WishListRoll } from 'app/wishlists/types';
import { DestinyInventoryItemDefinition, TierType } from 'bungie-api-ts/destiny2';
import { ItemCategoryHashes } from 'data/d2/generated-enums';
import { partition } from 'es-toolkit';

interface Roll {
  /** primary perks (traits, intrinsics) grouped by perk hash */
  primaryPerksList: number[];
  /** socket indices for primary perks, in order */
  primarySocketIndices: number[];
  /** identifier for primary perks (used for grouping) */
  primaryPerkIdentifier: string;
  /** normalized identifier for primary perks */
  primaryPerkIdentifierNormalized: string;
  /** barrels, magazines, etc. object keyed by socket index */
  secondaryPerksMap: Record<number, number>;
  /** fast access to secondaryPerks keys */
  secondarySocketIndices: number[];
}

function isMajorPerk(item?: DestinyInventoryItemDefinition) {
  return Boolean(
    item &&
    (item.inventory!.tierType === TierType.Common ||
      item.itemCategoryHashes?.includes(ItemCategoryHashes.WeaponModsFrame) ||
      item.itemCategoryHashes?.includes(ItemCategoryHashes.WeaponModsIntrinsic)),
  );
}

export function consolidateRollsForOneWeapon(
  defs: D2ManifestDefinitions,
  item: DimItem,
  rolls: WishListRoll[],
) {
  const socketIndexByPerkHash: Record<number, number> = {};
  if (item.sockets) {
    for (const s of item.sockets.allSockets) {
      if (s.isReusable) {
        for (const p of s.plugOptions) {
          socketIndexByPerkHash[p.plugDef.hash] = s.socketIndex;
        }
      }
    }
  }

  if (!rolls?.length) {
    return [{ commonPrimaryPerks: [] as number[], rolls: [] as Roll[] }];
  }

  const allRolls: Roll[] = rolls.map((roll) => {
    const recommendedPerks = new Set(roll.recommendedPerks);

    // Because a base perk in the wish list matches an enhanced perk on the weapon,
    // add enhanced perks to the wish list rolls if the weapon can have them
    for (const perk of roll.recommendedPerks) {
      const enhancedPerk = enhancedVersion(perk);
      if (enhancedPerk && !recommendedPerks.has(enhancedPerk)) {
        const socketIndex = socketIndexByPerkHash[perk];
        if (
          socketIndex !== undefined &&
          item.sockets?.allSockets.some(
            (s) =>
              s.socketIndex === socketIndex &&
              s.plugOptions.some((p) => p.plugDef.hash === enhancedPerk),
          )
        ) {
          recommendedPerks.add(enhancedPerk);
        }
      }
    }

    // Partition into primary (traits/intrinsics) and secondary (barrels/mags)
    const [primaryPerksList, secondaryPerksList] = partition(Array.from(recommendedPerks), (h) =>
      isMajorPerk(defs.InventoryItem.get(h)),
    );

    // Build primary perk identifier and socket indices
    const primarySocketIndices = primaryPerksList
      .map((h) => socketIndexByPerkHash[h])
      .filter((i) => i !== undefined) as number[];
    const primaryPerkIdentifier = primarySocketIndices
      .map((i) => i)
      .sort()
      .join(',');
    const primaryPerkIdentifierNormalized = primaryPerksList
      .map((h) => {
        const enhanced = enhancedVersion(h);
        const base = unenhancedVersion(h);
        return enhanced ? `${base ?? h}/${enhanced}` : h;
      })
      .sort()
      .join(',');

    // Handle enhanced version augmentation for primary perks
    const augmentedPrimaryPerks = [...primaryPerksList];
    if (primaryPerksList.length === 1) {
      const perk = primaryPerksList[0];
      const enhanced = enhancedVersion(perk);
      if (enhanced && !augmentedPrimaryPerks.includes(enhanced)) {
        const socketIndex = socketIndexByPerkHash[perk];
        if (
          socketIndex !== undefined &&
          item.sockets?.allSockets.some(
            (s) =>
              s.socketIndex === socketIndex &&
              s.plugOptions.some((p) => p.plugDef.hash === enhanced),
          )
        ) {
          augmentedPrimaryPerks.push(enhanced);
        }
      }
    }

    // Build secondary perks map
    const secondaryPerksMap: Record<number, number> = {};
    for (const h of secondaryPerksList) {
      const socketIndex = socketIndexByPerkHash[h] ?? -h;
      secondaryPerksMap[socketIndex] = h;
    }

    // Build secondary socket indices with proper sorting
    const secondaryPerksSorted = [...secondaryPerksList];
    secondaryPerksSorted.sort((a, b) => {
      const ai = socketIndexByPerkHash[a];
      const bi = socketIndexByPerkHash[b];
      if (ai === undefined && bi === undefined) return 0;
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });
    const secondarySocketIndices = secondaryPerksSorted.map((h) => socketIndexByPerkHash[h] ?? -h);

    return {
      primaryPerksList: augmentedPrimaryPerks,
      primarySocketIndices,
      primaryPerkIdentifier,
      primaryPerkIdentifierNormalized,
      secondaryPerksMap,
      secondarySocketIndices,
    };
  });

  // Group rolls by their primary perk identifier (normalized + socket indices).
  // Rolls with no primary perks are grouped together.
  const groups = new Map<string, Roll[]>();

  for (const roll of allRolls) {
    const key =
      `${roll.primaryPerkIdentifier}:${roll.primaryPerkIdentifierNormalized}` || '__no_primary__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(roll);
  }

  // Convert groups to result format
  const result: Array<{ commonPrimaryPerks: number[]; rolls: Roll[] }> = [];
  for (const [_key, groupRolls] of groups) {
    // All rolls in the same group share the same primary perks
    const commonPrimaryPerks = groupRolls[0].primaryPerksList;
    result.push({ commonPrimaryPerks, rolls: groupRolls });
  }
  return result;
}

// input
// [
//   [drop mag, smallbore],
//   [drop mag, extended barrel],
//   [tac mag, rifled barrel],
//   [tac mag, extended barrel]
// ]
// return
// [
//   [[drop mag], [smallbore, extended barrel]],
//   [[tac mag], [rifled barrel, extended barrel]]
// ]
export function consolidateSecondaryPerks(initialRolls: Roll[]) {
  // these are legit socketIndices according the item def. this might be like, [3, 4]
  const allSecondarySocketIndices = Array.from(
    new Set(initialRolls.flatMap((r) => r.secondarySocketIndices)),
  ).sort((a, b) => a - b);

  // newClusteredRolls collapses perks into an array with no blank spaces,
  // so we'll use this to iterate our new structure.
  // if above is [3, 4], this would be [0, 1]. basically array.keys
  const rollIndices = allSecondarySocketIndices.map((_, i) => i);

  let newClusteredRolls = initialRolls
    // ignore rolls with no perks in them
    .filter((r) => r.secondarySocketIndices.length)
    .map((r) =>
      allSecondarySocketIndices.map((i) => {
        const perkHash = r.secondaryPerksMap[i];
        return perkHash
          ? { perks: [perkHash], key: normalizePerkKey(perkHash) }
          : { perks: [], key: `` };
      }),
    );

  // we iterate through the perk columns, looking for stuff to collapse
  for (const index of rollIndices) {
    // we repeatedly look for things to collapse until there are none

    while (true) {
      // find a bundle that matches another bundle, in every column except our current one
      // empty-to-empty columns don't count as a match (prevents merging unrelated rolls)
      const perkBundleToConsolidate = newClusteredRolls.find((r1) =>
        newClusteredRolls.some(
          (r2) =>
            r1 !== r2 &&
            rollIndices.every(
              (i) =>
                i === index || (r1[i].key === r2[i].key && !(r1[i].key === '' && r2[i].key === '')),
            ),
        ),
      );
      // if nothing's found, we've collapsed as much as we can
      if (!perkBundleToConsolidate) {
        break;
      }

      const [bundlesToCombine, bundlesToLeaveAlone] = partition(newClusteredRolls, (r) =>
        rollIndices.every(
          (i) =>
            i === index ||
            (perkBundleToConsolidate[i].key === r[i].key &&
              !(perkBundleToConsolidate[i].key === '' && r[i].key === '')),
        ),
      );

      // set aside the uninvolved bundles
      newClusteredRolls = bundlesToLeaveAlone;

      // build a new bundle with the same other columns, but add together the perks in this column
      const newPerkBundle = perkBundleToConsolidate.with(
        index,
        combineColumns(bundlesToCombine.map((b) => b[index])),
      );

      newClusteredRolls.push(newPerkBundle);
    }
  }
  return newClusteredRolls.map((c) => c.map((r) => r.perks));
}

interface PerkMeta {
  hash: number;
  type: 'curated' | 'both' | 'rolled';
}
export type PerkColumnsMeta = PerkMeta[][];

function getBaseEnhancedPerkPair(perkHash: number) {
  let base = unenhancedVersion(perkHash);
  let enhanced = enhancedVersion(perkHash);
  if (!base && !enhanced) {
    return;
  }

  if (!enhanced) {
    enhanced = enhancedVersion(base!)!;
  }
  if (!base) {
    base = unenhancedVersion(enhanced)!;
  }

  return { base, enhanced };
}

// given an enhanceable/enhanced perk, returns a key referring to both.
// given anything else, returns just a stringified hash
function normalizePerkKey(perkHash: number) {
  const bep = getBaseEnhancedPerkPair(perkHash);
  return bep ? `${bep.base}/${bep.enhanced}` : `${perkHash}`;
}

function combineColumns(
  columns: {
    perks: number[];
    key: string;
  }[],
) {
  const perks = [...new Set(columns.flatMap((c) => c.perks))].sort();

  return {
    perks,
    key: perks.join(),
  };
}
