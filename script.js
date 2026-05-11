// PDF.js 4.x — imported as an ES module from the vendored local build.
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

"use strict";

// ── State ──────────────────────────────────────────────────────────────────
let pdfDoc = null;          // loaded PDF document
let chapters = [];          // array of { title, startPage, endPage, text }
let selectedChapterIdx = null;
let currentUser = null;     // signed-in username, or null
let lastGeneratedQuestions = null;  // most recent generated questions array
let pagesCache = null;      // cached page objects for custom page ranges
let currentQuizData = null; // current quiz with questions and answer key for export

// ── DOM refs ───────────────────────────────────────────────────────────────
const pdfInput          = document.getElementById("pdf_upload");
const uploadStatus      = document.getElementById("upload-status");
const chapterSection    = document.getElementById("chapter-section");
const chapterList       = document.getElementById("chapter-list");
const previewSection    = document.getElementById("preview-section");
const previewTitle      = document.getElementById("preview-title");
const previewText       = document.getElementById("preview-text");
const useChapterBtn     = document.getElementById("use-chapter-btn");
const selectedInfo      = document.getElementById("selected-info");
const loadingSpinner    = document.getElementById("loading-spinner");
const generateSection   = document.getElementById("generate-section");
const questionCountInput = document.getElementById("question-count");
const generateBtn       = document.getElementById("generate-btn");
const genSpinner        = document.getElementById("gen-spinner");
const generatedOutput   = document.getElementById("generated-quiz-output");
const genQuizActions    = document.getElementById("gen-quiz-actions");
const checkGeneratedBtn = document.getElementById("check-generated-btn");
const genQuizResult     = document.getElementById("gen-quiz-result");

// ── New feature DOM refs ───────────────────────────────────────────────────
const themeToggle       = document.getElementById("theme-toggle");
const signInBtn         = document.getElementById("sign-in-btn");
const signOutBtn        = document.getElementById("sign-out-btn");
const userGreeting      = document.getElementById("user-greeting");
const authModal         = document.getElementById("auth-modal");
const authError         = document.getElementById("auth-error");
const authUsername      = document.getElementById("auth-username");
const authPassword      = document.getElementById("auth-password");
const authLoginBtn      = document.getElementById("auth-login-btn");
const authRegisterBtn   = document.getElementById("auth-register-btn");
const authCancelBtn     = document.getElementById("auth-cancel-btn");
const saveQuizSection   = document.getElementById("save-quiz-section");
const saveQuizBtn       = document.getElementById("save-quiz-btn");
const saveQuizStatus    = document.getElementById("save-quiz-status");
const savedSection      = document.getElementById("saved-section");
const savedList         = document.getElementById("saved-list");
// Page-range controls
const startPageInput    = document.getElementById("start-page-input");
const endPageInput      = document.getElementById("end-page-input");
const applyPageRangeBtn = document.getElementById("apply-page-range-btn");
const pageRangeInfo     = document.getElementById("page-range-info");
// Full-text preview modal
const fullTextModal     = document.getElementById("full-text-modal");
const fullTextContent   = document.getElementById("full-text-content");
const viewFullTextBtn   = document.getElementById("view-full-text-btn");
const closeFullTextBtn  = document.getElementById("close-full-text-btn");
// PDF viewer modal
const pdfViewerModal    = document.getElementById("pdf-viewer-modal");
const pdfViewerPages    = document.getElementById("pdf-viewer-pages");
const viewPdfBtn        = document.getElementById("view-pdf-btn");
const closePdfViewerBtn = document.getElementById("close-pdf-viewer-btn");
// Quiz copy/export
const copyQuizBtn       = document.getElementById("copy-quiz-btn");
const quizTitleModal    = document.getElementById("quiz-title-modal");
const quizTitleInput    = document.getElementById("quiz-title-input");
const quizTitleConfirmBtn = document.getElementById("quiz-title-confirm-btn");
const quizTitleCancelBtn = document.getElementById("quiz-title-cancel-btn");
const quizExportModal   = document.getElementById("quiz-export-modal");
const quizExportContent = document.getElementById("quiz-export-content");
const closeQuizExportBtn = document.getElementById("close-quiz-export-btn");
const copyToClipboardBtn = document.getElementById("copy-to-clipboard-btn");
const copyStatus        = document.getElementById("copy-status");

