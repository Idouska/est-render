---
name: seo-audit
description: Audits web pages or a local web project for SEO issues. Checks meta tags, heading structure, canonical URLs, robots.txt, sitemap, Open Graph, structured data, image alt text, link health, and more. Produces a scored report with prioritized recommendations. Use this skill when asked to audit, analyze, or improve SEO for a URL or local project.
license: Apache-2.0
---

# SEO Audit

Perform a comprehensive SEO audit of a URL or local web project. Produce a structured report with a score, categorized findings, and prioritized recommendations.

**Helper Scripts Available**:
- `scripts/audit.py` — Fetches and parses a page, outputs raw SEO signal data as JSON

**Always run scripts with `--help` first** before reading the source. The script is designed to be called as a black box.

---

## Decision Tree: Choosing Your Approach

```
Audit target → Is it a live URL?
 ├─ Yes → Use scripts/audit.py or WebFetch to retrieve the page
 │ └─ Then analyze the returned signals
 │
 └─ No (local project) → Is there a dev server?
   ├─ Yes → Start it and point audit.py at localhost
   └─ No → Read HTML/template files directly from disk
     └─ Identify SEO elements from source
```

---

## Audit Checklist

Work through **all** of the following categories. Record pass ✅, warning ⚠️, or fail ❌ for each item.

### 1. Title Tag
- [ ] Present and non-empty
- [ ] Length: 30–60 characters (warn if outside range)
- [ ] Unique per page (flag duplicates if auditing multiple pages)
- [ ] Contains primary keyword near the front

### 2. Meta Description
- [ ] Present and non-empty
- [ ] Length: 120–160 characters
- [ ] Unique per page
- [ ] Compelling, includes a call-to-action or keyword

### 3. Heading Structure
- [ ] Exactly one `<h1>` per page
- [ ] `<h1>` content aligns with title tag
- [ ] Headings follow a logical hierarchy (h1 → h2 → h3, no skips)
- [ ] No heading used purely for styling (semantic use only)

### 4. Canonical & Indexability
- [ ] `<link rel="canonical">` present and self-referencing (or correct cross-domain)
- [ ] `<meta name="robots">` does not block indexing unintentionally
- [ ] `X-Robots-Tag` HTTP header not blocking indexing
- [ ] No `noindex` on pages that should be indexed

### 5. robots.txt
- [ ] File exists at `/robots.txt`
- [ ] Does not accidentally disallow important paths
- [ ] References sitemap URL

### 6. Sitemap
- [ ] XML sitemap exists (check `/sitemap.xml` or robots.txt `Sitemap:` directive)
- [ ] All important URLs included
- [ ] No URLs with `noindex` or redirect status in sitemap
- [ ] `<lastmod>` dates are present and accurate

### 7. Open Graph & Social Tags
- [ ] `og:title` present
- [ ] `og:description` present
- [ ] `og:image` present and absolute URL
- [ ] `og:url` present and canonical
- [ ] `og:type` set appropriately (website, article, etc.)
- [ ] Twitter Card meta tags present (`twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`)

### 8. Structured Data (Schema.org / JSON-LD)
- [ ] At least one JSON-LD block present for key page types
- [ ] Schema type is appropriate for page content (Article, Product, FAQPage, BreadcrumbList, etc.)
- [ ] No validation errors (check required fields per schema type)
- [ ] `@context` is `https://schema.org`

### 9. Images
- [ ] All `<img>` elements have non-empty `alt` attributes
- [ ] `alt` text is descriptive (not just filename or "image")
- [ ] Images use modern formats (WebP / AVIF preferred over JPEG/PNG for large images)
- [ ] `width` and `height` attributes present to prevent layout shift (CLS)
- [ ] Large images have `loading="lazy"` (except above-the-fold)

### 10. Links
- [ ] No broken internal links (4xx/5xx responses)
- [ ] External links to low-authority or toxic domains are `rel="nofollow"` or `rel="noopener noreferrer"`
- [ ] Anchor text is descriptive (no bare "click here" or "read more" without context)
- [ ] Internal linking connects related content logically

