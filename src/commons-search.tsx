import { useState } from 'react';
import { AlertCircle, ExternalLink, ImagePlus, LoaderCircle, Search } from 'lucide-react';
import { importCommonsImage, searchCommons, type CommonsCategory, type CommonsImageResult } from './api';

type ImportedAsset = { id: string; src: string; sourceName: string; sourceUrl?: string; width: number; height: number };
type Props = { projectId: string; lang: 'fr' | 'en'; onImported: (asset: ImportedAsset) => void };

export function CommonsSearch({ projectId, lang, onImported }: Props) {
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<CommonsCategory>('content');
  const [results, setResults] = useState<CommonsImageResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const french = lang === 'fr';

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (term.trim().length < 2) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await searchCommons(term.trim(), category);
      setResults(response.items);
      if (!response.items.length) setMessage(french ? 'Aucun résultat pour cette recherche.' : 'No results were found for this search.');
    } catch (error) {
      setResults([]);
      setMessage(error instanceof Error ? error.message : french ? 'La recherche a échoué.' : 'Search failed.');
    } finally {
      setBusy(false);
    }
  };

  const importImage = async (image: CommonsImageResult) => {
    setBusy(true);
    setMessage('');
    try {
      const asset = await importCommonsImage({ projectId, imageId: image.id });
      onImported(asset);
      setMessage(french ? 'Image importée avec ses informations de licence et sa source.' : 'Image imported with its license details and source.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : french ? 'L’importation a échoué.' : 'Image import failed.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="commons-search" aria-label={french ? 'Recherche de contenu et de logos' : 'Content and logo search'}>
    <div className="commons-heading"><div><h3><Search size={14}/>{french ? 'Contenu et logos' : 'Content & logos'}</h3><p>{french ? 'Exemples réutilisables de Wikimedia Commons' : 'Reusable examples from Wikimedia Commons'}</p></div></div>
    <form className="commons-form" onSubmit={(event) => void search(event)}>
      <input aria-label={french ? 'Rechercher des images' : 'Search images'} value={term} onChange={(event) => setTerm(event.target.value)} placeholder={french ? 'Ex. Nike, logo Nike…' : 'e.g. Nike, Nike logo…'}/>
      <button aria-label={french ? 'Rechercher' : 'Search'} disabled={busy || term.trim().length < 2}><Search size={14}/></button>
    </form>
    <div className="commons-categories" role="group" aria-label={french ? 'Type de résultat' : 'Result type'}>
      <button type="button" className={category === 'content' ? 'active' : ''} aria-pressed={category === 'content'} onClick={() => { setCategory('content'); setResults([]); }}>{french ? 'Contenu' : 'Content'}</button>
      <button type="button" className={category === 'logo' ? 'active' : ''} aria-pressed={category === 'logo'} onClick={() => { setCategory('logo'); setResults([]); }}>{french ? 'Logos' : 'Logos'}</button>
    </div>
    {results.length > 0 && <div className="commons-results" aria-live="polite">{results.map((image) => <article key={image.id}>
      <img src={image.thumbnailUrl} alt={image.description || image.title} loading="lazy" referrerPolicy="no-referrer"/>
      <div className="commons-result-body"><b title={image.title}>{image.title}</b><small>{image.license}{image.creator ? ` · ${image.creator}` : ''}</small>{image.trademarked && <small className="commons-trademark">{french ? 'Marque déposée — vérifier les droits avant usage' : 'Trademark — verify rights before use'}</small>}
        <div><a href={image.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={11}/>{french ? 'Source' : 'Source'}</a><button type="button" disabled={busy} onClick={() => void importImage(image)}><ImagePlus size={11}/>{french ? 'Importer' : 'Import'}</button></div>
      </div>
    </article>)}</div>}
    {busy && <div className="commons-status"><LoaderCircle size={13}/>{french ? 'Recherche ou importation…' : 'Searching or importing…'}</div>}
    {message && <div className="commons-status" role="status"><AlertCircle size={13}/>{message}</div>}
    <p className="commons-notice">{french ? 'Les licences sont affichées pour vérification, mais ne garantissent pas le droit d’usage commercial. Les marques peuvent nécessiter une autorisation distincte.' : 'Licenses are shown for review but do not guarantee commercial-use rights. Trademarks may require separate permission.'}</p>
  </section>;
}
