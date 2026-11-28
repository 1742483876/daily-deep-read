#!/usr/bin/env python3
"""新闻时刻 × 纳斯达克分时异动：把每条新闻按发布时间对齐到分时曲线上。
输出 data/events.json（series 存曲线，items 存新闻时刻），前端纯渲染。
用法: python3 tools/build_events.py [--news data/news.json] [--out data/events.json]
"""
import argparse, json, os, time, urllib.request, datetime as dt
from concurrent.futures import ThreadPoolExecutor

# 东财分时时间字符串是北京时间；news.json 的 t 是显式 UTC+8 的绝对时间戳。
# 绝对不能用 time.mktime（按系统本地时区解析）：云端 runner 是 UTC，会差 8 小时，
# 把「昨晚的分时曲线」配到「今天白天的新闻」上，整条时间对齐就废了。
CN = dt.timezone(dt.timedelta(hours=8))


def ts(s):
    return dt.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=CN).timestamp()

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

# 顺序即优先级：先具体公司，再泛指数
MAP = [
    (["英伟达", "NVDA", "黄仁勋", "GPU", "B300", "Blackwell"], "105.NVDA", "英伟达"),
    (["Meta Platforms", "Meta", "脸书", "扎克伯格"], "105.META", "Meta"),
    (["特斯拉", "Cybertruck", "TSLA"], "105.TSLA", "特斯拉"),
    (["美光", "HBM", "DRAM", "存储芯片"], "105.MU", "美光"),
    (["AMD", "超威半导体", "MI300"], "105.AMD", "AMD"),
    (["台积电", "TSM", "CoWoS"], "106.TSM", "台积电"),
    (["博通", "AVGO", "ASIC"], "105.AVGO", "博通"),
    (["苹果", "iPhone", "AAPL", "库克"], "105.AAPL", "苹果"),
    (["微软", "MSFT", "Azure", "Copilot"], "105.MSFT", "微软"),
    (["谷歌", "GOOGL", "Gemini", "Alphabet"], "105.GOOGL", "谷歌"),
    # 新增：纳斯达克权重股 / 近期真异动标的，让 case 落在具体公司而不是硬凑指数
    (["英特尔", "Intel", "INTC"], "105.INTC", "英特尔"),
    (["甲骨文", "Oracle", "ORCL"], "105.ORCL", "甲骨文"),
    (["Palantir", "PLTR"], "105.PLTR", "Palantir"),
    (["超微电脑", "SMCI"], "105.SMCI", "超微电脑"),
    (["亚马逊", "Amazon", "AMZN", "AWS"], "105.AMZN", "亚马逊"),
    # 泛指数只认明确的美股宏观词：别把「复旦教授谈半导体」「太空算力概念股」
    # 这类国内政策/概念新闻硬挂到纳斯达克上（假关联）
    (["纳指", "纳斯达克", "美股", "美联储", "褐皮书", "标普500", "道指", "华尔街",
      "科技股", "美债", "非农"], "100.NDX", "纳斯达克综指"),
]

SECS = ["105.NVDA", "105.META", "105.TSLA", "105.MU", "105.AMD", "106.TSM",
        "105.AVGO", "105.AAPL", "105.MSFT", "105.GOOGL", "100.NDX", "105.QQQ",
        "105.INTC", "105.ORCL", "105.PLTR", "105.SMCI", "105.AMZN"]

# 东财 secid → 腾讯美股代码。腾讯完整报价里 f[4]=昨收、f[32]=当日涨跌幅(相对昨收)
QSYM = {
    "105.NVDA": "usNVDA", "105.META": "usMETA", "105.TSLA": "usTSLA",
    "105.MU": "usMU", "105.AMD": "usAMD", "106.TSM": "usTSM",
    "105.AVGO": "usAVGO", "105.AAPL": "usAAPL", "105.MSFT": "usMSFT",
    # 东财 100.NDX 的曲线数值实际是纳斯达克综合(IXIC)，不是纳指100，别错配
    "105.GOOGL": "usGOOGL", "100.NDX": "usIXIC", "105.QQQ": "usQQQ",
    "105.INTC": "usINTC", "105.ORCL": "usORCL", "105.PLTR": "usPLTR",
    "105.SMCI": "usSMCI", "105.AMZN": "usAMZN",
}

