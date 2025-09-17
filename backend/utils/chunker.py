"""
Utilities for splitting text into semantically coherent chunks suitable for RAG.

Strategy:
- Normalize whitespace
- Split by paragraphs and then group to a target size with slight overlap
"""

from __future__ import annotations

import re
from typing import Iterable, List


def _normalize(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[\t\x0b\x0c]+", " ", text)
    text = re.sub(r"\s+\n", "\n", text)
    text = re.sub(r"\n\s+", "\n", text)
    return text.strip()


def split_into_paragraphs(text: str) -> List[str]:
    normalized = _normalize(text)
    # Split on blank lines
    parts = re.split(r"\n\s*\n+", normalized)
    return [p.strip() for p in parts if p.strip()]


def chunk_text(
    text: str,
    *,
    target_chunk_chars: int = 1200,
    min_chunk_chars: int = 400,
    overlap_chars: int = 150,
) -> List[str]:
    if not text:
        return []

    paragraphs = split_into_paragraphs(text)
    if not paragraphs:
        return []

    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    for para in paragraphs:
        para_len = len(para)
        if current_len + para_len + 1 <= target_chunk_chars:
            current.append(para)
            current_len += para_len + 1
        else:
            if current_len >= min_chunk_chars or not current:
                if current:
                    chunks.append("\n\n".join(current))
                # start a new chunk; include overlap from previous end
                if chunks and overlap_chars > 0:
                    tail = chunks[-1][-overlap_chars:]
                    current = [tail, para]
                    current_len = len(tail) + 1 + para_len
                else:
                    current = [para]
                    current_len = para_len
            else:
                # Not enough to form a chunk; force add and continue
                current.append(para)
                current_len += para_len + 1

    if current:
        chunks.append("\n\n".join(current))

    # Final normalization and trimming
    return [c.strip() for c in chunks if c.strip()]


__all__ = ["split_into_paragraphs", "chunk_text"]

# Text chunking for the backend RAG pipeline using chunk.ts