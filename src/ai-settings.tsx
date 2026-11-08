import { useEffect, useState } from 'react';
import { AlertCircle, Check, KeyRound, LoaderCircle, RefreshCw, Save, X } from 'lucide-react';
import { getAIProviderSettings, getLocalAISettings, refreshLocalAIStatus, saveAIProviderSettings, saveLocalAISettings, type AIProviderMode, type AIProviderSettings, type LocalAIStatus } from './api';

type Props = { onClose: () => void; onSaved: (settings: AIProviderSettings) => void };

export function AISettings({ onClose, onSaved }: Props) {
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [textModel, setTextModel] = useState('gpt-4o-mini');
  const [imageModel, setImageModel] = useState('gpt-image-1');
  const [apiKey, setApiKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [mode, setMode] = useState<AIProviderMode>('local');
  const [localTextModel, setLocalTextModel] = useState('qwen2.5:3b');
  const [imageCheckpoint, setImageCheckpoint] = useState('');
  const [localStatus, setLocalStatus] = useState<LocalAIStatus>();
  const [checkingLocal, setCheckingLocal] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    void Promise.all([getAIProviderSettings(), getLocalAISettings()]).then(([provider, local]) => {
      setBaseUrl(provider.baseUrl);
      setTextModel(provider.textModel);
      setImageModel(provider.imageModel);
      setConfigured(provider.apiKeyConfigured);
      setMode(provider.mode);
      setLocalTextModel(local.textModel);
      setImageCheckpoint(local.imageCheckpoint);
      setLocalStatus(local.status);
    }).catch((error) => setMessage(error instanceof Error ? error.message : 'Unable to load AI settings.'));
  }, []);

  const refreshStatus = async () => {
    setCheckingLocal(true);
    try {
      setLocalStatus(await refreshLocalAIStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to check local AI services.');
    } finally {
      setCheckingLocal(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      if (mode === 'local') {
        const saved = await saveLocalAISettings({ textModel: localTextModel, imageCheckpoint, mode });
        setLocalStatus(saved.status);
        onSaved({ baseUrl, textModel, imageModel, apiKeyConfigured: configured, mode });
        setMessage('Local AI settings saved. No prompt or image is sent to a cloud provider.');
      } else {
        const settings = await saveAIProviderSettings({ baseUrl, textModel, imageModel, apiKey: apiKey.trim() || undefined, clearApiKey: clearKey, mode });
        setConfigured(settings.apiKeyConfigured);
        setApiKey('');
        setClearKey(false);
        setMessage(settings.apiKeyConfigured ? 'Provider settings saved. Credentials stay in the operating-system keyring.' : 'Provider settings saved, but no API key is configured.');
        onSaved(settings);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save AI settings.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="assistant-modal ai-settings-modal"><div className="modal-top"><span><KeyRound size={14}/>AI PROVIDER</span><button onClick={onClose}><X size={17}/></button></div><h2>AI settings</h2><label>Active AI mode<select value={mode} onChange={(event) => setMode(event.target.value as AIProviderMode)}><option value="local">Local AI · Ollama + ComfyUI</option><option value="provider">Remote API provider</option></select></label>{mode === 'local' ? <div className="local-ai-settings"><p>Local mode keeps prompts and generated images on this PC. Install Ollama and ComfyUI separately; models are not bundled or downloaded automatically.</p><label>Ollama text model<input value={localTextModel} onChange={(event) => setLocalTextModel(event.target.value)} placeholder="qwen2.5:3b" autoComplete="off"/></label><small>Ollama: http://127.0.0.1:11434</small><label>ComfyUI checkpoint<select value={imageCheckpoint} onChange={(event) => setImageCheckpoint(event.target.value)}><option value="">Select an installed checkpoint</option>{localStatus?.imageCheckpoints.map((checkpoint) => <option value={checkpoint} key={checkpoint}>{checkpoint}</option>)}</select></label><small>ComfyUI: http://127.0.0.1:8188 · no compatible checkpoint detected until the service is running.</small><button className="local-ai-refresh" disabled={checkingLocal} onClick={() => void refreshStatus()}>{checkingLocal ? <LoaderCircle size={13}/> : <RefreshCw size={13}/>}Check local services</button><div className="local-ai-status"><span className={localStatus?.ollamaAvailable ? 'online' : ''}/><b>Ollama</b><small>{!localStatus ? 'Not checked' : localStatus.selectedTextModelAvailable ? `${localTextModel} ready` : localStatus.ollamaAvailable ? `${localTextModel} not installed` : 'Not running'}</small></div><div className="local-ai-status"><span className={localStatus?.comfyAvailable && localStatus.selectedCheckpointAvailable ? 'online' : ''}/><b>ComfyUI</b><small>{!localStatus ? 'Not checked' : !localStatus.comfyAvailable ? 'Not running' : localStatus.selectedCheckpointAvailable ? `${imageCheckpoint} ready` : 'Choose an installed checkpoint'}</small></div></div> : <div className="remote-ai-settings"><p>Use an OpenAI-compatible provider. Prompts and generated images are sent to that provider.</p><label>Provider base URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" autoComplete="url"/></label><div className="field-row"><label>Text model<input value={textModel} onChange={(event) => setTextModel(event.target.value)} placeholder="gpt-4o-mini"/></label><label>Image model<input value={imageModel} onChange={(event) => setImageModel(event.target.value)} placeholder="gpt-image-1"/></label></div><label>API key<input type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); setClearKey(false); }} placeholder={configured ? 'Saved securely · enter only to replace' : 'Provider API key'} autoComplete="new-password"/></label>{configured&&<label className="setting-check"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)}/>Remove the saved API key</label>}<small>{configured&&!clearKey?'API key configured':'API key is never saved in the project or browser storage'}</small></div>}{message&&<div className="provider-message"><AlertCircle size={14}/><span>{message}</span></div>}<div className="modal-actions"><button onClick={onClose}>Close</button><button className="assistant-generate" disabled={busy} onClick={()=>void save()}>{busy?<LoaderCircle size={14}/>:<Save size={14}/>}Save settings</button></div></section></div>;
}
