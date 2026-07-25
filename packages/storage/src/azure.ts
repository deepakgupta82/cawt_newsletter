import { TableClient, odata, type TableEntity } from '@azure/data-tables';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import type {
  Brand,
  ConversationMessage,
  Edition,
  Newsletter,
  Recipient,
  RecipientGroup,
} from '@cawt/domain';
import type { BlobStore, ConversationStore, EditionStore, Repository, Stores } from './types.js';

/**
 * Azure Table + Blob storage.
 *
 * The same code runs against Azurite locally (connection string
 * "UseDevelopmentStorage=true") and against a real storage account in Azure,
 * so the local path exercises the production adapter rather than a stand-in.
 *
 * Entities are stored as a single JSON string property. Table Storage caps a
 * string property at 64 KB; a blueprint runs to roughly 15 KB and an edition
 * with fifteen stories to under 10 KB, so there is comfortable headroom, and
 * the guard below fails loudly rather than truncating if that ever changes.
 */

const MAX_PROPERTY_BYTES = 60 * 1024;

interface Row extends TableEntity {
  data: string;
}

function encode(entity: unknown): string {
  const json = JSON.stringify(entity);
  if (Buffer.byteLength(json, 'utf8') > MAX_PROPERTY_BYTES) {
    throw new Error(
      `Entity is ${Buffer.byteLength(json, 'utf8')} bytes, over the ${MAX_PROPERTY_BYTES} byte Table Storage limit. ` +
        'Move the large field to Blob storage and keep a reference here.',
    );
  }
  return json;
}

class TableRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    protected readonly client: TableClient,
    protected readonly partition = 'default',
  ) {}

  protected async ready(): Promise<void> {
    await this.client.createTable();
  }

  async get(id: string): Promise<T | undefined> {
    await this.ready();
    try {
      const row = await this.client.getEntity<Row>(this.partition, id);
      return JSON.parse(row.data) as T;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<T[]> {
    await this.ready();
    const out: T[] = [];
    const query = this.client.listEntities<Row>({
      queryOptions: { filter: odata`PartitionKey eq ${this.partition}` },
    });
    for await (const row of query) out.push(JSON.parse(row.data) as T);
    return out;
  }

  async save(entity: T): Promise<T> {
    await this.ready();
    await this.client.upsertEntity<Row>(
      { partitionKey: this.partition, rowKey: entity.id, data: encode(entity) },
      'Replace',
    );
    return entity;
  }

  async delete(id: string): Promise<void> {
    await this.ready();
    try {
      await this.client.deleteEntity(this.partition, id);
    } catch {
      // Deleting something that is already gone is not an error.
    }
  }
}

class TableEditionStore extends TableRepository<Edition> implements EditionStore {
  async listByNewsletter(newsletterId: string): Promise<Edition[]> {
    const editions = await this.list();
    return editions
      .filter((edition) => edition.newsletterId === newsletterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** Partitioned by newsletter so a thread reads back in one query. */
class TableConversationStore implements ConversationStore {
  constructor(private readonly client: TableClient) {}

  private async ready(): Promise<void> {
    await this.client.createTable();
  }

  async list(newsletterId: string): Promise<ConversationMessage[]> {
    await this.ready();
    const out: ConversationMessage[] = [];
    const query = this.client.listEntities<Row>({
      queryOptions: { filter: odata`PartitionKey eq ${newsletterId}` },
    });
    for await (const row of query) out.push(JSON.parse(row.data) as ConversationMessage);
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async append(message: ConversationMessage): Promise<ConversationMessage> {
    await this.ready();
    await this.client.upsertEntity<Row>(
      { partitionKey: message.newsletterId, rowKey: message.id, data: encode(message) },
      'Replace',
    );
    return message;
  }

  async clear(newsletterId: string): Promise<void> {
    await this.ready();
    for (const message of await this.list(newsletterId)) {
      await this.client.deleteEntity(newsletterId, message.id);
    }
  }
}

class AzureBlobStore implements BlobStore {
  private ensured = false;

  constructor(private readonly container: ContainerClient) {}

  private async ready(): Promise<void> {
    if (this.ensured) return;
    await this.container.createIfNotExists();
    this.ensured = true;
  }

  async put(path: string, content: string | Buffer, contentType = 'application/octet-stream'): Promise<string> {
    await this.ready();
    const body = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    await this.container.getBlockBlobClient(path).uploadData(body, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return path;
  }

  async get(path: string): Promise<Buffer | undefined> {
    await this.ready();
    try {
      return await this.container.getBlockBlobClient(path).downloadToBuffer();
    } catch {
      return undefined;
    }
  }

  async getText(path: string): Promise<string | undefined> {
    return (await this.get(path))?.toString('utf8');
  }

  async delete(path: string): Promise<void> {
    await this.ready();
    await this.container.getBlockBlobClient(path).deleteIfExists();
  }
}

export interface AzureStoreOptions {
  /** "UseDevelopmentStorage=true" targets a locally running Azurite. */
  connectionString: string;
  containerName?: string;
  tablePrefix?: string;
}

export function createAzureStores(options: AzureStoreOptions): Stores {
  const { connectionString } = options;
  const prefix = options.tablePrefix ?? 'cawt';
  const table = (name: string) => TableClient.fromConnectionString(connectionString, `${prefix}${name}`, {
    allowInsecureConnection: connectionString.includes('UseDevelopmentStorage') || connectionString.includes('http://'),
  });

  const blobService = BlobServiceClient.fromConnectionString(connectionString);
  const container = blobService.getContainerClient(options.containerName ?? 'cawt-assets');

  return {
    newsletters: new TableRepository<Newsletter>(table('Newsletters')),
    editions: new TableEditionStore(table('Editions')),
    conversations: new TableConversationStore(table('Conversations')),
    brands: new TableRepository<Brand>(table('Brands')),
    recipients: new TableRepository<Recipient>(table('Recipients')),
    recipientGroups: new TableRepository<RecipientGroup>(table('RecipientGroups')),
    blobs: new AzureBlobStore(container),
  };
}
