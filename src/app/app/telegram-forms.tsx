"use client";

import { type RefCallback, useActionState, useCallback, useId, useRef } from "react";
import { Spinner } from "@/app/spinner";
import { primaryButton, secondaryButton } from "@/app/ui";
import { GENERIC_ERROR } from "@/lib/auth";
import { telegramStartLink } from "@/lib/telegram";
import { withFallback } from "@/lib/with-fallback";
import { checkTelegramLink, createTelegramLinkCode, unlinkTelegram } from "./actions";
import { ErrorMessage } from "./habit-forms";

const failed = { ok: false, error: GENERIC_ERROR } as const;
const linkCodeAction = withFallback(createTelegramLinkCode, failed);
const unlinkAction = withFallback(unlinkTelegram, failed);
const checkAction = withFallback(checkTelegramLink, failed);

const NOT_LINKED_YET = "Todavía no está vinculado. Envía el código al bot.";

type CodeState = { code: string | null; error: string | null };
type SwapProps = { focusAfterSwap: RefCallback<HTMLButtonElement>; willSwap: (swap: boolean) => void };

// «Comprobar vinculación» and «Desvincular» swap the view and take their own button away: focus goes to the main
// button of the new view instead of the page body. Only after the user's action, never on page load.
export function TelegramLink({ bot, linkedSince }: { bot: string; linkedSince: string | null }) {
  const swapping = useRef(false);
  const focusAfterSwap = useCallback((button: HTMLButtonElement | null) => {
    if (button && swapping.current) {
      swapping.current = false;
      button.focus();
    }
  }, []);
  const willSwap = useCallback((swap: boolean) => {
    swapping.current = swap;
  }, []);

  return linkedSince ? (
    <Linked since={linkedSince} focusAfterSwap={focusAfterSwap} willSwap={willSwap} />
  ) : (
    <Unlinked bot={bot} focusAfterSwap={focusAfterSwap} willSwap={willSwap} />
  );
}

function Unlinked({ bot, focusAfterSwap, willSwap }: SwapProps & { bot: string }) {
  // A failed request keeps the code on screen: it is still the valid one.
  const [state, requestCode, requesting] = useActionState(
    async (prev: CodeState): Promise<CodeState> => {
      const result = await linkCodeAction();
      return result.ok ? { code: result.code, error: null } : { code: prev.code, error: result.error };
    },
    { code: null, error: null },
  );
  const id = useId();

  return (
    <div className="mt-2 flex flex-col items-start gap-4">
      <p className="text-neutral-700">Marca tus hábitos de hoy desde Telegram.</p>
      <form action={requestCode} className="flex flex-col items-start gap-2">
        <button
          ref={focusAfterSwap}
          type="submit"
          disabled={requesting}
          className={state.code ? secondaryButton : primaryButton}
        >
          {requesting && <Spinner />}
          Vincular con Telegram
        </button>
        <ErrorMessage id={`${id}-error`} error={state.error} />
      </form>
      {state.code && (
        <div className="flex w-full flex-col items-start gap-3 border-t border-neutral-200 pt-4">
          <a
            href={telegramStartLink(bot, state.code)}
            target="_blank"
            rel="noopener noreferrer"
            className={primaryButton}
          >
            Abrir Telegram
          </a>
          <p className="flex items-baseline gap-2">
            <span id={`${id}-code`} className="font-medium text-neutral-900">
              Código
            </span>
            <output aria-labelledby={`${id}-code`} className="font-mono text-xl font-semibold tracking-widest text-neutral-900">
              {state.code}
            </output>
          </p>
          <p className="text-sm text-neutral-700">
            Caduca en 10 minutos. También puedes enviar <code className="font-mono">{`/vincular ${state.code}`}</code> al
            bot.
          </p>
          <CheckLink key={state.code} willSwap={willSwap} />
        </div>
      )}
    </div>
  );
}

// Keyed by the code: a new code starts without the previous check's message.
function CheckLink({ willSwap }: Pick<SwapProps, "willSwap">) {
  const [message, check, checking] = useActionState(async (): Promise<string | null> => {
    willSwap(true);
    const result = await checkAction();
    if (result.ok && result.linked) return null;
    willSwap(false);
    return result.ok ? NOT_LINKED_YET : result.error;
  }, null);
  const id = useId();

  return (
    <form action={check} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={checking} className={secondaryButton}>
        {checking && <Spinner />}
        Comprobar vinculación
      </button>
      <ErrorMessage id={`${id}-message`} error={message} />
    </form>
  );
}

function Linked({ since, focusAfterSwap, willSwap }: SwapProps & { since: string }) {
  const [error, unlink, unlinking] = useActionState(async (): Promise<string | null> => {
    willSwap(true);
    const result = await unlinkAction();
    if (result.ok) return null;
    willSwap(false);
    return result.error;
  }, null);
  const id = useId();

  return (
    <form action={unlink} className="mt-2 flex flex-col items-start gap-4">
      <p className="text-neutral-700">Vinculado con Telegram desde el {since}.</p>
      <button ref={focusAfterSwap} type="submit" disabled={unlinking} className={secondaryButton}>
        {unlinking && <Spinner />}
        Desvincular
      </button>
      <ErrorMessage id={`${id}-error`} error={error} />
    </form>
  );
}
