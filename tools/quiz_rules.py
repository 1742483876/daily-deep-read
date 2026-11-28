#!/usr/bin/env python3
"""猜涨跌题库共用的「题目质量」规则。

三个快讯源每天上万条，直接拿来做题会有三类垃圾：
1. 标题已经把方向说出来了（午评 / 现报 / 涨1.8%），等于直接给答案；
2. 汇总复盘型（早餐 / 龙虎榜 / 资金流向），不是一条具体事件；
3. 关键词误关联（AIT 里的 AI、印尼央行 → A股银行 ETF、大众汽车 → 阿里巴巴）。

fetch_news_history.py 用本模块做初筛（减小历史池体积），
build_quiz.py 再复核一次并取回命中的标的。两边共用同一套规则，不会漂移。
"""
import re

from build_moves import MAP

# 汇总 / 复盘 / 播报型：不是一条具体事件，不适合猜方向
STRIP = re.compile(
    r"早餐|早报|日报|周报|速览|汇总|一览|盘点|收盘|收涨|收跌|午评|收评|"
    r"盘前|盘后|复盘|播报|快讯|早知道|隔夜|要闻精选|财经日历|机构论市|"
    r"公告精选|涨停复盘|龙虎榜|行情|报价|指数期货|主力合约|资金流向|"
    r"北向资金|两融|份额|新股申购|交易提示|停复牌|日历|盘口|异动"
)

# 标题里已经出现方向 / 幅度 / 点位 → 答案泄露，不出题
LEAK = re.compile(
    r"涨|跌|上扬|下挫|走高|走低|反弹|跳水|拉升|创新高|创新低|涨停|跌停|"
    r"收红|收绿|飘红|飘绿|翻红|翻绿|现报|涨幅|跌幅|%|％|"
    r"报\s?[0-9.]+\s?点|市值蒸发|溢价|折价|封板|破发|刷新|高位|低位"
)

# 境外地缘 / 战报 / 冲突类快讯：跟 A股行业 ETF 没有可解释的对应关系，
# 「乌克兰摧毁坦克 → A股军工 ETF」这种属于硬凑，和「大众汽车 → 阿里巴巴」是同一类问题。
# 这里只做「能不能拿来猜 A股方向」的质量过滤，不对事件本身做任何判断。
GEO = re.compile(
    r"乌克兰|俄罗斯|哈马斯|以色列|加沙|黎巴嫩|叙利亚|胡塞|伊朗|"
    r"击毙|阵亡|空袭|炮击|人质|停火|总参谋部|武装力量"
)

# 过宽的泛词：映射到 A股 ETF 属于硬凑，宁可不出题
WEAK = {
    "AI", "GPU", "算法", "智能体", "Agent", "芯片", "半导体", "存储", "算力",
    "数据中心", "智算中心", "晶圆", "光刻", "封装", "利率", "降息", "加息",
    "央行", "A股", "两市", "大盘", "美股", "标普", "道指", "华尔街", "车企",
    "电动车", "电池", "面板", "小金属", "避险", "酒企", "房企", "IPO",
    "注册制", "折叠屏", "消费电子", "证券", "地产", "楼市",
}
_ASCII = re.compile(r"[A-Za-z]")


def clean_title(s):
    return re.sub(r"\s+", " ", (s or "")).strip()


def hit_ok(title, k):
    """关键词是否算一个「站得住」的关联。"""
    if k in WEAK:
        return False
    if _ASCII.search(k):
        # AI 不能命中 AIT / AIGC 里的字母串，NVDA / CPO 同理要英文边界
        return re.search(r"(?<![A-Za-z0-9])" + re.escape(k) + r"(?![A-Za-z0-9])", title) is not None
    return k in title


def quiz_match(title):
    """比 match_sym 更严：跳过弱关联词，继续找后面更具体的命中。"""
    for kws, sym, rel in MAP:
        for k in kws:
            if hit_ok(title, k):
                return sym, rel, k
    return None, None, None


def pick(title):
    """一条新闻能否出题；能则返回 (sym, rel, hit)，否则 None。"""
    s = clean_title(title)
    if len(s) < 8 or len(s) > 90:
        return None
    if STRIP.search(s) or LEAK.search(s) or GEO.search(s):
        return None
    r = quiz_match(s)
    return r if r[0] else None


def dedup_key(title, t=0):
    """跨源去复用：去掉标点取前 22 字，同一事件多家媒体只留一条。

    22 字是折中——太短会把「日本央行审议委员田村直树：xxx」的一串不同快讯
    误判成同一条，太长又抓不住不同媒体的转述差异。
    """
    return re.sub(r"[^\w]", "", clean_title(title))[:22]
