export interface HttpRequest {
  address: string;
  headers: Record<string, string>;
  method: string;
  path: string;
  setDataHandler(handler: (data: string) => void): void;
  setDataHandler(
    handler: (data: ArrayBuffer) => void,
    binary: "binary",
  ): void;
  setCancelHandler(handler: () => void): void;
}

export interface HttpResponse {
  writeHead(code: number, headers?: Record<string, string | string[]>): void;
  write(data: string): void;
  send(data?: string): void;
}
