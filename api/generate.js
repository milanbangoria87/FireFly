const fetch = require('node-fetch');

module.exports = async function (context, req) {
  const { prompt, height, width, apiType } = req.body;

  if (apiType !== "video") {
    context.res = {
      status: 400,
      body: { error: "Only 'video' API is implemented in backend for now." }
    };
    return;
  }

  const clientId = process.env.FIREFLY_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SECRET;

  if (!clientId || !clientSecret) {
    context.res = {
      status: 500,
      body: { error: "Missing Adobe credentials in environment variables." }
    };
    return;
  }

  try {
    // Step 1: Get token
    context.log("🔐 Getting Adobe token...");
    const tokenRes = await fetch('https://ims-na1.adobelogin.com/ims/token/v3', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error("Failed to get token: " + JSON.stringify(tokenData));
    }

    context.log("✅ Token received!");

    // Step 2: Submit video generation request
    const payload = {
      bitRateFactor: 18,
      image: { conditions: [] },
      prompt,
      seeds: [Math.floor(Math.random() * 1000000000)],
      sizes: [{ height, width }],
      videoSettings: {
        cameraMotion: "camera pan left",
        promptStyle: "anime",
        shotAngle: "aerial shot",
        shotSize: "close-up shot"
      }
    };

    context.log("📤 Submitting video generation job...");

    const generateRes = await fetch('https://firefly-api.adobe.io/v3/videos/generate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'x-api-key': clientId,
        'Content-Type': 'application/json',
        'x-model-version': 'video1_standard',
        'Accept': '*/*'
      },
      body: JSON.stringify(payload)
    });

    const job = await generateRes.json();
    const statusUrl = job.statusUrl;

    if (!statusUrl) {
      throw new Error("Video generation job submission failed: " + JSON.stringify(job));
    }

    context.log("🕐 Job submitted. Polling status...");

    // Step 3: Poll for job completion
    let attempts = 0;
    let videoUrl = null;

    while (attempts < 18) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      const statusRes = await fetch(statusUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'x-api-key': clientId,
          'Accept': 'application/json'
        }
      });

      const statusData = await statusRes.json();
      context.log(`🔁 Attempt ${attempts + 1}: Status = ${statusData.status}`);

      if (statusData.status === "succeeded" && statusData.output && statusData.output.uri) {
        videoUrl = statusData.output.uri;
        break;
      }

      attempts++;
    }

    // Step 4: Respond
    if (videoUrl) {
      context.res = {
        status: 200,
        body: {
          message: "🎉 Video generated!",
          videoUrl
        }
      };
    } else {
      context.res = {
        status: 202,
        body: {
          message: "⌛ Video is still processing. Try again later.",
          statusUrl
        }
      };
    }

  } catch (err) {
    context.log("❌ Error:", err.message || err);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { error: err.message || "Unexpected server error" }
    };
  }
};
