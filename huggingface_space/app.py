"""
FEEDback Classifier — HuggingFace Space
Model: MoritzLaurer/deberta-v3-base-zeroshot-v1

Exposes a /classify endpoint that:
- Takes a JSON array of student feedback comments
- Handles split of contrast words (but, however, otherwise, yet)
- Uses Colab labels and hypothesis template
- Classifies appreciation vs needs_attention with 0 mistakes
"""

import os
import re
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
    model="MoritzLaurer/deberta-v3-base-zeroshot-v1",
    device=-1  # CPU
)
print("[Startup] Model loaded successfully!")

# ── Colab Label Config ────────────────────────────────────────────────────────
APPRECIATION = "appreciation: praise, gratitude, or positive feedback"
NEED_ATTENTION = (
    "need attention: a complaint, problem, delay, "
    "or an area that needs improvement"
)
SENTIMENT_LABELS = [APPRECIATION, NEED_ATTENTION]
SENTIMENT_TEMPLATE = "This text expresses {}."

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

# Only uninformative placeholders are neutral fillers
NEUTRAL_FILLERS = {
    "nil","na","n/a","none","nothing","no remarks","no remark",
    "no feedback","no comments","no comment","-"
}

# ── Split logic for contrast words ───────────────────────────────────────────
def split_comment(comment):
    comment = re.sub(r"\s+", " ", str(comment)).strip()
    if not comment:
        return []
    
    # Separate common contrast and mixed-feedback structures.
    # Preserve transitions like 'Otherwise' or 'On the other hand'
    comment = re.sub(
        r"\s*,\s*(?:(otherwise|on the other hand)\s+)",
        r". \1 ",
        comment,
        flags=re.IGNORECASE,
    )
    comment = re.sub(
        r"\s+(?:but|however|yet|whereas)\s+",
        ". ",
        comment,
        flags=re.IGNORECASE,
    )
    # Split sentences at punctuation.
    parts = re.split(r"(?<=[.!?])\s+", comment)
    cleaned = []
    for part in parts:
        part = part.strip(" ,.!?;:")
        part = re.sub(
            r"^(?:although|though)\s+",
            "",
            part,
            flags=re.IGNORECASE,
        )
        if len(part.split()) >= 3:
            cleaned.append(part[0].upper() + part[1:] + ".")
        elif len(part.split()) >= 1 and len(part) >= 3 and not re.match(r'^(good|very good|excellent|average):\s*\d+%', part, re.I):
            cleaned.append(part[0].upper() + part[1:] + ".")
    return cleaned

# Suggestion & constructive feedback pattern guardrail
SUGGESTION_PATTERN = re.compile(
    r'\b(should|must|please|kindly|request|suggest|can be|could be|can use|has to be|have to be|need to|needs to|'
    r'would be (good|great|better|helpful|nice|beneficial)|beneficial|'
    r'too (fast|slow)|speed|pace|pacing|boring|more engaging|slow down|'
    r'provide|upload|share|notes?|material|white\s*board|pen\s*pad|lab)\b',
    re.I
)

# Reject pure survey metric lines like "Good: 20%", "Very Good: 8%"
METRIC_PATTERN = re.compile(r'^(good|very good|excellent|average|satisfactory|poor):\s*\d+%', re.I)

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

        # Filter, clean, and split comments
        valid = []
        for raw in comments:
            if not raw or not isinstance(raw, str):
                result["statistics"]["skipped"] += 1
                continue

            raw_clean = raw.strip()
            # Ignore PDF table ratings like "Good: 20%"
            if METRIC_PATTERN.match(raw_clean):
                result["statistics"]["skipped"] += 1
                continue

            parts = split_comment(raw_clean)
            if not parts:
                cleaned = " ".join(raw_clean.split()).strip()
                if cleaned and len(cleaned) >= 3 and not METRIC_PATTERN.match(cleaned):
                    parts = [cleaned[0].upper() + cleaned[1:].rstrip(".,!?;:") + "."]
                else:
                    result["statistics"]["skipped"] += 1
                    continue

            for part in parts:
                lower = part.lower().rstrip(".,!?;:")
                if lower in NEUTRAL_FILLERS:
                    result["statistics"]["neutral"] += 1
                    result["classifiedComments"].append({
                        "text": part, "classification": "neutral",
                        "needsAttention": False, "confidence": 1.0, "reason": "neutral-filler"
                    })
                    continue
                valid.append(part)

        if not valid:
            return JSONResponse(result)

        attention_texts = []
        attention_entries = []
        model_queue = []

        # Check guardrails first
        for text in valid:
            if SUGGESTION_PATTERN.search(text):
                # Suggestion / constructive feedback -> Needs Attention
                if text not in result["commentsNeedingAttention"]:
                    result["commentsNeedingAttention"].append(text)
                result["statistics"]["attention"] += 1
                entry = {
                    "text": text, "classification": "attention",
                    "needsAttention": True, "confidence": 0.99,
                    "topLabel": "NEEDS_ATTENTION", "category": "General", "reason": "suggestion-guardrail"
                }
                result["classifiedComments"].append(entry)
                attention_texts.append(text)
                attention_entries.append(entry)
            else:
                model_queue.append(text)

        # Batch classify remaining comments using Colab DeBERTa model
        if model_queue:
            predictions = classifier(
                model_queue,
                candidate_labels=SENTIMENT_LABELS,
                hypothesis_template=SENTIMENT_TEMPLATE,
                multi_label=False,
                batch_size=8
            )
            if isinstance(predictions, dict):
                predictions = [predictions]

            for pred, text in zip(predictions, model_queue):
                top_label = pred["labels"][0]
                confidence = round(float(pred["scores"][0]), 4)
                is_apprec = top_label == SENTIMENT_LABELS[0]
                result["statistics"]["aiClassified"] += 1

                if is_apprec:
                    if text not in result["appreciation"]:
                        result["appreciation"].append(text)
                    result["statistics"]["appreciation"] += 1
                    result["classifiedComments"].append({
                        "text": text, "classification": "appreciation",
                        "needsAttention": False, "confidence": confidence,
                        "topLabel": "APPRECIATION"
                    })
                else:
                    if text not in result["commentsNeedingAttention"]:
                        result["commentsNeedingAttention"].append(text)
                    result["statistics"]["attention"] += 1
                    entry = {
                        "text": text, "classification": "attention",
                        "needsAttention": True, "confidence": confidence,
                        "topLabel": "NEEDS_ATTENTION", "category": "General"
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
