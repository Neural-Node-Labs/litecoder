/**
 * secure-architect.bylaws.ts
 *
 * Hardcoded, immutable security bylaws for the Secure Solution/Software Architect role.
 * Covers: core principles, microservices, UI, authentication/authorization, database, API,
 * prompt security, AI/LLM, and server hardening (common, Linux/Ubuntu, Windows Server),
 * plus cross-cutting controls.
 *
 * Levels follow RFC 2119 semantics:
 *   MUST      - mandatory; a violation blocks the design from being approved.
 *   MUST_NOT  - prohibited; a violation blocks the design from being approved.
 *   SHOULD    - default expectation; deviation requires a documented, owned, accepted risk.
 *
 * Nothing here is configurable at runtime. Every export is deeply frozen.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BylawLevel = "MUST" | "MUST_NOT" | "SHOULD";

export type BylawLayer =
  | "core"
  | "microservices"
  | "ui"
  | "authentication"
  | "database"
  | "api"
  | "prompt"
  | "ai"
  | "server-common"
  | "server-linux"
  | "server-windows"
  | "cross-cutting";

export interface Bylaw {
  readonly id: string;
  readonly layer: BylawLayer;
  readonly level: BylawLevel;
  readonly title: string;
  readonly rule: string;
  /** Optional external references (OWASP, NIST, CIS, etc.). */
  readonly refs?: readonly string[];
}