function enablePageRangeControls() {
    if (applyPageRangeBtn) {
        applyPageRangeBtn.disabled = false;
        applyPageRangeBtn.removeAttribute("disabled");
    }
}

enablePageRangeControls();
if (pageRangeInfo) {
    pageRangeInfo.textContent = "Upload a PDF to use page-range selection.";
}

// ── Theme ──────────────────────────────────────────────────────────────────

function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "light" ? "🌞 Light" : "🌙 Dark";
    localStorage.setItem("bookq-theme", theme);
}

function initTheme() {
    const saved = localStorage.getItem("bookq-theme") || "dark";
    applyTheme(saved);
}

themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
});

// ── Auth helpers ───────────────────────────────────────────────────────────

/** Derive a key from a password using PBKDF2 with a random salt. Returns { hash, salt } as hex strings. */
async function hashPassword(password, saltHex = null) {
    const encoder = new TextEncoder();
    const saltBytes = saltHex
        ? new Uint8Array(saltHex.match(/.{2}/g).map((b) => parseInt(b, 16)))
        : crypto.getRandomValues(new Uint8Array(16));

    const keyMaterial = await crypto.subtle.importKey(
        "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const derived = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: saltBytes, iterations: 600000, hash: "SHA-256" },
        keyMaterial, 256
    );
    const hashHex = Array.from(new Uint8Array(derived)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const saltHexOut = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    return { hash: hashHex, salt: saltHexOut };
}

function getUsers() {
    try { return JSON.parse(localStorage.getItem("bookq-users") || "{}"); } catch { return {}; }
}

function saveUsers(users) {
    localStorage.setItem("bookq-users", JSON.stringify(users));
}

function setCurrentUser(username) {
    currentUser = username;
    if (username) {
        localStorage.setItem("bookq-current-user", username);
        userGreeting.textContent = `👤 ${username}`;
        userGreeting.style.display = "inline";
        signInBtn.style.display = "none";
        signOutBtn.style.display = "inline";
        renderSavedSection();
    } else {
        localStorage.removeItem("bookq-current-user");
        userGreeting.style.display = "none";
        signInBtn.style.display = "inline";
        signOutBtn.style.display = "none";
        savedSection.style.display = "none";
        saveQuizSection.style.display = "none";
    }
}

function initAuth() {
    const saved = localStorage.getItem("bookq-current-user");
    if (saved) setCurrentUser(saved);
}

// ── Auth modal ─────────────────────────────────────────────────────────────

function openAuthModal() {
    authUsername.value = "";
    authPassword.value = "";
    authError.style.display = "none";
    authModal.style.display = "flex";
    authUsername.focus();
}

function closeAuthModal() {
    authModal.style.display = "none";
}

// ── Full-text preview modal functions ──────────────────────────────────────

function openFullTextModal(text, title) {
    if (!text) {
        console.warn("No text provided to openFullTextModal");
        return;
    }
    if (!fullTextModal || !fullTextContent) {
        console.error("Modal elements not found");
        return;
    }
    fullTextContent.textContent = text;
    const titleEl = fullTextModal.querySelector("#full-text-modal-title");
    if (titleEl) titleEl.textContent = title || "Full Text";
    fullTextModal.style.display = "flex";
}

function closeFullTextModal() {
    if (fullTextModal) {
        fullTextModal.style.display = "none";
    }
}

if (viewFullTextBtn) {
    viewFullTextBtn.addEventListener("click", () => {
        const text = window.selectedChapterText || "";
        const title = window.selectedChapterTitle || "Full Text";
        if (!text) {
            alert("Please select a chapter first.");
            return;
        }
        openFullTextModal(text, title);
    });
} else {
    console.error("View Full Text button not found");
}

if (closeFullTextBtn) {
    closeFullTextBtn.addEventListener("click", closeFullTextModal);
} else {
    console.error("Close button not found");
}

if (fullTextModal) {
    fullTextModal.addEventListener("click", (e) => {
        if (e.target === fullTextModal) closeFullTextModal();
    });
} else {
    console.error("Full text modal not found");
}

// ── PDF Viewer Modal Functions ─────────────────────────────────────────────

async function openPdfViewer(startPage, endPage) {
    if (!pdfDoc || !pdfViewerPages) {
        alert("Please select a PDF and chapter first.");
        return;
    }
    
    // Clear previous pages
    pdfViewerPages.innerHTML = "";
    
    // Render each page in the range
    const s = Math.max(1, startPage);
    const e = Math.max(s, Math.min(endPage, pdfDoc.numPages));
    
    const scale = 1.5;
    for (let pageNum = s; pageNum <= e; pageNum++) {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            
            // Create canvas
            const canvas = document.createElement("canvas");
            canvas.className = "pdf-page-canvas";
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            
            // Render page to canvas
            const context = canvas.getContext("2d");
            await page.render({ canvasContext: context, viewport }).promise;
            
            // Create page container
            const pageDiv = document.createElement("div");
            pageDiv.className = "pdf-page";
            
            // Add label
            const label = document.createElement("div");
            label.className = "pdf-page-label";
            label.textContent = `Page ${pageNum}`;
            
            pageDiv.appendChild(label);
            pageDiv.appendChild(canvas);
            pdfViewerPages.appendChild(pageDiv);
        } catch (err) {
            console.error(`Error rendering page ${pageNum}:`, err);
        }
    }
    
    // Show modal
    if (pdfViewerModal) {
        const titleEl = pdfViewerModal.querySelector("#pdf-viewer-title");
        if (titleEl) titleEl.textContent = `Pages ${s}–${e}`;
        pdfViewerModal.style.display = "flex";
    }
}

