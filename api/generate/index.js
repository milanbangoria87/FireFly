const fetch = require('node-fetch');
const status = require('../status'); // Status tracker import

module.exports = async function (context, req) {
  context.log("🔁 Function invoked");

  // Destructure input parameters from the request body
  const { apiType, prompt, height, width, voiceId, avatarId } = req.body || {};

  // Validate required inputs
  if (!prompt || !apiType) {
    context.res = {
      status: 400,
      body: { error: "Missing required fields: prompt and apiType" }
    };
    return;
  }

  context.log("📥 Received input:", { prompt, height, width, voiceId, avatarId });
  status.setStatus("📥 Received input...");

  // Load API credentials from environment variables
  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  try {
    // STEP 1: Obtain Adobe Access Token
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

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      throw new Error(`Token request failed: ${tokenRes.status} - ${text}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Failed to obtain access token");
    }

    context.log("✅ Token generated!");
    status.setStatus("✅ Token generated!");

    // STEP 2: Submit generation request based on apiType
    let generationRes, generationData, jobId, statusUrl;

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

      if (!generationRes.ok) {
        const text = await generationRes.text();
        throw new Error(`Video generation request failed: ${generationRes.status} - ${text}`);
      }

      generationData = await generationRes.json();
      context.log("🎞️ Video job response:", generationData);

      // The video API directly returns the statusUrl for polling
      statusUrl = generationData.statusUrl;
      if (!statusUrl) throw new Error("Video statusUrl missing from response");

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

      if (!generationRes.ok) {
        const text = await generationRes.text();
        throw new Error(`Avatar generation request failed: ${generationRes.status} - ${text}`);
      }

      generationData = await generationRes.json();
      context.log("🎭 Avatar job response:", generationData);

      jobId = generationData.jobId;
      if (!jobId) throw new Error("Avatar jobId missing from response");

      // Construct status URL for avatar
      statusUrl = `https://firefly-epo855230.adobe.io/v3/status/${jobId}`;

    } else if (apiType === "image") {
      status.setStatus("📤 Submitting image generation job...");

      // NOTE: Updated request body to the latest format you shared
      generationRes = await fetch("https://firefly-api.adobe.io/v3/images/generate", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": clientId
        },
        body: JSON.stringify({
          contentClass: "photo",
          prompt,
          size: { height, width },
          numVariations: 1,
          seeds: [0],
          upsamplerType: "default",
          visualIntensity: 2
          // Add other optional fields as needed here
        })
      });

      if (!generationRes.ok) {
        const text = await generationRes.text();
        throw new Error(`Image generation request failed: ${generationRes.status} - ${text}`);
      }

      generationData = await generationRes.json();
      context.log("🖼️ Image job response:", generationData);

      jobId = generationData.jobId;
      if (!jobId) throw new Error("Image jobId missing from response");

      // Construct status URL for image generation
      statusUrl = `https://firefly-api.adobe.io/v3/status/${jobId}`;

    } else {
      context.res = {
        status: 400,
        body: { error: `Unsupported apiType: ${apiType}` }
      };
      return;
    }

    // STEP 3: Poll status endpoint until generation completes or fails or times out
    status.setStatus("⏳ Polling generation status...");
    const delay = 3000; // 3 seconds between polls
    const maxAttempts = 60; // timeout after ~3 minutes
    let attempts = 0;
    let pollResult = null;

    while (attempts < maxAttempts) {
      const statusRes = await fetch(statusUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "x-api-key": clientId
        }
      });

      if (statusRes.status !== 200) {
        throw new Error(`Status check failed with HTTP ${statusRes.status}`);
      }

      const statusData = await statusRes.json();
      context.log(`⌛ Poll attempt ${attempts + 1}: Status = ${statusData.status}`);

      if (statusData.status === "succeeded") {
        pollResult = statusData;
        break;
      }

      if (statusData.status === "failed") {
        pollResult = statusData;
        break;
      }

      attempts++;
      await new Promise(r => setTimeout(r, delay));
    }

    if (!pollResult || pollResult.status !== "succeeded") {
      status.setStatus("❌ Generation failed or timed out.");
      context.res = {
        status: 500,
        body: {
          error: "Generation failed or timed out",
          finalStatus: pollResult?.status || "unknown"
        }
      };
      return;
    }

    // STEP 4: Extract the output URL based on apiType and respond
    const output = pollResult.result.outputs?.[0];
    if (!output) {
      throw new Error("No output found in generation result");
    }

    if (apiType === "image") {
      const imageUrl = output.image?.url;
      if (!imageUrl) throw new Error("Image URL missing from output");

      context.res = {
        status: 200,
        body: {
          message: "✅ Image generated successfully!",
          imageUrl
        }
      };
    } else if (apiType === "video" || apiType === "avatar") {
      const videoUrl = output.video?.url;
      if (!videoUrl) throw new Error("Video URL missing from output");

      context.res = {
        status: 200,
        body: {
          message: `✅ ${apiType.charAt(0).toUpperCase() + apiType.slice(1)} generated successfully!`,
          videoUrl
        }
      };
    } else {
      // Should never reach here due to earlier validation
      throw new Error(`Unsupported apiType in output extraction: ${apiType}`);
    }

    status.setStatus("✅ Generation complete!");

  } catch (err) {
    // Catch any unexpected errors and respond accordingly
    context.log("❌ Exception:", err.message);
    status.setStatus("❌ Unexpected error.");
    context.res = {
      status: 500,
      body: { error: err.message || "Unexpected error occurred" }
    };
  }
};
