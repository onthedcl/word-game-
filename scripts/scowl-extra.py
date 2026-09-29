# Lists words from SCOWL/ESDB (github.com/en-wl/wordlist, data/scowl-pre.txt) that ENABLE lacks:
# size <= 60 (the vetted core), American spellings, single words, no abbreviations or proper nouns,
# nothing offensive. Usage: python3 scripts/scowl-extra.py 60 enable1.txt bad-words.txt scowl-pre.txt
import re, sys
MAX = int(sys.argv[1]) if len(sys.argv) > 1 else 60
enable=set(open(sys.argv[2] if len(sys.argv) > 2 else 'enable1.txt').read().split())
bad=[w.strip().lower() for w in open(sys.argv[3] if len(sys.argv) > 3 else 'bad-words.txt') if w.strip()]
def offensive(w):
    return any((b in w) if len(b) >= 4 else (w == b or w == b + 's') for b in bad)
words=set()
for line in open(sys.argv[4] if len(sys.argv) > 4 else 'scowl-pre.txt'):
    line=line.strip()
    if not line or line.startswith('#'): continue
    parts=line.split(': ')
    levels=[int(x) for x in re.findall(r'(?:^|\] )(\d+) \[', parts[0])]
    if not levels or min(levels) > MAX: continue
    rest=parts[1:]
    if rest and re.fullmatch(r'[A-Z_](?: [A-Z_])*', rest[0]):
        if 'A' not in rest[0].split(): continue   # not an American spelling
        rest=rest[1:]
    if not rest: continue
    lemma_part = rest[0]
    tag = re.search(r'<([^>]*)>', lemma_part)
    tag = tag.group(1) if tag else ''
    if 'abbr' in tag or 'upper' in tag or 'pre' in tag or 'suf' in tag: continue
    lemma = re.sub(r'\s*<[^>]*>.*', '', lemma_part).strip()
    forms = [lemma] if lemma != '-' else []
    for f in rest[1:]:
        for x in re.split(r',\s*', re.sub(r'[()|?]', ',', f)):
            forms.append(x.strip())
    for t in forms:
        if re.fullmatch(r'[a-z]{4,}', t) and not offensive(t): words.add(t)
new=sorted(w for w in words if w not in enable)
if __name__ == '__main__':
    print(len(words), 'not in ENABLE:', len(new), file=sys.stderr)
    print('\n'.join(new))
