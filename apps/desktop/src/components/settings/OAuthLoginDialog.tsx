/**
 * Vendor-account login (ADR 0095). Every flow — PKCE with a local callback,
 * device code, a pasted code — arrives through the same event stream, so this
 * dialog renders whatever the vendor asked for rather than a per-vendor script.
 *
 * The dialog starts the login itself, from inside the effect that subscribes to
 * the stream, because a flow can ask its first question before the start call
 * returns; see `beginOAuthLogin`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OAuthPromptRequest, OAuthVendor } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import {
  beginOAuthLogin,
  type OAuthLoginSession,
} from "../../lib/oauth-login-session";
import { Button, Input, cx } from "../ui";
import { IconCheck, IconCopy, IconExternal } from "../icons";

type AuthUrlState = { url: string; instructions?: string; opened: boolean };

type DeviceCodeState = {
  userCode: string;
  verificationUri: string;
};

export function OAuthLoginDialog({
  vendor,
  onDone,
  onClose,
}: {
  vendor: OAuthVendor;
  /** The login succeeded; the provider row is ready to use. */
  onDone: (accountLabel?: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<string>(t("settings.vendorLoginStarting"));
  const [authUrl, setAuthUrl] = useState<AuthUrlState | null>(null);
  const [deviceCode, setDeviceCode] = useState<DeviceCodeState | null>(null);
  const [prompt, setPrompt] = useState<OAuthPromptRequest | null>(null);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const session = useRef<OAuthLoginSession | null>(null);
  // The login is started once, from the subscribing effect. Callers pass fresh
  // closures on every render, so they are read through refs rather than
  // re-running the effect — a second run would start a second login.
  const handlers = useRef({ onDone, onClose });
  handlers.current = { onDone, onClose };

  useEffect(() => {
    const login = beginOAuthLogin({
      api,
      vendorId: vendor.vendorId,
      onError: (message) => setError(message),
      onEvent: (event) => {
        switch (event.kind) {
          case "info":
          case "progress":
            setStatus(event.message);
            break;
          case "authUrl":
            setAuthUrl({
              url: event.url,
              instructions: event.instructions,
              opened: event.opened,
            });
            break;
          case "deviceCode":
            setDeviceCode({
              userCode: event.userCode,
              verificationUri: event.verificationUri,
            });
            break;
          case "prompt":
            setAnswer("");
            setPrompt(event.request);
            break;
          case "promptCancelled":
            // The flow answered the step itself — a callback that beat the
            // paste box — so the input has to go away on its own.
            setPrompt((current) =>
              current?.promptId === event.promptId ? null : current,
            );
            break;
          case "done":
            handlers.current.onDone(event.accountLabel);
            break;
          case "error":
            setPrompt(null);
            setError(event.message);
            break;
          case "cancelled":
            handlers.current.onClose();
            break;
        }
      },
    });
    session.current = login;
    return () => {
      session.current = null;
      login.dispose();
    };
  }, [vendor.vendorId]);

  const cancel = useCallback(async () => {
    if (closing) return;
    setClosing(true);
    try {
      // Aborts the local callback server or the device-code polling. The
      // `cancelled` event closes this dialog; a login main no longer knows
      // about is already over, so close directly.
      const cancelled = await session.current?.cancel();
      if (!cancelled) onClose();
    } catch {
      onClose();
    }
  }, [closing, onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (error) onClose();
      else void cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cancel, error, onClose]);

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(value);
        setTimeout(() => setCopied((current) => (current === value ? null : current)), 1500);
      },
      () => undefined,
    );
  };

  const submitAnswer = (value: string) => {
    if (!prompt) return;
    const promptId = prompt.promptId;
    setPrompt(null);
    void session.current
      ?.respond(promptId, value)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="overlay provider-dialog-overlay" role="presentation">
      <div
        className="dialog oauth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="oauth-dialog-title"
      >
        <h3 id="oauth-dialog-title" className="provider-dialog-title">
          {vendor.loginLabel || t("settings.vendorSignInTo", { vendor: vendor.name })}
        </h3>

        {error ? (
          <div className="oauth-error">{error}</div>
        ) : (
          <>
            <div className="oauth-status">{status}</div>

            {authUrl ? (
              <div className="oauth-block">
                <div className="oauth-block-text">
                  {authUrl.instructions ||
                    t(
                      authUrl.opened
                        ? "settings.vendorBrowserOpened"
                        : "settings.vendorBrowserFailed",
                    )}
                </div>
                <div className="oauth-inline-actions">
                  <Button size="sm" variant="ghost" onClick={() => copy(authUrl.url)}>
                    <span className="oauth-btn-inner">
                      {copied === authUrl.url ? (
                        <IconCheck size={13} />
                      ) : (
                        <IconCopy size={13} />
                      )}
                      <span>{t("settings.vendorCopyLink")}</span>
                    </span>
                  </Button>
                  <a
                    className="oauth-link"
                    href={authUrl.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <IconExternal size={13} />
                    <span>{t("settings.vendorOpenAgain")}</span>
                  </a>
                </div>
              </div>
            ) : null}

            {deviceCode ? (
              <div className="oauth-block">
                <div className="oauth-block-text">
                  {t("settings.vendorDeviceCodeHint")}
                </div>
                <button
                  type="button"
                  className="oauth-device-code font-mono"
                  title={t("settings.vendorCopyCode")}
                  onClick={() => copy(deviceCode.userCode)}
                >
                  <span>{deviceCode.userCode}</span>
                  {copied === deviceCode.userCode ? (
                    <IconCheck size={14} />
                  ) : (
                    <IconCopy size={14} />
                  )}
                </button>
                <a
                  className="oauth-link"
                  href={deviceCode.verificationUri}
                  target="_blank"
                  rel="noreferrer"
                >
                  <IconExternal size={13} />
                  <span>{deviceCode.verificationUri}</span>
                </a>
              </div>
            ) : null}

            {prompt ? (
              <div className="oauth-block">
                <div className="oauth-block-text">{prompt.message}</div>
                {prompt.type === "select" ? (
                  <div className="oauth-options">
                    {(prompt.options ?? []).map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className="oauth-option"
                        onClick={() => submitAnswer(option.id)}
                      >
                        <span className="oauth-option-label">{option.label}</span>
                        {option.description ? (
                          <span className="oauth-option-desc">{option.description}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <form
                    className="oauth-answer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (answer.trim()) submitAnswer(answer.trim());
                    }}
                  >
                    <Input
                      type={prompt.type === "secret" ? "password" : "text"}
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      placeholder={prompt.placeholder}
                      className={cx(
                        prompt.type === "manual_code" && "font-mono text-sm-plus",
                      )}
                      autoComplete="off"
                      autoFocus
                    />
                    <Button type="submit" variant="primary" disabled={!answer.trim()}>
                      {t("settings.vendorSubmit")}
                    </Button>
                  </form>
                )}
              </div>
            ) : null}
          </>
        )}

        <div className="provider-dialog-actions">
          {error ? (
            <Button variant="ghost" onClick={onClose}>
              {t("settings.close")}
            </Button>
          ) : (
            <Button variant="ghost" disabled={closing} onClick={() => void cancel()}>
              {t("settings.cancel")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
