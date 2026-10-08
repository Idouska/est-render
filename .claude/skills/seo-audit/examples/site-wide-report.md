# SEO Audit Report — Example Corp (Site-Wide)
**Date:** 2026-04-01  
**Pages Audited:** 8 (homepage, 3 product pages, 2 blog posts, /about, /contact)  
**Overall Score:** 65/100 — Needs Work

---

## Summary
The site has a working canonical and robots/sitemap setup, but suffers from **duplicate title tags across product pages**, **missing meta descriptions on 6 of 8 pages**, and **no structured data anywhere**. Blog posts are particularly thin on SEO signals. Fixing the duplicate titles and adding meta descriptions site-wide will have the highest ROI.

---

## Site-Wide Patterns

### Duplicate Title Tags ❌
The three product pages share the same title:  
`"Example Corp Products"` — each should have a unique, product-specific title.

| URL | Title |
|-----|-------|
| /products/widget-a | "Example Corp Products" |
| /products/widget-b | "Example Corp Products" |
| /products/widget-c | "Example Corp Products" |

**Fix:** Use product names in titles, e.g. `"Widget A — Example Corp"`.

### Meta Descriptions Missing ❌
6 of 8 pages have no meta description. Only the homepage and /about have one.

### No Structured Data Anywhere ❌
Zero JSON-LD blocks across all audited pages. Recommended schemas by page type:

| Page Type | Recommended Schema |
|-----------|-------------------|
| Homepage | `Organization`, `WebSite` with `SearchAction` |
| Product pages | `Product` with `Offer` and `AggregateRating` |
| Blog posts | `Article` with `author`, `datePublished`, `image` |
| Contact page | `ContactPage` or `LocalBusiness` |

### Open Graph Incomplete ⚠️
`og:image` is missing on all 8 pages.

---

## Page-by-Page Summary

| Page | Title | Meta Desc | H1 | Canonical | OG Image | JSON-LD | Score |
|------|-------|-----------|-----|-----------|----------|---------|-------|
| / (homepage) | ✅ | ✅ | ✅ 1x | ✅ | ❌ | ❌ | 72 |
| /products/widget-a | ⚠️ dup | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 55 |
| /products/widget-b | ⚠️ dup | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 55 |
| /products/widget-c | ⚠️ dup | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 55 |
| /blog/post-1 | ✅ | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 60 |
| /blog/post-2 | ✅ | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 60 |
| /about | ✅ | ✅ | ✅ 1x | ✅ | ❌ | ❌ | 75 |
| /contact | ✅ | ❌ | ✅ 1x | ✅ | ❌ | ❌ | 63 |

---

## Recommendations (Prioritized)

### Priority 1 — High Impact, Easy Fix
1. **Write unique meta descriptions** for all 6 pages missing them (120–160 chars each)
2. **Fix duplicate product page titles** — use `"[Product Name] — Example Corp"` pattern

### Priority 2 — High Impact, More Effort
3. **Add `og:image`** to all pages (1200×630px recommended)
4. **Add JSON-LD** to all page types — start with `Organization` on homepage and `Product` on product pages
5. **Add `Article` schema** to both blog posts with `author` and `datePublished`

### Priority 3 — Low Impact / Nice to Have
6. **Add `WebSite` schema with `SearchAction`** to homepage to enable sitelinks search box in Google
7. **Add `BreadcrumbList` schema** to product and blog pages for rich breadcrumb display
