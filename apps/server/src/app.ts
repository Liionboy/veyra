import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import * as archiverModule from "archiver";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, {
  LogController,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import * as oidc from "openid-client";
import QRCode from "qrcode";
import sharp from "sharp";
import { z } from "zod";
import { testAntivirus } from "./antivirus.js";
import {
  createLoginChallenge,
  createRecoveryCodes,
  createTotpSecret,
  decryptValue,
  encryptValue,
  hashRecoveryCode,
  verifyLoginChallenge,
  verifyTotp,
} from "./auth.js";
import { config } from "./config.js";
import {
  type FileRecord,
  type ReverseShareRecord,
  type StoredObjectReference,
  type SubmissionFileRecord,
  type UploadSessionRecord,
  type UserRecord,
  VeyraDatabase,
} from "./database.js";
import {
  type EmailSettings,
  sendEmailVerification,
  sendInvitationEmail,
  sendPasswordReset,
  sendReverseSubmissionEmail,
  sendShareEmail,
  sendTestEmail,
  verifyEmailSettings,
} from "./email.js";
import {
  anonymizeIp,
  createAccessGrant,
  createPublicToken,
  hashPassword,
  hashToken,
  verifyAccessGrant,
  verifyPassword,
} from "./security.js";
import {
  archivePath,
  contentDisposition,
  parseByteRange,
  StorageManager,
} from "./storage.js";
import {
  antivirusSettingsSchema,
  brandingSettingsSchema,
  capacityPolicySchema,
  loadAntivirusSettings,
  loadBrandingSettings,
  loadCapacityPolicy,
  loadOidcSettings,
  loadStorageSettings,
  oidcSettingsForAdmin,
  oidcSettingsSchema,
  saveAntivirusSettings,
  saveBrandingSettings,
  saveCapacityPolicy,
  saveOidcSettings,
  saveStorageSettings,
  storageSettingsForAdmin,
  storageSettingsSchema,
} from "./settings.js";
import {
  reverseUploadManifestSchema,
  uploadManifestSchema,
  UploadService,
} from "./uploads.js";

interface ZipArchiveStream extends Readable {
  append(
    source: Readable,
    data: { name: string; date?: Date },
  ): this;
  finalize(): Promise<void>;
}

const ZipArchive = (
  archiverModule as unknown as {
    ZipArchive: new (options: {
      zlib?: { level: number };
      forceZip64?: boolean;
    }) => ZipArchiveStream;
  }
).ZipArchive;

const unlockSchema = z.object({
  password: z.string().min(1).max(256),
});

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(256),
});

const verificationTokenSchema = z.object({
  token: z.string().min(32).max(200),
});

const registrationSettingsSchema = z.object({
  enabled: z.boolean(),
});

const managedUserParamsSchema = z.object({
  id: z.string().uuid(),
});

const managedUserStatusSchema = z.object({
  disabled: z.boolean().optional(),
  quotaBytes: z.number().int().positive().nullable().optional(),
});

const invitationRegisterSchema = credentialsSchema.extend({
  invitationToken: z.string().min(32).max(200),
});

const invitationSchema = z.object({
  email: z.string().email().max(254).nullable().default(null),
  expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  maxUses: z.number().int().min(1).max(100).default(1),
  sendEmail: z.boolean().default(false),
});

const invitationParamsSchema = z.object({
  id: z.string().uuid(),
});

const reverseShareSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(1_000).optional(),
  password: z.string().min(8).max(256).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 365).nullable().default(168),
  maxFiles: z.number().int().min(1).max(2_000).default(100),
  maxTotalSize: z.number().int().positive(),
  maxSubmissions: z.number().int().min(1).max(10_000).default(100),
});

const reverseShareParamsSchema = z.object({
  id: z.string().uuid(),
});

const reversePublicParamsSchema = z.object({
  token: z.string().min(20).max(100),
});

const uploadParamsSchema = z.object({
  uploadId: z.string().uuid(),
});

const uploadFileParamsSchema = z.object({
  uploadId: z.string().uuid(),
  fileId: z.string().uuid(),
});

const uploadCompletionSchema = z
  .object({
    includePasswordInEmail: z.boolean().default(false),
    password: z.string().min(8).max(256).optional(),
  })
  .superRefine((value, context) => {
    if (value.includePasswordInEmail && !value.password) {
      context.addIssue({
        code: "custom",
        path: ["password"],
        message: "Enter the share password to include it in the email.",
      });
    }
  });

const globalShareParamsSchema = z.object({
  id: z.string().uuid(),
});

const dailyShareEmailLimit = 100;

const loginSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(256),
});

const twoFactorLoginSchema = z.object({
  challenge: z.string().min(20).max(2048),
  code: z.string().min(6).max(32),
});

const passwordSchema = z.object({
  password: z.string().min(1).max(256),
});

const totpConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

const twoFactorDisableSchema = z.object({
  password: z.string().min(1).max(256),
  code: z.string().min(6).max(32),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(254),
});

const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(12).max(256),
});

const emailSettingsSchema = z.object({
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().max(254).default(""),
  password: z.string().max(1024).default(""),
  fromName: z.string().min(1).max(100),
  fromAddress: z.string().email().max(254),
});

const managedShareParamsSchema = z.object({
  id: z.string().uuid(),
});

const updateManagedShareSchema = z.object({
  expiresInHours: z.number().int().min(1).max(24 * 365).nullable(),
  maxDownloads: z.number().int().min(1).max(1_000_000).nullable(),
  title: z.string().max(100).nullable(),
  description: z.string().max(1_000).nullable(),
  recipientEmail: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .nullable(),
  password: z.string().min(8).max(256).nullable().optional(),
});

function publicFile(file: FileRecord) {
  return {
    id: file.id,
    name: file.original_name,
    type: file.mime_type,
    size: file.size,
    sha256: file.sha256,
    relativePath: file.relative_path,
    previewable: isPreviewable(file.mime_type),
  };
}

const previewMimeTypes = new Set([
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/json",
]);

function isPreviewable(mimeType: string): boolean {
  return (
    (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/") ||
    previewMimeTypes.has(mimeType)
  );
}

function isExpired(expiresAt: number | null): boolean {
  return expiresAt !== null && expiresAt <= Date.now();
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([cookieName]) => cookieName === name);
  return cookie?.[1] ? decodeURIComponent(cookie[1]) : undefined;
}

