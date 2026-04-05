"""MCP server for web crawling — 5 tools over stdio transport."""

import setproctitle; setproctitle.setproctitle("aos-crawler")

import asyncio
import json
import re
from typing import Optional

import httpx
from mcp.server.fastmcp import FastMCP
from schemas import SchemaStore

# Patterns for sites that need special handling (login walls, anti-bot)
_TWITTER_RE = re.compile(r'https?://(?:x\.com|twitter\.com)/(\w+)/status/(\d+)')


async def _fetch_tweet(url: str) -> dict | None:
    """Extract tweet via FxTwitter API (free, no auth, full text + metadata)."""
    m = _TWITTER_RE.match(url)
    if not m:
        return None
    user, tweet_id = m.groups()
    async with httpx.AsyncClient(timeout=15, headers={"User-Agent": "AOS-Crawler/1.0"}) as client:
        resp = await client.get(f"https://api.fxtwitter.com/{user}/status/{tweet_id}")
        if resp.status_code != 200:
            return None
        data = resp.json()
    tweet = data.get("tweet", {})
    author = tweet.get("author", {})
    content = tweet.get("text", "")

    # Build markdown output
    md_lines = [
        f"# {author.get('name', '')} (@{author.get('screen_name', '')})",
        f"",
        f"*{tweet.get('created_at', '')}*",
        f"",
        content,
        f"",
        f"---",
        f"Likes: {tweet.get('likes', 0):,} | "
        f"Retweets: {tweet.get('retweets', 0):,} | "
        f"Views: {tweet.get('views', 0):,} | "
        f"Bookmarks: {tweet.get('bookmarks', 0):,}",
    ]

    # Include media if present
    media = tweet.get("media", {})
    if media and media.get("all"):
        md_lines.append("")
        for item in media["all"]:
            if item.get("type") == "photo":
                md_lines.append(f"![image]({item.get('url', '')})")
            elif item.get("type") == "video":
                md_lines.append(f"[Video]({item.get('url', '')})")

    return {
        "url": tweet.get("url", url),
        "status": 200,
        "content": "\n".join(md_lines),
        "metadata": {
            "title": f"{author.get('name', '')} on X",
            "author": author.get("name", ""),
            "author_handle": author.get("screen_name", ""),
            "likes": tweet.get("likes", 0),
            "retweets": tweet.get("retweets", 0),
            "views": tweet.get("views", 0),
            "bookmarks": tweet.get("bookmarks", 0),
            "is_note_tweet": tweet.get("is_note_tweet", False),
            "created_at": tweet.get("created_at", ""),
        },
    }

mcp = FastMCP("aos-crawler", log_level="WARNING")
schema_store = SchemaStore()

# Lazy-init crawler to avoid Playwright startup cost on import
_crawler = None
_browser_config = None


async def _get_crawler():
    """Get or create the shared AsyncWebCrawler instance."""
    global _crawler, _browser_config
    if _crawler is None:
        from crawl4ai import AsyncWebCrawler, BrowserConfig
        _browser_config = BrowserConfig(headless=True, verbose=False)
        _crawler = AsyncWebCrawler(config=_browser_config)
        await _crawler.start()
    return _crawler


@mcp.tool()
async def crawl_page(url: str, format: str = "markdown") -> str:
    """Crawl a single web page and return clean content.

    Handles special sites automatically (X/Twitter via API, etc.).

    Args:
        url: The URL to crawl
        format: Output format — "markdown" (default) or "html"
    """
    # Special-case: X/Twitter (login wall blocks normal crawling)
    tweet_result = await _fetch_tweet(url)
    if tweet_result is not None:
        return json.dumps(tweet_result, ensure_ascii=False)

    from crawl4ai import CrawlerRunConfig

    crawler = await _get_crawler()
    config = CrawlerRunConfig(word_count_threshold=10)
    result = await crawler.arun(url, config=config)

    if not result.success:
        return json.dumps({"error": f"Failed to crawl {url}", "status": result.status_code})

    output = {
        "url": result.url,
        "status": result.status_code,
    }

    if format == "html":
        output["content"] = result.html or ""
    else:
        output["content"] = result.markdown.raw_markdown if result.markdown else ""

    if result.metadata:
        output["metadata"] = result.metadata

    if result.links:
        output["links"] = {
            "internal": len(result.links.get("internal", [])),
            "external": len(result.links.get("external", [])),
        }

    return json.dumps(output, ensure_ascii=False)