STRIP = ["早餐", "早报", "日报", "周报", "速览", "汇总", "一览", "盘点"]
TOP_N = 16
STEP = 3          # 分时降采样：391 点 → 约 131 点


def get(url, timeout=12):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def quotes():
    """腾讯美股完整报价，返回 {secid: {pre, pct, last}}。
    pct 是「相对昨收的当日涨跌幅」，与新闻口径一致；
    不能用分时首点当基准——低开日会把「收跌」算成「上涨」。
    """
    u = "https://qt.gtimg.cn/q=" + ",".join(QSYM.values())
    raw = get(u).decode("gbk", "replace")
    out = {}
    for chunk in raw.split(";"):
        chunk = chunk.strip()
        if not chunk.startswith("v_"):
            continue
        key = chunk.split("=")[0][2:]
        try:
            f = chunk.split('"')[1].split("~")
            last, pre, pct = float(f[3]), float(f[4]), float(f[32])
            if last > 0 and pre > 0:
                out[key] = {"pre": round(pre, 4), "pct": round(pct, 2), "last": round(last, 4)}
        except (IndexError, ValueError):
            pass
    return {sec: out[s] for sec, s in QSYM.items() if s in out}


def trend(sec):
    u = ("https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=" + sec +
         "&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55,f56,f57,f58&ndays=2&iscr=0&iscca=0")
    # 东财偶发 RemoteDisconnected：单个标的失败必须隔离，不能让整批生成崩掉
    for attempt in range(2):
        try:
            j = json.loads(get(u))
            rows = []
            for s in (j.get("data") or {}).get("trends") or []:
                f = s.split(",")
                try:
                    rows.append((f[0], float(f[2])))
                except (ValueError, IndexError):
                    pass
            return sec, rows
        except Exception as e:
            if attempt == 0:
                time.sleep(0.8)
                continue
            print(f"  {sec} 分时失败({type(e).__name__})，跳过该标的")
            return sec, []
    return sec, []


def sessions(rows):
    """以 22:30（美股开盘，北京时间）为界切出交易日"""
    out, cur = [], []
    for x in rows:
        if x[0][11:] == "22:30":
            if len(cur) > 30:
                out.append(cur)
            cur = []
        cur.append(x)
    if len(cur) > 30:
        out.append(cur)
    return out


def match(title):
    for kws, sec, name in MAP:
        if any(k in title for k in kws):
            return sec, name
    return None, None


def hm(t):
    return dt.datetime.fromtimestamp(t, CN).strftime("%Y-%m-%d %H:%M")


