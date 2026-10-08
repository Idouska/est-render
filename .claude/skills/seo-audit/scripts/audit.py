#!/usr/bin/env python3
"""
SEO Audit Helper Script

Fetches a URL and extracts raw SEO signal data as JSON.
Designed to be called as a black box — run with --help first.

Usage:
  python audit.py --url https://example.com
  python audit.py --url https://example.com --headers
  python audit.py --url https://example.com --rendered
  python audit.py --url https://example.com --check-crawlability
  python audit.py --url https://example.com --output /tmp/signals.json
"""

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser


# ---------------------------------------------------------------------------
# HTML Parser
# ---------------------------------------------------------------------------

class SEOParser(HTMLParser):
    """Extracts SEO-relevant elements from raw HTML."""

    def __init__(self):
        super().__init__()
        self.title = None
        self._in_title = False
        self.meta = []          # list of {name/property/http-equiv, content}
        self.links = []         # list of {rel, href, hreflang}
        self.headings = []      # list of {level, text}
        self.images = []        # list of {src, alt, width, height, loading}
        self.anchors = []       # list of {href, text, rel}
        self.scripts = []       # list of {src, type, defer, async_}
        self.json_ld = []       # list of parsed JSON-LD dicts
        self.canonical = None
        self.lang = None
        self.viewport = None
        self.robots_meta = None
        self._current_heading_level = None
        self._current_heading_text = []
        self._in_script_jsonld = False
        self._script_buffer = []

    # ------------------------------------------------------------------
    # Handlers
    # ------------------------------------------------------------------

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)

        if tag == "html":
            self.lang = attrs.get("lang")

        elif tag == "title":
            self._in_title = True

        elif tag == "meta":
            name = (attrs.get("name") or "").lower()
            prop = (attrs.get("property") or "").lower()
            http_equiv = (attrs.get("http-equiv") or "").lower()
            content = attrs.get("content", "")
            charset = attrs.get("charset")

            record = {}
            if name:
                record["name"] = name
            if prop:
                record["property"] = prop
            if http_equiv:
                record["http-equiv"] = http_equiv
            if content:
                record["content"] = content
            if charset:
                record["charset"] = charset
            if record:
                self.meta.append(record)

            if name == "robots":
                self.robots_meta = content
            elif name == "viewport":
                self.viewport = content

        elif tag == "link":
            rel = (attrs.get("rel") or "").lower()
            href = attrs.get("href", "")
            hreflang = attrs.get("hreflang")
            record = {"rel": rel, "href": href}
            if hreflang:
                record["hreflang"] = hreflang
            self.links.append(record)
            if rel == "canonical":
                self.canonical = href

        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._current_heading_level = int(tag[1])
            self._current_heading_text = []

        elif tag == "img":
            self.images.append({
                "src": attrs.get("src", ""),
                "alt": attrs.get("alt"),        # None means attribute absent
                "width": attrs.get("width"),
                "height": attrs.get("height"),
                "loading": attrs.get("loading"),
            })

        elif tag == "a":
            self.anchors.append({
                "href": attrs.get("href", ""),
                "rel": attrs.get("rel", ""),
                "text": "",          # filled in handle_data
                "_collecting": True,
            })

        elif tag == "script":
            script_type = (attrs.get("type") or "").lower()
            if script_type == "application/ld+json":
                self._in_script_jsonld = True
                self._script_buffer = []
            else:
                self.scripts.append({
                    "src": attrs.get("src"),
                    "type": script_type or "text/javascript",
                    "defer": "defer" in attrs,
                    "async": "async" in attrs,
                })

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            if self._current_heading_level is not None:
                self.headings.append({
                    "level": self._current_heading_level,
                    "text": " ".join(self._current_heading_text).strip(),
                })
                self._current_heading_level = None
                self._current_heading_text = []

        elif tag == "a":
            # finalize last anchor's text
            for anchor in reversed(self.anchors):
                if anchor.get("_collecting"):
                    anchor["_collecting"] = False
                    break

        elif tag == "script":
            if self._in_script_jsonld:
                raw = "".join(self._script_buffer).strip()
                try:
                    parsed = json.loads(raw)
                    if isinstance(parsed, list):
                        self.json_ld.extend(parsed)
                    else:
                        self.json_ld.append(parsed)
                except json.JSONDecodeError:
                    pass
                self._in_script_jsonld = False
                self._script_buffer = []

    def handle_data(self, data):
        if self._in_title and self.title is None:
            self.title = data.strip()

        if self._current_heading_level is not None:
            self._current_heading_text.append(data.strip())

        if self._in_script_jsonld:
            self._script_buffer.append(data)

        # append text to last open anchor
        for anchor in reversed(self.anchors):
            if anchor.get("_collecting"):
                anchor["text"] = (anchor["text"] + " " + data).strip()
                break


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------