function readGrant(request: FastifyRequest): string | undefined {
  const value = request.headers["x-veyra-grant"];
  const headerGrant = Array.isArray(value) ? value[0] : value;
  if (headerGrant) return headerGrant;
  return readCookie(request, "veyra_grant");
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export interface AppDependencies {
  sendShareEmail?: typeof sendShareEmail;
}

export function buildApp(dependencies: AppDependencies = {}) {
  const deliverShareEmail = dependencies.sendShareEmail ?? sendShareEmail;
  const app = Fastify({
    logger:
      config.NODE_ENV === "test"
        ? false
        : config.NODE_ENV === "development"
        ? { transport: { target: "pino-pretty" } }
        : true,
    trustProxy: config.VEYRA_TRUST_PROXY,
    bodyLimit: 1024 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  const database = new VeyraDatabase(join(config.dataDir, "veyra.db"));
  const storage = new StorageManager(config.dataDir, () =>
    loadStorageSettings(database),
  );
  const uploadService = new UploadService(database, storage);
  const webRoot = resolve(import.meta.dirname, "../../web/dist");
  const dummyPasswordPromise = hashPassword(createPublicToken());
  let oidcCache:
    | {
        fingerprint: string;
        configuration: oidc.Configuration;
      }
    | undefined;

  async function oidcConfiguration() {
    const settings = loadOidcSettings(database);
    if (!settings.enabled || !settings.clientId || !settings.clientSecret) {
      throw httpError(409, "OIDC is not configured.");
    }
    const fingerprint = JSON.stringify([
      settings.issuer,
      settings.clientId,
      settings.clientSecret,
    ]);
    if (oidcCache?.fingerprint === fingerprint) {
      return { settings, configuration: oidcCache.configuration };
    }
    const configuration = await oidc.discovery(
      new URL(settings.issuer),
      settings.clientId,
      settings.clientSecret,
    );
    oidcCache = { fingerprint, configuration };
    return { settings, configuration };
  }

  async function removeStoredObjects(
    objects: StoredObjectReference[],
  ): Promise<void> {
    database.queueObjectDeletions(objects);
    await processObjectDeletions();
  }

  async function processObjectDeletions(): Promise<void> {
    for (const object of database.listPendingObjectDeletions(100)) {
      try {
        await storage.remove(object.storage_provider, object.stored_name);
        database.completeObjectDeletion(
          object.storage_provider,
          object.stored_name,
        );
      } catch (error) {
        database.failObjectDeletion(
          object.storage_provider,
          object.stored_name,
          error instanceof Error ? error.message : "Object deletion failed.",
        );
        app.log.error(
          { err: error, storageKey: object.stored_name },
          "Stored object deletion failed",
        );
      }
    }
  }

  function authenticatedUser(request: FastifyRequest): UserRecord | undefined {
    const token = readCookie(request, "veyra_session");
    return token ? database.findUserForSession(hashToken(token)) : undefined;
  }

  function adminUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ): UserRecord | undefined {
    const user = authenticatedUser(request);
    if (!user) {
      void reply.code(401).send({ message: "Authentication required." });
      return undefined;
    }
    if (user.role !== "admin") {
      void reply.code(403).send({ message: "Administrator access required." });
      return undefined;
    }
    return user;
  }

  function issueSession(userId: string, reply: FastifyReply): void {
    const token = createPublicToken();
    const maxAge = 7 * 24 * 60 * 60;
    database.createSession({
      token_hash: hashToken(token),
      user_id: userId,
      created_at: Date.now(),
      expires_at: Date.now() + maxAge * 1000,
    });
    reply.header(
      "Set-Cookie",
      [
        `veyra_session=${encodeURIComponent(token)}`,
        "Path=/",
        `Max-Age=${maxAge}`,
        "HttpOnly",
        "SameSite=Strict",
        config.VEYRA_SECURE_COOKIES ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  function clearSession(request: FastifyRequest, reply: FastifyReply): void {
    const token = readCookie(request, "veyra_session");
    if (token) database.deleteSession(hashToken(token));
    reply.header(
      "Set-Cookie",
      [
        "veyra_session=",
        "Path=/",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Strict",
        config.VEYRA_SECURE_COOKIES ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  interface StoredEmailSettings
    extends Omit<EmailSettings, "password"> {
    passwordEncrypted: string;
  }

  function loadEmailSettings(): EmailSettings | undefined {
    const raw = database.getSetting("email.smtp");
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as StoredEmailSettings;
    return {
      host: stored.host,
      port: stored.port,
      secure: stored.secure,
      user: stored.user,
      password: stored.passwordEncrypted
        ? decryptValue(stored.passwordEncrypted, config.secret)
        : "",
      fromName: stored.fromName,
      fromAddress: stored.fromAddress,
    };
  }

  function registrationEnabled(): boolean {
    return (
      database.getSetting("auth.registration_enabled") === "true" &&
      Boolean(loadEmailSettings())
    );
  }

  function verificationUrl(token: string): string {
    const url = new URL("/verify-email", config.VEYRA_BASE_URL);
    url.searchParams.set("token", token);
    return url.toString();
  }

  async function purgeExpiredShares() {
    const expiredFiles = database.deleteExpired();
    database.purgeExpiredSecurityData();
    await removeStoredObjects(expiredFiles);
    const abandonedUploads = await uploadService.purgeExpired();
    await processObjectDeletions();
    if (expiredFiles.length > 0) {
      app.log.info({ fileCount: expiredFiles.length }, "Expired shares purged");
    }
    if (abandonedUploads > 0) {
      app.log.info(
        { fileCount: abandonedUploads },
        "Abandoned uploads purged",
      );
    }
  }

  const runCleanup = () => {
    void purgeExpiredShares().catch((error) => {
      app.log.error({ err: error }, "Scheduled cleanup failed");
    });
  };
  runCleanup();
  const cleanupTimer = setInterval(runCleanup, 60 * 60 * 1000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(cleanupTimer);
    database.close();
  });

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.VEYRA_SECURE_COOKIES
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  });

  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
    ban: 3,
  });

  app.register(multipart, {
    limits: {
      fileSize: config.VEYRA_MAX_FILE_SIZE,
      files: config.VEYRA_MAX_FILES_PER_SHARE,
      fields: 5,
      parts: config.VEYRA_MAX_FILES_PER_SHARE + 5,
    },
  });

  app.addContentTypeParser(
    "application/offset+octet-stream",
    (request, payload, done) => {
      done(null, payload);
    },
  );

  app.get("/api/health", async () => ({
    status: "ok",
    service: "veyra",
    version: "1.1.0",
  }));

  app.get("/api/v1/public/config", async () => {
    const branding = loadBrandingSettings(database);
    const policy = loadCapacityPolicy(database);
    const oidcSettings = loadOidcSettings(database);
    return {
      name: branding.name,
      tagline: branding.tagline,
      accent: branding.accent,
      logoUrl:
        branding.logoVersion > 0
          ? `/api/v1/public/logo?v=${branding.logoVersion}`
          : null,
      limits: {
        maxFileBytes: config.VEYRA_MAX_FILE_SIZE,
        maxShareBytes: policy.maxShareBytes,
        maxFilesPerShare: policy.maxFilesPerShare,
        chunkBytes: config.VEYRA_UPLOAD_CHUNK_SIZE,
      },
      oidc: oidcSettings.enabled
        ? { enabled: true, label: oidcSettings.label }
        : { enabled: false, label: null },
      version: "1.1.0",
    };
  });

  app.get("/api/v1/public/logo", async (_request, reply) => {
    const path = join(config.dataDir, "branding", "logo.webp");
    if (!existsSync(path)) return reply.code(404).send({ message: "Logo not found." });
    reply.header("Content-Type", "image/webp");
    reply.header("Cache-Control", "public, max-age=86400, immutable");
    return reply.send(createReadStream(path));
  });

  app.get("/api/v1/auth/status", async (request) => {
    const user = authenticatedUser(request);
    const capacity = user ? database.capacityUsage(user.id) : null;
    const policy = loadCapacityPolicy(database);
    const oidcSettings = loadOidcSettings(database);
    return {
      setupRequired: database.userCount() === 0,
      authenticated: Boolean(user),
      user: user
        ? {
          email: user.email,
          role: user.role,
          emailVerified: user.email_verified_at !== null,
            twoFactorEnabled: user.totp_enabled === 1,
            recoveryCodesRemaining: database.recoveryCodeCount(user.id),
            storage: capacity
              ? {
                  usedBytes: capacity.committedBytes,
                  reservedBytes: capacity.reservedBytes,
                  quotaBytes:
                    user.quota_bytes ?? policy.defaultUserQuotaBytes,
                }
              : null,
          }
        : null,
      emailConfigured: Boolean(database.getSetting("email.smtp")),
      registrationEnabled: registrationEnabled(),
      oidc: oidcSettings.enabled
        ? { enabled: true, label: oidcSettings.label }
        : { enabled: false, label: null },
    };
  });

  app.get("/api/v1/auth/oidc/start", async (request, reply) => {
    const query = z
      .object({ mode: z.enum(["login", "link"]).default("login") })
      .parse(request.query);
    const currentUser =
      query.mode === "link" ? authenticatedUser(request) : undefined;
    if (query.mode === "link" && !currentUser) {
      return reply.code(401).send({ message: "Authentication required." });
    }
    const { configuration } = await oidcConfiguration();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const redirectUri = new URL(
      "/api/v1/auth/oidc/callback",
      config.VEYRA_BASE_URL,
    ).toString();
    database.createOidcState(
      hashToken(state),
      encryptValue(codeVerifier, config.secret),
      nonce,
      currentUser?.id ?? null,
      query.mode,
      Date.now() + 10 * 60 * 1_000,
    );
    const authorizationUrl = oidc.buildAuthorizationUrl(configuration, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
      nonce,
    });
    reply.header(
      "Set-Cookie",
      [
        `veyra_oidc_state=${encodeURIComponent(state)}`,
        "Path=/api/v1/auth/oidc/callback",
        "Max-Age=600",
        "HttpOnly",
        "SameSite=Lax",
        config.VEYRA_SECURE_COOKIES ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );
    return reply.redirect(authorizationUrl.toString());
  });

  app.get("/api/v1/auth/oidc/callback", async (request, reply) => {
    const query = z
      .object({
        state: z.string().min(20).max(500),
        code: z.string().min(1).max(4_096),
      })
      .passthrough()
      .safeParse(request.query);
    const cookieState = readCookie(request, "veyra_oidc_state");
    if (
      !query.success ||
      !cookieState ||
      hashToken(cookieState) !== hashToken(query.data.state)
    ) {
      return reply.redirect("/?oidc=invalid-state");
    }
    const state = database.consumeOidcState(hashToken(query.data.state));
    if (!state) return reply.redirect("/?oidc=expired-state");

    reply.header(
      "Set-Cookie",
      [
        "veyra_oidc_state=",
        "Path=/api/v1/auth/oidc/callback",
        "Max-Age=0",
        "HttpOnly",
        "SameSite=Lax",
        config.VEYRA_SECURE_COOKIES ? "Secure" : "",
      ]
        .filter(Boolean)
        .join("; "),
    );

    try {
      const { settings, configuration } = await oidcConfiguration();
      const currentUrl = new URL(request.url, config.VEYRA_BASE_URL);
      const tokens = await oidc.authorizationCodeGrant(
        configuration,
        currentUrl,
        {
          pkceCodeVerifier: decryptValue(
            state.code_verifier_encrypted,
            config.secret,
          ),
          expectedState: query.data.state,
          expectedNonce: state.nonce,
          idTokenExpected: true,
        },
      );
      const claims = tokens.claims();
      const subject = claims?.sub;
      if (!subject) throw new Error("The identity provider omitted the subject.");
      const issuer = configuration.serverMetadata().issuer;
      let email =
        typeof claims.email === "string" ? claims.email.toLowerCase() : "";
      let emailVerified = claims.email_verified === true;
      if ((!email || claims.email_verified === undefined) && tokens.access_token) {
        const userInfo = await oidc.fetchUserInfo(
          configuration,
          tokens.access_token,
          subject,
        );
        if (!email && typeof userInfo.email === "string") {
          email = userInfo.email.toLowerCase();
        }
        if (userInfo.email_verified === true) emailVerified = true;
      }

      if (state.mode === "link") {
        const user = state.user_id
          ? database.findUserById(state.user_id)
          : undefined;
        if (!user || user.disabled_at !== null) {
          return reply.redirect("/settings?oidc=link-failed");
        }
        const linked = database.linkOidcIdentity(user.id, {
          issuer,
          subject,
          user_id: user.id,
          email: email || user.email,
          created_at: Date.now(),
        });
        return reply.redirect(
          linked
            ? "/settings?oidc=linked"
            : "/settings?oidc=already-linked",
        );
      }

      let user = database.findUserByOidcIdentity(issuer, subject);
      if (!user) {
        if (!settings.allowRegistration || !email || !emailVerified) {
          return reply.redirect("/?oidc=registration-not-allowed");
        }
        if (database.findUserByEmail(email)) {
          return reply.redirect("/?oidc=link-required");
        }
        const randomPassword = await hashPassword(createPublicToken());
        const now = Date.now();
        const created: UserRecord = {
          id: randomUUID(),
          email,
          password_hash: randomPassword.hash,
          password_salt: randomPassword.salt,
          totp_secret: null,
          totp_enabled: 0,
          role: "member",
          email_verified_at: now,
          disabled_at: null,
          quota_bytes: null,
          created_at: now,
        };
        const success = database.createOidcUser(created, {
          issuer,
          subject,
          user_id: created.id,
          email,
          created_at: now,
        });
        if (!success) return reply.redirect("/?oidc=link-required");
        user = created;
      }
      if (user.disabled_at !== null) {
        return reply.redirect("/?oidc=account-disabled");
      }
      issueSession(user.id, reply);
      database.audit(
        null,
        "auth.oidc_login_succeeded",
        anonymizeIp(request.ip, config.ipSalt),
        { userId: user.id, issuer },
      );
      return reply.redirect("/");
    } catch (error) {
      request.log.warn({ err: error }, "OIDC callback failed");
      return reply.redirect("/?oidc=login-failed");
    }
  });

  app.post(
    "/api/v1/auth/setup",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      if (database.userCount() > 0) {
        return reply.code(409).send({ message: "Initial setup is already complete." });
      }
      const credentials = credentialsSchema.parse(request.body);
      const password = await hashPassword(credentials.password);
      const user: UserRecord = {
        id: randomUUID(),
        email: credentials.email,
        password_hash: password.hash,
        password_salt: password.salt,
        totp_secret: null,
        totp_enabled: 0,
        role: "admin",
        email_verified_at: Date.now(),
        disabled_at: null,
        quota_bytes: null,
        created_at: Date.now(),
      };
      if (!database.createInitialUser(user)) {
        return reply.code(409).send({ message: "Initial setup is already complete." });
      }
      issueSession(user.id, reply);
      database.audit(
        null,
        "auth.setup_completed",
        anonymizeIp(request.ip, config.ipSalt),
      );
      return reply.code(201).send({ authenticated: true });
    },
  );

  app.post(
    "/api/v1/auth/register",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      if (!registrationEnabled()) {
        return reply.code(403).send({ message: "Registration is currently closed." });
      }
      const credentials = credentialsSchema.parse(request.body);
      const settings = loadEmailSettings();
      if (!settings) {
        return reply.code(409).send({ message: "Email delivery is not configured." });
      }

      const existing = database.findUserByEmail(credentials.email);
      if (existing) {
        if (existing.email_verified_at === null && existing.disabled_at === null) {
          const token = createPublicToken();
          database.replaceEmailVerificationToken(
            existing.id,
            hashToken(token),
            Date.now() + 24 * 60 * 60 * 1000,
          );
          try {
            await sendEmailVerification(
              settings,
              existing.email,
              verificationUrl(token),
            );
          } catch (error) {
            request.log.error(
              { err: error, userId: existing.id },
              "Registration verification email failed",
            );
          }
        }
        return reply.code(202).send({
          message:
            "If this address can be registered, a verification email has been sent.",
        });
      }

      const password = await hashPassword(credentials.password);
      const token = createPublicToken();
      const now = Date.now();
      const user: UserRecord = {
        id: randomUUID(),
        email: credentials.email,
        password_hash: password.hash,
        password_salt: password.salt,
        totp_secret: null,
        totp_enabled: 0,
        role: "member",
        email_verified_at: null,
        disabled_at: null,
        quota_bytes: null,
        created_at: now,
      };
      database.createUnverifiedUser(
        user,
        hashToken(token),
        now + 24 * 60 * 60 * 1000,
      );
      try {
        await sendEmailVerification(
          settings,
          user.email,
          verificationUrl(token),
        );
      } catch (error) {
        request.log.error(
          { err: error, userId: user.id },
          "Registration verification email failed",
        );
        return reply.code(503).send({
          message:
            "Your account is pending, but the verification email could not be delivered. Try resending it shortly.",
        });
      }
      database.audit(
        null,
        "auth.registration_started",
        anonymizeIp(request.ip, config.ipSalt),
        { userId: user.id },
      );
      return reply.code(202).send({
        message: "Check your inbox and verify your email before signing in.",
      });
    },
  );

  app.post(
    "/api/v1/auth/resend-verification",
    { config: { rateLimit: { max: 3, timeWindow: "30 minutes" } } },
    async (request) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const user = database.findUserByEmail(email);
      const settings = loadEmailSettings();
      if (
        user &&
        user.email_verified_at === null &&
        user.disabled_at === null &&
        settings
      ) {
        const token = createPublicToken();
        database.replaceEmailVerificationToken(
          user.id,
          hashToken(token),
          Date.now() + 24 * 60 * 60 * 1000,
        );
        try {
          await sendEmailVerification(
            settings,
            user.email,
            verificationUrl(token),
          );
        } catch (error) {
          request.log.error(
            { err: error, userId: user.id },
            "Verification email resend failed",
          );
        }
      }
      return {
        message:
          "If the account is waiting for verification, a new email has been sent.",
      };
    },
  );

  app.post(
    "/api/v1/auth/register/invitation",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const body = invitationRegisterSchema.parse(request.body);
      const settings = loadEmailSettings();
      if (!settings) {
        return reply.code(409).send({ message: "Email delivery is not configured." });
      }
      if (database.findUserByEmail(body.email)) {
        return reply.code(409).send({ message: "This invitation cannot be used." });
      }
      const password = await hashPassword(body.password);
      const verificationToken = createPublicToken();
      const now = Date.now();
      const user: UserRecord = {
        id: randomUUID(),
        email: body.email,
        password_hash: password.hash,
        password_salt: password.salt,
        totp_secret: null,
        totp_enabled: 0,
        role: "member",
        email_verified_at: null,
        disabled_at: null,
        quota_bytes: null,
        created_at: now,
      };
      const consumed = database.createUserFromInvitation(
        hashToken(body.invitationToken),
        user,
        hashToken(verificationToken),
        now + 24 * 60 * 60 * 1_000,
      );
      if (!consumed) {
        return reply.code(400).send({
          message: "The invitation is invalid, expired, or already used.",
        });
      }
      try {
        await sendEmailVerification(
          settings,
          user.email,
          verificationUrl(verificationToken),
        );
      } catch (error) {
        request.log.error(
          { err: error, userId: user.id },
          "Invitation verification email failed",
        );
        return reply.code(503).send({
          message:
            "The account was created, but its verification email could not be delivered.",
        });
      }
      database.audit(
        null,
        "auth.invitation_accepted",
        anonymizeIp(request.ip, config.ipSalt),
        { userId: user.id },
      );
      return reply.code(202).send({
        message: "Check your inbox and verify your email before signing in.",
      });
    },
  );

  app.post(
    "/api/v1/auth/verify-email",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const { token } = verificationTokenSchema.parse(request.body);
      const userId = database.consumeEmailVerificationToken(hashToken(token));
      if (!userId) {
        return reply.code(400).send({
          message: "The verification link is invalid, expired, or already used.",
        });
      }
      database.audit(
        null,
        "auth.email_verified",
        anonymizeIp(request.ip, config.ipSalt),
        { userId },
      );
      return { verified: true };
    },
  );

  app.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const credentials = loginSchema.parse(request.body);
      const user = database.findUserByEmail(credentials.email);
      const passwordRecord = user ?? {
        ...(await dummyPasswordPromise),
        password_hash: (await dummyPasswordPromise).hash,
        password_salt: (await dummyPasswordPromise).salt,
      };
      const valid = await verifyPassword(
        credentials.password,
        passwordRecord.password_salt,
        passwordRecord.password_hash,
      );
      const ipHash = anonymizeIp(request.ip, config.ipSalt);

      if (!user || !valid) {
        database.audit(null, "auth.login_failed", ipHash);
        return reply.code(401).send({ message: "Email or password is incorrect." });
      }
      if (user.disabled_at !== null) {
        return reply.code(403).send({ message: "This account is unavailable." });
      }
      if (user.email_verified_at === null) {
        return reply.code(403).send({
          message: "Verify your email address before signing in.",
          code: "EMAIL_NOT_VERIFIED",
        });
      }
      if (user.totp_enabled === 1) {
        return {
          requiresTwoFactor: true,
          challenge: createLoginChallenge(user.id, config.secret),
        };
      }
      issueSession(user.id, reply);
      database.audit(null, "auth.login_succeeded", ipHash);
      return { authenticated: true, requiresTwoFactor: false };
    },
  );

  app.post(
    "/api/v1/auth/login/verify",
    { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const body = twoFactorLoginSchema.parse(request.body);
      const challenge = verifyLoginChallenge(body.challenge, config.secret);
      const user = challenge
        ? database.findUserById(challenge.userId)
        : undefined;
      let valid = false;

      if (
        user?.totp_enabled === 1 &&
        user.totp_secret &&
        user.email_verified_at !== null &&
        user.disabled_at === null
      ) {
        const secret = decryptValue(user.totp_secret, config.secret);
        valid = verifyTotp(secret, body.code);
        if (!valid) {
          valid = database.consumeRecoveryCode(
            user.id,
            hashRecoveryCode(body.code, config.secret),
          );
        }
      }
      const ipHash = anonymizeIp(request.ip, config.ipSalt);
      if (!user || !valid) {
        database.audit(null, "auth.two_factor_failed", ipHash);
        return reply.code(401).send({ message: "The verification code is invalid." });
      }
      issueSession(user.id, reply);
      database.audit(null, "auth.login_succeeded_2fa", ipHash);
      return { authenticated: true };
    },
  );

  app.post("/api/v1/auth/logout", async (request, reply) => {
    clearSession(request, reply);
    return { authenticated: false };
  });

  app.post(
    "/api/v1/auth/2fa/setup",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const user = authenticatedUser(request);
      if (!user) return reply.code(401).send({ message: "Authentication required." });
      const { password } = passwordSchema.parse(request.body);
      if (
        !(await verifyPassword(password, user.password_salt, user.password_hash))
      ) {
        return reply.code(401).send({ message: "The password is incorrect." });
      }
      const secret = createTotpSecret();
      database.setPendingTotp(user.id, encryptValue(secret, config.secret));
      const label = encodeURIComponent(`Veyra:${user.email}`);
      const issuer = encodeURIComponent("Veyra");
      const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
      const qrCode = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 280,
      });
      return { secret, uri, qrCode };
    },
  );

  app.post("/api/v1/auth/2fa/confirm", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { code } = totpConfirmSchema.parse(request.body);
    const refreshed = database.findUserById(user.id);
    if (!refreshed?.totp_secret) {
      return reply.code(409).send({ message: "Start two-factor setup first." });
    }
    const secret = decryptValue(refreshed.totp_secret, config.secret);
    if (!verifyTotp(secret, code)) {
      return reply.code(400).send({ message: "The authenticator code is invalid." });
    }
    const recoveryCodes = createRecoveryCodes();
    database.enableTotp(
      user.id,
      recoveryCodes.map((value) => hashRecoveryCode(value, config.secret)),
    );
    database.audit(
      null,
      "auth.two_factor_enabled",
      anonymizeIp(request.ip, config.ipSalt),
    );
    return { enabled: true, recoveryCodes };
  });

  app.post("/api/v1/auth/2fa/disable", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const body = twoFactorDisableSchema.parse(request.body);
    const validPassword = await verifyPassword(
      body.password,
      user.password_salt,
      user.password_hash,
    );
    const validCode =
      Boolean(user.totp_secret) &&
      verifyTotp(
        decryptValue(user.totp_secret!, config.secret),
        body.code,
      );
    if (!validPassword || !validCode) {
      return reply.code(401).send({ message: "Password or code is incorrect." });
    }
    database.disableTotp(user.id);
    database.audit(
      null,
      "auth.two_factor_disabled",
      anonymizeIp(request.ip, config.ipSalt),
    );
    return { enabled: false };
  });

  app.post(
    "/api/v1/auth/forgot-password",
    { config: { rateLimit: { max: 3, timeWindow: "30 minutes" } } },
    async (request) => {
      const { email } = forgotPasswordSchema.parse(request.body);
      const user = database.findUserByEmail(email);
      const settings = loadEmailSettings();
      if (
        user &&
        user.email_verified_at !== null &&
        user.disabled_at === null &&
        settings
      ) {
        const token = createPublicToken();
        database.createPasswordResetToken(
          hashToken(token),
          user.id,
          Date.now() + 30 * 60 * 1000,
        );
        const resetUrl = new URL("/reset-password", config.VEYRA_BASE_URL);
        resetUrl.searchParams.set("token", token);
        try {
          await sendPasswordReset(settings, user.email, resetUrl.toString());
        } catch (error) {
          request.log.error({ err: error }, "Password reset email failed");
        }
      }
      return {
        message:
          "If the account exists and email is configured, a reset link has been sent.",
      };
    },
  );

  app.post(
    "/api/v1/auth/reset-password",
    { config: { rateLimit: { max: 5, timeWindow: "30 minutes" } } },
    async (request, reply) => {
      const body = resetPasswordSchema.parse(request.body);
      const userId = database.consumePasswordResetToken(hashToken(body.token));
      if (!userId) {
        return reply.code(400).send({ message: "The reset link is invalid or expired." });
      }
      const user = database.findUserById(userId);
      if (!user || user.email_verified_at === null || user.disabled_at !== null) {
        return reply.code(400).send({ message: "The reset link is invalid or expired." });
      }
      const password = await hashPassword(body.password);
      database.updatePassword(userId, password.hash, password.salt);
      database.audit(
        null,
        "auth.password_reset",
        anonymizeIp(request.ip, config.ipSalt),
      );
      return { reset: true };
    },
  );

  app.get("/api/v1/admin/email", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const settings = loadEmailSettings();
    return settings
      ? {
          host: settings.host,
          port: settings.port,
          secure: settings.secure,
          user: settings.user,
          passwordConfigured: Boolean(settings.password),
          fromName: settings.fromName,
          fromAddress: settings.fromAddress,
        }
      : null;
  });

  app.put("/api/v1/admin/email", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const incoming = emailSettingsSchema.parse(request.body);
    const existing = loadEmailSettings();
    const password = incoming.password || existing?.password || "";
    const stored: StoredEmailSettings = {
      host: incoming.host,
      port: incoming.port,
      secure: incoming.secure,
      user: incoming.user,
      passwordEncrypted: password
        ? encryptValue(password, config.secret)
        : "",
      fromName: incoming.fromName,
      fromAddress: incoming.fromAddress,
    };
    database.setSetting("email.smtp", JSON.stringify(stored));
    database.audit(
      null,
      "settings.email_updated",
      anonymizeIp(request.ip, config.ipSalt),
    );
    return { saved: true, passwordConfigured: Boolean(password) };
  });

  app.post("/api/v1/admin/email/test", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const settings = loadEmailSettings();
    if (!settings) {
      return reply.code(409).send({ message: "Save email settings first." });
    }
    await verifyEmailSettings(settings);
    await sendTestEmail(settings, user.email);
    return { sent: true };
  });

  app.put("/api/v1/admin/registration", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const { enabled } = registrationSettingsSchema.parse(request.body);
    if (enabled && !loadEmailSettings()) {
      return reply.code(409).send({
        message: "Configure outgoing email before opening registration.",
      });
    }
    database.setSetting("auth.registration_enabled", String(enabled));
    database.audit(
      null,
      "settings.registration_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, enabled },
    );
    return { enabled };
  });

  app.get("/api/v1/admin/users", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return {
      users: database.listUsers().map((managedUser) => ({
        id: managedUser.id,
        email: managedUser.email,
        role: managedUser.role,
        emailVerified: managedUser.email_verified_at !== null,
        disabled: managedUser.disabled_at !== null,
        twoFactorEnabled: managedUser.totp_enabled === 1,
        createdAt: new Date(managedUser.created_at).toISOString(),
        shareCount: managedUser.share_count,
        totalSize: managedUser.total_size,
        quotaBytes: managedUser.quota_bytes,
      })),
    };
  });

  app.patch("/api/v1/admin/users/:id", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const { id } = managedUserParamsSchema.parse(request.params);
    const { disabled, quotaBytes } = managedUserStatusSchema.parse(request.body);
    if (id === user.id && disabled !== undefined) {
      return reply.code(409).send({ message: "You cannot disable your own account." });
    }
    const target = database.findUserById(id);
    if (!target) return reply.code(404).send({ message: "User not found." });
    if (target.role === "admin" && disabled !== undefined) {
      return reply.code(409).send({ message: "Administrator accounts cannot be disabled here." });
    }
    if (disabled !== undefined && !database.setUserDisabled(id, disabled)) {
        return reply.code(404).send({ message: "User not found." });
    }
    if (
      quotaBytes !== undefined &&
      target.role !== "admin" &&
      !database.setUserQuota(id, quotaBytes)
    ) {
      return reply.code(404).send({ message: "User not found." });
    }
    database.audit(
      null,
      disabled === undefined
        ? "admin.user_quota_updated"
        : disabled
          ? "admin.user_disabled"
          : "admin.user_enabled",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, targetUserId: id, quotaBytes },
    );
    return {
      disabled: disabled ?? target.disabled_at !== null,
      quotaBytes: quotaBytes ?? target.quota_bytes,
    };
  });

  app.get("/api/v1/admin/capacity", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const policy = loadCapacityPolicy(database);
    const usage = database.capacityUsage();
    return {
      ...policy,
      usage,
      availableLocalBytes: await storage.local.availableBytes(),
      maxFileBytes: config.VEYRA_MAX_FILE_SIZE,
    };
  });

  app.put("/api/v1/admin/capacity", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const policy = capacityPolicySchema.parse(request.body);
    if (policy.maxShareBytes < config.VEYRA_MAX_FILE_SIZE) {
      return reply.code(400).send({
        message: "The share limit cannot be smaller than the hard file limit.",
      });
    }
    saveCapacityPolicy(database, policy);
    database.audit(
      null,
      "settings.capacity_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id },
    );
    return { saved: true, policy };
  });

  app.get("/api/v1/admin/storage", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return storageSettingsForAdmin(database);
  });

  app.put("/api/v1/admin/storage", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const input = storageSettingsSchema.parse(request.body);
    const previous = loadStorageSettings(database);
    if (input.backend === "s3") {
      const secret =
        input.secretAccessKey ||
        previous.s3?.secretAccessKey ||
        "";
      if (!input.bucket || !input.accessKeyId || !secret) {
        return reply.code(400).send({
          message: "Complete the S3 bucket and credentials.",
        });
      }
      const locationChanged =
        previous.s3 &&
        (previous.s3.endpoint !== input.endpoint ||
          previous.s3.region !== input.region ||
          previous.s3.bucket !== input.bucket ||
          previous.s3.prefix !== input.prefix ||
          previous.s3.forcePathStyle !== input.forcePathStyle);
      if (locationChanged && database.storedObjectCount("s3") > 0) {
        return reply.code(409).send({
          message:
            "The S3 location cannot change while stored or pending objects still use it. Credentials may be rotated safely.",
        });
      }
      await storage.testS3({
        endpoint: input.endpoint,
        region: input.region,
        bucket: input.bucket,
        prefix: input.prefix,
        forcePathStyle: input.forcePathStyle,
        accessKeyId: input.accessKeyId,
        secretAccessKey: secret,
      });
    }
    saveStorageSettings(database, input);
    database.audit(
      null,
      "settings.storage_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, backend: input.backend },
    );
    return { saved: true, backend: input.backend };
  });

  app.post("/api/v1/admin/storage/test", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const settings = loadStorageSettings(database);
    if (!settings.s3) {
      return reply.code(409).send({ message: "Configure S3 first." });
    }
    await storage.testS3(settings.s3);
    return { healthy: true };
  });

  app.get("/api/v1/admin/antivirus", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return loadAntivirusSettings(database);
  });

  app.put("/api/v1/admin/antivirus", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const settings = antivirusSettingsSchema.parse(request.body);
    if (settings.enabled) await testAntivirus(settings);
    saveAntivirusSettings(database, settings);
    database.audit(
      null,
      "settings.antivirus_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, enabled: settings.enabled },
    );
    return { saved: true };
  });

  app.post("/api/v1/admin/antivirus/test", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const settings = loadAntivirusSettings(database);
    if (!settings.enabled) {
      return reply.code(409).send({ message: "Enable antivirus first." });
    }
    await testAntivirus(settings);
    return { healthy: true };
  });

  app.get("/api/v1/admin/branding", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return loadBrandingSettings(database);
  });

  app.put("/api/v1/admin/branding", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const current = loadBrandingSettings(database);
    const input = brandingSettingsSchema
      .omit({ logoVersion: true })
      .parse(request.body);
    const updated = { ...input, logoVersion: current.logoVersion };
    saveBrandingSettings(database, updated);
    database.audit(
      null,
      "settings.branding_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id },
    );
    return updated;
  });

  app.post(
    "/api/v1/admin/branding/logo",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const user = adminUser(request, reply);
      if (!user) return;
      const part = await request.file({
        limits: { files: 1, fileSize: 2 * 1024 * 1024 },
      });
      if (!part) return reply.code(400).send({ message: "Choose a logo." });
      const allowed = new Set(["image/png", "image/jpeg", "image/webp"]);
      if (!allowed.has(part.mimetype)) {
        return reply.code(415).send({
          message: "Use a PNG, JPEG, or WebP logo.",
        });
      }
      const source = await part.toBuffer();
      const reencoded = await sharp(source, {
        failOn: "error",
        limitInputPixels: 16_000_000,
      })
        .rotate()
        .resize(512, 512, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
      const { mkdir, writeFile } = await import("node:fs/promises");
      const brandingDir = join(config.dataDir, "branding");
      await mkdir(brandingDir, { recursive: true, mode: 0o700 });
      await writeFile(join(brandingDir, "logo.webp"), reencoded, {
        mode: 0o600,
      });
      const current = loadBrandingSettings(database);
      const updated = { ...current, logoVersion: Date.now() };
      saveBrandingSettings(database, updated);
      database.audit(
        null,
        "settings.branding_logo_updated",
        anonymizeIp(request.ip, config.ipSalt),
        { actorUserId: user.id },
      );
      return {
        saved: true,
        logoUrl: `/api/v1/public/logo?v=${updated.logoVersion}`,
      };
    },
  );

  app.get("/api/v1/admin/oidc", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return oidcSettingsForAdmin(database);
  });

  app.put("/api/v1/admin/oidc", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const input = oidcSettingsSchema.parse(request.body);
    const previous = loadOidcSettings(database);
    const complete = {
      ...input,
      clientSecret: input.clientSecret || previous.clientSecret,
    };
    if (complete.enabled) {
      await oidc.discovery(
        new URL(complete.issuer),
        complete.clientId,
        complete.clientSecret,
      );
    }
    saveOidcSettings(database, input);
    oidcCache = undefined;
    database.audit(
      null,
      "settings.oidc_updated",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, enabled: input.enabled },
    );
    return { saved: true };
  });

  app.get("/api/v1/admin/invitations", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return {
      invitations: database.listInvitations().map((invitation) => {
        let token: string | null = null;
        try {
          token = decryptValue(invitation.token_encrypted, config.secret);
        } catch {
          token = null;
        }
        return {
          id: invitation.id,
          email: invitation.email,
          url: token
            ? new URL(
                `/register?invite=${encodeURIComponent(token)}`,
                config.VEYRA_BASE_URL,
              ).toString()
            : null,
          expiresAt: new Date(invitation.expires_at).toISOString(),
          maxUses: invitation.max_uses,
          useCount: invitation.use_count,
          revoked: invitation.revoked_at !== null,
          createdAt: new Date(invitation.created_at).toISOString(),
        };
      }),
    };
  });

  app.post("/api/v1/admin/invitations", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const input = invitationSchema.parse(request.body);
    const emailSettings = loadEmailSettings();
    if (!emailSettings) {
      return reply.code(409).send({
        message:
          "Configure outgoing email before creating invitations so invitees can verify their address.",
      });
    }
    if (input.sendEmail && !input.email) {
      return reply.code(409).send({
        message: "A recipient address is required to send the invitation.",
      });
    }
    const token = createPublicToken();
    const now = Date.now();
    const invitation = {
      id: randomUUID(),
      token_hash: hashToken(token),
      token_encrypted: encryptValue(token, config.secret),
      email: input.email?.toLowerCase() ?? null,
      created_by: user.id,
      expires_at: now + input.expiresInHours * 60 * 60 * 1_000,
      max_uses: input.maxUses,
      use_count: 0,
      revoked_at: null,
      created_at: now,
    };
    database.createInvitation(invitation);
    const url = new URL(
      `/register?invite=${encodeURIComponent(token)}`,
      config.VEYRA_BASE_URL,
    ).toString();
    if (input.sendEmail && input.email) {
      await sendInvitationEmail(
        emailSettings,
        input.email,
        url,
        loadBrandingSettings(database).name,
      );
    }
    database.audit(
      null,
      "admin.invitation_created",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, invitationId: invitation.id },
    );
    return reply.code(201).send({
      id: invitation.id,
      url,
      expiresAt: new Date(invitation.expires_at).toISOString(),
      sent: input.sendEmail,
    });
  });

  app.delete("/api/v1/admin/invitations/:id", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const { id } = invitationParamsSchema.parse(request.params);
    if (!database.revokeInvitation(id)) {
      return reply.code(404).send({ message: "Invitation not found." });
    }
    database.audit(
      null,
      "admin.invitation_revoked",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id, invitationId: id },
    );
    return { revoked: true };
  });

  app.get("/api/v1/admin/overview", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const users = database.listUsers();
    const shares = database.listGlobalShares();
    const usage = database.capacityUsage();
    return {
      users: {
        total: users.length,
        active: users.filter((entry) => entry.disabled_at === null).length,
      },
      shares: {
        total: shares.length,
        active: shares.filter((entry) => entry.status === "ready").length,
        quarantined: shares.filter(
          (entry) => entry.status === "quarantined",
        ).length,
      },
      storage: usage,
    };
  });

  app.get("/api/v1/admin/global-shares", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    return {
      shares: database.listGlobalShares().map((share) => ({
        id: share.id,
        ownerId: share.owner_id,
        ownerEmail: share.owner_email,
        status: share.status,
        source: share.source,
        createdAt: new Date(share.created_at).toISOString(),
        expiresAt:
          share.expires_at === null
            ? null
            : new Date(share.expires_at).toISOString(),
        fileCount: share.file_count,
        totalSize: share.total_size,
      })),
      privacy:
        "Administrators receive aggregate metadata only; filenames, tokens, descriptions, previews, and file contents are excluded.",
    };
  });

  app.post("/api/v1/admin/global-shares/:id/revoke", async (request, reply) => {
    const user = adminUser(request, reply);
    if (!user) return;
    const { id } = globalShareParamsSchema.parse(request.params);
    if (!database.revokeGlobalShare(id)) {
      return reply.code(404).send({ message: "Share not found." });
    }
    database.audit(
      id,
      "admin.share_revoked",
      anonymizeIp(request.ip, config.ipSalt),
      { actorUserId: user.id },
    );
    return { revoked: true };
  });

  app.get("/api/v1/me/shares", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    return {
      shares: database.listManagedShares(user.id).map((share) => {
        let token: string | null = null;
        if (share.token_encrypted) {
          try {
            token = decryptValue(share.token_encrypted, config.secret);
          } catch (error) {
            request.log.error({ err: error, shareId: share.id }, "Share token decryption failed");
          }
        }
        return {
          id: share.id,
          path: token ? `/s/${token}` : null,
          url: token
            ? new URL(`/s/${token}`, config.VEYRA_BASE_URL).toString()
            : null,
          createdAt: new Date(share.created_at).toISOString(),
          expiresAt:
            share.expires_at === null
              ? null
              : new Date(share.expires_at).toISOString(),
          maxDownloads: share.max_downloads,
          downloads: share.download_count,
          title: share.title,
          description: share.description ?? share.note,
          recipientEmail: share.recipient_email,
          passwordProtected: Boolean(share.password_hash),
          status: share.status,
          source: share.source,
          senderName: share.sender_name,
          senderEmail: share.sender_email,
          fileCount: share.file_count,
          totalSize: share.total_size,
          qrUrl: token ? `/api/v1/me/shares/${share.id}/qr` : null,
          files: database.listFiles(share.id).map((file) => ({
            ...publicFile(file),
            directUrl: token
              ? new URL(
                  `/api/v1/shares/${token}/files/${file.id}`,
                  config.VEYRA_BASE_URL,
                ).toString()
              : null,
          })),
        };
      }),
    };
  });

  app.get("/api/v1/me/shares/:id/qr", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = managedShareParamsSchema.parse(request.params);
    const share = database.findManagedShare(user.id, id);
    if (!share?.token_encrypted) {
      return reply.code(404).send({ message: "Share link not found." });
    }
    const token = decryptValue(share.token_encrypted, config.secret);
    const url = new URL(`/s/${token}`, config.VEYRA_BASE_URL).toString();
    const svg = await QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 360,
    });
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(svg);
  });

  app.post("/api/v1/me/shares/:id/regenerate-link", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = managedShareParamsSchema.parse(request.params);
    const token = createPublicToken();
    const updated = database.rotateManagedShareToken(
      user.id,
      id,
      hashToken(token),
      encryptValue(token, config.secret),
    );
    if (!updated) return reply.code(404).send({ message: "Share not found." });
    database.audit(
      id,
      "share.link_regenerated",
      anonymizeIp(request.ip, config.ipSalt),
    );
    return {
      path: `/s/${token}`,
      url: new URL(`/s/${token}`, config.VEYRA_BASE_URL).toString(),
    };
  });

  app.patch("/api/v1/me/shares/:id", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = managedShareParamsSchema.parse(request.params);
    const body = updateManagedShareSchema.parse(request.body);
    let passwordHash: string | null | undefined;
    let passwordSalt: string | null | undefined;
    if (body.password === null) {
      passwordHash = null;
      passwordSalt = null;
    } else if (body.password !== undefined) {
      const password = await hashPassword(body.password);
      passwordHash = password.hash;
      passwordSalt = password.salt;
    }
    const updated = database.updateManagedShare(user.id, id, {
      expiresAt:
        body.expiresInHours === null
          ? null
          : Date.now() + body.expiresInHours * 60 * 60 * 1000,
      maxDownloads: body.maxDownloads,
      title: body.title?.trim() || null,
      description: body.description?.trim() || null,
      recipientEmail: body.recipientEmail,
      passwordHash,
      passwordSalt,
    });
    if (!updated) return reply.code(404).send({ message: "Share not found." });
    database.audit(
      id,
      "share.updated",
      anonymizeIp(request.ip, config.ipSalt),
    );
    return { updated: true };
  });

  app.post(
    "/api/v1/me/shares/:id/send-email",
    {
      config: {
        rateLimit: { max: 10, timeWindow: "1 hour" },
      },
    },
    async (request, reply) => {
      const user = authenticatedUser(request);
      if (!user) return reply.code(401).send({ message: "Authentication required." });
      const { id } = managedShareParamsSchema.parse(request.params);
      const share = database.findManagedShare(user.id, id);
      if (!share) return reply.code(404).send({ message: "Share not found." });
      if (!share.recipient_email) {
        return reply.code(409).send({ message: "Add a recipient email first." });
      }
      if (!share.token_encrypted) {
        return reply.code(409).send({ message: "Generate a new link before sending email." });
      }
      const settings = loadEmailSettings();
      if (!settings) {
        return reply.code(409).send({ message: "Configure email delivery first." });
      }
      if (
        database.shareEmailDeliveryCount(
          user.id,
          Date.now() - 24 * 60 * 60 * 1000,
        ) >= dailyShareEmailLimit
      ) {
        return reply.code(429).send({
          message: "This account reached its daily share email limit.",
        });
      }

      let token: string;
      try {
        token = decryptValue(share.token_encrypted, config.secret);
      } catch (error) {
        request.log.error({ err: error, shareId: id }, "Share token decryption failed");
        return reply.code(500).send({ message: "The share link could not be recovered." });
      }
      const url = new URL(`/s/${token}`, config.VEYRA_BASE_URL).toString();
      await deliverShareEmail(settings, share.recipient_email, {
        title: share.title,
        description: share.description ?? share.note,
        url,
        expiresAt:
          share.expires_at === null
            ? null
            : new Date(share.expires_at).toISOString(),
      });
      const auditEventId = database.audit(
        id,
        "share.email_sent",
        anonymizeIp(request.ip, config.ipSalt),
      );
      database.recordShareEmailDelivery(user.id, id, auditEventId);
      return { sent: true };
    },
  );

  app.delete("/api/v1/me/shares/:id", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = managedShareParamsSchema.parse(request.params);
    const storedObjects = database.deleteManagedShare(user.id, id);
    if (!storedObjects) return reply.code(404).send({ message: "Share not found." });
    await removeStoredObjects(storedObjects);
    database.audit(
      id,
      "share.deleted",
      anonymizeIp(request.ip, config.ipSalt),
      { fileCount: storedObjects.length },
    );
    return { deleted: true };
  });

  function ownedUploadSession(
    request: FastifyRequest,
    reply: FastifyReply,
    uploadId: string,
  ): UploadSessionRecord | undefined {
    const user = authenticatedUser(request);
    if (!user) {
      void reply.code(401).send({ message: "Authentication required." });
      return undefined;
    }
    const session = database.findUploadSessionForUser(uploadId, user.id);
    if (!session || session.secret_hash !== null) {
      void reply.code(404).send({ message: "Upload session not found." });
      return undefined;
    }
    return session;
  }

  app.post(
    "/api/v1/uploads",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const user = authenticatedUser(request);
      if (!user) {
        return reply.code(401).send({ message: "Sign in to create a share." });
      }
      const manifest = uploadManifestSchema.parse(request.body);
      const created = await uploadService.createShareUpload(user, manifest);
      database.audit(
        null,
        "upload.reserved",
        anonymizeIp(request.ip, config.ipSalt),
        {
          uploadId: created.id,
          fileCount: created.files.length,
          totalSize: created.files.reduce((total, file) => total + file.size, 0),
        },
      );
      return reply.code(201).send(created);
    },
  );

  app.get("/api/v1/uploads/:uploadId", async (request, reply) => {
    const { uploadId } = uploadParamsSchema.parse(request.params);
    const session = ownedUploadSession(request, reply, uploadId);
    if (!session) return;
    reply.header("Cache-Control", "private, no-store");
    return uploadService.status(session);
  });

  app.head(
    "/api/v1/uploads/:uploadId/files/:fileId",
    async (request, reply) => {
      const { uploadId, fileId } = uploadFileParamsSchema.parse(request.params);
      const session = ownedUploadSession(request, reply, uploadId);
      if (!session) return;
      const file = database.findUploadFile(uploadId, fileId);
      if (!file) return reply.code(404).send();
      const offset = await uploadService.offset(session, fileId);
      reply.header("Upload-Offset", offset);
      reply.header("Upload-Length", file.expected_size);
      reply.header("Upload-Expires", new Date(session.expires_at).toUTCString());
      reply.header("Cache-Control", "no-store");
      return reply.code(204).send();
    },
  );

  app.patch(
    "/api/v1/uploads/:uploadId/files/:fileId",
    {
      bodyLimit: config.VEYRA_UPLOAD_CHUNK_SIZE,
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { uploadId, fileId } = uploadFileParamsSchema.parse(request.params);
      const session = ownedUploadSession(request, reply, uploadId);
      if (!session) return;
      const offset = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(request.headers["upload-offset"]);
      const contentLength = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(request.headers["content-length"]);
      const next = await uploadService.append(
        session,
        fileId,
        offset,
        contentLength,
        request.body as Readable,
      );
      reply.header("Upload-Offset", next);
      reply.header("Cache-Control", "no-store");
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/uploads/:uploadId/complete",
    {
      config: { rateLimit: { max: 20, timeWindow: "5 minutes" } },
    },
    async (request, reply) => {
      const { uploadId } = uploadParamsSchema.parse(request.params);
      const completion = uploadCompletionSchema.parse(request.body ?? {});
      const session = ownedUploadSession(request, reply, uploadId);
      if (!session) return;
      let passwordForEmail: string | null = null;
      if (
        completion.includePasswordInEmail &&
        session.effects_claimed_at === null
      ) {
        const pendingShare = session.share_id
          ? database.findShareById(session.share_id)
          : undefined;
        if (!pendingShare?.recipient_email) {
          return reply.code(400).send({
            message:
              "Add a recipient email before including the share password.",
          });
        }
        if (!pendingShare.password_hash || !pendingShare.password_salt) {
          return reply.code(400).send({
            message:
              "Set a share password before including it in the recipient email.",
          });
        }
        if (
          !completion.password ||
          !(await verifyPassword(
            completion.password,
            pendingShare.password_salt,
            pendingShare.password_hash,
          ))
        ) {
          return reply.code(400).send({
            message:
              "The password supplied for email delivery does not match this share.",
          });
        }
        passwordForEmail = completion.password;
      }
      const finalized = await uploadService.finalize(session);
      const share = finalized.share;
      if (!share?.token_encrypted) {
        return reply.code(500).send({ message: "The share link could not be finalized." });
      }
      const publicToken = decryptValue(share.token_encrypted, config.secret);
      const url = new URL(`/s/${publicToken}`, config.VEYRA_BASE_URL).toString();
      const effectsClaimed =
        database.claimUploadCompletionEffects(uploadId);
      let emailSent: boolean | null = null;
      let emailWarning: string | null = null;
      let passwordIncludedInEmail = false;
      const passwordRetryNotice = passwordForEmail
        ? " Veyra did not retain the password; retries send only the link."
        : "";
      if (effectsClaimed && share.recipient_email) {
        const settings = loadEmailSettings();
        if (!settings) {
          emailSent = false;
          emailWarning =
            `The share was created, but email delivery is not configured.${passwordRetryNotice}`;
        } else if (
          database.shareEmailDeliveryCount(
            share.owner_id!,
            Date.now() - 24 * 60 * 60 * 1_000,
          ) >= dailyShareEmailLimit
        ) {
          emailSent = false;
          emailWarning =
            `The share was created, but this account reached its daily email limit.${passwordRetryNotice}`;
        } else {
          try {
            await deliverShareEmail(settings, share.recipient_email, {
              title: share.title,
              description: share.description,
              url,
              expiresAt:
                share.expires_at === null
                  ? null
                  : new Date(share.expires_at).toISOString(),
              password: passwordForEmail,
            });
            emailSent = true;
            passwordIncludedInEmail = passwordForEmail !== null;
            const auditEventId = database.audit(
              share.id,
              "share.email_sent",
              anonymizeIp(request.ip, config.ipSalt),
            );
            database.recordShareEmailDelivery(
              share.owner_id!,
              share.id,
              auditEventId,
            );
          } catch (error) {
            request.log.error(
              { err: error, shareId: share.id },
              "Share email delivery failed",
            );
            emailSent = false;
            emailWarning =
              `The share was created, but the email could not be delivered.${passwordRetryNotice}`;
          }
        }
      }
      if (effectsClaimed) {
        database.audit(
          share.id,
          "share.created",
          anonymizeIp(request.ip, config.ipSalt),
          { fileCount: session.file_count, scanStatus: finalized.scanStatus },
        );
      }
      return {
        token: publicToken,
        path: `/s/${publicToken}`,
        url,
        expiresAt:
          share.expires_at === null
            ? null
            : new Date(share.expires_at).toISOString(),
        emailSent,
        emailWarning,
        passwordIncludedInEmail,
        scanStatus: finalized.scanStatus,
      };
    },
  );

  app.delete("/api/v1/uploads/:uploadId", async (request, reply) => {
    const { uploadId } = uploadParamsSchema.parse(request.params);
    const session = ownedUploadSession(request, reply, uploadId);
    if (!session) return;
    await uploadService.cancel(session);
    return { cancelled: true };
  });

  app.post("/api/v1/me/upload-requests", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const input = reverseShareSchema.parse(request.body);
    const policy = loadCapacityPolicy(database);
    if (input.maxTotalSize > policy.maxShareBytes) {
      return reply.code(413).send({
        message: "The request limit exceeds the instance share limit.",
      });
    }
    const password = input.password
      ? await hashPassword(input.password)
      : undefined;
    const token = createPublicToken();
    const now = Date.now();
    const reverseShare: ReverseShareRecord = {
      id: randomUUID(),
      owner_id: user.id,
      token_hash: hashToken(token),
      token_encrypted: encryptValue(token, config.secret),
      title: input.title.trim(),
      description: input.description?.trim() || null,
      password_hash: password?.hash ?? null,
      password_salt: password?.salt ?? null,
      expires_at:
        input.expiresInHours === null
          ? null
          : now + input.expiresInHours * 60 * 60 * 1_000,
      max_files: input.maxFiles,
      max_total_size: input.maxTotalSize,
      max_submissions: input.maxSubmissions,
      submission_count: 0,
      enabled: 1,
      created_at: now,
    };
    database.createReverseShare(reverseShare);
    const url = new URL(`/r/${token}`, config.VEYRA_BASE_URL).toString();
    database.audit(
      null,
      "reverse_request.created",
      anonymizeIp(request.ip, config.ipSalt),
      { requestId: reverseShare.id, actorUserId: user.id },
    );
    return reply.code(201).send({
      id: reverseShare.id,
      url,
      path: `/r/${token}`,
      expiresAt:
        reverseShare.expires_at === null
          ? null
          : new Date(reverseShare.expires_at).toISOString(),
    });
  });

  app.get("/api/v1/me/upload-requests", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    return {
      requests: database.listReverseShares(user.id).map((entry) => {
        let token: string | null = null;
        try {
          token = decryptValue(entry.token_encrypted, config.secret);
        } catch {
          token = null;
        }
        return {
          id: entry.id,
          title: entry.title,
          description: entry.description,
          url: token
            ? new URL(`/r/${token}`, config.VEYRA_BASE_URL).toString()
            : null,
          path: token ? `/r/${token}` : null,
          enabled: entry.enabled === 1,
          passwordProtected: Boolean(entry.password_hash),
          expiresAt:
            entry.expires_at === null
              ? null
              : new Date(entry.expires_at).toISOString(),
          maxFiles: entry.max_files,
          maxTotalSize: entry.max_total_size,
          maxSubmissions: entry.max_submissions,
          submissionCount: entry.submission_count,
          createdAt: new Date(entry.created_at).toISOString(),
          qrUrl: `/api/v1/me/upload-requests/${entry.id}/qr`,
        };
      }),
    };
  });

  app.patch("/api/v1/me/upload-requests/:id", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = reverseShareParamsSchema.parse(request.params);
    const { enabled } = z.object({ enabled: z.boolean() }).parse(request.body);
    if (!database.setReverseShareEnabled(user.id, id, enabled)) {
      return reply.code(404).send({ message: "Upload request not found." });
    }
    return { enabled };
  });

  app.post(
    "/api/v1/me/upload-requests/:id/regenerate-link",
    async (request, reply) => {
      const user = authenticatedUser(request);
      if (!user) return reply.code(401).send({ message: "Authentication required." });
      const { id } = reverseShareParamsSchema.parse(request.params);
      const token = createPublicToken();
      if (
        !database.rotateReverseShareToken(
          user.id,
          id,
          hashToken(token),
          encryptValue(token, config.secret),
        )
      ) {
        return reply.code(404).send({ message: "Upload request not found." });
      }
      return {
        path: `/r/${token}`,
        url: new URL(`/r/${token}`, config.VEYRA_BASE_URL).toString(),
      };
    },
  );

  app.get("/api/v1/me/upload-requests/:id/qr", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = reverseShareParamsSchema.parse(request.params);
    const entry = database.findReverseShareForOwner(user.id, id);
    if (!entry) return reply.code(404).send({ message: "Upload request not found." });
    const token = decryptValue(entry.token_encrypted, config.secret);
    const svg = await QRCode.toString(
      new URL(`/r/${token}`, config.VEYRA_BASE_URL).toString(),
      { type: "svg", margin: 1, width: 360, errorCorrectionLevel: "M" },
    );
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(svg);
  });

  app.delete("/api/v1/me/upload-requests/:id", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { id } = reverseShareParamsSchema.parse(request.params);
    const tempNames = database.listUploadTempNamesForReverse(id);
    const objects = database.deleteReverseShare(user.id, id);
    if (!objects) return reply.code(404).send({ message: "Upload request not found." });
    await removeStoredObjects(objects);
    await Promise.all(
      tempNames.map((name) => storage.local.removeTemporary(name)),
    );
    return { deleted: true };
  });

  app.get("/api/v1/me/submissions", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    return {
      submissions: database.listReverseSubmissions(user.id).map((entry) => ({
        id: entry.id,
        requestId: entry.reverse_share_id,
        senderName: entry.sender_name,
        senderEmail: entry.sender_email,
        message: entry.message,
        status: entry.status,
        totalSize: entry.total_size,
        fileCount: entry.file_count,
        createdAt: new Date(entry.created_at).toISOString(),
        files: database.listSubmissionFiles(user.id, entry.id).map((file) => ({
          id: file.id,
          name: file.original_name,
          relativePath: file.relative_path,
          type: file.mime_type,
          size: file.size,
          sha256: file.sha256,
          scanStatus: file.scan_status,
        })),
      })),
    };
  });

  app.get(
    "/api/v1/me/submissions/:submissionId/files/:fileId",
    async (request, reply) => {
      const user = authenticatedUser(request);
      if (!user) return reply.code(401).send({ message: "Authentication required." });
      const { submissionId, fileId } = z
        .object({
          submissionId: z.string().uuid(),
          fileId: z.string().uuid(),
        })
        .parse(request.params);
      const file = database.findSubmissionFile(user.id, submissionId, fileId);
      if (!file || file.storage_provider === "quarantine") {
        return reply.code(404).send({ message: "File not found." });
      }
      const opened = await storage.open(
        file.storage_provider,
        file.stored_name,
      );
      reply.header("Content-Type", "application/octet-stream");
      reply.header("Content-Length", opened.size);
      reply.header("Content-Disposition", contentDisposition(file.original_name));
      reply.header("Cache-Control", "private, no-store");
      return reply.send(opened.stream);
    },
  );

  app.delete("/api/v1/me/submissions/:submissionId", async (request, reply) => {
    const user = authenticatedUser(request);
    if (!user) return reply.code(401).send({ message: "Authentication required." });
    const { submissionId } = z
      .object({ submissionId: z.string().uuid() })
      .parse(request.params);
    const objects = database.deleteReverseSubmission(user.id, submissionId);
    if (!objects) return reply.code(404).send({ message: "Submission not found." });
    await removeStoredObjects(objects);
    return { deleted: true };
  });

  function reverseRequestAccess(
    request: FastifyRequest,
    reply: FastifyReply,
    token: string,
  ): ReverseShareRecord | undefined {
    const entry = database.findReverseShareByToken(hashToken(token));
    if (
      !entry ||
      entry.enabled !== 1 ||
      (entry.expires_at !== null && entry.expires_at <= Date.now()) ||
      entry.submission_count >= entry.max_submissions
    ) {
      void reply.code(404).send({
        message: "This upload request does not exist or is no longer available.",
      });
      return undefined;
    }
    if (
      entry.password_hash &&
      !verifyAccessGrant(
        readCookie(request, "veyra_reverse_grant"),
        entry.id,
        config.secret,
      )
    ) {
      void reply.code(401).send({ message: "Unlock this upload request first." });
      return undefined;
    }
    return entry;
  }

  app.get("/api/v1/reverse/:token", async (request, reply) => {
    const { token } = reversePublicParamsSchema.parse(request.params);
    const entry = database.findReverseShareByToken(hashToken(token));
    if (
      !entry ||
      entry.enabled !== 1 ||
      (entry.expires_at !== null && entry.expires_at <= Date.now()) ||
      entry.submission_count >= entry.max_submissions
    ) {
      return reply.code(404).send({
        message: "This upload request does not exist or is no longer available.",
      });
    }
    const unlocked =
      !entry.password_hash ||
      verifyAccessGrant(
        readCookie(request, "veyra_reverse_grant"),
        entry.id,
        config.secret,
      );
    return {
      title: unlocked ? entry.title : null,
      description: unlocked ? entry.description : null,
      passwordRequired: Boolean(entry.password_hash),
      unlocked,
      expiresAt:
        entry.expires_at === null
          ? null
          : new Date(entry.expires_at).toISOString(),
      maxFiles: entry.max_files,
      maxTotalSize: entry.max_total_size,
      remainingSubmissions:
        entry.max_submissions - entry.submission_count,
    };
  });

  app.post(
    "/api/v1/reverse/:token/unlock",
    {
      config: { rateLimit: { max: 8, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const { token } = reversePublicParamsSchema.parse(request.params);
      const { password } = unlockSchema.parse(request.body);
      const entry = database.findReverseShareByToken(hashToken(token));
      if (
        !entry ||
        entry.enabled !== 1 ||
        (entry.expires_at !== null && entry.expires_at <= Date.now())
      ) {
        return reply.code(404).send({ message: "Upload request not found." });
      }
      const valid =
        !entry.password_hash ||
        (entry.password_salt !== null &&
          (await verifyPassword(
            password,
            entry.password_salt,
            entry.password_hash,
          )));
      if (!valid) {
        return reply.code(401).send({ message: "The password is incorrect." });
      }
      const grant = createAccessGrant(entry.id, config.secret);
      reply.header(
        "Set-Cookie",
        [
          `veyra_reverse_grant=${encodeURIComponent(grant)}`,
          `Path=/api/v1/reverse/${token}`,
          "Max-Age=900",
          "HttpOnly",
          "SameSite=Strict",
          config.VEYRA_SECURE_COOKIES ? "Secure" : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
      return { unlocked: true };
    },
  );

  app.post(
    "/api/v1/reverse/:token/uploads",
    {
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const { token } = reversePublicParamsSchema.parse(request.params);
      const entry = reverseRequestAccess(request, reply, token);
      if (!entry) return;
      const manifest = reverseUploadManifestSchema.parse(request.body);
      const created = await uploadService.createReverseUpload(entry, manifest);
      return reply.code(201).send(created);
    },
  );

  function anonymousUploadSession(
    request: FastifyRequest,
    reply: FastifyReply,
    uploadId: string,
  ): UploadSessionRecord | undefined {
    const raw = request.headers["upload-token"];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) {
      void reply.code(401).send({ message: "Upload token required." });
      return undefined;
    }
    const session = database.findUploadSessionBySecret(
      uploadId,
      hashToken(token),
    );
    if (!session) {
      void reply.code(404).send({ message: "Upload session not found." });
      return undefined;
    }
    if (session.reverse_share_id) {
      const reverse = database.findReverseShareForOwner(
        session.owner_id,
        session.reverse_share_id,
      );
      const owner = database.findUserById(session.owner_id);
      if (
        !reverse ||
        !owner ||
        owner.disabled_at !== null ||
        reverse.enabled !== 1 ||
        (reverse.expires_at !== null && reverse.expires_at <= Date.now())
      ) {
        void reply.code(410).send({
          message: "This upload request is no longer accepting files.",
        });
        return undefined;
      }
    }
    return session;
  }

  app.get("/api/v1/reverse-uploads/:uploadId", async (request, reply) => {
    const { uploadId } = uploadParamsSchema.parse(request.params);
    const session = anonymousUploadSession(request, reply, uploadId);
    if (!session) return;
    return uploadService.status(session);
  });

  app.head(
    "/api/v1/reverse-uploads/:uploadId/files/:fileId",
    async (request, reply) => {
      const { uploadId, fileId } = uploadFileParamsSchema.parse(request.params);
      const session = anonymousUploadSession(request, reply, uploadId);
      if (!session) return;
      const file = database.findUploadFile(uploadId, fileId);
      if (!file) return reply.code(404).send();
      const offset = await uploadService.offset(session, fileId);
      reply.header("Upload-Offset", offset);
      reply.header("Upload-Length", file.expected_size);
      reply.header("Upload-Expires", new Date(session.expires_at).toUTCString());
      return reply.code(204).send();
    },
  );

  app.patch(
    "/api/v1/reverse-uploads/:uploadId/files/:fileId",
    {
      bodyLimit: config.VEYRA_UPLOAD_CHUNK_SIZE,
      config: { rateLimit: { max: 600, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const { uploadId, fileId } = uploadFileParamsSchema.parse(request.params);
      const session = anonymousUploadSession(request, reply, uploadId);
      if (!session) return;
      const offset = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(request.headers["upload-offset"]);
      const length = z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(request.headers["content-length"]);
      const next = await uploadService.append(
        session,
        fileId,
        offset,
        length,
        request.body as Readable,
      );
      reply.header("Upload-Offset", next);
      return reply.code(204).send();
    },
  );

  app.post(
    "/api/v1/reverse-uploads/:uploadId/complete",
    async (request, reply) => {
      const { uploadId } = uploadParamsSchema.parse(request.params);
      const session = anonymousUploadSession(request, reply, uploadId);
      if (!session) return;
      const finalized = await uploadService.finalize(session);
      const effectsClaimed =
        database.claimUploadCompletionEffects(uploadId);
      const submission = finalized.submissionId
        ? database.findReverseSubmission(finalized.submissionId)
        : undefined;
      const reverse = session.reverse_share_id
        ? database.findReverseShareForOwner(
            session.owner_id,
            session.reverse_share_id,
          )
        : undefined;
      const owner = database.findUserById(session.owner_id);
      const emailSettings = loadEmailSettings();
      if (
        effectsClaimed &&
        submission &&
        reverse &&
        owner &&
        emailSettings
      ) {
        try {
          await sendReverseSubmissionEmail(emailSettings, owner.email, {
            requestTitle: reverse.title,
            senderName: submission.sender_name,
            fileCount: submission.file_count,
            totalSize: submission.total_size,
          });
        } catch (error) {
          request.log.warn(
            { err: error, submissionId: submission.id },
            "Reverse submission notification failed",
          );
        }
      }
      if (effectsClaimed) {
        database.audit(
          null,
          "reverse_submission.received",
          anonymizeIp(request.ip, config.ipSalt),
          {
            requestId: session.reverse_share_id,
            submissionId: finalized.submissionId,
            fileCount: session.file_count,
          },
        );
      }
      return { received: true, scanStatus: finalized.scanStatus };
    },
  );

  app.delete(
    "/api/v1/reverse-uploads/:uploadId",
    async (request, reply) => {
      const { uploadId } = uploadParamsSchema.parse(request.params);
      const session = anonymousUploadSession(request, reply, uploadId);
      if (!session) return;
      await uploadService.cancel(session);
      return { cancelled: true };
    },
  );

  function availableShare(
    token: string,
    request: FastifyRequest,
    reply: FastifyReply,
    requireUnlock: boolean,
  ) {
    const share = database.findShareByToken(hashToken(token));
    if (
      !share ||
      share.status !== "ready" ||
      isExpired(share.expires_at)
    ) {
      void reply.code(404).send({
        message: "This share does not exist, is not ready, or has expired.",
      });
      return undefined;
    }
    if (
      share.max_downloads !== null &&
      share.download_count >= share.max_downloads
    ) {
      void reply.code(410).send({
        message: "This share reached its download limit.",
      });
      return undefined;
    }
    if (
      requireUnlock &&
      share.password_hash &&
      !verifyAccessGrant(readGrant(request), share.id, config.secret)
    ) {
      void reply.code(401).send({ message: "Unlock this share first." });
      return undefined;
    }
    return share;
  }

  app.get("/api/v1/shares/:token", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.params);
    const share = availableShare(token, request, reply, false);
    if (!share) return;
    const passwordRequired = share.password_hash !== null;
    const unlocked =
      !passwordRequired ||
      verifyAccessGrant(readGrant(request), share.id, config.secret);
    return {
      createdAt: new Date(share.created_at).toISOString(),
      expiresAt:
        share.expires_at === null ? null : new Date(share.expires_at).toISOString(),
      note: unlocked ? share.note : null,
      title: unlocked ? share.title : null,
      description: unlocked ? share.description ?? share.note : null,
      passwordRequired,
      unlocked,
      downloads: share.download_count,
      maxDownloads: share.max_downloads,
      downloadAllUrl: unlocked
        ? `/api/v1/shares/${encodeURIComponent(token)}/download-all`
        : null,
      qrUrl: `/api/v1/shares/${encodeURIComponent(token)}/qr`,
      files: unlocked
        ? database.listFiles(share.id).map((file) => ({
            ...publicFile(file),
            directUrl: `/api/v1/shares/${encodeURIComponent(token)}/files/${file.id}`,
            previewUrl: isPreviewable(file.mime_type)
              ? `/api/v1/shares/${encodeURIComponent(token)}/files/${file.id}/preview`
              : null,
          }))
        : [],
    };
  });

  app.get("/api/v1/shares/:token/qr", async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.params);
    const share = availableShare(token, request, reply, false);
    if (!share) return;
    const svg = await QRCode.toString(
      new URL(`/s/${token}`, config.VEYRA_BASE_URL).toString(),
      { type: "svg", margin: 1, width: 360, errorCorrectionLevel: "M" },
    );
    reply.header("Content-Type", "image/svg+xml; charset=utf-8");
    reply.header("Cache-Control", "private, no-store");
    reply.header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return reply.send(svg);
  });

  app.post(
    "/api/v1/shares/:token/unlock",
    {
      config: {
        rateLimit: { max: 8, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(20).max(100) }).parse(request.params);
      const body = unlockSchema.parse(request.body);
      const share = database.findShareByToken(hashToken(token));
      const ipHash = anonymizeIp(request.ip, config.ipSalt);

      if (!share || share.status !== "ready" || isExpired(share.expires_at)) {
        return reply.code(404).send({ message: "This share does not exist or has expired." });
      }
      if (!share.password_hash || !share.password_salt) {
        return { grant: createAccessGrant(share.id, config.secret) };
      }

      const valid = await verifyPassword(
        body.password,
        share.password_salt,
        share.password_hash,
      );
      database.audit(share.id, valid ? "share.unlocked" : "share.unlock_failed", ipHash);

      if (!valid) {
        return reply.code(401).send({ message: "The password is incorrect." });
      }
      const grant = createAccessGrant(share.id, config.secret);
      reply.header(
        "Set-Cookie",
        [
          `veyra_grant=${encodeURIComponent(grant)}`,
          `Path=/api/v1/shares/${token}`,
          "Max-Age=900",
          "HttpOnly",
          "SameSite=Strict",
          config.VEYRA_SECURE_COOKIES ? "Secure" : "",
        ]
          .filter(Boolean)
          .join("; "),
      );
      return { grant };
    },
  );

  app.get("/api/v1/shares/:token/files/:fileId", async (request, reply) => {
    const { token, fileId } = z
      .object({
        token: z.string().min(20).max(100),
        fileId: z.string().uuid(),
      })
      .parse(request.params);
    const share = availableShare(token, request, reply, true);
    if (!share) return;

    const file = database.findFile(share.id, fileId);
    if (
      !file ||
      file.storage_provider === "quarantine" ||
      !["clean", "disabled"].includes(file.scan_status)
    ) {
      return reply.code(404).send({ message: "File not found." });
    }
    if (!database.consumeDownload(share.id)) {
      return reply.code(410).send({ message: "This share reached its download limit." });
    }

    database.audit(
      share.id,
      "file.downloaded",
      anonymizeIp(request.ip, config.ipSalt),
      { fileId: file.id },
    );
    reply.header("Content-Type", "application/octet-stream");
    reply.header("Content-Length", file.size);
    reply.header("Content-Disposition", contentDisposition(file.original_name));
    reply.header("Cache-Control", "private, no-store");
    const opened = await storage.open(file.storage_provider, file.stored_name);
    return reply.send(opened.stream);
  });

  app.get(
    "/api/v1/shares/:token/files/:fileId/preview",
    async (request, reply) => {
      const { token, fileId } = z
        .object({
          token: z.string().min(20).max(100),
          fileId: z.string().uuid(),
        })
        .parse(request.params);
      const share = availableShare(token, request, reply, true);
      if (!share) return;
      const file = database.findFile(share.id, fileId);
      if (
        !file ||
        file.storage_provider === "quarantine" ||
        !["clean", "disabled"].includes(file.scan_status) ||
        !isPreviewable(file.mime_type)
      ) {
        return reply.code(404).send({ message: "Preview not available." });
      }
      const size = await storage.size(file.storage_provider, file.stored_name);
      const range = parseByteRange(
        Array.isArray(request.headers.range)
          ? request.headers.range[0]
          : request.headers.range,
        size,
      );
      const opened = await storage.open(
        file.storage_provider,
        file.stored_name,
        range,
      );
      reply.header("Accept-Ranges", "bytes");
      reply.header("Content-Type", file.mime_type);
      reply.header(
        "Content-Disposition",
        contentDisposition(file.original_name, "inline"),
      );
      reply.header("Cache-Control", "private, no-store");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'",
      );
      if (opened.range) {
        reply.code(206);
        reply.header(
          "Content-Range",
          `bytes ${opened.range.start}-${opened.range.end}/${opened.size}`,
        );
        reply.header(
          "Content-Length",
          opened.range.end - opened.range.start + 1,
        );
      } else {
        reply.header("Content-Length", opened.size);
      }
      return reply.send(opened.stream);
    },
  );

  app.get("/api/v1/shares/:token/download-all", async (request, reply) => {
    const { token } = z
      .object({ token: z.string().min(20).max(100) })
      .parse(request.params);
    const share = availableShare(token, request, reply, true);
    if (!share) return;
    const files = database
      .listFiles(share.id)
      .filter(
        (file) =>
          file.storage_provider !== "quarantine" &&
          ["clean", "disabled"].includes(file.scan_status),
      );
    if (files.length === 0) {
      return reply.code(404).send({ message: "No downloadable files found." });
    }
    if (!database.consumeDownload(share.id)) {
      return reply.code(410).send({ message: "This share reached its download limit." });
    }
    const archive = new ZipArchive({
      zlib: { level: 0 },
      forceZip64: files.reduce((total, file) => total + file.size, 0) >= 4_000_000_000,
    });
    archive.on("warning", (error: Error) => {
      request.log.warn({ err: error, shareId: share.id }, "Archive warning");
    });
    archive.on("error", (error: Error) => {
      request.log.error({ err: error, shareId: share.id }, "Archive failed");
    });
    for (const file of files) {
      const lazyStream = Readable.from(
        (async function* () {
          const opened = await storage.open(
            file.storage_provider,
            file.stored_name,
          );
          for await (const chunk of opened.stream) {
            yield chunk;
          }
        })(),
      );
      archive.append(lazyStream, {
        name: archivePath(file.relative_path, file.original_name),
        date: new Date(share.created_at),
      });
    }
    void archive.finalize();
    database.audit(
      share.id,
      "share.archive_downloaded",
      anonymizeIp(request.ip, config.ipSalt),
      { fileCount: files.length },
    );
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", contentDisposition("veyra-share.zip"));
    reply.header("Cache-Control", "private, no-store");
    return reply.send(archive);
  });

  if (existsSync(webRoot)) {
    app.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
      cacheControl: true,
      maxAge: config.NODE_ENV === "production" ? "1h" : 0,
      immutable: false,
      setHeaders(reply, path) {
        if (path.endsWith("index.html")) {
          reply.header("Cache-Control", "no-store");
        }
      },
    });
  }

  app.setErrorHandler((error, request, reply) => {
    const normalized = error instanceof Error ? error : new Error("Unknown error");
    const candidate = normalized as Error & {
      statusCode?: number;
      code?: string;
      uploadOffset?: number;
    };
    const statusCode =
      error instanceof z.ZodError
        ? 400
        : typeof candidate.statusCode === "number"
          ? candidate.statusCode
          : 500;
    request.log.warn(
      {
        err: error,
        method: request.method,
        path: request.url.split("?", 1)[0] || "/",
        ip: request.ip,
        statusCode,
      },
      "Request failed",
    );
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        message: "The request contains invalid data.",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    if (typeof candidate.uploadOffset === "number") {
      reply.header("Upload-Offset", candidate.uploadOffset);
    }
    return reply.code(statusCode).send({
      message:
        statusCode === 500
          ? "An unexpected error occurred."
          : normalized.message,
      code: candidate.code,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    if (
      request.method === "GET" &&
      !request.url.startsWith("/api/") &&
      existsSync(join(webRoot, "index.html"))
    ) {
      reply.header("Cache-Control", "no-store");
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ message: "Not found." });
  });

  return app;
}
