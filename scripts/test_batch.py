"""
Full batch test of HF classifier with real student feedback comments
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from hf_classifier import classify_batch

comments = [
    # --- Should be APPRECIATION ---
    "The faculty explains concepts clearly and gives practical examples.",
    "Best teacher. All concepts are crystal clear.",
    "Very good teacher overall, always helpful.",
    "Sir is dedicated, patient and explains everything nicely.",
    "Amazing teacher, very interactive classes.",
    "excellent teaching and clear explanations throughout the course.",
    "Sir has excellent command over his subject.",
    "She is very good at explanation and coordination.",
    "Love the way sir teaches, very engaging.",
    "Thank you mam for your support and guidance.",

    # --- Should be NEEDS_ATTENTION ---
    "need more explanation in class",
    "class notes can be better",
    "speed of teaching sometimes feel fast",
    "can be more interactive",
    "not much interactive",
    "More Real-world examples should be included",
    "notes must be provided early",
    "he should be more loud and clear",
    "He created a fear in classroom to ask for doubt.",
    "The quiz was out of syllabus and marks not justified.",
    "please change the way of teaching",
    "should teach basics first rather than directly jumping into codes",
    "pacing is a bit fast, maybe topic is too complicated",
    "better notes should be provided",
    "Teaching less examples and not considering attendance",
    "Sir should slow down, we cannot follow the pace.",
    "notes must be send early for making code or study",
    "not able to clearly understand the core concepts",
    "he should try to be a little more loud and clear during lecs",
    "2 way communication will be very beneficial for class",
]

result = classify_batch(comments)

print("\n" + "="*60)
print(f"TOTAL COMMENTS: {result['statistics']['totalReceived']}")
print("="*60)

print(f"\n✅ APPRECIATION ({result['statistics']['appreciation']}):")
for c in result['appreciation']:
    print(f"   + {c}")

print(f"\n⚠️  NEEDS ATTENTION ({result['statistics']['attention']}):")
for c in result['commentsNeedingAttention']:
    print(f"   ! {c}")

# Check accuracy
expected_appreciation = 10
expected_attention = 20
got_appreciation = result['statistics']['appreciation']
got_attention = result['statistics']['attention']

print("\n" + "="*60)
print(f"ACCURACY CHECK:")
print(f"  Appreciation: got {got_appreciation}, expected ~{expected_appreciation}")
print(f"  Attention:    got {got_attention}, expected ~{expected_attention}")

# Find misclassified
misclassified = []
for c in result['classifiedComments']:
    idx = comments.index(c['text']) if c['text'] in comments else -1
    if idx < 10 and c['topLabel'] == 'NEEDS_ATTENTION':
        misclassified.append(f"  ❌ Should be APPRECIATION: {c['text'][:60]}")
    elif idx >= 10 and c['topLabel'] == 'APPRECIATION':
        misclassified.append(f"  ❌ Should be ATTENTION:    {c['text'][:60]}")

if misclassified:
    print(f"\nMISCLASSIFIED ({len(misclassified)}):")
    for m in misclassified:
        print(m)
else:
    print("\n🎉 ALL CORRECTLY CLASSIFIED!")
print("="*60)