function closePdfViewer() {
    if (pdfViewerModal) {
        pdfViewerModal.style.display = "none";
    }
}

if (viewPdfBtn) {
    viewPdfBtn.addEventListener("click", () => {
        if (!window.selectedChapterText) {
            alert("Please select a chapter first.");
            return;
        }
        const startPage = chapters[selectedChapterIdx]?.startPage;
        const endPage = chapters[selectedChapterIdx]?.endPage;
        if (startPage !== undefined && endPage !== undefined) {
            openPdfViewer(startPage, endPage);
        }
    });
} else {
    console.error("View PDF button not found");
}

if (closePdfViewerBtn) {
    closePdfViewerBtn.addEventListener("click", closePdfViewer);
} else {
    console.error("Close PDF viewer button not found");
}

if (pdfViewerModal) {
    pdfViewerModal.addEventListener("click", (e) => {
        if (e.target === pdfViewerModal) closePdfViewer();
    });
} else {
    console.error("PDF viewer modal not found");
}

// ── Quiz Export Functions ──────────────────────────────────────────────────

function openQuizTitleModal() {
    if (!currentQuizData || currentQuizData.questions.length === 0) {
        alert("Please generate a quiz first.");
        return;
    }
    quizTitleInput.value = currentQuizData.chapterTitle;
    quizTitleInput.focus();
    quizTitleModal.style.display = "flex";
}

function closeQuizTitleModal() {
    quizTitleModal.style.display = "none";
}

function closeQuizExportModal() {
    quizExportModal.style.display = "none";
}

function formatQuizForExport(title) {
    if (!currentQuizData) return "";
    
    const { questions } = currentQuizData;
    let formatted = `${title}\n`;
    formatted += `Generated from: ${currentQuizData.chapterTitle}\n`;
    formatted += `\n${"=".repeat(60)}\n\n`;
    
    // Questions section
    questions.forEach((q, i) => {
        formatted += `QUESTION ${i + 1}\n`;
        formatted += `${q.question}\n\n`;
        q.options.forEach((opt, j) => {
            const letter = String.fromCharCode(65 + j); // A, B, C, D
            formatted += `  ${letter}. ${opt}\n`;
        });
        formatted += `\n`;
    });
    
    formatted += `${"=".repeat(60)}\n\n`;
    formatted += `ANSWER KEY\n\n`;
    
    questions.forEach((q, i) => {
        formatted += `Question ${i + 1}: ${q.correctLetter} (Page ${q.sourcePage ?? "N/A"})\n`;
    });
    
    return formatted;
}

function openQuizExport(title) {
    const formatted = formatQuizForExport(title);
    if (!formatted) {
        alert("No quiz data to export.");
        return;
    }
    
    quizExportContent.textContent = formatted;
    const titleEl = quizExportModal.querySelector("#quiz-export-title");
    if (titleEl) titleEl.textContent = title;
    quizExportModal.style.display = "flex";
    copyStatus.textContent = "";
}

// Event listeners for quiz copy
if (copyQuizBtn) {
    copyQuizBtn.addEventListener("click", openQuizTitleModal);
} else {
    console.error("Copy Quiz button not found");
}

