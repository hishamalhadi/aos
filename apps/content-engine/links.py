"""Link extraction and categorization from video descriptions.

The third research layer: URLs in the description often point to the most
valuable content — repos to clone, papers to read, tools to try, related
videos to watch. Transcript + visuals alone miss this. This module extracts
and categorizes them so downstream research can fetch/clone/summarize.
"""

import re
from urllib.parse import urlparse

# Categorization patterns
GITHUB_PATTERN = re.compile(r"github\.com/[\w\-]+/[\w\-\.]+", re.I)
YOUTUBE_PATTERN = re.compile(r"(youtube\.com/watch|youtu\.be/|youtube\.com/shorts/|youtube\.com/@)", re.I)
SOCIAL_PATTERN = re.compile(r"(twitter\.com|x\.com|instagram\.com|tiktok\.com|linkedin\.com|facebook\.com)", re.I)
DOCS_PATTERN = re.compile(r"(docs?\.|/docs/|/documentation/|readthedocs\.)", re.I)
PAPER_PATTERN = re.compile(r"(arxiv\.org|papers?\.|/papers?/|doi\.org|acm\.org|ieee\.org)", re.I)

# Known article/news domains
ARTICLE_DOMAINS = {
    "techcrunch.com", "theverge.com", "wired.com", "arstechnica.com",
    "hackernews.com", "news.ycombinator.com", "thehackernews.com",
    "cybersecuritydive.com", "helpnetsecurity.com", "medium.com",
    "substack.com", "dev.to", "hashnode.com", "nytimes.com",
    "washingtonpost.com", "bbc.com", "reuters.com", "bloomberg.com",
}

# Tool/product domains (things you might want to try)
TOOL_DOMAINS = {
    "anthropic.com", "openai.com", "google.com", "huggingface.co",
    "replicate.com", "fireworks.ai", "groq.com", "openrouter.ai",
    "pi.dev", "pinecone.io", "weaviate.io", "langchain.com",
    "vercel.com", "supabase.com", "railway.app", "modal.com",
}


URL_PATTERN = re.compile(
    r"https?://[^\s\)\]\>\"'<]+",
    re.IGNORECASE,
)


def extract_urls(text: str) -> list[str]:
    """Extract all URLs from text, cleaning trailing punctuation."""
    if not text:
        return []
    raw = URL_PATTERN.findall(text)
    cleaned = []
    for url in raw:
        # Strip trailing punctuation that's often mistakenly captured
        url = url.rstrip(".,;:!?)")
        if url and url not in cleaned:
            cleaned.append(url)
    return cleaned


def categorize_url(url: str) -> str:
    """Categorize a URL into: github, video, social, docs, paper, article, tool, website."""
    if GITHUB_PATTERN.search(url):
        return "github"
    if YOUTUBE_PATTERN.search(url):
        return "video"
    if PAPER_PATTERN.search(url):
        return "paper"
    if SOCIAL_PATTERN.search(url):
        return "social"
    if DOCS_PATTERN.search(url):
        return "docs"

    try:
        domain = urlparse(url).netloc.lower().removeprefix("www.")
        if domain in ARTICLE_DOMAINS:
            return "article"
        if domain in TOOL_DOMAINS:
            return "tool"
    except Exception:
        pass

    return "website"


def parse_github_url(url: str) -> dict | None:
    """Parse a GitHub URL into {owner, repo, path, ref}."""
    m = re.match(
        r"https?://github\.com/([\w\-]+)/([\w\-\.]+?)(?:\.git)?(?:/(?:tree|blob)/([\w\-/\.]+))?/?$",
        url,
    )
    if not m:
        return None
    owner, repo, ref_path = m.groups()
    return {
        "owner": owner,
        "repo": repo,
        "full_name": f"{owner}/{repo}",
        "ref_path": ref_path or "",
        "clone_url": f"https://github.com/{owner}/{repo}.git",
    }


def extract_and_categorize(description: str) -> dict:
    """Extract all links from a description and categorize them.

    Returns:
        {
          "total": int,
          "github": [{url, owner, repo, full_name}],
          "video": [url],
          "paper": [url],
          "article": [url],
          "docs": [url],
          "tool": [url],
          "social": [url],
          "website": [url],
        }
    """
    urls = extract_urls(description)
    result = {
        "total": len(urls),
        "github": [],
        "video": [],
        "paper": [],
        "article": [],
        "docs": [],
        "tool": [],
        "social": [],
        "website": [],
    }

    for url in urls:
        category = categorize_url(url)
        if category == "github":
            gh = parse_github_url(url)
            if gh:
                result["github"].append({"url": url, **gh})
            else:
                result["website"].append(url)
        else:
            result[category].append(url)

    return result


def research_priority(categorized: dict) -> list[dict]:
    """Return links ordered by research priority (highest first).

    Priority ranking:
      1. github (clone + read for code context)
      2. paper (read for theory)
      3. docs (read for reference)
      4. tool (visit for capability context)
      5. video (related content, but expensive to process)
      6. article (read for news/analysis)
      7. website (lowest — general)
      8. social (usually not high-signal)
    """
    priority_order = ["github", "paper", "docs", "tool", "video", "article", "website", "social"]
    ranked = []
    for category in priority_order:
        items = categorized.get(category, [])
        for item in items:
            url = item["url"] if isinstance(item, dict) else item
            ranked.append({
                "url": url,
                "category": category,
                "details": item if isinstance(item, dict) else None,
            })
    return ranked
