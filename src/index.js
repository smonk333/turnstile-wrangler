/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

function cors(req, res) {
  const origin = req.headers.get("Origin");

  const headers = new Headers(res.headers || {});

  headers.set("Access-Control-Allow-Origin", origin || "*");

  // handle preflights
  if (req.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400"); // 24 hours
  }

  return new Response(res.body, {
    status: res.status,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return cors(request, new Response(null, { status: 204, headers: [] }));
    }
    if (request.method === "POST") {
      try {
        const formData = await request.formData();
        const token = formData.get("cf-turnstile-response");
        const ip = request.headers.get("CF-Connecting-IP");

        if (!token) {
          return cors(
            request,
            new Response(JSON.stringify({ error: "Captcha failed" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        const requiredFields = [
          "user_name",
          "user_email",
          "user_subject",
          "user_message",
        ];
        for (const field of requiredFields) {
          if (!formData.has(field)) {
            return cors(
              request,
              new Response(
                JSON.stringify({ error: `Missing required field ${field}.` }),
                {
                  status: 400,
                  headers: { "Content-Type": "application/json" },
                }
              )
            );
          }
        }

        const email = formData.get("user_email");
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        if (!email.match(emailRegex)) {
          return cors(
            request,
            new Response(JSON.stringify({ error: "Invalid email address." }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        // Verify Turnstile token
        const turnstileFormData = new FormData();
        turnstileFormData.append("secret", env.TURNSTILE_PRIVATE_KEY);
        turnstileFormData.append("response", token);
        turnstileFormData.append("remoteip", ip);

        const turnstileResponse = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            body: turnstileFormData,
          }
        );

        const turnstileData = await turnstileResponse.json();

        if (!turnstileData.success) {
          return cors(
            request,
            new Response(JSON.stringify({ error: "Captcha failed" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            })
          );
        }

        // Send email via EmailJS
        const emailJsResponse = await fetch(
          "https://api.emailjs.com/api/v1.0/email/send",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              service_id: env.EMAILJS_SERVICE_ID,
              template_id: env.EMAILJS_TEMPLATE_ID,
              user_id: env.EMAILJS_USER_ID,
              template_params: {
                user_name: formData.get("user_name"),
                user_email: formData.get("user_email"),
                user_subject: formData.get("user_subject"),
                user_message: formData.get("user_message"),
              },
              accessToken: env.EMAILJS_PRIVATE_KEY
            }),
          }
        );

        if (!emailJsResponse.ok) {
          const txt = await emailJsResponse.text();
          console.error("EmailJS call failed!", txt);
          throw new Error("Email failed", { cause: emailJsResponse });
        }

        return cors(
          request,
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      } catch (error) {
        return cors(
          request,
          new Response(JSON.stringify({ error: "Server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
    }

    return cors(request, new Response("Method not allowed", { status: 405 }));
  },
};
