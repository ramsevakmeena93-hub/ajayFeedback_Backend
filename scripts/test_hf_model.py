import os
import sys
from transformers import pipeline

# First check local model dir, else fall back to HuggingFace repo ID
local_model_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "models", "deberta-zeroshot"))
safetensors_path = os.path.join(local_model_dir, "model.safetensors")

if os.path.exists(safetensors_path) and os.path.getsize(safetensors_path) > 300 * 1024 * 1024:
    model_source = local_model_dir
    print(f"Loading model from local directory: {model_source}")
else:
    model_source = "MoritzLaurer/deberta-v3-base-zeroshot-v1"
    print(f"Local model not fully ready. Loading from Hugging Face Hub: {model_source}")

classifier = pipeline("zero-shot-classification", model=model_source)

sequence_to_classify = "The faculty explains concepts clearly and gives practical examples that make learning easier."
candidate_labels = ["APPRECIATION", "NEEDS_ATTENTION"]
output = classifier(sequence_to_classify, candidate_labels, multi_label=False)

print("\n" + "="*50)
print("ZERO-SHOT CLASSIFICATION TEST RESULT:")
print("="*50)
print(f"Sequence : {output['sequence']}")
print(f"Labels   : {output['labels']}")
print(f"Scores   : {[round(s, 4) for s in output['scores']]}")
print(f"Top Label: {output['labels'][0]} ({round(output['scores'][0]*100, 2)}%)")
print("="*50)
