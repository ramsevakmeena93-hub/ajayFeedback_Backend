import os
import sys
import json
import warnings

# Suppress unnecessary warnings
warnings.filterwarnings("ignore")
os.environ["TOKENIZERS_PARALLELISM"] = "false"

from transformers import pipeline

MODEL_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "deberta-zeroshot"))
if not os.path.exists(os.path.join(MODEL_DIR, "model.safetensors")):
    MODEL_DIR = "MoritzLaurer/deberta-v3-base-zeroshot-v1"

SENTIMENT_LABELS = ["appreciation and praise", "criticism or problem needing attention"]
SENTIMENT_TEMPLATE = "This student feedback expresses {}."

CATEGORY_LABELS = [
    "teaching clarity and explanation",
    "teacher communication, voice, and student engagement",
    "teacher punctuality and availability for doubts",
    "study materials, slides, and notes",
    "exams, tests, quizzes, and grading fairness"
]
CATEGORY_MAP = {
    "teaching clarity and explanation": "Teaching",
    "teacher communication, voice, and student engagement": "Communication",
    "teacher punctuality and availability for doubts": "Availability",
    "study materials, slides, and notes": "Materials",
    "exams, tests, quizzes, and grading fairness": "Assessment"
}

_classifier = None

def get_classifier():
    global _classifier
    if _classifier is None:
        _classifier = pipeline("zero-shot-classification", model=MODEL_DIR, device=-1)
    return _classifier

def is_neutral_filler(text):
    t = text.strip().lower().rstrip(".,!?")
    fillers = {"ok", "okay", "fine", "good", "nice", "average", "normal", "moderate", "alright", "decent", "nil", "na", "n/a", "none", "nothing", "all good", "no issue", "no problem", "everything is fine", "satisfactory"}
    return t in fillers

def classify_batch(comments):
    classifier = get_classifier()

    result = {
        "appreciation": [],
        "commentsNeedingAttention": [],
        "commentCategories": {
            "Teaching": [],
            "Communication": [],
            "Availability": [],
            "Materials": [],
            "Assessment": [],
            "General": []
        },
        "classifiedComments": [],
        "statistics": {
            "totalReceived": len(comments),
            "appreciation": 0,
            "attention": 0,
            "neutral": 0,
            "skipped": 0,
            "aiClassified": 0
        }
    }

    valid_indices = []
    valid_texts = []

    for idx, raw in enumerate(comments):
        if not raw or not isinstance(raw, str):
            result["statistics"]["skipped"] += 1
            continue
        cleaned = " ".join(raw.split()).strip()
        if not cleaned or len(cleaned) < 2:
            result["statistics"]["skipped"] += 1
            continue

        if is_neutral_filler(cleaned):
            result["statistics"]["neutral"] += 1
            result["classifiedComments"].append({
                "text": cleaned,
                "classification": "neutral",
                "needsAttention": False,
                "confidence": 1.0,
                "reason": "neutral-filler"
            })
            continue

        valid_indices.append(idx)
        valid_texts.append(cleaned)

    if not valid_texts:
        return result

    # Batch classify sentiment
    predictions = classifier(
        valid_texts,
        candidate_labels=SENTIMENT_LABELS,
        hypothesis_template=SENTIMENT_TEMPLATE,
        multi_label=False,
        batch_size=8
    )
    if isinstance(predictions, dict):
        predictions = [predictions]

    # Attention comments to categorize
    attention_texts = []
    attention_items = []

    for item, orig_text in zip(predictions, valid_texts):
        top_label = item["labels"][0]
        confidence = float(item["scores"][0])
        is_apprec = "appreciation" in top_label

        result["statistics"]["aiClassified"] += 1

        if is_apprec:
            if orig_text not in result["appreciation"]:
                result["appreciation"].append(orig_text)
            result["statistics"]["appreciation"] += 1
            result["classifiedComments"].append({
                "text": orig_text,
                "classification": "appreciation",
                "needsAttention": False,
                "confidence": round(confidence, 4),
                "topLabel": "APPRECIATION"
            })
        else:
            if orig_text not in result["commentsNeedingAttention"]:
                result["commentsNeedingAttention"].append(orig_text)
            result["statistics"]["attention"] += 1
            entry = {
                "text": orig_text,
                "classification": "attention",
                "needsAttention": True,
                "confidence": round(confidence, 4),
                "topLabel": "NEEDS_ATTENTION",
                "category": "General"
            }
            result["classifiedComments"].append(entry)
            attention_texts.append(orig_text)
            attention_items.append(entry)

    # Classify categories for comments needing attention
    if attention_texts:
        cat_preds = classifier(
            attention_texts,
            candidate_labels=CATEGORY_LABELS,
            hypothesis_template="This concern relates to {}.",
            multi_label=False,
            batch_size=8
        )
        if isinstance(cat_preds, dict):
            cat_preds = [cat_preds]

        for entry, cat_item in zip(attention_items, cat_preds):
            best_cat_label = cat_item["labels"][0]
            assigned_cat = CATEGORY_MAP.get(best_cat_label, "General")
            entry["category"] = assigned_cat
            if entry["text"] not in result["commentCategories"][assigned_cat]:
                result["commentCategories"][assigned_cat].append(entry["text"])

    return result

def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--single":
        # Single comment classification test
        text = sys.argv[2] if len(sys.argv) > 2 else "Great teaching style and very clear."
        res = classify_batch([text])
        print(json.dumps(res, indent=2))
        return

    # Read JSON array from stdin or file
    input_data = sys.stdin.read().strip()
    if not input_data:
        print(json.dumps({"error": "No input provided"}))
        return

    try:
        parsed = json.loads(input_data)
        comments = parsed if isinstance(parsed, list) else parsed.get("comments", [])
        result = classify_batch(comments)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()
