#!/usr/bin/env python3
"""全网热榜聚合 → data/hot.json
微博热搜 / 抖音热榜 / B站热搜+热门视频 / 百度热搜 / 头条热榜，另把多个平台同时在热的事件合并成「全网热点」。
X 与 AI 速览由本机 fetch_hot_ai.py（公司 AIHub + Grok 联网搜索）生成 data/hot_ai.json，前端一起展示。
用法：python3 tools/fetch_hot.py --out data/hot.json
"""
import json, re, sys, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
OP = urllib.request.build_opener(urllib.request.ProxyHandler({}))
HARD = re.compile(r"台独|藏独|疆独|法轮|六四|天安门事件|色情|赌博|自杀|习近平|总书记|政治局")
POLI = re.compile(r"依规治党|党建|党风|廉政|中央.*会议|全会|主席|总理|书记|人大|政协|学习贯彻|重要讲话|重要指示|致信|贺信|会见|会谈")
NOW = int(time.time())

def get(u, ref=""):
    return json.loads(OP.open(urllib.request.Request(u, headers={"User-Agent": UA, "Referer": ref}), timeout=15).read())

def ok(w): return w and not HARD.search(w) and not POLI.search(w)

def weibo():
    out = []
    for r in get("https://weibo.com/ajax/side/hotSearch", "https://weibo.com/")["data"]["realtime"]:
        w = (r.get("word") or "").strip()
        if r.get("is_ad") or not ok(w): continue
        out.append({"title": w, "heat": int(r.get("num") or 0), "label": r.get("label_name") or "",
                    "url": "https://s.weibo.com/weibo?q=" + urllib.parse.quote("#" + w + "#")})
    return out

def douyin():
    out = []
    for r in get("https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", "https://www.iesdouyin.com/")["word_list"]:
        w = (r.get("word") or "").strip()
        if not ok(w): continue
        out.append({"title": w, "heat": int(r.get("hot_value") or 0), "label": {1: "新", 3: "热", 5: "首发", 8: "独家"}.get(r.get("label"), ""),
                    "url": "https://www.douyin.com/search/" + urllib.parse.quote(w)})
    return out

def bili_word():
    out = []
    for r in get("https://s.search.bilibili.com/main/hotword?limit=30", "https://www.bilibili.com/")["list"]:
        w = (r.get("show_name") or r.get("keyword") or "").strip()
        if not ok(w): continue
        out.append({"title": w, "heat": 0, "label": "", "url": "https://search.bilibili.com/all?keyword=" + urllib.parse.quote(r.get("keyword") or w)})
    return out

def bili_video():
    out = []
    for v in get("https://api.bilibili.com/x/web-interface/popular?ps=30&pn=1", "https://www.bilibili.com/")["data"]["list"]:
        t = v.get("title") or ""
        if not ok(t): continue
        pic = v.get("pic", "").replace("http://", "https://")
        out.append({"title": t, "heat": int((v.get("stat") or {}).get("view") or 0), "label": v.get("tname") or "",
                    "url": "https://www.bilibili.com/video/" + v["bvid"], "pic": pic + "@320w_180h_1c.jpg" if pic else "",
                    "by": (v.get("owner") or {}).get("name", ""), "why": (v.get("rcmd_reason") or {}).get("content", "")})
    return out

def baidu():
    out = []
    for card in get("https://top.baidu.com/api/board?platform=wise&tab=realtime", "https://top.baidu.com/")["data"]["cards"]:
        for grp in card.get("content") or []:
            for r in (grp.get("content") if isinstance(grp.get("content"), list) else [grp]):
                w = (r.get("word") or r.get("query") or "").strip()
                if r.get("isTop") or not ok(w): continue
                out.append({"title": w, "heat": int(r.get("hotScore") or 0), "label": r.get("hotTag") or "",
                            "url": r.get("url") or "https://www.baidu.com/s?wd=" + urllib.parse.quote(w), "desc": (r.get("desc") or "")[:120]})
    return out

def toutiao():
    out = []
    for r in get("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", "https://www.toutiao.com/")["data"]:
        w = (r.get("Title") or "").strip()
        if not ok(w): continue
        img = ((r.get("Image") or {}).get("url") or "")
        out.append({"title": w, "heat": int(r.get("HotValue") or 0), "label": r.get("Label") or "", "url": (r.get("Url") or "").split("?")[0], "pic": img})
    return out

BOARDS = [("weibo", "微博", weibo), ("douyin", "抖音", douyin), ("bili", "B站热搜", bili_word), ("bilivideo", "B站热门", bili_video),
          ("baidu", "百度", baidu), ("toutiao", "头条", toutiao)]

def grams(s):
    s = re.sub(r"[^\w]", "", s.lower()); return {s[i:i + 2] for i in range(len(s) - 1)}

def merge(boards):
    """几个平台同时在榜的事件：标题 2-gram 相似度聚类，按「上榜平台数 + 排名」排序"""
    nodes = []
    for b in boards:
        if b["id"] == "bilivideo": continue
        for i, x in enumerate(b["items"][:40]):
            nodes.append({"title": x["title"], "src": b["name"], "rank": i + 1, "url": x["url"], "g": grams(x["title"]), "desc": x.get("desc", "")})
    groups = []
    for n in nodes:
        for g in groups:
            if any(len(n["g"] & m["g"]) / max(1, min(len(n["g"]), len(m["g"]))) >= 0.5 and len(n["g"] & m["g"]) >= 3 for m in g): g.append(n); break
        else: groups.append([n])
    out = []
    for g in groups:
        srcs = sorted({m["src"] for m in g})
        score = len(srcs) * 10 + sum(max(0, 41 - m["rank"]) for m in g) / 10
        best = min(g, key=lambda m: (m["rank"], len(m["title"])))
        out.append({"title": best["title"], "srcs": srcs, "score": round(score, 1), "desc": next((m["desc"] for m in g if m["desc"]), ""),
                    "links": [{"platform": m["src"], "url": m["url"]} for m in sorted(g, key=lambda m: m["rank"])][:4]})
    out.sort(key=lambda x: -x["score"])
    return out[:60]

def main():
    outp = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "data/hot.json"
    try: prev = {b["id"]: b for b in json.load(open(outp))["boards"]}
    except Exception: prev = {}
    boards = []
    with ThreadPoolExecutor(6) as ex:
        res = {bid: ex.submit(fn) for bid, _, fn in BOARDS}
    for bid, name, _ in BOARDS:
        try: items = res[bid].result()[:50]; at = NOW
        except Exception as e:
            print(name, "失败", str(e)[:80], file=sys.stderr); items, at = prev.get(bid, {}).get("items", []), prev.get(bid, {}).get("at", 0)
        print(name, len(items), file=sys.stderr)
        if items: boards.append({"id": bid, "name": name, "at": at, "items": items})
    if len(boards) < 3: sys.exit("拿到的榜单太少，hot.json 保持不变")
    json.dump({"updated": NOW, "boards": boards, "merged": merge(boards)}, open(outp, "w"), ensure_ascii=False, separators=(",", ":"))

if __name__ == "__main__":
    main()
