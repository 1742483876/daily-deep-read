#!/usr/bin/env python3
"""猜涨跌题库：最近 N 天的财经快讯 × 相关标的的真实涨跌。

新闻池 = data/news.json（实时 7 天）+ data/news_history.json（历史快讯，每天抓一次）。
行情用腾讯 A股/港股/ETF 日K（本机与 GitHub Actions 都稳定），不依赖东财分钟线；
前端只渲染 data/quiz.json，不并发请求。

题目质量三条硬规则：
1. 标题不能自己把涨跌说出来（午评 / 现报 / 涨1.8% 一律不出题）；
2. 关联要站得住（AIT 里的 AI、印尼央行 → A股银行 ETF 一律不出题）；
3. 同一「标的 × 结果日」最多一题 —— 否则刷几题就会发现
   「又是半导体 11-25、答案又是跌」，题量再多也不算独立 case。

用法: python3 tools/build_quiz.py [--news data/news.json] [--history data/news_history.json]
                                  [--out data/quiz.json] [--force]
"""
import argparse, json, os, sys, time
import datetime as dt
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

from build_moves import MAP, get
from quiz_rules import clean_title, dedup_key, pick

# 腾讯行情两个主机轮流被 WAF 501 拦（返回一段跳 waf.tencent.com 的 HTML，不是 JSON）。
# 两个都试一遍，拿到真 JSON 才算成功。
KHOSTS = ["https://web.ifzq.gtimg.cn", "https://ifzq.gtimg.cn"]

CN = dt.timezone(dt.timedelta(hours=8))
DAYS = 14             # 只用最近 14 天的新闻
TOP_N = 110           # 题库上限（受「标的×结果日不重复」约束，实际可能略少）
MIN_PCT = 0.25        # |涨跌幅| 太小不出题（几乎等于抛硬币）
PREV_N = 10           # 出题时展示的结果日之前的 K 线根数
MAX_PER_SYM = 14      # 单个标的最多 14 题，避免一半题都是半导体
SYMS = sorted({s for _, s, _ in MAP})


def kget(path):
    last = None
    for h in KHOSTS:
        try:
            raw = get(h + path)
            if raw[:1] == b"<" or b"waf.tencent.com" in raw[:300]:
                raise ValueError("WAF 501")
            return json.loads(raw)
        except Exception as e:
            last = e
    raise last


def day_kline(sym):
    """日K，保留完整日期 YYYY-MM-DD；失败返回空数组由上层决定沿用旧题库"""
    rows, last = [], None
    for attempt in range(2):
        try:
            j = kget("/appstock/app/fqkline/get?param=" + sym + ",day,,,60,qfq")
            d = (j.get("data") or {}).get(sym, {})
            for a in (d.get("qfqday") or d.get("day") or []):
                try:
                    rows.append({"d": str(a[0])[:10], "o": float(a[1]), "c": float(a[2]),
                                 "h": float(a[3]), "l": float(a[4])})
                except (ValueError, IndexError):
                    pass
            if rows:
                return sym, rows
        except Exception as e:
            last = e
        if attempt == 0:
            time.sleep(0.6)
    print(f"  day {sym}: {type(last).__name__ if last else '空数据'}", file=sys.stderr)
    return sym, rows