if (quizTitleConfirmBtn) {
    quizTitleConfirmBtn.addEventListener("click", () => {
        const title = quizTitleInput.value.trim();
        if (!title) {
            alert("Please enter a quiz title.");
            return;
        }
        closeQuizTitleModal();
        openQuizExport(title);
    });
} else {
    console.error("Quiz title confirm button not found");
}

if (quizTitleCancelBtn) {
    quizTitleCancelBtn.addEventListener("click", closeQuizTitleModal);
} else {
    console.error("Quiz title cancel button not found");
}

if (quizTitleModal) {
    quizTitleModal.addEventListener("click", (e) => {
        if (e.target === quizTitleModal) closeQuizTitleModal();
    });
} else {
    console.error("Quiz title modal not found");
}

if (closeQuizExportBtn) {
    closeQuizExportBtn.addEventListener("click", closeQuizExportModal);
} else {
    console.error("Close quiz export button not found");
}

if (copyToClipboardBtn) {
    copyToClipboardBtn.addEventListener("click", () => {
        const text = quizExportContent.textContent;
        if (!text) return;
        
        navigator.clipboard.writeText(text).then(() => {
            copyStatus.textContent = "✓ Copied!";
            setTimeout(() => {
                copyStatus.textContent = "";
            }, 2000);
        }).catch(err => {
            console.error("Failed to copy:", err);
            copyStatus.textContent = "Failed to copy";
        });
    });
} else {
    console.error("Copy to clipboard button not found");
}

if (quizExportModal) {
    quizExportModal.addEventListener("click", (e) => {
        if (e.target === quizExportModal) closeQuizExportModal();
    });
} else {
    console.error("Quiz export modal not found");
}

function showAuthError(msg) {
    authError.textContent = msg;
    authError.style.display = "block";
}

signInBtn.addEventListener("click", openAuthModal);
authCancelBtn.addEventListener("click", closeAuthModal);
authModal.addEventListener("click", (e) => { if (e.target === authModal) closeAuthModal(); });

authLoginBtn.addEventListener("click", async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (!username || !password) { showAuthError("Please enter a username and password."); return; }

    const users = getUsers();
    if (!users[username]) { showAuthError("No account found. Please register first."); return; }

    const stored = users[username];
    const { hash } = await hashPassword(password, stored.salt);
    if (hash !== stored.hash) { showAuthError("Incorrect password."); return; }

    setCurrentUser(username);
    closeAuthModal();
});

authRegisterBtn.addEventListener("click", async () => {
    const username = authUsername.value.trim();
    const password = authPassword.value;
    if (!username) { showAuthError("Please enter a username."); return; }
    if (password.length < 8) { showAuthError("Password must be at least 8 characters."); return; }
    if (!/^[A-Za-z0-9_-]{2,30}$/.test(username)) {
        showAuthError("Username may only contain letters, numbers, _ or - (2-30 chars).");
        return;
    }

    const users = getUsers();
    if (users[username]) { showAuthError("That username is already taken. Please sign in."); return; }

    const { hash, salt } = await hashPassword(password);
    users[username] = { hash, salt };
    saveUsers(users);
    setCurrentUser(username);
    closeAuthModal();
});

signOutBtn.addEventListener("click", () => {
    setCurrentUser(null);
    saveQuizSection.style.display = "none";
    lastGeneratedQuestions = null;
});

// ── Save / Load quizzes ────────────────────────────────────────────────────

function getSavedQuizzes(username) {
    try { return JSON.parse(localStorage.getItem(`bookq-saved-${username}`) || "[]"); } catch { return []; }
}

function storeSavedQuizzes(username, quizzes) {
    localStorage.setItem(`bookq-saved-${username}`, JSON.stringify(quizzes));
}

saveQuizBtn.addEventListener("click", () => {
    if (!currentUser || !lastGeneratedQuestions) return;

    const title = window.selectedChapterTitle || "Untitled Chapter";
    const quizzes = getSavedQuizzes(currentUser);
    const entry = {
        id: Date.now(),
        title,
        questions: lastGeneratedQuestions,
        savedAt: new Date().toLocaleString(),
    };
    quizzes.unshift(entry);
    storeSavedQuizzes(currentUser, quizzes);

    saveQuizStatus.textContent = `✓ Quiz saved as "${title}"`;
    saveQuizBtn.disabled = true;
    renderSavedSection();
});

