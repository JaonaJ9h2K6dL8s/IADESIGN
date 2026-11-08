import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCommonsSearchUrl, normalizeCommonsResults } from '../electron/commons-search';

test('Commons search separates content and logo searches while preserving the user query', () => {
  const logoSearch = buildCommonsSearchUrl('Nike', 'logo');
  const contentSearch = buildCommonsSearchUrl('Nike', 'content');
  assert.equal(logoSearch.searchParams.get('gsrsearch'), 'Nike logo');
  assert.equal(contentSearch.searchParams.get('gsrsearch'), 'Nike');
  assert.equal(logoSearch.searchParams.get('gsrlimit'), '30');
  assert.equal(logoSearch.searchParams.get('gsrnamespace'), '6');
});

test('Commons result normalization keeps attribution, license, trademark notice, and trusted media URLs', () => {
  const results = normalizeCommonsResults({ query: { pages: {
    101: { pageid: 101, title: 'File:Nike_logo.svg', imageinfo: [{
      url: 'https://upload.wikimedia.org/wikipedia/commons/nike.svg',
      thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/nike.png',
      descriptionurl: 'https://commons.wikimedia.org/wiki/File:Nike_logo.svg',
      mime: 'image/svg+xml',
      extmetadata: {
        LicenseShortName: { value: 'Public domain' },
        LicenseUrl: { value: 'https://creativecommons.org/publicdomain/zero/1.0/' },
        Artist: { value: '<a>Creator</a>' },
        Restrictions: { value: 'trademarked' },
      },
    }] },
    102: { pageid: 102, title: 'File:Unsafe.png', imageinfo: [{ url: 'http://127.0.0.1/secret.png', mime: 'image/png' }] },
    103: { pageid: 103, title: 'File:Not an image', imageinfo: [{ url: 'https://upload.wikimedia.org/wikipedia/commons/doc.pdf', mime: 'application/pdf' }] },
  } } });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'Nike_logo.svg');
  assert.equal(results[0].license, 'Public domain');
  assert.equal(results[0].creator, 'Creator');
  assert.equal(results[0].trademarked, true);
  assert.equal(results[0].thumbnailUrl, 'https://thumb.wikimedia.org/wikipedia/commons/nike.png');
  assert.equal(results[0].sourceUrl, 'https://commons.wikimedia.org/wiki/File:Nike_logo.svg');
});
