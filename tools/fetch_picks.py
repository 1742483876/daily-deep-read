#!/usr/bin/env python3
"""精选：只收「值得花时间」的内容 → data/picks.json（fetch_news.py 会把它合并进 news.json，tag 带「精选」）
来源与门槛（都是公开接口 / RSS，免登录）：
- 论文：Hugging Face Daily Papers，近 4 天、点赞 ≥15（社区投票过的 AI 论文，附一句话摘要）
- 热议：Hacker News 首页，≥200 分（程序员圈当天真正在讨论的）
- 深度：一线 AI 研究者 / 实验室博客（Interconnects、Import AI、Raschka、Simon Willison 长文、HF Blog、OpenAI、DeepMind、Anthropic），近 10 天，每源最多 3 篇
每条带质量分 q（0~10），前端「精选」频道按 q + 新鲜度排序。
用法：python3 tools/fetch_picks.py --out data/picks.json
"""
import hashlib, html, json, math, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from datetime import datetime
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
NOW = int(time.time())
POLI = re.compile(r"Trump|Biden|Putin|Ukraine|Russia|Israel|Gaza|Iran|election|Congress|White House|Taiwan|Hong Kong|Xinjiang|Tibet|Uyghur|abortion|shooting|war\b|military", re.I)
AI = re.compile(r"\bAI\b|LLM|GPT|Claude|Gemini|model|transformer|agent|neural|diffusion|token|inference|training|dataset|OpenAI|Anthropic|DeepMind|Llama|Mistral|Qwen|DeepSeek|RL\b|reasoning", re.I)
BLOGS = [  # (显示名, feed, 权重, 只收长文的过滤)
    ("Interconnects", "https://www.interconnects.ai/feed", 7.5, None),
    ("Import AI", "https://importai.substack.com/feed", 7.0, None),
    ("Ahead of AI", "https://magazine.sebastianraschka.com/feed", 7.5, None),
    ("Simon Willison", "https://simonwillison.net/atom/entries/", 7.0, None),
    ("Hugging Face Blog", "https://huggingface.co/blog/feed.xml", 6.5, None),
    ("OpenAI", "https://openai.com/news/rss.xml", 6.5, re.compile(r"customer|case study|partner|webinar|academy|event", re.I)),
    ("Google DeepMind", "https://deepmind.google/blog/rss.xml", 6.5, None),
]

def get(u, timeout=20):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=timeout).read()

def text(s, n):
    s = html.unescape(s or "")                      # RSS 正文常是转义过的 HTML：先还原再去标签
    s = html.unescape(re.sub(r"<[^>]+>", " ", s)); return re.sub(r"\s+", " ", s).strip()[:n]

def iid(u): return "p" + hashlib.md5(u.encode()).hexdigest()[:10]

def item(title, src, url, t, intro, sub, q, poster="", extra_links=()):
    tags = ["精选", sub] + (["AI"] if sub == "论文" or AI.search(title + " " + intro[:200]) else []) + [src]
    return {"id": iid(url), "type": "新闻", "title": title, "creator": src, "year": "", "tags": list(dict.fromkeys(tags)), "hook": "",
            "intro": intro, "len": "", "t": t, "poster": poster, "q": round(q, 2),
            "links": [{"platform": "原文", "url": url}] + [{"platform": p, "url": u} for p, u in extra_links]}

def hf():
    out = []
    for x in json.loads(get("https://huggingface.co/api/daily_papers?limit=100")):
        p = x["paper"]; up = int(p.get("upvotes") or 0)
        try: t = int(datetime.fromisoformat(x["publishedAt"].replace("Z", "+00:00")).timestamp())
        except Exception: continue
        if up < 15 or NOW - t > 4 * 86400: continue
        intro = (p.get("ai_summary") or text(p.get("summary"), 260)).strip()
        out.append(item(p["title"], "HF 论文", f"https://huggingface.co/papers/{p['id']}", t, intro + f"（👍 {up}）", "论文",
                        min(10, 5 + math.log2(up / 15 + 1) * 1.6), x.get("thumbnail") or "", [("arXiv", f"https://arxiv.org/abs/{p['id']}")]))
    return out

