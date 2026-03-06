/**
 * Receives bug reports from Actium Tunnel desktop clients.
 *
 * No auth required — reports can come from broken installs.
 * Rate limited: 5 reports per IP per hour.
 */

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 3600_000; // 1 hour

// Simple in-memory rate limiter (replace with Redis in production)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

interface BugReport {
  app_version: string;
  os: string;
  active_account_count: number;
  connected_tunnel_count: number;
  tunnel_states: {
    state: string;
    error_message?: string;
  }[];
  description: string;
  recent_logs: string[];
  email?: string;
}

export async function POST(req: Request): Promise<Response> {
  // Rate limiting
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    "unknown";

  const now = Date.now();
  const bucket = rateLimitMap.get(ip);

  if (bucket) {
    if (now < bucket.resetAt) {
      if (bucket.count >= RATE_LIMIT_MAX) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded" }),
          { status: 429, headers: { "Content-Type": "application/json" } }
        );
      }
      bucket.count++;
    } else {
      bucket.count = 1;
      bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
    }
  } else {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
  }

  // Parse and validate the report
  let body: BugReport;
  try {
    body = (await req.json()) as BugReport;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!body.description || body.description.trim().length < 10) {
    return new Response(
      JSON.stringify({ error: "Description too short" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!body.app_version) {
    return new Response(
      JSON.stringify({ error: "Missing app_version" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Store the report
  // In production, this would write to a database table or push to Linear
  console.log(
    `[bug-report] Received from ${body.os} v${body.app_version}:`,
    body.description.slice(0, 100)
  );

  // TODO: Implement one of:
  // - await db.tunnelBugReport.create({ data: { ...body, ip, createdAt: new Date() } });
  // - await linearClient.createIssue({ teamId: TUNNEL_TEAM_ID, title: `[Tunnel Bug] ${body.description.slice(0, 80)}`, ... });

  // If email provided, optionally send acknowledgment
  if (body.email) {
    // TODO: await sendEmail(body.email, 'Bug report received', '...');
  }

  return new Response(
    JSON.stringify({ received: true }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
