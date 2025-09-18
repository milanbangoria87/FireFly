const fetch = require("node-fetch");

// 🔧 API and model version mapping
const API_MAP = {
  image: {
    endpoint: "https://firefly-api.adobe.io/v2/images/generate",
    model: "image2_standard"
  },
  video: {
    endpoint: "https://firefly-api.adobe.io/v3/videos/generate",
    model: "video1_standard"
  },
  avatar: {
    endpoint: "https://firefly-api.adobe.io/v1/avatars/generate",
    model: "avatar1_standard"
  },
  audio: {
    endpoint: "https://firefly-api.adobe.io/v1/audio/generate",
    model: "audio1_standard"
  }
};

module.exports = async function (context, req) {
  context.log("🔁 Function invoked");

  const apiType = req.body?.apiType?.toLowerCase();
  const userPrompt = req.body?.prompt;
  const height = parseInt(req.body?.height) || 720;
  const width = parseInt(req.body?.width) || 720;

  // 🛑 Validate inputs
  if (!userPrompt || !apiType || !API_MAP[apiType]) {
    context.res = {
      status: 400,
      body: { error: "Missing or invalid prompt/apiType." }
    };
    return;
  }

  const { endpoint, model } = API_MAP[apiType];
  context.log("📥 Received input:", { apiType, userPrompt, height, width });

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

  // 2. Build body dynamically (only for video now — others can be added)
  let requestBody;
  if (apiType === "video") {
    requestBody = {
      bitRateFactor: 18,
      image: {
        conditions: []
      },
      prompt: userPrompt,
      seeds: [Math.floor(Math.random() * 999999999)],
      sizes: [{ height, width }],
      videoSettings: {
        cameraMotion: "camera pan left",
        promptStyle: "anime",
        shotAngle: "aerial shot",
        shotSize: "close-up shot"
      }
    };
  } else {
    // For other types (image/avatar/audio) you can adjust accordingly
    requestBody = {
      prompt: userPrompt,
      sizes: [{ height, width }]
    };
  }

  // 3. Submit generation job
  context.log(`📤 Submitting generation job to ${apiType} API...`);
  const generationRes = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "x-api-key": clientId,
      "x-model-version": model
    },
    body: JSON.stringify(requestBody)
  });

  const generationData = await generationRes.json();
  context.log("🎞️ Job submission response:", generationData);

  const { jobId, statusUrl } = generationData;

  if (!statusUrl) {
    context.res = {
      status: 500,
      body: { error: "Failed to submit job", details: generationData }
    };
    return;
  }

  // 4. Poll for status
  context.log("⏳ Polling for generation result...");

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
        error: `${apiType} generation failed or timed out`,
        finalStatus: pollResult?.status || "unknown"
      }
    };
    return;
  }

  // 5. Extract result URL
  const videoUrl = pollResult?.result?.outputs?.[0]?.video?.url;
  const imageUrl = pollResult?.result?.outputs?.[0]?.image?.url;
  const avatarUrl = pollResult?.result?.outputs?.[0]?.avatar?.url;
  const audioUrl = pollResult?.result?.outputs?.[0]?.audio?.url;

  const resultUrl = videoUrl || imageUrl || avatarUrl || audioUrl;

  context.res = {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    body: {
      message: `✅ ${apiType} generated successfully!`,
      jobId: pollResult.jobId,
      resultUrl: resultUrl
    }
  };
};
