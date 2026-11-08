import { useEffect, useState } from 'react';
import { AlertCircle, Check, ExternalLink, ImagePlus, KeyRound, LoaderCircle, RefreshCw, Search, Save } from 'lucide-react';
import { connectPinterest, getPinterestStatus, importPinterestPin, savePinterestConfig, searchPinterest, type PinterestPin, type PinterestStatus } from './api';

type ImportedAsset = { id: string; src: string; sourceName: string; sourceUrl?: string; width: number; height: number };
type Props = { projectId: string; onImported: (asset: ImportedAsset) => void };

export function PinterestImporter({ projectId, onImported }: Props) {
  const [status, setStatus] = useState<PinterestStatus>();
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [query, setQuery] = useState('');
  const [pins, setPins] = useState<PinterestPin[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refreshStatus = async () => {
    try { setStatus(await getPinterestStatus()); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to check Pinterest status.'); }
  };
  useEffect(() => { void refreshStatus(); }, []);

  const saveConfig = async () => {
    setBusy(true);
    setMessage('');
    try {
      const next = await savePinterestConfig({ clientId, clientSecret: clientSecret || undefined });
      setStatus(next);
      setClientSecret('');
      setMessage('Credentials saved securely. Add the displayed redirect URI in your Pinterest app settings.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pinterest setup could not be saved.');
    } finally { setBusy(false); }
  };

  const connect = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { url } = await connectPinterest();
      const destination = new URL(url);
      if (destination.origin !== 'https://www.pinterest.com') throw new Error('Unexpected Pinterest authorization destination.');
      window.open(destination.toString(), '_blank', 'noopener,noreferrer');
      setMessage('Approve access on Pinterest, then return here and refresh connection status.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pinterest authorization could not start.');
    } finally { setBusy(false); }
  };

  const search = async () => {
    if (query.trim().length < 2) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await searchPinterest(query.trim());
      setPins(result.items);
      setMessage(result.betaAccessRequired ? 'Pinterest partner search may require app-level beta approval.' : '');
      if (!result.items.length) setMessage('No authorized Pins were returned. Check the query or Pinterest app access.');
    } catch (error) {
      setPins([]);
      setMessage(error instanceof Error ? error.message : 'Pinterest search failed.');
    } finally { setBusy(false); }
  };

  const importPin = async (pin: PinterestPin) => {
    setBusy(true);
    setMessage('');
    try {
      const asset = await importPinterestPin({ projectId, pin });
      onImported(asset);
      setMessage('Image imported with Pinterest source attribution.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Pinterest image import failed.');
    } finally { setBusy(false); }
  };

  return <section className="pinterest-importer"><div className="pinterest-heading"><div><h3><ExternalLink size={14}/>Pinterest inspiration</h3><p>Official API search · imports keep source attribution</p></div><button title="Refresh Pinterest status" onClick={()=>void refreshStatus()}><RefreshCw size={13}/></button></div>{status?.connected?<><div className="pinterest-connected"><Check size={13}/>Authorized Pinterest account connected</div><form className="pinterest-search" onSubmit={(event)=>{event.preventDefault();void search();}}><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search authorized Pins"/><button disabled={busy||query.trim().length<2}><Search size={14}/></button></form>{pins.length>0&&<div className="pinterest-results">{pins.map((pin)=><article key={pin.id}><img src={pin.imageUrl} alt={pin.altText||pin.title||'Pinterest image'}/><div><b>{pin.title||pin.altText||'Pinterest Pin'}</b><a href={pin.sourceUrl} target="_blank" rel="noreferrer">Open source</a><button disabled={busy} onClick={()=>void importPin(pin)}><ImagePlus size={12}/>Import</button></div></article>)}</div>}<p className="pinterest-attribution-note">Confirm you have the right to use every imported image.</p></>:<><p className="pinterest-copy">Pinterest search and image import require an authorized Pinterest app. No login restrictions are bypassed.</p><label>Pinterest app ID<input value={clientId} onChange={(event)=>setClientId(event.target.value)} placeholder="Registered app ID" autoComplete="off"/></label><label>Pinterest app secret<input type="password" value={clientSecret} onChange={(event)=>setClientSecret(event.target.value)} placeholder={status?.clientSecretConfigured?'Saved securely · leave blank to keep':'App secret'} autoComplete="new-password"/></label><button className="secondary-action" disabled={busy||!clientId.trim()} onClick={()=>void saveConfig()}><Save size={13}/>Save credentials securely</button>{status?.clientIdConfigured&&status.clientSecretConfigured&&<button className="assistant-generate" disabled={busy} onClick={()=>void connect()}><KeyRound size={13}/>Authorize Pinterest</button>}{status?.redirectUri&&<div className="pinterest-redirect">Register this exact OAuth redirect URI:<code>{status.redirectUri}</code></div>}</>}{busy&&<div className="pinterest-progress"><LoaderCircle size={13}/>Working with authorized services…</div>}{message&&<div className="provider-message"><AlertCircle size={13}/><span>{message}</span></div>}</section>;
}
