import ExternalLink from 'app/dim-ui/ExternalLink';
import { PressTip } from 'app/dim-ui/PressTip';
import { t } from 'app/i18next-t';
import { DimItem } from 'app/inventory/item-types';
import Plug from 'app/item-popup/Plug';
import { useD2Definitions } from 'app/manifest/selectors';
import { faExclamationTriangle } from 'app/shell/icons';
import AppIcon from 'app/shell/icons/AppIcon';
import { compareBy } from 'app/utils/comparators';
import { normalizeToUnenhanced } from 'app/utils/perk-utils';
import {
  wishListInfosSelector,
  wishListRollsForItemHashSelector,
  wishListSelector,
} from 'app/wishlists/selectors';
import { WishListRoll } from 'app/wishlists/types';
import { InventoryWishListRoll } from 'app/wishlists/wishlists';
import { partition } from 'es-toolkit';
import { useSelector } from 'react-redux';
import * as styles from './AllWishlistRolls.m.scss';
import { getCraftingTemplate } from './crafting-utils';

/**
 * List out all the known wishlist rolls for a given item.
 *
 * This is currently only used with a fake definitions-built item,
 * that has every perk available in each perk socket
 * (with some overrides to set some as "plugged", when spawned from a real item).
 * This would render much weirder if it were fed an owned inventory item.
 */
export default function AllWishlistRolls({
  item,
  realAvailablePlugHashes,
}: {
  item: DimItem;
  /**
   * non-plugged, but available, plugs, from the real item this was spawned from.
   * used to mark sockets as available
   */
  realAvailablePlugHashes?: number[];
}) {
  const wishlistRolls = useSelector(wishListRollsForItemHashSelector(item.hash));
  const wishlistRoll = useSelector(wishListSelector(item));
  const [goodRolls, badRolls] = partition(wishlistRolls, (r) => !r.isUndesirable);

  return (
    <>
      {goodRolls.length > 0 && (
        <>
          <h2>{t('Armory.WishlistedRolls', { count: goodRolls.length })}</h2>
          <WishlistRolls
            item={item}
            wishlistRolls={goodRolls}
            wishlistRoll={wishlistRoll}
            realAvailablePlugHashes={realAvailablePlugHashes}
          />
        </>
      )}
      {badRolls.length > 0 && (
        <>
          <h2>{t('Armory.TrashlistedRolls', { count: badRolls.length })}</h2>
          <WishlistRolls
            item={item}
            wishlistRolls={badRolls}
            wishlistRoll={wishlistRoll}
            realAvailablePlugHashes={realAvailablePlugHashes}
          />
        </>
      )}
    </>
  );
}

