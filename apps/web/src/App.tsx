import {
  ArrowDownToLine,
  ArrowRight,
  AtSign,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  FileArchive,
  FileText,
  Files,
  Fingerprint,
  FolderOpen,
  Gauge,
  HardDrive,
  Image,
  Inbox,
  Infinity as InfinityIcon,
  KeyRound,
  Link2,
  LogIn,
  LogOut,
  LockKeyhole,
  Mail,
  Palette,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Trash2,
  UploadCloud,
  UserPlus,
  Users,
  Eye,
  Cloud,
  ScanLine,
  Building2,
  DownloadCloud,
  X,
  Zap,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { themeOptions, useTheme } from "./theme";
import {
  fileFingerprint,
  fromDataTransfer,
  fromFileList,
  type SelectedUploadFile,
  type UploadProgress,
  type UploadSessionResponse,
  uploadResumably,
} from "./upload-client";
import {
  PublicConfigProvider,
  usePublicConfig,
} from "./public-config";
import { generateSharePassword } from "./share-password";

interface UploadResult {
  token: string;
  path: string;
  url: string;
  expiresAt: string | null;
  emailSent: boolean | null;
  emailWarning: string | null;
  passwordIncludedInEmail: boolean;
  scanStatus: "clean" | "disabled";
}

interface SharedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  sha256: string;
  relativePath: string;
  previewable: boolean;
  directUrl: string | null;
  previewUrl: string | null;
}

interface ShareDetails {
  createdAt: string;
  expiresAt: string | null;
  note: string | null;
  title: string | null;
  description: string | null;
  passwordRequired: boolean;
  unlocked: boolean;
  downloads: number;
  maxDownloads: number | null;
  downloadAllUrl: string | null;
  qrUrl: string;
  files: SharedFile[];
}

interface ReverseShareDetails {
  title: string | null;
  description: string | null;
  passwordRequired: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  maxFiles: number;
  maxTotalSize: number;
  remainingSubmissions: number;
}

interface ApiError {
  message?: string;
}

interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  user: {
    email: string;
    role: "admin" | "member";
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    recoveryCodesRemaining: number;
    storage: {
      usedBytes: number;
      reservedBytes: number;
      quotaBytes: number | null;
    } | null;
  } | null;
  emailConfigured: boolean;
  registrationEnabled: boolean;
  oidc: {
    enabled: boolean;
    label: string | null;
  };
}

interface UserSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

function Brand() {
  const branding = usePublicConfig();
  return (
    <a className="brand" href="/" aria-label={`${branding.name} home`}>
      <span className="brand-mark" aria-hidden="true">
        {branding.logoUrl ? (
          <img src={branding.logoUrl} alt="" />
        ) : (
          <svg viewBox="0 0 64 64">
            <path className="brand-flow" d="M15 18 30.5 47a1.7 1.7 0 0 0 3 0L49 18" />
            <path className="brand-inner" d="m20 18 12 22 12-22" />
            <circle cx="32" cy="47" r="4" />
          </svg>
        )}
      </span>
      <span>{branding.name}</span>
    </a>
  );
}

