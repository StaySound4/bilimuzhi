declare module "node:fs/promises" {
  interface DirectoryEntry {
    name: string;
    isDirectory(): boolean;
  }

  export function mkdtemp(prefix: string): Promise<string>;
  export function readFile(path: string): Promise<Uint8Array>;
  export function readFile(path: string, encoding: "utf8"): Promise<string>;
  export function readdir(
    path: string,
    options: { withFileTypes: true },
  ): Promise<DirectoryEntry[]>;
  export function rm(
    path: string,
    options: { force: boolean; recursive: boolean },
  ): Promise<void>;
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding?: string): string;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:os" {
  export function tmpdir(): string;
}

declare module "node:path" {
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
  export function relative(from: string, to: string): string;
  export function resolve(...paths: string[]): string;
}

declare module "node:http" {
  export interface IncomingMessage {
    readonly url?: string;
  }

  export interface ServerResponse {
    writeHead(status: number, headers?: Record<string, string>): void;
    write(chunk: string): void;
    end(chunk?: string): void;
  }

  export interface Server {
    readonly listening: boolean;
    address(): { readonly port: number } | string | null;
    close(callback?: () => void): void;
    listen(port: number, host: string, callback?: () => void): void;
    once(event: "error", listener: (error: Error) => void): void;
  }

  export function createServer(
    handler: (request: IncomingMessage, response: ServerResponse) => void,
  ): Server;
}

declare module "node:net" {
  export interface AddressInfo {
    readonly port: number;
  }
}
