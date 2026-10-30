// The vault is protected by a passphrase and locked: ask for it once, here.
// The AI settings load afterwards, so the AI SDK stays out of the first load.

import { KeyVaultError } from "llm-connect";
import { useState } from "react";
import { useLang } from "../i18n.ts";
import { resetVault, vault } from "../secrets.ts";
import { Field, Notice } from "../ui/kit.tsx";

export function Unlock() {
  const { t } = useLang();
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="page narrow">
      <h1>{t("Unlock your keys", "Déverrouiller vos clés", "Schlüssel entsperren")}</h1>
      <p className="lead">
        {t(
          "Your AI keys and your GitHub token are protected by your passphrase. Your courses stay readable without it.",
          "Vos clés d'IA et votre jeton GitHub sont protégés par votre phrase de passe. Vos cours restent lisibles sans elle.",
          "Ihre KI-Schlüssel und Ihr GitHub-Token sind durch Ihre Passphrase geschützt. Ihre Kurse bleiben auch ohne sie lesbar.",
        )}
      </p>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await vault.unlock(pass);
            await (await import("../ai/llm.ts")).reloadLlm();
          } catch (err) {
            setError(err instanceof KeyVaultError && err.code === "wrong-passphrase" ? t("Wrong passphrase.", "Phrase de passe incorrecte.", "Falsche Passphrase.") : String((err as Error).message));
          }
        }}
      >
        <Field label={t("Passphrase", "Phrase de passe", "Passphrase")}>
          <input type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.currentTarget.value)} required />
        </Field>
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div className="row">
          <button type="submit" className="primary">
            {t("Unlock", "Déverrouiller", "Entsperren")}
          </button>
        </div>
      </form>
      <details className="disclosure">
        <summary>{t("Forgot the passphrase?", "Phrase de passe oubliée ?", "Passphrase vergessen?")}</summary>
        <p>
          {t(
            "It cannot be recovered. You can delete the keys and the token (not your courses) and enter them again.",
            "Elle ne peut pas être récupérée. Vous pouvez supprimer les clés et le jeton (pas vos cours) et les saisir à nouveau.",
            "Sie kann nicht wiederhergestellt werden. Sie können die Schlüssel und das Token löschen (nicht Ihre Kurse) und neu eingeben.",
          )}
        </p>
        {confirmReset ? (
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await resetVault();
              await (await import("../ai/llm.ts")).reloadLlm();
            }}
          >
            {t("Delete every key and token", "Supprimer toutes les clés et le jeton", "Alle Schlüssel und das Token löschen")}
          </button>
        ) : (
          <button type="button" className="secondary" onClick={() => setConfirmReset(true)}>
            {t("Delete the keys…", "Supprimer les clés…", "Schlüssel löschen…")}
          </button>
        )}
      </details>
    </div>
  );
}
