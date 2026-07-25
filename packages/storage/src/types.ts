import type {
  Brand,
  ConversationMessage,
  Edition,
  Newsletter,
  Recipient,
  RecipientGroup,
} from '@cawt/domain';

/**
 * Repository interfaces.
 *
 * Everything the application persists goes through these, so the backing store
 * is a deployment detail rather than an architectural commitment. The file
 * implementation runs with no service at all; the Azure Table implementation
 * runs against Azurite locally and a storage account in production, using the
 * same code path.
 */

export interface Repository<T> {
  get(id: string): Promise<T | undefined>;
  list(): Promise<T[]>;
  save(entity: T): Promise<T>;
  delete(id: string): Promise<void>;
}

export interface ConversationStore {
  list(newsletterId: string): Promise<ConversationMessage[]>;
  append(message: ConversationMessage): Promise<ConversationMessage>;
  clear(newsletterId: string): Promise<void>;
}

export interface EditionStore extends Repository<Edition> {
  listByNewsletter(newsletterId: string): Promise<Edition[]>;
}

/** Large or binary payloads: uploaded samples, rendered HTML, logos, images. */
export interface BlobStore {
  put(path: string, content: string | Buffer, contentType?: string): Promise<string>;
  get(path: string): Promise<Buffer | undefined>;
  getText(path: string): Promise<string | undefined>;
  delete(path: string): Promise<void>;
}

export interface Stores {
  newsletters: Repository<Newsletter>;
  editions: EditionStore;
  conversations: ConversationStore;
  brands: Repository<Brand>;
  recipients: Repository<Recipient>;
  recipientGroups: Repository<RecipientGroup>;
  blobs: BlobStore;
}
