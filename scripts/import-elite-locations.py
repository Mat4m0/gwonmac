"""Rebuild the pinned Toolbox capture catalogue; requires the reviewed checkout."""
import hashlib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SOURCE = pathlib.Path(sys.argv[1])
COMMIT = 'baaaf0de574b02008baa57a574625a99009cd5ac'
HEADER = SOURCE / 'GWToolboxdll/Widgets/WorldMapWidget_Constants.h'
text = HEADER.read_text()
assert hashlib.sha256(HEADER.read_bytes()).hexdigest() == 'ecf7a506e4b213578b4669c56d310b6ab81d3d4164b93a607102bbf012ba8d5f', 'Review a changed source before importing'

def enum(name):
    source = (SOURCE / f'Dependencies/GWCA/include/GWCA/Constants/{name}.h').read_text()
    body = source.split('enum class ', 1)[1].split('{', 1)[1].split('};', 1)[0]
    body = re.sub(r'/\*.*?\*/|//[^\n]*', '', body, flags=re.S)
    result, number = {}, -1
    for item in body.split(','):
        item = item.strip()
        if not item:
            continue
        parts = item.split('=')
        key = parts[0].strip()
        number = (int(parts[1].strip(), 0) if len(parts) == 2 else number + 1)
        result[key] = number
    return result

skills, maps = enum('Skills'), enum('Maps')
string = r'"(?:\\.|[^"\\])*"'
constants = {k: json.loads(v) for k, v in re.findall(r'const char\* (\w+) = (' + string + r');', text)}
pattern = re.compile(r'\{GW::Constants::SkillID::(\w+),\s*(' + string + r'|\w+),\s*GW::Constants::MapID::(\w+),\s*(\{(?:[^{}]|\{[^{}]*\})*\})(?:,\s*(' + string + r'|\w+))?\s*\}')
def literal(value):
    return json.loads(value) if value.startswith('"') else constants[value]

rows = []
# These boundaries describe this exact, hash-checked source's geographic sections.
# They classify capture region, never the skill's campaign of origin.
region = 'Eye of the North'
for match in pattern.finditer(text):
    skill, boss, area, coords, note = match.groups()
    if area == 'Issnur_Isles': region = 'Elona'
    if area == 'Tsumei_Village_Winds_of_Change__A_Treatys_a_Treaty': region = 'Cantha'
    if area == 'Prophets_Path': region = 'Tyria'
    if area == 'Rragars_Menagerie_Level_1': region = 'Eye of the North'
    if area == 'War_in_Kryta_Divinity_Coast': region = 'Tyria'
    boss, note = literal(boss), literal(note) if note else None
    points = [[int(x), int(y)] for x, y in re.findall(r'\{\s*(-?\d+),\s*(-?\d+)\s*\}', coords)]
    key = f'{skills[skill]}:{maps[area]}:{boss}:{note or ""}'
    rows.append(dict(id=hashlib.sha256(key.encode()).hexdigest()[:16], skillId=skills[skill], boss=boss,
                     mapId=maps[area], region=region, points=points, note=note))
assert len(rows) == 926, len(rows)
# Exact duplicates are merged, retaining all known alternate points.
unique = {}
for row in rows:
    if row['id'] in unique:
        existing = unique[row['id']]['points']
        existing.extend(p for p in row['points'] if p not in existing)
    else: unique[row['id']] = row
output = '/**\n * Reviewed capture locations from GWToolbox++ ' + COMMIT + '.\n * Derived by scripts/import-elite-locations.py; preserve the third-party notice.\n */\nimport type { EliteLocation } from "./elite-skills.js";\n\nexport const ELITE_LOCATIONS: readonly EliteLocation[] = [\n'
output += ''.join('  ' + json.dumps(row, ensure_ascii=False, separators=(',', ':')) + ',\n' for row in unique.values())
output += '];\n'
(ROOT / 'src/shared/elite-locations.ts').write_text(output)
print(f'Imported {len(unique)} locations / {len(set(r["skillId"] for r in rows))} skills')
