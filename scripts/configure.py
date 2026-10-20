#!/usr/bin/env python3
"""Render local configuration; only performs a read-only upstream channels GET."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import yaml

ROOT = Path(__file__).resolve().parents[1]


def load_env():
    values = {}
    for number, line in enumerate((ROOT / '.env').read_text(encoding='utf-8-sig').splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]*', key):
            raise ValueError(f'Invalid .env line {number}')
        # Deliberately support literal values only, matching single-quoted Compose env values.
        if value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        elif '$' in value or '#' in value or value.startswith('"'):
            raise ValueError(f'Use single quotes for special characters on line {number}')
        values[key] = value
    for key in values:
        if key in os.environ:
            values[key] = os.environ[key]
    for key in ('MARIADB_DATABASE', 'MARIADB_USER', 'MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD'):
        if not values.get(key) or values[key].startswith('replace-'):
            raise ValueError(f'Set {key} in .env first')
    host = values.get('MIRAKURUN_HOST', '192.168.2.10')
    if not re.fullmatch(r'[A-Za-z0-9.-]+', host):
        raise ValueError('MIRAKURUN_HOST must be an IPv4 address or hostname')
    port = int(values.get('MIRAKURUN_PORT', '40772'))
    if not 1 <= port <= 65535:
        raise ValueError('Invalid upstream port')
    return values, f'http://{host}:{port}'


def render(values, upstream, channels):
    base = yaml.safe_load((ROOT / 'mirakc/config.yml').read_text(encoding='utf-8'))
    imported = []
    seen = set()
    for item in channels:
        kind, channel = item['type'], str(item['channel'])
        if kind not in ('GR', 'BS', 'CS'):
            continue
        if not re.fullmatch(r'[A-Za-z0-9_-]+', channel):
            raise ValueError(f'Unsafe channel identifier: {channel!r}')
        if (kind, channel) in seen:
            continue
        seen.add((kind, channel))
        imported.append({'name': item.get('name') or f'{kind}-{channel}', 'type': kind, 'channel': channel})
    if not imported:
        raise ValueError('No GR/BS/CS channels found')
    base['channels'] = imported
    base['tuners'] = []
    for label, types in (('GR', ['GR']), ('BSCS', ['BS', 'CS'])):
        for index in (1, 2):
            base['tuners'].append({
                'name': f'W3U4-{label}-{index}', 'types': types, 'decoded': True,
                'command': 'curl --noproxy "*" '
                           '--fail --silent --show-error --no-buffer --connect-timeout 10 '
                           f'{upstream}/api/channels/'
                           '{{{channel_type}}}/{{{channel}}}/stream?decode=1',
            })
    epg = yaml.safe_load((ROOT / 'epgstation/config/config.yml.example').read_text(encoding='utf-8'))
    for field, key in (('user', 'MARIADB_USER'), ('password', 'MARIADB_PASSWORD'), ('database', 'MARIADB_DATABASE')):
        epg['mysql'][field] = values[key]
    client_port = values.get('EPGSTATION_CLIENT_SOCKETIO_PORT', '').strip()
    if client_port:
        if not re.fullmatch(r'[0-9]+', client_port) or not 1 <= int(client_port) <= 65535:
            raise ValueError('EPGSTATION_CLIENT_SOCKETIO_PORT must be between 1 and 65535')
        epg['clientSocketioPort'] = int(client_port)
    return base, epg


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--channels-file', type=Path, help='Use previously exported /api/channels JSON')
    args = parser.parse_args()
    values, upstream = load_env()
    if args.channels_file:
        channels = json.loads(args.channels_file.read_text(encoding='utf-8-sig'))
    else:
        response = subprocess.run(
            ['docker', 'compose', 'run', '--rm', '-T', 'upstream-api',
             '--fail', '--silent', '--show-error', '--max-time', '20', upstream + '/api/channels'],
            cwd=ROOT, check=True, stdout=subprocess.PIPE, encoding='utf-8',
        )
        channels = json.loads(response.stdout)
    mirakc, epg = render(values, upstream, channels)
    for relative, data in (('mirakc/config.generated.yml', mirakc), ('epgstation/config/config.yml', epg)):
        path = ROOT / relative
        temporary = path.with_suffix('.tmp')
        with temporary.open('w', encoding='utf-8', newline='\n') as output:
            yaml.safe_dump(data, output, allow_unicode=True, sort_keys=False)
        temporary.chmod(0o600)
        temporary.replace(path)
        print(f'Generated {relative}')
    print(f'Imported {len(mirakc["channels"])} channels; GR x2 + shared BS/CS x2')


if __name__ == '__main__':
    main()
