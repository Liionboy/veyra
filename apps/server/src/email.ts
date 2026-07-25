import nodemailer from "nodemailer";

export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export interface ShareEmailDetails {
  title: string | null;
  description: string | null;
  url: string;
  expiresAt: string | null;
  password?: string | null;
}

export interface ShareEmailContent {
  subject: string;
  text: string;
  html: string;
}

function transportFor(settings: EmailSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth:
      settings.user && settings.password
        ? { user: settings.user, pass: settings.password }
        : undefined,
    tls: { rejectUnauthorized: true },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character]!,
  );
}

export async function verifyEmailSettings(settings: EmailSettings): Promise<void> {
  await transportFor(settings).verify();
}

export async function sendPasswordReset(
  settings: EmailSettings,
  recipient: string,
  resetUrl: string,
): Promise<void> {
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    subject: "Reset your Veyra password",
    text: `A password reset was requested for your Veyra account.\n\nOpen this link within 30 minutes:\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171923">
        <h1 style="font-size:24px">Reset your Veyra password</h1>
        <p>A password reset was requested for your Veyra account.</p>
        <p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#755cff;color:#fff;text-decoration:none">Reset password</a></p>
        <p style="color:#687083;font-size:13px">This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendEmailVerification(
  settings: EmailSettings,
  recipient: string,
  verificationUrl: string,
): Promise<void> {
  const safeUrl = escapeHtml(verificationUrl);
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    subject: "Verify your Veyra account",
    text: `Welcome to Veyra.\n\nVerify your email address within 24 hours:\n${verificationUrl}\n\nIf you did not create this account, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#171923">
        <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#755cff">Veyra account security</p>
        <h1 style="font-size:24px">Verify your email address</h1>
        <p>Confirm this address to activate your Veyra account.</p>
        <p><a href="${safeUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#755cff;color:#fff;text-decoration:none;font-weight:700">Verify email</a></p>
        <p style="color:#687083;font-size:13px">This one-time link expires in 24 hours. If you did not create this account, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendTestEmail(
  settings: EmailSettings,
  recipient: string,
): Promise<void> {
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    subject: "Veyra email configuration works",
    text: "Your Veyra SMTP configuration is working correctly.",
  });
}

export function buildShareEmail(share: ShareEmailDetails): ShareEmailContent {
  const title = (share.title || "Files shared with you").replace(
    /[\r\n]+/g,
    " ",
  );
  const expiry = share.expiresAt
    ? `This link expires on ${new Date(share.expiresAt).toLocaleString("en-GB", {
        dateStyle: "long",
        timeStyle: "short",
        timeZone: "UTC",
      })} UTC.`
    : "This link does not expire automatically.";
  const description = share.description?.trim() || "";
  const passwordText = share.password
    ? [
        "Share password (included at the sender's request):",
        share.password,
        "Security note: this email contains both the share link and its password.",
      ]
    : ["The link may require a password supplied separately by the sender."];
  const passwordHtml = share.password
    ? `
        <div style="margin:18px 0;padding:14px 16px;border-radius:10px;background:#f4f1ff">
          <p style="margin:0 0 7px;color:#454b59;font-size:13px">Share password (included at the sender's request)</p>
          <code style="font-size:16px;font-weight:700;word-break:break-all;color:#171923">${escapeHtml(share.password)}</code>
        </div>
        <p style="color:#8a5a00;font-size:13px">Security note: this email contains both the share link and its password.</p>
      `
    : '<p style="color:#687083;font-size:13px">The link may require a password supplied separately by the sender.</p>';

  return {
    subject: `${title} · Veyra`,
    text: [
      title,
      description,
      "Open the secure share:",
      share.url,
      expiry,
      ...passwordText,
    ]
      .filter(Boolean)
      .join("\n\n"),
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#171923">
        <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#755cff">Secure delivery from Veyra</p>
        <h1 style="font-size:26px;line-height:1.2">${escapeHtml(title)}</h1>
        ${description ? `<p style="font-size:15px;line-height:1.6;color:#454b59;white-space:pre-wrap">${escapeHtml(description)}</p>` : ""}
        <p><a href="${escapeHtml(share.url)}" style="display:inline-block;padding:13px 19px;border-radius:10px;background:#755cff;color:#fff;text-decoration:none;font-weight:700">Open secure share</a></p>
        <p style="color:#687083;font-size:13px">${escapeHtml(expiry)}</p>
        ${passwordHtml}
      </div>
    `,
  };
}

export async function sendShareEmail(
  settings: EmailSettings,
  recipient: string,
  share: ShareEmailDetails,
): Promise<void> {
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    ...buildShareEmail(share),
  });
}

export async function sendInvitationEmail(
  settings: EmailSettings,
  recipient: string,
  invitationUrl: string,
  instanceName = "Veyra",
): Promise<void> {
  const safeName = instanceName.replace(/[\r\n]+/g, " ").slice(0, 80);
  const safeUrl = escapeHtml(invitationUrl);
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    subject: `You are invited to ${safeName}`,
    text: `You were invited to create an account on ${safeName}.\n\nChoose your own password using this one-time link:\n${invitationUrl}\n\nIf you were not expecting this invitation, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#171923">
        <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#755cff">${escapeHtml(safeName)}</p>
        <h1 style="font-size:26px;line-height:1.2">You are invited</h1>
        <p>Create your account and choose your own password. Veyra never sends passwords by email.</p>
        <p><a href="${safeUrl}" style="display:inline-block;padding:13px 19px;border-radius:10px;background:#755cff;color:#fff;text-decoration:none;font-weight:700">Accept invitation</a></p>
        <p style="color:#687083;font-size:13px">If you were not expecting this invitation, you can ignore this message.</p>
      </div>
    `,
  });
}

export async function sendReverseSubmissionEmail(
  settings: EmailSettings,
  recipient: string,
  value: {
    requestTitle: string;
    senderName: string | null;
    fileCount: number;
    totalSize: number;
  },
): Promise<void> {
  const sender = value.senderName?.trim() || "Someone";
  await transportFor(settings).sendMail({
    from: { name: settings.fromName, address: settings.fromAddress },
    to: recipient,
    subject: `New upload received · ${value.requestTitle.replace(/[\r\n]+/g, " ")}`,
    text: `${sender} uploaded ${value.fileCount} file(s) (${value.totalSize} bytes) through your Veyra upload request. Sign in to review the private submission.`,
  });
}
