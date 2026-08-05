import { ExportResponse } from '@destinyitemmanager/dim-api-types';

declare const google: any;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const FOLDER_NAME = 'DIM-Backups';
const FILE_NAME = 'dim-data.json';
const DRIVE_API_URL = 'https://www.googleapis.com/drive/v3';

export class GoogleDriveService {
  private accessToken: string | null = null;
  private tokenClient: any = null;
  private folderId: string | null = null;

  /**
   * Initialize Google Identity Services
   */
  async initialize(): Promise<void> {
    if (!GOOGLE_CLIENT_ID) {
      throw new Error('Google Drive Client ID not configured');
    }

    try {
      // Load Google Identity Services library
      await this.loadGoogleIdentityServices();

      // Initialize token client
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES.join(' '),
        callback: (response: any) => {
          if (response.access_token) {
            this.accessToken = response.access_token;
            localStorage.setItem('google-drive-token', response.access_token);
          } else {
            throw new Error('Failed to get access token');
          }
        },
      });

      // Check for stored token
      const storedToken = localStorage.getItem('google-drive-token');
      if (storedToken) {
        this.accessToken = storedToken;
        // Verify token is still valid by checking a non-sensitive endpoint
        const isValid = await this.verifyToken();
        if (!isValid) {
          this.accessToken = null;
          localStorage.removeItem('google-drive-token');
        }
      }
    } catch (error) {
      console.error('Failed to initialize Google Drive:', error);
      throw error;
    }
  }

  /**
   * Load Google Identity Services library
   */
  private async loadGoogleIdentityServices(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      if ((window as any).google?.accounts?.oauth2) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  /**
   * Authenticate user with Google
   */
  async authenticate(): Promise<void> {
    if (!this.tokenClient) {
      throw new Error('Token client not initialized');
    }

    return new Promise((resolve, reject) => {
      try {
        // Request access token with popup
        this.tokenClient.requestAccessToken({ prompt: 'consent' });

        // Set timeout to wait for callback
        const timeout = setTimeout(() => {
          reject(new Error('Authentication timeout'));
        }, 10000);

        // Check if token was set (polling)
        const checkToken = setInterval(() => {
          if (this.accessToken) {
            clearInterval(checkToken);
            clearTimeout(timeout);
            resolve();
          }
        }, 100);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Verify if stored token is still valid
   */
  private async verifyToken(): Promise<boolean> {
    try {
      if (!this.accessToken) return false;

      // Use a less sensitive call to check token validity
      const response = await fetch('https://www.googleapis.com/oauth2/v1/tokeninfo', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      return response.ok;
    } catch (error) {
      console.error('Token verification failed:', error);
      return false;
    }
  }

  /**
   * Get or create backup folder
   */
  private async getFolderId(): Promise<string> {
    if (this.folderId) return this.folderId;

    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      // List files to find folder
      const query = encodeURIComponent(
        `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      );
      const response = await fetch(
        `${DRIVE_API_URL}/files?q=${query}&spaces=drive&fields=files(id)`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Drive API error: ${response.status}`);
      }

      const result = await response.json();
      const files = result.files || [];

      if (files.length > 0) {
        this.folderId = files[0].id;
      } else {
        // Create folder if it doesn't exist
        const createResponse = await fetch(`${DRIVE_API_URL}/files?fields=id`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: FOLDER_NAME,
            mimeType: 'application/vnd.google-apps.folder',
          }),
        });

        if (!createResponse.ok) {
          throw new Error(`Failed to create folder: ${createResponse.status}`);
        }

        const createResult = await createResponse.json();
        this.folderId = createResult.id;
        if (!this.folderId) {
          throw new Error('Failed to create backup folder');
        }
      }

      if (!this.folderId) {
        throw new Error('Failed to resolve backup folder');
      }

      return this.folderId;
    } catch (error) {
      console.error('Failed to get/create folder:', error);
      throw error;
    }
  }

  /**
   * Save backup to Google Drive
   */
  async saveBackup(data: ExportResponse): Promise<void> {
    try {
      if (!this.accessToken) {
        await this.authenticate();
      }

      if (!this.accessToken) {
        throw new Error('Failed to authenticate');
      }

      const folderId = await this.getFolderId();
      const jsonContent = JSON.stringify(data);

      // Check if file exists
      const query = encodeURIComponent(
        `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
      );
      const listResponse = await fetch(
        `${DRIVE_API_URL}/files?q=${query}&spaces=drive&fields=files(id)`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );

      if (!listResponse.ok) {
        throw new Error(`Drive API error on file listing: ${listResponse.status}`);
      }

      const listResult = await listResponse.json();
      const files = listResult.files || [];
      const fileId = files.length > 0 ? files[0].id : null;

      if (fileId) {
        // Update existing file
        const updateResponse = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': 'application/json',
            },
            body: jsonContent,
          },
        );

        if (!updateResponse.ok) {
          throw new Error(`Failed to update file: ${updateResponse.status}`);
        }
      } else {
        // Create new file (Multipart upload)
        const boundary = '===============7330845974216740156==';
        const createResponse = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body: this.createMultipartBody(
              boundary,
              {
                name: FILE_NAME,
                mimeType: 'application/json',
                parents: [folderId],
              },
              jsonContent,
            ),
          },
        );

        if (!createResponse.ok) {
          throw new Error(`Failed to create file: ${createResponse.status}`);
        }

        const createResult = await createResponse.json();
        if (!createResult.id) {
          throw new Error('Failed to create backup file during upload');
        }
      }
    } catch (error) {
      console.error('Failed to save backup to Google Drive:', error);
      throw error;
    }
  }

  /**
   * Load backup from Google Drive
   */
  async loadBackup(): Promise<ExportResponse | null> {
    try {
      if (!this.accessToken) {
        await this.authenticate();
      }

      if (!this.accessToken) {
        throw new Error('Failed to authenticate');
      }

      const folderId = await this.getFolderId();

      // Find file
      const query = encodeURIComponent(
        `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
      );
      const listResponse = await fetch(
        `${DRIVE_API_URL}/files?q=${query}&spaces=drive&fields=files(id)`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );

      if (!listResponse.ok) {
        throw new Error(`Drive API error on file listing: ${listResponse.status}`);
      }

      const listResult = await listResponse.json();
      const files = listResult.files || [];

      if (files.length === 0) {
        return null;
      }

      const fileId = files[0].id;

      // Download file content
      const downloadResponse = await fetch(`${DRIVE_API_URL}/files/${fileId}?alt=media`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (!downloadResponse.ok) {
        throw new Error(`Failed to download file: ${downloadResponse.status}`);
      }

      const data = await downloadResponse.json();
      return data as ExportResponse;
    } catch (error) {
      console.error('Failed to load backup from Google Drive:', error);
      throw error;
    }
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  /**
   * Logout and clear stored token
   */
  logout(): void {
    this.accessToken = null;
    this.folderId = null;
    localStorage.removeItem('google-drive-token');

    // Revoke token if possible
    if (this.accessToken) {
      fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }).catch(() => {
        // Ignore revoke errors
      });
    }
  }

  /**
   * Get last sync time (if available)
   */
  async getLastSyncTime(): Promise<Date | null> {
    try {
      if (!this.accessToken) return null;

      const folderId = await this.getFolderId();

      const query = encodeURIComponent(
        `name='${FILE_NAME}' and '${folderId}' in parents and trashed=false`,
      );
      const response = await fetch(
        `${DRIVE_API_URL}/files?q=${query}&spaces=drive&fields=files(modifiedTime)`,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Drive API error: ${response.status}`);
      }

      const result = await response.json();
      const files = result.files || [];

      if (files.length > 0 && files[0].modifiedTime) {
        return new Date(files[0].modifiedTime);
      }

      return null;
    } catch (error) {
      console.error('Failed to get last sync time:', error);
      return null;
    }
  }

  /**
   * Helper: Create multipart body for file upload
   */
  private createMultipartBody(boundary: string, metadata: any, content: string): string {
    return (
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: application/json\r\n\r\n` +
      `${content}\r\n` +
      `--${boundary}--`
    );
  }
}

export const googleDriveService = new GoogleDriveService();