def fetch_url(url: str, timeout: int = 15) -> tuple[str, dict, int]:
    """Fetch URL, return (html_body, response_headers, status_code)."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (compatible; SEOAuditBot/1.0; "
                "+https://github.com/anthropics/skills)"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", errors="replace")
            headers = dict(response.headers)
            status = response.status
        return body, headers, status
    except urllib.error.HTTPError as e:
        return "", dict(e.headers), e.code
    except Exception as e:
        print(f"Error fetching {url}: {e}", file=sys.stderr)
        sys.exit(1)


def fetch_rendered(url: str) -> str:
    """Fetch JavaScript-rendered HTML using Playwright (must be installed)."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "Playwright not installed. Run: pip install playwright && playwright install chromium",
            file=sys.stderr,
        )
        sys.exit(1)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        page.wait_for_load_state("networkidle")
        html = page.content()
        browser.close()
    return html


# ---------------------------------------------------------------------------
# Robots.txt & Sitemap
# ---------------------------------------------------------------------------

def fetch_robots_txt(base_url: str) -> dict:
    parsed = urllib.parse.urlparse(base_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    try:
        body, _, status = fetch_url(robots_url)
    except SystemExit:
        return {"url": robots_url, "status": "error", "content": None, "sitemaps": []}

    sitemaps = re.findall(r"(?im)^Sitemap:\s*(.+)$", body)
    disallow = re.findall(r"(?im)^Disallow:\s*(.+)$", body)
    return {
        "url": robots_url,
        "status": status,
        "content": body if status == 200 else None,
        "sitemaps": [s.strip() for s in sitemaps],
        "disallow_rules": [d.strip() for d in disallow],
    }


def check_sitemap(base_url: str, sitemap_url: str | None = None) -> dict:
    parsed = urllib.parse.urlparse(base_url)
    if not sitemap_url:
        sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    try:
        body, _, status = fetch_url(sitemap_url)
    except SystemExit:
        return {"url": sitemap_url, "status": "error", "url_count": 0}

    url_count = len(re.findall(r"<loc>", body))
    return {
        "url": sitemap_url,
        "status": status,
        "url_count": url_count,
        "has_lastmod": bool(re.search(r"<lastmod>", body)),
    }


# ---------------------------------------------------------------------------
# Signal extraction
# ---------------------------------------------------------------------------

def extract_signals(url: str, html: str, headers: dict, status: int) -> dict:
    parser = SEOParser()
    parser.feed(html)

    # Meta helpers
    def get_meta_content(name_or_prop: str) -> str | None:
        for m in parser.meta:
            if m.get("name", "").lower() == name_or_prop.lower():
                return m.get("content")
            if m.get("property", "").lower() == name_or_prop.lower():
                return m.get("content")
        return None

    title = parser.title or ""
    description = get_meta_content("description") or ""
    og_title = get_meta_content("og:title")
    og_description = get_meta_content("og:description")
    og_image = get_meta_content("og:image")
    og_url = get_meta_content("og:url")
    og_type = get_meta_content("og:type")
    twitter_card = get_meta_content("twitter:card")
    twitter_title = get_meta_content("twitter:title")
    twitter_description = get_meta_content("twitter:description")
    twitter_image = get_meta_content("twitter:image")

    # Headings analysis
    h1_list = [h["text"] for h in parser.headings if h["level"] == 1]
    heading_levels = [h["level"] for h in parser.headings]

    # Images analysis
    images_missing_alt = [img for img in parser.images if img["alt"] is None]
    images_empty_alt = [img for img in parser.images if img["alt"] == ""]
    images_missing_dimensions = [
        img for img in parser.images
        if not img.get("width") or not img.get("height")
    ]

    # Render-blocking scripts (in <head> without defer/async)
    render_blocking = [
        s for s in parser.scripts
        if s["src"] and not s["defer"] and not s["async"]
    ]

    # HTTP headers
    x_robots = headers.get("X-Robots-Tag") or headers.get("x-robots-tag")
    content_type = headers.get("Content-Type") or headers.get("content-type", "")
    canonical_header = headers.get("Link") or headers.get("link")

    return {
        "url": url,
        "http_status": status,
        "content_type": content_type,
        "title": {
            "value": title,
            "length": len(title),
            "present": bool(title),
        },
        "meta_description": {
            "value": description,
            "length": len(description),
            "present": bool(description),
        },
        "canonical": {
            "value": parser.canonical,
            "present": bool(parser.canonical),
        },
        "lang": parser.lang,
        "viewport": {
            "value": parser.viewport,
            "present": bool(parser.viewport),
        },
        "robots_meta": {
            "value": parser.robots_meta,
            "present": parser.robots_meta is not None,
        },
        "x_robots_tag": x_robots,
        "headings": {
            "all": parser.headings,
            "h1_count": len(h1_list),
            "h1_texts": h1_list,
            "levels_sequence": heading_levels,
        },
        "images": {
            "total": len(parser.images),
            "missing_alt_count": len(images_missing_alt),
            "empty_alt_count": len(images_empty_alt),
            "missing_dimensions_count": len(images_missing_dimensions),
            "missing_alt_srcs": [i["src"] for i in images_missing_alt[:10]],
        },
        "open_graph": {
            "og:title": og_title,
            "og:description": og_description,
            "og:image": og_image,
            "og:url": og_url,
            "og:type": og_type,
        },
        "twitter_card": {
            "twitter:card": twitter_card,
            "twitter:title": twitter_title,
            "twitter:description": twitter_description,
            "twitter:image": twitter_image,
        },
        "json_ld": {
            "count": len(parser.json_ld),
            "schemas": [s.get("@type") for s in parser.json_ld if isinstance(s, dict)],
            "raw": parser.json_ld,
        },
        "links": {
            "total": len(parser.anchors),
            "internal": len([
                a for a in parser.anchors
                if a["href"] and not a["href"].startswith("http")
            ]),
            "external": len([
                a for a in parser.anchors
                if a["href"].startswith("http")
            ]),
            "nofollow_count": len([
                a for a in parser.anchors if "nofollow" in a.get("rel", "")
            ]),
        },
        "hreflang": [
            lnk for lnk in parser.links if lnk.get("hreflang")
        ],
        "render_blocking_scripts": {
            "count": len(render_blocking),
            "srcs": [s["src"] for s in render_blocking[:10]],
        },
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="Fetch a URL and extract SEO signals as JSON.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--url", required=True, help="Target URL to audit")
    p.add_argument(
        "--rendered",
        action="store_true",
        help="Fetch JavaScript-rendered HTML via Playwright (requires: pip install playwright && playwright install chromium)",
    )
    p.add_argument(
        "--headers",
        action="store_true",
        help="Include raw HTTP response headers in output",
    )
    p.add_argument(
        "--check-crawlability",
        action="store_true",
        dest="check_crawlability",
        help="Also fetch robots.txt and sitemap.xml and include in output",
    )
    p.add_argument(
        "--output",
        metavar="FILE",
        help="Write JSON output to FILE instead of stdout",
    )
    p.add_argument(
        "--indent",
        type=int,
        default=2,
        help="JSON indentation level (default: 2)",
    )
    return p


def main():
    parser = build_arg_parser()
    args = parser.parse_args()

    url = args.url
    if not url.startswith("http"):
        url = "https://" + url

    # Fetch HTML
    if args.rendered:
        html = fetch_rendered(url)
        response_headers = {}
        status = 200
    else:
        html, response_headers, status = fetch_url(url)

    # Extract signals
    signals = extract_signals(url, html, response_headers, status)

    if args.headers:
        signals["response_headers"] = response_headers

    if args.check_crawlability:
        robots = fetch_robots_txt(url)
        signals["robots_txt"] = robots
        sitemap_url = robots["sitemaps"][0] if robots["sitemaps"] else None
        signals["sitemap"] = check_sitemap(url, sitemap_url)

    # Output
    output = json.dumps(signals, indent=args.indent, ensure_ascii=False)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"SEO signals written to {args.output}", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()
