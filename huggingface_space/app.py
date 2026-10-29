"""
FEEDback Classifier — HuggingFace Space
Model: MoritzLaurer/deberta-v3-base-zeroshot-v1

Exposes a /classify endpoint that:
- Takes a JSON array of student feedback comments
- Returns appreciation vs needs_attention classification
- Runs on HuggingFace free CPU tier (no GPU needed)
"""

import os
import json
import warnings
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from transformers import pipeline

# ── Load model once at startup ────────────────────────────────────────────────
print("[Startup] Loading DeBERTa zero-shot classifier...")
classifier = pipeline(
    "zero-shot-classification",
    model="MoritzLaurer/deberta-v3-base-zeroshot-v2.0",
    device=-1  # CPU
)
print("[Startup] Model loaded successfully!")

import re

# ── Label config ──────────────────────────────────────────────────────────────
# Natural semantic labels give DeBERTa 85%+ accuracy on subtle/mixed complaints
LABEL_APPRECIATION = "The student praises the teacher's teaching quality, helpfulness, or performance."
LABEL_ATTENTION    = "The student expresses a complaint, identifies a problem, or suggests an improvement in teaching or learning."
SENTIMENT_LABELS   = [LABEL_APPRECIATION, LABEL_ATTENTION]

# ── Spam & Keyboard Mash Patterns ─────────────────────────────────────────────
SPAM_PATTERNS = [
    re.compile(r'([a-z])\1{2,}', re.I),                  # repeated char 3+ times (e.g. ttrrr, aaaaa)
    re.compile(r'[bcdfghjklmnpqrstvwxz]{6,}', re.I),      # 6 consonants in a row (prevents flagging 'strengths'/'lengths')
    re.compile(r'(asdf|dfgh|ghjk|hjkl|zxcv|xcvb|cvbn|qwerty|qazwsx|wsxedc|fhdj)', re.I), # keyboard rows
    re.compile(r'\b(?:\w*[zxqj]){3,}\w*\b', re.I),        # 3+ rare letters (z,x,q,j) in a single word (e.g. Ugsggizkvgizgx)
]

def is_spam(text: str) -> bool:
    for rx in SPAM_PATTERNS:
        if rx.search(text):
            return True
    return False

# ── High-Priority Needs Attention Pre-Rules ───────────────────────────────────
# If matched, classified directly as NEEDS_ATTENTION to prevent leaks
ATTENTION_RULES = [
    # Equipment, wifi, lab, devices, malfunctions (e.g. "equipments not functioning like wifi and all")
    re.compile(r'\b(not\s+(functioning|working|available|adequate|responding|proper|clear))\b', re.I),
    re.compile(r'\b(equipment|equipments|device|devices|wifi|internet|network|pc|pcs|computer|computers|system|systems|projector|screen|mic|microphone|speaker|ac|software|compiler|setup)\s.{0,30}(not|issue|problem|broken|down|slow|fail|error|poor|bug|missing|fault|trouble)\b', re.I),
    re.compile(r'\b(issue|issues|problem|problems|trouble|fault|faults|defect|defects|error|errors)\s.{0,25}(wifi|internet|network|equipment|pc|computer|system|projector|mic|software|compiler|lab|device)\b', re.I),
    re.compile(r'\b(wifi|internet|network|compiler|vs\s*code|software|system|hardware|equipment|projector|mic)\s+(issue|problem|down|slow|trouble|error|glitch)\b', re.I),

    # Suggestions / improvement requests
    re.compile(r'\b(can|could|should|must)\s+be\s+(more|better|a\s+bit|little)\b', re.I),
    re.compile(r'\b(please|kindly|request)\s+(to\s+)?(provide|share|upload|give|send|fix|check|change|improve|make|start|use|help|increase|decrease|slow|speed)\b', re.I),
    re.compile(r'\b(need|needs|needed|require|requires)\s+(more|better|proper|to\s+be|extra)\b', re.I),
    re.compile(r'\b(pace|speed)\s.{0,30}(can\s+be\s+better|could\s+be\s+better|improve|problem|fast|slow)\b', re.I),
    re.compile(r'\bproblem\s+(just\s+)?(lies|is|with)\b', re.I),
    re.compile(r'\b(try\s+(to\s+)?(better|understand)|better\s+understand\w*)\b', re.I),
    re.compile(r'\b(not\s+on\s+time|not\s+in\s+time|delay(ed)?)\b', re.I),
    re.compile(r'\bsyllabus\s.{0,30}(not\s+(on\s+time|complete|covered))\b', re.I),
    re.compile(r'\b(too\s+fast|too\s+slow|fast\s+pace|slow\s+pace)\b', re.I),
    re.compile(r'\b(not\s+at\s+all\s+engaging|not\s+engaging|not\s+interactive|class\s+is\s+not)\b', re.I),
    re.compile(r'\btakes?\s+too\s+much\s+time\b', re.I),
    re.compile(r'\b(little\s+bit\s+louder|more\s+loud|speak\s+louder|listen\s+to\s+students?)\b', re.I),
    re.compile(r'\b(improve|improvement|needs?\s+to\s+improve)\b', re.I),
    re.compile(r'\bnotes?\s.{0,20}(not|never|delay|late|missing)\b', re.I),

    # Contrast clauses where the first part was an issue (e.g. "... and else lab is too good", "... rest is good")
    re.compile(r'\b(and\s+)?(else|rest|otherwise)\s+(is\s+)?(all\s+)?(good|fine|ok|okay|nice|well|decent|too\s+good)\b', re.I),
]

