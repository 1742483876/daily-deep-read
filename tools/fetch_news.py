#!/usr/bin/env python3
"""实时新闻：科技/商业/财经/游戏影视资讯 → news.json（每小时由 GitHub Actions 跑，也可本机跑）
用法：python3 fetch_news.py --out ../site/data/news.json
"""
import json, os, re, sys, time, html, hashlib, urllib.request, urllib.parse, email.utils, xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
RSS = [  # (来源, url, 分类)
("IT之家", "https://www.ithome.com/rss/", "科技"), ("少数派", "https://sspai.com/feed", "数码"),
    ("爱范儿", "https://www.ifanr.com/feed", "科技"), ("虎嗅", "https://rss.huxiu.com/", "商业"), ("极客公园", "https://www.geekpark.net/rss", "科技"), ("雷峰网", "https://www.leiphone.com/feed", "AI"), ("Solidot", "https://www.solidot.org/index.rss", "科技"),
    ("量子位", "https://www.qbitai.com/feed", "AI"), ("游研社", "https://www.yystv.cn/rss/feed", "游戏"), ("机核", "https://www.gcores.com/rss", "游戏"),
    ("Hacker News", "https://hnrss.org/frontpage?points=150", "科技"), ("The Verge", "https://www.theverge.com/rss/index.xml", "科技"),
    ("TechCrunch", "https://techcrunch.com/feed/", "创业"), ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index", "科技"),
    ("CNBC", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "财经"), ("华尔街日报", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", "财经"),
    ("MIT Tech Review", "https://www.technologyreview.com/feed/", "AI"),
]
# 只做科技/商业/文娱，时政与敏感话题一律过滤
BLOCK = re.compile(r"习近平|总书记|政治局|台独|台湾|香港|澳门|新疆|西藏|藏独|疆独|法轮|六四|天安门|民主|人权|抗议|示威|选举|大选|特朗普|拜登|Trump|Biden|election|protest|Taiwan|Hong Kong|Xinjiang|Tibet|Uyghur|Putin|普京|战争|war|Gaza|加沙|以色列|Israel|乌克兰|Ukraine|俄罗斯|Russia|军队|导弹|missile|枪击|shooting|色情|赌博", re.I)

# 国内持牌财经媒体/政府网只挡硬敏感词（否则政策、央行、国际大事会被误杀）；海外媒体再多挡涉华敏感话题
HARD = re.compile(r"台独|藏独|疆独|法轮|六四|天安门事件|色情|赌博|自杀", re.I)
FOREIGN = re.compile(r"Taiwan|Hong Kong|Xinjiang|Tibet|Uyghur|Tiananmen|Falun|Xi Jinping|Communist Party|porn|suicide|shooting", re.I)
LOOSE = {"CNBC": FOREIGN, "华尔街日报": FOREIGN, "MarketWatch": FOREIGN}
CATS = [("政策", re.compile(r"国务院|央行|人民银行|证监会|财政部|发改委|工信部|商务部|金融监管|外交部|国资委|市场监管总局|最高法|人大|条例|新规|征求意见|美联储|鲍威尔|白宫|特朗普|美国财长|关税|制裁|出口管制|欧盟|欧洲央行|日本央行|英国央行|国会|降息|加息|政治局|部长|总统|总理|\bFed\b|Federal Reserve|Trump|White House|tariff|Congress|Treasury|rate cut|rate hike", re.I)),
        ("股票", re.compile(r"A股|港股|美股|股市|股价|个股|涨停|跌停|沪指|深成指|创业板|科创|纳斯达克|纳指|标普|道指|恒生|指数|期货|ETF|基金|增持|减持|回购|财报|业绩|净利|营收|IPO|上市|市值|北向|融资|券商|板块|盘前|盘后|涨超|跌超|stock|shares|Nasdaq|S&P|Dow|Wall Street|earnings|investor|market", re.I))]
ENT = [("半导体", r"半导体|芯片|存储|光刻|晶圆|英伟达|台积电|海力士|美光|中芯|Nvidia|chip|semiconductor|TSMC"), ("AI", r"人工智能|大模型|OpenAI|ChatGPT|Anthropic|DeepSeek|算力|\bAI\b"),
       ("美联储", r"美联储|鲍威尔|降息|加息|\bFed\b|Federal Reserve"), ("关税贸易", r"关税|贸易战|出口管制|制裁|tariff"), ("黄金", r"黄金|金价|\bgold\b"), ("原油", r"原油|油价|OPEC|\boil\b"),
       ("汇率", r"汇率|人民币|美元指数|日元|欧元"), ("房地产", r"房地产|楼市|房企|房贷"), ("新能源", r"新能源|锂电|光伏|储能|电动车|特斯拉|比亚迪|Tesla"), ("机器人", r"机器人|人形|robot"),
       ("医药", r"医药|创新药|医疗|药企|pharma"), ("军工航天", r"军工|航天|卫星|火箭|SpaceX"), ("加密货币", r"比特币|加密货币|以太坊|bitcoin|crypto")]
ENT = [(k, re.compile(v, re.I)) for k, v in ENT]

# 公司「辟谣式」澄清、例行回购增持、董监高变动等：保留但打「公告」标签，推荐里降权
NOISE = re.compile(r"^[^：]{2,10}：.*(未涉及|无相关|没有相关|暂无|不涉及|未开展|无.{0,6}(业务|计划|布局)|回购|增持|减持|董事|监事|高管|辞职|质押|解除质押|司法拍卖|股东大会|权益分派|可转债|担保|诉讼|会计师|募集资金)")

def tags_of(it):
    s = it["title"] + " " + it["sum"][:160]
    t = list(it.get("cats") or [it["cat"]])
    if it.get("flash") or it["src"] in LOOSE: t += [k for k, r in CATS if r.search(s)]
    t += [k for k, r in ENT if r.search(s)]
    if NOISE.search(it["title"]) and not it.get("big"): t.append("公告")
    if it.get("big"): t.insert(0, "大新闻")
    return list(dict.fromkeys(t + [it["src"]]))

def cn_ts(s):
    """北京时间字符串 → 时间戳（GitHub 机器是 UTC，不能用本地时区）"""
    from datetime import datetime, timezone, timedelta
    try: return int(datetime.strptime(s, "%Y-%m-%d %H:%M:%S" if len(s) > 10 else "%Y-%m-%d").replace(tzinfo=timezone(timedelta(hours=8))).timestamp())
    except Exception: return 0

def split_title(c):
    m = re.match(r"【(.{4,70}?)】", c)
    if m: return m.group(1), c[m.end():].strip()
    m = re.match(r"(.{8,60}?)[。；]", c)
    return (m.group(1), c) if m else (c[:56], c)

def wscn():
    b = fetch("https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=100")
    try: rows = json.loads(b)["data"]["items"]
    except Exception: return []
    out = []
    for r in rows:
        c = text(r.get("content_text") or r.get("content"), 300)
        if len(c) < 10 or HARD.search(c): continue
        t, body = split_title((("【" + r["title"] + "】") if r.get("title") else "") + c)
        out.append({"title": t, "src": "华尔街见闻", "cat": "财经", "flash": 1, "big": (r.get("score") or 1) >= 2, "url": r.get("uri") or "https://wallstreetcn.com/live/global", "t": int(r.get("display_time") or 0), "sum": body if body != t else "", "img": ""})
    return out

def eastmoney():
    b = fetch("https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=100&req_trace=1")
    try: rows = json.loads(b)["data"]["fastNewsList"]
    except Exception: return []
    out = []
    for r in rows:
        t, c = text(r.get("title"), 80), text(r.get("summary"), 300)
        if not t or HARD.search(t + c): continue
        out.append({"title": t, "src": "东方财富", "cat": "财经", "flash": 1, "big": r.get("titleColor") == 3, "url": f"https://finance.eastmoney.com/a/{r['code']}.html", "t": cn_ts(r.get("showTime") or ""), "sum": re.sub(r"^【.*?】", "", c), "img": ""})
    return out

def gov():
    """中国政府网：最新政策（近 10 天）+ 要闻（去掉会见、致电等礼节性消息）"""
    out, now = [], time.time()
    for u, days, cap in (("https://www.gov.cn/zhengce/zuixin/ZUIXINZHENGCE.json", 10, 15), ("https://www.gov.cn/yaowen/liebiao/YAOWENLIEBIAO.json", 2, 20)):
        try: rows = json.loads(fetch(u))
        except Exception: continue
        n = 0
        for r in rows:
            t, d = text(r.get("TITLE"), 90), cn_ts(r.get("DOCRELPUBTIME") or "")
            if not t or n >= cap or now - d > (days + 1) * 86400: continue
            if re.search(r"会见|会谈|致电|贺电|贺信|互致|慰问|唁电|抵达|出席.*仪式|启程", t) or HARD.search(t): continue
            n += 1
            out.append({"title": t, "src": "中国政府网", "cat": "政策", "url": r["URL"], "t": min(int(now), d + 9 * 3600), "sum": "", "img": "", "keep": days + 1})
    return out

def weibo_hot(prev):
    """微博热搜（公开接口）；没有时间字段，用第一次上榜时间"""
    try:
        b = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(urllib.request.Request("https://weibo.com/ajax/side/hotSearch", headers={"User-Agent": UA, "Referer": "https://weibo.com/"}), timeout=15).read()
        rows = json.loads(b)["data"]["realtime"]
    except Exception as e:
        print("微博热搜失败", str(e)[:80], file=sys.stderr); return []
    out, now = [], int(time.time())
    for r in rows[:30]:
        w = (r.get("word") or "").strip()
        if not w or r.get("is_ad") or HARD.search(w): continue
        u = "https://s.weibo.com/weibo?q=" + urllib.parse.quote("#" + w + "#")
        nid = "n" + hashlib.md5(u.encode()).hexdigest()[:10]
        out.append({"title": w, "src": "微博热搜", "cat": "热搜", "flash": 1, "big": False, "url": u, "t": prev.get(nid, now),
                    "sum": f"热搜第 {r.get('realpos')} · 热度 {int(r.get('num') or 0) // 10000} 万", "img": "", "keep": 1})
    return out

def bigrams(s):
    s = re.sub(r"\W", "", s.lower()); return {s[i:i + 2] for i in range(len(s) - 1)}

def fetch(url):
    for op in (urllib.request.build_opener(), urllib.request.build_opener(urllib.request.ProxyHandler({}))):
        try:
            return op.open(urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=20).read()
        except Exception:
            continue
    return None

def text(s, n):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or "")); s = re.sub(r"\s+", " ", s).strip()
    return s[:n] + ("…" if len(s) > n else "")

