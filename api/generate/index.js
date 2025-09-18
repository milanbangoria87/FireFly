const fetch = require('node-fetch');

module.exports = async function (context, req) {
  try {
    context.log("🔁 Function invoked");

    const { prompt, height, width, apiType } = req.body;

    if (!prompt || !height || !width || !apiType) {
      context.res = {
        status: 400,
        body: { error: "Missing required fields: prompt, height, width, or apiType" }
      };
      return;
    }

    if (apiType !== "video") {
      context.res = {
        status: 400,
        body: { error: "Only 'video' API is implemented for now." }
      };
      return;
    }

    // 🔐 Hardcoded Adobe credentials
    const clientId = 'd53bc6ef2dd3444ca99d8144e4abc23e';
    const clientSecret = 'p8e-S4QHDD1hJyf-UEHK6L_MXx2BUCzhUhqq';

    context.log("🔐 Requesting Adobe token...");

    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', 
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

    // 🎬 Submit the video generation job
    const jobRes = await fetch('https://firefly-api.adobe.io/v3/videos/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': clientId,
        'Content-Type': 'application/json',
        'x-model-version': 'video1_standard',
        'Accept': '*/*'
      },
      body: JSON.stringify({
        bitRateFactor: 18,
        image: { conditions: [] },
        prompt,
        seeds: [Math.floor(Math.random() * 1000000000)],
        sizes: [{ height: parseInt(height), width: parseInt(width) }],
        videoSettings: {
          cameraMotion: "camera pan left",
          promptStyle: "anime",
          shotAngle: "aerial shot",
          shotSize: "close-up shot"
        }
      })
    });

    const job = await jobRes.json();
    context.log("🎞️ Job submission response:", job);

    const statusUrl = job.statusUrl;

    if (!statusUrl) {
      context.res = {
        status: 500,
        body: { error: "Job submission failed", details: job }
      };
      return;
    }

    context.log("⏳ Polling for video generation...");

    let videoUrl = null;
    for (let i = 0; i < 18; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds

      const statusCheck = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const statusData = await statusCheck.json();
      context.log(`⌛ Poll ${i + 1}:`, statusData.status);

      if (statusData.status === "succeeded" && statusData.output?.uri) {
        videoUrl = statusData.output.uri;
        break;
      }
    }

    if (videoUrl) {
      context.res = {
        status: 200,
        body: {
          message: "✅ Video generated successfully!",
          videoUrl
        }
      };
    } else {
      context.res = {
        status: 202,
        body: {
          message: "⏳ Video is still processing. Try again later.",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("❌ ERROR:", err.message || err);
    context.res = {
      status: 500,
      body: { error: err.message || "Internal Server Error" }
    };
  }
};