def load_pool(paths):
    """把实时池 + 历史池归一成同一结构，按标题去重。"""
    pool, seen = [], set()
    for p in paths:
        if not os.path.exists(p):
            print(f"  {p} 不存在，跳过")
            continue
        items = json.load(open(p, encoding="utf-8")).get("items", [])
        print(f"  {os.path.basename(p)}: {len(items)} 条")
        for n in items:
            t = n.get("t") or 0
            title = clean_title(n.get("title_zh") or n.get("title") or "")
            if not t or not title:
                continue
            k = dedup_key(title)
            if k in seen:
                continue
            seen.add(k)
            links = n.get("links") or []
            url = n.get("url") or (links[0].get("url") if links and isinstance(links[0], dict) else "")
            pool.append({"id": n.get("id", ""), "key": k, "title": title,
                         "src": n.get("creator") or n.get("src") or "", "t": t, "url": url})
    return pool


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--news", default="data/news.json")
    ap.add_argument("--history", default="data/news_history.json")
    ap.add_argument("--out", default="data/quiz.json")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    now = time.time()
    today = dt.datetime.now(CN).strftime("%Y-%m-%d")
    # 日K 一天才变一次，workflow 每 30 分钟没必要重抓；今天已生成完整题库就直接跳过
    if not a.force and os.path.exists(a.out):
        try:
            old = json.load(open(a.out, encoding="utf-8"))
            if old.get("at", "")[:10] == today and len(old.get("items") or []) >= 70:
                print(f"今日题库已生成（{len(old['items'])} 题），跳过重新抓取")
                return
        except (ValueError, OSError):
            pass

    pool = load_pool([a.news, a.history])
    cand = []
    for n in pool:
        t = n["t"]
        if not t or now - t > DAYS * 86400 or t > now + 900:
            continue
        r = pick(n["title"])
        if r:
            cand.append((n, r[0], r[1], r[2]))
    print(f"合并后可出题新闻 {len(cand)} 条 / 池 {len(pool)} 条")

    # 只抓新闻实际会用到的标的，别固定抓 32 个把自己打到 WAF
    wanted = {s for _, s, _, _ in cand}
    syms = [s for s in SYMS if s in wanted] or SYMS[:6]
    print("待抓日K标的:", len(syms), "（按需，共", len(SYMS), "个）")
    with ThreadPoolExecutor(max_workers=3) as ex:
        kl = dict(ex.map(day_kline, syms))
    ok = sum(1 for v in kl.values() if len(v) > 12)
    print(f"日K 有效 {ok}/{len(syms)} 个标的")
    if ok == 0:
        print("行情源全不可用，沿用上一版题库，不写空文件")
        raise SystemExit(1)

    latest = max((r["d"] for v in kl.values() for r in v), default="")
    used_pair, per_sym, buckets = set(), defaultdict(int), defaultdict(list)

    for n, sym, rel, hit in sorted(cand, key=lambda x: -x[0]["t"]):
        rows = kl.get(sym) or []
        if len(rows) < PREV_N + 2:
            continue
        t = n["t"]
        nd = dt.datetime.fromtimestamp(t, CN).strftime("%Y-%m-%d")
        # 历史新闻 → 猜「发布后第一个交易日」；最新交易日的新闻没有未来数据，
        # 改猜「当日方向」，题面会写明是哪一种，不混淆口径。
        nxt = next((i for i, r in enumerate(rows) if r["d"] > nd), None)
        if nxt is not None and nxt >= PREV_N // 2:
            idx, kind = nxt, "next"
        elif nd == latest:
            # 收盘后才发的新闻不能猜当天，结果已经写在那儿了
            if dt.datetime.fromtimestamp(t, CN).strftime("%H%M") >= "1455":
                continue
            idx = next((i for i, r in enumerate(rows) if r["d"] == nd), None)
            kind = "same"
            if idx is None or idx < PREV_N // 2:
                continue
        else:
            continue
        result, prev_last = rows[idx], rows[idx - 1]
        if prev_last["c"] <= 0:
            continue
        pct = (result["c"] - prev_last["c"]) / prev_last["c"] * 100
        if abs(pct) < MIN_PCT:
            continue
        pair = (sym, result["d"])
        if pair in used_pair or per_sym[sym] >= MAX_PER_SYM:
            continue
        used_pair.add(pair)
        per_sym[sym] += 1
        buckets[nd].append({
            "id": (n["id"] or n["key"]) + "|" + sym + "|" + result["d"],
            "title": n["title"], "src": n["src"], "time": t,
            "hm": dt.datetime.fromtimestamp(t, CN).strftime("%m-%d %H:%M"),
            "sym": sym, "name": rel, "hit": hit, "url": n["url"],
            "day": result["d"], "kind": kind,
            "pct": round(pct, 2), "ans": "up" if pct > 0 else "down",
            "prev": rows[max(0, idx - PREV_N):idx],
            "result": result,
        })

    # 按新闻日期分层轮转：每天各出一题再进入下一轮，避免 110 题里前 100 题都挤在今天；
    # 同时相邻两题尽量「标的不同 + 涨跌交替」，不连续刷同一个答案。
    days = sorted(buckets, reverse=True)
    picked = []
    while len(picked) < TOP_N and any(buckets[d] for d in days):
        moved = False
        for d in days:
            lst = buckets[d]
            if not lst:
                continue
            ls = picked[-1]["sym"] if picked else None
            la = picked[-1]["ans"] if picked else None
            j = next((i for i, x in enumerate(lst) if x["sym"] != ls and x["ans"] != la), None)
            if j is None:
                j = next((i for i, x in enumerate(lst) if x["sym"] != ls), 0)
            picked.append(lst.pop(j))
            moved = True
            if len(picked) >= TOP_N:
                break
        if not moved:
            break

    ups = sum(1 for x in picked if x["ans"] == "up")
    ndays = len({x["hm"][:5] for x in picked})
    nres = len({x["day"] for x in picked})
    nsym = len({x["sym"] for x in picked})
    print(f"题库 {len(picked)} 题｜涨 {ups} / 跌 {len(picked) - ups}｜"
          f"新闻 {ndays} 天｜结果日 {nres} 个｜标的 {nsym} 个｜"
          f"最大幅度 {max((abs(x['pct']) for x in picked), default=0):.2f}%")
    for x in picked[:6]:
        print(f'  {x["hm"]} {x["name"][:10]:10s} {x["pct"]:+6.2f}% {x["day"]} | {x["title"][:32]}')

    if len(picked) < 20:
        print("可用题目太少，沿用上一版题库，不写空文件")
        raise SystemExit(1)
    ds = sorted({x["hm"][:5] for x in picked})
    out = {"at": dt.datetime.now(CN).strftime("%Y-%m-%d %H:%M"),
           "days": DAYS, "count": len(picked), "span": (ds[0] + " ~ " + ds[-1]) if ds else "",
           "items": picked}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {a.out} ({os.path.getsize(a.out)} B)")


if __name__ == "__main__":
    main()
