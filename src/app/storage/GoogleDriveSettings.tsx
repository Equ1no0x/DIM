import { ExportResponse } from '@destinyitemmanager/dim-api-types';
import { importBackupIntoLocalState } from 'app/dim-api/import';
import { t } from 'app/i18next-t';
import { showNotification } from 'app/notifications/notifications';
import Checkbox from 'app/settings/Checkbox';
import { fineprintClass, settingClass } from 'app/settings/SettingsPage';
import ErrorPanel from 'app/shell/ErrorPanel';
import { AppIcon, refreshIcon, uploadIcon } from 'app/shell/icons';
import { useThunkDispatch } from 'app/store/thunk-dispatch';
import { errorMessage } from 'app/utils/errors';
import { useEffect, useRef, useState } from 'react';
import * as styles from './DimApiSettings.m.scss';
import ImportExport from './ImportExport';
import LocalStorageInfo from './LocalStorageInfo';
import { exportBackupData, exportLocalData } from './export-data';
import { googleDriveService } from './google-drive-service';

export default function GoogleDriveSettings() {
  const dispatch = useThunkDispatch();
  const [googleDriveSyncEnabled, setGoogleDriveSyncEnabled] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialSyncDone = useRef(false);

  useEffect(() => {
    const savedSync = localStorage.getItem('google-drive-sync-enabled') === 'true';
    setGoogleDriveSyncEnabled(savedSync);
    if (savedSync) {
      // Restore auth on reload, then immediately sync from Drive
      initAndSync();
    }
  }, []);

  // Auto-sync every 5 minutes
  useEffect(() => {
    if (!googleDriveSyncEnabled || !isAuthed) return;
    const syncInterval = setInterval(
      () => {
        performBidirectionalSync();
      },
      5 * 60 * 1000,
    );
    return () => clearInterval(syncInterval);
  }, [googleDriveSyncEnabled, isAuthed]);

  /**
   * On page load: initialize GIS, restore token, then immediately sync from Drive
   * Drive is ALWAYS authoritative when no local sync timestamp exists (fresh browser)
   */
  const initAndSync = async () => {
    try {
      await googleDriveService.initialize();
      const authed = googleDriveService.isAuthenticated();
      setIsAuthed(authed);
      setError(null);

      if (authed && !initialSyncDone.current) {
        initialSyncDone.current = true;
        await loadLastSyncTime();

        const localLastSync = localStorage.getItem('google-drive-last-local-sync');

        if (!localLastSync) {
          // Fresh browser - Drive is authoritative - always download
          console.log('Init: Fresh browser detected. Drive is authoritative. Downloading...');
          await downloadFromDrive(true);
        } else {
          // Has synced before - do bidirectional check
          await performBidirectionalSync();
        }
      }
    } catch (e) {
      console.error('Failed to initialize Google Drive:', e);
      setError(errorMessage(e));
      setIsAuthed(false);
    }
  };

  const loadLastSyncTime = async () => {
    try {
      const syncTime = await googleDriveService.getLastSyncTime();
      setLastSyncTime(syncTime);
    } catch (e) {
      console.error('Failed to load sync time:', e);
    }
  };

  const onGoogleDriveSyncChange = async (checked: boolean) => {
    try {
      setError(null);
      if (checked) {
        await googleDriveService.initialize();
        await googleDriveService.authenticate();

        if (!googleDriveService.isAuthenticated()) {
          setIsAuthed(false);
          setGoogleDriveSyncEnabled(false);
          throw new Error('Failed to authenticate with Google Drive');
        }

        setIsAuthed(true);
        localStorage.setItem('google-drive-sync-enabled', 'true');
        setGoogleDriveSyncEnabled(true);
        await loadLastSyncTime();

        // On first enable: Drive is authoritative if file exists, else upload local
        const localLastSync = localStorage.getItem('google-drive-last-local-sync');
        if (!localLastSync) {
          await downloadFromDrive(true);
        } else {
          await performBidirectionalSync();
        }

        showNotification({
          type: 'success',
          title: t('Storage.GoogleDriveSyncEnabled'),
          body: t('Storage.GoogleDriveSyncEnabledBody'),
          duration: 10000,
        });
      } else {
        googleDriveService.logout();
        localStorage.removeItem('google-drive-sync-enabled');
        localStorage.removeItem('google-drive-last-local-sync');
        setGoogleDriveSyncEnabled(false);
        setIsAuthed(false);
        showNotification({ type: 'info', title: t('Storage.GoogleDriveSyncDisabled') });
      }
    } catch (e) {
      const err = errorMessage(e);
      setError(err);
      setIsAuthed(false);
      setGoogleDriveSyncEnabled(false);
      showNotification({
        type: 'error',
        title: t('Storage.GoogleDriveSyncError'),
        body: err,
        duration: 15000,
      });
    }
  };

  /**
   * Download from Drive → load into Redux (Drive authoritative)
   */
  const downloadFromDrive = async (silent = false) => {
    try {
      console.log('Sync: Downloading from Drive...');
      const driveData = await googleDriveService.loadBackup();

      if (!driveData) {
        if (!silent) {
          showNotification({ type: 'info', title: t('Storage.NoBackupFound') });
        }
        return false;
      }

      await dispatch(importBackupIntoLocalState(driveData, true));
      localStorage.setItem('google-drive-last-local-sync', new Date().toISOString());
      await loadLastSyncTime();
      console.log('Sync: Drive → Local complete');

      if (!silent) {
        showNotification({
          type: 'success',
          title: t('Storage.SyncSuccess'),
          body: 'Downloaded from Google Drive',
          duration: 5000,
        });
      }
      return true;
    } catch (e) {
      console.error('Download from Drive failed:', e);
      throw e;
    }
  };

  /**
   * Upload to Drive ← local state
   */
  const uploadToDrive = async (silent = false) => {
    try {
      console.log('Sync: Uploading to Drive...');
      const currentState = await dispatch(exportLocalData());
      await googleDriveService.saveBackup(currentState);
      localStorage.setItem('google-drive-last-local-sync', new Date().toISOString());
      await loadLastSyncTime();
      console.log('Sync: Local → Drive complete');

      if (!silent) {
        showNotification({
          type: 'success',
          title: t('Storage.SyncSuccess'),
          body: 'Uploaded to Google Drive',
          duration: 5000,
        });
      }
    } catch (e) {
      console.error('Upload to Drive failed:', e);
      throw e;
    }
  };

  /**
   * Bidirectional sync:
   * - No local timestamp → Drive authoritative → download
   * - Drive newer → download
   * - Local newer / no Drive file → upload
   */
  const performBidirectionalSync = async () => {
    if (!isAuthed) return;
    try {
      setIsSyncing(true);
      setError(null);

      const localLastSync = localStorage.getItem('google-drive-last-local-sync');
      const localModifiedTime = localLastSync ? new Date(localLastSync) : null;
      const driveModifiedTime = await googleDriveService.getLastSyncTime();

      console.log(
        'Sync: Drive modified:',
        driveModifiedTime,
        '| Local last sync:',
        localModifiedTime,
      );

      if (!localModifiedTime) {
        // Fresh browser - Drive authoritative
        console.log('Sync: No local timestamp. Drive is authoritative.');
        await downloadFromDrive(false);
      } else if (driveModifiedTime && driveModifiedTime > localModifiedTime) {
        // Drive is newer - download
        console.log('Sync: Drive is newer. Downloading...');
        await downloadFromDrive(false);
      } else {
        // Local is newer or no Drive file - upload
        console.log('Sync: Local is newer. Uploading...');
        await uploadToDrive(false);
      }
    } catch (e) {
      const err = errorMessage(e);
      console.error('Sync error:', err, e);
      setError(err);
      showNotification({
        type: 'error',
        title: t('Storage.SyncError'),
        body: err,
        duration: 15000,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const onManualSync = async () => {
    if (!isAuthed) {
      showNotification({ type: 'warning', title: t('Storage.NotAuthenticated') });
      return;
    }
    await performBidirectionalSync();
  };

  /**
   * Download Backup: Google Drive file → user file download (no state change)
   */
  const onLoadFromDrive = async () => {
    if (!isAuthed) {
      showNotification({ type: 'warning', title: t('Storage.NotAuthenticated') });
      return;
    }
    try {
      setError(null);
      const data = await googleDriveService.loadBackup();
      if (!data) {
        showNotification({ type: 'info', title: t('Storage.NoBackupFound') });
        return;
      }
      exportBackupData(data);
      showNotification({ type: 'success', title: t('Storage.BackupDownloaded'), duration: 10000 });
    } catch (e) {
      const err = errorMessage(e);
      setError(err);
      showNotification({
        type: 'error',
        title: t('Storage.DownloadError'),
        body: err,
        duration: 15000,
      });
    }
  };

  /**
   * Download Data Backup: current Redux state → user file download
   */
  const onExportData = async () => {
    try {
      const data = await dispatch(exportLocalData());
      exportBackupData(data);
    } catch (e) {
      showNotification({
        type: 'error',
        title: t('Storage.ExportError'),
        body: errorMessage(e),
        duration: 15000,
      });
    }
  };

  /**
   * Import Data Backup: user file → Redux → IDB auto-persists → upload to Drive
   */
  const onImportData = async (data: ExportResponse) => {
    try {
      setError(null);
      console.log('Import: Loading data into Redux...', data);

      // Load directly into local state, bypassing DIM API
      await dispatch(importBackupIntoLocalState(data, false));
      console.log('Import: Redux updated. Waiting for IDB observer...');

      // Wait for IDB observer debounce (1000ms in actions.ts) plus safety margin for slow disks.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      console.log('Import: IDB wait complete');

      if (isAuthed) {
        // Export current merged state and upload to Drive
        await uploadToDrive(true);
        showNotification({
          type: 'success',
          title: t('Storage.ImportSuccess'),
          body: t('Storage.ImportedAndUploaded'),
          duration: 10000,
        });
      } else {
        showNotification({
          type: 'success',
          title: t('Storage.ImportSuccess'),
          body: t('Storage.EnableSyncToUpload'),
          duration: 10000,
        });
      }
    } catch (e) {
      const err = errorMessage(e);
      console.error('Import error:', err, e);
      setError(err);
      showNotification({
        type: 'error',
        title: t('Storage.ImportError'),
        body: err,
        duration: 15000,
      });
    }
  };

  return (
    <section className={styles.storage} id="storage">
      <h2>{t('Storage.MenuTitle')}</h2>

      <div className={settingClass}>
        <Checkbox
          name="googleDriveSyncEnabled"
          label={t('Storage.EnableGoogleDriveSync')}
          value={googleDriveSyncEnabled}
          onChange={onGoogleDriveSyncChange}
        />
        <div className={fineprintClass}>{t('Storage.GoogleDriveSyncFinePrint')}</div>

        {/* Buttons: visible when sync enabled AND authed */}
        {googleDriveSyncEnabled && isAuthed && (
          <>
            <button
              type="button"
              className="dim-button"
              onClick={onManualSync}
              disabled={isSyncing}
            >
              <AppIcon icon={refreshIcon} />
              {isSyncing ? t('Storage.Syncing') : t('Storage.ManualSync')}
            </button>

            <button type="button" className="dim-button" onClick={onLoadFromDrive}>
              <AppIcon icon={uploadIcon} /> {t('Storage.DownloadBackup')}
            </button>

            {lastSyncTime && (
              <div className={fineprintClass}>
                {t('Storage.LastSync', { time: lastSyncTime.toLocaleString() })}
              </div>
            )}
          </>
        )}

        {/* Re-auth button if sync enabled but token expired */}
        {googleDriveSyncEnabled && !isAuthed && (
          <button type="button" className="dim-button" onClick={initAndSync}>
            {t('Storage.Reconnect')}
          </button>
        )}
      </div>

      {error && <ErrorPanel title={t('Storage.ErrorTitle')} error={new Error(error)} />}

      <LocalStorageInfo showDetails={!googleDriveSyncEnabled} />

      <div className={settingClass}>
        <ImportExport onExportData={onExportData} onImportData={onImportData} />
      </div>
    </section>
  );
}
