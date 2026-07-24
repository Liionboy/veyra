export interface SelectedUploadFile {
  file: File;
  relativePath: string;
}

export interface UploadSessionResponse {
  id: string;
  expiresAt: string;
  chunkSize: number;
  uploadToken?: string;
  files: Array<{
    id: string;
    name: string;
    relativePath: string;
    size: number;
    offset: number;
  }>;
}

export interface UploadProgress {
  stage: "uploading" | "scanning" | "finalizing";
  loaded: number;
  total: number;
  percent: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
}

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (
    success: (file: File) => void,
    failure?: (error: DOMException) => void,
  ) => void;
  createReader?: () => {
    readEntries: (
      success: (entries: FileSystemEntryLike[]) => void,
      failure?: (error: DOMException) => void,
    ) => void;
  };
}

function relativePathFor(file: File): string {
  return file.webkitRelativePath || file.name;
}

export function fromFileList(files: FileList | File[]): SelectedUploadFile[] {
  return Array.from(files).map((file) => ({
    file,
    relativePath: relativePathFor(file),
  }));
}

async function entryFile(entry: FileSystemEntryLike): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file?.(resolve, reject);
  });
}

async function directoryEntries(
  entry: FileSystemEntryLike,
): Promise<FileSystemEntryLike[]> {
  const reader = entry.createReader?.();
  if (!reader) return [];
  const result: FileSystemEntryLike[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) return result;
    result.push(...batch);
  }
}

async function walkEntry(
  entry: FileSystemEntryLike,
  parent: string,
): Promise<SelectedUploadFile[]> {
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await entryFile(entry);
    return [{ file, relativePath: path }];
  }
  if (!entry.isDirectory) return [];
  const children = await directoryEntries(entry);
  const nested = await Promise.all(
    children.map((child) => walkEntry(child, path)),
  );
  return nested.flat();
}

export async function fromDataTransfer(
  transfer: DataTransfer,
): Promise<SelectedUploadFile[]> {
  const entries: FileSystemEntryLike[] = Array.from(transfer.items)
    .map(
      (item) =>
        (item.webkitGetAsEntry?.() as unknown as FileSystemEntryLike | null) ??
        null,
    )
    .filter((entry): entry is FileSystemEntryLike => entry !== null);
  if (entries.length === 0) return fromFileList(transfer.files);
  return (await Promise.all(entries.map((entry) => walkEntry(entry, "")))).flat();
}

export function fileFingerprint(files: SelectedUploadFile[]): string {
  return files
    .map(
      ({ file, relativePath }) =>
        `${relativePath}\u0000${file.size}\u0000${file.lastModified}`,
    )
    .join("\u0001");
}

function requestJson<T>(
  url: string,
  init: RequestInit,
  uploadToken?: string,
): Promise<T> {
  return fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(uploadToken ? { "Upload-Token": uploadToken } : {}),
      ...init.headers,
    },
  }).then(async (response) => {
    const payload = (await response.json()) as T & { message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? "The upload request failed.");
    }
    return payload;
  });
}

function headOffset(
  url: string,
  uploadToken: string | undefined,
): Promise<number> {
  return fetch(url, {
    method: "HEAD",
    headers: uploadToken ? { "Upload-Token": uploadToken } : undefined,
    cache: "no-store",
  }).then((response) => {
    if (!response.ok) throw new Error("The upload session could not be resumed.");
    return Number(response.headers.get("Upload-Offset") ?? "0");
  });
}

