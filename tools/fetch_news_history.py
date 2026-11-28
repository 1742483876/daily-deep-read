#!/usr/bin/env python3
"""抓最近 N 天的财经快讯历史，给「猜涨跌」题库扩充新闻池。
三个源都支持分页：东财 sortEnd 游标 / 新浪 7x24 page / 华尔街见闻 cursor。
历史新闻不变，一天抓一次就够；输出 data/news_history.json。

抓的时候就用 quiz_rules 做初筛，只留「能出题」的新闻：
标题泄露涨跌、汇总复盘型、弱关联的一律不留，历史池体积能小一半以上。
用法: python3 tools/fetch_news_history.py [--days 14] [--out data/news_history.json] [--force]
"""
import argparse, hashlib, json, os, re, sys, time, urllib.request
import datetime as dt

from quiz_rules import clean_title, dedup_key, pick

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
CN = dt.timezone(dt.timedelta(hours=8))


def get(u, timeout=12):
    return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=timeout).read()


def cn_ts(s):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return int(dt.datetime.strptime(s, fmt).replace(tzinfo=CN).timestamp())
        except ValueError:
            pass
    return 0


def mkid(src, title, t):
    return hashlib.md5((src + "|" + title + "|" + str(t)).encode("utf-8")).hexdigest()[:16]


def add(out, src, title, t, url):
    title = clean_title(title)
    if not title or not t or not url:
        return
    if not pick(title):
        return
    out.append({"id": mkid(src, title, t), "title": title, "src": src, "t": t, "url": url})


def eastmoney(out, floor):
    base = ("https://np-listapi.eastmoney.com/comm/web/getFastNewsList?"
            "client=web&biz=web_724&fastColumn=102&sortEnd={}&pageSize=100&req_trace=1")
    se, pages = "", 0
    for _ in range(60):
        try:
            d = (json.loads(get(base.format(se))).get("data") or {})
            lst = d.get("fastNewsList") or []
            if not lst:
                break
            pages += 1
            oldest = 10 ** 12
            for r in lst:
                t = cn_ts(r.get("showTime") or "")
                oldest = min(oldest, t)
                title = r.get("title") or re.sub(r"^【.*?】", "", r.get("summary") or "")
                add(out, "东方财富", title[:90], t,
                    f"https://finance.eastmoney.com/a/{r.get('code', '')}.html")
            nxt = str(d.get("sortEnd") or "")
            if not nxt or nxt == se or oldest < floor:
                break
            se = nxt
            time.sleep(0.1)
        except Exception as e:
            print(f"  东财第 {pages+1} 页失败: {type(e).__name__}", file=sys.stderr)
            break
    return pages


def sina(out, floor):
    pages = 0
    for p in range(1, 61):
        try:
            u = f"https://zhibo.sina.com.cn/api/zhibo/feed?page={p}&page_size=60&zhibo_id=152"
            f = ((json.loads(get(u)).get("result") or {}).get("data") or {}).get("feed") or {}
            lst = f.get("list") or []
            if not lst:
                break
            pages += 1
            oldest = 10 ** 12
            for r in lst:
                t = cn_ts(r.get("create_time") or "")
                oldest = min(oldest, t)
                txt = re.sub(r"<[^>]+>", "", r.get("rich_text") or "")
                m = re.match(r"【(.+?)】", txt)
                title = m.group(1) if m else txt[:70]
                add(out, "新浪财经", title, t, r.get("docurl") or "https://finance.sina.com.cn/7x24/")
            if oldest < floor:
                break
            time.sleep(0.1)
        except Exception as e:
            print(f"  新浪第 {p} 页失败: {type(e).__name__}", file=sys.stderr)
            break
    return pages


def wscn(out, floor):
    base = "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=100&cursor={}"
    cur, pages = "", 0
    for _ in range(40):
        try:
            d = json.loads(get(base.format(cur))).get("data") or {}
            lst = d.get("items") or []
            if not lst:
                break
            pages += 1
            oldest = 10 ** 12
            for r in lst:
                t = int(r.get("display_time") or 0)
                oldest = min(oldest, t)
                title = (r.get("title") or "").strip() or re.sub(r"\s+", " ", r.get("content_text") or "")[:70]
                add(out, "华尔街见闻", title, t, r.get("uri") or "https://wallstreetcn.com/live/global")
            nxt = str(d.get("next_cursor") or "")
            if not nxt or nxt == cur or oldest < floor:
                break
            cur = nxt
            time.sleep(0.1)
        except Exception as e:
            print(f"  见闻第 {pages+1} 页失败: {type(e).__name__}", file=sys.stderr)
            break
    return pages


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--out", default="data/news_history.json")
    ap.add_argument("--force", action="store_true", help="忽略当日缓存，强制重抓")
    a = ap.parse_args()
    now = time.time()
    floor = now - a.days * 86400
    # 同一天已抓过就跳过，别每次 workflow 都打接口
    today = dt.datetime.now(CN).strftime("%Y-%m-%d")
    if not a.force and os.path.exists(a.out):
        try:
            old = json.load(open(a.out, encoding="utf-8"))
            if old.get("at", "")[:10] == today and len(old.get("items") or []) > 300:
                print(f"今日已抓（{len(old['items'])} 条），跳过")
                return
        except (ValueError, OSError):
            pass

    raw = []
    for name, fn in (("东方财富", eastmoney), ("新浪财经", sina), ("华尔街见闻", wscn)):
        n = fn(raw, floor)
        print(f"{name}: 翻了 {n} 页，累计 {len(raw)} 条候选")

    seen, items = set(), []
    for x in sorted(raw, key=lambda y: -y["t"]):
        if x["t"] < floor or x["t"] > now + 900:
            continue
        k = dedup_key(x["title"])
        if k in seen:
            continue
        seen.add(k)
        items.append(x)
    print(f"合并去重后 {len(items)} 条｜"
          f"时间 {dt.datetime.fromtimestamp(items[-1]['t'], CN).strftime('%m-%d') if items else '-'}"
          f" ~ {dt.datetime.fromtimestamp(items[0]['t'], CN).strftime('%m-%d') if items else '-'}")
    if len(items) < 300:
        print("抓到的历史新闻太少，沿用上一版，不写新文件")
        raise SystemExit(1)
    out = {"at": dt.datetime.now(CN).strftime("%Y-%m-%d %H:%M"),
           "days": a.days, "count": len(items), "items": items,
           "span": [dt.datetime.fromtimestamp(items[-1]["t"], CN).strftime("%m-%d"),
                    dt.datetime.fromtimestamp(items[0]["t"], CN).strftime("%m-%d")]}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {a.out} ({os.path.getsize(a.out)} B)")


if __name__ == "__main__":
    main()
