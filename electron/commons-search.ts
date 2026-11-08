export type CommonsCategory = 'content' | 'logo';

export type CommonsImageResult = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  creator: string;
  trademarked: boolean;
};

type CommonsMetadata = Record<string, { value?: unknown } | undefined>;
type CommonsPage = { pageid?: unknown; title?: unknown; index?: number; imageinfo?: Array<{ url?: unknown; thumburl?: unknown; descriptionurl?: unknown; mime?: unknown; extmetadata?: CommonsMetadata }> };

function metadataValue(metadata: CommonsMetadata | undefined, key: string): string {
  const value = metadata?.[key]?.value;
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/gi, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim().slice(0, 600);
}

function validUrl(value: unknown, host: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === host;
  } catch {
    return false;
  }
}

export function buildCommonsSearchUrl(term: string, category: CommonsCategory): URL {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  url.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '30',
    gsrsearch: category === 'logo' ? `${term} logo` : term,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '420',
  }).toString();
  return url;
}

export function normalizeCommonsResults(payload: unknown): CommonsImageResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const query = (payload as { query?: { pages?: Record<string, CommonsPage> } }).query;
  const pages = query?.pages;
  if (!pages || typeof pages !== 'object') return [];
  return Object.values(pages).sort((first, second) => (first.index ?? Number.MAX_SAFE_INTEGER) - (second.index ?? Number.MAX_SAFE_INTEGER)).flatMap((page) => {
    const info = page.imageinfo?.[0];
    if (typeof page.pageid !== 'number' || typeof page.title !== 'string' || !info) return [];
    const mime = typeof info.mime === 'string' ? info.mime : '';
    if (!mime.startsWith('image/') || !validUrl(info.url, 'upload.wikimedia.org')) return [];
    const thumbnailUrl = validUrl(info.thumburl, 'thumb.wikimedia.org') || validUrl(info.thumburl, 'upload.wikimedia.org') ? info.thumburl : info.url;
    const sourceUrl = validUrl(info.descriptionurl, 'commons.wikimedia.org') ? info.descriptionurl : `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title).replace(/%3A/gi, ':').replace(/%20/g, '_')}`;
    const metadata = info.extmetadata;
    const restrictions = metadataValue(metadata, 'Restrictions');
    const license = metadataValue(metadata, 'LicenseShortName') || metadataValue(metadata, 'UsageTerms') || 'License details not provided';
    return [{
      id: String(page.pageid),
      title: page.title.replace(/^File:/, ''),
      description: metadataValue(metadata, 'ImageDescription') || metadataValue(metadata, 'ObjectName'),
      imageUrl: info.url,
      thumbnailUrl,
      sourceUrl,
      license,
      licenseUrl: metadataValue(metadata, 'LicenseUrl'),
      creator: metadataValue(metadata, 'Artist') || metadataValue(metadata, 'Credit'),
      trademarked: /trademark/i.test(restrictions),
    }];
  }).slice(0, 30);
}