function patchChunk(
  url: string,
  chunk: Blob,
  offset: number,
  uploadToken: string | undefined,
  signal: AbortSignal,
  onProgress: (loaded: number) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    signal.addEventListener("abort", abort, { once: true });
    request.open("PATCH", url);
    request.setRequestHeader("Content-Type", "application/offset+octet-stream");
    request.setRequestHeader("Upload-Offset", String(offset));
    if (uploadToken) request.setRequestHeader("Upload-Token", uploadToken);
    request.upload.addEventListener("progress", (event) => {
      onProgress(event.loaded);
    });
    request.addEventListener("load", () => {
      signal.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        resolve(Number(request.getResponseHeader("Upload-Offset") ?? offset + chunk.size));
        return;
      }
      const recoveredOffset = Number(request.getResponseHeader("Upload-Offset"));
      if (
        request.status === 409 &&
        Number.isSafeInteger(recoveredOffset) &&
        recoveredOffset > offset &&
        recoveredOffset <= offset + chunk.size
      ) {
        resolve(recoveredOffset);
        return;
      }
      try {
        const payload = JSON.parse(request.responseText) as { message?: string };
        reject(new Error(payload.message ?? "A chunk could not be uploaded."));
      } catch {
        reject(new Error("A chunk could not be uploaded."));
      }
    });
    request.addEventListener("error", () => {
      signal.removeEventListener("abort", abort);
      reject(new Error("The server could not be reached."));
    });
    request.addEventListener("abort", () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload cancelled.", "AbortError"));
    });
    request.send(chunk);
  });
}

export async function uploadResumably<T>(options: {
  files: SelectedUploadFile[];
  session: UploadSessionResponse;
  apiRoot: string;
  completePath: string;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
}): Promise<T> {
  const { files, session, apiRoot, completePath, signal, onProgress } = options;
  if (files.length !== session.files.length) {
    throw new Error("The selected files do not match the upload session.");
  }
  const total = session.files.reduce((sum, file) => sum + file.size, 0);
  const startedAt = performance.now();
  let transferredThisRun = 0;
  let baseline = 0;
  let smoothedSpeed = 0;

  const report = (
    stage: UploadProgress["stage"],
    currentChunkLoaded = 0,
  ) => {
    const elapsed = Math.max((performance.now() - startedAt) / 1_000, 0.001);
    const instantaneous = (transferredThisRun + currentChunkLoaded) / elapsed;
    smoothedSpeed =
      smoothedSpeed === 0
        ? instantaneous
        : smoothedSpeed * 0.75 + instantaneous * 0.25;
    const loaded = Math.min(total, baseline + transferredThisRun + currentChunkLoaded);
    const remaining = Math.max(0, total - loaded);
    onProgress({
      stage,
      loaded,
      total,
      percent: total === 0 ? 100 : Math.round((loaded / total) * 100),
      bytesPerSecond: smoothedSpeed,
      etaSeconds:
        stage === "uploading" && smoothedSpeed > 1
          ? Math.ceil(remaining / smoothedSpeed)
          : null,
    });
  };

  const offsets: number[] = [];
  for (const serverFile of session.files) {
    offsets.push(
      await headOffset(
        `${apiRoot}/${session.id}/files/${serverFile.id}`,
        session.uploadToken,
      ),
    );
  }
  baseline = offsets.reduce((sum, offset) => sum + offset, 0);
  report("uploading");

  for (let index = 0; index < files.length; index += 1) {
    const selected = files[index]!;
    const serverFile = session.files[index]!;
    if (
      selected.file.size !== serverFile.size ||
      selected.file.name !== serverFile.name ||
      selected.relativePath !== serverFile.relativePath
    ) {
      throw new Error(`Reselect the original file: ${serverFile.name}`);
    }
    let offset = offsets[index]!;
    while (offset < selected.file.size) {
      if (signal.aborted) throw new DOMException("Upload cancelled.", "AbortError");
      const end = Math.min(offset + session.chunkSize, selected.file.size);
      const chunk = selected.file.slice(offset, end);
      const beforeChunk = transferredThisRun;
      const next = await patchChunk(
        `${apiRoot}/${session.id}/files/${serverFile.id}`,
        chunk,
        offset,
        session.uploadToken,
        signal,
        (loaded) => {
          transferredThisRun = beforeChunk;
          report("uploading", loaded);
        },
      );
      transferredThisRun = beforeChunk + (next - offset);
      offset = next;
      report("uploading");
    }
  }

  report("scanning");
  const result = await requestJson<T>(
    completePath,
    { method: "POST", body: "{}" },
    session.uploadToken,
  );
  report("finalizing");
  return result;
}