def ts(s):
    if not s: return 0
    try: return int(email.utils.parsedate_to_datetime(s).timestamp())
    except Exception: pass
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except Exception: return 0

def img_of(e, raw):
    for tag in ("{http://search.yahoo.com/mrss/}content", "{http://search.yahoo.com/mrss/}thumbnail", "enclosure"):
        x = e.find(tag)
        if x is not None and (x.get("url") or "").startswith("http") and "image" in (x.get("type") or "image"): return x.get("url")
    m = re.search(r'<img[^>]+src="(https?://[^"]+)"', raw or "")
    return m.group(1) if m else ""

def parse(src, url, cat):
    b = fetch(url)
    if not b: return src, []
    try: root = ET.fromstring(b)
    except Exception: return src, []
    out = []
    A = "{http://www.w3.org/2005/Atom}"
    items = root.findall(".//item") or root.findall(f".//{A}entry")
    for e in items[:40]:
        t = e.findtext("title") or e.findtext(f"{A}title") or ""
        link = e.findtext("link") or ""
        if not link:
            l = e.find(f"{A}link"); link = l.get("href") if l is not None else ""
        raw = e.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or e.findtext("description") or e.findtext(f"{A}summary") or e.findtext(f"{A}content") or ""
        when = ts(e.findtext("pubDate") or e.findtext(f"{A}published") or e.findtext(f"{A}updated") or e.findtext("{http://purl.org/dc/elements/1.1/}date"))
        t = text(t, 80)
        if not t or not link.startswith("http") or LOOSE.get(src, BLOCK).search(t + raw[:300]): continue
        summ = text(raw, 260)
        if src == "Hacker News": summ = ""
        out.append({"title": t, "src": src, "cat": cat, "url": link.strip(), "t": when, "sum": summ, "img": img_of(e, raw)})
    return src, out

