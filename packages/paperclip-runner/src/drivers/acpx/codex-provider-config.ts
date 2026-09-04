interface ParsedAcpxCodexProviderConfig {
  providers: Record<string, Record<string, unknown>>;
  modelProvider: string | null;
}

const ENV_PLACEHOLDER_RE = /\{env:[A-Za-z_][A-Za-z0-9_]*\}/;
const BARE_TOML_KEY_RE = /^[A-Za-z0-9_-]+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAcpxCodexProviderConfig(
  raw: unknown,
): ParsedAcpxCodexProviderConfig | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS contains invalid JSON.",
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      "ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS must be a JSON object.",
    );
  }
  if (!isPlainObject(parsed.providers)) {
    throw new Error(
      'ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS must include a "providers" object.',
    );
  }

  const providers: Record<string, Record<string, unknown>> = {};
  for (const [providerName, providerConfig] of Object.entries(parsed.providers)) {
    if (providerName.trim().length === 0) {
      throw new Error(
        "ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS providers must use non-empty names.",
      );
    }
    if (!isPlainObject(providerConfig) || Object.keys(providerConfig).length === 0) {
      throw new Error(
        `ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS provider "${providerName}" must be a non-empty object.`,
      );
    }
    ensureNoEnvPlaceholders(providerConfig, `providers.${providerName}`);
    providers[providerName] = providerConfig;
  }
  if (Object.keys(providers).length === 0) {
    throw new Error(
      "ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS providers must contain at least one entry.",
    );
  }

  const modelProvider =
    typeof parsed.model_provider === "string" && parsed.model_provider.trim().length > 0
      ? parsed.model_provider.trim()
      : null;
  if (modelProvider !== null && !(modelProvider in providers)) {
    throw new Error(
      `ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS model_provider "${modelProvider}" does not match a configured provider.`,
    );
  }

  return { providers, modelProvider };
}

export function renderAcpxCodexProviderConfigToml(
  config: ParsedAcpxCodexProviderConfig,
): string {
  const lines: string[] = [];
  if (config.modelProvider !== null) {
    lines.push(`model_provider = ${tomlString(config.modelProvider)}`, "");
  }
  for (const [providerName, providerConfig] of Object.entries(config.providers)) {
    lines.push(`[model_providers.${tomlKey(providerName)}]`);
    for (const [field, value] of Object.entries(providerConfig)) {
      lines.push(`${tomlKey(field)} = ${tomlValue(value, `providers.${providerName}.${field}`)}`);
    }
    lines.push("");
  }
  while (lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

function ensureNoEnvPlaceholders(value: unknown, path: string): void {
  if (typeof value === "string") {
    if (ENV_PLACEHOLDER_RE.test(value)) {
      throw new Error(
        `ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS ${path} uses {env:VAR} placeholders, which are not supported in ACPX. Use env_key with an allowlisted credential variable instead.`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      ensureNoEnvPlaceholders(entry, `${path}[${index}]`);
    }
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      ensureNoEnvPlaceholders(entry, `${path}.${key}`);
    }
  }
}

function tomlKey(key: string): string {
  return BARE_TOML_KEY_RE.test(key) ? key : tomlString(key);
}

function tomlString(value: string): string {
  return `"${escapeTomlString(value)}"`;
}

function escapeTomlString(value: string): string {
  return value.replace(/[\\"\u0000-\u001f\u007f]/g, (char) => {
    switch (char) {
      case "\\":
        return "\\\\";
      case '"':
        return '\\"';
      case "\n":
        return "\\n";
      case "\r":
        return "\\r";
      case "\t":
        return "\\t";
      default:
        return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    }
  });
}

function tomlValue(value: unknown, path: string): string {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isFinite(value)) return String(value);
    throw new Error(
      `ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS ${path} uses a non-finite number.`,
    );
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry, index) => tomlValue(entry, `${path}[${index}]`));
    return `[${entries.join(", ")}]`;
  }
  if (isPlainObject(value)) {
    const pairs = Object.entries(value).map(
      ([key, entry]) => `${tomlKey(key)} = ${tomlValue(entry, `${path}.${key}`)}`,
    );
    return `{ ${pairs.join(", ")} }`;
  }
  throw new Error(
    `ACPX admission rejected: PAPERCLIP_CODEX_PROVIDERS ${path} uses an unsupported value type.`,
  );
}
