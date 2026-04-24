// PDF.js 4.x — imported as an ES module from the vendored local build.
import * as pdfjsLib from "./vendor/pdfjs/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.mjs";

"use strict";

// ── State ──────────────────────────────────────────────────────────────────
let pdfDoc = null;          // loaded PDF document
let chapters = [];          // array of { title, startPage, endPage, text }
let selectedChapterIdx = null;

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

/**
 * Score each sentence by how many high-value keywords and named entities it
 * contains.  Higher score → better candidate for a question.
 */
function scoreSentences(sentences, keywordSet, entitySet) {
    return sentences.map((sentence, i) => {
        let score = 0;
        tokenize(sentence).forEach((w) => { if (keywordSet.has(w)) score += 1; });
        sentence.split(/\s+/).forEach((w) => {
            const clean = w.replace(/[^A-Za-z]/g, "");
            if (entitySet.has(clean)) score += 3;
        });
        // Slight preference for sentences containing factual cue words
        if (/\b(because|when|where|after|before|during|while|since)\b/i.test(sentence)) score += 1;
        // Mild recency penalty so questions are spread across the chapter
        score -= i * 0.005;
        return { sentence, score, index: i };
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
function generateQuestions(text, count) {
    const keywords = extractKeywords(text, 50);
    const keywordSet = new Set(keywords);
    const sentences = splitSentences(text);

    if (sentences.length < 4) return [];          // not enough text

    const entities = extractNamedEntities(sentences);
    const entitySet = new Set(entities);
    const scored = scoreSentences(sentences, keywordSet, entitySet);
    scored.sort((a, b) => b.score - a.score);

    const questions = [];
    const usedSentences = new Set();

    // ── Pass 1: fill-in-the-blank questions (best for reading comprehension) ──
    for (const { sentence } of scored) {
        if (questions.length >= count) break;
        if (usedSentences.has(sentence)) continue;
        const q = buildFillBlankQuestion(sentence, entities);
        if (q) {
            questions.push(q);
            usedSentences.add(sentence);
        }
    }

    // ── Pass 2: "which is stated" questions to fill remaining slots ────────────
    for (const { sentence } of scored) {
        if (questions.length >= count) break;
        if (usedSentences.has(sentence)) continue;
        const q = buildWhichStatedQuestion(sentence, sentences, usedSentences);
        if (q) {
            questions.push(q);
            usedSentences.add(sentence);
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

    if (questions.length === 0) {
        generatedOutput.innerHTML =
            '<p style="color:#ff6b6b;">Could not generate enough questions from this text. ' +
            "Try selecting a longer section or one with more named characters and places.</p>";
        return;
    }

    const answerKey = [];   // e.g. ["B", "A", "D", …]

    questions.forEach((q, i) => {
        const { options, correctLetter } = buildChoices(q.correct, q.distractors);
        answerKey.push(correctLetter);

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

        generatedOutput.appendChild(qDiv);
    });

    // Show the check-answers controls
    genQuizActions.style.display = "block";

    // Wire check-answers button with the local answer key
    checkGeneratedBtn.onclick = () => {
        let score = 0;
        answerKey.forEach((correct, i) => {
            const chosen = document.querySelector(`input[name="gq${i + 1}"]:checked`);
            if (chosen && chosen.value === correct) score++;
        });
        genQuizResult.textContent =
            `You got ${score} / ${answerKey.length} question${answerKey.length !== 1 ? "s" : ""} correct.`;
    };
}

// ── Generate button handler ────────────────────────────────────────────────

generateBtn.addEventListener("click", () => {
    const text = window.selectedChapterText;
    if (!text) return;

    const raw = parseInt(questionCountInput.value, 10);
    const count = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 20) : 5;
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
            const questions = generateQuestions(text, count);
            renderGeneratedQuiz(questions);
        } finally {
            genSpinner.style.display = "none";
            generateBtn.disabled = false;
        }
    }, 30);
});
