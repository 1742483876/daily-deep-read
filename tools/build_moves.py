#!/usr/bin/env python3
"""新闻 × 板块/个股异动：把 news.json 里的新闻映射到相关标的，抓分时/日K，生成 data/moves.json。
前端只渲染，不并发请求；云端 GitHub Actions 每 30 分钟跑一次。
用法: python3 tools/build_moves.py [--news data/news.json] [--out data/moves.json]
"""
import argparse, json, os, re, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}

# 关键词 → 腾讯行情代码。具体公司在前，板块 ETF 居中，大盘指数兜底在后。
# 说明文字（rel）会显示在卡片上，避免把「英伟达新闻」误当成英伟达本尊的行情。
MAP = [
    (["中芯国际"], "sh688981", "中芯国际"),
    (["寒武纪"], "sh688256", "寒武纪"),
    (["中际旭创", "光模块", "CPO", "光赛道", "光通信"], "sz300308", "光模块 / 中际旭创"),
    (["中科曙光"], "sh603019", "中科曙光"),
    (["比亚迪"], "sz002594", "比亚迪"),
    (["贵州茅台", "茅台"], "sh600519", "贵州茅台"),
    (["京东方"], "sz000725", "京东方"),
    (["立讯精密"], "sz002475", "立讯精密"),
    (["腾讯"], "hk00700", "腾讯控股"),
    (["阿里巴巴", "阿里云", "淘宝", "天猫"], "hk09988", "阿里巴巴"),
    (["美团"], "hk03690", "美团"),
    (["小米"], "hk01810", "小米集团"),
    (["英伟达", "NVDA", "GPU", "AI芯片", "芯片", "半导体", "存储", "SK海力士", "三星电子", "铠侠", "台积电", "晶圆", "光刻", "封装"], "sh512480", "半导体板块 ETF"),
    (["机器人", "具身智能", "人形机器人"], "sh562500", "机器人板块 ETF"),
    (["光模块", "算力", "数据中心", "智算中心"], "sh515880", "通信 / 算力 ETF"),
    (["人工智能", "大模型", "AI", "智能体", "Agent", "算法"], "sh515980", "人工智能板块 ETF"),
    (["新能源车", "电动车", "特斯拉", "车企"], "sh515030", "新能源车板块 ETF"),
    (["光伏", "储能", "锂电", "电池"], "sh515790", "光伏 / 储能 ETF"),
    (["折叠屏", "消费电子", "iPhone", "苹果", "华为", "面板"], "sz159732", "消费电子板块 ETF"),
    (["军工", "航天", "导弹", "国防", "卫星"], "sh512660", "军工板块 ETF"),
    (["券商", "证券", "IPO", "注册制"], "sh512880", "证券板块 ETF"),
    (["银行", "利率", "降息", "加息", "央行"], "sh512800", "银行板块 ETF"),
    (["白酒", "酒企", "茅台镇"], "sh512690", "酒板块 ETF"),
    (["黄金", "金价", "贵金属", "避险"], "sh518880", "黄金 ETF"),
    (["房地产", "楼市", "地产", "房企"], "sh512200", "房地产板块 ETF"),
    (["稀土", "小金属"], "sh516780", "稀土板块 ETF"),
    (["纳指", "纳斯达克", "美股", "标普", "道指", "华尔街"], "sh513100", "纳指 ETF"),
    (["日经", "日本股市", "东京股市", "软银", "铠侠"], "sh513520", "日经 ETF"),
    (["恒生", "港股", "恒指", "南向"], "sh513660", "恒生 ETF"),
    (["沪指", "上证", "A股", "两市", "大盘"], "sh000001", "上证指数"),
    (["创业板"], "sz399006", "创业板指"),
    (["科创", "科创板"], "sh000688", "科创 50"),
]

TOP_N = 10
MIN_PCT = 0.8          # |涨跌幅| 低于此不算异动；不够 6 条时放宽
WINDOW = 48 * 3600     # 只关联 48 小时内的新闻


def get(url, timeout=12):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


# 腾讯行情两个主机轮流被 WAF 501 拦（返回跳 waf.tencent.com 的 HTML 而非 JSON）。
# 两个都试一遍，拿到真 JSON 才算成功。
KHOSTS = ["https://web.ifzq.gtimg.cn", "https://ifzq.gtimg.cn"]


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


def match_sym(n):
    # 只用标题匹配：摘要里顺带提到的词容易造出「大众汽车 → 阿里巴巴」这种假关联
    text = n.get("title_zh") or n.get("title") or ""
    for kws, sym, rel in MAP:
        for k in kws:
            if k in text:
                return sym, rel, k
    return None, None, None


