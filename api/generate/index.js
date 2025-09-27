const fetch = require('node-fetch');
const status = require('../status'); // 🔁 Status tracker import

module.exports = async function (context, req) {
  try {
    context.log("🔁 Function invoked");

    // 🔽 Unified input vars
    const prompt = req.body?.prompt;
    const height = parseInt(req.body?.height);
    const width = parseInt(req.body?.width);
    const voiceId = req.body?.voiceId;
    const avatarId = req.body?.avatarId;
    const apiType = req.body?.apiType || "video"; // default to video if not provided

    if (!prompt) {
      context.res = {
        status: 400,
        body: { error: "Missing prompt." }
      };
      return;
    }

    context.log("📥 Received input:", { prompt, height, width, apiType });
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

    // 🚀 IMAGE GENERATION BLOCK
    if (apiType === "image") {
      status.setStatus("🖼️ Submitting image generation job...");

      const imageGenRes = await fetch("https://firefly-api.adobe.io/v3/images/generate-async", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-model-version": "image4_standard",
          "x-api-key": clientId
        },
        body: JSON.stringify({
          contentClass: "photo",
          prompt,
          size: { height, width },
          numVariations: 1,
          seeds: [0],
          visualIntensity: 2
        })
      });

      const imageGenData = await imageGenRes.json();
      context.log("🖼️ Image job submission response:", imageGenData);

      const jobId = imageGenData.jobId;
      if (!jobId) {
        status.setStatus("❌ Image jobId missing.");
        context.res = {
          status: 500,
          body: { error: "Image jobId missing from response", details: imageGenData }
        };
        return;
      }

      const statusUrl = `https://firefly-api.adobe.io/v3/status/${jobId}`;

      // Step 3: Poll job status
      status.setStatus("⏳ Generating image...");
      let pollResult;
      let attempts = 0;
      const maxAttempts = 50;
      const delay = 5000;

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
          status.setStatus("✅ Image generated!");
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
            error: "Image generation failed or timed out",
            finalStatus: pollResult?.status || "unknown"
          }
        };
        return;
      }

      const imageUrl = pollResult.result?.outputs?.[0]?.image?.url;
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          message: "✅ Image generated successfully!",
          jobId: pollResult.jobId,
          imageUrl
        }
      };
      return;
    }

    // 🎭 AVATAR GENERATION BLOCK
    else if (apiType === "avatar") {
      if (!voiceId || !avatarId) {
        context.res = {
          status: 400,
          body: { error: "Voice ID and Avatar ID are required." }
        };
        return;
      }

      status.setStatus("📤 Submitting avatar generation job...");

      const avatarRes = await fetch("https://audio-video-api.adobe.io/v1/generate-avatar", {
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
          voice: { voiceId },
          avatar: { avatarId },
          output: { mediaType: "video/mp4" }
        })
      });

      const avatarData = await avatarRes.json();
      context.log("🎭 Avatar job response:", avatarData);

      if (!avatarRes.ok) {
        status.setStatus("❌ Avatar job submission failed.");
        context.res = {
          status: 500,
          body: { error: "Failed to start avatar generation job", details: avatarData }
        };
        return;
      }

      const jobId = avatarData?.jobId;
      if (!jobId) {
        status.setStatus("❌ Avatar jobId missing.");
        context.res = {
          status: 500,
          body: { error: "Avatar jobId missing in response", details: avatarData }
        };
        return;
      }

      const statusUrl = `https://audio-video-api.adobe.io/v1/avatar/status/${jobId}`;

      // Poll for status
      status.setStatus("⏳ Generating avatar video...");
      let pollResult;
      let attempts = 0;
      const maxAttempts = 50;
      const delay = 5000;

      while (attempts < maxAttempts) {
        const statusRes = await fetch(statusUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-api-key": clientId
          }
        });

        const statusData = await statusRes.json();
        context.log(`⌛ Avatar Poll ${attempts + 1}:`, statusData.status);

        if (statusData.status === "succeeded") {
          status.setStatus("✅ Avatar generated!");
          pollResult = statusData;
          break;
        }

        if (statusData.status === "failed") {
          status.setStatus("❌ Avatar generation failed.");
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
            error: "Avatar generation failed or timed out",
            finalStatus: pollResult?.status || "unknown"
          }
        };
        return;
      }

      const videoUrl = pollResult?.result?.outputs?.[0]?.video?.url;
      context.res = {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          message: "✅ Avatar generated successfully!",
          jobId,
          videoUrl
        }
      };
      return;
    }

    // 🎞️ VIDEO GENERATION BLOCK
    else if (apiType === "video") {
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

      const videoUrl = pollResult.result.outputs?.[0]?.video?.url;
      context.res = {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        },
        body: {
          message: "✅ Video generated successfully!",
          jobId: pollResult.jobId,
          videoUrl
        }
      };
      return;
    }

    // Invalid API type
    context.res = {
      status: 400,
      body: { error: `Invalid apiType: ${apiType}` }
    };
  }

  catch (err) {
    context.log("💥 Unexpected error:", err);
    status.setStatus("❌ Internal server error.");
    context.res = {
      status: 500,
      body: { error: "Internal server error", details: err.message }
    };
  }
};
