"""
Test the HuggingFace Inference API for DeBERTa zero-shot classification.

Run this script from YOUR machine or Render shell:
    python scripts/test_hf_api.py

Or set your token:
    python scripts/test_hf_api.py hf_yourtoken
"""

import sys
import json
import requests

HF_TOKEN = sys.argv[1] if len(sys.argv) > 1 else None
API_URL  = "https://api-inference.huggingface.co/models/MoritzLaurer/deberta-v3-base-zeroshot-v1"

HEADERS = {
    "Content-Type": "application/json",
    **({"Authorization": f"Bearer {HF_TOKEN}"} if HF_TOKEN else {})
}

TEST_COMMENTS = [
    # Should be APPRECIATION
    "The faculty explains concepts clearly and gives practical examples.",
    "Best teacher. All concepts are crystal clear.",
    "Very good teacher overall, always helpful.",
    "Sir is dedicated, patient and explains everything nicely.",

    # Should be NEEDS_ATTENTION
    "Sir should slow down, we cannot follow the pace.",
    "Notes are not shared on time. We rely on online resources.",
    "He created a fear in classroom — students are scared to ask doubts.",
    "The quiz was out of syllabus and marks are not justified.",
    "Please change the teaching style, it is very boring.",
]

print("=" * 60)
print(f"Testing HF Inference API")
print(f"Token: {'SET ✓' if HF_TOKEN else 'NOT SET (rate-limited)'}")
print("=" * 60)

correct = 0
total   = len(TEST_COMMENTS)

for i, comment in enumerate(TEST_COMMENTS):
    expected = "APPRECIATION" if i < 4 else "NEEDS_ATTENTION"
    try:
        payload = {
            "inputs": comment,
            "parameters": {
                "candidate_labels": ["appreciation", "complaint or suggestion"],
                "hypothesis_template": "This student feedback about a teacher is a {}.",
                "multi_label": False
            }
        }
        resp = requests.post(API_URL, headers=HEADERS, json=payload, timeout=30)

        if resp.status_code == 503:
            print(f"[{i+1}] Model loading... wait 20s and retry")
            import time; time.sleep(20)
            resp = requests.post(API_URL, headers=HEADERS, json=payload, timeout=30)

        data       = resp.json()
        top_label  = data["labels"][0]
        confidence = round(data["scores"][0], 4)
        predicted  = "APPRECIATION" if top_label == "appreciation" else "NEEDS_ATTENTION"
        is_correct = predicted == expected
        if is_correct:
            correct += 1

        status = "✓" if is_correct else "✗"
        print(f"[{status}] {predicted} ({confidence}) | {comment[:55]}...")

    except Exception as e:
        print(f"[!] ERROR: {e} | {comment[:50]}")

print("=" * 60)
print(f"Accuracy: {correct}/{total} = {round(correct/total*100)}%")
print("=" * 60)
