declare module '*.css';

interface Window {
  studioBackup?: {
    create: (language: 'fr' | 'en') => Promise<{ backupDirectory?: string; assetCount?: number; totalBytes?: number; canceled?: boolean; error?: string }>;
    restore: (language: 'fr' | 'en') => Promise<{ restored?: boolean; createdAt?: string; assetCount?: number; canceled?: boolean; error?: string }>;
  };
}