function renderSavedSection() {
    if (!currentUser) return;
    const quizzes = getSavedQuizzes(currentUser);
    savedList.innerHTML = "";

    if (quizzes.length === 0) {
        savedList.innerHTML = '<p class="empty-state">No saved quizzes yet. Generate a quiz and press Save.</p>';
        savedSection.style.display = "block";
        return;
    }

    quizzes.forEach((quiz) => {
        const item = document.createElement("div");
        item.className = "saved-item";

        const info = document.createElement("div");
        info.className = "saved-item-info";
        info.innerHTML = `<div class="saved-item-title">${escapeHtml(quiz.title)}</div>
            <div class="saved-item-meta">${quiz.questions.length} question${quiz.questions.length !== 1 ? "s" : ""} · Saved ${escapeHtml(quiz.savedAt)}</div>`;

        const actions = document.createElement("div");
        actions.className = "saved-item-actions";

        const loadBtn = document.createElement("button");
        loadBtn.textContent = "Load";
        loadBtn.addEventListener("click", () => loadSavedQuiz(quiz));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.className = "ghost-btn";
        deleteBtn.addEventListener("click", () => {
            const updated = getSavedQuizzes(currentUser).filter((q) => q.id !== quiz.id);
            storeSavedQuizzes(currentUser, updated);
            renderSavedSection();
        });

        actions.appendChild(loadBtn);
        actions.appendChild(deleteBtn);
        item.appendChild(info);
        item.appendChild(actions);
        savedList.appendChild(item);
    });

    savedSection.style.display = "block";
}

function loadSavedQuiz(quiz) {
    window.selectedChapterTitle = quiz.title;
    lastGeneratedQuestions = quiz.questions;
    renderGeneratedQuiz(quiz.questions);

    generateSection.style.display = "block";
    saveQuizSection.style.display = "block";
    saveQuizStatus.textContent = "";
    saveQuizBtn.disabled = false;
    generateSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── Init ───────────────────────────────────────────────────────────────────
initTheme();
initAuth();



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
    uploadStatus.style.color = isError ? "var(--error)" : "var(--status-color)";
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

function buildTextFromPageRange(startPage, endPage) {
    if (!pagesCache) return "";
    const s = Math.max(1, Math.min(startPage, pagesCache.length));
    const e = Math.max(s, Math.min(endPage, pagesCache.length));
    const parts = [];
    for (let p = s; p <= e; p++) {
        const page = pagesCache[p - 1];
        if (!page) continue;
        parts.push(page.text || page.lines.join(" "));
    }
    return parts.join("\n\n");
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

    // Store full text for access by preview and modal
    window.selectedChapterText = ch.text;
    window.selectedChapterTitle = ch.title;

    // Show preview (truncated)
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

    // Show the generation step and reset its state
    generateSection.style.display = "block";
    generatedOutput.innerHTML = "";
    genQuizActions.style.display = "none";
    genQuizResult.textContent = "";
    generateSection.scrollIntoView({ behavior: "smooth", block: "start" });
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
    pagesCache = pages;
    chapters = detectChapters(pages);

      renderChapterList();
      chapterSection.style.display = "block";
      setStatus(
        `Found ${chapters.length} chapter${chapters.length !== 1 ? "s" : ""}. Select one to preview its text.`
      );

            if (startPageInput && endPageInput && applyPageRangeBtn && pageRangeInfo) {
                startPageInput.value = "1";
                endPageInput.value = String(pdfDoc.numPages);
                startPageInput.max = String(pdfDoc.numPages);
                endPageInput.max = String(pdfDoc.numPages);
                enablePageRangeControls();
                pageRangeInfo.textContent = `${pdfDoc.numPages} pages available`;
            }
    } catch (err) {
      console.error(err);
      setStatus("Error reading PDF. Make sure the file is not password-protected.", true);
    } finally {
      showSpinner(false);
    }
});

