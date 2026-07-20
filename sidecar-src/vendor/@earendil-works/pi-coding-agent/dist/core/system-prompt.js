/**
 * System prompt construction and project context loading
 */
/** Build the system prompt — Fase C.1: personalizzato per Dashboard
 *
 * Le chat normali NON hanno working directory. Il modello può solo:
 * - rispondere all'utente
 * - consultare file che l'utente fornisce esplicitamente
 *
 * Il system prompt contiene SOLO:
 * - Data e ora corrente
 *
 * Niente cwd, niente project_context, niente skills, niente guidelines Pi SDK,
 * niente documentazione Pi, niente lista tool (i tool sono passati via API, non nel prompt).
 */
export function buildSystemPrompt(options) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const date = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    let prompt = `Current date: ${date}`;
    return prompt;
}
//# sourceMappingURL=system-prompt.js.map