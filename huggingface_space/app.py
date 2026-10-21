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
    model="MoritzLaurer/deberta-v3-base-zeroshot-v1",
    device=-1  # CPU
)
print("[Startup] Model loaded successfully!")

# ── Label config ──────────────────────────────────────────────────────────────
SENTIMENT_LABELS   = ["appreciation", "complaint or suggestion"]
SENTIMENT_TEMPLATE = "This student feedback about a teacher is a {}."

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
    "no problem","no remarks","no remark","everything is fine","satisfactory",
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
        for raw in comments:
            if not raw or not isinstance(raw, str):
                result["statistics"]["skipped"] += 1
                continue
            cleaned = " ".join(raw.split()).strip()
            if not cleaned or len(cleaned) < 3:
                result["statistics"]["skipped"] += 1
                continue
            lower = cleaned.lower().rstrip(".,!?;:")
            if lower in NEUTRAL_FILLERS:
                result["statistics"]["neutral"] += 1
                result["classifiedComments"].append({
                    "text": cleaned, "classification": "neutral",
                    "needsAttention": False, "confidence": 1.0, "reason": "neutral-filler"
                })
                continue
            valid.append(cleaned)

        if not valid:
            return JSONResponse(result)

        # Batch classify sentiment (batch_size=8 for speed)
        predictions = classifier(
            valid,
            candidate_labels=SENTIMENT_LABELS,
            hypothesis_template=SENTIMENT_TEMPLATE,
            multi_label=False,
            batch_size=8
        )
        if isinstance(predictions, dict):
            predictions = [predictions]

        attention_texts  = []
        attention_entries = []

        for pred, text in zip(predictions, valid):
            top_label  = pred["labels"][0]
            confidence = round(float(pred["scores"][0]), 4)
            is_apprec  = top_label == "appreciation"
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
