const RESEND_ENDPOINT = "https://api.resend.com/emails";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getValue = (formData: FormData, key: string) =>
  (formData.get(key) ?? "").toString().trim();

export const onRequestPost = async ({ request, env }: { request: Request; env: Record<string, string> }) => {
  const redirectOk = new URL("/?submitted=1#quote", request.url);
  const redirectError = new URL("/?error=1#quote", request.url);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.redirect(redirectError, 303);
  }

  const honeypot = getValue(formData, "company");
  if (honeypot) {
    return Response.redirect(redirectOk, 303);
  }

  const name = getValue(formData, "name");
  const phone = getValue(formData, "phone");
  const email = getValue(formData, "email");
  const area = getValue(formData, "area");
  const service = getValue(formData, "service");
  const details = getValue(formData, "details");

  if (!name || !phone || !area || !service) {
    return Response.redirect(redirectError, 303);
  }

  if (env.TURNSTILE_SECRET) {
    const token = getValue(formData, "cf-turnstile-response");
    if (!token) {
      return Response.redirect(redirectError, 303);
    }
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") ?? "",
    });
    try {
      const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body,
      });
      const outcome = (await verify.json()) as { success?: boolean };
      if (!outcome.success) {
        return Response.redirect(redirectError, 303);
      }
    } catch {
      return Response.redirect(redirectError, 303);
    }
  }

  const resendKey = env.RESEND_API_KEY;
  if (!resendKey) {
    return Response.redirect(redirectError, 303);
  }

  const toEmail = env.TO_EMAIL ?? "quotes@maestrosservices.com";
  const fromEmail = env.FROM_EMAIL ?? "Maestros Services <quotes@maestrosservices.com>";

  const safeName = escapeHtml(name);
  const safePhone = escapeHtml(phone);
  const safeEmail = escapeHtml(email || "Not provided");
  const safeArea = escapeHtml(area);
  const safeService = escapeHtml(service);
  const safeDetails = escapeHtml(details || "Not provided");

  const text = [
    "New quote request",
    `Name: ${name}`,
    `Phone: ${phone}`,
    `Email: ${email || "Not provided"}`,
    `Service area: ${area}`,
    `Service: ${service}`,
    `Details: ${details || "Not provided"}`,
  ].join("\n");

  const html = `
    <h2>New quote request</h2>
    <p><strong>Name:</strong> ${safeName}</p>
    <p><strong>Phone:</strong> ${safePhone}</p>
    <p><strong>Email:</strong> ${safeEmail}</p>
    <p><strong>Service area:</strong> ${safeArea}</p>
    <p><strong>Service:</strong> ${safeService}</p>
    <p><strong>Details:</strong><br />${safeDetails.replace(/\n/g, "<br />")}</p>
  `;

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        subject: `New quote request - ${name}`,
        html,
        text,
      }),
    });

    if (!response.ok) {
      return Response.redirect(redirectError, 303);
    }
  } catch {
    return Response.redirect(redirectError, 303);
  }

  return Response.redirect(redirectOk, 303);
};