def quotes(syms):
    """一次批量拿简版报价: v_s_xxx="市场~名称~代码~现价~涨跌额~涨跌幅%~..." """
    out = {}
    for i in range(0, len(syms), 25):
        batch = syms[i:i + 25]
        try:
            raw = get("https://qt.gtimg.cn/q=" + ",".join("s_" + s for s in batch)).decode("gbk", "ignore")
            for line in raw.strip().split("\n"):
                if '="' not in line:
                    continue
                key = line.split('="')[0].replace("v_s_", "")
                f = line.split('="')[1].split("~")
                if len(f) > 5 and f[1]:
                    try:
                        out[key] = {"name": f[1], "price": float(f[3]), "pct": float(f[5])}
                    except ValueError:
                        pass
        except Exception as e:
            print("  quotes warn:", e, file=sys.stderr)
    return out


def curves(sym):
    """分时 + 日K，失败返回空数组，前端会自动降级"""
    minute, day = [], []
    try:
        j = kget("/appstock/app/minute/query?code=" + sym)
        d = j.get("data", {}).get(sym, {}).get("data", {})
        for s in d.get("data", []):
            p = str(s).strip().split()
            if len(p) >= 2:
                try:
                    v = float(p[1])
                    if v > 0:
                        minute.append({"t": p[0], "v": v})
                except ValueError:
                    pass
    except Exception as e:
        print(f"  minute {sym}: {e}", file=sys.stderr)
    try:
        j = kget("/appstock/app/fqkline/get?param=" + sym + ",day,,,40,qfq")
        d = j.get("data", {}).get(sym, {})
        for a in (d.get("qfqday") or d.get("day") or []):
            try:
                day.append({"d": str(a[0])[5:], "o": float(a[1]), "c": float(a[2]),
                            "h": float(a[3]), "l": float(a[4])})
            except (ValueError, IndexError):
                pass
    except Exception as e:
        print(f"  day {sym}: {e}", file=sys.stderr)
    return sym, minute, day


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--news", default="data/news.json")
    ap.add_argument("--out", default="data/moves.json")
    a = ap.parse_args()

    news = json.load(open(a.news, encoding="utf-8")).get("items", [])
    now = time.time()
    # 每个标的只留最新的一条新闻，避免同一个 ETF 刷屏
    picked = {}
    for n in sorted(news, key=lambda x: -(x.get("t") or 0)):
        if not n.get("t") or now - n["t"] > WINDOW:
            continue
        title = n.get("title_zh") or n.get("title") or ""
        # 汇总型快讯（早餐/日报）不是一条具体新闻，配标的没意义
        if re.search(r"早餐|早报|日报|周报|速览|汇总|一览|盘点", title):
            continue
        sym, rel, kw = match_sym(n)
        if not sym or sym in picked:
            continue
        links = n.get("links") or []
        picked[sym] = {
            "sym": sym, "rel": rel, "hit": kw,
            "id": n.get("id", ""),
            "title": n.get("title_zh") or n.get("title") or "",
            "time": n.get("t", 0),
            "src": n.get("creator", ""),
            "url": (links[0].get("url") if links and isinstance(links[0], dict) else ""),
        }
    print(f"新闻 {len(news)} 条 → 命中 {len(picked)} 个标的")

    q = quotes(list(picked.keys()))
    items = []
    for sym, base in picked.items():
        v = q.get(sym)
        if not v:
            continue
        base.update({"name": v["name"], "price": v["price"], "pct": v["pct"]})
        items.append(base)
    hot = [x for x in items if abs(x["pct"]) >= MIN_PCT]
    # 异动不够 6 条时放宽到全部命中，保证图卡流不空
    items = hot if len(hot) >= 6 else items
    # 异动幅度优先，同时轻微照顾新闻新鲜度
    items.sort(key=lambda x: -(abs(x["pct"]) * 2 + max(0, 12 - (now - x["time"]) / 3600) * 0.15))
    items = items[:TOP_N]
    print("入选异动:", ", ".join(f'{x["name"]} {x["pct"]:+.2f}%' for x in items))

    with ThreadPoolExecutor(max_workers=6) as ex:
        for sym, minute, day in ex.map(curves, [x["sym"] for x in items]):
            for x in items:
                if x["sym"] == sym:
                    x["minute"], x["day"] = minute, day
    for x in items:
        print(f'  {x["sym"]:12s} 分时 {len(x["minute"]):3d} 点 | 日K {len(x["day"]):2d} 根 | {x["title"][:28]}')

    out = {"updated": int(now), "at": time.strftime("%Y-%m-%d %H:%M"), "items": items}
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"写出 {a.out} ({os.path.getsize(a.out)} B)")


if __name__ == "__main__":
    main()
