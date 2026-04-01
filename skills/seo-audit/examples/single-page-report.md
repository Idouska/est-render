# SEO Audit Report — Example Corp Homepage
**Date:** 2026-04-01  
**URL:** https://example.com  
**Score:** 72/100 — Needs Work

---

## Summary
The homepage has a solid foundation with a proper title tag and canonical URL, but is missing a meta description, has two `<h1>` tags, and lacks structured data entirely. Open Graph and Twitter Card tags are incomplete. Addressing the critical issues will likely produce measurable improvements in click-through rate and crawl efficiency.

---

## Critical Issues ❌

### Title Tag (8/10 — −2)
- **Title is 78 characters**, exceeding the recommended 60-character limit. Search engines will truncate it in SERPs.  
  Current: `"Example Corp — The World's Leading Provider of Example Services"`  
  Suggested: `"Example Corp — Leading Example Services"` (40 chars)

### Heading Structure (3/8 — −5)
- **Two `<h1>` tags found** on the page. Only one is permitted.  
  - `<h1>Welcome to Example Corp</h1>`  
  - `<h1>Our Services</h1>` ← should be `<h2>`
- **Heading hierarchy skips from h2 to h4** in the "About" section (no h3 present).

### Meta Description (0/8 — −8)
- **No `<meta name="description">` tag found.** Search engines will generate a snippet automatically, which is often suboptimal.  
  Suggested: `"Example Corp helps businesses achieve [X]. Explore our [service] solutions and get started today."` (≤ 160 chars)

### Structured Data (0/10 — −10)
- **No JSON-LD blocks found.** For a business homepage, at minimum add:
  ```json
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Example Corp",
    "url": "https://example.com",
    "logo": "https://example.com/logo.png",
    "sameAs": ["https://twitter.com/example", "https://linkedin.com/company/example"]
  }
  ```

---

## Warnings ⚠️

### Open Graph & Social (5/8 — −3)
- `og:title`, `og:url`, `og:type` are present ✅  
- **`og:image` is missing** — social shares will display no image  
- **`twitter:card` is missing** — Twitter will not render a rich card  
- **`og:description` is missing**

### Images (5/8 — −3)
- 3 of 12 images are **missing `alt` attributes**:
  - `/images/hero-banner.jpg`
  - `/images/team-photo.png`
  - `/images/partner-logo.svg`
- 5 images are **missing `width`/`height` attributes**, risking Cumulative Layout Shift (CLS).

### Page Speed Signals (7/10 — −3)
- **4 render-blocking `<script>` tags** in `<head>` without `defer` or `async`:
  - `https://cdn.example.com/analytics.js`
  - `https://cdn.example.com/chat-widget.js`
  - `https://cdn.example.com/ab-test.js`
  - `https://cdn.example.com/pixel.js`  
  Add `defer` to each unless execution order before DOM parse is required.

### robots.txt (4/5 — −1)
- robots.txt exists and is well-formed ✅  
- **No `Sitemap:` directive** found in robots.txt — add `Sitemap: https://example.com/sitemap.xml`

---

## Passing ✅

- **Title tag present** with primary keyword near the start
- **Canonical URL** correctly self-references `https://example.com`
- **`<html lang="en">`** present
- **Viewport meta tag** present: `width=device-width, initial-scale=1`
- **robots.txt** accessible at `/robots.txt`, no important paths blocked
- **XML sitemap** found at `/sitemap.xml` with 42 URLs and `<lastmod>` dates
- **No `noindex` meta** on this page
- **Canonical and indexability** fully clean
- **URL structure** is clean: lowercase, no parameters, depth = 1

---

## Recommendations (Prioritized)

### Priority 1 — High Impact, Easy Fix
1. **Add meta description** — copy-paste ready:  
   `<meta name="description" content="Example Corp helps businesses [X]. Explore our [service] solutions and get started today.">`
2. **Fix duplicate `<h1>`** — change `<h1>Our Services</h1>` to `<h2>Our Services</h2>`
3. **Add `og:image` and `og:description`** to improve social sharing CTR
4. **Add `twitter:card` meta tag**: `<meta name="twitter:card" content="summary_large_image">`

### Priority 2 — High Impact, More Effort
5. **Add Organization JSON-LD block** (see template above in Critical Issues)
6. **Shorten title tag** to under 60 characters
7. **Add `defer` to 4 render-blocking scripts** in `<head>`
8. **Fix 3 images missing `alt` text** — describe the image content, not the filename

### Priority 3 — Low Impact / Nice to Have
9. **Add `width`/`height` to 5 images** to prevent CLS
10. **Fix h2→h4 heading skip** in the About section (add an h3 level)
11. **Add `Sitemap:` directive** to robots.txt

---

## Raw Signal Data

```json
{
  "url": "https://example.com",
  "http_status": 200,
  "title": { "value": "Example Corp — The World's Leading Provider of Example Services", "length": 64, "present": true },
  "meta_description": { "value": "", "length": 0, "present": false },
  "canonical": { "value": "https://example.com", "present": true },
  "lang": "en",
  "viewport": { "value": "width=device-width, initial-scale=1", "present": true },
  "headings": { "h1_count": 2, "h1_texts": ["Welcome to Example Corp", "Our Services"], "levels_sequence": [1, 2, 2, 4, 1, 2] },
  "images": { "total": 12, "missing_alt_count": 3, "empty_alt_count": 0, "missing_dimensions_count": 5 },
  "open_graph": { "og:title": "Example Corp", "og:description": null, "og:image": null, "og:url": "https://example.com", "og:type": "website" },
  "twitter_card": { "twitter:card": null, "twitter:title": null, "twitter:description": null, "twitter:image": null },
  "json_ld": { "count": 0, "schemas": [] },
  "robots_txt": { "status": 200, "sitemaps": [], "disallow_rules": [] },
  "sitemap": { "status": 200, "url_count": 42, "has_lastmod": true },
  "render_blocking_scripts": { "count": 4 }
}
```