@mcp.tool()
async def crawl_extract(url: str, schema_name: str) -> str:
    """Crawl a page and extract structured data using a named schema.

    Args:
        url: The URL to crawl
        schema_name: Name of a saved extraction schema (see schema_list)
    """
    from crawl4ai import CrawlerRunConfig
    from crawl4ai.extraction_strategy import JsonCssExtractionStrategy

    schema_def = schema_store.get(schema_name)
    if schema_def is None:
        return json.dumps({"error": f"Schema '{schema_name}' not found. Use schema_list() to see available schemas."})

    strategy = JsonCssExtractionStrategy(schema_def["selector"])
    config = CrawlerRunConfig(extraction_strategy=strategy)

    crawler = await _get_crawler()
    result = await crawler.arun(url, config=config)

    if not result.success:
        return json.dumps({"error": f"Failed to crawl {url}", "status": result.status_code})

    extracted = result.extracted_content or "[]"
    return json.dumps({
        "url": result.url,
        "schema": schema_name,
        "data": json.loads(extracted),
    }, ensure_ascii=False)


@mcp.tool()
async def crawl_deep(
    url: str,
    strategy: str = "bfs",
    max_pages: int = 10,
    keywords: Optional[str] = None,
) -> str:
    """Deep crawl a website, following links across multiple pages.

    Args:
        url: Starting URL
        strategy: Crawl strategy — "bfs" (breadth-first, default) or "dfs" (depth-first)
        max_pages: Maximum pages to crawl (default 10)
        keywords: Optional comma-separated keywords to prioritize relevant pages
    """
    from crawl4ai import CrawlerRunConfig
    from crawl4ai.deep_crawling import BFSDeepCrawlStrategy, DFSDeepCrawlStrategy

    if strategy == "dfs":
        crawl_strategy = DFSDeepCrawlStrategy(max_depth=3, max_pages=max_pages)
    else:
        crawl_strategy = BFSDeepCrawlStrategy(max_depth=2, max_pages=max_pages)

    config = CrawlerRunConfig(
        deep_crawl_strategy=crawl_strategy,
        word_count_threshold=10,
    )

    crawler = await _get_crawler()
    results = await crawler.arun(url, config=config)

    # arun with deep_crawl returns a list
    if not isinstance(results, list):
        results = [results]

    pages = []
    for r in results:
        if r.success:
            pages.append({
                "url": r.url,
                "title": (r.metadata or {}).get("title", ""),
                "content_length": len(r.markdown.raw_markdown) if r.markdown else 0,
                "content_preview": (r.markdown.raw_markdown[:300] if r.markdown else ""),
            })

    return json.dumps({
        "start_url": url,
        "strategy": strategy,
        "pages_crawled": len(pages),
        "pages": pages,
    }, ensure_ascii=False)


@mcp.tool()
async def crawl_map(url: str, max_pages: int = 50) -> str:
    """Discover all URLs on a website without extracting content. Fast site mapping.

    Args:
        url: Starting URL to map
        max_pages: Maximum URLs to discover (default 50)
    """
    from crawl4ai import CrawlerRunConfig

    config = CrawlerRunConfig(word_count_threshold=1)

    crawler = await _get_crawler()
    result = await crawler.arun(url, config=config)

    if not result.success:
        return json.dumps({"error": f"Failed to crawl {url}", "status": result.status_code})

    all_links = []
    if result.links:
        for link in result.links.get("internal", []):
            href = link.get("href", "") if isinstance(link, dict) else str(link)
            if href:
                all_links.append(href)

    return json.dumps({
        "url": url,
        "links_found": len(all_links),
        "links": all_links[:max_pages],
    }, ensure_ascii=False)


@mcp.tool()
def schema_list() -> str:
    """List all available extraction schemas for use with crawl_extract."""
    schemas = schema_store.list_all()
    return json.dumps(schemas, indent=2)


if __name__ == "__main__":
    mcp.run(transport="stdio")
