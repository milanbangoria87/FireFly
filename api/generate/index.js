const fetch = require('node-fetch');
const status = require('../status'); // 🔁 Status tracker import

module.exports = async function (context, req) {
  context.log("🔁 Function invoked");

  const { apiType, prompt, height, width, voiceId, avatarId } = req.body || {};

  if (!prompt || !apiType) {
    context.res = {
      status: 400,
      body: { error: "Missing required fields: prompt and apiType" }
    };
    return;
  }

  context.log("📥 Received input:", { prompt, height, width });
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

  // 👉 Dispatch API based on type
  let generationRes;
  let generationData;
  let statusUrl;
  let pollResult;

  const delay = 5000; // ms
  const maxAttempts = 50;

  try {
    if (apiType === "video") {
      status.setStatus("📤 Submitting video generation job...");
      generationRes = await fetch("https://firefly-api.adobe.io/v3/videos/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": clientId,
          "x-model-version": "video1_standard"
        },
        body: JSON.stringify({
          bitRateFactor: 18,
          image: { conditions: [] },
          prompt,
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

      generationData = await generationRes.json();
      context.log("🎞️ Video job response:", generationData);
      statusUrl = generationData.statusUrl;

    } else if (apiType === "avatar") {
      status.setStatus("📤 Submitting avatar generation job...");
      generationRes = await fetch("https://audio-video-api.adobe.io/v1/generate-avatar", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": clientId
        },
        body: JSON.stringify({
          script: {
            type: "text",
            text: prompt,
            localeCode: "en-US",
            mediaType: "text/plain"
          },
          voiceId,
          avatarId,
          output: {
            mediaType: "video/mp4"
          }
        })
      });

      generationData = await generationRes.json();
      context.log("🎭 Avatar job response:", generationData);

      const adobeJobId = generationData.jobId;
      statusUrl = `https://firefly-epo855230.adobe.io/v3/status/${adobeJobId}`;

    } else if (apiType === "image") {
      status.setStatus("📤 Submitting image generation job...");
      generationRes = await fetch("https://firefly-api.adobe.io/v2/images/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": clientId
        },
        body: JSON.stringify({
          prompt,
          sizes: [{ height, width }],
          outputType: "image/jpeg"
        })
      });

      generationData = await generationRes.json();
      context.log("🖼️ Image job response:", generationData);

      const imageJobId = generationData.jobId;
      statusUrl = `https://firefly-api.adobe.io/v2/images/status/${imageJobId}`;

    } else {
      context.res = {
        status: 400,
        body: { error: "Unsupported apiType" }
      };
      return;
    }

    if (!statusUrl) {
      status.setStatus("❌ Failed to submit generation job.");
      context.res = {
        status: 500,
        body: { error: "Job submission failed", details: generationData }
      };
      return;
    }

    // ⏳ Step 2: Poll job status
    status.setStatus("⏳ Generating content...");
    let attempts = 0;

    while (attempts < maxAttempts) {
      const statusRes = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": clientId
        }
      });

      const statusData = await statusRes.json();
      context.log(`⌛ Poll ${attempts + 1}:`, statusData.status);

      if (statusData.status === "succeeded") {
        status.setStatus("✅ Generation complete!");
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
          error: "Generation failed or timed out",
          finalStatus: pollResult?.status || "unknown"
        }
      };
      return;
    }

    // ✅ Step 3: Extract result
    const outputs = pollResult?.result?.outputs?.[0];

    if (apiType === "image") {
      const imageUrl = outputs?.image?.url;
      context.res = {
        status: 200,
        body: {
          message: "✅ Image generated successfully!",
          imageUrl,
          jobId: generationData.jobId || pollResult?.jobId
        }
      };
    } else {
      const videoUrl = outputs?.video?.url;
      context.res = {
        status: 200,
        body: {
          message: "✅ Video generated successfully!",
          videoUrl,
          jobId: generationData.jobId || pollResult?.jobId
        }
      };
    }

  } catch (err) {
    context.log("❌ Exception:", err.message);
    status.setStatus("❌ Unexpected error.");
    context.res = {
      status: 500,
      body: {
        error: err.message || "Unexpected error occurred"
      }
    };
  }
};