def matches_attention_rule(text: str) -> bool:
    for rx in ATTENTION_RULES:
        if rx.search(text):
            return True
    return False

# ── Clause Splitting & Suggestion Rules (Per-clause classification) ───────────
# Polite suggestions that the model tends to treat as praise when mixed
SUGGESTION_RX = re.compile(
    r"\b(would|could)\s+(help|be\s+(better|great|good|nice|helpful))\b"
    r"|\bi\s+(suggest|request|wish)\b"
    r"|\bit\s+would\s+be\b"
    r"|\bshould\b",
    re.I,
)

CLAUSE_SPLIT = re.compile(
    r"(?<=[.!?])\s+|\s*;\s*|\s+(?:but|however|although|though|except)\s+",
    re.I,
)
CONTRAST_RX = re.compile(r'\b(but|however|although|though|except)\b', re.I)
ATTN_THRESHOLD = 0.5  # lower = catches more suggestions, more false alarms

def split_clauses(text: str):
    parts = [p.strip(" ,.") for p in CLAUSE_SPLIT.split(text) if p]
    parts = [p for p in parts if len(p) >= 8]
    return parts or [text]

CATEGORY_LABELS = [
    "teaching clarity and explanation style",
    "voice, communication, and classroom engagement",
    "availability for doubts and student support",
    "study materials, notes, and slides",
    "exams, quizzes, and grading fairness"
]
CATEGORY_MAP = {
    "teaching clarity and explanation style":         "Teaching",
    "voice, communication, and classroom engagement": "Communication",
    "availability for doubts and student support":    "Availability",
    "study materials, notes, and slides":             "Materials",
    "exams, quizzes, and grading fairness":           "Assessment"
}

NEUTRAL_FILLERS = {
    "ok","okay","fine","good","nice","average","normal","moderate","alright",
    "decent","nil","na","n/a","none","nothing","all good","no issue",
    "no problem","no remarks","no remark","no remarks needed","everything is fine","satisfactory",
    "everything is good","all is well","all is good","everything good",
    "no changes needed","no complaints"
}

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="FEEDback Classifier API")

