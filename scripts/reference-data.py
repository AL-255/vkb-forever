#!/usr/bin/env python3
"""Transform functional wire facts; never copy UI resources or vendor presets."""
import csv
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1]).expanduser() / 'docs' / 'catalog'
target = pathlib.Path(__file__).resolve().parents[1] / 'public' / 'data'
target.mkdir(parents=True, exist_ok=True)
keys = ['owner', 'identifier', 'bank', 'address', 'minimum', 'maximum', 'default', 'width', 'choices']
parameters = [{**{key: row[key] for key in keys}, 'label': row['title'], 'codec': row['codec']}
              for row in json.loads((source / 'parameters.json').read_text())]
with (source / 'syllables.csv').open(newline='') as handle:
    syllables = [{'text': json.loads(row['input_json']), 'phonemes': row['phonemes']}
                 for row in csv.DictReader(handle)]
mappings = {}
with (source / 'text-mappings.csv').open(newline='') as handle:
    for row in csv.DictReader(handle):
        value = list(bytes.fromhex(row['bytes_hex'])) if row['bytes_hex'] else json.loads(row['output_json'])
        mappings.setdefault(row['kind'], {})[json.loads(row['input_json'])] = value
skills = [{'label': row['label'], 'hex': row['payload_hex']}
          for row in json.loads((source / 'skills.json').read_text())]
for name, value in [('parameters', parameters), ('lyrics', {'syllables': syllables, **mappings}), ('skills', skills)]:
    (target / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'Generated {len(parameters)} parameters, {len(syllables)} dictionary rows, {len(skills)} skill payloads.')
