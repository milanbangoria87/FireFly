const fetch = require('node-fetch');
const status = require('../status');

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

  status.setStatus("📥 Received input...");
  context.log("📥 Input:", { apiType, prompt, height, width, voiceId, avatarId });

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
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    status.setStatus("❌ Failed to obtain token");
    context.res = {
      status: 500,
      body: { error: "Failed to obtain access token", details: tokenData }
    };
    return;
  }

  context.log("✅ Token acquired");
  status.setStatus("✅ Token acquired");

  let generationRes, generationData, jobId, statusUrl, pollResult;
  const delay = 5000;
  const maxAttempts = 50;

  try {
    // 🔁 Dispatch based on apiType
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
      context.log("🎞️ Video response:", generationData);

      jobId = generationData.jobId;
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
          output: { mediaType: "video/mp4" }
        })
      });

      generationData = await generationRes.json();
      context.log("🎭 Avatar response:", generationData);

      jobId = generationData.jobId;
      if (!jobId) throw new Error("Avatar jobId missing from response");

      statusUrl = `https://firefly-epo855230.adobe.io/v3/status/${jobId}`;

    } else if (apiType === "image") {
      status.setStatus("📤 Submitting image generation job...");

      generationRes = await fetch("https://firefly-api.adobe.io/v3/images/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": clientId
        },
        body: JSON.stringify({
          prompt,
          contentClass: "photo",
          numVariations: 1,
          size: { height: parseInt(height), width: parseInt(width) },
          upsamplerType: "default",
          visualIntensity: 2
        })
      });

      generationData = await generationRes.json();
      context.log("🖼️ Image response:", generationData);

      jobId = generationData.jobId;
      if (!jobId) throw new Error("Image jobId missing from response");

      statusUrl = `https://firefly-api.adobe.io/v3/status/${jobId}`;

    } else {
      context.res = {
        status: 400,
        body: { error: "Unsupported apiType" }
      };
      return;
    }

    if (!statusUrl) {
      throw new Error("No status URL returned");
    }

    // ⏳ Polling Loop
    status.setStatus("⏳ Waiting for generation...");
    let attempts = 0;

    while (attempts < maxAttempts) {
      const statusRes = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": clientId
        }
      });

      const statusText = await statusRes.text();
      let statusData;

      try {
        statusData = JSON.parse(statusText);
      } catch (err) {
        context.log("❌ Invalid JSON from status API:", statusText);
        throw new Error("Status API returned invalid JSON.");
      }

      context.log(`⌛ Attempt ${attempts + 1}: Status - ${statusData.status}`);

      if (statusData.status === "succeeded") {
        pollResult = statusData;
        status.setStatus("✅ Generation succeeded!");
        break;
      }

      if (statusData.status === "failed") {
        pollResult = statusData;
        status.setStatus("❌ Generation failed.");
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

    // ✅ Success — extract URLs
    const output = pollResult?.result?.outputs?.[0];
    const imageUrl = output?.image?.url;
    const videoUrl = output?.video?.url;

    const response = {
      message: "✅ Generation completed successfully!",
      jobId: jobId
    };

    if (apiType === "image" && imageUrl) {
      response.imageUrl = imageUrl;
    } else if ((apiType === "video" || apiType === "avatar") && videoUrl) {
      response.videoUrl = videoUrl;
    } else {
      response.warning = "Media URL not found in output";
    }

    context.res = {
      status: 200,
      body: response
    };

  } catch (err) {
    context.log("❌ Error occurred:", err.message);
    status.setStatus("❌ Unexpected error.");
    context.res = {
      status: 500,
      body: { error: err.message || "Unexpected error" }
    };
  }
};
