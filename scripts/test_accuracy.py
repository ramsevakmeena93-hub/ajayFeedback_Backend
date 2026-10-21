import os
from transformers import pipeline

model_dir = os.path.abspath("backend/models/deberta-zeroshot")
classifier = pipeline("zero-shot-classification", model=model_dir)

comments = [
    "The faculty explains concepts clearly and gives practical examples that make learning easier.",
    "Very helpful teacher, always available to solve our queries after class.",
    "Best professor for this subject, made everything so simple to understand.",
    "The teacher speaks very fast and skips important formulas without explanation.",
    "Notes are not uploaded on time and syllabus is incomplete before exams.",
    "Lab systems were not working and faculty did not guide us with the errors."
]

labels = ["appreciation and praise", "criticism or problem needing attention"]
template = "This student feedback expresses {}."

print("="*65)
print("DEBERTA ZERO-SHOT ACCURACY VERIFICATION")
print("="*65)

for c in comments:
    out = classifier(c, labels, hypothesis_template=template, multi_label=False)
    top_label = "APPRECIATION" if "appreciation" in out['labels'][0] else "NEEDS_ATTENTION"
    conf = out['scores'][0] * 100
    print(f"Comment : \"{c}\"")
    print(f"Result  : {top_label} ({conf:.1f}% confidence)\n")