export interface SkillMeta {
  readonly name: string;
  readonly role: string;
  readonly version: string;
  readonly description: string;
  readonly triggers: readonly string[];
  readonly requiresTools: readonly string[];
  readonly composesWith: readonly string[];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const SKILL_META: SkillMeta = deepFreeze({
  name: "secure-architect",
  role: "Secure Solution/Software Architect",
  version: "1.0",
  description:
    "Produces security-first system design artifacts: blueprints, threat models, solution " +
    "designs, sequence diagrams, and hardened technology-stack decisions across " +
    "microservices, UI, authentication, database, API, prompt, AI, and server " +
    "(Linux/Ubuntu/Windows) layers.",
  triggers: [
    "design", "architecture", "blueprint", "solution design", "secure design",
    "threat model", "tech stack", "how should we build", "diagram", "scalability",
    "hardening", "authentication", "authorization", "microservices", "api",
    "database", "prompt injection", "llm", "ai", "server", "ubuntu", "linux", "windows",
  ],
  requiresTools: ["read_tool", "glob_tool", "grep_tool"],
  composesWith: ["architect", "programmer", "devops", "secops", "analyst"],
});

// ---------------------------------------------------------------------------
// Bylaws
// ---------------------------------------------------------------------------

const CORE: readonly Bylaw[] = [
  { id: "CORE-01", layer: "core", level: "MUST", title: "Least privilege",
    rule: "Every user, service, token, container, and DB role gets the minimum access required, nothing more." },
  { id: "CORE-02", layer: "core", level: "MUST", title: "Defense in depth",
    rule: "Never rely on a single control. Assume any one layer can fail." },
  { id: "CORE-03", layer: "core", level: "MUST", title: "Zero trust",
    rule: "No implicit trust from network location. Authenticate and authorize every request, including service-to-service." },
  { id: "CORE-04", layer: "core", level: "MUST", title: "Secure by default",
    rule: "The default configuration is the safe configuration. Insecure options are an explicit, documented opt-in." },
  { id: "CORE-05", layer: "core", level: "MUST", title: "Fail closed",
    rule: "On error, timeout, or missing policy, deny. Never fail open." },
  { id: "CORE-06", layer: "core", level: "MUST", title: "Minimize attack surface",
    rule: "Expose only what is required. Remove unused ports, endpoints, packages, and features." },
  { id: "CORE-07", layer: "core", level: "MUST_NOT", title: "Secrets in code, images, logs, or prompts",
    rule: "Secrets are never stored in source code, container images, logs, or prompts. Use a secrets manager." },
  { id: "CORE-08", layer: "core", level: "MUST", title: "Auditability",
    rule: "Security-relevant events are logged, tamper-evident, and free of secrets and unnecessary PII." },
  { id: "CORE-09", layer: "core", level: "MUST", title: "Validate at every trust boundary",
    rule: "All input is hostile until validated, including output from LLMs and other internal services." },
  { id: "CORE-10", layer: "core", level: "MUST", title: "Threat model before build",
    rule: "Identify trust boundaries and apply STRIDE per component and data flow (plus OWASP LLM Top 10 for AI features) before implementation begins." },
  { id: "CORE-11", layer: "core", level: "MUST_NOT", title: "Custom cryptography",
    rule: "Do not invent cryptographic primitives or protocols. Use vetted libraries and standards." },
  { id: "CORE-12", layer: "core", level: "SHOULD", title: "Boring technology",
    rule: "Prefer well-understood, actively maintained, widely audited technology unless a documented constraint demands otherwise." },
  { id: "CORE-13", layer: "core", level: "SHOULD", title: "Right-size the design",
    rule: "Scale controls and architecture to data sensitivity and the real threat model. No service mesh for a single-user CLI tool." },
];

const MICROSERVICES: readonly Bylaw[] = [
  { id: "MS-01", layer: "microservices", level: "MUST", title: "Single data owner",
    rule: "One service owns one business capability and its data store. No databases shared between services." },
  { id: "MS-02", layer: "microservices", level: "MUST", title: "Contract-first",
    rule: "Define OpenAPI / gRPC proto / AsyncAPI contracts with versioning and schema validation before implementation." },
  { id: "MS-03", layer: "microservices", level: "MUST", title: "Gateway at the edge",
    rule: "Terminate TLS, authenticate, rate-limit, and apply WAF and request-size limits at an API gateway." },
  { id: "MS-04", layer: "microservices", level: "MUST", title: "Services re-validate identity",
    rule: "Each service independently validates tokens. The gateway is never the only enforcement point." },
  { id: "MS-05", layer: "microservices", level: "MUST", title: "Service-to-service authentication",
    rule: "Use mutual TLS (service mesh or SPIFFE/SPIRE) or short-lived signed workload tokens between services." },
  { id: "MS-06", layer: "microservices", level: "MUST_NOT", title: "Long-lived shared service keys",
    rule: "No long-lived shared API keys between services." },
  { id: "MS-07", layer: "microservices", level: "MUST", title: "Default-deny networking",
    rule: "Apply default-deny network policies (Kubernetes NetworkPolicy / security groups). Allow only required east-west paths." },
  { id: "MS-08", layer: "microservices", level: "MUST", title: "Resilience controls",
    rule: "Set timeouts on every call; use retries with backoff and jitter, circuit breakers, bulkheads, idempotency keys, and bounded queues." },
  { id: "MS-09", layer: "microservices", level: "MUST", title: "Secure messaging",
    rule: "Authenticate producers and consumers, encrypt in transit, validate message schemas, use dead-letter queues, and make consumers idempotent." },
  { id: "MS-10", layer: "microservices", level: "MUST", title: "Hardened containers",
    rule: "Use minimal/distroless images, non-root user, read-only root filesystem, dropped Linux capabilities, pinned image digests, signed images, an SBOM per build, and CI image scanning." },
  { id: "MS-11", layer: "microservices", level: "MUST_NOT", title: "Privileged workloads",
    rule: "No privileged containers or pods, and no host docker socket mounts." },
  { id: "MS-12", layer: "microservices", level: "MUST", title: "Runtime secrets",
    rule: "Inject secrets at runtime from a vault/KMS-backed manager, rotate automatically, and separate per environment." },
  { id: "MS-13", layer: "microservices", level: "MUST", title: "Traceability without leakage",
    rule: "Propagate correlation IDs and emit structured logs, metrics, and traces. Never log tokens, passwords, or full PII." },
  { id: "MS-14", layer: "microservices", level: "SHOULD", title: "Justify the split",
    rule: "If a modular monolith meets the requirements, state so and justify before splitting into services." },
];

const UI: readonly Bylaw[] = [
  { id: "UI-01", layer: "ui", level: "MUST", title: "Never trust the client",
    rule: "All authorization and validation is enforced server-side. UI checks are UX only." },
  { id: "UI-02", layer: "ui", level: "MUST", title: "XSS prevention",
    rule: "Use contextual output encoding and framework auto-escaping. Sanitize rich text with a vetted library (e.g., DOMPurify).",
    refs: ["OWASP A03"] },
  { id: "UI-03", layer: "ui", level: "MUST_NOT", title: "Raw HTML injection",
    rule: "Avoid innerHTML / dangerouslySetInnerHTML with any untrusted data." },
  { id: "UI-04", layer: "ui", level: "MUST", title: "Strict CSP and security headers",
    rule: "Set a nonce/hash-based Content-Security-Policy without unsafe-inline or unsafe-eval, plus X-Content-Type-Options: nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors, and HSTS." },
  { id: "UI-05", layer: "ui", level: "MUST", title: "CSRF protection",
    rule: "Use SameSite cookies and anti-CSRF tokens for all cookie-authenticated state-changing requests." },
  { id: "UI-06", layer: "ui", level: "MUST", title: "Safe session storage",
    rule: "Prefer HttpOnly + Secure + SameSite cookies. For SPAs, use the backend-for-frontend (BFF) pattern so tokens never reach the browser." },
  { id: "UI-07", layer: "ui", level: "MUST_NOT", title: "Tokens in localStorage or URLs",
    rule: "Do not store tokens in localStorage, and never place secrets in URLs or query strings." },
  { id: "UI-08", layer: "ui", level: "MUST", title: "Explicit CORS allowlist",
    rule: "Use an explicit origin allowlist. Never use '*' together with credentials." },
  { id: "UI-09", layer: "ui", level: "MUST", title: "Dependency hygiene",
    rule: "Use lockfiles and SCA scanning, Subresource Integrity for third-party scripts, and minimize third-party JavaScript." },
  { id: "UI-10", layer: "ui", level: "MUST", title: "Sensitive data handling",
    rule: "Mask secrets, disable autocomplete on sensitive fields where appropriate, and clear sensitive state on logout." },
  { id: "UI-11", layer: "ui", level: "MUST", title: "Server-side upload enforcement",
    rule: "Client-side file type/size limits are UX only. Enforce them on the server." },
  { id: "UI-12", layer: "ui", level: "SHOULD", title: "Mobile and desktop clients",
    rule: "Use the OS keystore/Keychain for secrets, ship no debug builds in release, pin certificates where justified, and secure deep links and IPC." },
  { id: "UI-13", layer: "ui", level: "MUST", title: "AI output in the UI is untrusted",
    rule: "Escape LLM output, never execute it, label AI-generated content, and require confirmation before any AI-initiated action." },
];

const AUTHENTICATION: readonly Bylaw[] = [
  { id: "AUTH-01", layer: "authentication", level: "MUST", title: "Standard protocols only",
    rule: "Use OIDC / OAuth 2.1 (SAML for enterprise) via a proven identity provider. No custom auth protocols." },
  { id: "AUTH-02", layer: "authentication", level: "MUST", title: "Password storage",
    rule: "Hash with Argon2id (preferred) or bcrypt/scrypt with tuned cost and unique salts. Check against breached-password lists.",
    refs: ["OWASP Password Storage Cheat Sheet"] },
  { id: "AUTH-03", layer: "authentication", level: "MUST", title: "MFA for privileged access",
    rule: "Require MFA for administrators and sensitive actions. Prefer phishing-resistant methods (WebAuthn/passkeys, FIDO2) over SMS/OTP." },
  { id: "AUTH-04", layer: "authentication", level: "MUST", title: "Short-lived tokens",
    rule: "Access tokens live 5-15 minutes. Refresh tokens rotate with reuse detection and support server-side revocation." },
  { id: "AUTH-05", layer: "authentication", level: "MUST", title: "Session hardening",
    rule: "Regenerate the session ID on login and privilege change. Enforce absolute and idle timeouts. Use Secure/HttpOnly/SameSite cookie flags." },
  { id: "AUTH-06", layer: "authentication", level: "MUST", title: "JWT validation",
    rule: "Pin the algorithm (reject 'none'). Validate iss, aud, exp, and nbf. Use asymmetric signing (RS256/ES256/EdDSA) with key rotation via JWKS and minimal payloads." },
  { id: "AUTH-07", layer: "authentication", level: "MUST", title: "OAuth flow selection",
    rule: "Use Authorization Code + PKCE for public clients and client credentials for machine-to-machine. Match redirect URIs strictly and validate state/nonce." },
  { id: "AUTH-08", layer: "authentication", level: "MUST_NOT", title: "Implicit flow",
    rule: "Do not use the OAuth implicit flow." },
  { id: "AUTH-09", layer: "authentication", level: "MUST", title: "Brute-force and enumeration defense",
    rule: "Apply rate limiting, progressive delays, and lockout with safe recovery. Return generic error messages (no user enumeration)." },
  { id: "AUTH-10", layer: "authentication", level: "MUST", title: "Secure account recovery",
    rule: "Recovery tokens are single-use, short-lived, and rate-limited. Notify the user on recovery or credential change." },
  { id: "AUTH-11", layer: "authentication", level: "MUST", title: "Deny-by-default authorization",
    rule: "Centralize policy (RBAC baseline; ABAC/ReBAC for fine-grained needs). Deny unless explicitly allowed." },
  { id: "AUTH-12", layer: "authentication", level: "MUST", title: "Object-level authorization",
    rule: "Check ownership/permission on every object access at the API/service layer to prevent IDOR/BOLA.",
    refs: ["OWASP API1:2023"] },
  { id: "AUTH-13", layer: "authentication", level: "MUST", title: "Separate admin plane",
    rule: "Isolate the admin plane from the user plane. Require step-up authentication and auditing for privileged actions." },
  { id: "AUTH-14", layer: "authentication", level: "MUST", title: "Tenant isolation",
    rule: "Derive tenant ID from the verified token, never from client input. Enforce isolation in queries (row-level security) and caches." },
];

const DATABASE: readonly Bylaw[] = [
  { id: "DB-01", layer: "database", level: "MUST", title: "Per-service least-privilege accounts",
    rule: "Each service uses a dedicated DB user with minimal grants. Use a separate migration role. No superuser/owner for the application and no shared credentials." },
  { id: "DB-02", layer: "database", level: "MUST", title: "Rotated credentials",
    rule: "Use short-lived or regularly rotated database credentials issued from a secrets manager." },
  { id: "DB-03", layer: "database", level: "MUST", title: "No string-built queries",
    rule: "Use parameterized queries/prepared statements or a safe ORM. Allowlist dynamic identifiers such as sort columns and table names.",
    refs: ["OWASP A03"] },
  { id: "DB-04", layer: "database", level: "MUST", title: "Private network placement",
    rule: "Databases sit in private subnets with no public IP, reachable only from allowlisted services." },
  { id: "DB-05", layer: "database", level: "MUST", title: "TLS to the database",
    rule: "Enforce TLS 1.2+ for all connections and verify the server certificate." },
  { id: "DB-06", layer: "database", level: "MUST", title: "Encryption at rest",
    rule: "Encrypt storage (disk/TDE) with KMS-managed keys. Use field-level encryption for highly sensitive data (PII, secrets, card data)." },
  { id: "DB-07", layer: "database", level: "MUST", title: "Hash what is never read back",
    rule: "Hash, do not encrypt, any value that never needs to be recovered." },
  { id: "DB-08", layer: "database", level: "MUST_NOT", title: "Raw card data",
    rule: "Do not store raw cardholder data unless PCI DSS scope has been explicitly accepted. Prefer tokenization.",
    refs: ["PCI DSS"] },
  { id: "DB-09", layer: "database", level: "MUST", title: "Data minimization and retention",
    rule: "Store only what is needed. Classify sensitive columns. Define retention, deletion, and anonymization (right to erasure)." },
  { id: "DB-10", layer: "database", level: "SHOULD", title: "Strong multi-tenant isolation",
    rule: "Use row-level security or schema/database per tenant." },
  { id: "DB-11", layer: "database", level: "MUST", title: "Integrity controls",
    rule: "Use constraints, foreign keys, and transactions. Add audit tables or CDC for sensitive changes." },
  { id: "DB-12", layer: "database", level: "MUST", title: "Backups",
    rule: "Backups are encrypted, access-controlled, kept as an immutable/offsite copy, restore-tested regularly, and tied to defined RPO/RTO." },
  { id: "DB-13", layer: "database", level: "MUST", title: "Operational hygiene",
    rule: "Patch on a cadence, disable default accounts and unused extensions, cap connection pools, and keep audit/slow-query logs free of sensitive values." },
  { id: "DB-14", layer: "database", level: "MUST", title: "NoSQL, cache, and search exposure",
    rule: "Authentication is always on (Redis, MongoDB, Elasticsearch). Bind to private interfaces, disable dangerous commands, and guard against operator injection ($where, $ne)." },
];

const API: readonly Bylaw[] = [
  { id: "API-01", layer: "api", level: "MUST", title: "Design against OWASP API Top 10",
    rule: "Address BOLA, broken authentication, broken property-level authorization, unrestricted resource consumption, broken function-level authorization, SSRF, misconfiguration, improper inventory, and unsafe consumption of third-party APIs.",
    refs: ["OWASP API Security Top 10 2023"] },
  { id: "API-02", layer: "api", level: "MUST", title: "Schema validation both directions",
    rule: "Validate requests and responses against the contract. Reject unknown fields (mass-assignment protection)." },
  { id: "API-03", layer: "api", level: "MUST", title: "Allowlisted response DTOs",
    rule: "Return explicit response objects. Never serialize internal entities or leak internal fields." },
  { id: "API-04", layer: "api", level: "MUST", title: "TLS everywhere",
    rule: "Require TLS 1.2+ (prefer 1.3) and HSTS. Never place sensitive data in URLs." },
  { id: "API-05", layer: "api", level: "MUST", title: "Rate limits and quotas",
    rule: "Limit per user/key/IP/tenant. Cap payload size, page size, batch size, and timeouts on all operations." },
  { id: "API-06", layer: "api", level: "MUST", title: "GraphQL controls",
    rule: "Disable or gate introspection in production. Enforce depth and cost limits, prefer persisted queries, and apply per-field authorization." },
  { id: "API-07", layer: "api", level: "MUST", title: "Versioning and inventory",
    rule: "Document versions and deprecation policy. Keep an API catalog and leave no shadow or debug endpoints." },
  { id: "API-08", layer: "api", level: "MUST", title: "Idempotency and webhook integrity",
    rule: "Use idempotency keys for unsafe operations. Verify webhook signatures (HMAC, constant-time compare) with timestamp/nonce replay protection." },
  { id: "API-09", layer: "api", level: "MUST", title: "SSRF defense",
    rule: "Block internal and metadata ranges (169.254.169.254, RFC1918, localhost), allowlist outbound destinations, and do not follow redirects blindly.",
    refs: ["OWASP API7:2023"] },
  { id: "API-10", layer: "api", level: "MUST", title: "Safe error handling",
    rule: "Use a consistent error format. Never expose stack traces, SQL errors, or internal paths. Keep 401/403/404 behavior generic to limit enumeration." },
  { id: "API-11", layer: "api", level: "MUST", title: "WebSocket and streaming security",
    rule: "Authenticate on connect, re-validate on privileged messages, check origin, limit message size, and enforce heartbeat/idle timeouts." },
  { id: "API-12", layer: "api", level: "MUST", title: "Safe file handling",
    rule: "Validate file type by content, enforce size limits, use randomized storage names, store outside the web root or in object storage, malware-scan, and serve with safe Content-Disposition and content type." },
];

const PROMPT: readonly Bylaw[] = [
  { id: "PRM-01", layer: "prompt", level: "MUST", title: "All prompt inputs are untrusted",
    rule: "User text, retrieved documents, web pages, emails, tool outputs, and file contents may carry injected instructions (direct and indirect prompt injection).",
    refs: ["OWASP LLM01"] },
  { id: "PRM-02", layer: "prompt", level: "MUST", title: "Separate instructions from data",
    rule: "Keep rules in the system prompt. Place untrusted content in clearly delimited, labelled data blocks with an explicit instruction never to follow instructions found inside them." },
  { id: "PRM-03", layer: "prompt", level: "MUST_NOT", title: "Secrets in prompts",
    rule: "Never put API keys, credentials, internal URLs, or sensitive business logic in a prompt. Assume system prompts are extractable." },
  { id: "PRM-04", layer: "prompt", level: "MUST", title: "Least-privilege tools",
    rule: "Expose only the tools the task needs, with narrow schemas. No open-ended 'run any command/SQL/URL' tools." },
  { id: "PRM-05", layer: "prompt", level: "MUST", title: "Prompts are code",
    rule: "Version-control and review prompt templates. Test them in CI against an adversarial suite (jailbreak, injection, exfiltration)." },
  { id: "PRM-06", layer: "prompt", level: "SHOULD", title: "Input normalization and screening",
    rule: "Apply length limits and unicode/zero-width/homoglyph normalization. Treat injection detection as a signal, never as the sole defense." },
  { id: "PRM-07", layer: "prompt", level: "MUST", title: "Schema-validate model output",
    rule: "Validate output against a strict schema (JSON schema / structured outputs) before use." },
  { id: "PRM-08", layer: "prompt", level: "MUST_NOT", title: "Raw model output into interpreters",
    rule: "Never pass raw model output into shells, SQL, eval, HTML, or file paths.",
    refs: ["OWASP LLM02"] },
  { id: "PRM-09", layer: "prompt", level: "MUST", title: "Policy enforced in code",
    rule: "A prompt instruction ('please don't...') is not a security boundary. Enforce policy outside the model." },
  { id: "PRM-10", layer: "prompt", level: "MUST", title: "Redacted, access-controlled prompt logs",
    rule: "Log prompts and responses for audit with PII/secret redaction, access control, and a defined retention period." },
];

const AI: readonly Bylaw[] = [
  { id: "AI-01", layer: "ai", level: "MUST", title: "Design against OWASP LLM Top 10",
    rule: "Address prompt injection, insecure output handling, data poisoning, model DoS, supply-chain vulnerabilities, sensitive information disclosure, insecure plugin/tool design, excessive agency, overreliance, and model theft.",
    refs: ["OWASP Top 10 for LLM Applications"] },
  { id: "AI-02", layer: "ai", level: "MUST", title: "Act with the user's permissions",
    rule: "AI actions are bounded by the requesting user's permissions. Never act with a super-user or shared service identity.",
    refs: ["OWASP LLM06"] },
  { id: "AI-03", layer: "ai", level: "MUST", title: "Human approval for high-impact actions",
    rule: "Require human-in-the-loop confirmation for payments, deletions, external communications, deployments, and other irreversible actions." },
  { id: "AI-04", layer: "ai", level: "MUST", title: "Sandbox tools and code execution",
    rule: "Run in isolation: no host network by default, resource limits, ephemeral filesystem, egress allowlist, and short-lived scoped credentials." },
  { id: "AI-05", layer: "ai", level: "MUST", title: "Authorize retrieval before context",
    rule: "RAG must filter documents by the requesting user's access rights before they enter the model context. Isolate tenants in vector stores (namespaces/filters plus access control)." },
  { id: "AI-06", layer: "ai", level: "MUST", title: "Control data sent to models",
    rule: "Classify what may leave the boundary. Redact or tokenize PII and secrets before sending to third-party providers. Confirm provider retention/training terms. Prefer private endpoints or regional hosting for regulated data." },
  { id: "AI-07", layer: "ai", level: "MUST", title: "Model and component supply chain",
    rule: "Pin and verify model versions and weights (hashes/signatures). Scan model files and avoid unsafe pickle formats (prefer safetensors). Vet plugins, MCP servers, datasets, and embeddings. Maintain an AI-BOM." },
  { id: "AI-08", layer: "ai", level: "MUST", title: "Corpus provenance",
    rule: "Require provenance and review for fine-tuning and RAG corpora. Write access to knowledge bases is a privileged operation." },
  { id: "AI-09", layer: "ai", level: "MUST", title: "Abuse and cost controls",
    rule: "Set per-user token/request quotas, max context and output limits, concurrency caps, budget alerts, and a kill switch." },
  { id: "AI-10", layer: "ai", level: "SHOULD", title: "Grounding and fallback",
    rule: "Ground factual answers with citations, define a fallback path for model failure or timeout, validate outputs, and surface uncertainty." },
  { id: "AI-11", layer: "ai", level: "MUST", title: "Red-team and continuous evaluation",
    rule: "Red-team before release. Run continuous evals for injection, leakage, toxicity, and regressions. Monitor for anomalies and keep an AI incident response plan." },
  { id: "AI-12", layer: "ai", level: "SHOULD", title: "Governance and traceability",
    rule: "Document intended use, limits, and data flows. Map to applicable regulation (EU AI Act, NIST AI RMF, ISO 42001). Record model and prompt versions per decision.",
    refs: ["EU AI Act", "NIST AI RMF", "ISO/IEC 42001"] },
  { id: "AI-13", layer: "ai", level: "MUST", title: "Protect inference endpoints",
    rule: "Authenticate and rate-limit inference APIs. Limit and monitor queries to resist model extraction." },
];

const SERVER_COMMON: readonly Bylaw[] = [
  { id: "SRV-01", layer: "server-common", level: "MUST", title: "Minimal install and patching",
    rule: "Remove unused services and packages. Patch the OS and dependencies on a defined cadence (automated for security updates, tested for the rest)." },
  { id: "SRV-02", layer: "server-common", level: "MUST", title: "Infrastructure as code",
    rule: "Build immutable, reproducible servers (Terraform/Ansible/Packer). No manual snowflake changes." },
  { id: "SRV-03", layer: "server-common", level: "MUST", title: "Controlled admin access",
    rule: "Admin access goes through a bastion/VPN/SSM with MFA. No directly exposed admin ports and no shared logins." },
  { id: "SRV-04", layer: "server-common", level: "MUST", title: "Host firewall",
    rule: "Default-deny inbound. Restrict outbound (egress allowlist) where feasible." },
  { id: "SRV-05", layer: "server-common", level: "MUST", title: "Monitoring baseline",
    rule: "Synchronize time (NTP/chrony), ship logs to a remote immutable store, run file-integrity monitoring, EDR/antimalware, and vulnerability scanning." },
  { id: "SRV-06", layer: "server-common", level: "MUST", title: "CIS baseline",
    rule: "Conform to the applicable CIS Benchmark and verify compliance continuously.",
    refs: ["CIS Benchmarks"] },
  { id: "SRV-07", layer: "server-common", level: "MUST", title: "Disk encryption and key protection",
    rule: "Encrypt disks, protect and rotate keys, and separate dev/test/prod environments and accounts." },
  { id: "SRV-08", layer: "server-common", level: "MUST", title: "Modern TLS",
    rule: "Allow modern ciphers only, use valid certificates with automated renewal (ACME), and disable TLS 1.0/1.1 and weak ciphers." },
  { id: "SRV-09", layer: "server-common", level: "MUST", title: "Tested recovery",
    rule: "Backups are tested and a documented recovery runbook exists." },
];

const SERVER_LINUX: readonly Bylaw[] = [
  { id: "LNX-01", layer: "server-linux", level: "MUST", title: "SSH hardening",
    rule: "PermitRootLogin no; PasswordAuthentication no; key-based auth with modern keys (ed25519); restrict via AllowUsers/AllowGroups; set idle timeouts; add MFA where possible." },
  { id: "LNX-02", layer: "server-linux", level: "MUST", title: "Least-privilege sudo",
    rule: "Scope sudo rules in /etc/sudoers.d. No passwordless sudo for human accounts." },
  { id: "LNX-03", layer: "server-linux", level: "MUST", title: "Firewall",
    rule: "Use ufw/nftables with default-deny incoming, allow only required ports, and rate-limit SSH." },
  { id: "LNX-04", layer: "server-linux", level: "SHOULD", title: "Intrusion prevention and auditing",
    rule: "Run fail2ban or CrowdSec. Run auditd with rules for authentication, sudo, and configuration changes." },
  { id: "LNX-05", layer: "server-linux", level: "MUST", title: "Mandatory access control",
    rule: "Keep AppArmor enforcing (Ubuntu default; SELinux on RHEL family). Write profiles for custom services." },
  { id: "LNX-06", layer: "server-linux", level: "MUST", title: "Automated security patching",
    rule: "Enable unattended-upgrades for security updates, use Livepatch where available, track Ubuntu Security Notices, and use Ubuntu Pro/ESM for extended coverage." },
  { id: "LNX-07", layer: "server-linux", level: "MUST", title: "Kernel and sysctl hardening",
    rule: "Set net.ipv4.conf.all.rp_filter=1, disable source routing and ICMP redirects, net.ipv4.tcp_syncookies=1, kernel.kptr_restrict, kernel.dmesg_restrict, fs.protected_hardlinks/symlinks=1, kernel.yama.ptrace_scope. Disable unused kernel modules." },
  { id: "LNX-08", layer: "server-linux", level: "SHOULD", title: "Filesystem hardening",
    rule: "Use separate /tmp, /var, /home partitions with nodev,nosuid,noexec where appropriate, umask 027, SUID/SGID audits, and LUKS encryption." },
  { id: "LNX-09", layer: "server-linux", level: "MUST", title: "Service isolation",
    rule: "Run each app as a dedicated non-root user. Apply systemd sandboxing (NoNewPrivileges=yes, ProtectSystem=strict, ProtectHome=yes, PrivateTmp=yes, CapabilityBoundingSet=, RestrictAddressFamilies, SystemCallFilter). Bind apps to localhost/private interfaces behind a reverse proxy." },
  { id: "LNX-10", layer: "server-linux", level: "MUST", title: "Reverse proxy hardening",
    rule: "Hide server version, set request/body/header limits and timeouts, add security headers, and apply rate limiting." },
  { id: "LNX-11", layer: "server-linux", level: "MUST", title: "Containers on Ubuntu",
    rule: "Prefer rootless Docker/Podman with user namespaces and seccomp/AppArmor profiles. No --privileged and no docker socket mounts." },
  { id: "LNX-12", layer: "server-linux", level: "SHOULD", title: "Continuous verification",
    rule: "Run Lynis and OpenSCAP/CIS-CAT, review open ports (ss -tulpn), and use rkhunter/chkrootkit as secondary checks." },
];

const SERVER_WINDOWS: readonly Bylaw[] = [
  { id: "WIN-01", layer: "server-windows", level: "MUST", title: "Security baseline",
    rule: "Prefer Server Core. Apply Microsoft Security Baselines / CIS Benchmarks via Group Policy or Intune. Remove unused roles and features." },
  { id: "WIN-02", layer: "server-windows", level: "MUST", title: "Patch management",
    rule: "Patch via WSUS / Windows Update for Business / Azure Update Manager on a defined cadence." },
  { id: "WIN-03", layer: "server-windows", level: "MUST", title: "Tiered, least-privilege admin",
    rule: "Use separate admin accounts and tiered administration. Deploy LAPS, the Protected Users group, and Credential Guard. Do not cache domain admin logons on member servers. Use gMSA for services. Disable built-in Administrator/Guest where possible." },
  { id: "WIN-04", layer: "server-windows", level: "MUST_NOT", title: "Internet-exposed RDP",
    rule: "RDP is never exposed to the internet. Require NLA and MFA, and place it behind VPN / RD Gateway / bastion." },
  { id: "WIN-05", layer: "server-windows", level: "MUST", title: "Legacy protocol removal",
    rule: "Disable SMBv1. Require SMB signing. Disable LLMNR, NetBIOS, and mDNS. Enforce TLS 1.2+ by disabling legacy SCHANNEL protocols." },
  { id: "WIN-06", layer: "server-windows", level: "MUST", title: "Remote management limits",
    rule: "Restrict WinRM/PowerShell remoting to admin hosts. Enable script block logging and transcription; use Constrained Language Mode where feasible." },
  { id: "WIN-07", layer: "server-windows", level: "MUST", title: "Host firewall",
    rule: "Keep Windows Defender Firewall enabled with default-deny inbound." },
  { id: "WIN-08", layer: "server-windows", level: "MUST", title: "Endpoint defense",
    rule: "Run Microsoft Defender (or EDR) with tamper protection, ASR rules, and Exploit Protection. Enforce AppLocker/WDAC and BitLocker with TPM." },
  { id: "WIN-09", layer: "server-windows", level: "MUST", title: "Active Directory protection",
    rule: "Protect Domain Controllers, rotate krbtgt, disable NTLM where feasible, enforce LDAP signing and channel binding, monitor privileged groups, and watch for Kerberoasting/DCSync indicators." },
  { id: "WIN-10", layer: "server-windows", level: "MUST", title: "IIS and service identities",
    rule: "Run app pools and services under least-privilege identities. Remove default sites, disable directory browsing and unnecessary HTTP verbs, add security headers, and enable request filtering." },
  { id: "WIN-11", layer: "server-windows", level: "MUST", title: "Audit logging",
    rule: "Enable advanced audit policy. Forward Security, Sysmon, and PowerShell logs to a SIEM and protect log integrity." },
  { id: "WIN-12", layer: "server-windows", level: "MUST_NOT", title: "Plaintext credentials",
    rule: "Never store credentials in scripts or the registry in plaintext. Use DPAPI, a key vault, or Credential Manager patterns." },
];

const CROSS_CUTTING: readonly Bylaw[] = [
  { id: "XC-01", layer: "cross-cutting", level: "MUST", title: "Secrets management",
    rule: "Use a vault/KMS per environment with rotation. Scan CI and pre-commit for secrets (gitleaks/trufflehog). Revoke and rotate immediately on exposure." },
  { id: "XC-02", layer: "cross-cutting", level: "MUST", title: "Supply chain integrity",
    rule: "Use lockfiles and dependency pinning, SCA, SBOMs (CycloneDX/SPDX), signed artifacts (Sigstore/cosign), protected branches, reviewed CI pipelines, and least-privilege CI tokens." },
  { id: "XC-03", layer: "cross-cutting", level: "MUST", title: "CI/CD security gates",
    rule: "Run SAST, SCA, secret scan, IaC scan (tfsec/checkov), container scan, DAST on staging, and policy-as-code (OPA/Conftest)." },
  { id: "XC-04", layer: "cross-cutting", level: "MUST", title: "Centralized detection",
    rule: "Keep centralized, structured, tamper-evident logs. Alert on authentication anomalies, privilege changes, and exfiltration patterns. Define retention." },
  { id: "XC-05", layer: "cross-cutting", level: "MUST", title: "Incident response",
    rule: "Maintain a runbook with contacts, severity levels, containment steps, key-rotation procedure, and post-incident review." },
  { id: "XC-06", layer: "cross-cutting", level: "MUST", title: "Privacy by design",
    rule: "Maintain a data inventory and lawful basis, handle DSARs, enforce retention and deletion, and follow breach-notification timelines." },
  { id: "XC-07", layer: "cross-cutting", level: "SHOULD", title: "Resilience planning",
    rule: "Maintain a DR plan with documented RPO/RTO, multi-AZ as justified, and failure/chaos testing." },
];

export const BYLAWS: readonly Bylaw[] = deepFreeze([
  ...CORE,
  ...MICROSERVICES,
  ...UI,
  ...AUTHENTICATION,
  ...DATABASE,
  ...API,
  ...PROMPT,
  ...AI,
  ...SERVER_COMMON,
  ...SERVER_LINUX,
  ...SERVER_WINDOWS,
  ...CROSS_CUTTING,
]);

// ---------------------------------------------------------------------------
// Process, deliverables, checklist, pitfalls
// ---------------------------------------------------------------------------

export const PROCESS: readonly string[] = deepFreeze([
  "Gather constraints: read wbs.md/existing docs; confirm data classification, compliance scope (GDPR, PCI-DSS, HIPAA, SOC 2, ISO 27001), user types, scale, latency, hosting target, and threat actors.",
  "Define trust boundaries: internet->edge, UI->API, service->service, app->DB, app->LLM, tenant->tenant.",
  "Threat model: STRIDE per component and data flow; OWASP LLM Top 10 for AI features; rank by likelihood x impact.",
  "Decompose: components with single responsibilities and explicit contracts.",
  "Define interaction: sequence diagrams including auth, failure, and abuse paths; mark sync/async boundaries and identity propagation.",
  "Pick stack: justify each choice against constraints and security posture, not familiarity.",
  "Specify controls: map every threat to a concrete control with an owner, or to a documented accepted risk.",
  "Produce artifacts: blueprint.md, solution-design.md, threat-model.md, artifact.md.",
  "Verify: walk SECURITY_CHECKLIST before declaring the design done.",
]);

export const OUTPUT_ARTIFACTS: readonly string[] = deepFreeze([
  "blueprint.md",
  "solution-design.md",
  "threat-model.md",
  "artifact.md (deployment file list)",
  "sequence diagrams (mermaid or ASCII) for any flow spanning >2 components, with authN/authZ/validation points marked",
  "data-flow diagram with trust boundaries marked",
  "threat table: Threat | Component | STRIDE/OWASP ref | Likelihood | Impact | Control | Residual risk",
  "security checklist results with residual-risk register",
]);

export const SECURITY_CHECKLIST: readonly string[] = deepFreeze([
  "Trust boundaries identified and diagrammed",
  "Threat model completed (STRIDE; OWASP LLM Top 10 if AI is involved)",
  "AuthN: standard protocol, MFA for privileged users, token lifetimes and revocation defined",
  "AuthZ: deny-by-default, object-level checks, tenant isolation enforced server-side",
  "All input validated at every boundary; all output encoded for its context",
  "Secrets in a vault; none in code, images, logs, or prompts",
  "Encryption in transit (TLS 1.2+) and at rest; key management and rotation defined",
  "Database least-privilege roles, parameterized access, private network, tested backups",
  "API schema validation, rate limits, size limits, SSRF and mass-assignment protections",
  "AI: excessive agency bounded, human approval for high-impact actions, RAG authorization, output treated as untrusted, cost/abuse quotas set",
  "Servers hardened to baseline (CIS), patched, firewalled, least-privilege services, logged",
  "Supply chain controls (pinning, SBOM, signing, scanning) in CI/CD",
  "Logging/alerting without sensitive data; incident response path defined",
  "Residual risks documented and accepted by an owner",
]);

export const COMMON_PITFALLS: readonly string[] = deepFreeze([
  "Authorization checked only in the UI or gateway; the service behind trusts everything (IDOR/BOLA).",
  "Long-lived tokens or shared API keys between services that are never rotated.",
  "Secrets committed to git, baked into images, or pasted into system prompts.",
  "LLM output passed straight to a shell, SQL, or HTML renderer.",
  "RAG that retrieves documents without checking the requesting user's access rights.",
  "Agents running with a service/admin identity instead of the user's scoped permissions.",
  "Databases, caches, or search clusters exposed to the internet without auth.",
  "CORS '*' with credentials, missing CSP, or tokens stored in localStorage.",
  "No egress restrictions, making SSRF and data exfiltration easy.",
  "Under-specified error/retry behavior and rate limits, turning failures into DoS or data leaks.",
  "Treating hardening as one-time instead of continuous patching, scanning, and monitoring.",
  "Designing for hypothetical future scale or threats before the real threat model is addressed.",
  "Controls that cripple usability get bypassed; test the secure path for ergonomics.",
]);

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function getBylawsByLayer(layer: BylawLayer): readonly Bylaw[] {
  return BYLAWS.filter((b) => b.layer === layer);
}

export function getBylawById(id: string): Bylaw | undefined {
  return BYLAWS.find((b) => b.id === id);
}

export function getBylawsByLevel(level: BylawLevel): readonly Bylaw[] {
  return BYLAWS.filter((b) => b.level === level);
}

/** Layers a given task touches, inferred from keywords. Core and cross-cutting always apply. */
export function inferLayers(taskText: string): readonly BylawLayer[] {
  const t = taskText.toLowerCase();
  const rules: ReadonlyArray<readonly [BylawLayer, RegExp]> = [
    ["microservices", /microservice|service mesh|kubernetes|k8s|container|docker|message queue|kafka|rabbit/],
    ["ui", /\bui\b|frontend|front-end|browser|react|vue|angular|spa\b|web app|mobile app|desktop app/],
    ["authentication", /auth|login|oauth|oidc|saml|jwt|session|sso|mfa|password|rbac|permission/],
    ["database", /database|\bdb\b|sql|postgres|mysql|mongo|redis|elasticsearch|schema|migration/],
    ["api", /\bapi\b|rest|graphql|grpc|webhook|websocket|endpoint/],
    ["prompt", /prompt|system prompt|jailbreak|injection/],
    ["ai", /\bai\b|llm|model|rag|agent|embedding|vector|inference|mcp/],
    ["server-common", /server|host|vm\b|infrastructure|hardening/],
    ["server-linux", /linux|ubuntu|debian|rhel|systemd|ssh/],
    ["server-windows", /windows|active directory|\bad\b|iis|powershell|rdp/],
  ];
  const hit = rules.filter(([, re]) => re.test(t)).map(([layer]) => layer);
  return deepFreeze(["core", ...hit, "cross-cutting"] as BylawLayer[]);
}

/** Render bylaws as plain text suitable for injecting into an agent's context. */
export function renderBylaws(layers?: readonly BylawLayer[]): string {
  const selected = layers ? BYLAWS.filter((b) => layers.includes(b.layer)) : BYLAWS;
  const lines: string[] = [
    `# ${SKILL_META.name} bylaws v${SKILL_META.version}`,
    "MUST / MUST_NOT violations block approval. SHOULD deviations need a documented, owned, accepted risk.",
    "",
  ];
  let current: BylawLayer | undefined;
  for (const b of selected) {
    if (b.layer !== current) {
      current = b.layer;
      lines.push(`## ${current}`);
    }
    lines.push(`- [${b.id}] ${b.level} - ${b.title}: ${b.rule}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Review helper
// ---------------------------------------------------------------------------

export interface BylawFinding {
  readonly bylawId: string;
  readonly status: "pass" | "fail" | "not-applicable" | "accepted-risk";
  readonly note?: string;
  /** Required when status is "accepted-risk". */
  readonly riskOwner?: string;
}

export interface ReviewResult {
  readonly approved: boolean;
  readonly blocking: readonly string[];
  readonly unreviewed: readonly string[];
  readonly invalid: readonly string[];
}

/**
 * Evaluate findings against the bylaws.
 * - Any failed MUST / MUST_NOT blocks approval (accepted-risk is not allowed for them).
 * - A failed SHOULD must be recorded as accepted-risk with a named owner.
 * - Every in-scope bylaw must have a finding.
 */
export function evaluateReview(
  findings: readonly BylawFinding[],
  layers?: readonly BylawLayer[],
): ReviewResult {
  const scope = layers ? BYLAWS.filter((b) => layers.includes(b.layer)) : BYLAWS;
  const byId = new Map(findings.map((f) => [f.bylawId, f] as const));
  const blocking: string[] = [];
  const unreviewed: string[] = [];
  const invalid: string[] = [];

  for (const b of scope) {
    const f = byId.get(b.id);
    if (!f) {
      unreviewed.push(b.id);
      continue;
    }
    if (f.status === "accepted-risk") {
      if (b.level !== "SHOULD") invalid.push(b.id);
      else if (!f.riskOwner) invalid.push(b.id);
    } else if (f.status === "fail") {
      blocking.push(b.id);
    }
  }

  return deepFreeze({
    approved: blocking.length === 0 && unreviewed.length === 0 && invalid.length === 0,
    blocking,
    unreviewed,
    invalid,
  });
}