### 11. Page Speed & Core Web Vitals Signals
- [ ] Page weight is reasonable (< 1 MB HTML+CSS+JS uncompressed for initial load)
- [ ] No render-blocking resources in `<head>` without `defer`/`async`
- [ ] CSS is minified / external stylesheets used
- [ ] Viewport meta tag present: `<meta name="viewport" content="width=device-width, initial-scale=1">`
- [ ] `<html lang="...">` attribute set correctly

### 12. URL Structure
- [ ] URLs are lowercase, hyphen-separated, human-readable
- [ ] No excessive URL parameters that create duplicate content
- [ ] No session IDs in URLs
- [ ] URL depth ≤ 4 levels from root for important pages

### 13. Hreflang (if multilingual)
- [ ] `hreflang` attributes present for each language/region variant
- [ ] Each hreflang page links back to all variants (bidirectional)
- [ ] `x-default` variant specified

---

## Scoring

Assign a score out of 100:

| Category | Max Points |
|---|---|
| Title Tag | 10 |
| Meta Description | 8 |
| Heading Structure | 8 |
| Canonical & Indexability | 10 |
| robots.txt | 5 |
| Sitemap | 5 |
| Open Graph & Social | 8 |
| Structured Data | 10 |
| Images | 8 |
| Links | 8 |
| Page Speed Signals | 10 |
| URL Structure | 6 |
| Hreflang | 4 |

Deduct points proportionally for each ❌ or ⚠️ within a category.

**Score bands:**
- 90–100 → Excellent
- 75–89 → Good (minor improvements recommended)
- 50–74 → Needs Work (several issues to address)
- < 50 → Poor (significant SEO problems)

---

## Report Format

Output the audit as a structured markdown report:

```
# SEO Audit Report — [Page Title or URL]
**Date:** YYYY-MM-DD
**Score:** XX/100 — [Band]

---

## Summary
[2–3 sentence overview of the page's SEO health]

---

## Critical Issues ❌
[List only items that scored fail — highest impact first]

## Warnings ⚠️
[List items that scored warning]

## Passing ✅
[Brief list of what is already good]

---

## Recommendations (Prioritized)
### Priority 1 — High Impact, Easy Fix
1. [Specific actionable fix]

### Priority 2 — High Impact, More Effort
1. [Specific actionable fix]

### Priority 3 — Low Impact / Nice to Have
1. [Specific actionable fix]

---

## Raw Signal Data
[Optional: paste JSON output from audit.py or key extracted values]
```

---

## Using the Helper Script

```bash
# Audit a live URL
python skills/seo-audit/scripts/audit.py --url https://example.com

# Audit with HTTP headers output (checks X-Robots-Tag, canonical header)
python skills/seo-audit/scripts/audit.py --url https://example.com --headers

# Audit and save JSON output for further processing
python skills/seo-audit/scripts/audit.py --url https://example.com --output /tmp/seo_signals.json

# Check robots.txt and sitemap separately
python skills/seo-audit/scripts/audit.py --url https://example.com --check-crawlability
```

---

## Common Pitfalls

❌ **Don't** assume a missing `<meta name="robots">` means the page is blocked — absence means "index, follow" by default  
❌ **Don't** flag canonical tags as errors when they intentionally point to a different URL (consolidating duplicates is valid)  
❌ **Don't** report every external link as needing `nofollow` — only spammy/paid/untrusted links require it  
✅ **Do** check both `<head>` meta tags AND HTTP response headers for robots directives  
✅ **Do** validate JSON-LD against the actual Schema.org spec for the type used  
✅ **Do** distinguish between soft 404s (200 response with "not found" content) and real 404s  

---

## Best Practices

- Always fetch the **rendered** HTML (post-JavaScript) when auditing SPAs — use `audit.py` with `--rendered` flag or Playwright
- When auditing multiple pages, report **site-wide patterns** separately from page-specific issues
- Prioritize issues by their likely impact on rankings and crawlability, not just their presence on a checklist
- Provide **specific, copy-paste-ready fixes** in recommendations (e.g., exact meta tag content to use), not just vague guidance
- Cross-reference findings: a missing sitemap combined with a shallow crawl budget compounds the issue

---

## Reference Files

- **examples/single-page-report.md** — Sample audit output for a single page
- **examples/site-wide-report.md** — Sample audit output for a multi-page site audit
- **scripts/audit.py** — Fetch and parse SEO signals from a URL