function WishlistRolls({
  wishlistRolls,
  item,
  realAvailablePlugHashes,
}: {
  wishlistRolls: WishListRoll[];
  item: DimItem;
  wishlistRoll?: InventoryWishListRoll;
  /**
   * non-plugged, but available, plugs, from the real item this was spawned from.
   * used to mark sockets as available
   */
  realAvailablePlugHashes?: number[];
}) {
  const defs = useD2Definitions()!;
  const wishlistInfos = useSelector(wishListInfosSelector);
  const groupedWishlistRolls = Object.groupBy(wishlistRolls, (r) => r.notes || t('Armory.NoNotes'));

  const templateSockets = getCraftingTemplate(defs, item.hash)?.sockets?.socketEntries;

  // the order, within their column, that perks appear. for sorting barrels mags etc.
  const columnOrderByPlugHash: Record<number, number> = {};

  if (item.sockets) {
    for (const s of item.sockets.allSockets) {
      if (s.isReusable) {
        // if this is a crafted item, use its template's plug order. otherwise fall back to its reusable or randomized plugsets
        const plugSetHash =
          templateSockets?.[s.socketIndex].reusablePlugSetHash ??
          (s.socketDefinition.randomizedPlugSetHash || s.socketDefinition.reusablePlugSetHash);

        if (plugSetHash) {
          const plugSet = defs.PlugSet.get(plugSetHash);
          if (!plugSet) {
            console.warn(
              `Armory: PlugSet ${plugSetHash} not found in manifest for socket ${s.socketIndex}`,
            );
          }
          const plugItems = plugSet?.reusablePlugItems ?? [];
          for (let i = 0; i < plugItems.length; i++) {
            const plugItem = plugItems[i];
            if (plugItem.currentlyCanRoll) {
              columnOrderByPlugHash[plugItem.plugItemHash] = i;
            }
          }
        }
      }
    }
  }

  // All plug hashes present anywhere on the weapon (normalized), used to detect
  // wishlist hashes that don't correspond to any plug on this weapon.
  const allWeaponPlugHashesNormalized = new Set(
    (item.sockets?.allSockets ?? []).flatMap((s) =>
      s.plugOptions.map((p) => normalizeToUnenhanced(p.plugDef.hash)),
    ),
  );

  const spentTitles = new Set<string>();
  function spendTitle(roll: WishListRoll) {
    if (roll.title && !spentTitles.has(roll.title)) {
      spentTitles.add(roll.title);
      const url = wishlistInfos?.[roll.sourceWishListIndex ?? -1]?.url;
      return (
        <>
          <h3>{url ? <ExternalLink href={url}>{roll.title}</ExternalLink> : roll.title}</h3>
          {roll.description && <p className={styles.subtitle}>{roll.description}</p>}
        </>
      );
    }
  }

  return (
    <>
      {Object.entries(groupedWishlistRolls).map(([notes, rolls]) => {
        if (!rolls?.length) return null;

        // Collect all wishlisted perk hashes across all rolls in this section,
        // normalised so that base and enhanced perk variants are treated as equivalent.
        const wishlistedNormalizedHashes = new Set(
          rolls.flatMap((r) => [...r.recommendedPerks].map(normalizeToUnenhanced)),
        );
        const isWishlisted = (hash: number) =>
          wishlistedNormalizedHashes.has(normalizeToUnenhanced(hash));

        // Pre-build a normalized set of real item plug hashes for O(1) lookup.
        // realAvailablePlugHashes is [] (not undefined) when no owned item is available,
        // so we treat both undefined and empty as "no filter — show all wishlisted plugs".
        const realItemNormalizedHashes = realAvailablePlugHashes?.length
          ? new Set(realAvailablePlugHashes.map(normalizeToUnenhanced))
          : null;

        // A plug is a "match" if it is wishlisted AND present on the user's specific item.
        // When no real-item context exists (null set), all wishlisted plugs are shown.
        const isMatch = (hash: number) =>
          isWishlisted(hash) &&
          (!realItemNormalizedHashes || realItemNormalizedHashes.has(normalizeToUnenhanced(hash)));

        // One column per socket that has at least one matching plug, sorted by socketIndex.
        const relevantSockets = (item.sockets?.allSockets ?? [])
          .filter((s) => s.isReusable && s.plugOptions.some((p) => isWishlisted(p.plugDef.hash)))
          .sort((a, b) => a.socketIndex - b.socketIndex);

        // Wishlist hashes that don't exist in any plug slot on this weapon at all.
        // Shown as InvalidPlug warnings so the user knows the wishlist references an unknown perk.
        const unmatchedHashes = [
          ...new Set(
            rolls
              .flatMap((r) => [...r.recommendedPerks])
              .filter((h) => !allWeaponPlugHashesNormalized.has(normalizeToUnenhanced(h))),
          ),
        ];

        if (!relevantSockets.length && !unmatchedHashes.length) return null;

        // Each column contains only the matching plugs for that socket,
        // sorted by crafting-template column order for stable row positions.
        const sortedColumns = relevantSockets.map((s) =>
          [...s.plugOptions]
            .filter((p) => isWishlisted(p.plugDef.hash))
            .sort(compareBy((p) => columnOrderByPlugHash[p.plugDef.hash] ?? 9999)),
        );

        // One row per matching plug: max match count across all columns.
        const numRows = relevantSockets.length
          ? Math.max(...sortedColumns.map((col) => col.length))
          : 0;

        const wishlistUrl =
          rolls[0].sourceWishListIndex !== undefined
            ? wishlistInfos?.[rolls[0].sourceWishListIndex]?.url
            : undefined;

        return (
          <div key={notes} className={styles.rollGroup}>
            {spendTitle(rolls[0])}
            <p className={styles.notes}>{notes}</p>
            <ul>
              {Array.from({ length: numRows }, (_, rowIdx) => (
                <li key={rowIdx} className={styles.roll}>
                  {sortedColumns.map((column, colIdx) => {
                    const socket = relevantSockets[colIdx];
                    const plug = column[rowIdx];
                    return (
                      <div key={socket.socketIndex} className={styles.orGroup}>
                        {plug && (
                          <Plug
                            plug={plug}
                            item={item}
                            socketInfo={socket}
                            hasMenu={false}
                            // highlighted = wishlisted AND on my item; dimmed = wishlisted but not on my item
                            plugged={isMatch(plug.plugDef.hash)}
                          />
                        )}
                      </div>
                    );
                  })}
                </li>
              ))}
              {unmatchedHashes.length > 0 && (
                <li key="unmatched" className={styles.roll}>
                  {unmatchedHashes.map((hash) => (
                    <div key={hash} className={styles.orGroup}>
                      <InvalidPlug hash={hash} item={item} wishlistUrl={wishlistUrl} />
                    </div>
                  ))}
                </li>
              )}
            </ul>
          </div>
        );
      })}
    </>
  );
}

function InvalidPlug({
  hash,
  item,
  wishlistUrl,
}: {
  hash: number;
  item: DimItem;
  wishlistUrl?: string;
}) {
  const defs = useD2Definitions();
  const perkName = defs?.InventoryItem.get(hash)?.displayProperties.name;
  const itemName = defs?.InventoryItem.get(item.hash)?.displayProperties.name;
  const tooltip = [
    t('Armory.UnknownPerkHash', { hash, perkName: perkName ?? t('Armory.Unknown') }),
    itemName ? `\n${itemName}` : '',
    wishlistUrl ? `\n${wishlistUrl}` : '',
  ].join('');
  return (
    <PressTip tooltip={tooltip} className={styles.invalidPlug}>
      <AppIcon icon={faExclamationTriangle} />
    </PressTip>
  );
}