function ThemePicker() {
  const { preference, setPreference } = useTheme();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedTheme =
    themeOptions.find((theme) => theme.id === preference) ?? themeOptions[0];

  useEffect(() => {
    if (!open) return;
    function closeOnPointer(event: PointerEvent) {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        pickerRef.current?.querySelector<HTMLButtonElement>(".theme-trigger")?.focus();
      }
    }
    document.addEventListener("pointerdown", closeOnPointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        className="theme-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${selectedTheme.name}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Palette />
        <span>Theme</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu" aria-label="Choose appearance">
          <span className="theme-menu-heading">Appearance</span>
          {themeOptions.map((theme) => (
            <button
              key={theme.id}
              type="button"
              role="menuitemradio"
              aria-checked={preference === theme.id}
              className={preference === theme.id ? "selected" : ""}
              onClick={() => {
                setPreference(theme.id);
                setOpen(false);
              }}
            >
              <span className={`theme-swatch theme-swatch-${theme.id}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>
                <strong>{theme.name}</strong>
                <small>{theme.description}</small>
              </span>
              {preference === theme.id && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Header({
  authenticated = false,
  onLogout,
}: {
  authenticated?: boolean;
  onLogout?: () => void;
}) {
  return (
    <header className="site-header">
      <Brand />
      <nav aria-label="Main navigation">
        <a href="#security">Security</a>
        {authenticated && (
          <a className="shares-link" href="/shares">
            <Files /> My shares
          </a>
        )}
        {authenticated && (
          <a className="shares-link" href="/requests">
            <FolderOpen /> Receive
          </a>
        )}
        {authenticated && (
          <a className="shares-link" href="/inbox">
            <Inbox /> Inbox
          </a>
        )}
        {authenticated && (
          <a className="settings-link" href="/settings">
            <Settings /> Settings
          </a>
        )}
        {authenticated && (
          <button className="nav-button" type="button" onClick={onLogout}>
            <LogOut /> Sign out
          </button>
        )}
        <ThemePicker />
        <span className="self-hosted-pill">
          <span />
          Self-hosted
        </span>
      </nav>
    </header>
  );
}

function AppearanceSettings() {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const selectedTheme =
    themeOptions.find((theme) => theme.id === preference) ?? themeOptions[0];

  return (
    <section className="settings-card appearance-card">
      <div className="settings-card-heading">
        <span><Palette /></span>
        <div>
          <h2>Appearance</h2>
          <p>Choose a personal theme for this browser and every Veyra page.</p>
        </div>
        <span className="status-badge enabled">
          {selectedTheme.name}
        </span>
      </div>
      <div className="theme-grid" role="radiogroup" aria-label="Veyra theme">
        {themeOptions.map((theme) => (
          <button
            key={theme.id}
            type="button"
            role="radio"
            aria-checked={preference === theme.id}
            className={`theme-card ${preference === theme.id ? "selected" : ""}`}
            onClick={() => setPreference(theme.id)}
          >
            <span className={`theme-preview theme-preview-${theme.id}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>
              <strong>{theme.name}</strong>
              <small>
                {theme.id === "system"
                  ? `${theme.description} · currently ${resolvedTheme === "polar" ? "light" : "dark"}`
                  : theme.description}
              </small>
            </span>
            <span className="theme-radio" aria-hidden="true">
              {preference === theme.id && <Check />}
            </span>
          </button>
        ))}
      </div>
      <p className="appearance-note">
        Saved on this device. The selection also applies to sign-in and public
        share pages.
      </p>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function fileIcon(type: string) {
  if (type.startsWith("image/")) return <Image aria-hidden="true" />;
  if (type.includes("zip") || type.includes("compressed")) {
    return <FileArchive aria-hidden="true" />;
  }
  return <FileText aria-hidden="true" />;
}

function useClipboard() {
  const [copied, setCopied] = useState(false);

  function legacyCopy(value: string) {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    field.setSelectionRange(0, value.length);
    const successful = document.execCommand("copy");
    document.body.removeChild(field);
    if (!successful) throw new Error("Clipboard access was denied.");
  }

  async function copy(value: string) {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        legacyCopy(value);
      }
    } else {
      legacyCopy(value);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return { copied, copy };
}

function UploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [includePasswordInEmail, setIncludePasswordInEmail] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [activeSession, setActiveSession] =
    useState<UploadSessionResponse | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<UploadResult | null>(null);
  const [showQr, setShowQr] = useState(false);
  const { copied: linkCopied, copy: copyLink } = useClipboard();
  const { copied: passwordCopied, copy: copyPassword } = useClipboard();
  const publicConfig = usePublicConfig();
  const settingsLocked = activeSession !== null || uploading;
  const canIncludePasswordInEmail =
    password.length >= 8 && recipientEmail.trim().length > 0;

  const totalSize = useMemo(
    () => files.reduce((total, item) => total + item.file.size, 0),
    [files],
  );

  function createPassword() {
    try {
      setPassword(generateSharePassword());
      setIncludePasswordInEmail(false);
      setError("");
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "A secure password could not be generated.",
      );
    }
  }

  function discardPendingSession() {
    let session = activeSession;
    if (!session) {
      try {
        const pending = JSON.parse(
          localStorage.getItem("veyra.pending-upload") ?? "null",
        ) as { session?: UploadSessionResponse } | null;
        session = pending?.session ?? null;
      } catch {
        session = null;
      }
    }
    if (session) {
      void fetch(`/api/v1/uploads/${session.id}`, { method: "DELETE" });
    }
    setActiveSession(null);
    localStorage.removeItem("veyra.pending-upload");
  }

  function addFiles(incoming: SelectedUploadFile[]) {
    const selectedFiles = incoming;
    if (selectedFiles.length === 0) return;
    discardPendingSession();
    const unique = new Map(
      [...files, ...selectedFiles].map((item) => [
        `${item.relativePath}\u0000${item.file.size}\u0000${item.file.lastModified}`,
        item,
      ]),
    );
    const values = [...unique.values()];
    const overLimit = values.length > publicConfig.limits.maxFilesPerShare;
    setFiles(values.slice(0, publicConfig.limits.maxFilesPerShare));
    setError(
      overLimit
        ? `This instance allows ${publicConfig.limits.maxFilesPerShare} files per share.`
        : "",
    );
  }

  function removeFile(index: number) {
    discardPendingSession();
    setFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
    setError("");
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    try {
      addFiles(await fromDataTransfer(event.dataTransfer));
    } catch {
      setError("This folder could not be read by the browser.");
    }
  }

  async function createOrResumeSession(): Promise<UploadSessionResponse> {
    if (activeSession) return activeSession;
    const fingerprint = fileFingerprint(files);
    try {
      const pending = JSON.parse(
        localStorage.getItem("veyra.pending-upload") ?? "null",
      ) as
        | {
            fingerprint: string;
            session: UploadSessionResponse;
          }
        | null;
      if (
        pending?.fingerprint === fingerprint &&
        new Date(pending.session.expiresAt).getTime() > Date.now()
      ) {
        const resumed = await jsonRequest<UploadSessionResponse>(
          `/api/v1/uploads/${pending.session.id}`,
        );
        const session = { ...resumed, chunkSize: pending.session.chunkSize };
        setActiveSession(session);
        return session;
      }
    } catch {
      localStorage.removeItem("veyra.pending-upload");
    }

    const session = await jsonRequest<UploadSessionResponse>("/api/v1/uploads", {
      method: "POST",
      body: JSON.stringify({
        files: files.map(({ file, relativePath }) => ({
          name: file.name,
          relativePath,
          type: file.type || "application/octet-stream",
          size: file.size,
        })),
        options: {
          expiresInHours:
            expiresInHours === "never" ? null : Number(expiresInHours),
          password: password || undefined,
          maxDownloads: maxDownloads ? Number(maxDownloads) : null,
          title: title || undefined,
          description: description || undefined,
          recipientEmail: recipientEmail || undefined,
        },
      }),
    });
    localStorage.setItem(
      "veyra.pending-upload",
      JSON.stringify({ fingerprint, session }),
    );
    setActiveSession(session);
    return session;
  }

  async function upload() {
    if (files.length === 0) {
      setError("Choose at least one file.");
      return;
    }
    if (totalSize > publicConfig.limits.maxShareBytes) {
      setError(
        `This share exceeds the ${formatBytes(publicConfig.limits.maxShareBytes)} limit.`,
      );
      return;
    }
    setUploading(true);
    setProgress(null);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const session = await createOrResumeSession();
      const payload = await uploadResumably<UploadResult>({
        files,
        session,
        apiRoot: "/api/v1/uploads",
        completePath: `/api/v1/uploads/${session.id}/complete`,
        completePayload:
          includePasswordInEmail && canIncludePasswordInEmail
            ? {
                includePasswordInEmail: true,
                password,
              }
            : {},
        signal: controller.signal,
        onProgress: setProgress,
      });
      localStorage.removeItem("veyra.pending-upload");
      setActiveSession(null);
      setResult(payload);
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        setError("Upload paused. Press Resume when you are ready.");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "The upload could not be completed.",
        );
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  if (result) {
    const shareUrl = result.url || `${window.location.origin}${result.path}`;
    return (
      <section className="upload-panel success-panel" aria-live="polite">
        <div className="success-orbit">
          <div className="success-icon">
            <Check />
          </div>
        </div>
        <p className="eyebrow success-eyebrow">Ready to travel</p>
        <h2>Your link is live.</h2>
        <p className="success-copy">
          {files.length} {files.length === 1 ? "file" : "files"} ·{" "}
          {formatBytes(totalSize)} · protected by {publicConfig.name}
        </p>
        <div className="share-link">
          <span>{shareUrl}</span>
          <button type="button" onClick={() => copyLink(shareUrl)}>
            {linkCopied ? <Check /> : <Copy />}
            {linkCopied ? "Copied" : "Copy"}
          </button>
        </div>
        {password && (
          <div className="share-password-result">
            <span>
              <LockKeyhole />
              <span>
                <small>Share password</small>
                <strong>Available to copy in this tab only</strong>
              </span>
            </span>
            <button type="button" onClick={() => copyPassword(password)}>
              {passwordCopied ? <Check /> : <Copy />}
              {passwordCopied ? "Copied" : "Copy password"}
            </button>
          </div>
        )}
        {result.emailSent === true && (
          <p className="delivery-status sent">
            <Mail /> The secure link
            {result.passwordIncludedInEmail ? " and password were" : " was"} emailed
            to {recipientEmail}.
          </p>
        )}
        {result.emailWarning && (
          <p className="delivery-status warning">
            <Mail /> {result.emailWarning} You can retry from My shares.
          </p>
        )}
        <div className="success-actions">
          <a className="primary-button compact" href={result.path}>
            Open share <ArrowRight />
          </a>
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setFiles([]);
              setResult(null);
              setProgress(null);
              setTitle("");
              setDescription("");
              setRecipientEmail("");
              setPassword("");
              setIncludePasswordInEmail(false);
              setMaxDownloads("");
              setExpiresInHours("168");
            }}
          >
            <RotateCcw /> Send another
          </button>
          <a className="ghost-button" href="/shares">
            <Files /> Manage shares
          </a>
          <button
            className="ghost-button"
            type="button"
            onClick={() => setShowQr((value) => !value)}
          >
            <QrCode /> {showQr ? "Hide QR" : "Show QR"}
          </button>
        </div>
        {showQr && (
          <div className="qr-panel">
            <img
              src={`/api/v1/shares/${encodeURIComponent(result.token)}/qr`}
              alt="QR code for this share"
            />
            <small>Scan to open the share on another device.</small>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="upload-panel" aria-label="Upload files">
      <div
        className={`drop-zone ${dragging ? "dragging" : ""} ${files.length ? "has-files" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) addFiles(fromFileList(event.target.files));
            event.target.value = "";
          }}
        />
        <input
          ref={(node) => {
            folderInputRef.current = node;
            node?.setAttribute("webkitdirectory", "");
            node?.setAttribute("directory", "");
          }}
          className="folder-input"
          type="file"
          multiple
          onChange={(event: ChangeEvent<HTMLInputElement>) => {
            if (event.target.files) addFiles(fromFileList(event.target.files));
            event.target.value = "";
          }}
        />
        {files.length === 0 ? (
          <div className="drop-content">
            <span className="upload-orbit">
              <UploadCloud />
            </span>
            <strong>Drop anything here</strong>
            <span>Choose files or an entire folder</span>
            <small>
              Up to {formatBytes(publicConfig.limits.maxFileBytes)} per file
            </small>
            <span className="drop-choices">
              <button type="button" onClick={() => inputRef.current?.click()}>
                <Plus /> Choose files
              </button>
              <button
                type="button"
                className="folder-choice"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen /> Choose a folder
              </button>
            </span>
          </div>
        ) : (
          <div className="selected-files">
            <div className="selected-heading">
              <div>
                <strong>
                  {files.length} {files.length === 1 ? "file" : "files"} ready
                </strong>
                <span>{formatBytes(totalSize)} total</span>
              </div>
              <button
                type="button"
                className="add-button"
                onClick={() => inputRef.current?.click()}
              >
                <Plus /> Add
              </button>
              <button
                type="button"
                className="add-button"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen /> Folder
              </button>
            </div>
            <div className="file-list">
              {files.map(({ file, relativePath }, index) => (
                <div className="file-row" key={`${relativePath}-${file.size}-${index}`}>
                  <span className="file-icon">{fileIcon(file.type)}</span>
                  <span className="file-name">
                    <strong>{file.name}</strong>
                    <small>
                      {relativePath !== file.name ? `${relativePath} · ` : ""}
                      {formatBytes(file.size)}
                    </small>
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${file.name}`}
                    onClick={() => removeFile(index)}
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="share-details-grid">
        <label>
          <span><FileText /> Share name</span>
          <input
            type="text"
            maxLength={100}
            placeholder="e.g. Project photos"
            value={title}
            disabled={settingsLocked}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          <span><AtSign /> Recipient email</span>
          <input
            type="email"
            maxLength={254}
            placeholder="name@example.com · optional"
            value={recipientEmail}
            disabled={settingsLocked}
            onChange={(event) => {
              const value = event.target.value;
              setRecipientEmail(value);
              if (!value.trim()) setIncludePasswordInEmail(false);
            }}
          />
        </label>
        <label className="wide">
          <span><FileText /> Description</span>
          <textarea
            maxLength={1000}
            rows={3}
            placeholder="Add context or instructions for the recipient"
            value={description}
            disabled={settingsLocked}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
      </div>

      <button
        className="options-toggle"
        type="button"
        aria-expanded={showOptions}
        onClick={() => setShowOptions((value) => !value)}
      >
        <span>
          <ShieldCheck />
          Privacy & link controls
        </span>
        <ChevronDown className={showOptions ? "rotated" : ""} />
      </button>

      {showOptions && (
        <div className="options-grid">
          <label>
            <span>
              <Clock3 /> Expires
            </span>
            <select
              value={expiresInHours}
              disabled={settingsLocked}
              onChange={(event) => setExpiresInHours(event.target.value)}
            >
              <option value="1">After 1 hour</option>
              <option value="24">After 1 day</option>
              <option value="168">After 7 days</option>
              <option value="720">After 30 days</option>
              <option value="never">Never</option>
            </select>
          </label>
          <div className="password-option">
            <label>
              <span>
                <LockKeyhole /> Password
              </span>
              <input
                type="password"
                minLength={8}
                maxLength={256}
                placeholder="Optional · 8+ characters"
                value={password}
                disabled={settingsLocked}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                  if (value.length < 8) setIncludePasswordInEmail(false);
                }}
              />
            </label>
            <div className="password-tools">
              <button
                type="button"
                disabled={settingsLocked}
                onClick={createPassword}
              >
                <Sparkles /> Generate
              </button>
              <button
                type="button"
                disabled={settingsLocked || password.length < 8}
                onClick={() => copyPassword(password)}
              >
                {passwordCopied ? <Check /> : <Copy />}
                {passwordCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <label>
            <span>
              <Gauge /> Download limit
            </span>
            <input
              type="number"
              min="1"
              max="1000000"
              placeholder="Unlimited"
              value={maxDownloads}
              disabled={settingsLocked}
              onChange={(event) => setMaxDownloads(event.target.value)}
            />
          </label>
          <label className="email-password-option">
            <input
              type="checkbox"
              checked={includePasswordInEmail}
              disabled={settingsLocked || !canIncludePasswordInEmail}
              onChange={(event) =>
                setIncludePasswordInEmail(event.target.checked)
              }
            />
            <span>
              <strong>Include password in recipient email</strong>
              <small>
                {canIncludePasswordInEmail
                  ? "Less secure: anyone with this email will have both the link and password."
                  : "Add a valid password and recipient email to enable this option."}
              </small>
            </span>
          </label>
        </div>
      )}

      {activeSession && !uploading && (
        <div className="locked-options-note">
          <span>The paused upload keeps its original link settings.</span>
          <button type="button" onClick={discardPendingSession}>
            Change settings
          </button>
        </div>
      )}

      {error && <p className="form-error">{error}</p>}

      {uploading && (
        <div className="upload-progress" aria-live="polite">
          <div>
            <span>
              {progress?.stage === "scanning"
                ? "Scanning before publication…"
                : progress?.stage === "finalizing"
                  ? "Finalizing secure link…"
                  : "Uploading resumably…"}
            </span>
            <strong>{progress?.percent ?? 0}%</strong>
          </div>
          <progress value={progress?.percent ?? 0} max="100" />
          {progress?.stage === "uploading" && (
            <small>
              {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
              {progress.bytesPerSecond > 0
                ? ` · ${formatBytes(progress.bytesPerSecond)}/s`
                : ""}
              {progress.etaSeconds !== null
                ? ` · ${formatDuration(progress.etaSeconds)} remaining`
                : ""}
            </small>
          )}
          <button
            type="button"
            className="ghost-button compact"
            onClick={() => abortRef.current?.abort()}
          >
            Pause
          </button>
        </div>
      )}

      <button
        type="button"
        className="primary-button send-button"
        disabled={uploading || files.length === 0}
        onClick={() => void upload()}
      >
        {uploading ? (
          <>
            {progress?.stage === "scanning"
              ? "Scanning"
              : progress?.stage === "finalizing"
                ? "Finalizing"
                : "Sending securely"}{" "}
            <span className="spinner" />
          </>
        ) : (
          <>
            {activeSession ? "Resume secure upload" : "Create secure link"}{" "}
            <ArrowRight />
          </>
        )}
      </button>
      <p className="privacy-note">
        <Fingerprint /> Resumable chunks, atomic quota reservation, and
        quarantine-before-publish.
      </p>
    </section>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function FeatureStrip() {
  return (
    <div className="feature-strip">
      <div>
        <span className="feature-icon purple">
          <Zap />
        </span>
        <span>
          <strong>Fast by design</strong>
          <small>Streamed, never buffered</small>
        </span>
      </div>
      <div>
        <span className="feature-icon cyan">
          <ShieldCheck />
        </span>
        <span>
          <strong>Private by default</strong>
          <small>Keys stay on your server</small>
        </span>
      </div>
      <div>
        <span className="feature-icon lime">
          <InfinityIcon />
        </span>
        <span>
          <strong>Truly yours</strong>
          <small>Open source & self-hosted</small>
        </span>
      </div>
    </div>
  );
}

function HomePage({ onLogout }: { onLogout: () => void }) {
  const branding = usePublicConfig();
  return (
    <>
      <Header authenticated onLogout={onLogout} />
      <main>
        <section className="hero">
          <div className="ambient ambient-one" />
          <div className="ambient ambient-two" />
          <div className="hero-copy">
            <div className="version-pill">
              <Sparkles /> A calmer way to share
            </div>
            <h1>
              Send files.
              <span>Keep control.</span>
            </h1>
            <p>
              {branding.tagline}
            </p>
          </div>
          <UploadPanel />
        </section>
        <FeatureStrip />
        <section className="security-section" id="security">
          <p className="eyebrow">Security, rethought</p>
          <h2>Simple on the surface.<br />Serious underneath.</h2>
          <div className="security-cards">
            <article>
              <span><LockKeyhole /></span>
              <h3>Zero plain-text secrets</h3>
              <p>Public tokens are one-way hashed. Passwords use unique salts and memory-hard derivation.</p>
            </article>
            <article>
              <span><Fingerprint /></span>
              <h3>Short-lived access</h3>
              <p>Protected shares unlock through scoped, tamper-evident grants in HttpOnly cookies.</p>
            </article>
            <article>
              <span><ShieldCheck /></span>
              <h3>Abuse resistant</h3>
              <p>Rate limits, strict headers, anonymous audit trails, quotas and expiring links ship by default.</p>
            </article>
          </div>
        </section>
      </main>
      <footer>
        <Brand />
        <p>{branding.tagline}</p>
        <span>{branding.name} {branding.version}</span>
      </footer>
    </>
  );
}

async function jsonRequest<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const payload = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(payload.message ?? "The request failed.");
  return payload;
}

function AuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="auth-page">
      <Header />
      <main className="auth-main">
        <section className="auth-intro">
          <span className="auth-orbit"><ShieldCheck /></span>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
          <div className="auth-trust">
            <span><Check /> Scrypt password protection</span>
            <span><Check /> HttpOnly secure sessions</span>
            <span><Check /> TOTP & recovery codes</span>
          </div>
        </section>
        <section className="auth-card">{children}</section>
      </main>
    </div>
  );
}

function SetupPage({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await jsonRequest("/api/v1/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onDone();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow="First-run setup"
      title="Make Veyra yours."
      description="Create the administrator account that controls uploads, security, and email delivery."
    >
      <form className="auth-form" onSubmit={submit}>
        <div className="form-heading">
          <span><KeyRound /></span>
          <div>
            <h2>Create administrator</h2>
            <p>This is the only account with instance settings access.</p>
          </div>
        </div>
        <label>
          <span>Email address</span>
          <div className="input-wrap"><AtSign /><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" /></div>
        </label>
        <label>
          <span>Password</span>
          <div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></div>
        </label>
        <label>
          <span>Confirm password</span>
          <div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Repeat your password" /></div>
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy}>
          {busy ? "Creating…" : "Create secure account"} <ArrowRight />
        </button>
      </form>
    </AuthLayout>
  );
}

function LoginPage({
  onDone,
  registrationEnabled,
}: {
  onDone: () => void;
  registrationEnabled: boolean;
}) {
  const publicConfig = usePublicConfig();
  const invitationToken =
    new URLSearchParams(window.location.search).get("invite") ?? "";
  const [mode, setMode] = useState<"login" | "forgot" | "register">(
    window.location.pathname === "/register" &&
      (registrationEnabled || Boolean(invitationToken))
      ? "register"
      : "login",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const oidcError = new URLSearchParams(window.location.search).get("oidc");
    if (!oidcError) return;
    const messages: Record<string, string> = {
      "invalid-state": "The single sign-on response failed its state check.",
      "expired-state": "The single sign-on request expired. Try again.",
      "registration-not-allowed":
        "This identity is not linked and OIDC registration is disabled.",
      "link-required":
        "An account with this email already exists. Sign in locally and link OIDC from Settings.",
      "account-disabled": "This account is unavailable.",
      "login-failed": "Single sign-on could not be completed.",
    };
    setError(messages[oidcError] ?? "Single sign-on could not be completed.");
  }, []);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (challenge) {
        await jsonRequest("/api/v1/auth/login/verify", {
          method: "POST",
          body: JSON.stringify({ challenge, code }),
        });
        onDone();
        return;
      }
      const result = await jsonRequest<{
        authenticated?: boolean;
        requiresTwoFactor: boolean;
        challenge?: string;
      }>("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (result.requiresTwoFactor && result.challenge) {
        setChallenge(result.challenge);
      } else {
        onDone();
      }
    } catch (requestError) {
      const requestMessage =
        requestError instanceof Error ? requestError.message : "Sign in failed.";
      setError(requestMessage);
      setVerificationPending(requestMessage.includes("Verify your email"));
    } finally {
      setBusy(false);
    }
  }

  async function forgot(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await jsonRequest<{ message: string }>(
        "/api/v1/auth/forgot-password",
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await jsonRequest<{ message: string }>(
        invitationToken
          ? "/api/v1/auth/register/invitation"
          : "/api/v1/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            ...(invitationToken ? { invitationToken } : {}),
          }),
        },
      );
      setMessage(result.message);
      setVerificationPending(true);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Registration failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resendVerification() {
    setBusy(true);
    setError("");
    try {
      const result = await jsonRequest<{ message: string }>(
        "/api/v1/auth/resend-verification",
        { method: "POST", body: JSON.stringify({ email }) },
      );
      setMessage(result.message);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Verification email could not be resent.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      eyebrow={
        challenge
          ? "Two-factor verification"
          : mode === "register"
            ? "Verified membership"
            : "Private workspace"
      }
      title={
        challenge
          ? "One more step."
          : mode === "register"
            ? "Create your account."
            : "Welcome back."
      }
      description={
        challenge
          ? "Use your authenticator code or one unused recovery code."
          : mode === "register"
            ? "Your files and share history stay isolated inside your own workspace."
          : "Sign in to create and manage secure file deliveries."
      }
    >
      {mode === "forgot" ? (
        <form className="auth-form" onSubmit={forgot}>
          <div className="form-heading"><span><Mail /></span><div><h2>Recover password</h2><p>We will email a link that expires after 30 minutes.</p></div></div>
          <label><span>Email address</span><div className="input-wrap"><AtSign /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
          {message && <p className="form-success">{message}</p>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Sending…" : "Send reset link"} <ArrowRight /></button>
          <button className="text-button" type="button" onClick={() => { setMode("login"); setMessage(""); setError(""); }}>Back to sign in</button>
        </form>
      ) : mode === "register" ? (
        <form className="auth-form" onSubmit={register}>
          <div className="form-heading"><span><UserPlus /></span><div><h2>{invitationToken ? "Accept invitation" : "Create member account"}</h2><p>Email verification is required before sign-in.</p></div></div>
          <label><span>Email address</span><div className="input-wrap"><AtSign /><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
          <label><span>Password</span><div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></div></label>
          <label><span>Confirm password</span><div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div></label>
          {message && <p className="form-success">{message}</p>}
          {error && <p className="form-error">{error}</p>}
          {!verificationPending && <button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create account"} <ArrowRight /></button>}
          {verificationPending && <button className="ghost-button" type="button" disabled={busy} onClick={resendVerification}><Mail /> Resend verification email</button>}
          <button className="text-button" type="button" onClick={() => { setMode("login"); setMessage(""); setError(""); setVerificationPending(false); }}>Already registered? Sign in</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={login}>
          <div className="form-heading">
            <span>{challenge ? <Smartphone /> : <LogIn />}</span>
            <div><h2>{challenge ? "Verify it’s you" : "Sign in"}</h2><p>{challenge ? "Six-digit TOTP or recovery code." : "Access your self-hosted Veyra."}</p></div>
          </div>
          {!challenge ? (
            <>
              <label><span>Email address</span><div className="input-wrap"><AtSign /><input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div></label>
              <label><span>Password</span><div className="input-wrap"><LockKeyhole /><input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
            </>
          ) : (
            <label><span>Verification or recovery code</span><div className="input-wrap code-input"><Smartphone /><input type="text" required autoFocus autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder="000000 or XXXX-XXXX-XXXX-XXXX" /></div></label>
          )}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy}>{busy ? "Checking…" : challenge ? "Verify and sign in" : "Sign in"} <ArrowRight /></button>
          {!challenge && publicConfig.oidc.enabled && (
            <>
              <div className="auth-divider"><span>or</span></div>
              <a className="ghost-button oidc-button" href="/api/v1/auth/oidc/start">
                <Building2 /> {publicConfig.oidc.label ?? "Single sign-on"}
              </a>
            </>
          )}
          {!challenge && <button className="text-button" type="button" onClick={() => { setMode("forgot"); setError(""); }}>Forgot password?</button>}
          {!challenge && verificationPending && <button className="text-button" type="button" disabled={busy} onClick={resendVerification}>Resend verification email</button>}
          {!challenge && registrationEnabled && <button className="text-button" type="button" onClick={() => { setMode("register"); setMessage(""); setError(""); setVerificationPending(false); }}>New here? Create account</button>}
          {challenge && <button className="text-button" type="button" onClick={() => { setChallenge(""); setCode(""); setError(""); }}>Use another account</button>}
        </form>
      )}
    </AuthLayout>
  );
}

function VerifyEmailPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const started = useRef(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (!token) {
      setError("The verification link is missing its token.");
      return;
    }
    void jsonRequest<{ verified: boolean }>("/api/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then(() => setDone(true))
      .catch((requestError) =>
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Email verification failed.",
        ),
      );
  }, [token]);

  return (
    <AuthLayout
      eyebrow="Email verification"
      title={done ? "Your account is ready." : error ? "This link cannot be used." : "Activating your account…"}
      description="Veyra verifies every member address before allowing access."
    >
      <div className="auth-form completion">
        {!done && !error && <span className="large-spinner" />}
        {done && <span className="share-state-icon"><Check /></span>}
        {error && <span className="share-state-icon error-state"><X /></span>}
        <h2>{done ? "Email verified" : error ? "Verification failed" : "Checking secure link"}</h2>
        <p>{done ? "You can now sign in and create your own private shares." : error || "This takes only a moment."}</p>
        {(done || error) && <a className="primary-button compact" href="/">Return to sign in</a>}
      </div>
    </AuthLayout>
  );
}

