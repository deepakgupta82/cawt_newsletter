import type { Stores } from './types.js';
import { createFileStores } from './file.js';
import { createAzureStores } from './azure.js';

/**
 * Store selection.
 *
 * "file" is the default so a fresh clone runs with nothing installed.
 * "azurite" exercises the real Azure adapter against the local emulator, which
 * is what you want before deploying: same code path, no cloud resource.
 */
export function createStores(env: NodeJS.ProcessEnv = process.env): Stores {
  const kind = env['STORAGE_PROVIDER'] ?? 'file';

  switch (kind) {
    case 'file':
      return createFileStores(env['DATA_DIR'] ?? '.data');

    case 'azurite':
      return createAzureStores({
        connectionString: env['AZURE_STORAGE_CONNECTION_STRING'] ?? 'UseDevelopmentStorage=true',
      });

    case 'azure': {
      const connectionString = env['AZURE_STORAGE_CONNECTION_STRING'];
      if (!connectionString) {
        throw new Error('STORAGE_PROVIDER=azure needs AZURE_STORAGE_CONNECTION_STRING (or use managed identity once deployed)');
      }
      return createAzureStores({ connectionString });
    }

    default:
      throw new Error(`Unknown STORAGE_PROVIDER "${kind}". Expected one of: file, azurite, azure.`);
  }
}
