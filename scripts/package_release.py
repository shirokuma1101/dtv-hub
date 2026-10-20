#!/usr/bin/env python3
"""Build a source-only release archive from an explicit allowlist."""
import hashlib
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = (
    '.env.example', '.gitignore', '.gitattributes',
    '.github/workflows/validate.yml', 'VERSION', 'README.md',
    'compose.yaml',
    'scripts/configure.py', 'scripts/package_release.py',
    'mirakc/Dockerfile', 'mirakc/config.yml', 'mariadb/my.cnf',
    'epgstation/.dockerignore', 'epgstation/Dockerfile',
    'epgstation/DEPENDENCIES.md', 'epgstation/update-dependencies.cjs',
    'epgstation/notify.cjs', 'epgstation/notify.test.cjs',
    'epgstation/calendar.cjs', 'epgstation/calendar.test.cjs', 'epgstation/secrets/.gitkeep',
    'epgstation/config/config.yml.example',
    'epgstation/dependencies/package.json',
    'epgstation/dependencies/package-lock.json',
    'epgstation/dependencies/client-package.json',
    'epgstation/dependencies/client-package-lock.json',
)


def main():
    version = (ROOT / 'VERSION').read_text().strip()
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[a-z0-9.]+)?', version):
        raise ValueError('Invalid VERSION')
    payload = {name: (ROOT / name).read_bytes() for name in FILES}
    # This local check never prints secret values.
    env = ROOT / '.env'
    if env.exists():
        for line in env.read_text(encoding='utf-8-sig').splitlines():
            key, _, value = line.partition('=')
            if key.strip() not in ('MARIADB_PASSWORD', 'MARIADB_ROOT_PASSWORD', 'TS_AUTHKEY', 'DISCORD_WEBHOOK_URL'):
                continue
            value = value.strip().strip("'\"")
            if value and not value.startswith('replace-'):
                for name, content in payload.items():
                    if value.encode() in content:
                        raise ValueError(f'Local secret detected in {name}; aborting')
    manifest = ''.join(f'{hashlib.sha256(data).hexdigest()}  {name}\n'
                       for name, data in sorted(payload.items()))
    payload['MANIFEST.sha256'] = manifest.encode()
    output = ROOT / 'runtime/releases'
    output.mkdir(parents=True, exist_ok=True)
    archive = output / f'dtv-hub-{version}.zip'
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo(f'dtv-hub-{version}/{name}', (2026, 10, 18, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, data)
    checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix('.zip.sha256').write_text(f'{checksum}  {archive.name}\n', encoding='utf-8')
    print(f'Created {archive.name}: {len(FILES)} source files; SHA-256 {checksum}')


if __name__ == '__main__':
    main()
