#!/usr/bin/env python3
"""Offline helpers for study-abroad search quality work.

This script intentionally uses only the Python standard library so it can run on
the production ECS host before we decide whether to introduce a crawler stack.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DISCIPLINE_RULES: list[tuple[str, list[str]]] = [
    ("计算机 / AI", ["computer", "computing", "artificial intelligence", "ai", "data science", "software", "cyber", "计算机", "人工智能", "数据科学", "软件", "网络安全"]),
    ("商业分析 / 数据", ["business analytics", "analytics", "data analytics", "information systems", "商业分析", "数据分析", "信息系统"]),
    ("金融", ["finance", "financial", "fintech", "accounting and finance", "金融", "金融科技"]),
    ("会计", ["accounting", "accountancy", "会计"]),
    ("商科 / 管理", ["management", "business", "mba", "marketing", "supply chain", "logistics", "管理", "商科", "市场营销", "供应链", "物流"]),
    ("市场营销 / 传媒", ["media", "communication", "communications", "journalism", "marketing", "传媒", "传播", "新闻", "市场营销"]),
    ("教育", ["education", "teaching", "tesol", "教育", "教学"]),
    ("心理学", ["psychology", "心理"]),
    ("公共卫生", ["public health", "global health", "epidemiology", "公共卫生", "流行病"]),
    ("公共政策 / 国际关系", ["public policy", "international relations", "public administration", "公共政策", "国际关系", "公共管理"]),
    ("建筑 / 城市规划", ["architecture", "urban planning", "built environment", "建筑", "城市规划"]),
    ("设计 / 艺术", ["design", "arts", "fine art", "interaction design", "艺术", "设计", "交互设计"]),
    ("生物 / 医学", ["biomedical", "biology", "bioscience", "medicine", "生物", "医学"]),
    ("机械 / 电子 / 工程", ["engineering", "mechanical", "electrical", "electronic", "工程", "机械", "电子"]),
]

COUNTRY_DOMAIN_HINTS = {
    "英国": [".ac.uk"],
    "美国": [".edu"],
    "澳大利亚": [".edu.au"],
    "新加坡": [".edu.sg", ".sg"],
    "中国香港": [".edu.hk", ".hk"],
}

OFFICIAL_PATH_HINTS = [
    "admission",
    "admissions",
    "graduate",
    "postgraduate",
    "program",
    "programme",
    "course",
    "courses",
    "degree",
    "apply",
    "entry-requirements",
    "requirements",
]

NEGATIVE_SOURCE_HINTS = [
    "ranking",
    "rankings",
    "forum",
    "reddit",
    "zhihu",
    "weibo",
    "blog",
    "agent",
    "liuxue",
]

REQUIREMENT_PATTERNS: dict[str, re.Pattern[str]] = {
    "gpa": re.compile(r"(?i)(?:gpa|grade point average|均分|平均分)[^.\n。；;]{0,80}?(?:[0-4]\.\d{1,2}|[1-9]\d{1,2}%?|[一二三四]等|2:1|second[- ]class)"),
    "ielts": re.compile(r"(?i)(?:ielts|雅思)[^.\n。；;]{0,80}?(?:[5-9](?:\.\d)?)"),
    "toefl": re.compile(r"(?i)(?:toefl|托福)[^.\n。；;]{0,80}?(?:[6-9]\d|1[0-2]\d)"),
    "pte": re.compile(r"(?i)(?:pte)[^.\n。；;]{0,80}?(?:[5-9]\d)"),
    "duolingo": re.compile(r"(?i)(?:duolingo|多邻国)[^.\n。；;]{0,80}?(?:1[0-6]\d|[89]\d)"),
    "gre_gmat": re.compile(r"(?i)(?:gre|gmat)[^.\n。；;]{0,100}?(?:required|optional|not required|waiver|建议|要求|可选|豁免)?"),
    "deadline": re.compile(r"(?i)(?:deadline|application closes|closing date|申请截止|截止日期)[^.\n。；;]{0,100}?(?:20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|月|日)"),
    "work_experience": re.compile(r"(?i)(?:work experience|professional experience|工作经验)[^.\n。；;]{0,100}?(?:required|preferred|years?|要求|优先|年)"),
}


class HtmlTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag in {"p", "div", "section", "article", "li", "br", "h1", "h2", "h3", "tr"}:
            self._chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag in {"p", "div", "section", "article", "li", "tr"}:
            self._chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = data.strip()
        if text:
            self._chunks.append(text)

    def text(self) -> str:
        return normalize_space("\n".join(self._chunks))


@dataclass
class FetchResult:
    url: str
    status: int
    content_type: str
    body: bytes


def normalize_space(value: str) -> str:
    return re.sub(r"[ \t\r\f\v]+", " ", re.sub(r"\n{3,}", "\n\n", unescape(value))).strip()


def read_json_input(path: str) -> Any:
    if path == "-":
        return json.loads(sys.stdin.read())
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json_output(payload: Any, output: str | None) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    if output:
        Path(output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


def fetch_url(url: str, timeout: int) -> FetchResult:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "WanheEducationSearchQualityBot/0.1 (+https://www.wanhe68.com)",
            "Accept": "text/html,application/pdf;q=0.9,*/*;q=0.5",
        },
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return FetchResult(
            url=response.geturl(),
            status=response.status,
            content_type=response.headers.get("content-type", ""),
            body=response.read(),
        )


def extract_text_from_html(raw: bytes) -> str:
    html = raw.decode("utf-8", errors="ignore")
    parser = HtmlTextExtractor()
    parser.feed(html)
    return parser.text()


def extract_text_from_pdf_best_effort(raw: bytes) -> str:
    # This is intentionally conservative. It catches many text-based PDFs but
    # should be replaced by pypdf/pdfminer when we formalize the Python service.
    decoded = raw.decode("latin-1", errors="ignore")
    decoded = re.sub(r"\\[nrbtf()]", " ", decoded)
    decoded = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff.,;:/%+()'\"\\-\\s]", " ", decoded)
    return normalize_space(decoded)


def extract_text(raw: bytes, content_type: str, source_url: str = "") -> str:
    lower_type = content_type.lower()
    lower_url = source_url.lower()
    if "pdf" in lower_type or lower_url.endswith(".pdf"):
        return extract_text_from_pdf_best_effort(raw)
    return extract_text_from_html(raw)


def evidence_window(text: str, start: int, end: int, width: int = 100) -> str:
    return normalize_space(text[max(0, start - width) : min(len(text), end + width)])


def extract_requirements(text: str) -> dict[str, list[dict[str, str]]]:
    findings: dict[str, list[dict[str, str]]] = {}
    for key, pattern in REQUIREMENT_PATTERNS.items():
        hits: list[dict[str, str]] = []
        seen: set[str] = set()
        for match in pattern.finditer(text):
            value = normalize_space(match.group(0))
            if value.lower() in seen:
                continue
            seen.add(value.lower())
            hits.append({"value": value, "evidence": evidence_window(text, match.start(), match.end())})
            if len(hits) >= 8:
                break
        findings[key] = hits
    return findings


def normalize_discipline(*parts: str) -> dict[str, Any]:
    text = " ".join(part for part in parts if part).lower()
    matches: list[dict[str, Any]] = []
    for canonical, keywords in DISCIPLINE_RULES:
        score = 0
        matched_keywords: list[str] = []
        for keyword in keywords:
            if keyword.lower() in text:
                score += 2 if len(keyword) >= 4 else 1
                matched_keywords.append(keyword)
        if score:
            matches.append({"discipline": canonical, "score": score, "keywords": matched_keywords[:6]})
    matches.sort(key=lambda item: (-item["score"], item["discipline"]))
    return {
        "discipline": matches[0]["discipline"] if matches else "",
        "matches": matches[:5],
    }


def domain_of(url: str) -> str:
    host = urlparse(url).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def score_candidate(candidate: dict[str, Any], country: str = "", major: str = "", degree: str = "") -> dict[str, Any]:
    url = str(candidate.get("url") or candidate.get("link") or "")
    title = str(candidate.get("title") or "")
    snippet = str(candidate.get("snippet") or candidate.get("description") or "")
    text = f"{title} {snippet} {url}".lower()
    parsed = urlparse(url)
    host = domain_of(url)
    path = parsed.path.lower()

    score = 0
    reasons: list[str] = []

    if parsed.scheme in {"http", "https"} and host:
        score += 8
        reasons.append("URL 可访问格式正常")

    country_hints = COUNTRY_DOMAIN_HINTS.get(country, [])
    if any(hint in host for hint in country_hints):
        score += 18
        reasons.append(f"域名符合{country}高校官网常见后缀")
    elif any(hint in host for hints in COUNTRY_DOMAIN_HINTS.values() for hint in hints):
        score += 10
        reasons.append("域名像高校官网")

    if any(hint in path for hint in OFFICIAL_PATH_HINTS):
        score += 18
        reasons.append("路径包含招生/项目页信号")

    if re.search(r"(?i)(official|university|college|school|department|faculty|官网|大学|学院)", text):
        score += 8
        reasons.append("标题或摘要包含官方院系信号")

    normalized = normalize_discipline(major, title, snippet, path)
    if normalized["discipline"]:
        score += min(20, normalized["matches"][0]["score"] * 5)
        reasons.append(f"学科匹配：{normalized['discipline']}")

    if degree and degree.lower() in text:
        score += 4
        reasons.append("学位关键词匹配")
    elif degree == "硕士" and re.search(r"(?i)(master|msc|ma|meng|postgraduate|硕士)", text):
        score += 8
        reasons.append("硕士关键词匹配")

    if path.endswith(".pdf"):
        score += 4
        reasons.append("PDF 可作为门槛补充来源")

    if any(hint in text for hint in NEGATIVE_SOURCE_HINTS):
        score -= 18
        reasons.append("来源像排名/论坛/中介内容，需谨慎")

    score = max(0, min(100, score))
    credibility = "high" if score >= 70 else "medium" if score >= 45 else "watch"
    return {
        **candidate,
        "normalizedDiscipline": normalized["discipline"],
        "score": score,
        "credibility": credibility,
        "scoreReasons": reasons,
        "domain": host,
    }


def build_batch_eval_payload(cases: list[dict[str, Any]]) -> dict[str, Any]:
    dimensions: dict[str, dict[str, int]] = {"country": {}, "major": {}}
    enrichment_seeds: list[dict[str, str]] = []
    for item in cases:
        input_data = item.get("input") or {}
        country = str(input_data.get("country") or "")
        major = str(input_data.get("major") or "")
        degree = str(input_data.get("degree") or "硕士")
        free_text = str(input_data.get("freeText") or "")
        if not country and "英国" in free_text:
            country = "英国"
        if not country and "美国" in free_text:
            country = "美国"
        if not country and ("香港" in free_text or "中国香港" in free_text):
            country = "中国香港"
        if not country and "新加坡" in free_text:
            country = "新加坡"
        if not country and ("澳洲" in free_text or "澳大利亚" in free_text):
            country = "澳大利亚"
        if not major:
            major = normalize_discipline(free_text)["discipline"]

        if country:
            dimensions["country"][country] = dimensions["country"].get(country, 0) + 1
        if major:
            dimensions["major"][major] = dimensions["major"].get(major, 0) + 1
        enrichment_seeds.append(
            {
                "caseId": str(item.get("id") or ""),
                "query": " ".join(part for part in [country, major, degree, "official admissions requirements"] if part),
                "country": country,
                "major": major,
                "degree": degree,
            }
        )

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalCases": len(cases),
        "dimensions": dimensions,
        "enrichmentSeeds": enrichment_seeds,
    }


def command_self_test(args: argparse.Namespace) -> int:
    sample_html = b"""
    <html><body><h1>MSc Finance admissions</h1>
    <p>Entry requirements: GPA 3.3 or equivalent.</p>
    <p>IELTS overall 7.0, TOEFL 100. Application deadline 31 March 2026.</p>
    </body></html>
    """
    text = extract_text(sample_html, "text/html")
    scored = score_candidate(
        {
            "title": "MSc Finance admissions | Example University",
            "url": "https://www.example.edu/graduate/programs/msc-finance/admissions",
            "snippet": "Official admissions requirements for MSc Finance.",
        },
        country="美国",
        major="金融",
        degree="硕士",
    )
    payload = {
        "ok": bool(text and scored["score"] >= 60),
        "requirements": extract_requirements(text),
        "candidate": scored,
        "discipline": normalize_discipline("MSc Finance admissions", "金融"),
    }
    write_json_output(payload, args.output)
    return 0 if payload["ok"] else 1


def command_crawl(args: argparse.Namespace) -> int:
    try:
        fetched = fetch_url(args.url, args.timeout)
    except (urllib.error.URLError, TimeoutError) as error:
        write_json_output({"ok": False, "url": args.url, "error": str(error)}, args.output)
        return 1

    text = extract_text(fetched.body, fetched.content_type, fetched.url)
    payload = {
        "ok": True,
        "url": fetched.url,
        "status": fetched.status,
        "contentType": fetched.content_type,
        "textLength": len(text),
        "discipline": normalize_discipline(args.major, text[:2000]),
        "requirements": extract_requirements(text),
        "candidateScore": score_candidate(
            {"title": args.title or fetched.url, "url": fetched.url, "snippet": text[:300]},
            country=args.country,
            major=args.major,
            degree=args.degree,
        ),
    }
    write_json_output(payload, args.output)
    return 0


def command_extract_file(args: argparse.Namespace) -> int:
    raw = Path(args.input).read_bytes()
    text = extract_text(raw, args.content_type, args.url)
    payload = {
        "ok": True,
        "input": args.input,
        "textLength": len(text),
        "discipline": normalize_discipline(args.major, text[:2000]),
        "requirements": extract_requirements(text),
        "preview": text[: args.preview_chars],
    }
    write_json_output(payload, args.output)
    return 0


def command_score_candidates(args: argparse.Namespace) -> int:
    payload = read_json_input(args.input)
    candidates = payload.get("candidates") if isinstance(payload, dict) else payload
    if not isinstance(candidates, list):
        raise SystemExit("score-candidates expects a JSON array or an object with a candidates array")
    scored = [
        score_candidate(item, country=args.country, major=args.major, degree=args.degree)
        for item in candidates
        if isinstance(item, dict)
    ]
    scored.sort(key=lambda item: (-int(item["score"]), item.get("domain", ""), item.get("title", "")))
    write_json_output(
        {
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalCandidates": len(scored),
            "high": sum(1 for item in scored if item["credibility"] == "high"),
            "medium": sum(1 for item in scored if item["credibility"] == "medium"),
            "watch": sum(1 for item in scored if item["credibility"] == "watch"),
            "candidates": scored,
        },
        args.output,
    )
    return 0


def command_batch_eval(args: argparse.Namespace) -> int:
    cases = read_json_input(args.cases)
    if not isinstance(cases, list):
        raise SystemExit("batch-eval expects the eval cases JSON array")
    write_json_output(build_batch_eval_payload(cases), args.output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Study-abroad search quality Python pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    self_test = subparsers.add_parser("self-test", help="Run an offline smoke test")
    self_test.add_argument("--output")
    self_test.set_defaults(func=command_self_test)

    crawl = subparsers.add_parser("crawl", help="Fetch one official page and extract requirements")
    crawl.add_argument("--url", required=True)
    crawl.add_argument("--country", default="")
    crawl.add_argument("--major", default="")
    crawl.add_argument("--degree", default="硕士")
    crawl.add_argument("--title", default="")
    crawl.add_argument("--timeout", type=int, default=15)
    crawl.add_argument("--output")
    crawl.set_defaults(func=command_crawl)

    extract_file = subparsers.add_parser("extract-file", help="Extract requirements from a local HTML/PDF file")
    extract_file.add_argument("--input", required=True)
    extract_file.add_argument("--url", default="")
    extract_file.add_argument("--content-type", default="text/html")
    extract_file.add_argument("--major", default="")
    extract_file.add_argument("--preview-chars", type=int, default=600)
    extract_file.add_argument("--output")
    extract_file.set_defaults(func=command_extract_file)

    score_candidates = subparsers.add_parser("score-candidates", help="Score candidate official pages")
    score_candidates.add_argument("--input", required=True)
    score_candidates.add_argument("--country", default="")
    score_candidates.add_argument("--major", default="")
    score_candidates.add_argument("--degree", default="硕士")
    score_candidates.add_argument("--output")
    score_candidates.set_defaults(func=command_score_candidates)

    batch_eval = subparsers.add_parser("batch-eval", help="Summarize eval case dimensions and build enrichment seeds")
    batch_eval.add_argument("--cases", required=True)
    batch_eval.add_argument("--output")
    batch_eval.set_defaults(func=command_batch_eval)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
