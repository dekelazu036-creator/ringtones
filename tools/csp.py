#!/usr/bin/env python3
"""Content-Security-Policy for every public page (D6, 2026-10-11).

Writes (or checks) a <meta http-equiv="Content-Security-Policy"> in each page. Inline scripts are
allowed only by their exact SHA-256 hash, so ANY change to an inline script needs a re-run:
    python3 tools/csp.py          # update the pages
    python3 tools/csp.py --check  # CI: fail if a page is missing or out of date
account.html and library.html keep their own stricter, hand-written policies (no Umami auto-track,
never Meta) and are not touched here.
"""
import base64, hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKIP = {'account.html', 'library.html'}
PROD = 'https://gtjtvfogqrnuiducvoqm.supabase.co'
STAGING = 'https://kavomvsvufqnqjepbevs.supabase.co'   # localhost tests only (config.js override)
UMAMI = 'https://cloud.umami.is https://api-gateway.umami.dev'
META = 'https://connect.facebook.net https://www.facebook.com'   # loaded only after consent, never with a session

INLINE = re.compile(r'<script(?![^>]*\bsrc=)(?![^>]*type="application/ld\+json")[^>]*>(.*?)</script>', re.S)
META_TAG = re.compile(r'\n?<meta http-equiv="Content-Security-Policy" content="[^"]*">')


def policy(html: str) -> str:
    hashes = sorted({"'sha256-%s'" % base64.b64encode(hashlib.sha256(m.encode()).digest()).decode()
                     for m in INLINE.findall(html)})
    return '; '.join([
        "default-src 'self'",
        "script-src 'self' " + ' '.join(hashes + ['https://cloud.umami.is', 'https://connect.facebook.net']),
        f"connect-src 'self' {PROD} {STAGING} {UMAMI} {META}",
        f"img-src 'self' data: blob: https://www.facebook.com",
        f"media-src 'self' blob: data: {PROD} {STAGING}",
        "font-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "worker-src 'self'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
    ])


def render(html: str) -> str:
    base = META_TAG.sub('', html)
    tag = '<meta http-equiv="Content-Security-Policy" content="%s">' % policy(base)
    # right after the viewport meta, so it applies before any script
    m = re.search(r'<meta name="viewport"[^>]*>', base)
    if not m:
        raise SystemExit('no viewport meta to anchor the policy')
    return base[:m.end()] + '\n' + tag + base[m.end():]


def pages():
    for p in sorted(list(ROOT.glob('*.html')) + list(ROOT.glob('sound/*.html'))):
        if p.name in SKIP and p.parent == ROOT:
            continue
        if '<script' in p.read_text(encoding='utf-8'):
            yield p


def main():
    check = '--check' in sys.argv
    stale = []
    for p in pages():
        old = p.read_text(encoding='utf-8')
        new = render(old)
        if new != old:
            stale.append(p.relative_to(ROOT))
            if not check:
                p.write_text(new, encoding='utf-8')
    if check and stale:
        print('CSP out of date (run python3 tools/csp.py):', *stale, sep='\n  ')
        sys.exit(1)
    print(('checked' if check else 'updated') + f': {len(list(pages()))} pages' + ('' if check else f', {len(stale)} changed'))


if __name__ == '__main__':
    main()
