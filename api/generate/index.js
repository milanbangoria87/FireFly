const fetch = require('node-fetch');

module.exports = async function (context, req) {
  context.log("🔥 Function triggered");

  const { prompt, height, width, apiType } = req.body || {};

  if (apiType !== "video") {
    context.res = {
      status: 400,
      body: { error: "Only 'video' API is implemented in backend for now." }
    };
    return;
  }

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  context.log("Client ID:", clientId ? "✅ present" : "❌ missing");
  context.log("Client Secret:", clientSecret ? "✅ present" : "❌ missing");

  if (!clientId || !clientSecret) {
    context.res = {
      status: 500,
      body: { error: "Missing Adobe credentials in environment variables." }
    };
    return;
  }

  try {
    context.log("🔐 Requesting Adobe access token...");

    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
        scope: "openid AdobeID session additional_info firefly_api ff_apis read_organizations read_avatars read_jobs"
      })
    });

    const rawText = await tokenRes.text();  // Capture raw text in case it's not JSON
    context.log("📥 Raw Adobe token response:", rawText);

    let tokenData;
    try {
      tokenData = JSON.parse(rawText);
    } catch (parseErr) {
      throw new Error("❌ Could not parse token JSON. Raw response: " + rawText);
    }

    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("❌ Failed to get access token: " + JSON.stringify(tokenData));
    }

    context.log("✅ Token acquired");

    // ... Continue with video generation request

    context.res = {
      status: 200,
      body: { message: "Token fetched successfully (demo step)", token: accessToken }
    };

  } catch (err) {
    context.log("🛑 ERROR:", err.message);
    context.res = {
      status: 500,
      body: { error: err.message || "Unexpected server error" }
    };
  }
};
