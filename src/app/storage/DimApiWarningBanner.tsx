import { dimSyncErrorSelector, updateQueueLengthSelector } from 'app/dim-api/selectors';
import { t } from 'app/i18next-t';
import HeaderWarningBanner from 'app/shell/HeaderWarningBanner';
import { useSelector } from 'react-redux';

/**
 * Shows an error banner in the header whenever we're having problems talking to DIM Sync.
 * Suppressed when Google Drive Sync is enabled (we use Drive instead of DIM API).
 */
export default function DimApiWarningBanner() {
  const syncError = useSelector(dimSyncErrorSelector);
  const updateQueueLength = useSelector(updateQueueLengthSelector);

  // If Google Drive Sync is enabled, suppress DIM Sync error banner
  const googleDriveSyncEnabled = localStorage.getItem('google-drive-sync-enabled') === 'true';
  if (!syncError || googleDriveSyncEnabled) {
    return null;
  }

  return (
    <HeaderWarningBanner>
      <span>
        {t('Storage.DimSyncDown')}{' '}
        {updateQueueLength > 0 && t('Storage.UpdateQueueLength', { count: updateQueueLength })}
      </span>
    </HeaderWarningBanner>
  );
}
