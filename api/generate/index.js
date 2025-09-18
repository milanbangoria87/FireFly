const fetch = require('node-fetch');

module.exports = async function (context, req) {
  context.log("🔁 Function invoked");

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  // 1. Get access token
  context.log("🔐 Requesting Adobe token...");
  const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: "session"
    })
  });

  const tokenData = await tokenRes.json();
  context.log("🎟️ Adobe token response:", tokenData);

  const accessToken = tokenData.access_token;

  if (!accessToken) {
    context.res = {
      status: 500,
      body: { error: "Failed to obtain access token", details: tokenData }
    };
    return;
  }

  context.log("✅ Token generated!");

  // 2. Submit Firefly job
  const generationRes = await fetch("https://firefly.adobe.io/v1/jobs", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-api-key": clientId
    },
    body: JSON.stringify({
      // 🔧 Replace this with actual request body
      prompt: "A glowing orb of energy",
      params: {
        type: "video",
        duration: 3,
        aspect_ratio: "1:1"
      }
    })
  });

  const generationData = await generationRes.json();
  context.log("🎞️ Job submission response:", generationData);

  const { jobId, statusUrl } = generationData;

  if (!statusUrl) {
    context.res = {
      status: 500,
      body: { error: "Failed to submit Firefly job", details: generationData }
    };
    return;
  }

  // 3. Poll for status (until succeeded or failed)
  context.log("⏳ Polling for video generation...");

  let pollResult;
  let attempts = 0;
  const maxAttempts = 50;
  const delay = 5000;

  while (attempts < maxAttempts) {
    const statusRes = await fetch(statusUrl, {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "x-api-key": clientId
      }
    });

    const statusData = await statusRes.json();
    context.log(`⌛ Poll ${attempts + 1}:`, statusData.status);

    if (statusData.status === "succeeded" || statusData.status === "failed") {
      pollResult = statusData;
      break;
    }

    await new Promise(resolve => setTimeout(resolve, delay));
    attempts++;
  }

  if (!pollResult || pollResult.status !== "succeeded") {
    context.res = {
      status: 500,
      body: {
        error: "Video generation failed or timed out",
        finalStatus: pollResult?.status || "unknown"
      }
    };
    return;
  }

  // ✅ Return final video URL
  const videoUrl = pollResult.result.outputs?.[0]?.video?.url;

  context.res = {
    status: 200,
    headers: {
      'Content-Type': 'application/json'
    },
    body: {
      message: "✅ Video generated successfully!",
      jobId: pollResult.jobId,
      videoUrl: videoUrl
    }
  };
};
