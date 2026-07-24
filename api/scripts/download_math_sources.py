#!/usr/bin/env python3
"""Download and index the legally available daily math source material."""

from __future__ import annotations

import argparse
import concurrent.futures
import html
import json
import os
import re
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader


API_DIR = Path(__file__).resolve().parents[1]
MANIFEST_FILE = API_DIR / "math_sources.json"
DEFAULT_OUTPUT_DIR = API_DIR / "resources" / "math_sources"
USER_AGENT = "LiterateGogglesDaily/1.0 (https://daily.chebakov.me)"
ISSUU_READER_AGENT = (
    "Mozilla/5.0 (compatible; Googlebot/2.1; "
    "+http://www.google.com/bot.html)"
)
TEXT_ARCHIVE_SUFFIXES = {
    ".md",
    ".rst",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
}


class ReadableHTMLParser(HTMLParser):
    SKIP_TAGS = {"script", "style", "svg", "noscript"}
    BLOCK_TAGS = {
        "article",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "li",
        "p",
        "section",
        "td",
        "th",
        "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        del attrs
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
        elif not self.skip_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
        elif not self.skip_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth and data.strip():
            self.parts.append(data)

    def text(self) -> str:
        lines = [
            re.sub(r"[ \t]+", " ", line).strip()
            for line in html.unescape(" ".join(self.parts)).splitlines()
        ]
        return "\n".join(line for line in lines if line)


class IssuuPageTextParser(HTMLParser):
    """Extract the accessible book text rendered for one Issuu reader page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.main_depth = 0

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        attributes = {key.casefold(): value for key, value in attrs}
        if tag.casefold() == "main" and attributes.get("itemprop") == "text":
            self.main_depth = 1
        elif self.main_depth:
            self.main_depth += 1
            if tag.casefold() in ReadableHTMLParser.BLOCK_TAGS:
                self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if not self.main_depth:
            return
        if tag.casefold() in ReadableHTMLParser.BLOCK_TAGS:
            self.parts.append("\n")
        self.main_depth -= 1

    def handle_data(self, data: str) -> None:
        if self.main_depth and data.strip():
            self.parts.append(data)

    def text(self) -> str:
        lines = [
            re.sub(r"[ \t]+", " ", line).strip()
            for line in html.unescape(" ".join(self.parts)).splitlines()
        ]
        return "\n".join(line for line in lines if line)


def _load_manifest() -> list[dict[str, Any]]:
    parsed = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    if not isinstance(parsed, list):
        raise ValueError("math_sources.json must contain a list")
    return [item for item in parsed if isinstance(item, dict)]


def _download(
    client: httpx.Client, url: str, destination: Path, *, force: bool
) -> str:
    if destination.exists() and destination.stat().st_size > 1_000 and not force:
        return "cached"
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    with client.stream("GET", url) as response:
        response.raise_for_status()
        with temporary.open("wb") as output:
            for chunk in response.iter_bytes():
                output.write(chunk)
    if temporary.stat().st_size < 500:
        temporary.unlink(missing_ok=True)
        raise ValueError(f"{url} returned an unexpectedly small file")
    os.replace(temporary, destination)
    return "downloaded"


def _download_issuu_text(
    url_template: str,
    page_count: int,
    destination: Path,
    text_destination: Path,
    *,
    force: bool,
) -> str:
    if (
        destination.exists()
        and text_destination.exists()
        and text_destination.stat().st_size > 50_000
        and not force
    ):
        return "cached"

    def fetch_page(page_number: int) -> tuple[int, str]:
        url = url_template.format(page=page_number)
        with httpx.Client(
            timeout=httpx.Timeout(90.0),
            follow_redirects=True,
            headers={"User-Agent": ISSUU_READER_AGENT},
        ) as page_client:
            response = page_client.get(url)
            response.raise_for_status()
        page_parser = IssuuPageTextParser()
        page_parser.feed(response.text)
        page_text = page_parser.text()
        if len(page_text) < 20:
            page_text = "[No text layer on this page.]"
        return page_number, page_text

    print(
        f"[math-sources] indexing {page_count} pages from the full Issuu reader",
        flush=True,
    )
    pages: dict[int, str] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        futures = [
            executor.submit(fetch_page, page_number)
            for page_number in range(1, page_count + 1)
        ]
        for completed, future in enumerate(
            concurrent.futures.as_completed(futures), start=1
        ):
            page_number, page_text = future.result()
            pages[page_number] = page_text
            if completed % 50 == 0 or completed == page_count:
                print(
                    f"[math-sources] Issuu reader: {completed}/{page_count} pages",
                    flush=True,
                )

    if len(pages) != page_count:
        raise ValueError(f"expected {page_count} Issuu pages, got {len(pages)}")
    extracted_size = sum(
        len(page_text)
        for page_text in pages.values()
        if page_text != "[No text layer on this page.]"
    )
    if extracted_size < 250_000:
        raise ValueError(
            f"Issuu reader returned only {extracted_size:,} readable characters"
        )
    temporary_text = text_destination.with_suffix(
        text_destination.suffix + ".tmp"
    )
    temporary_text.write_text(
        "\n".join(
            f"\n--- PAGE {page_number} ---\n{pages[page_number]}"
            for page_number in range(1, page_count + 1)
        )
        + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_text, text_destination)

    temporary_metadata = destination.with_suffix(destination.suffix + ".tmp")
    temporary_metadata.write_text(
        json.dumps(
            {
                "source": url_template.replace("/{page}", ""),
                "pageCount": page_count,
                "indexedPages": len(pages),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_metadata, destination)
    return "downloaded"


def _extract_pdf(source: Path, destination: Path) -> None:
    reader = PdfReader(source)
    pages: list[str] = []
    for page_number, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception as exc:
            print(f"[math-sources] page {page_number} failed in {source.name}: {exc}")
            continue
        if page_text.strip():
            pages.append(f"\n--- PAGE {page_number} ---\n{page_text.strip()}")
    destination.write_text("\n".join(pages) + "\n", encoding="utf-8")


def _extract_html(source: Path, destination: Path) -> None:
    parser = ReadableHTMLParser()
    parser.feed(source.read_text(encoding="utf-8", errors="replace"))
    destination.write_text(parser.text() + "\n", encoding="utf-8")


def _extract_zip(source: Path, destination: Path) -> None:
    sections: list[str] = []
    with zipfile.ZipFile(source) as archive:
        for member in sorted(archive.infolist(), key=lambda item: item.filename):
            path = Path(member.filename)
            if member.is_dir() or path.suffix.casefold() not in TEXT_ARCHIVE_SUFFIXES:
                continue
            if member.file_size > 2_000_000:
                continue
            content = archive.read(member).decode("utf-8", errors="replace").strip()
            if content:
                sections.append(f"\n--- FILE {member.filename} ---\n{content}")
    if not sections:
        raise ValueError(f"{source.name} contains no readable text files")
    destination.write_text("\n".join(sections) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Directory for downloaded files and extracted text indexes",
    )
    parser.add_argument(
        "--subject",
        action="append",
        default=[],
        help="Download only the named subject ID; repeat for multiple subjects",
    )
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    selected = set(args.subject)
    sources = [
        source
        for source in _load_manifest()
        if not selected or source.get("id") in selected
    ]
    if selected and len(sources) != len(selected):
        known = {str(source.get("id")) for source in sources}
        missing = ", ".join(sorted(selected - known))
        raise ValueError(f"unknown subject IDs: {missing}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    failures = 0
    with httpx.Client(
        timeout=httpx.Timeout(240.0),
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        for source in sources:
            subject_id = str(source["id"])
            for file_spec in source.get("files") or []:
                destination = args.output_dir / str(file_spec["filename"])
                temporary_client: httpx.Client | None = None
                try:
                    text_path = destination.with_suffix(destination.suffix + ".txt")
                    if file_spec["kind"] == "issuu_text":
                        status = _download_issuu_text(
                            str(file_spec["url"]),
                            int(file_spec["pageCount"]),
                            destination,
                            text_path,
                            force=args.force,
                        )
                        print(
                            f"[math-sources] {subject_id}: {destination.name} "
                            f"({status}, {text_path.stat().st_size:,} text bytes)"
                        )
                        continue
                    request_client = client
                    if file_spec.get("verifyTls") is False:
                        temporary_client = httpx.Client(
                            timeout=httpx.Timeout(240.0),
                            follow_redirects=True,
                            headers={"User-Agent": USER_AGENT},
                            verify=False,
                        )
                        request_client = temporary_client
                    status = _download(
                        request_client,
                        str(file_spec["url"]),
                        destination,
                        force=args.force,
                    )
                    if args.force or status == "downloaded" or not text_path.exists():
                        if file_spec["kind"] == "pdf":
                            if not destination.read_bytes()[:4] == b"%PDF":
                                raise ValueError(
                                    f"{destination.name} is not a valid PDF download"
                                )
                            _extract_pdf(destination, text_path)
                        elif file_spec["kind"] == "zip":
                            _extract_zip(destination, text_path)
                        else:
                            _extract_html(destination, text_path)
                    print(
                        f"[math-sources] {subject_id}: {destination.name} "
                        f"({status}, {destination.stat().st_size:,} bytes)"
                    )
                except Exception as exc:
                    failures += 1
                    print(
                        f"[math-sources] {subject_id}: {destination.name} failed: {exc}"
                    )
                finally:
                    if temporary_client is not None:
                        temporary_client.close()
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