def hn():
    out = []
    for h in json.loads(get("https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40"))["hits"]:
        pts, cm = int(h.get("points") or 0), int(h.get("num_comments") or 0)
        t = int(h.get("created_at_i") or 0); title = h.get("title") or ""
        if pts < 200 or POLI.search(title) or re.match(r"(Tell|Ask) HN", title) or NOW - t > 3 * 86400: continue
        disc = f"https://news.ycombinator.com/item?id={h['objectID']}"
        out.append(item(title, "Hacker News", h.get("url") or disc, t, f"HN {pts} 分 · {cm} 条讨论", "热议",
                        min(10, 4.5 + math.log2(pts / 200 + 1) * 1.8), "", [("HN 讨论", disc)]))
    return out

def feed(args):
    name, url, w, skip = args
    try: s = get(url).decode("utf-8", "ignore")
    except Exception as e: print(name, "失败", str(e)[:60], file=sys.stderr); return []
    out = []
    for blk in re.findall(r"<(?:item|entry)\b.*?</(?:item|entry)>", s, re.S)[:12]:
        g = lambda tag: (re.search(rf"<{tag}[^>]*>(.*?)</{tag}>", blk, re.S) or [None, ""])[1]
        title = text(g("title").replace("<![CDATA[", "").replace("]]>", ""), 140)
        link = (re.search(r'<link[^>]*href="([^"]+)"', blk) or re.search(r"<link>(.*?)</link>", blk, re.S) or [None, ""])[1].strip()
        ds = g("pubDate") or g("published") or g("updated")
        try: t = int(parsedate_to_datetime(ds).timestamp()) if "," in ds else int(datetime.fromisoformat(ds.strip().replace("Z", "+00:00")).timestamp())
        except Exception: continue
        if not title or not link or NOW - t > 21 * 86400 or POLI.search(title) or (skip and skip.search(title)): continue
        body = g("description") or g("summary") or g("content:encoded") or g("content")
        body = body.replace("<![CDATA[", "").replace("]]>", "")
        intro = text(body.replace("<![CDATA[", "").replace("]]>", ""), 240)
        img = (re.search(r'<(?:media:content|enclosure|media:thumbnail)[^>]*url="([^"]+\.(?:jpe?g|png|webp)[^"]*)"', blk) or re.search(r'<img[^>]*src="([^"]+)"', html.unescape(body)) or [None, ""])[1]
        out.append(item(title, name, link, t, intro, "深度", w, img))
        if len(out) >= 3: break
    print(name, len(out), file=sys.stderr)
    return out

def anthropic():
    s = get("https://www.anthropic.com/news").decode("utf-8", "ignore"); out, seen = [], set()
    for m in re.finditer(r'href="(/news/[a-z0-9-]+)"', s):
        u = "https://www.anthropic.com" + m.group(1)
        if u in seen: continue
        seen.add(u)
        try:
            p = get(u, 12).decode("utf-8", "ignore")
            title = text((re.search(r'<meta property="og:title" content="([^"]+)"', p) or [None, ""])[1], 140)
            desc = text((re.search(r'<meta (?:name|property)="(?:og:)?description" content="([^"]+)"', p) or [None, ""])[1], 240)
            ds = (re.search(r'"datePublished":"([^"]+)"', p) or re.search(r'<time[^>]*datetime="([^"]+)"', p) or [None, ""])[1]
            t = int(datetime.fromisoformat(ds.replace("Z", "+00:00")).timestamp()) if ds else 0
            img = (re.search(r'<meta property="og:image" content="([^"]+)"', p) or [None, ""])[1]
        except Exception: continue
        if title and t and NOW - t < 10 * 86400: out.append(item(title.replace(" \\ Anthropic", ""), "Anthropic", u, t, desc, "深度", 7.0, img))
        if len(seen) >= 6 or len(out) >= 3: break
    print("Anthropic", len(out), file=sys.stderr)
    return out

def main():
    outp = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "data/picks.json"
    items = []
    with ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(hf), ex.submit(hn), ex.submit(anthropic)] + [ex.submit(feed, b) for b in BLOGS]
        for f in futs:
            try: items += f.result()
            except Exception as e: print("失败", str(e)[:80], file=sys.stderr)
    by = {}
    for it in items: by.setdefault(it["id"], it)
    out = sorted(by.values(), key=lambda x: -x["t"])
    if len(out) < 5:
        sys.exit(f"只拿到 {len(out)} 条，picks.json 保持不变")
    json.dump({"updated": NOW, "count": len(out), "items": out}, open(outp, "w"), ensure_ascii=False, separators=(",", ":"))
    import collections
    print("精选", len(out), collections.Counter(x["tags"][1] for x in out), file=sys.stderr)

if __name__ == "__main__":
    main()