function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await jsonRequest("/api/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout eyebrow="Account recovery" title="Choose a new password." description="Your existing sessions will be revoked. Two-factor authentication remains enabled.">
      {done ? (
        <div className="auth-form completion"><span className="share-state-icon"><Check /></span><h2>Password changed</h2><p>You can now sign in with your new password.</p><a className="primary-button" href="/">Return to sign in</a></div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <div className="form-heading"><span><KeyRound /></span><div><h2>Reset password</h2><p>Use at least 12 characters.</p></div></div>
          <label><span>New password</span><div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
          <label><span>Confirm password</span><div className="input-wrap"><LockKeyhole /><input type="password" required minLength={12} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></div></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy || !token}>{busy ? "Saving…" : "Set new password"} <ArrowRight /></button>
        </form>
      )}
    </AuthLayout>
  );
}

interface EmailForm {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

interface ManagedUser {
  id: string;
  email: string;
  role: "admin" | "member";
  emailVerified: boolean;
  disabled: boolean;
  twoFactorEnabled: boolean;
  createdAt: string;
  shareCount: number;
  totalSize: number;
  quotaBytes: number | null;
}

interface ManagedShare {
  id: string;
  path: string | null;
  url: string | null;
  createdAt: string;
  expiresAt: string | null;
  maxDownloads: number | null;
  downloads: number;
  title: string | null;
  description: string | null;
  recipientEmail: string | null;
  passwordProtected: boolean;
  status: "uploading" | "processing" | "ready" | "quarantined" | "failed";
  source: "outbound" | "reverse";
  senderName: string | null;
  senderEmail: string | null;
  qrUrl: string | null;
  fileCount: number;
  totalSize: number;
  files: SharedFile[];
}

function ShareManagerCard({
  share,
  onReload,
  onError,
}: {
  share: ManagedShare;
  onReload: () => void;
  onError: (message: string) => void;
}) {
  const { copied, copy } = useClipboard();
  const [busy, setBusy] = useState(false);
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [maxDownloads, setMaxDownloads] = useState(
    share.maxDownloads === null ? "" : String(share.maxDownloads),
  );
  const [title, setTitle] = useState(share.title ?? "");
  const [description, setDescription] = useState(share.description ?? "");
  const [recipientEmail, setRecipientEmail] = useState(
    share.recipientEmail ?? "",
  );
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [passwordAction, setPasswordAction] = useState<"keep" | "change" | "remove">("keep");
  const [newPassword, setNewPassword] = useState("");
  const expired = share.expiresAt !== null && new Date(share.expiresAt).getTime() <= Date.now();
  const limitReached =
    share.maxDownloads !== null && share.downloads >= share.maxDownloads;
  const active = share.status === "ready" && !expired && !limitReached;

  async function regenerate() {
    setBusy(true);
    onError("");
    try {
      await jsonRequest(`/api/v1/me/shares/${share.id}/regenerate-link`, {
        method: "POST",
      });
      onReload();
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : "Link generation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      await jsonRequest(`/api/v1/me/shares/${share.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          expiresInHours:
            expiresInHours === "never" ? null : Number(expiresInHours),
          maxDownloads: maxDownloads ? Number(maxDownloads) : null,
          title: title || null,
          description: description || null,
          recipientEmail: recipientEmail || null,
          password:
            passwordAction === "keep"
              ? undefined
              : passwordAction === "remove"
                ? null
                : newPassword,
        }),
      });
      onReload();
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : "Share update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this share and all of its files permanently?")) return;
    setBusy(true);
    onError("");
    try {
      await jsonRequest(`/api/v1/me/shares/${share.id}`, { method: "DELETE" });
      onReload();
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : "Share deletion failed.");
      setBusy(false);
    }
  }

  async function resendEmail() {
    setBusy(true);
    setDeliveryMessage("");
    onError("");
    try {
      await jsonRequest(`/api/v1/me/shares/${share.id}/send-email`, {
        method: "POST",
      });
      setDeliveryMessage(`Email sent to ${share.recipientEmail}.`);
    } catch (requestError) {
      onError(
        requestError instanceof Error
          ? requestError.message
          : "Email delivery failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  const displayTitle = share.title || share.files[0]?.name || "Untitled share";

  return (
    <article className="managed-share-card">
      <div className="managed-share-top">
        <span className="file-icon"><Files /></span>
        <div className="managed-share-title">
          <h2>{displayTitle}</h2>
          <p>{share.fileCount} {share.fileCount === 1 ? "file" : "files"} · {formatBytes(share.totalSize)} · created {new Date(share.createdAt).toLocaleDateString()}</p>
        </div>
        <span className={`share-status ${active ? "active" : "inactive"}`}>
          {active
            ? "Active"
            : share.status === "quarantined"
              ? "Quarantined"
              : share.status === "processing" || share.status === "uploading"
                ? "Processing"
                : expired
                  ? "Expired"
                  : limitReached
                    ? "Limit reached"
                    : "Unavailable"}
        </span>
      </div>

      <div className="managed-share-stats">
        <span><ArrowDownToLine /><strong>{share.downloads}</strong><small>downloads</small></span>
        <span><Gauge /><strong>{share.maxDownloads ?? "∞"}</strong><small>limit</small></span>
        <span><CalendarDays /><strong>{share.expiresAt ? new Date(share.expiresAt).toLocaleDateString() : "Never"}</strong><small>expires</small></span>
        <span><LockKeyhole /><strong>{share.passwordProtected ? "On" : "Off"}</strong><small>password</small></span>
      </div>

      {share.url ? (
        <div className="managed-link">
          <Link2 />
          <span>{share.url}</span>
          <button type="button" onClick={() => void copy(share.url!)}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button>
          <a href={share.path!} target="_blank" rel="noreferrer"><ArrowRight /> Open</a>
          {share.qrUrl && (
            <button type="button" onClick={() => setShowQr((value) => !value)}>
              <QrCode /> QR
            </button>
          )}
        </div>
      ) : (
        <div className="legacy-link">
          <span><Link2 /><span><strong>Legacy share</strong><small>The original link was stored only as a hash.</small></span></span>
          <button className="primary-button compact" type="button" disabled={busy} onClick={regenerate}><RefreshCw /> Generate new link</button>
        </div>
      )}

      {showQr && share.qrUrl && (
        <div className="qr-panel compact">
          <img src={share.qrUrl} alt={`QR code for ${displayTitle}`} />
        </div>
      )}

      {share.status === "quarantined" && (
        <p className="settings-alert error">
          <ScanLine /> This upload is isolated and cannot be opened or emailed.
        </p>
      )}

      {(share.recipientEmail || deliveryMessage) && (
        <div className="managed-recipient">
          <span><Mail /><span><small>Recipient</small><strong>{share.recipientEmail}</strong></span></span>
          {share.recipientEmail && share.url && (
            <button type="button" disabled={busy} onClick={resendEmail}>
              <Mail /> Resend email
            </button>
          )}
          {deliveryMessage && <em>{deliveryMessage}</em>}
        </div>
      )}

      <div className="managed-file-preview">
        {share.files.slice(0, 3).map((file) => (
          <span key={file.id}>
            {fileIcon(file.type)}
            <span>
              <strong>{file.name}</strong>
              <small>
                {file.relativePath ? `${file.relativePath} · ` : ""}
                {formatBytes(file.size)}
              </small>
            </span>
            {file.directUrl && (
              <button
                type="button"
                aria-label={`Copy direct link for ${file.name}`}
                onClick={() => void copy(file.directUrl!)}
              >
                <Copy />
              </button>
            )}
          </span>
        ))}
        {share.files.length > 3 && <em>+{share.files.length - 3} more</em>}
      </div>

      <details className="manage-details">
        <summary>Manage share <ChevronDown /></summary>
        <form onSubmit={save}>
          <label><span>Share name</span><input maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional title" /></label>
          <label><span>Recipient email</span><input type="email" maxLength={254} value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label className="wide"><span>Description</span><textarea maxLength={1000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional context or instructions" /></label>
          <label><span>Extend expiry</span><select value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)}><option value="1">1 hour from now</option><option value="24">1 day from now</option><option value="168">7 days from now</option><option value="720">30 days from now</option><option value="never">Never</option></select></label>
          <label><span>Download limit</span><input type="number" min="1" max="1000000" value={maxDownloads} onChange={(event) => setMaxDownloads(event.target.value)} placeholder="Unlimited" /></label>
          <label><span>Password</span><select value={passwordAction} onChange={(event) => setPasswordAction(event.target.value as typeof passwordAction)}><option value="keep">Keep current setting</option><option value="change">Set new password</option><option value="remove">Remove password</option></select></label>
          {passwordAction === "change" && <label><span>New password</span><input type="password" minLength={8} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>}
          <div className="manage-actions wide"><button className="primary-button compact" disabled={busy}><Save /> Save changes</button><button className="danger-button" type="button" disabled={busy} onClick={remove}><Trash2 /> Delete share</button></div>
        </form>
      </details>
    </article>
  );
}

function MySharesPage({ onLogout }: { onLogout: () => void }) {
  const [shares, setShares] = useState<ManagedShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const result = await jsonRequest<{ shares: ManagedShare[] }>("/api/v1/me/shares");
      setShares(result.shares);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Shares could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const activeCount = shares.filter(
    (share) =>
      share.status === "ready" &&
      (!share.expiresAt || new Date(share.expiresAt).getTime() > Date.now()) &&
      (share.maxDownloads === null || share.downloads < share.maxDownloads),
  ).length;
  const totalSize = shares.reduce((sum, share) => sum + share.totalSize, 0);

  return (
    <div className="settings-page">
      <Header authenticated onLogout={onLogout} />
      <main className="shares-main">
        <div className="shares-heading">
          <div><p className="eyebrow">Your activity</p><h1>My shares</h1><p>Every delivery, link, file, and access limit in one place.</p></div>
          <a className="primary-button compact" href="/"><Plus /> Create share</a>
        </div>
        <div className="shares-overview">
          <span><strong>{shares.length}</strong><small>Total shares</small></span>
          <span><strong>{activeCount}</strong><small>Active now</small></span>
          <span><strong>{formatBytes(totalSize)}</strong><small>Stored files</small></span>
        </div>
        {error && <p className="settings-alert error">{error}</p>}
        {loading ? (
          <div className="shares-empty"><span className="large-spinner" /><p>Loading your shares…</p></div>
        ) : shares.length === 0 ? (
          <div className="shares-empty"><span className="share-state-icon"><Files /></span><h2>No shares yet</h2><p>Your uploads will appear here automatically.</p><a className="primary-button compact" href="/">Upload your first files</a></div>
        ) : (
          <div className="managed-shares-list">{shares.map((share) => <ShareManagerCard key={share.id} share={share} onReload={load} onError={setError} />)}</div>
        )}
      </main>
    </div>
  );
}

interface UploadRequestView {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  path: string | null;
  enabled: boolean;
  passwordProtected: boolean;
  expiresAt: string | null;
  maxFiles: number;
  maxTotalSize: number;
  maxSubmissions: number;
  submissionCount: number;
  createdAt: string;
  qrUrl: string;
}

interface SubmissionView {
  id: string;
  requestId: string;
  senderName: string | null;
  senderEmail: string | null;
  message: string | null;
  status: "uploading" | "processing" | "ready" | "quarantined" | "failed";
  totalSize: number;
  fileCount: number;
  createdAt: string;
  files: Array<{
    id: string;
    name: string;
    relativePath: string;
    type: string;
    size: number;
    sha256: string;
    scanStatus: string;
  }>;
}

function UploadRequestsPage({ onLogout }: { onLogout: () => void }) {
  const { copied, copy } = useClipboard();
  const [requests, setRequests] = useState<UploadRequestView[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [password, setPassword] = useState("");
  const [maxFiles, setMaxFiles] = useState("100");
  const [maxSizeGiB, setMaxSizeGiB] = useState("10");
  const [maxSubmissions, setMaxSubmissions] = useState("100");
  const [expiresInHours, setExpiresInHours] = useState("168");
  const [shownQr, setShownQr] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const value = await jsonRequest<{ requests: UploadRequestView[] }>(
        "/api/v1/me/upload-requests",
      );
      setRequests(value.requests);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Upload requests could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await jsonRequest("/api/v1/me/upload-requests", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description || undefined,
          password: password || undefined,
          expiresInHours:
            expiresInHours === "never" ? null : Number(expiresInHours),
          maxFiles: Number(maxFiles),
          maxTotalSize: Number(maxSizeGiB) * 1024 ** 3,
          maxSubmissions: Number(maxSubmissions),
        }),
      });
      setTitle("");
      setDescription("");
      setPassword("");
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Upload request could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggle(request: UploadRequestView) {
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/me/upload-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !request.enabled }),
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Upload request could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(request: UploadRequestView) {
    setBusy(true);
    try {
      await jsonRequest(
        `/api/v1/me/upload-requests/${request.id}/regenerate-link`,
        { method: "POST" },
      );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The link could not be regenerated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(request: UploadRequestView) {
    if (
      !window.confirm(
        "Delete this request, its private submissions, and all received files?",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await jsonRequest(`/api/v1/me/upload-requests/${request.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The request could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <Header authenticated onLogout={onLogout} />
      <main className="shares-main">
        <div className="shares-heading">
          <div>
            <p className="eyebrow">Reverse shares</p>
            <h1>Receive files privately</h1>
            <p>Create an expiring link that lets other people upload into your private inbox.</p>
          </div>
          <a className="ghost-button" href="/inbox"><Inbox /> Open inbox</a>
        </div>
        {error && <p className="settings-alert error">{error}</p>}
        <section className="settings-card">
          <div className="settings-card-heading">
            <span><FolderOpen /></span>
            <div><h2>New upload request</h2><p>Every submission uses your quota and security policy.</p></div>
          </div>
          <form className="email-form request-form" onSubmit={create}>
            <label>
              <span>Request name</span>
              <input required maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Collect event photos" />
            </label>
            <label>
              <span>Password (optional)</span>
              <input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            <label className="wide">
              <span>Instructions</span>
              <textarea
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Add context or instructions for uploaders"
              />
            </label>
            <label>
              <span>Expires</span>
              <select value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)}>
                <option value="24">1 day</option>
                <option value="168">7 days</option>
                <option value="720">30 days</option>
                <option value="never">Never</option>
              </select>
            </label>
            <label>
              <span>Maximum files</span>
              <input type="number" min="1" max="2000" required value={maxFiles} onChange={(event) => setMaxFiles(event.target.value)} />
            </label>
            <label>
              <span>Maximum per submission (GiB)</span>
              <input type="number" min="1" required value={maxSizeGiB} onChange={(event) => setMaxSizeGiB(event.target.value)} />
            </label>
            <label>
              <span>Maximum submissions</span>
              <input type="number" min="1" max="10000" required value={maxSubmissions} onChange={(event) => setMaxSubmissions(event.target.value)} />
            </label>
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy}><Plus /> Create request</button>
            </div>
          </form>
        </section>
        <div className="managed-shares-list">
          {requests.map((request) => (
            <article className="managed-share-card" key={request.id}>
              <div className="managed-share-top">
                <span className="file-icon"><FolderOpen /></span>
                <div className="managed-share-title">
                  <h2>{request.title}</h2>
                  <p>{request.submissionCount}/{request.maxSubmissions} submissions · {formatBytes(request.maxTotalSize)} each</p>
                </div>
                <span className={`share-status ${request.enabled ? "active" : "inactive"}`}>
                  {request.enabled ? "Open" : "Closed"}
                </span>
              </div>
              {request.description && <p>{request.description}</p>}
              {request.url && (
                <div className="managed-link">
                  <Link2 />
                  <span>{request.url}</span>
                  <button type="button" onClick={() => void copy(request.url!)}>
                    {copied ? <Check /> : <Copy />} Copy
                  </button>
                  <button type="button" onClick={() => setShownQr(shownQr === request.id ? "" : request.id)}>
                    <QrCode /> QR
                  </button>
                </div>
              )}
              {shownQr === request.id && (
                <div className="qr-panel compact">
                  <img src={request.qrUrl} alt={`QR code for ${request.title}`} />
                </div>
              )}
              <div className="manage-actions">
                <button className="ghost-button compact" type="button" disabled={busy} onClick={() => void toggle(request)}>
                  {request.enabled ? <X /> : <Check />} {request.enabled ? "Close" : "Open"}
                </button>
                <button className="ghost-button compact" type="button" disabled={busy} onClick={() => void regenerate(request)}>
                  <RefreshCw /> New link
                </button>
                <button className="danger-button" type="button" disabled={busy} onClick={() => void remove(request)}>
                  <Trash2 /> Delete
                </button>
              </div>
            </article>
          ))}
          {requests.length === 0 && (
            <div className="shares-empty"><FolderOpen /><h2>No upload requests yet</h2></div>
          )}
        </div>
      </main>
    </div>
  );
}

function SubmissionsPage({ onLogout }: { onLogout: () => void }) {
  const [submissions, setSubmissions] = useState<SubmissionView[]>([]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const value = await jsonRequest<{ submissions: SubmissionView[] }>(
        "/api/v1/me/submissions",
      );
      setSubmissions(value.submissions);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Inbox could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(submission: SubmissionView) {
    if (!window.confirm("Delete this private submission and all received files?")) {
      return;
    }
    try {
      await jsonRequest(`/api/v1/me/submissions/${submission.id}`, {
        method: "DELETE",
      });
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Submission could not be deleted.",
      );
    }
  }

  return (
    <div className="settings-page">
      <Header authenticated onLogout={onLogout} />
      <main className="shares-main">
        <div className="shares-heading">
          <div><p className="eyebrow">Private inbox</p><h1>Received files</h1><p>Submissions are visible only to the request owner.</p></div>
          <a className="primary-button compact" href="/requests"><Plus /> New request</a>
        </div>
        {error && <p className="settings-alert error">{error}</p>}
        <div className="managed-shares-list">
          {submissions.map((submission) => (
            <article className="managed-share-card" key={submission.id}>
              <div className="managed-share-top">
                <span className="file-icon"><Inbox /></span>
                <div className="managed-share-title">
                  <h2>{submission.senderName || submission.senderEmail || "Anonymous sender"}</h2>
                  <p>{submission.fileCount} files · {formatBytes(submission.totalSize)} · {new Date(submission.createdAt).toLocaleString()}</p>
                </div>
                <span className={`share-status ${submission.status === "ready" ? "active" : "inactive"}`}>
                  {submission.status}
                </span>
              </div>
              {submission.message && <blockquote>{submission.message}</blockquote>}
              <div className="download-list">
                {submission.files.map((file) => (
                  <div className="download-row" key={file.id}>
                    <span className="file-icon">{fileIcon(file.type)}</span>
                    <span className="file-name">
                      <strong>{file.name}</strong>
                      <small>{file.relativePath ? `${file.relativePath} · ` : ""}{formatBytes(file.size)} · {file.scanStatus}</small>
                    </span>
                    {submission.status === "ready" && (
                      <a href={`/api/v1/me/submissions/${submission.id}/files/${file.id}`} aria-label={`Download ${file.name}`}>
                        <ArrowDownToLine />
                      </a>
                    )}
                  </div>
                ))}
              </div>
              {submission.status === "quarantined" && (
                <p className="settings-alert error"><ScanLine /> Quarantined; no file can be opened.</p>
              )}
              <button className="danger-button" type="button" onClick={() => void remove(submission)}>
                <Trash2 /> Delete submission
              </button>
            </article>
          ))}
          {submissions.length === 0 && (
            <div className="shares-empty"><Inbox /><h2>Your inbox is empty</h2><p>New reverse-share submissions appear here.</p></div>
          )}
        </div>
      </main>
    </div>
  );
}

interface CapacitySettings {
  maxShareBytes: number;
  defaultUserQuotaBytes: number | null;
  instanceQuotaBytes: number | null;
  minimumFreeBytes: number;
  maxFilesPerShare: number;
  maxFileBytes: number;
  availableLocalBytes: number;
  usage: {
    committedBytes: number;
    reservedBytes: number;
    totalBytes: number;
  };
}

interface StorageSettingsForm {
  backend: "local" | "s3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  secretConfigured: boolean;
}

interface AntivirusSettingsForm {
  enabled: boolean;
  host: string;
  port: number;
  timeoutMs: number;
}

interface BrandingSettingsForm {
  name: string;
  tagline: string;
  accent: string;
  logoVersion: number;
}

interface OidcSettingsForm {
  enabled: boolean;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  clientSecretConfigured: boolean;
  allowRegistration: boolean;
}

interface InvitationView {
  id: string;
  email: string | null;
  url: string | null;
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revoked: boolean;
  createdAt: string;
}

interface GlobalShareView {
  id: string;
  ownerId: string | null;
  ownerEmail: string | null;
  status: string;
  source: string;
  createdAt: string;
  expiresAt: string | null;
  fileCount: number;
  totalSize: number;
}

function AdminPlatformSettings() {
  const publicConfig = usePublicConfig();
  const { copied, copy } = useClipboard();
  const [capacity, setCapacity] = useState<CapacitySettings | null>(null);
  const [storageForm, setStorageForm] = useState<StorageSettingsForm | null>(null);
  const [antivirus, setAntivirus] = useState<AntivirusSettingsForm | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsForm | null>(null);
  const [oidcForm, setOidcForm] = useState<OidcSettingsForm | null>(null);
  const [invitations, setInvitations] = useState<InvitationView[]>([]);
  const [globalShares, setGlobalShares] = useState<GlobalShareView[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteUses, setInviteUses] = useState("1");
  const [inviteHours, setInviteHours] = useState("72");
  const [latestInvite, setLatestInvite] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [
        capacityValue,
        storageValue,
        antivirusValue,
        brandingValue,
        oidcValue,
        invitationValue,
        sharesValue,
      ] = await Promise.all([
        jsonRequest<CapacitySettings>("/api/v1/admin/capacity"),
        jsonRequest<Omit<StorageSettingsForm, "secretAccessKey">>(
          "/api/v1/admin/storage",
        ),
        jsonRequest<AntivirusSettingsForm>("/api/v1/admin/antivirus"),
        jsonRequest<BrandingSettingsForm>("/api/v1/admin/branding"),
        jsonRequest<Omit<OidcSettingsForm, "clientSecret">>(
          "/api/v1/admin/oidc",
        ),
        jsonRequest<{ invitations: InvitationView[] }>(
          "/api/v1/admin/invitations",
        ),
        jsonRequest<{ shares: GlobalShareView[] }>(
          "/api/v1/admin/global-shares",
        ),
      ]);
      setCapacity(capacityValue);
      setStorageForm({ ...storageValue, secretAccessKey: "" });
      setAntivirus(antivirusValue);
      setBranding(brandingValue);
      setOidcForm({ ...oidcValue, clientSecret: "" });
      setInvitations(invitationValue.invitations);
      setGlobalShares(sharesValue.shares);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Platform settings could not be loaded.",
      );
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(
    key: string,
    action: () => Promise<void>,
    success: string,
  ) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The operation failed.",
      );
    } finally {
      setBusy("");
    }
  }

  async function saveCapacity(event: FormEvent) {
    event.preventDefault();
    if (!capacity) return;
    await run(
      "capacity",
      async () => {
        await jsonRequest("/api/v1/admin/capacity", {
          method: "PUT",
          body: JSON.stringify({
            maxShareBytes: capacity.maxShareBytes,
            defaultUserQuotaBytes: capacity.defaultUserQuotaBytes,
            instanceQuotaBytes: capacity.instanceQuotaBytes,
            minimumFreeBytes: capacity.minimumFreeBytes,
            maxFilesPerShare: capacity.maxFilesPerShare,
          }),
        });
        await load();
      },
      "Capacity policy saved.",
    );
  }

  async function saveStorage(event: FormEvent) {
    event.preventDefault();
    if (!storageForm) return;
    await run(
      "storage",
      async () => {
        await jsonRequest("/api/v1/admin/storage", {
          method: "PUT",
          body: JSON.stringify(storageForm),
        });
        await load();
      },
      `New uploads will use ${storageForm.backend === "s3" ? "S3" : "local storage"}. Existing objects stay on their original backend.`,
    );
  }

  async function saveAntivirus(event: FormEvent) {
    event.preventDefault();
    if (!antivirus) return;
    await run(
      "antivirus",
      async () => {
        await jsonRequest("/api/v1/admin/antivirus", {
          method: "PUT",
          body: JSON.stringify(antivirus),
        });
      },
      antivirus.enabled
        ? "ClamAV is reachable. New uploads now fail closed."
        : "Antivirus integration is explicitly disabled.",
    );
  }

  async function saveBranding(event: FormEvent) {
    event.preventDefault();
    if (!branding) return;
    await run(
      "branding",
      async () => {
        await jsonRequest("/api/v1/admin/branding", {
          method: "PUT",
          body: JSON.stringify({
            name: branding.name,
            tagline: branding.tagline,
            accent: branding.accent,
          }),
        });
      },
      "Public branding saved. Refresh to apply it everywhere.",
    );
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await run(
      "logo",
      async () => {
        const form = new FormData();
        form.append("logo", file, file.name);
        const response = await fetch("/api/v1/admin/branding/logo", {
          method: "POST",
          body: form,
        });
        const payload = (await response.json()) as { message?: string };
        if (!response.ok) {
          throw new Error(payload.message ?? "Logo upload failed.");
        }
        await load();
      },
      "Logo re-encoded safely and saved.",
    );
  }

  async function saveOidc(event: FormEvent) {
    event.preventDefault();
    if (!oidcForm) return;
    await run(
      "oidc",
      async () => {
        await jsonRequest("/api/v1/admin/oidc", {
          method: "PUT",
          body: JSON.stringify(oidcForm),
        });
        await load();
      },
      oidcForm.enabled
        ? "OIDC discovery succeeded and single sign-on is enabled."
        : "OIDC is disabled.",
    );
  }

  async function createInvitation(event: FormEvent) {
    event.preventDefault();
    await run(
      "invite",
      async () => {
        const result = await jsonRequest<{ url: string }>(
          "/api/v1/admin/invitations",
          {
            method: "POST",
            body: JSON.stringify({
              email: inviteEmail || null,
              expiresInHours: Number(inviteHours),
              maxUses: Number(inviteUses),
              sendEmail: Boolean(inviteEmail),
            }),
          },
        );
        setLatestInvite(result.url);
        const value = await jsonRequest<{ invitations: InvitationView[] }>(
          "/api/v1/admin/invitations",
        );
        setInvitations(value.invitations);
      },
      inviteEmail
        ? `Invitation sent to ${inviteEmail}.`
        : "Invitation created.",
    );
  }

  async function revokeInvitation(id: string) {
    await run(
      `invite-${id}`,
      async () => {
        await jsonRequest(`/api/v1/admin/invitations/${id}`, {
          method: "DELETE",
        });
        const value = await jsonRequest<{ invitations: InvitationView[] }>(
          "/api/v1/admin/invitations",
        );
        setInvitations(value.invitations);
      },
      "Invitation revoked.",
    );
  }

  async function revokeGlobalShare(id: string) {
    if (!window.confirm("Revoke this public link without opening its content?")) {
      return;
    }
    await run(
      `share-${id}`,
      async () => {
        await jsonRequest(`/api/v1/admin/global-shares/${id}/revoke`, {
          method: "POST",
        });
        const value = await jsonRequest<{ shares: GlobalShareView[] }>(
          "/api/v1/admin/global-shares",
        );
        setGlobalShares(value.shares);
      },
      "Public access revoked.",
    );
  }

  return (
    <>
      {error && <p className="settings-alert error">{error}</p>}
      {notice && <p className="settings-alert success">{notice}</p>}

      {capacity && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span><HardDrive /></span>
            <div>
              <h2>Capacity & free-space protection</h2>
              <p>Atomic reservations prevent concurrent uploads from oversubscribing storage.</p>
            </div>
            <span className="status-badge enabled storage-value-badge">
              {formatBytes(capacity.usage.committedBytes)} used
            </span>
          </div>
          <div className="capacity-meter">
            <progress
              value={capacity.usage.committedBytes}
              max={capacity.instanceQuotaBytes ?? Math.max(capacity.availableLocalBytes, 1)}
            />
            <span>
              {formatBytes(capacity.usage.reservedBytes)} reserved ·{" "}
              {formatBytes(capacity.availableLocalBytes)} free locally
            </span>
          </div>
          <form className="email-form" onSubmit={saveCapacity}>
            <label>
              <span>Maximum per share (GiB)</span>
              <input
                type="number"
                min="1"
                required
                value={Math.round(capacity.maxShareBytes / 1024 ** 3)}
                onChange={(event) =>
                  setCapacity({
                    ...capacity,
                    maxShareBytes: Number(event.target.value) * 1024 ** 3,
                  })
                }
              />
            </label>
            <label>
              <span>Default per user (GiB)</span>
              <input
                type="number"
                min="1"
                value={
                  capacity.defaultUserQuotaBytes === null
                    ? ""
                    : Math.round(capacity.defaultUserQuotaBytes / 1024 ** 3)
                }
                placeholder="Unlimited"
                onChange={(event) =>
                  setCapacity({
                    ...capacity,
                    defaultUserQuotaBytes: event.target.value
                      ? Number(event.target.value) * 1024 ** 3
                      : null,
                  })
                }
              />
            </label>
            <label>
              <span>Instance quota (GiB)</span>
              <input
                type="number"
                min="1"
                value={
                  capacity.instanceQuotaBytes === null
                    ? ""
                    : Math.round(capacity.instanceQuotaBytes / 1024 ** 3)
                }
                placeholder="Unlimited"
                onChange={(event) =>
                  setCapacity({
                    ...capacity,
                    instanceQuotaBytes: event.target.value
                      ? Number(event.target.value) * 1024 ** 3
                      : null,
                  })
                }
              />
            </label>
            <label>
              <span>Keep free locally (GiB)</span>
              <input
                type="number"
                min="0"
                required
                value={Math.round(capacity.minimumFreeBytes / 1024 ** 3)}
                onChange={(event) =>
                  setCapacity({
                    ...capacity,
                    minimumFreeBytes: Number(event.target.value) * 1024 ** 3,
                  })
                }
              />
            </label>
            <label>
              <span>Files per share</span>
              <input
                type="number"
                min="1"
                max="2000"
                required
                value={capacity.maxFilesPerShare}
                onChange={(event) =>
                  setCapacity({
                    ...capacity,
                    maxFilesPerShare: Number(event.target.value),
                  })
                }
              />
            </label>
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy === "capacity"}>
                <Save /> Save capacity policy
              </button>
            </div>
          </form>
        </section>
      )}

      {storageForm && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span>{storageForm.backend === "s3" ? <Cloud /> : <HardDrive />}</span>
            <div>
              <h2>Storage backend</h2>
              <p>New objects can stay local or move to an S3-compatible bucket.</p>
            </div>
            <span className="status-badge enabled">{storageForm.backend.toUpperCase()}</span>
          </div>
          <form className="email-form" onSubmit={saveStorage}>
            <label>
              <span>Backend</span>
              <div className="settings-select-wrap">
                <select
                  value={storageForm.backend}
                  onChange={(event) =>
                    setStorageForm({
                      ...storageForm,
                      backend: event.target.value as "local" | "s3",
                    })
                  }
                >
                  <option value="local">Local volume</option>
                  <option value="s3">S3-compatible</option>
                </select>
                <ChevronDown aria-hidden="true" />
              </div>
            </label>
            {storageForm.backend === "s3" && (
              <>
                <label className="wide">
                  <span>Endpoint</span>
                  <input
                    type="url"
                    required
                    value={storageForm.endpoint}
                    onChange={(event) =>
                      setStorageForm({ ...storageForm, endpoint: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Region</span>
                  <input
                    required
                    value={storageForm.region}
                    onChange={(event) =>
                      setStorageForm({ ...storageForm, region: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Bucket</span>
                  <input
                    required
                    value={storageForm.bucket}
                    onChange={(event) =>
                      setStorageForm({ ...storageForm, bucket: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Object prefix</span>
                  <input
                    value={storageForm.prefix}
                    onChange={(event) =>
                      setStorageForm({ ...storageForm, prefix: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Access key</span>
                  <input
                    required
                    value={storageForm.accessKeyId}
                    onChange={(event) =>
                      setStorageForm({
                        ...storageForm,
                        accessKeyId: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>Secret key</span>
                  <input
                    type="password"
                    value={storageForm.secretAccessKey}
                    placeholder={
                      storageForm.secretConfigured
                        ? "Saved — leave blank to keep"
                        : "Required"
                    }
                    onChange={(event) =>
                      setStorageForm({
                        ...storageForm,
                        secretAccessKey: event.target.value,
                      })
                    }
                  />
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={storageForm.forcePathStyle}
                    onChange={(event) =>
                      setStorageForm({
                        ...storageForm,
                        forcePathStyle: event.target.checked,
                      })
                    }
                  />
                  <span>Path-style addressing (MinIO and some providers)</span>
                </label>
              </>
            )}
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy === "storage"}>
                <Save /> Test and save backend
              </button>
            </div>
          </form>
        </section>
      )}

      {antivirus && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span><ScanLine /></span>
            <div>
              <h2>Antivirus & quarantine</h2>
              <p>When enabled, an unavailable scanner quarantines the upload instead of publishing it.</p>
            </div>
            <span className={`status-badge ${antivirus.enabled ? "enabled" : ""}`}>
              {antivirus.enabled ? "Fail closed" : "Disabled"}
            </span>
          </div>
          <p className="settings-callout">
            ClamAV commonly needs 2.4–4 GB RAM while signatures reload. Run it
            on a host with enough memory; Veyra does not start it automatically.
          </p>
          <form className="email-form" onSubmit={saveAntivirus}>
            <label className="checkbox-label wide">
              <input
                type="checkbox"
                checked={antivirus.enabled}
                onChange={(event) =>
                  setAntivirus({ ...antivirus, enabled: event.target.checked })
                }
              />
              <span>Scan every finalized upload before publication</span>
            </label>
            <label>
              <span>clamd host</span>
              <input
                required
                value={antivirus.host}
                onChange={(event) =>
                  setAntivirus({ ...antivirus, host: event.target.value })
                }
              />
            </label>
            <label>
              <span>Port</span>
              <input
                type="number"
                min="1"
                max="65535"
                required
                value={antivirus.port}
                onChange={(event) =>
                  setAntivirus({ ...antivirus, port: Number(event.target.value) })
                }
              />
            </label>
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy === "antivirus"}>
                <ShieldCheck /> Test and save scanner
              </button>
            </div>
          </form>
        </section>
      )}

      {branding && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span><Palette /></span>
            <div>
              <h2>Controlled branding</h2>
              <p>Text, accent color, and a safely re-encoded raster logo—never arbitrary CSS.</p>
            </div>
            <span className="status-badge enabled">{branding.name}</span>
          </div>
          <form className="email-form" onSubmit={saveBranding}>
            <label>
              <span>Application name</span>
              <input
                required
                maxLength={40}
                value={branding.name}
                onChange={(event) =>
                  setBranding({ ...branding, name: event.target.value })
                }
              />
            </label>
            <label>
              <span>Accent</span>
              <input
                type="color"
                value={branding.accent}
                onChange={(event) =>
                  setBranding({ ...branding, accent: event.target.value })
                }
              />
            </label>
            <label className="wide">
              <span>Tagline</span>
              <input
                required
                maxLength={120}
                value={branding.tagline}
                onChange={(event) =>
                  setBranding({ ...branding, tagline: event.target.value })
                }
              />
            </label>
            <div className="branding-logo-field wide">
              <span>Logo</span>
              <label className={`settings-file-picker ${busy === "logo" ? "uploading" : ""}`}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy === "logo"}
                  onChange={(event) => void uploadLogo(event)}
                />
                <UploadCloud aria-hidden="true" />
                <span>{busy === "logo" ? "Uploading logo…" : "Choose logo file"}</span>
                <small>PNG, JPEG, or WebP · max 2 MB</small>
              </label>
            </div>
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy === "branding"}>
                <Save /> Save branding
              </button>
            </div>
          </form>
        </section>
      )}

      {oidcForm && (
        <section className="settings-card">
          <div className="settings-card-heading">
            <span><Building2 /></span>
            <div>
              <h2>OpenID Connect</h2>
              <p>Authorization Code + PKCE with one-time state and nonce validation.</p>
            </div>
            <span className={`status-badge ${oidcForm.enabled ? "enabled" : ""}`}>
              {oidcForm.enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
          <form className="email-form" onSubmit={saveOidc}>
            <label className="checkbox-label wide">
              <input
                type="checkbox"
                checked={oidcForm.enabled}
                onChange={(event) =>
                  setOidcForm({ ...oidcForm, enabled: event.target.checked })
                }
              />
              <span>Enable single sign-on</span>
            </label>
            <label>
              <span>Button label</span>
              <input
                required
                value={oidcForm.label}
                onChange={(event) =>
                  setOidcForm({ ...oidcForm, label: event.target.value })
                }
              />
            </label>
            <label className="wide">
              <span>Issuer URL</span>
              <input
                type="url"
                required
                value={oidcForm.issuer}
                onChange={(event) =>
                  setOidcForm({ ...oidcForm, issuer: event.target.value })
                }
              />
            </label>
            <label>
              <span>Client ID</span>
              <input
                required
                value={oidcForm.clientId}
                onChange={(event) =>
                  setOidcForm({ ...oidcForm, clientId: event.target.value })
                }
              />
            </label>
            <label>
              <span>Client secret</span>
              <input
                type="password"
                value={oidcForm.clientSecret}
                placeholder={
                  oidcForm.clientSecretConfigured
                    ? "Saved — leave blank to keep"
                    : "Required"
                }
                onChange={(event) =>
                  setOidcForm({ ...oidcForm, clientSecret: event.target.value })
                }
              />
            </label>
            <label className="checkbox-label wide">
              <input
                type="checkbox"
                checked={oidcForm.allowRegistration}
                onChange={(event) =>
                  setOidcForm({
                    ...oidcForm,
                    allowRegistration: event.target.checked,
                  })
                }
              />
              <span>Allow new users only when the provider asserts a verified email</span>
            </label>
            <div className="settings-callout wide">
              Callback URL:{" "}
              <code>{`${window.location.origin}/api/v1/auth/oidc/callback`}</code>
            </div>
            <div className="settings-actions wide">
              <button className="primary-button compact" disabled={busy === "oidc"}>
                <ShieldCheck /> Discover and save
              </button>
              {oidcForm.enabled && (
                <a className="ghost-button" href="/api/v1/auth/oidc/start?mode=link">
                  <Link2 /> Link this account
                </a>
              )}
            </div>
          </form>
        </section>
      )}

      <section className="settings-card">
        <div className="settings-card-heading">
          <span><UserPlus /></span>
          <div>
            <h2>Invitations</h2>
            <p>Hash-only, expiring links; recipients always choose their own password.</p>
          </div>
          <span className="status-badge enabled">
            {invitations.filter((item) => !item.revoked).length} active
          </span>
        </div>
        <form className="email-form" onSubmit={createInvitation}>
          <label className="wide">
            <span>Bind to email (optional; sends automatically)</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="member@example.com"
            />
          </label>
          <label>
            <span>Expires in hours</span>
            <input
              type="number"
              min="1"
              max="720"
              required
              value={inviteHours}
              onChange={(event) => setInviteHours(event.target.value)}
            />
          </label>
          <label>
            <span>Maximum uses</span>
            <input
              type="number"
              min="1"
              max="100"
              required
              value={inviteUses}
              onChange={(event) => setInviteUses(event.target.value)}
            />
          </label>
          <div className="settings-actions wide">
            <button className="primary-button compact" disabled={busy === "invite"}>
              <UserPlus /> Create invitation
            </button>
          </div>
        </form>
        {latestInvite && (
          <div className="managed-link">
            <Link2 />
            <span>{latestInvite}</span>
            <button type="button" onClick={() => void copy(latestInvite)}>
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
        <div className="users-list compact-list">
          {invitations.slice(0, 10).map((invitation) => (
            <div className="user-row" key={invitation.id}>
              <span className="user-avatar"><KeyRound /></span>
              <span className="user-identity">
                <strong>{invitation.email ?? "Reusable private invitation"}</strong>
                <small>
                  {invitation.useCount}/{invitation.maxUses} used · expires{" "}
                  {new Date(invitation.expiresAt).toLocaleString()}
                </small>
              </span>
              <span className={`status-badge ${!invitation.revoked ? "enabled" : ""}`}>
                {invitation.revoked ? "Revoked" : "Active"}
              </span>
              {!invitation.revoked && (
                <button
                  className="ghost-button compact"
                  type="button"
                  disabled={busy === `invite-${invitation.id}`}
                  onClick={() => void revokeInvitation(invitation.id)}
                >
                  <X /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="settings-card">
        <div className="settings-card-heading">
          <span><ShieldCheck /></span>
          <div>
            <h2>Global share administration</h2>
            <p>Revoke access using aggregate metadata without opening member content.</p>
          </div>
          <span className="status-badge enabled">{globalShares.length} shares</span>
        </div>
        <p className="settings-callout">
          Privacy boundary: this view never receives filenames, titles,
          descriptions, share tokens, previews, or file contents.
        </p>
        <div className="global-share-list">
          {globalShares.slice(0, 50).map((share) => (
            <div className="global-share-row" key={share.id}>
              <span>
                <strong>{share.ownerEmail ?? "Legacy owner"}</strong>
                <small>
                  {share.fileCount} files · {formatBytes(share.totalSize)} ·{" "}
                  {new Date(share.createdAt).toLocaleDateString()}
                </small>
              </span>
              <span className={`status-badge ${share.status === "ready" ? "enabled" : ""}`}>
                {share.status}
              </span>
              {share.status === "ready" && (
                <button
                  type="button"
                  className="danger-button"
                  disabled={busy === `share-${share.id}`}
                  onClick={() => void revokeGlobalShare(share.id)}
                >
                  <X /> Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
      <p className="appearance-note">
        Public identity currently resolves as {publicConfig.name}. Secrets are
        encrypted with the instance key before SQLite storage.
      </p>
    </>
  );
}

function SettingsPage({
  status,
  onLogout,
  onRefresh,
}: {
  status: AuthStatus;
  onLogout: () => void;
  onRefresh: () => void;
}) {
  const [email, setEmail] = useState<EmailForm>({
    host: "",
    port: 587,
    secure: false,
    user: "",
    password: "",
    fromName: "Veyra",
    fromAddress: "",
  });
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [accountPassword, setAccountPassword] = useState("");
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [totpCodeValue, setTotpCodeValue] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const { copied, copy } = useClipboard();

  useEffect(() => {
    if (status.user?.role !== "admin") return;
    void jsonRequest<null | (Omit<EmailForm, "password"> & { passwordConfigured: boolean })>(
      "/api/v1/admin/email",
    )
      .then((value) => {
        if (value) {
          setEmail({ ...value, password: "" });
          setPasswordConfigured(value.passwordConfigured);
        } else if (status.user) {
          setEmail((current) => ({ ...current, fromAddress: status.user!.email }));
        }
      })
      .catch((requestError) => setError(requestError.message));
    void loadUsers();
  }, []);

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const value = await jsonRequest<{ sessions: UserSession[] }>(
        "/api/v1/auth/sessions",
      );
      setSessions(value.sessions);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Sessions could not be loaded.",
      );
    }
  }

  async function revokeSession(session: UserSession) {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/v1/auth/sessions/${session.id}`, { method: "DELETE" });
      setSessions((current) => current.filter((entry) => entry.id !== session.id));
      setMessage("The selected session was signed out remotely.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The session could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function loadUsers() {
    try {
      const value = await jsonRequest<{ users: ManagedUser[] }>(
        "/api/v1/admin/users",
      );
      setUsers(value.users);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Users could not be loaded.",
      );
    }
  }

  async function startTwoFactor(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const value = await jsonRequest<{ secret: string; qrCode: string }>(
        "/api/v1/auth/2fa/setup",
        { method: "POST", body: JSON.stringify({ password: accountPassword }) },
      );
      setSetupData(value);
      setAccountPassword("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "2FA setup failed.");
    } finally { setBusy(false); }
  }

  async function confirmTwoFactor(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const value = await jsonRequest<{ recoveryCodes: string[] }>(
        "/api/v1/auth/2fa/confirm",
        { method: "POST", body: JSON.stringify({ code: totpCodeValue }) },
      );
      setRecoveryCodes(value.recoveryCodes);
      setSetupData(null);
      setTotpCodeValue("");
      onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Code verification failed.");
    } finally { setBusy(false); }
  }

  async function saveEmail(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      const value = await jsonRequest<{ passwordConfigured: boolean }>(
        "/api/v1/admin/email",
        { method: "PUT", body: JSON.stringify(email) },
      );
      setPasswordConfigured(value.passwordConfigured);
      setEmail((current) => ({ ...current, password: "" }));
      setMessage("Email settings saved securely.");
      onRefresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Email settings failed.");
    } finally { setBusy(false); }
  }

  async function testEmail() {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest("/api/v1/admin/email/test", { method: "POST" });
      setMessage(`Test email sent to ${status.user?.email}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Email test failed.");
    } finally { setBusy(false); }
  }

  async function updateRegistration(enabled: boolean) {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest("/api/v1/admin/registration", {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setMessage(
        enabled
          ? "Registration is open. New members must verify their email."
          : "Registration is closed. Existing members can still sign in.",
      );
      onRefresh();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Registration settings could not be changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateUser(user: ManagedUser) {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ disabled: !user.disabled }),
      });
      setMessage(
        user.disabled
          ? `${user.email} can sign in again.`
          : `${user.email} was disabled and all sessions were revoked.`,
      );
      await loadUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The user could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateUserQuota(user: ManagedUser) {
    setBusy(true); setError(""); setMessage("");
    try {
      await jsonRequest(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ quotaBytes: user.quotaBytes }),
      });
      setMessage(`Storage quota updated for ${user.email}.`);
      await loadUsers();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The user quota could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isAdmin = status.user?.role === "admin";

  return (
    <div className="settings-page">
      <Header authenticated onLogout={onLogout} />
      <main className="settings-main">
        <div className="settings-heading"><div><p className="eyebrow">{isAdmin ? "Instance control" : "Account control"}</p><h1>{isAdmin ? "Security & access" : "Account security"}</h1><p>{isAdmin ? "Manage your protection, members, registration, and outbound email." : "Manage the protection of your personal Veyra account."}</p></div><a className="ghost-button" href="/">Back to sharing</a></div>
        {error && <p className="settings-alert error">{error}</p>}
        {message && <p className="settings-alert success">{message}</p>}
        <AppearanceSettings />
        {status.user?.storage && (
          <section className="settings-card">
            <div className="settings-card-heading">
              <span><HardDrive /></span>
              <div>
                <h2>Your storage</h2>
                <p>Committed files and in-progress quota reservations for this account.</p>
              </div>
              <span className="status-badge enabled storage-value-badge">
                {formatBytes(status.user.storage.usedBytes)}
              </span>
            </div>
            <div className="capacity-meter">
              <progress
                value={status.user.storage.usedBytes + status.user.storage.reservedBytes}
                max={
                  status.user.storage.quotaBytes ??
                  Math.max(
                    status.user.storage.usedBytes +
                      status.user.storage.reservedBytes,
                    1,
                  )
                }
              />
              <span>
                {formatBytes(status.user.storage.usedBytes)} stored ·{" "}
                {formatBytes(status.user.storage.reservedBytes)} reserved ·{" "}
                {status.user.storage.quotaBytes === null
                  ? "unlimited quota"
                  : `${formatBytes(status.user.storage.quotaBytes)} quota`}
              </span>
            </div>
          </section>
        )}
        <section className="settings-card">
          <div className="settings-card-heading"><span><Smartphone /></span><div><h2>Two-factor authentication</h2><p>Authenticator codes protect every login to this account.</p></div><span className={`status-badge ${status.user?.twoFactorEnabled ? "enabled" : ""}`}>{status.user?.twoFactorEnabled ? "Enabled" : "Not enabled"}</span></div>
          {recoveryCodes.length > 0 ? (
            <div className="recovery-panel">
              <h3>Save these recovery codes now</h3>
              <p>Each code works once. They will not be shown again.</p>
              <div className="recovery-grid">{recoveryCodes.map((value) => <code key={value}>{value}</code>)}</div>
              <button className="ghost-button" type="button" onClick={() => copy(recoveryCodes.join("\n"))}>{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy all codes"}</button>
            </div>
          ) : setupData ? (
            <form className="two-factor-setup" onSubmit={confirmTwoFactor}>
              <img src={setupData.qrCode} alt="TOTP QR code" />
              <div><h3>Scan with your authenticator</h3><p>Or enter this secret manually:</p><code>{setupData.secret}</code><label><span>Six-digit code</span><input type="text" inputMode="numeric" pattern="[0-9]{6}" required value={totpCodeValue} onChange={(event) => setTotpCodeValue(event.target.value)} placeholder="000000" /></label><button className="primary-button compact" disabled={busy}>Confirm and generate recovery codes</button></div>
            </form>
          ) : status.user?.twoFactorEnabled ? (
            <div className="setting-summary"><ShieldCheck /><span><strong>Two-factor authentication is active</strong><small>{status.user.recoveryCodesRemaining} unused recovery codes remain.</small></span></div>
          ) : (
            <form className="inline-setting-form" onSubmit={startTwoFactor}>
              <label><span>Confirm your account password</span><input type="password" required value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label>
              <button className="primary-button compact" disabled={busy}>Set up authenticator <ArrowRight /></button>
            </form>
          )}
        </section>
        <section className="settings-card">
          <div className="settings-card-heading"><span><Clock3 /></span><div><h2>Active sessions</h2><p>Review sign-ins and remotely sign out sessions you no longer recognize.</p></div><span className="status-badge enabled">{sessions.length} active</span></div>
          <div className="session-list">
            {sessions.map((session) => (
              <div className="session-row" key={session.id}>
                <span className="session-identity"><strong>{session.current ? "This device" : "Signed-in session"}</strong><small>Started {new Date(session.createdAt).toLocaleString()} · expires {new Date(session.expiresAt).toLocaleString()}</small></span>
                {session.current ? <span className="status-badge enabled">Current</span> : <button className="danger-button" type="button" disabled={busy} onClick={() => void revokeSession(session)}><LogOut /> Sign out</button>}
              </div>
            ))}
          </div>
        </section>
        {isAdmin && (
          <>
            <section className="settings-card">
              <div className="settings-card-heading"><span><UserPlus /></span><div><h2>Member registration</h2><p>Control whether new people can create an account on this Veyra instance.</p></div><span className={`status-badge ${status.registrationEnabled ? "enabled" : ""}`}>{status.registrationEnabled ? "Open" : "Closed"}</span></div>
              <div className="registration-control">
                <div><strong>Email verification required</strong><small>Every new member receives a one-time link valid for 24 hours. Registration can only be opened while SMTP is configured.</small></div>
                <button className={status.registrationEnabled ? "danger-button" : "primary-button compact"} type="button" disabled={busy || (!status.emailConfigured && !status.registrationEnabled)} onClick={() => updateRegistration(!status.registrationEnabled)}>{status.registrationEnabled ? <X /> : <UserPlus />}{status.registrationEnabled ? "Close registration" : "Open registration"}</button>
              </div>
            </section>
            <section className="settings-card">
              <div className="settings-card-heading"><span><Mail /></span><div><h2>Outgoing email</h2><p>SMTP is used for verification, password recovery, and share delivery.</p></div><span className={`status-badge ${status.emailConfigured ? "enabled" : ""}`}>{status.emailConfigured ? "Configured" : "Not configured"}</span></div>
              <form className="email-form" onSubmit={saveEmail}>
                <label className="wide"><span>SMTP host</span><input required value={email.host} onChange={(event) => setEmail({ ...email, host: event.target.value })} placeholder="smtp.example.com" /></label>
                <label><span>Port</span><input type="number" required min="1" max="65535" value={email.port} onChange={(event) => setEmail({ ...email, port: Number(event.target.value) })} /></label>
                <label className="checkbox-label"><input type="checkbox" checked={email.secure} onChange={(event) => setEmail({ ...email, secure: event.target.checked, port: event.target.checked && email.port === 587 ? 465 : email.port })} /><span>Implicit TLS (usually port 465)</span></label>
                <label><span>Username</span><input value={email.user} onChange={(event) => setEmail({ ...email, user: event.target.value })} autoComplete="off" /></label>
                <label><span>Password</span><input type="password" value={email.password} onChange={(event) => setEmail({ ...email, password: event.target.value })} placeholder={passwordConfigured ? "Saved — leave blank to keep" : "SMTP password"} autoComplete="new-password" /></label>
                <label><span>Sender name</span><input required value={email.fromName} onChange={(event) => setEmail({ ...email, fromName: event.target.value })} /></label>
                <label><span>Sender address</span><input type="email" required value={email.fromAddress} onChange={(event) => setEmail({ ...email, fromAddress: event.target.value })} /></label>
                <div className="settings-actions wide"><button className="primary-button compact" disabled={busy}><Save /> Save email settings</button><button className="ghost-button" type="button" disabled={busy || !status.emailConfigured} onClick={testEmail}><Mail /> Send test email</button></div>
              </form>
            </section>
            <AdminPlatformSettings />
            <section className="settings-card">
              <div className="settings-card-heading"><span><Users /></span><div><h2>Users</h2><p>Review members, verification, storage, and account access.</p></div><span className="status-badge enabled">{users.filter((user) => !user.disabled).length} active</span></div>
              <div className="users-list">
                {users.map((user) => (
                  <div className="user-row" key={user.id}>
                    <span className="user-avatar">{user.email.slice(0, 1).toUpperCase()}</span>
                    <span className="user-identity"><strong>{user.email}</strong><small>{user.role === "admin" ? "Administrator" : user.emailVerified ? "Verified member" : "Pending verification"} · joined {new Date(user.createdAt).toLocaleDateString()}</small></span>
                    <span className="user-usage"><strong>{user.shareCount}</strong><small>shares · {formatBytes(user.totalSize)}</small></span>
                    <span className={`status-badge ${!user.disabled && user.emailVerified ? "enabled" : ""}`}>{user.disabled ? "Disabled" : user.emailVerified ? "Active" : "Pending"}</span>
                    {user.role === "member" && (
                      <>
                        <label className="user-quota-control">
                          <span>Quota GiB</span>
                          <input
                            type="number"
                            min="1"
                            placeholder="Default"
                            value={
                              user.quotaBytes === null
                                ? ""
                                : Math.round(user.quotaBytes / 1024 ** 3)
                            }
                            onChange={(event) =>
                              setUsers((current) =>
                                current.map((entry) =>
                                  entry.id === user.id
                                    ? {
                                        ...entry,
                                        quotaBytes: event.target.value
                                          ? Number(event.target.value) * 1024 ** 3
                                          : null,
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          className="ghost-button compact"
                          type="button"
                          disabled={busy}
                          onClick={() => void updateUserQuota(user)}
                        >
                          <Save /> Quota
                        </button>
                        <button className="ghost-button compact" type="button" disabled={busy} onClick={() => updateUser(user)}>{user.disabled ? <ShieldCheck /> : <X />}{user.disabled ? "Enable" : "Disable"}</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ReverseSharePage({ token }: { token: string }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [details, setDetails] = useState<ReverseShareDetails | null>(null);
  const [files, setFiles] = useState<SelectedUploadFile[]>([]);
  const [password, setPassword] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [message, setMessage] = useState("");
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [activeSession, setActiveSession] =
    useState<UploadSessionResponse | null>(null);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState("");
  const branding = usePublicConfig();
  const storageKey = `veyra.reverse-upload.${token}`;
  const totalSize = useMemo(
    () => files.reduce((sum, entry) => sum + entry.file.size, 0),
    [files],
  );

  async function load() {
    setLoading(true);
    try {
      const value = await jsonRequest<ReverseShareDetails>(
        `/api/v1/reverse/${encodeURIComponent(token)}`,
      );
      setDetails(value);
      setError("");
    } catch (requestError) {
      setDetails(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : "This upload request could not be opened.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  function storedSession(): UploadSessionResponse | null {
    try {
      const stored = JSON.parse(
        sessionStorage.getItem(storageKey) ?? "null",
      ) as
        | {
            fingerprint: string;
            session: UploadSessionResponse;
          }
        | null;
      if (
        stored?.fingerprint === fileFingerprint(files) &&
        new Date(stored.session.expiresAt).getTime() > Date.now()
      ) {
        return stored.session;
      }
    } catch {
      sessionStorage.removeItem(storageKey);
    }
    return null;
  }

  function discardPendingSession() {
    const session = activeSession ?? storedSession();
    if (session) {
      void fetch(`/api/v1/reverse-uploads/${session.id}`, {
        method: "DELETE",
        headers: session.uploadToken
          ? { "Upload-Token": session.uploadToken }
          : undefined,
      });
    }
    setActiveSession(null);
    sessionStorage.removeItem(storageKey);
  }

  function addFiles(incoming: SelectedUploadFile[]) {
    if (!details || incoming.length === 0) return;
    discardPendingSession();
    const unique = new Map(
      [...files, ...incoming].map((entry) => [
        `${entry.relativePath}\u0000${entry.file.size}\u0000${entry.file.lastModified}`,
        entry,
      ]),
    );
    const selected = [...unique.values()];
    const overLimit = selected.length > details.maxFiles;
    setFiles(selected.slice(0, details.maxFiles));
    setError(
      overLimit
        ? `This request accepts at most ${details.maxFiles} files.`
        : "",
    );
  }

  function removeFile(index: number) {
    discardPendingSession();
    setFiles((current) =>
      current.filter((_, fileIndex) => fileIndex !== index),
    );
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    try {
      addFiles(await fromDataTransfer(event.dataTransfer));
    } catch {
      setError("This folder could not be read by the browser.");
    }
  }

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    try {
      await jsonRequest(
        `/api/v1/reverse/${encodeURIComponent(token)}/unlock`,
        {
          method: "POST",
          body: JSON.stringify({ password }),
        },
      );
      await load();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The upload request could not be unlocked.",
      );
    } finally {
      setUnlocking(false);
    }
  }

  async function createOrResumeSession(): Promise<UploadSessionResponse> {
    const pending = activeSession ?? storedSession();
    if (pending) {
      setActiveSession(pending);
      return pending;
    }
    const session = await jsonRequest<UploadSessionResponse>(
      `/api/v1/reverse/${encodeURIComponent(token)}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({
          files: files.map(({ file, relativePath }) => ({
            name: file.name,
            relativePath,
            type: file.type || "application/octet-stream",
            size: file.size,
          })),
          senderName: senderName || undefined,
          senderEmail: senderEmail || undefined,
          message: message || undefined,
        }),
      },
    );
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ fingerprint: fileFingerprint(files), session }),
    );
    setActiveSession(session);
    return session;
  }

  async function submit() {
    if (!details || files.length === 0) {
      setError("Choose at least one file.");
      return;
    }
    if (totalSize > details.maxTotalSize) {
      setError(
        `This submission exceeds the ${formatBytes(details.maxTotalSize)} limit.`,
      );
      return;
    }
    setUploading(true);
    setProgress(null);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const session = await createOrResumeSession();
      await uploadResumably<{ received: true; scanStatus: "clean" | "disabled" }>({
        files,
        session,
        apiRoot: "/api/v1/reverse-uploads",
        completePath: `/api/v1/reverse-uploads/${session.id}/complete`,
        signal: controller.signal,
        onProgress: setProgress,
      });
      sessionStorage.removeItem(storageKey);
      setActiveSession(null);
      setCompleted(true);
    } catch (requestError) {
      if (
        requestError instanceof DOMException &&
        requestError.name === "AbortError"
      ) {
        setError("Upload paused. Press Resume when you are ready.");
      } else {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "The files could not be submitted.",
        );
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="share-page reverse-page">
      <Header />
      <main className="share-main">
        {loading ? (
          <div className="share-card centered">
            <span className="large-spinner" />
            <p>Opening private upload channel…</p>
          </div>
        ) : error && !details ? (
          <div className="share-card centered">
            <span className="share-state-icon error-state"><X /></span>
            <h1>Request unavailable</h1>
            <p>{error}</p>
          </div>
        ) : details && !details.unlocked ? (
          <form className="share-card unlock-card" onSubmit={unlock}>
            <span className="share-state-icon"><LockKeyhole /></span>
            <p className="eyebrow">Protected upload request</p>
            <h1>A password opens this inbox.</h1>
            <p>The recipient protected this request with an extra access layer.</p>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={unlocking}>
              {unlocking ? "Checking…" : "Unlock request"} <ArrowRight />
            </button>
          </form>
        ) : completed ? (
          <section className="share-card centered reverse-success">
            <span className="share-state-icon"><Check /></span>
            <p className="eyebrow">Submission received</p>
            <h1>Your files arrived safely.</h1>
            <p>
              They are private to the request owner and were finalized only
              after the configured security scan.
            </p>
            <button
              className="ghost-button"
              type="button"
              onClick={() => {
                setFiles([]);
                setProgress(null);
                setCompleted(false);
                setSenderName("");
                setSenderEmail("");
                setMessage("");
              }}
            >
              <RotateCcw /> Send another submission
            </button>
          </section>
        ) : details ? (
          <section className="share-card reverse-upload-card">
            <div className="download-heading">
              <span className="share-state-icon"><UploadCloud /></span>
              <div>
                <p className="eyebrow">Private upload request</p>
                <h1>{details.title || "Send files securely."}</h1>
                <p>
                  Up to {details.maxFiles} files ·{" "}
                  {formatBytes(details.maxTotalSize)} per submission
                  {details.expiresAt
                    ? ` · closes ${new Date(details.expiresAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
            </div>
            {details.description && <blockquote>{details.description}</blockquote>}

            <div
              className={`reverse-drop-zone ${dragging ? "dragging" : ""}`}
              onDragEnter={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => void onDrop(event)}
            >
              <input
                ref={fileInputRef}
                className="folder-input"
                type="file"
                multiple
                onChange={(event) => {
                  if (event.target.files) addFiles(fromFileList(event.target.files));
                  event.target.value = "";
                }}
              />
              <input
                ref={(node) => {
                  folderInputRef.current = node;
                  node?.setAttribute("webkitdirectory", "");
                  node?.setAttribute("directory", "");
                }}
                className="folder-input"
                type="file"
                multiple
                onChange={(event) => {
                  if (event.target.files) addFiles(fromFileList(event.target.files));
                  event.target.value = "";
                }}
              />
              <UploadCloud />
              <strong>Drop files or folders here</strong>
              <span>Folder structure is preserved.</span>
              <div className="drop-choices">
                <button type="button" onClick={() => fileInputRef.current?.click()}>
                  <Plus /> Choose files
                </button>
                <button type="button" onClick={() => folderInputRef.current?.click()}>
                  <FolderOpen /> Choose folder
                </button>
              </div>
            </div>

            {files.length > 0 && (
              <div className="download-list reverse-file-list">
                {files.map(({ file, relativePath }, index) => (
                  <div className="download-row" key={`${relativePath}-${file.size}`}>
                    <span className="file-icon">{fileIcon(file.type)}</span>
                    <span className="file-name">
                      <strong>{file.name}</strong>
                      <small>
                        {relativePath !== file.name ? `${relativePath} · ` : ""}
                        {formatBytes(file.size)}
                      </small>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
                      <X />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="share-details-grid reverse-sender-fields">
              <label>
                <span><Users /> Your name</span>
                <input
                  maxLength={100}
                  value={senderName}
                  onChange={(event) => setSenderName(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label>
                <span><AtSign /> Your email</span>
                <input
                  type="email"
                  maxLength={254}
                  value={senderEmail}
                  onChange={(event) => setSenderEmail(event.target.value)}
                  placeholder="Optional"
                />
              </label>
              <label className="wide">
                <span><FileText /> Message</span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Optional context for the recipient"
                />
              </label>
            </div>

            {error && <p className="form-error">{error}</p>}
            {uploading && (
              <div className="upload-progress" aria-live="polite">
                <div>
                  <span>
                    {progress?.stage === "scanning"
                      ? "Scanning submission…"
                      : progress?.stage === "finalizing"
                        ? "Delivering privately…"
                        : "Uploading resumably…"}
                  </span>
                  <strong>{progress?.percent ?? 0}%</strong>
                </div>
                <progress value={progress?.percent ?? 0} max="100" />
                {progress?.stage === "uploading" && (
                  <small>
                    {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
                    {progress.bytesPerSecond > 0
                      ? ` · ${formatBytes(progress.bytesPerSecond)}/s`
                      : ""}
                    {progress.etaSeconds !== null
                      ? ` · ${formatDuration(progress.etaSeconds)} remaining`
                      : ""}
                  </small>
                )}
                <button
                  className="ghost-button compact"
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                >
                  Pause
                </button>
              </div>
            )}
            <button
              className="primary-button send-button"
              type="button"
              disabled={uploading || files.length === 0}
              onClick={() => void submit()}
            >
              {uploading
                ? "Sending securely…"
                : activeSession
                  ? "Resume submission"
                  : "Send files privately"}{" "}
              {uploading ? <span className="spinner" /> : <ArrowRight />}
            </button>
            <p className="privacy-note">
              <ShieldCheck /> Only the request owner can access the submitted
              content. {branding.name} never exposes it as a public share.
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setStatus(await jsonRequest<AuthStatus>("/api/v1/auth/status"));
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Authentication status failed.");
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function logout() {
    await jsonRequest("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  if (error) return <AuthLayout eyebrow="Connection error" title="Veyra could not start." description={error}><a className="primary-button" href="/">Try again</a></AuthLayout>;
  if (!status) return <div className="full-loader"><span className="large-spinner" /><p>Securing your workspace…</p></div>;
  if (status.setupRequired) return <SetupPage onDone={refresh} />;
  if (!status.authenticated) {
    return (
      <LoginPage
        onDone={refresh}
        registrationEnabled={status.registrationEnabled}
      />
    );
  }
  if (window.location.pathname === "/settings") return <SettingsPage status={status} onLogout={logout} onRefresh={refresh} />;
  if (window.location.pathname === "/shares") return <MySharesPage onLogout={logout} />;
  if (window.location.pathname === "/requests") return <UploadRequestsPage onLogout={logout} />;
  if (window.location.pathname === "/inbox") return <SubmissionsPage onLogout={logout} />;
  return <HomePage onLogout={logout} />;
}

function SharePage({ token }: { token: string }) {
  const [details, setDetails] = useState<ShareDetails | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [unlocking, setUnlocking] = useState(false);
  const [preview, setPreview] = useState<SharedFile | null>(null);
  const [showQr, setShowQr] = useState(false);
  const { copied, copy } = useClipboard();
  const branding = usePublicConfig();

  async function loadShare() {
    setLoading(true);
    const response = await fetch(`/api/v1/shares/${encodeURIComponent(token)}`);
    const payload = (await response.json()) as ShareDetails & ApiError;
    setLoading(false);
    if (!response.ok) {
      setError(payload.message ?? "This share could not be opened.");
      return;
    }
    setDetails(payload);
    setError("");
  }

  useEffect(() => {
    void loadShare();
  }, [token]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setUnlocking(true);
    setError("");
    const response = await fetch(`/api/v1/shares/${encodeURIComponent(token)}/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = (await response.json()) as ApiError;
    setUnlocking(false);
    if (!response.ok) {
      setError(payload.message ?? "This share could not be unlocked.");
      return;
    }
    await loadShare();
  }

  return (
    <div className="share-page">
      <Header />
      <main className="share-main">
        {loading ? (
          <div className="share-card centered">
            <span className="large-spinner" />
            <p>Opening secure channel…</p>
          </div>
        ) : error && !details ? (
          <div className="share-card centered">
            <span className="share-state-icon error-state"><X /></span>
            <h1>Link unavailable</h1>
            <p>{error}</p>
            <a className="primary-button compact" href="/">Create a new share</a>
          </div>
        ) : details && !details.unlocked ? (
          <form className="share-card unlock-card" onSubmit={unlock}>
            <span className="share-state-icon"><LockKeyhole /></span>
            <p className="eyebrow">Protected share</p>
            <h1>A password opens this link.</h1>
            <p>The sender added an extra layer of privacy.</p>
            <label>
              <span>Password</span>
              <input
                type="password"
                autoFocus
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter share password"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" disabled={unlocking}>
              {unlocking ? "Checking…" : "Unlock files"} <ArrowRight />
            </button>
          </form>
        ) : details ? (
          <section className="share-card download-card">
            <div className="download-heading">
              <span className="share-state-icon"><ArrowDownToLine /></span>
              <div>
                <p className="eyebrow">Secure delivery</p>
                <h1>{details.title || "Your files are ready."}</h1>
                <p>
                  {details.files.length} {details.files.length === 1 ? "file" : "files"}
                  {details.expiresAt
                    ? ` · expires ${new Date(details.expiresAt).toLocaleDateString()}`
                    : " · no expiry"}
                </p>
              </div>
            </div>
            {details.description && <blockquote>{details.description}</blockquote>}
            <div className="public-share-actions">
              {details.downloadAllUrl && details.files.length > 1 && (
                <a className="primary-button compact" href={details.downloadAllUrl}>
                  <DownloadCloud /> Download all
                </a>
              )}
              <button
                className="ghost-button compact"
                type="button"
                onClick={() => setShowQr((value) => !value)}
              >
                <QrCode /> {showQr ? "Hide QR" : "Show QR"}
              </button>
            </div>
            {showQr && (
              <div className="qr-panel">
                <img src={details.qrUrl} alt="QR code for this share" />
                <small>Scan to open this secure share.</small>
              </div>
            )}
            <div className="download-list">
              {details.files.map((file) => (
                <div className="download-row" key={file.id}>
                  <span className="file-icon">{fileIcon(file.type)}</span>
                  <span className="file-name">
                    <strong>{file.name}</strong>
                    <small>
                      {file.relativePath
                        ? `${file.relativePath} · `
                        : ""}
                      {formatBytes(file.size)} · SHA-256 recorded
                    </small>
                  </span>
                  <span className="download-row-actions">
                    {file.previewable && file.previewUrl && (
                      <button
                        type="button"
                        onClick={() => setPreview(file)}
                        aria-label={`Preview ${file.name}`}
                      >
                        <Eye />
                      </button>
                    )}
                    {file.directUrl && (
                      <button
                        type="button"
                        onClick={() =>
                          void copy(
                            new URL(file.directUrl!, window.location.origin).toString(),
                          )
                        }
                        aria-label={`Copy direct link for ${file.name}`}
                      >
                        {copied ? <Check /> : <Copy />}
                      </button>
                    )}
                    <a
                      href={
                        file.directUrl ??
                        `/api/v1/shares/${encodeURIComponent(token)}/files/${file.id}`
                      }
                      aria-label={`Download ${file.name}`}
                    >
                      <ArrowDownToLine />
                    </a>
                  </span>
                </div>
              ))}
            </div>
            <div className="share-trust">
              <ShieldCheck />
              <span>
                <strong>Delivered privately by {branding.name}</strong>
                <small>
                  The recorded SHA-256 fingerprints can be used for an
                  independent integrity check.
                </small>
              </span>
            </div>
            {preview?.previewUrl && (
              <div
                className="preview-backdrop"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setPreview(null);
                }}
              >
                <section
                  className="preview-dialog"
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Preview ${preview.name}`}
                >
                  <header>
                    <span>
                      {fileIcon(preview.type)}
                      <span>
                        <strong>{preview.name}</strong>
                        <small>{formatBytes(preview.size)}</small>
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      aria-label="Close preview"
                    >
                      <X />
                    </button>
                  </header>
                  <div className="preview-content">
                    {preview.type.startsWith("image/") ? (
                      <img src={preview.previewUrl} alt={preview.name} />
                    ) : preview.type.startsWith("video/") ? (
                      <video src={preview.previewUrl} controls autoPlay={false} />
                    ) : preview.type.startsWith("audio/") ? (
                      <audio src={preview.previewUrl} controls />
                    ) : (
                      <iframe
                        src={preview.previewUrl}
                        title={`Preview ${preview.name}`}
                        sandbox=""
                      />
                    )}
                  </div>
                  <footer>
                    <a className="primary-button compact" href={preview.directUrl ?? undefined}>
                      <ArrowDownToLine /> Download file
                    </a>
                  </footer>
                </section>
              </div>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function AppRoutes() {
  const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
  if (match?.[1]) return <SharePage token={decodeURIComponent(match[1])} />;
  const reverseMatch = window.location.pathname.match(/^\/r\/([^/]+)$/);
  if (reverseMatch?.[1]) {
    return <ReverseSharePage token={decodeURIComponent(reverseMatch[1])} />;
  }
  if (window.location.pathname === "/reset-password") return <ResetPasswordPage />;
  if (window.location.pathname === "/verify-email") return <VerifyEmailPage />;
  return <AuthenticatedApp />;
}

export function App() {
  return (
    <PublicConfigProvider>
      <AppRoutes />
    </PublicConfigProvider>
  );
}
