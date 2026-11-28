#!/usr/bin/env python3
"""英文新闻中文译文：把 translations.json 合并进 news.json，并给新出现的英文条目自动补译。

用法（GitHub Actions 里在 fetch_news.py 之后跑）：
  python3 tools/translate_news.py --news data/news.json --trans data/translations.json
  python3 tools/translate_news.py ... --no-auto       # 只合并，不联网翻译（本机离线校验用）

设计要点
- news.json 每 30 分钟被 fetch_news.py 整个重写，译文不能只写在里面；translations.json 是持久词表，
  key 是新闻 id（URL 的 md5，稳定），每次抓取后重新合并。
- src=manual 的人工精翻永不被自动翻译覆盖。
- 接口优先 Google gtx（GitHub 的美国 IP 可用），失败退 MyMemory；都失败就留空，前端显示英文原文并标「待翻译」。
- 涉政 / 军事 / 战争 / 涉华争议类条目不自动翻译（src=skip），保留英文原文。
- 词表里超过 14 天、且已不在当前 news.json 的条目会被清掉，避免无限膨胀。
"""
import argparse, html, json, os, re, sys, time, urllib.parse, urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"
MAX_NEW = 40          # 单次最多补译多少条，避免拖垮 workflow / 撞免费额度
KEEP_DAYS = 14
# 只翻科技 / 商业 / 财经 / 科学 / 生活，涉政与战争类保留原文
SKIP = re.compile(
    r"Trump|Biden|Putin|Ukraine|Russia|Houthi|Iran|Israel|Gaza|war\b|missile|military|Army|Navy|"
    r"Congress|White House|election|protest|spy|espionage|Beijing|Chinese spy|Huawei.*steal|"
    r"tariff|sanction|president|prime minister|总理|总统|战争|导弹|军事|间谍|抗议|选举|关税|制裁", re.I)


def is_en(s):
    s = s or ""
    lat = len(re.findall(r"[A-Za-z]", s))
    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    return lat >= 8 and cjk / (lat + cjk + 1e-9) < 0.08


def need_zh(it):
    return is_en(it.get("title", "")) or is_en(it.get("intro", ""))


def get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


_GTX_OK = True      # 本轮里 gtx 一旦不通就别每条都等超时（国内网络常被挡）
def gtx(text):
    """Google 免费网页翻译端点；返回译文或 None"""
    global _GTX_OK
    u = "https://translate.googleapis.com/translate_a/single?" + urllib.parse.urlencode(
        {"client": "gtx", "sl": "en", "tl": "zh-CN", "dt": "t", "q": text})
    raw = get(u, timeout=4)
    if not raw.startswith("["):
        _GTX_OK = False
        return None
    d = json.loads(raw)
    out = "".join(seg[0] for seg in d[0] if seg and seg[0])
    return out.strip() or None


def mymemory(text):
    u = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(
        {"q": text, "langpair": "en|zh-CN"})
    d = json.loads(get(u, timeout=10))
    if d.get("responseStatus") != 200:
        return None
    return html.unescape(d["responseData"]["translatedText"]).strip() or None


def auto(text):
    global _GTX_OK
    for fn, tag in ((gtx, "gtx"), (mymemory, "mymemory")):
        if tag == "gtx" and not _GTX_OK:
            continue
        try:
            r = fn(text[:480])
            if r and not re.fullmatch(r"[A-Za-z0-9\s\W]+", r):   # 还是英文就当失败
                return r, tag
        except Exception as e:
            if tag == "gtx": _GTX_OK = False
            print(f"  {tag} 失败: {str(e)[:70]}", file=sys.stderr)
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--news", default="data/news.json")
    ap.add_argument("--trans", default="data/translations.json")
    ap.add_argument("--no-auto", action="store_true")
    a = ap.parse_args()

    news = json.load(open(a.news, encoding="utf-8"))
    try:
        trans = json.load(open(a.trans, encoding="utf-8"))
    except Exception:
        trans = {"version": 1, "items": {}}
    table = trans.setdefault("items", {})
    items = news.get("items", [])
    now = int(time.time())
    ids = {x["id"] for x in items}
    before = json.dumps(table, ensure_ascii=False, sort_keys=True)

    # 1) 增量补译（云端 workflow 有 8 分钟上限，翻译最多花 3 分钟）
    new = 0
    deadline = time.time() + 180
    for it in items:
        if time.time() > deadline:
            print("  翻译用时到上限，剩下的留给下一轮", file=sys.stderr)
            break
        e = table.get(it["id"])
        if not need_zh(it):
            continue
        if e and e.get("src") == "pending" and now - (e.get("rt") or 0) < 20 * 60:
            continue          # 翻译接口刚才不通，20 分钟后再试（云端现在每 7 分钟一轮，等 6 小时太久）
        if e and e.get("src") in ("manual", "skip", "gtx", "mymemory"):
            continue
        if SKIP.search(it.get("title", "") + " " + it.get("intro", "")):
            table[it["id"]] = {"src": "skip", "t": it.get("t") or now}
            continue
        if a.no_auto or new >= MAX_NEW:
            continue
        t0 = time.time()
        tz, tag = auto(it.get("title", ""))
        iz, _ = auto(it.get("intro", "")) if it.get("intro") else ("", None)
        if tz:
            table[it["id"]] = {"title_zh": tz, "intro_zh": iz or "", "src": tag, "t": it.get("t") or now}
            new += 1
            print(f"  译 {it['id']} {tag} {time.time() - t0:.1f}s  {tz[:36]}", file=sys.stderr)
        else:
            table[it["id"]] = {"src": "pending", "t": it.get("t") or now, "rt": now}

    # 2) 合并进 news.json（原文始终保留，译文是额外字段）
    merged = 0
    for it in items:
        e = table.get(it["id"])
        if need_zh(it):
            it["title_en"] = it.get("title", "")
            it["intro_en"] = it.get("intro", "")
        if e and e.get("title_zh"):
            it["title_zh"] = e["title_zh"]
            it["intro_zh"] = e.get("intro_zh", "")
            it["zh_src"] = e.get("src", "manual")
            merged += 1
        else:
            it.pop("title_zh", None); it.pop("intro_zh", None); it.pop("zh_src", None)

    # 3) 清理过期词表
    for k in list(table):
        e = table[k]
        if k not in ids and now - (e.get("t") or 0) > KEEP_DAYS * 86400:
            del table[k]

    json.dump(news, open(a.news, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    # 词表没变化就不写，免得每 30 分钟制造一次无意义提交
    if json.dumps(table, ensure_ascii=False, sort_keys=True) != before or not os.path.exists(a.trans):
        trans["version"] = 1
        trans["updated"] = now
        trans["note"] = "英文新闻中文译文。key = news.json 的 id（URL 的 md5，稳定）；src=manual 为人工精翻，自动翻译不会覆盖。"
        json.dump(trans, open(a.trans, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"翻译完成：新增 {new} 条，合并 {merged}/{len(items)} 条，词表 {len(table)} 条", file=sys.stderr)


if __name__ == "__main__":
    main()
