// PDF.js 4.x — imported as an ES module from the vendored local build.
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

"use strict";

// ── State ──────────────────────────────────────────────────────────────────
let pdfDoc = null;          // loaded PDF document
let chapters = [];          // array of { title, startPage, endPage, text }
let selectedChapterIdx = null;

// ── DOM refs ───────────────────────────────────────────────────────────────
const pdfInput        = document.getElementById("pdf_upload");
const uploadStatus    = document.getElementById("upload-status");
const chapterSection  = document.getElementById("chapter-section");
const chapterList     = document.getElementById("chapter-list");
const previewSection  = document.getElementById("preview-section");
const previewTitle    = document.getElementById("preview-title");
const previewText     = document.getElementById("preview-text");
const useChapterBtn   = document.getElementById("use-chapter-btn");
const selectedInfo    = document.getElementById("selected-info");
const loadingSpinner  = document.getElementById("loading-spinner");

// ── Helpers ────────────────────────────────────────────────────────────────

/** Patterns that commonly mark the start of a chapter or major section. */
const CHAPTER_PATTERNS = [
    /^(chapter\s+\w+[\s:–—-]*.*)/i,
    /^(prologue|epilogue|introduction|conclusion|preface|foreword|afterword|appendix[\s\w]*)/i,
    /^(part\s+\w+[\s:–—-]*.*)/i,
    /^(section\s+\d+[\s:–—-]*.*)/i,
];

function looksLikeChapterHeading(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 120) return false;
    return CHAPTER_PATTERNS.some((re) => re.test(trimmed));
}

function setStatus(msg, isError = false) {
    uploadStatus.textContent = msg;
    uploadStatus.style.color = isError ? "#ff6b6b" : "#00e5ff";
}

function showSpinner(visible) {
    loadingSpinner.style.display = visible ? "block" : "none";
}

// ── PDF loading ────────────────────────────────────────────────────────────

async function extractPagesText(pdf) {
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // Each item has a `str` string; group by y-position to form lines
      const lineMap = new Map();
      content.items.forEach((item) => {
        const y = Math.round(item.transform[5]);
        if (!lineMap.has(y)) lineMap.set(y, []);
        lineMap.get(y).push(item.str);
      });
      const sortedYs = [...lineMap.keys()].sort((a, b) => b - a); // top→bottom
      const lines = sortedYs.map((y) => lineMap.get(y).join(" ").trim()).filter(Boolean);
      pages.push({ pageNum: i, lines, text: lines.join("\n") });
    }
    return pages;
}

function detectChapters(pages) {
    const found = [];

    pages.forEach((page) => {
      page.lines.forEach((line) => {
        if (looksLikeChapterHeading(line)) {
          found.push({
            title: line.trim(),
            startPage: page.pageNum,
            endPage: null,
            text: "",
          });
        }
      });
    });

    // Assign end pages
    found.forEach((ch, i) => {
      ch.endPage = found[i + 1] ? found[i + 1].startPage - 1 : pages.length;
    });

    // If nothing detected, treat whole document as one "chapter"
    if (found.length === 0) {
      found.push({
        title: "Full Document",
        startPage: 1,
        endPage: pages.length,
        text: "",
      });
    }

    // Extract text for each chapter and cache word count
    found.forEach((ch) => {
      const chapterPages = pages.filter(
        (p) => p.pageNum >= ch.startPage && p.pageNum <= ch.endPage
      );
      ch.text = chapterPages.map((p) => p.text).join("\n\n");
      ch.wordCount = ch.text.split(/\s+/).filter(Boolean).length;
    });

    return found;
}

// ── Render chapter list ────────────────────────────────────────────────────

function renderChapterList() {
    chapterList.innerHTML = "";
    chapters.forEach((ch, idx) => {
      const item = document.createElement("div");
      item.className = "chapter-item";
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-label", `Select ${ch.title}`);
      item.dataset.idx = idx;

      const pageRange = document.createElement("span");
      pageRange.className = "chapter-pages";
      pageRange.textContent = `pp. ${ch.startPage}–${ch.endPage}`;

      const title = document.createElement("span");
      title.className = "chapter-title";
      title.textContent = ch.title;

      item.appendChild(title);
      item.appendChild(pageRange);

      item.addEventListener("click", () => selectChapter(idx));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectChapter(idx);
        }
      });

      chapterList.appendChild(item);
    });
}

function selectChapter(idx) {
    selectedChapterIdx = idx;
    const ch = chapters[idx];

    // Highlight selection
    document.querySelectorAll(".chapter-item").forEach((el) => el.classList.remove("selected"));
    const selected = document.querySelector(`.chapter-item[data-idx="${idx}"]`);
    if (selected) selected.classList.add("selected");

    // Show preview
    previewTitle.textContent = ch.title;
    previewText.textContent =
      ch.text.substring(0, 2000) + (ch.text.length > 2000 ? "\n\n[Preview truncated…]" : "");
    previewSection.style.display = "block";
    useChapterBtn.disabled = false;
}

// ── "Use this chapter" button ──────────────────────────────────────────────

useChapterBtn.addEventListener("click", () => {
    if (selectedChapterIdx === null) return;
    const ch = chapters[selectedChapterIdx];
    // Expose selected text globally so the quiz-generation logic can consume it
    window.selectedChapterText = ch.text;
    window.selectedChapterTitle = ch.title;
    selectedInfo.textContent = `✓ "${ch.title}" selected for quiz generation (${ch.wordCount} words).`;
    selectedInfo.style.display = "block";
});

// ── Main upload handler ────────────────────────────────────────────────────

pdfInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      setStatus("Please upload a valid PDF file.", true);
      return;
    }

    setStatus(`Loading "${file.name}"…`);
    chapterSection.style.display = "none";
    previewSection.style.display = "none";
    selectedInfo.style.display = "none";
    useChapterBtn.disabled = true;
    showSpinner(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setStatus(`"${file.name}" loaded (${pdfDoc.numPages} pages). Extracting chapters…`);

      const pages = await extractPagesText(pdfDoc);
      chapters = detectChapters(pages);

      renderChapterList();
      chapterSection.style.display = "block";
      setStatus(
        `Found ${chapters.length} chapter${chapters.length !== 1 ? "s" : ""}. Select one to preview its text.`
      );
    } catch (err) {
      console.error(err);
      setStatus("Error reading PDF. Make sure the file is not password-protected.", true);
    } finally {
      showSpinner(false);
    }
});
