import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * The package's own version, read from package.json at startup.
 *
 * Both the server identity the host displays and the client headers the
 * backend sees have to agree with what was published. Hardcoding the string
 * in either place lets it drift — the server advertised 1.3.2 while the
 * package was several releases past it.
 */
export function readPackageVersion(): string {
    try {
        const here = dirname(fileURLToPath(import.meta.url));
        // src/lib at ts-node time, dist/lib after tsc — both sit two levels
        // below the package.json.
        const pkgPath = resolve(here, '..', '..', 'package.json');
        const raw = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
        return typeof raw.version === 'string' ? raw.version : 'unknown';
    } catch {
        return 'unknown';
    }
}

export const PACKAGE_VERSION = readPackageVersion();