def sina():
    """新浪财经 7x24（只取标了重点的）"""
    b = fetch("https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=60&zhibo_id=152")
    try: rows = json.loads(b)["result"]["data"]["feed"]["list"]
    except Exception: return []
    out = []
    for r in rows:
        c = text(r.get("rich_text"), 260)
        m = re.match(r"【(.{4,60}?)】", c)
        if not m or HARD.search(c): continue
        t = cn_ts(r.get("create_time") or "")
        out.append({"title": m.group(1), "src": "新浪财经", "cat": "财经", "flash": 1, "url": r.get("docurl") or f"https://finance.sina.com.cn/7x24/", "t": t, "sum": c[m.end():].strip(), "img": ""})
    return out

def main():
    outp = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "news.json"
    now = int(time.time()); items = []
    try: prev = {x["id"]: x["t"] for x in json.load(open(outp))["items"]}
    except Exception: prev = {}
    with ThreadPoolExecutor(8) as ex:
        for src, lst in ex.map(lambda a: parse(*a), RSS):
            print(src, len(lst), file=sys.stderr); items += lst[:15]
    for nm, fn, cap in (("新浪财经", sina, 20), ("华尔街见闻", wscn, 80), ("东方财富", eastmoney, 80), ("中国政府网", gov, 40), ("微博热搜", lambda: weibo_hot(prev), 30)):
        try: c = fn()
        except Exception as e: c = []; print(nm, "失败", str(e)[:80], file=sys.stderr)
        print(nm, len(c), file=sys.stderr); items += c[:cap]
    seen, out, kept = set(), [], []
    for it in sorted(items, key=lambda x: -x["t"]):
        k = re.sub(r"\W", "", it["title"].lower())[:24]
        if k in seen or (it["t"] and now - it["t"] > it.get("keep", 2) * 86400) or it["t"] > now + 900: continue
        seen.add(k)
        g, dup = bigrams(it["title"]), None      # 不同媒体报同一件事：合并成一条，来源数当热度
        for o, og in kept:
            pa, pb = it["title"].split("：")[0], o["title"].split("：")[0]
            if pa == pb and 2 <= len(pa) <= 8 and "：" in it["title"] and o["src"] != it["src"] and abs(o["t"] - it["t"]) < 2 * 3600 and g and len(g & og) / min(len(g), len(og)) > 0.4: dup = o; break
            if abs(o["t"] - it["t"]) < 6 * 3600 and o["src"] != it["src"] and g and len(g & og) / len(g | og) > 0.5 and re.findall(r"\d+", o["title"]) == re.findall(r"\d+", it["title"]): dup = o; break
        if dup:
            dup["also"] = dup.get("also", set()) | {it["src"]}; dup["big"] = dup.get("big") or it.get("big") or len(dup["also"]) >= 2
            continue
        kept.append((it, g))
    for it, _ in kept:
        out.append({"id": "n" + hashlib.md5(it["url"].encode() + (it["title"].encode() if it.get("flash") else b"")).hexdigest()[:10], "type": "新闻", "title": it["title"], "creator": it["src"],
                    "year": "", "tags": tags_of(it), "hook": "", "intro": it["sum"],
                    "len": "", "t": it["t"], "poster": it["img"], "links": [{"platform": "原文", "url": it["url"]}],
                    **({"also": sorted(it["also"])} if it.get("also") else {})})
    out = out[:460]
    # 合并「精选」（tools/fetch_picks.py：HF 论文 / HN 热议 / AI 实验室与研究者博客，带质量分 q）
    try:
        ids = {o["id"] for o in out}
        ps = [x for x in json.load(open(os.path.join(os.path.dirname(os.path.abspath(outp)), "picks.json")))["items"] if x["id"] not in ids]
        out += ps; print("精选", len(ps), file=sys.stderr)
    except Exception:
        pass
    # 合并关注的 UP 新视频（本机 fetch_follow.py 生成，7 天内）
    try:
        fs = [x for x in json.load(open(os.path.join(os.path.dirname(os.path.abspath(outp)), "follow.json")))["items"] if now - x.get("t", 0) < 7 * 86400]
        out += fs; print("关注", len(fs), file=sys.stderr)
    except Exception:
        pass
    # 合并本机 Grok 抓的 X 热帖（data/x.json，36 小时内）
    xp = os.path.join(os.path.dirname(os.path.abspath(outp)), "x.json")
    try:
        xs = [x for x in json.load(open(xp))["items"] if now - x.get("t", 0) < 36 * 3600]
        ids = {o["id"] for o in out}
        out = sorted(out + [x for x in xs if x["id"] not in ids], key=lambda x: -x["t"])
        print("X", len(xs), file=sys.stderr)
    except Exception:
        pass
    os.makedirs(os.path.dirname(os.path.abspath(outp)), exist_ok=True)
    json.dump({"updated": now, "count": len(out), "items": out}, open(outp, "w"), ensure_ascii=False, separators=(",", ":"))
    print("news", len(out), file=sys.stderr)

if __name__ == "__main__":
    main()