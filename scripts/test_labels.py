import os
from transformers import pipeline

model_dir = os.path.abspath("backend/models/deberta-zeroshot")
classifier = pipeline("zero-shot-classification", model=model_dir)

text = "The faculty explains concepts clearly and gives practical examples that make learning easier."

tests = [
    # 1. User raw labels with default template
    (["APPRECIATION", "NEEDS_ATTENTION"], "This text is {}."),
    
    # 2. Lowercase natural labels with default template
    (["appreciation", "needs attention"], "This text is {}."),
    
    # 3. Expresses appreciation vs problem
    (["appreciation", "problem needing attention"], "This student feedback expresses {}."),
    
    # 4. Positive praise vs criticism / issue
    (["positive praise and appreciation", "criticism, complaint, or area needing attention"], "This text expresses {}."),
    
    # 5. Praise vs Complaint
    (["praise", "complaint"], "This comment is a {}."),
    
    # 6. Good teaching vs Poor teaching needing improvement
    (["appreciation for good teaching", "needs attention and improvement"], "This feedback is {}.")
]

print("==================================================================")
print(f"COMMENT: \"{text}\"")
print("==================================================================")

for labels, template in tests:
    res = classifier(text, labels, hypothesis_template=template, multi_label=False)
    print(f"Template : \"{template}\"")
    print(f"Labels   : {labels}")
    print(f"Result   : Top = {res['labels'][0]} ({res['scores'][0]*100:.1f}%) | Other = {res['labels'][1]} ({res['scores'][1]*100:.1f}%)")
    print("-" * 50)
