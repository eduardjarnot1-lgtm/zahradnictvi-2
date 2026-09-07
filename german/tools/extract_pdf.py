#!/usr/bin/env python3
"""Extract the vocabulary entries from the OCR GCSE German Vocabulary List PDF.

Usage:  python3 extract_pdf.py <path-to-vocabulary-list.pdf>

Writes source-entries.json next to this script: one row per entry in the
document, with the German term, the English gloss printed beside it, the topic
area, the sub-topic, the tier (Foundation / Higher) and the page it came from.

The PDF puts each entry on one line with the German term and the English gloss
separated by whitespace, so the German/English split uses pypdf's layout mode
(which preserves the run of spaces between the two columns) and falls back to
splitting at the first space for the lines the document typesets with a single
space.
"""

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "source-entries.json"

if len(sys.argv) != 2:
    raise SystemExit(__doc__)
SRC = sys.argv[1]
r = PdfReader(SRC)

TOPICS = {
 'Topic Area 1': 'Home and local area',
 'Topic Area 2': 'Health and sport',
 'Topic Area 3': 'Leisure and entertainment',
 'Topic Area 4': 'Travel and the wider world',
 'Topic Area 5': 'Education and work',
}
SUB2TOPIC={}
SUBS = [
 'Life in the home; friends and relationships',
 'Local area, facilities and getting around',
 'Sport, outdoor pursuits and healthy lifestyle',
 'Food and drink as aspects of culture and health',
 'Socialising, special occasions and festivals',
 'TV, films and music',
 'Holidays and exchanges',
 'Environmental, cultural and social issues',
 'School life in the UK and in the target language country or community',
 'Work experience, future study and jobs, working abroad',
]
for i,s in enumerate(SUBS):
    SUB2TOPIC[s]=list(TOPICS.values())[i//2]

def clean(l):
    return re.sub(r'\s+',' ',l).strip()

noise_pat = re.compile(r'(© OCR|GCSE German General Vocabulary List|^Page \d+|^of \d+|^GCS$|^E German)')

entries=[]
topic=None; sub=None; tier=None
log=[]
for pi,p in enumerate(r.pages, start=1):
    if pi<=13:  # front matter + contents + section divider pages
        # General list starts on page 5
        pass
    t=p.extract_text(extraction_mode='layout')
    for raw in t.split('\n'):
        if not raw.strip(): continue
        # detect separator BEFORE squeezing
        m=re.split(r'\s{2,}', raw.strip())
        line=clean(raw)
        if noise_pat.search(line): continue
        if line.startswith('Vocabulary List') or line.startswith('General and Topic'): continue
        # headers
        if re.match(r'^Topic Area (\d)[: ]', line):
            continue
        if line in ('German Vocabulary List General','German GCSE Vocabulary List'):
            if pi>=5 and pi<=11: topic='General'; sub='General'
            continue
        hit=[s for s in SUBS if line.rstrip(' .').startswith(s)]
        if hit and pi>13:
            sub=hit[0]; topic=SUB2TOPIC[sub]; continue
        if line=='Foundation': tier='Foundation'; continue
        if line=='Higher': tier='Higher'; continue
        if pi<14 and not (5<=pi<=11): continue
        if line.startswith('(') or line.startswith('Topic Area'): continue
        if topic is None: continue
        # entry line
        if len(m)>=2 and m[0].strip():
            de=clean(m[0]); en=clean(' '.join(m[1:]))
        else:
            parts=line.split(' ',1)
            if len(parts)<2: 
                log.append(('SKIP-single',pi,line)); continue
            de,en=parts[0],parts[1]
        entries.append({'de':de,'en':en,'topic':topic,'sub':sub,'tier':tier,'page':pi})

OUT.write_text(json.dumps(entries, ensure_ascii=False, indent=0), encoding='utf-8')
print('entries', len(entries), '->', OUT)
from collections import Counter
print(Counter((e['topic'],e['sub']) for e in entries))
for l in log[:40]: print(l)