@app.get("/")
def root():
    return {"status": "ok", "model": "MoritzLaurer/deberta-v3-base-zeroshot-v1"}

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/classify")
async def classify(request: Request):
    try:
        body = await request.json()
        comments = body if isinstance(body, list) else body.get("comments", [])

        result = {
            "appreciation": [],
            "commentsNeedingAttention": [],
            "commentCategories": {
                "Teaching": [], "Communication": [], "Availability": [],
                "Materials": [], "Assessment": [], "General": []
            },
            "classifiedComments": [],
            "statistics": {
                "totalReceived": len(comments),
                "appreciation": 0, "attention": 0,
                "neutral": 0, "skipped": 0, "aiClassified": 0
            }
        }

        # Filter valid comments
        valid = []
        rule_attention = []
        for raw in comments:
            if not raw or not isinstance(raw, str):
                result["statistics"]["skipped"] += 1
                continue
            cleaned = " ".join(raw.split()).strip()
            if not cleaned or len(cleaned) < 3:
                result["statistics"]["skipped"] += 1
                continue

            # 1. Check Spam / Keyboard Mash
            if is_spam(cleaned):
                result["statistics"]["skipped"] += 1
                result["classifiedComments"].append({
                    "text": cleaned, "classification": "skipped",
                    "needsAttention": False, "confidence": 1.0, "reason": "spam-or-gibberish"
                })
                continue

            # 2. Check Neutral filler
            lower = cleaned.lower().rstrip(".,!?;:")
            if lower in NEUTRAL_FILLERS:
                result["statistics"]["neutral"] += 1
                result["classifiedComments"].append({
                    "text": cleaned, "classification": "neutral",
                    "needsAttention": False, "confidence": 1.0, "reason": "neutral-filler"
                })
                continue

            # 3. Check High-Priority Attention Pre-Rules
            if matches_attention_rule(cleaned):
                rule_attention.append(cleaned)
                continue

            valid.append(cleaned)

        attention_texts = []
        attention_entries = []

        # Process pre-rule attention items immediately
        for text in rule_attention:
            if text not in result["commentsNeedingAttention"]:
                result["commentsNeedingAttention"].append(text)
            result["statistics"]["attention"] += 1
            entry = {
                "text": text, "classification": "attention",
                "needsAttention": True, "confidence": 0.99,
                "topLabel": "NEEDS_ATTENTION", "category": "General",
                "reason": "rule"
            }
            result["classifiedComments"].append(entry)
            attention_texts.append(text)
            attention_entries.append(entry)

        # Batch classify remaining comments with DeBERTa
        if valid:
            # 1. Classify whole comments with DeBERTa
            whole_preds = classifier(
                valid,
                candidate_labels=SENTIMENT_LABELS,
                multi_label=False,
                batch_size=8,
            )
            if isinstance(whole_preds, dict):
                whole_preds = [whole_preds]

            print("THis is the prediction", whole_preds)

            # 2. Check clauses for polite suggestions or contrast statements
            clause_tasks = []  # list of (comment_index, clause_text, task_type)
            for i, text in enumerate(valid):
                clauses = split_clauses(text)
                for c in clauses:
                    if SUGGESTION_RX.search(c):
                        clause_tasks.append((i, c, "suggestion"))
                    elif CONTRAST_RX.search(text) and len(clauses) > 1:
                        clause_tasks.append((i, c, "contrast"))

            clause_pred_map = {i: {"has_suggestion": False, "contrast_issue": 0.0} for i in range(len(valid))}

            if clause_tasks:
                clause_texts = [t[1] for t in clause_tasks]
                c_preds = classifier(
                    clause_texts,
                    candidate_labels=SENTIMENT_LABELS,
                    multi_label=False,
                    batch_size=8
                )
                if isinstance(c_preds, dict):
                    c_preds = [c_preds]

                for (idx, c_text, task_type), cp in zip(clause_tasks, c_preds):
                    if task_type == "suggestion":
                        clause_pred_map[idx]["has_suggestion"] = True
                    elif task_type == "contrast":
                        s = {l.strip(): float(v) for l, v in zip(cp["labels"], cp["scores"])}
                        clause_pred_map[idx]["contrast_issue"] = max(
                            clause_pred_map[idx]["contrast_issue"],
                            s.get(LABEL_ATTENTION, 0.0)
                        )

            result["statistics"].setdefault("mixed", 0)

            for i, text in enumerate(valid):
                wp = whole_preds[i]
                s = {l.strip(): float(v) for l, v in zip(wp["labels"], wp["scores"])}
                praise_score = s.get(LABEL_APPRECIATION, 0.0)
                issue_score = s.get(LABEL_ATTENTION, 0.0)

                has_sugg = clause_pred_map[i]["has_suggestion"] or bool(SUGGESTION_RX.search(text))
                contrast_issue = clause_pred_map[i]["contrast_issue"] >= ATTN_THRESHOLD

                # Overwhelming praise (>0.80) with no explicit suggestion/contrast issue is APPRECIATION
                if praise_score >= 0.80 and not has_sugg and not contrast_issue:
                    has_issue = False
                    mixed = False
                elif has_sugg or contrast_issue or issue_score >= ATTN_THRESHOLD:
                    has_issue = True
                    mixed = (praise_score >= 0.35)
                else:
                    has_issue = False
                    mixed = False

                result["statistics"]["aiClassified"] += 1
                final_issue_score = max(issue_score, 0.90 if has_sugg else 0.0, clause_pred_map[i]["contrast_issue"])
                scores = {
                    "APPRECIATION": round(praise_score, 4),
                    "NEEDS_ATTENTION": round(final_issue_score, 4),
                }

                if not has_issue:
                    if text not in result["appreciation"]:
                        result["appreciation"].append(text)
                    result["statistics"]["appreciation"] += 1
                    result["classifiedComments"].append({
                        "text": text, "classification": "appreciation",
                        "needsAttention": False, "confidence": scores["APPRECIATION"],
                        "topLabel": "APPRECIATION", "scores": scores,
                    })
                else:
                    if text not in result["commentsNeedingAttention"]:
                        result["commentsNeedingAttention"].append(text)
                    result["statistics"]["attention"] += 1
                    if mixed:
                        result["statistics"]["mixed"] += 1
                    entry = {
                        "text": text, "classification": "attention",
                        "needsAttention": True, "mixed": mixed,
                        "confidence": scores["NEEDS_ATTENTION"],
                        "topLabel": "NEEDS_ATTENTION", "category": "General",
                        "scores": scores,
                    }
                    result["classifiedComments"].append(entry)
                    attention_texts.append(text)
                    attention_entries.append(entry)

        # Categorize attention comments
        if attention_texts:
            cat_preds = classifier(
                attention_texts,
                candidate_labels=CATEGORY_LABELS,
                hypothesis_template="This feedback is about {}.",
                multi_label=False,
                batch_size=8
            )
            if isinstance(cat_preds, dict):
                cat_preds = [cat_preds]

            for entry, cat_pred in zip(attention_entries, cat_preds):
                category = CATEGORY_MAP.get(cat_pred["labels"][0], "General")
                entry["category"] = category
                if entry["text"] not in result["commentCategories"][category]:
                    result["commentCategories"][category].append(entry["text"])
        # ── Calculate Appreciation Breakdown (Good, Very Good, Excellent) ─────
        raw_appreciation = list(result["appreciation"])

        EXC_RX = re.compile(r'\b(excellent|outstanding|superb|brilliant|best|mind blowing|profoundly|love the way|amazing|5 star|perfect)\b', re.I)
        VG_RX  = re.compile(r'\b(very good|very well|very nice|very clear|very helpful|very great|very practical|prepared.*very well|soo desperate)\b', re.I)

        app_counts = {"Excellent": 0, "Very Good": 0, "Good": 0}
        for text in raw_appreciation:
            if EXC_RX.search(text):
                app_counts["Excellent"] += 1
            elif VG_RX.search(text):
                app_counts["Very Good"] += 1
            else:
                app_counts["Good"] += 1

        total_app = len(raw_appreciation) or 1
        result["commentPercentages"] = {
            k: round((v / total_app) * 100) for k, v in app_counts.items() if v > 0
        }
        result["appreciationCounts"] = app_counts
        result["rawAppreciation"] = raw_appreciation

        # Filter out comments with less than 6 words or trivial filler like "very good"
        TRIVIAL_APP_RX = re.compile(r'^(very good|good|nice|ok|okay|fine|sir very good|teaches good|good teacher|all is fine|rich content|everything is nice|everything is perfect|every thing is good|no remarks needed)$', re.I)
        result["appreciation"] = [
            c for c in raw_appreciation
            if len(c.strip(" .,!?;:").split()) >= 6 and not TRIVIAL_APP_RX.match(c.strip())
        ]
        result["statistics"]["appreciation"] = len(result["appreciation"])

        return JSONResponse(result)

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


# ── Run with Gradio wrapper so HF Spaces serves it correctly ─────────────────
import gradio as gr

def classify_ui(comments_json: str):
    """Simple Gradio UI for testing in the Space browser."""
    try:
        comments = json.loads(comments_json)
        import httpx, asyncio
        # Just run the logic directly for UI
        result = asyncio.run(_classify_direct(comments))
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Error: {e}"

async def _classify_direct(comments):
    from fastapi.testclient import TestClient
    client = TestClient(app)
    resp = client.post("/classify", json=comments)
    return resp.json()

demo = gr.Interface(
    fn=classify_ui,
    inputs=gr.Textbox(
        label="Comments (JSON array)",
        placeholder='["Sir explains very well", "Notes not provided on time"]',
        lines=5
    ),
    outputs=gr.Textbox(label="Result", lines=20),
    title="FEEDback Classifier",
    description="Student feedback → APPRECIATION / NEEDS_ATTENTION"
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=7860)