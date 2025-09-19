const fetch = require('node-fetch');
const status = require('../status'); // 🔁 Status tracker import

module.exports = async function (context, req) {
  context.log("🔁 Function invoked");

  const userPrompt = req.body?.prompt;
  const height = parseInt(req.body?.height);
  const width = parseInt(req.body?.width);
  
  if (!userPrompt) {
    context.res = {
      status: 400,
      body: { error: "Missing prompt." }
    };
    return;
  }

  context.log("📥 Received input:", { userPrompt, height, width });
  status.setStatus("📥 Received input...");

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  // 🔐 Step 1: Get access token
  status.setStatus("🔐 Generating token...");
  const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
    status.setStatus("❌ Failed to get token.");
    context.res = {
      status: 500,
      body: { error: "Failed to obtain access token", details: tokenData }
    };
    return;
  }

  context.log("✅ Token generated!");
  status.setStatus("✅ Token generated!");

  // 🎞️ Step 2: Submit video generation request
  status.setStatus("📤 Submitting video generation job...");
  const generationRes = await fetch("https://firefly-api.adobe.io/v3/videos/generate", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-api-key": clientId,
      "x-model-version": "video1_standard"
    },
    body: JSON.stringify({
      bitRateFactor: 18,
      image: { conditions: [] },
      prompt: userPrompt,
      seeds: [1842533538],
      sizes: [{ height, width }],
      videoSettings: {
        cameraMotion: "camera pan left",
        promptStyle: "anime",
        shotAngle: "aerial shot",
        shotSize: "close-up shot"
      }
    })
  });

  const generationData = await generationRes.json();
  context.log("🎞️ Job submission response:", generationData);

  const { jobId, statusUrl } = generationData;

  if (!statusUrl) {
    status.setStatus("❌ Failed to submit video job.");
    context.res = {
      status: 500,
      body: { error: "Failed to submit Firefly job", details: generationData }
    };
    return;
  }

  // ⏳ Step 3: Poll job status
  status.setStatus("⏳ Generating video...");
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

    if (statusData.status === "succeeded") {
      status.setStatus("✅ Video generated!");
      pollResult = statusData;
      break;
    }

    if (statusData.status === "failed") {
      status.setStatus("❌ Generation failed.");
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

  // ✅ Step 4: Return final video URL
  const videoUrl = pollResult.result.outputs?.[0]?.video?.url;

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      message: "✅ Video generated successfully!",
      jobId: pollResult.jobId,
      videoUrl: videoUrl
    }
  };
};