if (applyPageRangeBtn) {
    applyPageRangeBtn.addEventListener("click", () => {
        setStatus("Applying page range selection...");
        if (!pdfDoc || !pagesCache) {
            setStatus("Please upload a PDF first.", true);
            return;
        }
        const start = parseInt(startPageInput.value, 10);
        const end = parseInt(endPageInput.value, 10);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
            setStatus("Please enter a valid start and end page (start ≤ end).", true);
            return;
        }

        const text = buildTextFromPageRange(start, end);
        if (!text) {
            setStatus("No text extracted for that page range.", true);
            return;
        }

        chapters = chapters.filter((ch) => !ch.isCustomPageRange);
        const customChapter = {
            title: `Pages ${start}–${end} (custom)`,
            startPage: start,
            endPage: end,
            text,
            wordCount: text.split(/\s+/).filter(Boolean).length,
            isCustomPageRange: true,
        };
        chapters.unshift(customChapter);
        renderChapterList();
        chapterList.scrollTop = 0;
        selectChapter(0);
        previewSection.scrollIntoView({ behavior: "smooth", block: "start" });
        setStatus("Page range applied. Preview shown in Step 3.");
    });
}

// ── Quiz Generation Engine ─────────────────────────────────────────────────

/** Common English words that carry little meaning on their own. */
const STOPWORDS = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "by","from","is","was","are","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","may","might","shall",
    "this","that","these","those","it","its","i","he","she","they","we","you",
    "his","her","their","our","my","your","him","them","us","not","no","so",
    "as","if","then","than","when","where","who","which","what","how","all",
    "just","also","up","out","about","into","over","after","before","more",
    "there","some","any","each","other","such","very","too","can","said","one",
    "two","three","four","five","six","seven","eight","nine","ten","upon","even",
    "still","while","though","although","because","since","until","here","now",
    "well","like","back","down","again","further","once","few","both","only","own",
    "same","off","through","between","during","without","against",
]);

/** Lowercase-tokenise text into words of ≥ 3 characters. */
function tokenize(text) {
    return text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
}

/**
 * Return the top `topN` non-stopword lemma-tokens ranked by frequency.
 */
