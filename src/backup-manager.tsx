import { useState } from 'react';
import { DatabaseBackup, RotateCcw, X } from 'lucide-react';
import type { Language } from './i18n';

type BackupResponse = { backupDirectory?: string; assetCount?: number; totalBytes?: number; restored?: boolean; createdAt?: string; canceled?: boolean; error?: string };

type Props = { lang: Language; onClose: () => void; onPrepare: () => Promise<void> };

export function BackupManager({ lang, onClose, onPrepare }: Props) {
  const french = lang === 'fr';
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const run = async (action: 'create' | 'restore') => {
    if (!window.studioBackup || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await onPrepare();
      const result: BackupResponse = await window.studioBackup[action](lang);
      if (result.canceled) return;
      if (result.error) throw new Error(result.error);
      setMessage(result.restored
        ? french ? 'Projets restaurés. L’application va redémarrer.' : `Restored ${result.assetCount ?? 0} image assets. The application will reload.`
        : french ? `Sauvegarde créée avec ${result.assetCount ?? 0} images : ${result.backupDirectory}.` : `Backup created with ${result.assetCount ?? 0} image assets at ${result.backupDirectory}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Backup operation failed.';
      setMessage(french && message === 'The local project database is unavailable or too large to back up.' ? 'La base de données locale des projets est indisponible ou trop volumineuse.' : french && message === 'Local design services did not stop safely.' ? 'Les services locaux ne se sont pas arrêtés correctement.' : message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="assistant-modal backup-manager-modal"><div className="modal-top"><span><DatabaseBackup size={15}/>{french ? 'Sauvegarde et récupération' : 'Backup and recovery'}</span><button onClick={onClose} aria-label={french ? 'Fermer' : 'Close'}><X size={17}/></button></div><h2>{french ? 'Protégez vos projets locaux' : 'Protect your local projects'}</h2><p>{french ? 'Créez une sauvegarde portable des projets et images, ou restaurez une sauvegarde vérifiée. Les identifiants du trousseau système ne sont pas inclus.' : 'Create a portable backup of projects and image assets, or restore a previously verified backup. API credentials in the operating-system keyring are not included.'}</p><div className="modal-actions"><button className="secondary-action" disabled={busy || !window.studioBackup} onClick={() => void run('create')}><DatabaseBackup size={14}/>{busy ? (french ? 'En cours…' : 'Working…') : (french ? 'Créer une sauvegarde' : 'Create backup')}</button><button className="assistant-generate" disabled={busy || !window.studioBackup} onClick={() => void run('restore')}><RotateCcw size={14}/>{busy ? (french ? 'En cours…' : 'Working…') : (french ? 'Restaurer' : 'Restore backup')}</button></div>{!window.studioBackup&&<small>{french ? 'La sauvegarde est disponible dans l’application de bureau installée.' : 'Backup and recovery are available in the packaged desktop application.'}</small>}{message&&<div className="ai-result-box" role="status">{message}</div>}</section></div>;
}