def patch_quotes(out_path, q):
    """分时源不可用时，只刷新昨收口径，不动曲线和配对结果。
    用曲线末点对比报价现价，偏差 >2% 视为已换日，不硬套新报价。
    """
    d = json.load(open(out_path, encoding="utf-8"))
    n = 0
    for sec, s in (d.get("series") or {}).items():
        rows = s.get("rows") or []
        if not rows:
            continue
        qd = q.get(sec)
        if qd and abs(qd["last"] - rows[-1]["v"]) / max(rows[-1]["v"], 1e-9) > 0.02:
            qd = None
        if qd:
            s["pre"], s["pct"] = qd["pre"], qd["pct"]
            n += 1
        # 补「开盘→收盘」日内幅度，只作参考，主口径始终是相对昨收
        if len(rows) > 1 and rows[0]["v"]:
            s["intraday"] = round((rows[-1]["v"] - rows[0]["v"]) / rows[0]["v"] * 100, 2)
    # 历史数据里 100.NDX 曾被误标成「纳斯达克100」，按曲线数值更正为综指
    if "100.NDX" in (d.get("series") or {}):
        d["series"]["100.NDX"]["name"] = "纳斯达克综指"
    for it in d.get("items") or []:
        s = (d.get("series") or {}).get(it.get("sym"))
        if s:
            it["pct"] = s.get("pct")
            it["name"] = s.get("name", it.get("name"))
    d["quote_at"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    print(f"刷新昨收口径 {n}/{len(d.get('series') or {})} 个标的 → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--news", default="data/news.json")
    ap.add_argument("--out", default="data/events.json")
    ap.add_argument("--patch-only", action="store_true",
                    help="分时源不可用时，只用腾讯报价刷新昨收/当日涨跌幅")
    a = ap.parse_args()

    if a.patch_only:
        patch_quotes(a.out, quotes())
        return

    news = json.load(open(a.news, encoding="utf-8")).get("items", [])
    # 只抓「最近 48h 新闻实际会用到」的标的：固定抓 17 个会触发东财限流
    recent = [n for n in news if (n.get("t") or 0) >= time.time() - 48 * 3600]
    wanted = set()
    for n in recent:
        title = n.get("title_zh") or n.get("title") or ""
        if any(k in title for k in STRIP):
            continue
        sec, _ = match(title)
        if sec:
            wanted.add(sec)
    secs = [s for s in SECS if s in wanted] or SECS[:6]
    print("本次只需抓", len(secs), "个标的:", ", ".join(secs))
    with ThreadPoolExecutor(max_workers=3) as ex:
        raw = dict(ex.map(trend, secs))
    print("分时标的:", ", ".join(f"{k}:{len(v)}" for k, v in raw.items()))
    try:
        q = quotes()
        print("昨收报价:", len(q), "个标的（腾讯，口径=相对昨收）")
    except Exception as e:
        q = {}
        print("昨收报价不可用:", type(e).__name__, "→ 用前一时段末值兜底")

    # 每个标的的最近 2 个交易日；series 只存曲线一次
    series = {}
    if not any(raw.values()) and os.path.exists(a.out):
        # 分时源整体被限流：复用上一次的曲线，仍按最新新闻重新配对（新映射规则照常生效）
        print("分时源不可用 → 复用已有曲线，按最新新闻重新配对")
        prev = json.load(open(a.out, encoding="utf-8"))
        for sec, s in (prev.get("series") or {}).items():
            rows = s.get("rows") or []
            if not rows:
                continue
            d0, d1 = s["start"][:10], s["end"][:10]
            # rows 每 STEP 分钟一点；跨午夜的凌晨归 end 那天
            s["_full"] = [((d1 if r["t"] < "12:00" else d0) + " " + r["t"], r["v"]) for r in rows]
            s["_reuse"] = True
            qd = q.get(sec)
            if qd and abs(qd["last"] - rows[-1]["v"]) / max(rows[-1]["v"], 1e-9) <= 0.02:
                s["pre"], s["pct"] = qd["pre"], qd["pct"]
            series[sec] = s
    else:
        for sec, rows in raw.items():
            ss = sessions(rows)
            if not ss:
                continue
            seg = ss[-1]                      # 最近一个完整交易日
            vals = [v for _, v in seg]
            qd = q.get(sec)
            # 报价与分时必须是同一交易日；盘中价差 >2% 说明错配，宁可不显示也不给错数字
            if qd and abs(qd["last"] - vals[-1]) / max(vals[-1], 1e-9) > 0.02:
                qd = None
            pre = qd["pre"] if qd else (ss[-2][-1][1] if len(ss) > 1 else None)
            pct = qd["pct"] if qd else (
                round((vals[-1] - pre) / pre * 100, 2) if pre else None)
            series[sec] = {
                "name": next((n for _, s, n in MAP if s == sec), sec),
                "start": seg[0][0], "end": seg[-1][0],
                "pre": round(pre, 4) if pre else None,
                "pct": pct,                  # 相对昨收的当日涨跌幅；取不到时为 null
                "intraday": round((vals[-1] - vals[0]) / vals[0] * 100, 2),
                "rows": [{"t": t[11:], "v": round(v, 4)} for i, (t, v) in enumerate(seg) if i % STEP == 0],
                "_full": seg,
            }
    if "105.QQQ" in series:
        series["105.QQQ"]["name"] = "纳指100 ETF"

    # 时间窗：开盘 → 收盘后 18 小时。盘前新闻会被钳到曲线首点（竖线贴左边缘），不要收。
    # 中文财经快讯大多在收盘后的白天才发，全放进来的同时用 post 明确标注「盘后报道」，
    # 不把白天新闻伪装成「新闻后 15 分钟异动」。
    all_starts = [s["start"] for s in series.values()]
    all_ends = [s["end"] for s in series.values()]
    if not all_starts:
        print("无分时数据，交给 patch-only 兜底")
        raise SystemExit(1)
    t0, t1 = ts(min(all_starts)), ts(max(all_ends)) + 18 * 3600

    items = []
    for n in sorted(news, key=lambda x: x.get("t") or 0):
        t = n.get("t") or 0
        if not (t0 <= t <= t1):
            continue
        title = n.get("title_zh") or n.get("title") or ""
        if any(k in title for k in STRIP):
            continue
        sec, name = match(title)
        if not sec or sec not in series:
            continue
        seg = series[sec]["_full"]
        reuse = series[sec].get("_reuse", False)
        # 全量分时 1 点/分钟 → 15 点 = 15 分钟；复用曲线是降采样 → 15/STEP 点
        win = max(1, round(15 / STEP)) if reuse else 15
        when = hm(t)
        # 找最接近新闻时刻的分时点；超过收盘则钳到最后一点并标「盘后」
        idx = min(range(len(seg)), key=lambda i: abs(ts(seg[i][0]) - t))
        post = t > ts(seg[-1][0])
        i = idx if not post else len(seg) - 1
        p = seg[i][1]
        before = (p - seg[max(0, i - win)][1]) / seg[max(0, i - win)][1] * 100
        after = (seg[min(len(seg) - 1, i + win)][1] - p) / p * 100 if not post else 0.0
        mark = i if reuse else min(len(series[sec]["rows"]) - 1, round(i / STEP))
        links = n.get("links") or []
        url = links[0].get("url", "") if links and isinstance(links[0], dict) else ""
        items.append({
            "sym": sec, "name": series[sec]["name"], "id": n.get("id", ""),
            "title": title, "hm": when[11:], "time": t, "src": n.get("creator", ""), "url": url,
            "mark": mark,
            "before": round(before, 2), "after": round(after, 2), "post": post,
            "pct": series[sec]["pct"],
        })

    # 同一标的+同一分钟去重；按「新闻后 15 分钟异动幅度」排，盘后总结放后面
    seen, uniq, post_sym = set(), [], set()
    for x in items:
        k = (x["sym"], x["hm"])
        if k in seen:
            continue
        # 盘后新闻的曲线完全相同（竖线都在收盘处），同标的只留 1 条，避免刷屏
        if x["post"]:
            if x["sym"] in post_sym:
                continue
            post_sym.add(x["sym"])
        seen.add(k)
        uniq.append(x)
    # 盘中真对齐优先；盘后报道最多 8 条，且排在后面，不喧宾夺主
    live = sorted([x for x in uniq if not x["post"]], key=lambda x: -abs(x["after"]))
    post = sorted([x for x in uniq if x["post"]], key=lambda x: -abs(x["pct"] or 0))
    uniq = (live[:TOP_N] + post[:8])[:TOP_N]
    print(f"配对 case: {len(items)} → 去重后取 {len(uniq)} 条")
    for x in uniq:
        print(f'  {x["hm"]} {x["name"]:10s} 前15′{x["before"]:+.2f}% 后15′{x["after"]:+.2f}%'
              f' {"[盘后]" if x["post"] else ""} | {x["title"][:36]}')

    for s in series.values():
        s.pop("_full", None)
        s.pop("_reuse", None)
    out = {"at": dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
           "session": min(all_starts) + " ~ " + max(all_ends),
           "series": series, "items": uniq}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {a.out} ({os.path.getsize(a.out)} B)")


if __name__ == "__main__":
    main()