function extractKeywords(text, topN = 40) {
    const freq = new Map();
    tokenize(text).forEach((t) => {
        if (!STOPWORDS.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
    });
    return [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([word]) => word);
}

/**
 * Collect words that appear capitalised in the middle of sentences —
 * a reliable heuristic for proper nouns (characters, places, etc.).
 */
function extractNamedEntities(sentences) {
    const freq = new Map();
    sentences.forEach((s) => {
        const words = s.trim().split(/\s+/);
        // Skip the very first word of the sentence to avoid false positives
        words.slice(1).forEach((w) => {
            const clean = w.replace(/[^A-Za-z'-]/g, "");
            if (clean.length > 1 && /^[A-Z][a-z]/.test(clean)) {
                const key = clean.replace(/[^A-Za-z]/g, "");
                if (key.length > 1) freq.set(key, (freq.get(key) || 0) + 1);
            }
        });
    });
    // Only keep entities that appear at least twice (reduces noise)
    return [...freq.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word);
}

/**
 * Split text into individual sentences, keeping only those in a useful
 * length range for question generation.
 */
function splitSentences(text) {
    return text
        .replace(/\n+/g, " ")
        .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 40 && s.length <= 350);
}

function splitSentencesByPage(pages) {
    const items = [];
    pages.forEach((page) => {
        splitSentences(page.text || page.lines.join(" ")).forEach((sentence) => {
            items.push({ sentence, pageNum: page.pageNum });
        });
    });
    return items;
}

/**
 * Score each sentence by how many high-value keywords and named entities it
 * contains.  Higher score → better candidate for a question.
 */
function scoreSentences(sentenceItems, keywordSet, entitySet) {
    return sentenceItems.map((item, i) => {
        let score = 0;
        tokenize(item.sentence).forEach((w) => { if (keywordSet.has(w)) score += 1; });
        item.sentence.split(/\s+/).forEach((w) => {
            const clean = w.replace(/[^A-Za-z]/g, "");
            if (entitySet.has(clean)) score += 3;
        });
        // Slight preference for sentences containing factual cue words
        if (/\b(because|when|where|after|before|during|while|since)\b/i.test(item.sentence)) score += 1;
        // Mild recency penalty so questions are spread across the chapter
        score -= i * 0.005;
        return { ...item, score, index: i };
    });
}

/** Fisher-Yates shuffle (returns a new array). */
function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Try to build a fill-in-the-blank question from `sentence` by blanking out a
 * named entity.  Returns null if no suitable entity is found.
 */
function buildFillBlankQuestion(sentence, entityList) {
    const entitySet = new Set(entityList);
    // Find the first named entity that appears in this sentence
    const words = sentence.split(/\s+/);
    let targetWord = null;
    let targetClean = null;
    for (let i = 1; i < words.length; i++) {          // skip word 0 (sentence start)
        const clean = words[i].replace(/[^A-Za-z]/g, "");
        if (clean.length > 1 && entitySet.has(clean)) {
            targetWord = words[i];
            targetClean = clean;
            break;
        }
    }
    if (!targetClean) return null;

    // Build distractors from other entities not in this sentence
    const sentenceEntityTokens = new Set(
        words.slice(1).map((w) => w.replace(/[^A-Za-z]/g, "")).filter(Boolean)
    );
    const distractors = entityList
        .filter((e) => !sentenceEntityTokens.has(e) && e !== targetClean)
        .slice(0, 3);
    if (distractors.length < 3) return null;

    const blankSentence = sentence.replace(targetWord, "___");
    return {
        type: "fill-blank",
        question: `Fill in the blank: "${blankSentence}"`,
        correct: targetClean,
        distractors,
    };
}

/** Maximum character length for answer choices before they are truncated. */
const MAX_ANSWER_LENGTH = 110;

/**
 * Build a "which of the following is stated in the passage?" question using
 * `sentence` as the correct option and three unrelated sentences as distractors.
 */
function buildWhichStatedQuestion(sentence, allSentences, usedSet) {
    const truncate = (s) => (s.length > MAX_ANSWER_LENGTH ? s.substring(0, MAX_ANSWER_LENGTH) + "…" : s);

    // Gather distractors from sentences that are far apart in the text to
    // minimise thematic overlap, and that have not already been used as answers.
    const idx = allSentences.indexOf(sentence);
    const candidates = allSentences.filter((s, i) => {
        return Math.abs(i - idx) > 5 && !usedSet.has(s) && s !== sentence;
    });
    if (candidates.length < 3) return null;

    // Spread distractors across the chapter rather than clustering them
    const step = Math.floor(candidates.length / 3);
    const distractors = [
        candidates[0],
        candidates[step] || candidates[1],
        candidates[step * 2] || candidates[2],
    ].map(truncate);

    return {
        type: "which-stated",
        question: "According to the passage, which of the following is stated?",
        correct: truncate(sentence),
        distractors,
    };
}

/**
 * Main entry point: extract keywords/entities from `text`, score sentences,
 * then produce up to `count` multiple-choice questions.
 */
function generateQuestions(pages, count) {
    const chapterText = pages.map((p) => p.text || p.lines.join(" ")).join("\n\n");
    const keywords = extractKeywords(chapterText, 50);
    const keywordSet = new Set(keywords);
    const sentenceItems = splitSentencesByPage(pages);

    if (sentenceItems.length < 4) return [];          // not enough text

    const sentences = sentenceItems.map((item) => item.sentence);
    const entities = extractNamedEntities(sentences);
    const entitySet = new Set(entities);
    const scored = scoreSentences(sentenceItems, keywordSet, entitySet);
    scored.sort((a, b) => b.score - a.score);

    const questions = [];
    const usedSentences = new Set();

    // ── Pass 1: fill-in-the-blank questions (best for reading comprehension) ──
    for (const item of scored) {
        if (questions.length >= count) break;
        if (usedSentences.has(item.sentence)) continue;
        const q = buildFillBlankQuestion(item.sentence, entities);
        if (q) {
            questions.push({ ...q, sourcePage: item.pageNum });
            usedSentences.add(item.sentence);
        }
    }

    // ── Pass 2: "which is stated" questions to fill remaining slots ────────────
    for (const item of scored) {
        if (questions.length >= count) break;
        if (usedSentences.has(item.sentence)) continue;
        const q = buildWhichStatedQuestion(item.sentence, sentences, usedSentences);
        if (q) {
            questions.push({ ...q, sourcePage: item.pageNum });
            usedSentences.add(item.sentence);
        }
    }

    return questions.slice(0, count);
}

// ── Render generated quiz ──────────────────────────────────────────────────

/**
 * Build the four shuffled answer choices and record which letter is correct.
 */
function buildChoices(correct, distractors) {
    const options = shuffle([correct, ...distractors.slice(0, 3)]);
    const letters = ["A", "B", "C", "D"];
    const correctLetter = letters[options.indexOf(correct)];
    return { options, correctLetter };
}

/**
 * Render `questions` into `generatedOutput` and wire up the check-answers
 * button.  Stores the answer key in a closure so nothing is exposed in the DOM.
 */
function renderGeneratedQuiz(questions) {
    generatedOutput.innerHTML = "";
    genQuizActions.style.display = "none";
    genQuizResult.textContent = "";
    currentQuizData = null;

    if (questions.length === 0) {
        generatedOutput.innerHTML =
            '<p style="color:var(--error);">Could not generate enough questions from this text. ' +
            "Try selecting a longer section or one with more named characters and places.</p>";
        saveQuizSection.style.display = "none";
        return;
    }

    const renderedQuestions = [];
    const feedbackElements = [];

    questions.forEach((q, i) => {
        const { options, correctLetter } = buildChoices(q.correct, q.distractors);
        const renderedQuestion = {
            ...q,
            options,
            correctLetter,
        };
        renderedQuestions.push(renderedQuestion);

        const qDiv = document.createElement("div");
        qDiv.className = "question";

        const qTitle = document.createElement("h3");
        qTitle.textContent = `Question ${i + 1}`;
        qDiv.appendChild(qTitle);

        const qText = document.createElement("p");
        qText.textContent = q.question;
        qDiv.appendChild(qText);

        ["A", "B", "C", "D"].forEach((letter, li) => {
            const label = document.createElement("label");
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = `gq${i + 1}`;
            radio.value = letter;
            label.appendChild(radio);
            label.append(` ${letter}. ${options[li]}`);
            qDiv.appendChild(label);
            qDiv.appendChild(document.createElement("br"));
        });

        const feedback = document.createElement("p");
        feedback.className = "question-feedback";
        feedback.style.display = "none";
        qDiv.appendChild(feedback);
        feedbackElements.push(feedback);

        generatedOutput.appendChild(qDiv);
    });

    // Store quiz data for export
    currentQuizData = {
        chapterTitle: window.selectedChapterTitle || "Quiz",
        questions: renderedQuestions,
    };

    // Show the check-answers controls
    genQuizActions.style.display = "block";

    // Wire check-answers button with the local answer key
    checkGeneratedBtn.onclick = () => {
        let score = 0;
        renderedQuestions.forEach((question, i) => {
            const chosen = document.querySelector(`input[name="gq${i + 1}"]:checked`);
            const feedback = feedbackElements[i];
            const isCorrect = chosen && chosen.value === question.correctLetter;

            if (isCorrect) score++;

            if (feedback) {
                feedback.style.display = "block";
                feedback.textContent = isCorrect
                    ? `Correct. Source page: ${question.sourcePage ?? "N/A"}.`
                    : `Incorrect. Correct answer: ${question.correctLetter}. Source page: ${question.sourcePage ?? "N/A"}.`;
                feedback.style.color = isCorrect ? "var(--success-text)" : "var(--error)";
            }
        });
        genQuizResult.textContent =
            `You got ${score} / ${renderedQuestions.length} question${renderedQuestions.length !== 1 ? "s" : ""} correct.`;
    };

    // Show save button only when a user is signed in
    if (currentUser) {
        saveQuizSection.style.display = "block";
        saveQuizStatus.textContent = "";
        saveQuizBtn.disabled = false;
    }
}

// ── Generate button handler ────────────────────────────────────────────────

generateBtn.addEventListener("click", () => {
    const selectedChapter = selectedChapterIdx !== null ? chapters[selectedChapterIdx] : null;
    if (!selectedChapter || !pagesCache) return;

    const raw = parseInt(questionCountInput.value, 10);
    const count = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 5;
    questionCountInput.value = count;          // normalise the visible value

    // Reset output
    generatedOutput.innerHTML = "";
    genQuizActions.style.display = "none";
    genQuizResult.textContent = "";
    genSpinner.style.display = "block";
    generateBtn.disabled = true;

    // Defer heavy work to keep the UI responsive while the spinner renders
    setTimeout(() => {
        try {
            const chapterPages = pagesCache.filter(
                (page) => page.pageNum >= selectedChapter.startPage && page.pageNum <= selectedChapter.endPage
            );
            const questions = generateQuestions(chapterPages, count);
            lastGeneratedQuestions = questions;
            renderGeneratedQuiz(questions);
        } finally {
            genSpinner.style.display = "none";
            generateBtn.disabled = false;
        }
    }, 30);
});
