import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type {
  Brand,
  ConversationMessage,
  Delivery,
  Edition,
  Newsletter,
  Recipient,
  RecipientGroup,
} from '@cawt/domain';
import type { BlobStore, ConversationStore, DeliveryStore, EditionStore, Repository, Stores } from './types.js';

/**
 * File-backed store for local development. One JSON document per collection
 * under .data/, blobs as real files under .data/blobs/.
 *
 * Runs with no emulator and no service. Deleting .data/ resets everything,
 * which is what you want when iterating on the designer.
 */

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
}

class FileRepository<T extends { id: string }> implements Repository<T> {
  constructor(private readonly path: string) {}

  private async all(): Promise<Record<string, T>> {
    return readJson<Record<string, T>>(this.path, {});
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.all())[id];
  }

  async list(): Promise<T[]> {
    return Object.values(await this.all());
  }

  async save(entity: T): Promise<T> {
    const all = await this.all();
    all[entity.id] = entity;
    await writeJson(this.path, all);
    return entity;
  }

  async delete(id: string): Promise<void> {
    const all = await this.all();
    delete all[id];
    await writeJson(this.path, all);
  }
}

class FileEditionStore extends FileRepository<Edition> implements EditionStore {
  async listByNewsletter(newsletterId: string): Promise<Edition[]> {
    const editions = await this.list();
    return editions
      .filter((edition) => edition.newsletterId === newsletterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

class FileDeliveryStore extends FileRepository<Delivery> implements DeliveryStore {
  async listByNewsletter(newsletterId: string): Promise<Delivery[]> {
    const deliveries = await this.list();
    return deliveries
      .filter((delivery) => delivery.newsletterId === newsletterId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }
}

class FileConversationStore implements ConversationStore {
  constructor(private readonly path: string) {}

  private async all(): Promise<Record<string, ConversationMessage[]>> {
    return readJson<Record<string, ConversationMessage[]>>(this.path, {});
  }

  async list(newsletterId: string): Promise<ConversationMessage[]> {
    return (await this.all())[newsletterId] ?? [];
  }

  async append(message: ConversationMessage): Promise<ConversationMessage> {
    const all = await this.all();
    all[message.newsletterId] = [...(all[message.newsletterId] ?? []), message];
    await writeJson(this.path, all);
    return message;
  }

  async clear(newsletterId: string): Promise<void> {
    const all = await this.all();
    delete all[newsletterId];
    await writeJson(this.path, all);
  }
}

class FileBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  /** Keeps a caller-supplied path from escaping the blob root. */
  private resolveSafe(path: string): string {
    const target = resolve(this.root, path.replace(/^[/\\]+/, ''));
    const root = resolve(this.root);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new Error(`Blob path "${path}" escapes the blob root`);
    }
    return target;
  }

  async put(path: string, content: string | Buffer): Promise<string> {
    const target = this.resolveSafe(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    return path;
  }

  async get(path: string): Promise<Buffer | undefined> {
    try {
      return await readFile(this.resolveSafe(path));
    } catch {
      return undefined;
    }
  }

  async getText(path: string): Promise<string | undefined> {
    return (await this.get(path))?.toString('utf8');
  }

  async delete(path: string): Promise<void> {
    await rm(this.resolveSafe(path), { force: true });
  }
}

export function createFileStores(root = '.data'): Stores {
  const base = resolve(root);
  return {
    newsletters: new FileRepository<Newsletter>(join(base, 'newsletters.json')),
    editions: new FileEditionStore(join(base, 'editions.json')),
    deliveries: new FileDeliveryStore(join(base, 'deliveries.json')),
    conversations: new FileConversationStore(join(base, 'conversations.json')),
    brands: new FileRepository<Brand>(join(base, 'brands.json')),
    recipients: new FileRepository<Recipient>(join(base, 'recipients.json')),
    recipientGroups: new FileRepository<RecipientGroup>(join(base, 'recipient-groups.json')),
    blobs: new FileBlobStore(join(base, 'blobs')),
  };
}
